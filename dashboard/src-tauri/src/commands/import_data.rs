use super::helpers::cfab_demon_dir;
use super::types::{ExportArchive, ImportSummary, ImportValidation, SessionConflict, SessionRow};
use crate::db;
use std::collections::{HashMap, HashSet};
use std::fs;
use tauri::AppHandle;

#[tauri::command]
pub async fn validate_import(
    app: AppHandle,
    archive_path: String,
) -> Result<ImportValidation, String> {
    let content = fs::read_to_string(&archive_path).map_err(|e| e.to_string())?;
    let archive: ExportArchive = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let conn = db::get_connection(&app)?;

    let mut missing_projects = Vec::new();
    let mut missing_applications = Vec::new();
    let mut overlapping_sessions = Vec::new();

    // Check Projects
    for p in &archive.data.projects {
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM projects WHERE name = ?1",
                [&p.name],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !exists {
            missing_projects.push(p.name.clone());
        }
    }

    // Check Applications
    for a in &archive.data.applications {
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM applications WHERE executable_name = ?1",
                [&a.executable_name],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !exists {
            missing_applications.push(format!("{} ({})", a.display_name, a.executable_name));
        }
    }

    // Check Overlapping Sessions (simplified check: any session from archive that overlaps with existing for same app)
    // We only check a subset if it's too many, but here we'll try to check all.
    for s in &archive.data.sessions {
        let app_exe = archive
            .data
            .applications
            .iter()
            .find(|a| a.id == s.app_id)
            .map(|a| a.executable_name.clone());

        if let Some(exe) = app_exe {
            let conflict: Option<SessionConflict> = conn
                .query_row(
                    "SELECT s.start_time, s.end_time, a.display_name 
                 FROM sessions s 
                 JOIN applications a ON s.app_id = a.id 
                 WHERE a.executable_name = ?1 
                 AND (?2 < s.end_time AND ?3 > s.start_time)
                 LIMIT 1",
                    rusqlite::params![exe, s.start_time, s.end_time],
                    |row| {
                        Ok(SessionConflict {
                            app_name: row.get(2)?,
                            start: s.start_time.clone(),
                            end: s.end_time.clone(),
                            existing_start: row.get(0)?,
                            existing_end: row.get(1)?,
                        })
                    },
                )
                .optional()
                .map_err(|e| e.to_string())?;

            if let Some(c) = conflict {
                overlapping_sessions.push(c);
                if overlapping_sessions.len() > 10 {
                    break;
                } // Don't overwhelm UI
            }
        }
    }

    Ok(ImportValidation {
        valid: true,
        missing_projects,
        missing_applications,
        overlapping_sessions,
    })
}

