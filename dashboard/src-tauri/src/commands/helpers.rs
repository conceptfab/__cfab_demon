use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use tauri::AppHandle;
use timeflow_shared::timeflow_paths;

use crate::db;

pub(crate) static LAST_PRUNE_EPOCH_SECS: AtomicU64 = AtomicU64::new(0);
pub(crate) const PRUNE_CACHE_TTL_SECS: u64 = 300; // 5 minutes

#[cfg(windows)]
pub(crate) const DAEMON_EXE_NAME: &str = "timeflow-demon.exe";
#[cfg(not(windows))]
pub(crate) const DAEMON_EXE_NAME: &str = "timeflow-demon";

/// Nazwa skrótu autostartu. Na Windows to plik .lnk w Startup folderze; na
/// macOS autostart realizowany jest przez plist w ~/Library/LaunchAgents
/// (patrz `commands::daemon::control::set_autostart_enabled`).
#[cfg(windows)]
pub(crate) const DAEMON_AUTOSTART_LNK: &str = "TimeFlow Demon.lnk";
#[cfg(not(windows))]
pub(crate) const DAEMON_AUTOSTART_LNK: &str = "com.kleniewski.timeflow-demon.plist";

pub(crate) use timeflow_shared::process_utils::no_console;

/// Validates that a file path is safe (no path traversal components).
/// Returns an error string if the path is unsafe.
pub(crate) fn validate_import_path(path: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);

    // Reject paths containing ".." components
    for component in p.components() {
        if let std::path::Component::ParentDir = component {
            return Err(format!(
                "Path traversal detected in '{}': '..' components are not allowed",
                path
            ));
        }
    }

    // Must be an absolute path (user-selected via dialog) or a simple filename
    if !p.is_absolute() && p.components().count() > 1 {
        // Relative multi-segment paths are suspicious when not from a dialog
        log::warn!("Import path '{}' is relative with multiple segments", path);
    }

    Ok(())
}

pub(crate) fn name_hash(name: &str) -> u32 {
    name.bytes().fold(0u32, |acc, byte| {
        acc.wrapping_mul(31).wrapping_add(byte as u32)
    })
}

pub(crate) fn duplicate_name_counts<'a, I>(names: I) -> HashMap<String, usize>
where
    I: IntoIterator<Item = &'a str>,
{
    let mut counts = HashMap::new();
    for name in names {
        *counts.entry(name.to_lowercase()).or_insert(0) += 1;
    }
    counts
}

pub(crate) fn disambiguate_name(
    name: &str,
    entity_id: i64,
    duplicate_counts: &HashMap<String, usize>,
) -> String {
    if duplicate_counts
        .get(&name.to_lowercase())
        .copied()
        .unwrap_or(0)
        > 1
    {
        format!("{name} · #{entity_id}")
    } else {
        name.to_string()
    }
}

/// FNV-1a 64-bit hash — deterministic, matches daemon's lan_common::fnv1a_64.
fn fnv1a_64(data: &[u8]) -> u64 {
    let mut hash: u64 = 14695981039346656037;
    for byte in data {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(1099511628211);
    }
    hash
}

