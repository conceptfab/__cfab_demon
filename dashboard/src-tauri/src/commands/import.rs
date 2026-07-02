use std::collections::HashSet;
use tauri::AppHandle;

use super::helpers::{run_app_blocking, run_db_blocking, timeflow_data_dir, validate_import_path};
use super::monitored::monitored_exe_name_set;
use super::projects::{ensure_app_project_from_file_hint, load_project_folders_from_db};
use super::types::{
    ArchivedFileInfo, AutoImportResult, DailyData, DateRange, DetectedProject, ImportResult,
    ImportedFileInfo,
};
use crate::commands::error::CommandError;
use crate::db;

fn mode_import_dir(base_dir: &std::path::Path, demo_mode: bool) -> std::path::PathBuf {
    if demo_mode {
        base_dir.join("import_demo")
    } else {
        base_dir.join("import")
    }
}

fn mode_archive_dir(base_dir: &std::path::Path, demo_mode: bool) -> std::path::PathBuf {
    if demo_mode {
        base_dir.join("archive_demo")
    } else {
        base_dir.join("archive")
    }
}

fn normalize_file_path(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "(unknown)".to_string();
    }
    let mut normalized = trimmed.replace('\\', "/");
    while normalized.contains("//") {
        normalized = normalized.replace("//", "/");
    }
    let normalized = normalized.trim();
    if normalized.is_empty() {
        "(unknown)".to_string()
    } else {
        normalized.to_string()
    }
}

#[tauri::command]
pub async fn import_json_files(
    app: AppHandle,
    file_paths: Vec<String>,
) -> Result<Vec<ImportResult>, CommandError> {
    run_db_blocking(app, move |conn| {
        let mut results = Vec::new();

        for path in &file_paths {
            if let Err(e) = validate_import_path(path) {
                results.push(ImportResult {
                    file_path: path.clone(),
                    success: false,
                    records_imported: 0,
                    error: Some(e),
                });
                continue;
            }
            results.push(import_single_file(conn, path));
        }

        Ok(results)
    })
    .await
    .map_err(CommandError::Other)
}

/// Checks if a file path corresponds to today's data file.
pub(crate) fn is_today_data_file(file_path: &str) -> bool {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    if let Some(name) = std::path::Path::new(file_path).file_name() {
        let name_str = name.to_string_lossy();
        if let Some(stem) = name_str.strip_suffix(".json") {
            return stem == today;
        }
    }
    false
}

fn is_fake_named_json_file(path: &std::path::Path) -> bool {
    path.file_name()
        .map(|n| n.to_string_lossy().to_lowercase().contains("fake"))
        .unwrap_or(false)
}

pub(crate) fn import_single_file(conn: &mut rusqlite::Connection, file_path: &str) -> ImportResult {
    let is_today = is_today_data_file(file_path);

    if !is_today {
        let already: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM imported_files WHERE file_path = ?1",
                [file_path],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if already {
            return ImportResult {
                file_path: file_path.to_string(),
                success: false,
                records_imported: 0,
                error: Some("File already imported".to_string()),
            };
        }
    }

    let content = match std::fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(e) => {
            return ImportResult {
                file_path: file_path.to_string(),
                success: false,
                records_imported: 0,
                error: Some(format!("Cannot read file: {}", e)),
            };
        }
    };

    let daily: DailyData = match serde_json::from_str(&content) {
        Ok(d) => d,
        Err(e) => {
            let error = if looks_like_export_archive(&content) {
                "This is a TIMEFLOW export archive (timeflow-export-*.json). Import it on the Data page using the Data Import panel.".to_string()
            } else {
                format!("Invalid JSON: {}", e)
            };
            return ImportResult {
                file_path: file_path.to_string(),
                success: false,
                records_imported: 0,
                error: Some(error),
            };
        }
    };

    let session_count = upsert_daily_data(conn, &daily);

    if !is_today {
        if let Err(e) = conn.execute(
            "INSERT OR IGNORE INTO imported_files (file_path, records_count) VALUES (?1, ?2)",
            rusqlite::params![file_path, session_count],
        ) {
            log::warn!("Failed to mark imported file '{}': {}", file_path, e);
        }
    }

    ImportResult {
        file_path: file_path.to_string(),
        success: true,
        records_imported: session_count,
        error: None,
    }
}

