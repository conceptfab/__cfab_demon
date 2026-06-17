use super::helpers::{run_app_blocking, run_db_blocking, timeflow_data_dir};
use crate::db;
use chrono::{DateTime, Local};
use rusqlite::OpenFlags;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tauri::AppHandle;

#[derive(Serialize)]
pub struct BackupFile {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub modified_at: String,
}

#[derive(Serialize)]
pub struct DbInfo {
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Serialize, Deserialize)]
pub struct DatabaseSettings {
    pub vacuum_on_startup: bool,
    pub backup_enabled: bool,
    pub backup_path: String,
    pub backup_interval_days: i32,
    pub last_backup_at: Option<String>,
    pub auto_optimize_enabled: bool,
    pub auto_optimize_interval_hours: i32,
    pub last_optimize_at: Option<String>,
}

fn load_database_settings(app: &AppHandle) -> Result<DatabaseSettings, String> {
    let conn = db::get_connection(app)?;
    let mut stmt = conn
        .prepare(
            "SELECT key, value
             FROM system_settings
             WHERE key IN (
                'vacuum_on_startup',
                'backup_enabled',
                'backup_path',
                'backup_interval_days',
                'last_backup_at',
                'auto_optimize_enabled',
                'auto_optimize_interval_hours',
                'last_optimize_at'
             )",
        )
        .map_err(|e| format!("Failed to prepare database settings query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("Failed to query database settings: {}", e))?;

    let settings: HashMap<String, String> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read database settings: {}", e))?
        .into_iter()
        .collect();

    let setting = |key: &str| settings.get(key).map(String::as_str);

    let vacuum_on_startup = setting("vacuum_on_startup")
        .map(|v| v == "true")
        .unwrap_or(false);

    let backup_enabled = setting("backup_enabled")
        .map(|v| v == "true")
        .unwrap_or(false);

    let backup_path = setting("backup_path").unwrap_or_default().to_string();

    let backup_interval_days = setting("backup_interval_days")
        .and_then(|v| v.parse().ok())
        .unwrap_or(7);

    let last_backup_at = setting("last_backup_at").map(str::to_string);

    let auto_optimize_enabled = setting("auto_optimize_enabled")
        .map(|v| v == "true")
        .unwrap_or(true);

    let auto_optimize_interval_hours = setting("auto_optimize_interval_hours")
        .and_then(|v| v.parse().ok())
        .unwrap_or(24);

    let last_optimize_at = setting("last_optimize_at").map(str::to_string);

    log::info!(
        "Loaded database settings: vacuum={}, backup={}, backup_interval_days={}, auto_optimize={}, auto_optimize_interval_hours={}",
        vacuum_on_startup,
        backup_enabled,
        backup_interval_days,
        auto_optimize_enabled,
        auto_optimize_interval_hours
    );

    Ok(DatabaseSettings {
        vacuum_on_startup,
        backup_enabled,
        backup_path,
        backup_interval_days,
        last_backup_at,
        auto_optimize_enabled,
        auto_optimize_interval_hours,
        last_optimize_at,
    })
}

#[tauri::command]
pub async fn get_db_info(app: AppHandle) -> Result<DbInfo, String> {
    run_app_blocking(app, move |app| {
        let status = db::get_demo_mode_status(&app)?;
        let path = status.active_db_path;
        let meta = fs::metadata(&path).map_err(|e| format!("Failed to read DB metadata: {}", e))?;

        Ok(DbInfo {
            path,
            size_bytes: meta.len(),
        })
    })
    .await
}

#[tauri::command]
pub async fn vacuum_database(app: AppHandle) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
        conn.execute_batch("VACUUM;")
            .map_err(|e| format!("VACUUM failed: {}", e))?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn get_database_settings(app: AppHandle) -> Result<DatabaseSettings, String> {
    run_app_blocking(app, move |app| load_database_settings(&app)).await
}

#[tauri::command]
pub async fn update_database_settings(
    app: AppHandle,
    vacuum_on_startup: bool,
    backup_enabled: bool,
    backup_path: String,
    backup_interval_days: i32,
    auto_optimize_enabled: bool,
    auto_optimize_interval_hours: i32,
) -> Result<(), String> {
    let normalized_auto_optimize_interval_hours = auto_optimize_interval_hours.clamp(1, 24 * 30);
    log::info!("Updating database settings: vacuum={}, backup={}, backup_interval_days={}, auto_optimize={}, auto_optimize_interval_hours={}",
        vacuum_on_startup, backup_enabled, backup_interval_days, auto_optimize_enabled, normalized_auto_optimize_interval_hours);

    run_app_blocking(app, move |app| {
        let conn = db::get_connection(&app)?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

        db::set_system_setting_conn(&tx, "vacuum_on_startup", &vacuum_on_startup.to_string())?;
        db::set_system_setting_conn(&tx, "backup_enabled", &backup_enabled.to_string())?;
        db::set_system_setting_conn(&tx, "backup_path", &backup_path)?;
        db::set_system_setting_conn(&tx, "backup_interval_days", &backup_interval_days.to_string())?;
        db::set_system_setting_conn(&tx, "auto_optimize_enabled", &auto_optimize_enabled.to_string())?;
        db::set_system_setting_conn(&tx, "auto_optimize_interval_hours", &normalized_auto_optimize_interval_hours.to_string())?;

        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn optimize_database(app: AppHandle) -> Result<(), String> {
    run_db_blocking(app, move |conn| db::optimize_database_internal(conn)).await
}

#[tauri::command]
pub async fn perform_manual_backup(app: AppHandle) -> Result<String, String> {
    run_app_blocking(app, move |app| {
        let settings = load_database_settings(&app)?;
        if settings.backup_path.is_empty() {
            return Err("Backup path is not configured".to_string());
        }

        let conn = db::get_connection(&app)?;
        let result = db::perform_backup_internal(&conn, &settings.backup_path)?;

        let now = chrono::Local::now().to_rfc3339();
        db::set_system_setting(&app, "last_backup_at", &now)?;

        Ok(result)
    })
    .await
}

#[tauri::command]
pub async fn open_db_folder(app: AppHandle) -> Result<(), String> {
    run_app_blocking(app, move |app| {
        let status = db::get_demo_mode_status(&app)?;
        let path = Path::new(&status.active_db_path);
        let folder = path.parent().ok_or("Invalid DB path")?;

        #[cfg(target_os = "windows")]
        {
            use std::process::Command;
            Command::new("explorer")
                .arg(folder)
                .spawn()
                .map_err(|e| e.to_string())?;
        }

        #[cfg(target_os = "macos")]
        {
            use std::process::Command;
            Command::new("open")
                .arg(folder)
                .spawn()
                .map_err(|e| e.to_string())?;
        }

        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        let _ = folder;

        Ok(())
    })
    .await
}

pub fn restore_database_from_file_internal(app: &AppHandle, path: &str) -> Result<(), String> {
    let src = Path::new(&path);
    if !src.exists() {
        return Err("Source file does not exist".to_string());
    }

    let status = db::get_demo_mode_status(app)?;
    let dest = Path::new(&status.active_db_path);
    if src == dest {
        return Err("Source file matches the active database path".to_string());
    }

    let mut conn = db::get_connection(app)?;
    restore_database_into_conn(&mut conn, path)
}

/// Rdzeń restore: czyści CAŁĄ bazę docelową (także tabele nieobecne w backupie)
/// i odtwarza zawartość z pliku. Restore = replace, nigdy merge.
pub(crate) fn restore_database_into_conn(
    conn: &mut rusqlite::Connection,
    path: &str,
) -> Result<(), String> {
    let src = Path::new(path);
    // Validate source DB first.
    let src_conn = rusqlite::Connection::open_with_flags(src, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open source database: {}", e))?;
    let integrity: String = src_conn
        .query_row("PRAGMA integrity_check(1)", [], |row| row.get(0))
        .map_err(|e| format!("Failed to validate source database: {}", e))?;
    if !integrity.eq_ignore_ascii_case("ok") {
        return Err(format!(
            "Source database integrity check failed: {}",
            integrity
        ));
    }
    drop(src_conn);

    // Restore by copying table contents through SQLite itself instead of overwriting
    // the active file. This avoids corruption risks on open/locked DB files.
    conn.execute_batch("PRAGMA foreign_keys = OFF;")
        .map_err(|e| format!("Failed to disable foreign keys: {}", e))?;

    // Collect and drop all triggers before restore to prevent interference
    // (e.g. blacklist triggers blocking project inserts, tombstone triggers
    // creating spurious records during DELETE phase).
    let trigger_defs: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT name, sql FROM main.sqlite_master
                 WHERE type = 'trigger' AND sql IS NOT NULL
                 ORDER BY name",
            )
            .map_err(|e| format!("Failed to enumerate triggers: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("Failed to read trigger list: {}", e))?;
        rows.filter_map(|r| r.ok()).collect()
    };
    for (trigger_name, _) in &trigger_defs {
        let quoted = trigger_name.replace('"', "\"\"");
        conn.execute_batch(&format!("DROP TRIGGER IF EXISTS \"{}\";", quoted))
            .map_err(|e| format!("Failed to drop trigger '{}': {}", trigger_name, e))?;
    }

    let result = (|| -> Result<(), String> {
        conn.execute("ATTACH DATABASE ?1 AS restore_src", [path])
            .map_err(|e| format!("Failed to attach source database: {}", e))?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        // Enumerate tables from source backup.
        let tables: Vec<String> = {
            let mut stmt = tx
                .prepare(
                    "SELECT name
                     FROM restore_src.sqlite_master
                     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                     ORDER BY name",
                )
                .map_err(|e| format!("Failed to enumerate source tables: {}", e))?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| format!("Failed to read source table list: {}", e))?;
            rows.filter_map(|row| row.ok()).collect()
        };

        // Restore = REPLACE, not merge: destination tables that do not exist in
        // the (often older-schema) backup must be emptied too, otherwise their
        // leftovers (session_project_cache, AI suggestions, activity spans…)
        // blend with the restored data and the result looks like a merge.
        {
            let src_set: std::collections::HashSet<&str> =
                tables.iter().map(|s| s.as_str()).collect();
            let dest_tables: Vec<String> = {
                let mut stmt = tx
                    .prepare(
                        "SELECT name FROM main.sqlite_master
                         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
                         ORDER BY name",
                    )
                    .map_err(|e| format!("Failed to enumerate destination tables: {}", e))?;
                let rows = stmt
                    .query_map([], |row| row.get::<_, String>(0))
                    .map_err(|e| format!("Failed to read destination table list: {}", e))?;
                rows.filter_map(|row| row.ok()).collect()
            };
            for table_name in dest_tables {
                if src_set.contains(table_name.as_str()) {
                    continue; // czyszczone tuż przed kopiowaniem w pętli niżej
                }
                let quoted = table_name.replace('"', "\"\"");
                tx.execute_batch(&format!("DELETE FROM \"{}\";", quoted))
                    .map_err(|e| {
                        format!("Failed to clear destination-only table '{}': {}", table_name, e)
                    })?;
            }
        }

        for table_name in &tables {
            let quoted_name = table_name.replace('"', "\"\"");

            // Build column-aware INSERT to handle schema differences between
            // backup and current database (e.g. migrations added new columns).
            let src_cols: Vec<String> = {
                // Dwuargumentowa forma pragma_table_info(tabela, schemat) —
                // forma "restore_src.pragma_table_info(...)" potrafiła zwrócić
                // kolumny GŁÓWNEJ bazy; kolumny nieistniejące w backupie
                // trafiały wtedy do SELECT-a jako "nazwa" i SQLite wstawiał
                // je jako DOSŁOWNE STRINGI (np. merged_into='merged_into').
                let mut stmt = tx
                    .prepare("SELECT name FROM pragma_table_info(?1, 'restore_src')")
                    .map_err(|e| {
                        format!("Failed to read source columns for '{}': {}", table_name, e)
                    })?;
                let rows = stmt
                    .query_map([table_name.as_str()], |row| row.get::<_, String>(0))
                    .map_err(|e| {
                        format!(
                            "Failed to enumerate source columns for '{}': {}",
                            table_name, e
                        )
                    })?;
                rows.filter_map(|r| r.ok()).collect()
            };

            let dest_cols: Vec<String> = {
                let mut stmt = tx
                    .prepare("SELECT name FROM pragma_table_info(?1, 'main')")
                    .map_err(|e| {
                        format!(
                            "Failed to read destination columns for '{}': {}",
                            table_name, e
                        )
                    })?;
                let rows = stmt
                    .query_map([table_name.as_str()], |row| row.get::<_, String>(0))
                    .map_err(|e| {
                        format!(
                            "Failed to enumerate destination columns for '{}': {}",
                            table_name, e
                        )
                    })?;
                rows.filter_map(|r| r.ok()).collect()
            };

            // Use only columns present in both source and destination.
            let dest_set: std::collections::HashSet<&str> =
                dest_cols.iter().map(|s| s.as_str()).collect();
            let common_cols: Vec<&str> = src_cols
                .iter()
                .filter(|c| dest_set.contains(c.as_str()))
                .map(|s| s.as_str())
                .collect();

            tx.execute_batch(&format!("DELETE FROM \"{}\";", quoted_name))
                .map_err(|e| format!("Failed to clear table '{}': {}", table_name, e))?;

            if common_cols.is_empty() {
                log::warn!(
                    "Restore: no common columns for table '{}', skipping data copy",
                    table_name
                );
                continue;
            }

            let cols_csv: String = common_cols
                .iter()
                .map(|c| format!("\"{}\"", c.replace('"', "\"\"")))
                .collect::<Vec<_>>()
                .join(", ");

            tx.execute_batch(&format!(
                "INSERT INTO \"{name}\" ({cols}) SELECT {cols} FROM restore_src.\"{name}\";",
                name = quoted_name,
                cols = cols_csv,
            ))
            .map_err(|e| format!("Failed to restore table '{}': {}", table_name, e))?;
        }

        let has_sqlite_sequence: bool = tx
            .query_row(
                "SELECT COUNT(*) FROM restore_src.sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map(|count| count > 0)
            .map_err(|e| format!("Failed to inspect sqlite_sequence: {}", e))?;
        if has_sqlite_sequence {
            let _ = tx.execute_batch(
                "DELETE FROM sqlite_sequence;
                 INSERT INTO sqlite_sequence(name, seq)
                 SELECT name, seq FROM restore_src.sqlite_sequence;",
            );
        }

        tx.commit()
            .map_err(|e| format!("Failed to commit database restore: {}", e))?;

        Ok(())
    })();

    // Restore triggers regardless of whether data restore succeeded.
    for (_, sql) in &trigger_defs {
        if let Err(e) = conn.execute_batch(&format!("{};", sql)) {
            log::error!("Failed to recreate trigger: {}", e);
        }
    }

    let _ = conn.execute_batch("DETACH DATABASE restore_src;");
    let _ = conn.execute_batch("PRAGMA foreign_keys = ON;");

    if result.is_ok() {
        // Restore = stan PLIKU. Bez tego watermarku startowy backfill z daily
        // store wstrzykiwałby z powrotem lokalny tracking sprzed restore
        // (np. czerwcowe sesje do bazy odtworzonej z kwietnia).
        let _ = conn.execute(
            "INSERT OR REPLACE INTO system_settings (key, value, updated_at)
             VALUES ('daily_backfill_min_date', date('now'), datetime('now'))",
            [],
        );
    }

    result
}

#[tauri::command]
pub async fn restore_database_from_file(app: AppHandle, path: String) -> Result<(), String> {
    // Reachable remotely via /rpc — validate before touching the filesystem.
    let validated = crate::commands::helpers::validate_restore_source(&path)?;
    let path = validated.to_string_lossy().to_string();
    run_app_blocking(app, move |app| {
        restore_database_from_file_internal(&app, &path)?;
        // Reset connection pool so subsequent queries see restored data immediately.
        db::reset_active_pool(&app)?;
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn get_backup_files(app: AppHandle) -> Result<Vec<BackupFile>, String> {
    run_app_blocking(app, move |app| {
        let backup_path_str = db::get_system_setting(&app, "backup_path")?.unwrap_or_default();

        if backup_path_str.is_empty() {
            return Ok(vec![]);
        }

        let backup_path = Path::new(&backup_path_str);
        if !backup_path.exists() || !backup_path.is_dir() {
            return Ok(vec![]);
        }

        let mut files = vec![];
        if let Ok(entries) = fs::read_dir(backup_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("db") {
                    if let Ok(meta) = entry.metadata() {
                        if let Ok(modified) = meta.modified() {
                            let dt: DateTime<Local> = modified.into();
                            files.push(BackupFile {
                                name: entry.file_name().to_string_lossy().to_string(),
                                path: path.to_string_lossy().to_string(),
                                size_bytes: meta.len(),
                                modified_at: dt.to_rfc3339(),
                            });
                        }
                    }
                }
            }
        }

        files.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
        Ok(files)
    })
    .await
}

#[derive(Serialize)]
pub struct DataFolderStats {
    pub file_count: u64,
    pub total_bytes: u64,
}

#[derive(Serialize)]
pub struct CleanupResult {
    pub files_deleted: u64,
    pub bytes_freed: u64,
}

/// Collect removable files from archive/, import/ dirs and legacy .json files in root.
fn collect_cleanup_paths(base_dir: &Path, demo_mode: bool) -> Vec<std::path::PathBuf> {
    let archive_dir = if demo_mode {
        base_dir.join("archive_demo")
    } else {
        base_dir.join("archive")
    };
    let import_dir = if demo_mode {
        base_dir.join("import_demo")
    } else {
        base_dir.join("import")
    };

    let mut paths = Vec::new();

    for dir in [&archive_dir, &import_dir] {
        if dir.is_dir() {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_file() {
                        paths.push(p);
                    }
                }
            }
        }
    }

    // Legacy .json files in root (already migrated to daily_store.db)
    if let Ok(entries) = fs::read_dir(base_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                if let Some(ext) = p.extension() {
                    if ext == "json" {
                        paths.push(p);
                    }
                }
            }
        }
    }

    paths
}

#[tauri::command]
pub async fn get_data_folder_stats(app: AppHandle) -> Result<DataFolderStats, String> {
    run_app_blocking(app, move |app| {
        let base_dir = timeflow_data_dir()?;
        let demo_mode = db::is_demo_mode_enabled(&app)?;
        let paths = collect_cleanup_paths(&base_dir, demo_mode);

        let mut total_bytes: u64 = 0;
        for p in &paths {
            if let Ok(meta) = fs::metadata(p) {
                total_bytes += meta.len();
            }
        }

        Ok(DataFolderStats {
            file_count: paths.len() as u64,
            total_bytes,
        })
    })
    .await
}

#[tauri::command]
pub async fn cleanup_data_folder(app: AppHandle) -> Result<CleanupResult, String> {
    run_app_blocking(app, move |app| {
        let base_dir = timeflow_data_dir()?;
        let demo_mode = db::is_demo_mode_enabled(&app)?;
        let paths = collect_cleanup_paths(&base_dir, demo_mode);

        let mut files_deleted: u64 = 0;
        let mut bytes_freed: u64 = 0;

        for p in &paths {
            let size = fs::metadata(p).map(|m| m.len()).unwrap_or(0);
            match fs::remove_file(p) {
                Ok(()) => {
                    files_deleted += 1;
                    bytes_freed += size;
                }
                Err(e) => {
                    log::warn!("Failed to delete '{}': {}", p.display(), e);
                }
            }
        }

        Ok(CleanupResult {
            files_deleted,
            bytes_freed,
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn full_schema_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(include_str!("../../resources/sql/schema.sql"))
            .expect("schema");
        crate::db_migrations::run_migrations(&conn).expect("migrations");
        conn
    }

    #[test]
    fn restore_replaces_everything_including_dest_only_tables() {
        // Backup "ze starego komputera": okrojony schemat — tylko projects+sessions.
        let src_path = std::env::temp_dir().join("timeflow_restore_src_test.db");
        let _ = std::fs::remove_file(&src_path);
        {
            let src = rusqlite::Connection::open(&src_path).expect("src db");
            src.execute_batch(
                "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT);
                 CREATE TABLE sessions (
                     id INTEGER PRIMARY KEY, app_id INTEGER NOT NULL, start_time TEXT NOT NULL,
                     end_time TEXT NOT NULL, duration_seconds INTEGER NOT NULL, date TEXT NOT NULL
                 );
                 INSERT INTO projects VALUES (1, 'z_backupu', datetime('now'));
                 INSERT INTO sessions VALUES (1, 1, '2026-01-01 10:00:00', '2026-01-01 11:00:00', 3600, '2026-01-01');",
            )
            .expect("seed src");
        }

        // Żywa baza: pełny schemat + dane, które MUSZĄ zniknąć po restore.
        let mut conn = full_schema_conn();
        conn.execute_batch(
            "INSERT INTO projects (id, name, created_at) VALUES (9, 'lokalny', datetime('now'));
             INSERT INTO applications (id, executable_name, display_name) VALUES (1, 'app', 'App');
             INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date)
             VALUES (1, '2026-05-05 10:00:00', '2026-05-05 11:00:00', 3600, '2026-05-05');
             INSERT INTO session_project_cache (session_id, session_date, app_id, start_time, end_time, project_id, multiplier, duration_seconds)
             VALUES (1, '2026-05-05', 1, '2026-05-05 10:00:00', '2026-05-05 11:00:00', 9, 1.0, 3600);
             INSERT INTO manual_sessions (title, session_type, project_id, start_time, end_time, duration_seconds, date)
             VALUES ('lokalny manual', 'work', 9, '2026-05-05 12:00:00', '2026-05-05 13:00:00', 3600, '2026-05-05');",
        )
        .expect("seed dest");

        restore_database_into_conn(&mut conn, src_path.to_str().unwrap()).expect("restore");

        // Tabele z backupu: dokładnie zawartość backupu.
        let pnames: Vec<String> = conn
            .prepare("SELECT name FROM projects ORDER BY name").unwrap()
            .query_map([], |r| r.get(0)).unwrap()
            .collect::<Result<_, _>>().unwrap();
        assert_eq!(pnames, vec!["z_backupu".to_string()], "projects = tylko backup");
        let scount: i64 = conn.query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0)).unwrap();
        assert_eq!(scount, 1, "sessions = tylko backup");

        // Tabele NIEOBECNE w backupie: muszą być PUSTE (nie scalone z lokalnymi).
        for t in ["session_project_cache", "manual_sessions", "applications"] {
            let n: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 0, "{t} musi byc wyczyszczona — restore to replace, nie merge");
        }
        let _ = std::fs::remove_file(&src_path);
    }

    #[test]
    fn restore_from_older_schema_leaves_new_columns_null_not_literal() {
        // Backup sprzed migracji: projects bez merged_*, sessions bez project_name.
        let src_path = std::env::temp_dir().join("timeflow_restore_lit_test.db");
        let _ = std::fs::remove_file(&src_path);
        {
            let src = rusqlite::Connection::open(&src_path).expect("src db");
            src.execute_batch(
                "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT);
                 CREATE TABLE sessions (
                     id INTEGER PRIMARY KEY, app_id INTEGER NOT NULL, start_time TEXT NOT NULL,
                     end_time TEXT NOT NULL, duration_seconds INTEGER NOT NULL, date TEXT NOT NULL
                 );
                 CREATE TABLE applications (id INTEGER PRIMARY KEY, executable_name TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '');
                 INSERT INTO applications VALUES (1, 'app', 'App');
                 INSERT INTO projects VALUES (1, 'stary_projekt', datetime('now'));
                 INSERT INTO sessions VALUES (1, 1, '2026-01-01 10:00:00', '2026-01-01 11:00:00', 3600, '2026-01-01');",
            )
            .expect("seed src");
        }
        let mut conn = full_schema_conn();
        restore_database_into_conn(&mut conn, src_path.to_str().unwrap()).expect("restore");

        let (m_into, m_at): (Option<String>, Option<String>) = conn
            .query_row("SELECT merged_into, merged_at FROM projects", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(m_into, None, "kolumna spoza backupu = NULL, nie literal 'merged_into'");
        assert_eq!(m_at, None);
        let pname: Option<String> = conn
            .query_row("SELECT project_name FROM sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(pname, None, "sessions.project_name = NULL, nie literal");
        let _ = std::fs::remove_file(&src_path);
    }

    #[test]
    fn restore_sets_daily_backfill_watermark() {
        let src_path = std::env::temp_dir().join("timeflow_restore_wm_test.db");
        let _ = std::fs::remove_file(&src_path);
        {
            let src = rusqlite::Connection::open(&src_path).expect("src db");
            src.execute_batch(
                "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT);",
            )
            .expect("seed src");
        }
        let mut conn = full_schema_conn();
        restore_database_into_conn(&mut conn, src_path.to_str().unwrap()).expect("restore");
        let wm: String = conn
            .query_row(
                "SELECT value FROM system_settings WHERE key='daily_backfill_min_date'",
                [],
                |r| r.get(0),
            )
            .expect("watermark must be set after restore");
        assert_eq!(wm.len(), 10, "yyyy-mm-dd");
        let _ = std::fs::remove_file(&src_path);
    }
}