#[tauri::command]
pub async fn import_data(app: AppHandle, archive_path: String) -> Result<ImportSummary, String> {
    let content = fs::read_to_string(&archive_path).map_err(|e| e.to_string())?;
    let archive: ExportArchive = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let mut conn = db::get_connection(&app)?;

    let mut summary = ImportSummary {
        projects_created: 0,
        apps_created: 0,
        sessions_imported: 0,
        sessions_merged: 0,
        daily_files_imported: 0,
    };

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // 1. Map and Create Projects
    let mut project_mapping = HashMap::new(); // archive_id -> local_id
    for p in &archive.data.projects {
        let local_id: Option<i64> = tx
            .query_row(
                "SELECT id FROM projects WHERE name = ?1",
                [&p.name],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let id = if let Some(id) = local_id {
            id
        } else {
            tx.execute(
                "INSERT INTO projects (name, color, created_at, excluded_at, assigned_folder_path, is_imported) VALUES (?1, ?2, ?3, ?4, ?5, 1)",
                rusqlite::params![p.name, p.color, p.created_at, p.excluded_at, p.assigned_folder_path]
            ).map_err(|e| e.to_string())?;
            summary.projects_created += 1;
            tx.last_insert_rowid()
        };
        project_mapping.insert(p.id, id);
    }

    // 2. Map and Create Applications
    let mut app_mapping = HashMap::new(); // archive_id -> local_id
    for a in &archive.data.applications {
        let local_id: Option<i64> = tx
            .query_row(
                "SELECT id FROM applications WHERE executable_name = ?1",
                [&a.executable_name],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let mapped_project_id = a
            .project_id
            .and_then(|old_pid| project_mapping.get(&old_pid).copied());

        let id = if let Some(id) = local_id {
            if let Some(pid) = mapped_project_id {
                tx.execute(
                    "UPDATE applications
                     SET project_id = COALESCE(project_id, ?1)
                     WHERE id = ?2",
                    rusqlite::params![pid, id],
                )
                .map_err(|e| e.to_string())?;
            }
            id
        } else {
            tx.execute(
                "INSERT INTO applications (executable_name, display_name, project_id, is_imported) VALUES (?1, ?2, ?3, 1)",
                rusqlite::params![a.executable_name, a.display_name, mapped_project_id]
            ).map_err(|e| e.to_string())?;
            summary.apps_created += 1;
            tx.last_insert_rowid()
        };
        app_mapping.insert(a.id, id);
    }
    // 3. Import and Merge Sessions
    for s in &archive.data.sessions {
        if let Some(&local_app_id) = app_mapping.get(&s.app_id) {
            let incoming = SessionRow {
                id: s.id,
                app_id: local_app_id,
                start_time: s.start_time.clone(),
                end_time: s.end_time.clone(),
                duration_seconds: s.duration_seconds,
                date: s.date.clone(),
            };

            let merged = merge_or_insert_session(&tx, local_app_id, &incoming)?;
            if merged {
                summary.sessions_merged += 1;
            } else {
                summary.sessions_imported += 1;
            }
        }
    }
    // 4. Manual Sessions
    for ms in &archive.data.manual_sessions {
        if let Some(&local_pid) = project_mapping.get(&ms.project_id) {
            tx.execute(
                "INSERT INTO manual_sessions (title, session_type, project_id, start_time, end_time, duration_seconds, date, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![ms.title, ms.session_type, local_pid, ms.start_time, ms.end_time, ms.duration_seconds, ms.date, ms.created_at]
            ).map_err(|e| e.to_string())?;
        }
    }

    // 5. Daily Files
    let data_dir = cfab_demon_dir()?.join("data");
    if !data_dir.exists() {
        fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    }
    for (date, daily) in &archive.data.daily_files {
        let file_path = data_dir.join(format!("{}.json", date));
        // We could merge daily files too, but simpler is to overwrite or skip.
        // Specification says "Zapisz pliki JSON do data/".
        // We'll merge if exists for safety.
        let final_data = if file_path.exists() {
            let existing_content = fs::read_to_string(&file_path).unwrap_or_default();
            if let Ok(mut existing_daily) =
                serde_json::from_str::<crate::commands::types::DailyData>(&existing_content)
            {
                for (exe, app_data) in &daily.apps {
                    existing_daily.apps.insert(
                        exe.clone(),
                        crate::commands::types::AppDailyData {
                            display_name: app_data.display_name.clone(),
                            total_seconds: app_data.total_seconds,
                            sessions: app_data
                                .sessions
                                .iter()
                                .map(|s| crate::commands::types::JsonSession {
                                    start: s.start.clone(),
                                    end: s.end.clone(),
                                    duration_seconds: s.duration_seconds,
                                })
                                .collect(),
                            files: app_data
                                .files
                                .iter()
                                .map(|f| crate::commands::types::JsonFileEntry {
                                    name: f.name.clone(),
                                    total_seconds: f.total_seconds,
                                    first_seen: f.first_seen.clone(),
                                    last_seen: f.last_seen.clone(),
                                })
                                .collect(),
                        },
                    );
                }
                existing_daily
            } else {
                (*daily).clone()
            }
        } else {
            (*daily).clone()
        };

        let json = serde_json::to_string_pretty(&final_data).map_err(|e| e.to_string())?;
        fs::write(&file_path, json).map_err(|e| e.to_string())?;
        summary.daily_files_imported += 1;
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(summary)
}

fn merge_or_insert_session(
    tx: &rusqlite::Transaction<'_>,
    local_app_id: i64,
    incoming: &SessionRow,
) -> Result<bool, String> {
    let mut merged_start = incoming.start_time.clone();
    let mut merged_end = incoming.end_time.clone();
    let mut overlap_ids: HashSet<i64> = HashSet::new();

    // Expand interval until closure: if merged range touches more sessions,
    // include them too so we end with one normalized interval.
    loop {
        let mut stmt = tx
            .prepare(
                "SELECT id, start_time, end_time
                 FROM sessions
                 WHERE app_id = ?1 AND date = ?2
                   AND start_time <= ?3
                   AND end_time >= ?4",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(
                rusqlite::params![local_app_id, incoming.date, merged_end, merged_start],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .map_err(|e| e.to_string())?;

        let prev_count = overlap_ids.len();
        for row in rows {
            let (id, start, end) = row.map_err(|e| e.to_string())?;
            overlap_ids.insert(id);
            merged_start = min_timestamp(&merged_start, &start);
            merged_end = max_timestamp(&merged_end, &end);
        }

        if overlap_ids.len() == prev_count {
            break;
        }
    }

    if overlap_ids.is_empty() {
        tx.execute(
            "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                local_app_id,
                incoming.start_time,
                incoming.end_time,
                incoming.duration_seconds,
                incoming.date
            ],
        )
        .map_err(|e| e.to_string())?;
        return Ok(false);
    }

    let keep_id = *overlap_ids
        .iter()
        .min()
        .ok_or_else(|| "Internal error: overlap set unexpectedly empty".to_string())?;
    let duration = calculate_duration(&merged_start, &merged_end);

    tx.execute(
        "UPDATE sessions
         SET start_time = ?1, end_time = ?2, duration_seconds = ?3
         WHERE id = ?4",
        rusqlite::params![merged_start, merged_end, duration, keep_id],
    )
    .map_err(|e| e.to_string())?;

    for id in overlap_ids.into_iter().filter(|id| *id != keep_id) {
        tx.execute("DELETE FROM sessions WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?;
    }

    Ok(true)
}

fn min_timestamp(a: &str, b: &str) -> String {
    match (
        chrono::DateTime::parse_from_rfc3339(a),
        chrono::DateTime::parse_from_rfc3339(b),
    ) {
        (Ok(da), Ok(db)) => {
            if da <= db {
                a.to_string()
            } else {
                b.to_string()
            }
        }
        _ => {
            if a <= b {
                a.to_string()
            } else {
                b.to_string()
            }
        }
    }
}

fn max_timestamp(a: &str, b: &str) -> String {
    match (
        chrono::DateTime::parse_from_rfc3339(a),
        chrono::DateTime::parse_from_rfc3339(b),
    ) {
        (Ok(da), Ok(db)) => {
            if da >= db {
                a.to_string()
            } else {
                b.to_string()
            }
        }
        _ => {
            if a >= b {
                a.to_string()
            } else {
                b.to_string()
            }
        }
    }
}

fn calculate_duration(start: &str, end: &str) -> i64 {
    let s = chrono::DateTime::parse_from_rfc3339(start).ok();
    let e = chrono::DateTime::parse_from_rfc3339(end).ok();
    if let (Some(s), Some(e)) = (s, e) {
        (e - s).num_seconds()
    } else {
        0
    }
}

use rusqlite::OptionalExtension;

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_sessions_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory sqlite");
        conn.execute_batch(
            "CREATE TABLE sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                date TEXT NOT NULL
            );",
        )
        .expect("create sessions schema");
        conn
    }

    #[test]
    fn merge_or_insert_session_merges_transitive_overlaps() {
        let mut conn = setup_sessions_conn();
        conn.execute(
            "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                1i64,
                "2026-01-01T10:00:00+00:00",
                "2026-01-01T11:00:00+00:00",
                3600i64,
                "2026-01-01"
            ],
        )
        .expect("insert session 1");
        conn.execute(
            "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                1i64,
                "2026-01-01T10:50:00+00:00",
                "2026-01-01T12:00:00+00:00",
                4200i64,
                "2026-01-01"
            ],
        )
        .expect("insert session 2");

        let tx = conn.transaction().expect("transaction");
        let incoming = SessionRow {
            id: 999,
            app_id: 1,
            start_time: "2026-01-01T09:30:00+00:00".to_string(),
            end_time: "2026-01-01T10:10:00+00:00".to_string(),
            duration_seconds: 2400,
            date: "2026-01-01".to_string(),
        };

        let merged = merge_or_insert_session(&tx, 1, &incoming).expect("merge");
        assert!(merged);
        tx.commit().expect("commit");

        let (count, start, end, duration): (i64, String, String, i64) = conn
            .query_row(
                "SELECT COUNT(*), MIN(start_time), MAX(end_time), MAX(duration_seconds) FROM sessions WHERE app_id = 1 AND date = '2026-01-01'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("query merged session");

        assert_eq!(count, 1);
        assert_eq!(start, "2026-01-01T09:30:00+00:00");
        assert_eq!(end, "2026-01-01T12:00:00+00:00");
        assert_eq!(duration, 9000);
    }
}
