use std::collections::HashSet;
use tauri::AppHandle;

use super::helpers::timeflow_data_dir;
use super::monitored::monitored_exe_name_set;
use super::projects::{ensure_app_project_from_file_hint, load_project_folders_from_db};
use super::types::{
    ArchivedFileInfo, AutoImportResult, DailyData, DateRange, DetectedProject, ImportResult,
    ImportedFileInfo,
};
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

#[tauri::command]
pub async fn import_json_files(
    app: AppHandle,
    file_paths: Vec<String>,
) -> Result<Vec<ImportResult>, String> {
    let mut conn = db::get_connection(&app)?;
    let mut results = Vec::new();

    for path in &file_paths {
        results.push(import_single_file(&mut conn, path));
    }

    Ok(results)
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
            return ImportResult {
                file_path: file_path.to_string(),
                success: false,
                records_imported: 0,
                error: Some(format!("Invalid JSON: {}", e)),
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
    let mut app_project_stmt = match tx.prepare_cached(
        "SELECT project_id FROM applications WHERE id = ?1",
    ) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to prepare app project select: {}", e);
            return 0;
        }
    };
    let mut session_stmt = match tx.prepare_cached(
        "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, project_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(app_id, start_time) DO UPDATE SET
           end_time = excluded.end_time,
           duration_seconds = excluded.duration_seconds,
           is_hidden = sessions.is_hidden",
    ) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to prepare session upsert: {}", e);
            return 0;
        }
    };
    let mut file_stmt = match tx.prepare_cached(
        "INSERT INTO file_activities (app_id, date, file_name, total_seconds, first_seen, last_seen, project_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(app_id, date, file_name) DO UPDATE SET
           total_seconds = excluded.total_seconds,
           first_seen = MIN(file_activities.first_seen, excluded.first_seen),
           last_seen = MAX(file_activities.last_seen, excluded.last_seen),
           project_id = COALESCE(excluded.project_id, file_activities.project_id)",
    ) {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to prepare file upsert: {}", e);
            return 0;
        }
    };

    for (exe_name, app_data) in &daily.apps {
        let exe_lower = exe_name.to_lowercase();
        if filter_enabled && !monitored_exes.contains(&exe_lower) {
            continue;
        }

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

        for session in &app_data.sessions {
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
            let file_project_id =
                ensure_app_project_from_file_hint(&tx, &file.name, &project_roots);

            if let Err(e) = file_stmt.execute(rusqlite::params![
                app_id,
                file_date,
                file.name,
                file.total_seconds,
                file.first_seen,
                file.last_seen,
                file_project_id
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
    if monitored_exes.is_empty() {
        return Ok(());
    }

    let mut exe_list: Vec<String> = monitored_exes.iter().cloned().collect();
    exe_list.sort();
    let placeholders = (1..=exe_list.len())
        .map(|i| format!("?{}", i))
        .collect::<Vec<_>>()
        .join(", ");
    let unregistered_unassigned_clause = format!(
        "lower(executable_name) NOT IN ({}) AND project_id IS NULL",
        placeholders
    );
    let params: Vec<&dyn rusqlite::types::ToSql> = exe_list
        .iter()
        .map(|s| s as &dyn rusqlite::types::ToSql)
        .collect();

    let tx = conn.transaction().map_err(|e| e.to_string())?;

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
pub async fn check_file_imported(app: AppHandle, file_path: String) -> Result<bool, String> {
    let conn = db::get_connection(&app)?;
    conn.query_row(
        "SELECT COUNT(*) > 0 FROM imported_files WHERE file_path = ?1",
        [&file_path],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_imported_files(app: AppHandle) -> Result<Vec<ImportedFileInfo>, String> {
    let conn = db::get_connection(&app)?;
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
pub async fn auto_import_from_data_dir(app: AppHandle) -> Result<AutoImportResult, String> {
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
}

#[tauri::command]
pub async fn get_archive_files(app: AppHandle) -> Result<Vec<ArchivedFileInfo>, String> {
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
}

#[tauri::command]
pub async fn delete_archive_file(app: AppHandle, file_name: String) -> Result<(), String> {
    let safe_name = std::path::Path::new(&file_name)
        .file_name()
        .ok_or_else(|| "Invalid file name".to_string())?
        .to_string_lossy()
        .to_string();
    if safe_name.is_empty() || safe_name != file_name {
        return Err("Invalid file name".to_string());
    }

    let base_dir = timeflow_data_dir()?;
    let demo_mode = db::is_demo_mode_enabled(&app)?;
    let archive_dir = mode_archive_dir(&base_dir, demo_mode);
    let target = archive_dir.join(&safe_name);

    if !target.exists() {
        return Ok(());
    }
    std::fs::remove_file(target).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_detected_projects(
    app: AppHandle,
    date_range: DateRange,
) -> Result<Vec<DetectedProject>, String> {
    let conn = db::get_connection(&app)?;

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
            Ok(DetectedProject {
                file_name: row.get(0)?,
                total_seconds: row.get(1)?,
                occurrence_count: row.get(2)?,
                apps: row
                    .get::<_, String>(3)
                    .unwrap_or_default()
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect(),
                first_seen: row.get::<_, String>(4).unwrap_or_default(),
                last_seen: row.get::<_, String>(5).unwrap_or_default(),
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows
        .filter_map(|r| r.map_err(|e| log::warn!("Row error: {}", e)).ok())
        .collect())
}