/// Core upsert logic shared by import and refresh_today.
/// Rozpoznaje archiwum eksportu (timeflow-export-*.json) po zawartości,
/// żeby zamiast błędu parsowania pokazać użytkownikowi właściwą ścieżkę importu.
pub(crate) fn looks_like_export_archive(content: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(content)
        .map(|v| v.get("export_type").is_some() && v.get("data").is_some())
        .unwrap_or(false)
}

pub(crate) fn upsert_daily_data(conn: &mut rusqlite::Connection, daily: &DailyData) -> usize {
    let monitored_exes = match monitored_exe_name_set(conn) {
        Ok(v) => v,
        Err(e) => {
            log::warn!(
                "Failed to load monitored apps from database, import filter disabled for this run: {}",
                e
            );
            HashSet::new()
        }
    };
    let filter_enabled = !monitored_exes.is_empty();

    let tx = match conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate) {
        Ok(tx) => tx,
        Err(e) => {
            log::error!("Failed to start transaction for upsert_daily_data: {}", e);
            return 0;
        }
    };

    let mut session_count = 0;
    let project_roots = load_project_folders_from_db(&tx).unwrap_or_default();

    let mut app_insert_stmt = match tx.prepare_cached(
        "INSERT OR IGNORE INTO applications (executable_name, display_name) VALUES (?1, ?2)",
    ) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to prepare app insert: {}", e);
            return 0;
        }
    };
    let mut app_select_stmt =
        match tx.prepare_cached("SELECT id FROM applications WHERE executable_name = ?1") {
            Ok(s) => s,
            Err(e) => {
                log::error!("Failed to prepare app select: {}", e);
                return 0;
            }
        };
    // Only inherit project_id from the application when that project is
    // still active — excluded or frozen projects must never receive new
    // sessions via Layer 1 app-project inheritance.
    let mut app_project_stmt = match tx.prepare_cached(
        "SELECT a.project_id
         FROM applications a
         JOIN projects p ON p.id = a.project_id
         WHERE a.id = ?1
           AND p.excluded_at IS NULL
           AND p.frozen_at IS NULL",
    ) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to prepare app project select: {}", e);
            return 0;
        }
    };
    // Extend-only upsert: the daemon only ever grows its currently-open slice,
    // so a stored end_time/duration LARGER than the incoming one means the row
    // was extended by a session rebuild (chain merged into this survivor, the
    // merged rows are is_hidden=1). Overwriting with the raw daemon slice used
    // to silently drop the whole merged chain's time from every view
    // (Metro_PAGE incident, 2026-06-10).
    let mut session_stmt = match tx.prepare_cached(
        "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, project_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(app_id, start_time) DO UPDATE SET
           end_time = CASE
               WHEN sessions.split_source_session_id IS NOT NULL THEN sessions.end_time
               WHEN julianday(excluded.end_time) > julianday(sessions.end_time) THEN excluded.end_time
               ELSE sessions.end_time
           END,
           duration_seconds = CASE
               WHEN sessions.split_source_session_id IS NOT NULL THEN sessions.duration_seconds
               ELSE MAX(sessions.duration_seconds, excluded.duration_seconds)
           END,
           is_hidden = sessions.is_hidden",
    ) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to prepare session upsert: {}", e);
            return 0;
        }
    };
    let mut file_stmt = match tx.prepare_cached(
        "INSERT INTO file_activities (
            app_id, date, file_name, file_path, total_seconds, first_seen, last_seen,
            project_id, window_title, detected_path, title_history, activity_type, activity_spans
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(app_id, date, file_path) DO UPDATE SET
           file_name = excluded.file_name,
           total_seconds = excluded.total_seconds,
           first_seen = MIN(file_activities.first_seen, excluded.first_seen),
           last_seen = MAX(file_activities.last_seen, excluded.last_seen),
           project_id = COALESCE(excluded.project_id, file_activities.project_id),
           window_title = COALESCE(excluded.window_title, file_activities.window_title),
           detected_path = COALESCE(excluded.detected_path, file_activities.detected_path),
           title_history = COALESCE(excluded.title_history, file_activities.title_history),
           activity_type = COALESCE(excluded.activity_type, file_activities.activity_type),
           activity_spans = CASE
               WHEN excluded.activity_spans != '[]' THEN excluded.activity_spans
               ELSE file_activities.activity_spans
           END",
    ) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to prepare file upsert: {}", e);
            return 0;
        }
    };

    for (exe_name, app_data) in &daily.apps {
        let exe_lower = exe_name.to_lowercase();

        if let Err(e) = app_insert_stmt.execute(rusqlite::params![exe_name, app_data.display_name])
        {
            log::warn!("Failed to upsert application '{}': {}", exe_name, e);
            continue;
        }

        let app_id: i64 = match app_select_stmt.query_row([exe_name], |row| row.get(0)) {
            Ok(id) => id,
            Err(_) => continue,
        };

        // Layer 1: inherit project_id from application if assigned
        let app_project_id: Option<i64> = app_project_stmt
            .query_row([app_id], |row| row.get(0))
            .ok()
            .flatten();

        if filter_enabled && !monitored_exes.contains(&exe_lower) && app_project_id.is_none() {
            continue;
        }

        let min_session_dur = super::daemon::load_persisted_session_min_duration();

        for session in &app_data.sessions {
            if (session.duration_seconds as i64) < min_session_dur {
                continue;
            }

            let date = if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&session.start) {
                dt.format("%Y-%m-%d").to_string()
            } else {
                log::warn!(
                    "Skipping session with invalid RFC3339 start '{}' for app '{}'",
                    session.start,
                    exe_name
                );
                continue;
            };

            if let Err(e) = session_stmt.execute(rusqlite::params![
                app_id,
                session.start,
                session.end,
                session.duration_seconds,
                date,
                app_project_id
            ]) {
                log::warn!(
                    "Failed to upsert session for app_id {} start {}: {}",
                    app_id,
                    session.start,
                    e
                );
                continue;
            }

            session_count += 1;
        }

        let file_date = &daily.date;
        for file in &app_data.files {
            let detected_path_param: Option<&str> = file
                .detected_path
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let project_hint = detected_path_param.unwrap_or(&file.name);
            let file_project_id =
                ensure_app_project_from_file_hint(&tx, project_hint, &project_roots);
            let normalized_file_path = normalize_file_path(project_hint);
            let file_name = file.name.trim();
            let safe_file_name = if file_name.is_empty() {
                normalized_file_path.as_str()
            } else {
                file_name
            };

            let window_title_param: Option<&str> = if file.window_title.is_empty() {
                None
            } else {
                Some(&file.window_title)
            };
            let title_history_param = if file.title_history.is_empty() {
                None
            } else {
                serde_json::to_string(&file.title_history).ok()
            };
            let activity_type_param: Option<&str> = file
                .activity_type
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let activity_spans_param = if file.activity_spans.is_empty() {
                "[]".to_string()
            } else {
                serde_json::to_string(&file.activity_spans).unwrap_or_else(|_| "[]".to_string())
            };
            if let Err(e) = file_stmt.execute(rusqlite::params![
                app_id,
                file_date,
                safe_file_name,
                normalized_file_path,
                file.total_seconds,
                file.first_seen,
                file.last_seen,
                file_project_id,
                window_title_param,
                detected_path_param,
                title_history_param.as_deref(),
                activity_type_param,
                activity_spans_param
            ]) {
                log::warn!(
                    "Failed to upsert file activity for app_id {} file '{}': {}",
                    app_id,
                    file.name,
                    e
                );
                continue;
            }
        }
    }

    drop(app_insert_stmt);
    drop(app_select_stmt);
    drop(app_project_stmt);
    drop(session_stmt);
    drop(file_stmt);

    if let Err(e) = tx.commit() {
        log::error!("Failed to commit upsert_daily_data transaction: {}", e);
        return 0;
    }

    if filter_enabled {
        if let Err(e) = purge_unregistered_apps(conn, &monitored_exes) {
            log::warn!("Failed to purge unregistered applications: {}", e);
        }
    }

    session_count
}

