use super::helpers::timeflow_data_dir;
use super::types::{ExportArchive, ImportSummary, ImportValidation, SessionConflict, SessionRow};
use crate::db;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

#[tauri::command]
pub async fn validate_import(
    app: AppHandle,
    archive_path: String,
) -> Result<ImportValidation, String> {
    let content = fs::read_to_string(&archive_path).map_err(|e| e.to_string())?;
    let archive: ExportArchive = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let conn = db::get_connection(&app)?;

    let mut existing_projects: HashSet<String> = HashSet::new();
    let mut stmt = conn
        .prepare_cached("SELECT name FROM projects")
        .map_err(|e| e.to_string())?;
    for row in stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
    {
        if let Ok(name) = row {
            existing_projects.insert(name);
        }
    }

    let mut existing_apps: HashSet<String> = HashSet::new();
    let mut stmt = conn
        .prepare_cached("SELECT executable_name FROM applications")
        .map_err(|e| e.to_string())?;
    for row in stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
    {
        if let Ok(exe) = row {
            existing_apps.insert(exe);
        }
    }

    let mut missing_projects = Vec::new();
    let mut missing_applications = Vec::new();
    let mut overlapping_sessions = Vec::new();

    // Check Projects
    for p in &archive.data.projects {
        if !existing_projects.contains(&p.name) {
            missing_projects.push(p.name.clone());
        }
    }

    // Check Applications
    for a in &archive.data.applications {
        if !existing_apps.contains(&a.executable_name) {
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
    let mut existing_projects_map: HashMap<String, i64> = HashMap::new();
    {
        let mut stmt = tx
            .prepare("SELECT name, id FROM projects")
            .map_err(|e| e.to_string())?;
        for row in stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?
        {
            if let Ok((name, id)) = row {
                existing_projects_map.insert(name.trim().to_lowercase(), id);
            }
        }
    }

    // 0. Handle Tombstones
    for t in &archive.data.tombstones {
        match t.table_name.as_str() {
            "projects" => {
                if let Some(ref name) = t.sync_key {
                    tx.execute("DELETE FROM projects WHERE name = ?1", [name])
                        .ok();
                }
            }
            "manual_sessions" => {
                if let Some(ref key) = t.sync_key {
                    // key is "pid|start_time|title"
                    let parts: Vec<&str> = key.split('|').collect();
                    if parts.len() == 3 {
                        let start_time = parts[1];
                        let title = parts[2];
                        // We don't have local PID here easily, but we can match by start_time and title globally
                        // or better: just ignore if we can't match exactly.
                        // But if it's a manual session, (start_time, title) is pretty unique for a user.
                        tx.execute(
                            "DELETE FROM manual_sessions WHERE start_time = ?1 AND title = ?2",
                            [start_time, title],
                        )
                        .ok();
                    }
                }
            }
            _ => {}
        }
    }

    let mut project_mapping = HashMap::new(); // archive_id -> local_id
    for p in &archive.data.projects {
        let project_key = p.name.trim().to_lowercase();
        let local_id = existing_projects_map.get(&project_key).copied();

        let id = if let Some(id) = local_id {
            // Upsert: Aktualizuj istniejący projekt o dane z importu (kolor, stawkę, folder, status zamrożenia)
            // Rozstrzygnij konflikt za pomocą updated_at
            let local_updated_at: String = tx
                .query_row(
                    "SELECT updated_at FROM projects WHERE id = ?1",
                    [id],
                    |row| row.get(0),
                )
                .unwrap_or_default();

            if p.updated_at > local_updated_at {
                tx.execute(
                    "UPDATE projects 
                     SET color = ?1, 
                         hourly_rate = COALESCE(?2, hourly_rate),
                         assigned_folder_path = COALESCE(?3, assigned_folder_path),
                         frozen_at = COALESCE(?4, frozen_at),
                         excluded_at = COALESCE(?5, excluded_at),
                         updated_at = ?6
                     WHERE id = ?7",
                    rusqlite::params![
                        p.color,
                        p.hourly_rate,
                        p.assigned_folder_path,
                        p.frozen_at,
                        p.excluded_at,
                        p.updated_at,
                        id
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
            id
        } else {
            tx.execute(
                "INSERT INTO projects (name, color, hourly_rate, created_at, excluded_at, assigned_folder_path, is_imported, frozen_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8)",
                rusqlite::params![p.name, p.color, p.hourly_rate, p.created_at, p.excluded_at, p.assigned_folder_path, p.frozen_at, p.updated_at]
            ).map_err(|e| e.to_string())?;
            summary.projects_created += 1;
            let new_id = tx.last_insert_rowid();
            existing_projects_map.insert(project_key, new_id);
            new_id
        };
        project_mapping.insert(p.id, id);
    }

    // 2. Map and Create Applications
    let mut existing_apps_map: HashMap<String, i64> = HashMap::new();
    let mut existing_apps_display_map: HashMap<String, i64> = HashMap::new();
    {
        let mut stmt = tx
            .prepare("SELECT executable_name, display_name, id FROM applications")
            .map_err(|e| e.to_string())?;
        for row in stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?
        {
            if let Ok((exe, display_name, id)) = row {
                existing_apps_map.insert(exe.trim().to_lowercase(), id);
                existing_apps_display_map.insert(display_name.trim().to_lowercase(), id);
            }
        }
    }

    let mut app_mapping = HashMap::new(); // archive_id -> local_id
    for a in &archive.data.applications {
        let exe_key = a.executable_name.trim().to_lowercase();
        let display_key = a.display_name.trim().to_lowercase();
        let local_id = existing_apps_map
            .get(&exe_key)
            .copied()
            .or_else(|| existing_apps_display_map.get(&display_key).copied());

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
            let new_id = tx.last_insert_rowid();
            existing_apps_map.insert(exe_key, new_id);
            existing_apps_display_map.insert(display_key, new_id);
            new_id
        };
        app_mapping.insert(a.id, id);
    }
    // 3. Import and Merge Sessions
    for s in &archive.data.sessions {
        if let Some(&local_app_id) = app_mapping.get(&s.app_id) {
            let local_project_id = s
                .project_id
                .and_then(|old_pid| project_mapping.get(&old_pid).copied());
            let incoming = SessionRow {
                id: s.id,
                app_id: local_app_id,
                project_id: local_project_id,
                start_time: s.start_time.clone(),
                end_time: s.end_time.clone(),
                duration_seconds: s.duration_seconds,
                rate_multiplier: s.rate_multiplier,
                date: s.date.clone(),
                comment: s.comment.clone(),
                is_hidden: s.is_hidden,
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
            let local_manual_app_id = ms
                .app_id
                .and_then(|archive_app_id| app_mapping.get(&archive_app_id).copied());
            // Fetch local updated_at if exists
            let local_status: Option<(i64, String)> = tx.query_row(
                "SELECT id, updated_at FROM manual_sessions WHERE project_id = ?1 AND start_time = ?2 AND title = ?3",
                rusqlite::params![local_pid, ms.start_time, ms.title],
                |row| Ok((row.get(0)?, row.get(1)?))
            ).optional().map_err(|e| e.to_string())?;

            if let Some((local_id, local_updated_at)) = local_status {
                if ms.updated_at > local_updated_at {
                    tx.execute(
                        "UPDATE manual_sessions SET 
                            session_type = ?1, 
                            end_time = ?2, 
                            duration_seconds = ?3, 
                            updated_at = ?4,
                            app_id = ?5
                         WHERE id = ?6",
                        rusqlite::params![
                            ms.session_type,
                            ms.end_time,
                            ms.duration_seconds,
                            ms.updated_at,
                            local_manual_app_id,
                            local_id
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                }
            } else {
                tx.execute(
                    "INSERT INTO manual_sessions (title, session_type, project_id, app_id, start_time, end_time, duration_seconds, date, created_at, updated_at) 
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    rusqlite::params![ms.title, ms.session_type, local_pid, local_manual_app_id, ms.start_time, ms.end_time, ms.duration_seconds, ms.date, ms.created_at, ms.updated_at]
                ).map_err(|e| e.to_string())?;
            }
        }
    }

    // 5. Daily Files
    let data_dir = timeflow_data_dir()?.join("data");
    if !data_dir.exists() {
        fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    }
    for (date, daily) in &archive.data.daily_files {
        let file_path = data_dir.join(format!("{}.json", date));
        // We could merge daily files too, but simpler is to overwrite or skip.
        // Specification says to save JSON files to data/.
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

    match super::sessions::apply_manual_session_overrides(&conn) {
        Ok(reapplied) if reapplied > 0 => {
            log::info!(
                "Reapplied {} manual session override(s) after import_data",
                reapplied
            );
        }
        Ok(_) => {}
        Err(e) => {
            log::warn!(
                "Failed to reapply manual session overrides after import_data: {}",
                e
            );
        }
    }

    Ok(summary)
}

#[tauri::command]
pub async fn import_data_archive(
    app: AppHandle,
    archive: ExportArchive,
) -> Result<ImportSummary, String> {
    let backup_path = create_sync_restore_backup(&app)?;

    // Online sync pull should converge to exactly the server snapshot.
    // Replace synchronized tables first to avoid legacy merge conflicts
    // (e.g. stale boosts/comments/manual-session duplicates).
    {
        let conn = db::get_connection(&app)?;
        conn.execute_batch(
            "DELETE FROM file_activities;
             DELETE FROM sessions;
             DELETE FROM manual_sessions;
             DELETE FROM applications;
             DELETE FROM projects;
             DELETE FROM assignment_auto_run_items;
             DELETE FROM assignment_auto_runs;
             DELETE FROM assignment_feedback;
             DELETE FROM assignment_suggestions;
             DELETE FROM assignment_model_app;
             DELETE FROM assignment_model_token;
             DELETE FROM assignment_model_time;
             DELETE FROM assignment_model_state;",
        )
        .map_err(|e| e.to_string())?;
    }

    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let temp_path = std::env::temp_dir().join(format!(
        "timeflow-sync-import-{}-{}.json",
        std::process::id(),
        timestamp_ms
    ));

    let json = serde_json::to_string(&archive).map_err(|e| e.to_string())?;
    fs::write(&temp_path, json).map_err(|e| e.to_string())?;

    let temp_path_string = temp_path.to_string_lossy().to_string();
    let result = import_data(app.clone(), temp_path_string).await;
    let _ = fs::remove_file(&temp_path);
    match result {
        Ok(summary) => {
            let _ = fs::remove_file(&backup_path);
            if let Ok(conn) = db::get_connection(&app) {
                match super::sessions::apply_manual_session_overrides(&conn) {
                    Ok(reapplied) if reapplied > 0 => {
                        log::info!(
                            "Reapplied {} manual session override(s) after sync import",
                            reapplied
                        );
                    }
                    Ok(_) => {}
                    Err(e) => {
                        log::warn!(
                            "Failed to reapply manual session overrides after sync import: {}",
                            e
                        );
                    }
                }
                // Retrain the AI model from the imported data plus reapplied local overrides.
                if let Err(e) = super::assignment_model::retrain_model_sync(&conn) {
                    log::warn!("Auto-retrain after sync import failed: {}", e);
                }
            }
            Ok(summary)
        }
        Err(import_error) => {
            let restore_result = restore_db_from_backup(&app, &backup_path);
            let _ = fs::remove_file(&backup_path);
            match restore_result {
                Ok(()) => Err(format!(
                    "Sync import failed and was rolled back to pre-import state: {}",
                    import_error
                )),
                Err(restore_error) => Err(format!(
                    "Sync import failed and rollback failed. import_error={}, restore_error={}",
                    import_error, restore_error
                )),
            }
        }
    }
}

fn merge_or_insert_session(
    tx: &rusqlite::Transaction<'_>,
    local_app_id: i64,
    incoming: &SessionRow,
) -> Result<bool, String> {
    let mut merged_start = incoming.start_time.clone();
    let mut merged_end = incoming.end_time.clone();
    // Preserve local assignment when overlapping sessions already exist.
    // This prevents remote sync payloads from repeatedly overwriting manual local changes.
    let mut merged_project_id: Option<i64> = None;
    let mut merged_rate_multiplier = incoming.rate_multiplier.max(1.0);
    let mut merged_comment = incoming.comment.clone().unwrap_or_default();
    let mut merged_is_hidden = incoming.is_hidden;
    let mut overlap_ids: HashSet<i64> = HashSet::new();

    // Expand interval until closure: if merged range touches more sessions,
    // include them too so we end with one normalized interval.
    loop {
        let mut stmt = tx
            .prepare(
                "SELECT id, start_time, end_time, project_id
                        , COALESCE(rate_multiplier, 1.0), comment, is_hidden
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
                        row.get::<_, Option<i64>>(3)?,
                        row.get::<_, f64>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, i64>(6)? != 0,
                    ))
                },
            )
            .map_err(|e| e.to_string())?;

        let prev_count = overlap_ids.len();
        for row in rows {
            let (id, start, end, project_id, rate_multiplier, comment, is_hidden) =
                row.map_err(|e| e.to_string())?;
            overlap_ids.insert(id);
            merged_start = min_timestamp(&merged_start, &start);
            merged_end = max_timestamp(&merged_end, &end);
            if merged_project_id.is_none() {
                merged_project_id = project_id;
            }
            if rate_multiplier.is_finite() && rate_multiplier > merged_rate_multiplier {
                merged_rate_multiplier = rate_multiplier;
            }
            if let Some(c) = comment {
                if !merged_comment.contains(&c) {
                    if !merged_comment.is_empty() {
                        merged_comment.push_str(" | ");
                    }
                    merged_comment.push_str(&c);
                }
            }
            if is_hidden {
                merged_is_hidden = true;
            }
        }

        if overlap_ids.len() == prev_count {
            break;
        }
    }

    if merged_project_id.is_none() {
        merged_project_id = incoming.project_id;
    }

    if overlap_ids.is_empty() {
        tx.execute(
            "INSERT INTO sessions (app_id, project_id, start_time, end_time, duration_seconds, date, rate_multiplier, comment, is_hidden)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                local_app_id,
                merged_project_id,
                incoming.start_time,
                incoming.end_time,
                incoming.duration_seconds,
                incoming.date,
                merged_rate_multiplier,
                incoming.comment,
                incoming.is_hidden
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

    let final_comment = if merged_comment.is_empty() {
        None
    } else {
        Some(merged_comment)
    };

    tx.execute(
        "UPDATE sessions
         SET start_time = ?1, end_time = ?2, duration_seconds = ?3, rate_multiplier = ?4, comment = ?5, is_hidden = ?6, project_id = ?7
         WHERE id = ?8",
        rusqlite::params![
            merged_start,
            merged_end,
            duration,
            merged_rate_multiplier,
            final_comment,
            merged_is_hidden,
            merged_project_id,
            keep_id
        ],
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

fn create_sync_restore_backup(app: &AppHandle) -> Result<PathBuf, String> {
    let status = db::get_demo_mode_status(app)?;
    let active_db_path = PathBuf::from(status.active_db_path);
    let parent = active_db_path
        .parent()
        .ok_or_else(|| "Cannot resolve active database directory".to_string())?;

    // Flush WAL into the main file so a plain file copy is consistent.
    {
        let conn = db::get_connection(app)?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|e| format!("Failed WAL checkpoint before sync backup: {}", e))?;
    }

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let backup_path = parent.join(format!(
        "timeflow-sync-restore-{}-{}.db",
        std::process::id(),
        ts
    ));

    fs::copy(&active_db_path, &backup_path).map_err(|e| {
        format!(
            "Failed to create sync restore backup '{}' -> '{}': {}",
            active_db_path.display(),
            backup_path.display(),
            e
        )
    })?;

    Ok(backup_path)
}

fn restore_db_from_backup(app: &AppHandle, backup_path: &PathBuf) -> Result<(), String> {
    let status = db::get_demo_mode_status(app)?;
    let active_db_path = PathBuf::from(status.active_db_path);
    let wal_path = PathBuf::from(format!("{}-wal", active_db_path.to_string_lossy()));
    let shm_path = PathBuf::from(format!("{}-shm", active_db_path.to_string_lossy()));

    if wal_path.exists() {
        let _ = fs::remove_file(&wal_path);
    }
    if shm_path.exists() {
        let _ = fs::remove_file(&shm_path);
    }
    if active_db_path.exists() {
        fs::remove_file(&active_db_path).map_err(|e| {
            format!(
                "Failed to remove active database '{}' before restore: {}",
                active_db_path.display(),
                e
            )
        })?;
    }

    fs::copy(backup_path, &active_db_path).map_err(|e| {
        format!(
            "Failed to restore database from '{}' to '{}': {}",
            backup_path.display(),
            active_db_path.display(),
            e
        )
    })?;

    // Re-open once to recreate sidecars and verify DB is usable.
    let conn = db::get_connection(app)?;
    conn.execute_batch("PRAGMA wal_checkpoint(PASSIVE);")
        .map_err(|e| format!("Database restored but verification failed: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_sessions_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory sqlite");
        conn.execute_batch(
            "CREATE TABLE sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id INTEGER NOT NULL,
                project_id INTEGER,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                date TEXT NOT NULL,
                rate_multiplier REAL NOT NULL DEFAULT 1.0,
                comment TEXT,
                is_hidden INTEGER NOT NULL DEFAULT 0
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
            project_id: None,
            start_time: "2026-01-01T09:30:00+00:00".to_string(),
            end_time: "2026-01-01T10:10:00+00:00".to_string(),
            duration_seconds: 2400,
            rate_multiplier: 1.0,
            date: "2026-01-01".to_string(),
            comment: None,
            is_hidden: false,
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