pub(crate) fn compute_table_hash(conn: &rusqlite::Connection, table: &str) -> String {
    let (sql, count_sql) = match table {
        "projects" => {
            (
                "SELECT COALESCE(group_concat(name || '|' || updated_at, ';'), '') \
                 FROM (SELECT name, updated_at FROM projects ORDER BY name)",
                "SELECT COUNT(*) FROM projects",
            )
        }
        "applications" => {
            (
                "SELECT COALESCE(group_concat(executable_name || '|' || updated_at, ';'), '') \
                 FROM (SELECT executable_name, updated_at FROM applications ORDER BY executable_name)",
                "SELECT COUNT(*) FROM applications",
            )
        }
        "sessions" => {
            (
                "SELECT COALESCE(group_concat(app_name || '|' || start_time || '|' || updated_at, ';'), '') \
                 FROM (SELECT a.executable_name AS app_name, s.start_time, s.updated_at \
                       FROM sessions s JOIN applications a ON s.app_id = a.id \
                       ORDER BY a.executable_name, s.start_time)",
                "SELECT COUNT(*) FROM sessions",
            )
        }
        "manual_sessions" => {
            (
                "SELECT COALESCE(group_concat(title || '|' || start_time || '|' || updated_at, ';'), '') \
                 FROM (SELECT title, start_time, updated_at FROM manual_sessions ORDER BY title, start_time)",
                "SELECT COUNT(*) FROM manual_sessions",
            )
        }
        "assignment_feedback" => {
            (
                "SELECT COALESCE(group_concat(source || '|' || created_at, ';'), '') \
                 FROM (SELECT source, created_at FROM assignment_feedback ORDER BY created_at)",
                "SELECT COUNT(*) FROM assignment_feedback",
            )
        }
        "assignment_auto_runs" => {
            (
                "SELECT COALESCE(group_concat(started_at || '|' || COALESCE(finished_at, ''), ';'), '') \
                 FROM (SELECT started_at, finished_at FROM assignment_auto_runs ORDER BY started_at)",
                "SELECT COUNT(*) FROM assignment_auto_runs",
            )
        }
        _ => {
            log::warn!("compute_table_hash: unknown table '{}'", table);
            return String::new();
        }
    };
    let concat: String = conn
        .query_row(sql, [], |row| row.get(0))
        .unwrap_or_else(|_| String::new());
    let row_count = conn
        .query_row(count_sql, [], |row| row.get::<_, i64>(0))
        .unwrap_or(0);
    if row_count > 0 && concat.is_empty() {
        log::warn!(
            "compute_table_hash: table '{}' has {} row(s) but produced an empty hash input",
            table,
            row_count
        );
    }
    format!("{:016x}", fnv1a_64(concat.as_bytes()))
}

pub(crate) fn build_table_hashes(conn: &rusqlite::Connection) -> super::delta_export::TableHashes {
    super::delta_export::TableHashes {
        projects: compute_table_hash(conn, "projects"),
        applications: compute_table_hash(conn, "applications"),
        sessions: compute_table_hash(conn, "sessions"),
        manual_sessions: compute_table_hash(conn, "manual_sessions"),
        assignment_feedback: compute_table_hash(conn, "assignment_feedback"),
        assignment_auto_runs: compute_table_hash(conn, "assignment_auto_runs"),
    }
}

pub fn get_machine_id() -> String {
    #[cfg(windows)]
    {
        std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string())
    }
    #[cfg(not(windows))]
    {
        // hostname crate już jest w dependencyach (pulled in by tauri stack)
        hostname::get()
            .ok()
            .and_then(|s| s.into_string().ok())
            .unwrap_or_else(|| "unknown".to_string())
    }
}

pub fn timeflow_data_dir() -> Result<std::path::PathBuf, String> {
    timeflow_paths::timeflow_data_dir().map_err(|e| e.to_string())
}

/// Runs a blocking SQLite task against the currently active dashboard database.
///
/// This follows the app's active mode switch, so in demo mode it uses the demo
/// DB and otherwise the primary DB. Use this for regular TIMEFLOW data that the
/// UI should read/write inside the selected mode.
pub(crate) async fn run_db_blocking<T, F>(app: AppHandle, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut rusqlite::Connection) -> Result<T, String> + Send + 'static,
{
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = db::get_connection(&app)?;
        operation(&mut conn)
    })
    .await
    .map_err(|e| format!("Blocking DB task join error: {}", e))?
}

pub(crate) async fn run_app_blocking<T, F>(app: AppHandle, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(AppHandle) -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || operation(app))
        .await
        .map_err(|e| format!("Blocking app task join error: {}", e))?
}

/// Runs a blocking SQLite task against the primary dashboard database only.
///
/// This bypasses demo mode and is reserved for data that must stay shared
/// across modes, for example monitored app configuration persisted in the real
/// primary store.
pub(crate) async fn run_db_primary_blocking<T, F>(app: AppHandle, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut rusqlite::Connection) -> Result<T, String> + Send + 'static,
{
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = db::get_primary_connection(&app)?;
        operation(&mut conn)
    })
    .await
    .map_err(|e| format!("Blocking primary DB task join error: {}", e))?
}