fn purge_unregistered_apps(
    conn: &mut rusqlite::Connection,
    monitored_exes: &HashSet<String>,
) -> Result<(), String> {
    use crate::db_migrations::tombstone_triggers;

    if monitored_exes.is_empty() {
        return Ok(());
    }

    let mut exe_list: Vec<String> = monitored_exes.iter().cloned().collect();
    exe_list.sort();
    let placeholders = (1..=exe_list.len())
        .map(|i| format!("?{}", i))
        .collect::<Vec<_>>()
        .join(", ");
    // is_imported=1 marks data received via LAN sync — local housekeeping
    // must never touch it (root cause of the 2026-04-27 data loss).
    let unregistered_unassigned_clause = format!(
        "lower(executable_name) NOT IN ({}) AND project_id IS NULL AND COALESCE(is_imported, 0) = 0",
        placeholders
    );
    let params: Vec<&dyn rusqlite::types::ToSql> = exe_list
        .iter()
        .map(|s| s as &dyn rusqlite::types::ToSql)
        .collect();

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Purge is local cache cleanup, not a user deletion — disable tombstone
    // triggers for the DELETEs so they don't propagate to the peer via LAN
    // sync. DDL is transactional in SQLite: a rollback restores the triggers.
    tx.execute(tombstone_triggers::DROP_SESSIONS_TOMBSTONE_TRIGGER_SQL, [])
        .map_err(|e| e.to_string())?;
    tx.execute(
        tombstone_triggers::DROP_APPLICATIONS_TOMBSTONE_TRIGGER_SQL,
        [],
    )
    .map_err(|e| e.to_string())?;

    let delete_files_sql = format!(
        "DELETE FROM file_activities
         WHERE app_id IN (SELECT id FROM applications WHERE {})",
        unregistered_unassigned_clause
    );
    tx.execute(&delete_files_sql, params.as_slice())
        .map_err(|e| e.to_string())?;

    let delete_sessions_sql = format!(
        "DELETE FROM sessions
         WHERE app_id IN (SELECT id FROM applications WHERE {})",
        unregistered_unassigned_clause
    );
    tx.execute(&delete_sessions_sql, params.as_slice())
        .map_err(|e| e.to_string())?;

    let delete_apps_sql = format!(
        "DELETE FROM applications
         WHERE {}
           AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.app_id = applications.id)
           AND NOT EXISTS (SELECT 1 FROM file_activities fa WHERE fa.app_id = applications.id)",
        unregistered_unassigned_clause
    );
    let removed = tx
        .execute(&delete_apps_sql, params.as_slice())
        .map_err(|e| e.to_string())?;

    tx.execute(tombstone_triggers::SESSIONS_TOMBSTONE_TRIGGER_SQL, [])
        .map_err(|e| e.to_string())?;
    tx.execute(tombstone_triggers::APPLICATIONS_TOMBSTONE_TRIGGER_SQL, [])
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    if removed > 0 {
        log::info!(
            "Auto-pruned {} unregistered application row(s) from local database",
            removed
        );
    }

    Ok(())
}

