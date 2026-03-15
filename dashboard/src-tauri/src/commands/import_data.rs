use super::daily_store_bridge;
use super::helpers::{run_app_blocking, timeflow_data_dir, validate_import_path};
use super::types::{ExportArchive, ImportSummary, ImportValidation, SessionConflict, SessionRow};
use crate::db;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

fn save_demo_daily_file(
    date: &str,
    daily: &crate::commands::types::DailyData,
) -> Result<(), String> {
    let fake_data_dir = timeflow_data_dir()?.join("fake_data");
    if !fake_data_dir.exists() {
        fs::create_dir_all(&fake_data_dir).map_err(|e| e.to_string())?;
    }
    let file_path = fake_data_dir.join(format!("{}_fake.json", date));
    let final_daily = if file_path.exists() {
        let existing_content = fs::read_to_string(&file_path).unwrap_or_default();
        if let Ok(mut existing_daily) =
            serde_json::from_str::<crate::commands::types::DailyData>(&existing_content)
        {
            for (exe, app_data) in &daily.apps {
                existing_daily.apps.insert(exe.clone(), app_data.clone());
            }
            existing_daily
        } else {
            daily.clone()
        }
    } else {
        daily.clone()
    };
    let json = serde_json::to_string_pretty(&final_daily).map_err(|e| e.to_string())?;
    fs::write(&file_path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn validate_import(
    app: AppHandle,
    archive_path: String,
) -> Result<ImportValidation, String> {
    run_app_blocking(app, move |app| {
        validate_import_path(&archive_path)?;
        let content = fs::read_to_string(&archive_path).map_err(|e| e.to_string())?;
        let archive: ExportArchive = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        let conn = db::get_connection(&app)?;

        let mut existing_projects: HashSet<String> = HashSet::new();
        let mut stmt = conn
            .prepare_cached("SELECT name FROM projects")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let name = row.map_err(|e| format!("Failed to read existing project row: {}", e))?;
            existing_projects.insert(name);
        }

        let mut existing_apps: HashSet<String> = HashSet::new();
        let mut stmt = conn
            .prepare_cached("SELECT executable_name FROM applications")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let exe = row.map_err(|e| format!("Failed to read existing application row: {}", e))?;
            existing_apps.insert(exe);
        }

        let mut missing_projects = Vec::new();
        let mut missing_applications = Vec::new();
        let mut overlapping_sessions = Vec::new();
        let app_exe_by_id: HashMap<i64, String> = archive
            .data
            .applications
            .iter()
            .map(|a| (a.id, a.executable_name.clone()))
            .collect();

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

        // Check Overlapping Sessions in one DB pass:
        // stage archive sessions into a TEMP table and join with local sessions.
        if !archive.data.sessions.is_empty() {
            conn.execute_batch(
                "CREATE TEMP TABLE IF NOT EXISTS _tf_import_session_probe (
                 executable_name TEXT NOT NULL,
                 start_time TEXT NOT NULL,
                 end_time TEXT NOT NULL
             );
             DELETE FROM _tf_import_session_probe;",
            )
            .map_err(|e| e.to_string())?;

            {
                let mut insert_probe = conn
                .prepare_cached(
                    "INSERT INTO _tf_import_session_probe (executable_name, start_time, end_time)
                     VALUES (?1, ?2, ?3)",
                )
                .map_err(|e| e.to_string())?;
                for s in &archive.data.sessions {
                    if let Some(exe) = app_exe_by_id.get(&s.app_id) {
                        insert_probe
                            .execute(rusqlite::params![exe, s.start_time, s.end_time])
                            .map_err(|e| e.to_string())?;
                    }
                }
            }

            let mut overlap_stmt = conn
                .prepare_cached(
                    "SELECT
                     i.start_time,
                     i.end_time,
                     s.start_time,
                     s.end_time,
                     COALESCE(a.display_name, a.executable_name) AS app_name
                 FROM _tf_import_session_probe i
                 JOIN applications a
                   ON a.executable_name = i.executable_name
                 JOIN sessions s
                   ON s.app_id = a.id
                  AND i.start_time < s.end_time
                  AND i.end_time > s.start_time
                 LIMIT 11",
                )
                .map_err(|e| e.to_string())?;
            let rows = overlap_stmt
                .query_map([], |row| {
                    Ok(SessionConflict {
                        app_name: row.get(4)?,
                        start: row.get(0)?,
                        end: row.get(1)?,
                        existing_start: row.get(2)?,
                        existing_end: row.get(3)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            for row in rows {
                overlapping_sessions
                    .push(row.map_err(|e| format!("Failed to read overlap conflict row: {}", e))?);
                if overlapping_sessions.len() > 10 {
                    break;
                }
            }

            conn.execute("DELETE FROM _tf_import_session_probe", [])
                .map_err(|e| e.to_string())?;
        }

        Ok(ImportValidation {
            valid: missing_projects.is_empty()
                && missing_applications.is_empty()
                && overlapping_sessions.is_empty(),
            missing_projects,
            missing_applications,
            overlapping_sessions,
        })
    })
    .await
}

#[tauri::command]
pub async fn import_data(app: AppHandle, archive_path: String) -> Result<ImportSummary, String> {
    run_app_blocking(app, move |app| {
        validate_import_path(&archive_path)?;
        let content = fs::read_to_string(&archive_path).map_err(|e| e.to_string())?;
        let archive: ExportArchive = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        let mut conn = db::get_connection(&app)?;

        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let summary = import_archive_into_tx(&tx, &archive, false, &app)?;
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
    })
    .await
}

/// Import archive data into a transaction (shared logic for import_data and import_data_archive).
/// When `clear_before_import` is true, all synchronized tables are wiped first (online sync mode).
fn import_archive_into_tx(
    tx: &rusqlite::Transaction<'_>,
    archive: &ExportArchive,
    clear_before_import: bool,
    app: &AppHandle,
) -> Result<ImportSummary, String> {
    let mut summary = ImportSummary {
        projects_created: 0,
        apps_created: 0,
        sessions_imported: 0,
        sessions_merged: 0,
        daily_files_imported: 0,
    };

    // --- Safety: snapshot counts before any changes ---
    let sessions_before: i64 = tx
        .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
        .unwrap_or(0);
    let projects_before: i64 = tx
        .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
        .unwrap_or(0);

    // --- Clear synchronized tables (online sync only) ---
    if clear_before_import {
        tx.execute_batch(
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
             DELETE FROM assignment_model_state
               WHERE key NOT IN (
                 'mode',
                 'min_confidence_suggest',
                 'min_confidence_auto',
                 'min_evidence_auto',
                 'feedback_weight',
                 'cooldown_until'
               );",
        )
        .map_err(|e| format!("Failed to clear tables before sync import: {}", e))?;
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
                    let parts: Vec<&str> = key.split('|').collect();
                    if parts.len() == 3 {
                        let start_time = parts[1];
                        let title = parts[2];
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

    // 1. Map and Create Projects
    let mut existing_projects_map: HashMap<String, i64> = HashMap::new();
    {
        let mut stmt = tx
            .prepare("SELECT name, id FROM projects")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (name, id) =
                row.map_err(|e| format!("Failed to read local project mapping row: {}", e))?;
            existing_projects_map.insert(name.trim().to_lowercase(), id);
        }
    }

    let mut project_mapping = HashMap::new();
    for p in &archive.data.projects {
        let project_key = p.name.trim().to_lowercase();
        let local_id = existing_projects_map.get(&project_key).copied();

        let id = if let Some(id) = local_id {
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
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (exe, display_name, id) =
                row.map_err(|e| format!("Failed to read local application mapping row: {}", e))?;
            existing_apps_map.insert(exe.trim().to_lowercase(), id);
            existing_apps_display_map.insert(display_name.trim().to_lowercase(), id);
        }
    }

    let mut app_mapping = HashMap::new();
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

            let merged = merge_or_insert_session(tx, local_app_id, &incoming)?;
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
    let demo_mode = db::is_demo_mode_enabled(app)?;
    for (date, daily) in &archive.data.daily_files {
        if demo_mode {
            save_demo_daily_file(date, daily)?;
        } else {
            let final_daily = if let Some(mut existing_daily) = daily_store_bridge::load_day(date)? {
                for (exe, app_data) in &daily.apps {
                    existing_daily.apps.insert(exe.clone(), app_data.clone());
                }
                existing_daily
            } else {
                daily.clone()
            };
            daily_store_bridge::save_day(&final_daily)?;
        }
        summary.daily_files_imported += 1;
    }

    // --- Safety: pre-commit validation (online sync only) ---
    // If we had data before and the import produced nothing, abort.
    if clear_before_import {
        let sessions_after: i64 = tx
            .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap_or(0);
        let projects_after: i64 = tx
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap_or(0);

        if sessions_before > 10 && sessions_after == 0 {
            return Err(format!(
                "Sync safety check failed: had {} sessions before sync but 0 after import. \
                 Aborting to prevent data loss. The server payload may be empty or corrupt.",
                sessions_before
            ));
        }
        if projects_before > 3 && projects_after == 0 {
            return Err(format!(
                "Sync safety check failed: had {} projects before sync but 0 after import. \
                 Aborting to prevent data loss.",
                projects_before
            ));
        }

        log::info!(
            "Sync import pre-commit check OK: sessions {}→{}, projects {}→{}",
            sessions_before,
            sessions_after,
            projects_before,
            projects_after
        );
    }

    Ok(summary)
}

#[tauri::command]
pub async fn import_data_archive(
    app: AppHandle,
    archive: ExportArchive,
) -> Result<ImportSummary, String> {
    // Backup as extra safety net (kept even if tx approach works)
    let backup_path =
        run_app_blocking(app.clone(), move |app| create_sync_restore_backup(&app)).await?;

    // CRITICAL: DELETE + import in a SINGLE transaction.
    // If anything fails, SQLite automatically rolls back — no data loss.
    let result = run_app_blocking(app.clone(), move |app| {
        let mut conn = db::get_connection(&app)?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        let summary = import_archive_into_tx(&tx, &archive, true, &app)?;

        tx.commit()
            .map_err(|e| format!("Failed to commit sync import transaction: {}", e))?;

        // Post-commit: reapply overrides and retrain model
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
        if let Err(e) = super::assignment_model::retrain_model_sync(&mut conn) {
            log::warn!("Auto-retrain after sync import failed: {}", e);
        }

        Ok(summary)
    })
    .await;

    match result {
        Ok(summary) => {
            // Success — remove backup
            let _ = fs::remove_file(&backup_path);
            Ok(summary)
        }
        Err(e) => {
            // Transaction rolled back automatically — data intact.
            // Keep backup file for manual recovery just in case.
            log::error!(
                "Sync import transaction failed (auto-rolled-back, data intact): {}. Backup kept at: {}",
                e,
                backup_path.display()
            );
            Err(format!(
                "Sync import failed (data preserved, nothing was deleted): {}",
                e
            ))
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
