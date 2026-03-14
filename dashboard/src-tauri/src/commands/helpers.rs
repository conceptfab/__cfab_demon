use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use tauri::AppHandle;
use timeflow_shared::timeflow_paths;

use crate::db;

pub(crate) static LAST_PRUNE_EPOCH_SECS: AtomicU64 = AtomicU64::new(0);
pub(crate) const PRUNE_CACHE_TTL_SECS: u64 = 300; // 5 minutes

pub(crate) const DAEMON_EXE_NAME: &str = "timeflow-demon.exe";
pub(crate) const DAEMON_AUTOSTART_LNK: &str = "TimeFlow Demon.lnk";

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

pub fn timeflow_data_dir() -> Result<std::path::PathBuf, String> {
    let appdata = std::env::var("APPDATA").map_err(|e| e.to_string())?;
    let appdata_root = std::path::PathBuf::from(&appdata);
    timeflow_paths::ensure_timeflow_base_dir(&appdata_root).map_err(|e| e.to_string())
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