#[tauri::command]
pub async fn get_imported_files(app: AppHandle) -> Result<Vec<ImportedFileInfo>, CommandError> {
    run_db_blocking(app, move |conn| {
        let mut stmt = conn
            .prepare_cached(
                "SELECT file_path, import_date, records_count FROM imported_files ORDER BY import_date DESC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(ImportedFileInfo {
                    file_path: row.get(0)?,
                    import_date: row.get::<_, String>(1).unwrap_or_default(),
                    records_count: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?;

        Ok(rows
            .filter_map(|r| r.map_err(|e| log::warn!("Row error: {}", e)).ok())
            .collect())
    })
    .await
    .map_err(CommandError::Other)
}

fn archive_json_file(
    json_path: &std::path::Path,
    archive_dir: &std::path::Path,
    path_for_logs: &str,
) -> Result<bool, String> {
    let Some(file_name) = json_path.file_name() else {
        return Ok(false);
    };
    let archive_path = archive_dir.join(file_name);
    match std::fs::rename(json_path, &archive_path) {
        Ok(_) => Ok(true),
        Err(rename_err) => match std::fs::copy(json_path, &archive_path) {
            Ok(_) => {
                if let Err(e) = std::fs::remove_file(json_path) {
                    log::warn!(
                        "Archived by copy but failed to remove source '{}': {}",
                        path_for_logs,
                        e
                    );
                }
                Ok(true)
            }
            Err(_) => Err(format!("Cannot archive {}: {}", path_for_logs, rename_err)),
        },
    }
}

#[tauri::command]
pub async fn auto_import_from_data_dir(app: AppHandle) -> Result<AutoImportResult, CommandError> {
    run_app_blocking(app, move |app| {
        let base_dir = timeflow_data_dir()?;
        let demo_mode = db::is_demo_mode_enabled(&app)?;
        let import_dir = mode_import_dir(&base_dir, demo_mode);
        let archive_dir = mode_archive_dir(&base_dir, demo_mode);

        if !import_dir.exists() {
            return Ok(AutoImportResult {
                files_found: 0,
                files_imported: 0,
                files_skipped: 0,
                files_archived: 0,
                errors: vec![],
            });
        }

        let mut json_files: Vec<std::path::PathBuf> = Vec::new();
        let mut found: Vec<std::path::PathBuf> = std::fs::read_dir(&import_dir)
            .map_err(|e| e.to_string())?
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|p| {
                p.extension().map(|e| e == "json").unwrap_or(false)
                    && !p
                        .file_name()
                        .map(|n| n.to_string_lossy().starts_with('.'))
                        .unwrap_or(false)
                    && (demo_mode || !is_fake_named_json_file(p))
            })
            .collect();
        json_files.append(&mut found);

        let files_found = json_files.len();
        log::info!(
            "Auto-import scan: import_dir='{}', files_found={}, mode={}",
            import_dir.display(),
            files_found,
            if demo_mode { "demo" } else { "primary" }
        );
        let mut conn = db::get_connection(&app)?;

        let mut files_imported = 0;
        let mut files_skipped = 0;
        let mut files_archived = 0;
        let mut errors = Vec::new();

        if !archive_dir.exists() {
            std::fs::create_dir_all(&archive_dir).map_err(|e| e.to_string())?;
        }

        for json_path in &json_files {
            let path_str = json_path.to_string_lossy().to_string();
            let result = import_single_file(&mut conn, &path_str);

            if result.success {
                files_imported += 1;

                if !is_today_data_file(&path_str) {
                    match archive_json_file(json_path, &archive_dir, &path_str) {
                        Ok(true) => files_archived += 1,
                        Ok(false) => {}
                        Err(e) => errors.push(e),
                    }
                }
            } else if let Some(ref err) = result.error {
                if err.contains("already imported") {
                    files_skipped += 1;
                    if !is_today_data_file(&path_str) {
                        if let Some(file_name) = json_path.file_name() {
                            let archive_path = archive_dir.join(file_name);
                            if !archive_path.exists() {
                                match archive_json_file(json_path, &archive_dir, &path_str) {
                                    Ok(true) => files_archived += 1,
                                    Ok(false) => {}
                                    Err(e) => errors.push(e),
                                }
                            }
                        }
                    }
                } else {
                    errors.push(format!("{}: {}", path_str, err));
                }
            }
        }

        log::info!(
            "Auto-import: found={}, imported={}, skipped={}, archived={}",
            files_found,
            files_imported,
            files_skipped,
            files_archived
        );

        Ok(AutoImportResult {
            files_found,
            files_imported,
            files_skipped,
            files_archived,
            errors,
        })
    })
    .await
    .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn get_archive_files(app: AppHandle) -> Result<Vec<ArchivedFileInfo>, CommandError> {
    run_app_blocking(app, move |app| {
        let base_dir = timeflow_data_dir()?;
        let demo_mode = db::is_demo_mode_enabled(&app)?;
        let archive_dir = mode_archive_dir(&base_dir, demo_mode);

        if !archive_dir.exists() {
            return Ok(Vec::new());
        }

        let mut files = Vec::new();
        for entry in std::fs::read_dir(&archive_dir).map_err(|e| e.to_string())? {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if !path.extension().map(|e| e == "json").unwrap_or(false) {
                continue;
            }
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let modified_at = meta
                .modified()
                .ok()
                .map(|t| chrono::DateTime::<chrono::Local>::from(t).to_rfc3339())
                .unwrap_or_default();
            let file_name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            files.push(ArchivedFileInfo {
                file_name,
                file_path: path.to_string_lossy().to_string(),
                modified_at,
                size_bytes: meta.len(),
            });
        }

        files.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
        Ok(files)
    })
    .await
    .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn delete_archive_file(app: AppHandle, file_name: String) -> Result<(), CommandError> {
    let safe_name = std::path::Path::new(&file_name)
        .file_name()
        .ok_or_else(|| CommandError::Validation("Invalid file name".to_string()))?
        .to_string_lossy()
        .to_string();
    if safe_name.is_empty() || safe_name != file_name {
        return Err(CommandError::Validation("Invalid file name".to_string()));
    }

    run_app_blocking(app, move |app| {
        let base_dir = timeflow_data_dir()?;
        let demo_mode = db::is_demo_mode_enabled(&app)?;
        let archive_dir = mode_archive_dir(&base_dir, demo_mode);
        let target = archive_dir.join(&safe_name);

        if !target.exists() {
            return Ok(());
        }
        std::fs::remove_file(target).map_err(|e| e.to_string())
    })
    .await
    .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn get_detected_projects(
    app: AppHandle,
    date_range: DateRange,
) -> Result<Vec<DetectedProject>, CommandError> {
    use super::projects::{infer_project_from_path_pub, project_name_is_blacklisted};

    run_db_blocking(app, move |conn| {
        let project_roots = load_project_folders_from_db(conn)?;
        if project_roots.is_empty() {
            return Ok(Vec::new());
        }

        // Collect existing project names (active + excluded) for filtering
        let existing_project_names: HashSet<String> = {
            let mut stmt = conn
                .prepare_cached("SELECT LOWER(name) FROM projects")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<HashSet<_>, _>>()
                .map_err(|e| format!("Failed to read projects: {}", e))?
        };

        let mut stmt = conn
            .prepare_cached(
                "SELECT
                    fa.file_name,
                    SUM(fa.total_seconds) as total_seconds,
                    COUNT(DISTINCT fa.date) as occurrence_count,
                    COALESCE(GROUP_CONCAT(DISTINCT a.display_name), '') as apps_csv,
                    MIN(fa.first_seen) as first_seen,
                    MAX(fa.last_seen) as last_seen
                 FROM file_activities fa
                 JOIN applications a ON a.id = fa.app_id
                 WHERE fa.date >= ?1 AND fa.date <= ?2
                 GROUP BY fa.file_name
                 HAVING occurrence_count > 1
                 ORDER BY total_seconds DESC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(rusqlite::params![date_range.start, date_range.end], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3).unwrap_or_default(),
                    row.get::<_, String>(4).unwrap_or_default(),
                    row.get::<_, String>(5).unwrap_or_default(),
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut seen_names = HashSet::new();
        let mut results = Vec::new();

        for row in rows {
            let (file_name, total_seconds, occurrence_count, apps_csv, first_seen, last_seen) =
                row.map_err(|e| format!("Row error: {}", e))?;

            // Only keep entries whose file_name resolves to a real project folder
            let project_name = match infer_project_from_path_pub(&file_name, &project_roots) {
                Some(name) => name,
                None => continue,
            };
            let key = project_name.to_lowercase();

            // Skip if already an existing project
            if existing_project_names.contains(&key) {
                continue;
            }
            // Skip blacklisted names
            if project_name_is_blacklisted(conn, &project_name) {
                continue;
            }
            // Skip duplicates (aggregate by project_name)
            if !seen_names.insert(key) {
                continue;
            }

            results.push(DetectedProject {
                file_name,
                project_name,
                total_seconds,
                occurrence_count,
                apps: apps_csv
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect(),
                first_seen,
                last_seen,
            });
        }

        Ok(results)
    })
    .await
    .map_err(CommandError::Other)
}

#[cfg(test)]
mod purge_tests {
    use super::purge_unregistered_apps;
    use crate::db_migrations::tombstone_triggers;
    use std::collections::HashSet;

    fn setup_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE applications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                executable_name TEXT NOT NULL UNIQUE,
                display_name TEXT,
                project_id INTEGER,
                is_imported INTEGER DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
            );
            CREATE TABLE sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                date TEXT NOT NULL
            );
            CREATE TABLE file_activities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id INTEGER NOT NULL,
                date TEXT NOT NULL,
                file_name TEXT NOT NULL,
                total_seconds INTEGER NOT NULL
            );
            CREATE TABLE tombstones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                table_name TEXT NOT NULL,
                record_id INTEGER,
                deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                sync_key TEXT
            );",
        )
        .expect("schema");
        conn.execute(tombstone_triggers::SESSIONS_TOMBSTONE_TRIGGER_SQL, [])
            .expect("sessions trigger");
        conn.execute(tombstone_triggers::APPLICATIONS_TOMBSTONE_TRIGGER_SQL, [])
            .expect("applications trigger");
        conn
    }

    fn insert_app(
        conn: &rusqlite::Connection,
        exe: &str,
        project_id: Option<i64>,
        is_imported: i64,
    ) -> i64 {
        conn.execute(
            "INSERT INTO applications (executable_name, display_name, project_id, is_imported)
             VALUES (?1, ?1, ?2, ?3)",
            rusqlite::params![exe, project_id, is_imported],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn insert_session(conn: &rusqlite::Connection, app_id: i64) {
        conn.execute(
            "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date)
             VALUES (?1, '2026-06-01T10:00:00+02:00', '2026-06-01T11:00:00+02:00', 3600, '2026-06-01')",
            [app_id],
        )
        .unwrap();
    }

    fn count(conn: &rusqlite::Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |row| row.get(0)).unwrap()
    }

    #[test]
    fn purge_spares_imported_apps() {
        let mut conn = setup_conn();
        let imported = insert_app(&conn, "peer-only.exe", None, 1);
        insert_session(&conn, imported);
        let local = insert_app(&conn, "local-stale.exe", None, 0);
        insert_session(&conn, local);

        let monitored: HashSet<String> = ["monitored.exe".to_string()].into_iter().collect();
        purge_unregistered_apps(&mut conn, &monitored).expect("purge");

        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM applications WHERE executable_name = 'peer-only.exe'"
            ),
            1,
            "app from sync (is_imported=1) must survive purge"
        );
        assert_eq!(
            count(
                &conn,
                &format!("SELECT COUNT(*) FROM sessions WHERE app_id = {imported}")
            ),
            1,
            "sessions of synced app must survive purge"
        );
        assert_eq!(
            count(
                &conn,
                &format!("SELECT COUNT(*) FROM sessions WHERE app_id = {local}")
            ),
            0,
            "local unmonitored app is still cleaned up as before"
        );
    }

    #[test]
    fn purge_creates_no_tombstones() {
        let mut conn = setup_conn();
        let local = insert_app(&conn, "local-stale.exe", None, 0);
        insert_session(&conn, local);

        let monitored: HashSet<String> = ["monitored.exe".to_string()].into_iter().collect();
        purge_unregistered_apps(&mut conn, &monitored).expect("purge");

        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM tombstones"),
            0,
            "purge is local housekeeping — it must not emit tombstones"
        );
        // Triggers must be recreated after purge:
        let trigger_count = count(
            &conn,
            "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger'
             AND name IN ('trg_sessions_tombstone','trg_applications_tombstone')",
        );
        assert_eq!(
            trigger_count, 2,
            "tombstone triggers must be restored after purge"
        );
        // ...and keep working:
        let app2 = insert_app(&conn, "user-deleted.exe", None, 0);
        insert_session(&conn, app2);
        conn.execute("DELETE FROM sessions WHERE app_id = ?1", [app2])
            .unwrap();
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM tombstones WHERE table_name='sessions'"
            ),
            1,
            "a regular DELETE outside purge still emits a tombstone"
        );
    }
}

