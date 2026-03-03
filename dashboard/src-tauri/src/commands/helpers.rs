use std::process::Command;
use std::sync::atomic::AtomicU64;

#[path = "../../../../shared/timeflow_paths.rs"]
mod timeflow_paths;

pub(crate) static LAST_PRUNE_EPOCH_SECS: AtomicU64 = AtomicU64::new(0);
pub(crate) const PRUNE_CACHE_TTL_SECS: u64 = 300; // 5 minutes

pub(crate) const DAEMON_EXE_NAME: &str = "timeflow-demon.exe";
pub(crate) const DAEMON_AUTOSTART_LNK: &str = "TimeFlow Demon.lnk";

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Hides the CMD window when running system processes (tasklist, taskkill, powershell).
#[cfg(windows)]
pub(crate) fn no_console(cmd: &mut Command) {
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
}
#[cfg(not(windows))]
pub(crate) fn no_console(_cmd: &mut Command) {}

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

pub fn timeflow_data_dir() -> Result<std::path::PathBuf, String> {
    let appdata = std::env::var("APPDATA").map_err(|e| e.to_string())?;
    let appdata_root = std::path::PathBuf::from(&appdata);
    timeflow_paths::ensure_timeflow_base_dir(&appdata_root).map_err(|e| e.to_string())
}