#[cfg(test)]
mod upsert_tests {
    use super::upsert_daily_data;
    use crate::commands::daily_store::{StoredAppDailyData, StoredDailyData, StoredSession};
    use std::collections::BTreeMap;

    fn setup_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE projects (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                excluded_at TEXT,
                frozen_at TEXT
            );
            CREATE TABLE applications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                executable_name TEXT NOT NULL UNIQUE,
                display_name TEXT,
                project_id INTEGER,
                is_imported INTEGER DEFAULT 0
            );
            CREATE TABLE sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                date TEXT NOT NULL,
                project_id INTEGER,
                split_source_session_id INTEGER,
                is_hidden INTEGER,
                UNIQUE(app_id, start_time)
            );
            CREATE TABLE file_activities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id INTEGER NOT NULL,
                date TEXT NOT NULL,
                file_name TEXT NOT NULL,
                file_path TEXT DEFAULT '',
                total_seconds INTEGER NOT NULL,
                first_seen TEXT,
                last_seen TEXT,
                project_id INTEGER,
                window_title TEXT,
                detected_path TEXT,
                title_history TEXT,
                activity_type TEXT,
                activity_spans TEXT NOT NULL DEFAULT '[]',
                UNIQUE(app_id, date, file_path)
            );
            CREATE TABLE project_folders (
                path TEXT,
                added_at TEXT,
                color TEXT,
                category TEXT,
                badge TEXT
            );",
        )
        .expect("schema");
        conn
    }

    fn daily_with_session(exe: &str, start: &str, end: &str, dur: u64) -> StoredDailyData {
        let mut apps = BTreeMap::new();
        apps.insert(
            exe.to_string(),
            StoredAppDailyData {
                display_name: exe.to_string(),
                total_seconds: dur,
                sessions: vec![StoredSession {
                    start: start.to_string(),
                    end: end.to_string(),
                    duration_seconds: dur,
                }],
                files: vec![],
            },
        );
        StoredDailyData {
            date: "2026-06-10".to_string(),
            generated_at: String::new(),
            apps,
        }
    }

    fn session_row(conn: &rusqlite::Connection) -> (String, i64) {
        conn.query_row(
            "SELECT end_time, duration_seconds FROM sessions LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
    }

    /// Regression test for the Metro_PAGE incident (2026-06-10): rebuild
    /// merges a chain into a survivor (extending end_time/duration_seconds and
    /// hiding the merged rows), then the next refresh_today upsert used to
    /// RESET the survivor to the daemon's raw slice values while the merged
    /// rows stayed hidden — silently dropping the whole chain's time from
    /// every view. The upsert must never shrink an existing session.
    #[test]
    fn upsert_does_not_shrink_rebuilt_survivor() {
        let mut conn = setup_conn();
        let daily = daily_with_session(
            "figma.exe",
            "2026-06-10T15:04:50+02:00",
            "2026-06-10T15:28:49+02:00",
            1439,
        );
        upsert_daily_data(&mut conn, &daily);

        // Simulate a rebuild merge: survivor extended over the hidden chain.
        conn.execute(
            "UPDATE sessions SET end_time = '2026-06-10T17:05:48+02:00', duration_seconds = 6978",
            [],
        )
        .unwrap();

        // Daemon re-sends the raw slice — must NOT shrink the survivor.
        upsert_daily_data(&mut conn, &daily);

        let (end_time, duration) = session_row(&conn);
        assert_eq!(
            end_time, "2026-06-10T17:05:48+02:00",
            "refresh upsert must not revert a rebuild-extended end_time"
        );
        assert_eq!(
            duration, 6978,
            "refresh upsert must not revert a rebuild-extended duration"
        );
    }

    #[test]
    fn upsert_still_extends_session_with_newer_daemon_data() {
        let mut conn = setup_conn();
        upsert_daily_data(
            &mut conn,
            &daily_with_session(
                "figma.exe",
                "2026-06-10T15:04:50+02:00",
                "2026-06-10T15:28:49+02:00",
                1439,
            ),
        );

        // Daemon extends the still-open slice (same start, later end):
        upsert_daily_data(
            &mut conn,
            &daily_with_session(
                "figma.exe",
                "2026-06-10T15:04:50+02:00",
                "2026-06-10T15:40:00+02:00",
                2110,
            ),
        );

        let (end_time, duration) = session_row(&conn);
        assert_eq!(end_time, "2026-06-10T15:40:00+02:00");
        assert_eq!(duration, 2110);
    }
}
