use std::path::{Path, PathBuf};

const TIMEFLOW_DIR_NAME: &str = "TimeFlow";
const LEGACY_DIR_NAMES: [&str; 3] = ["conceptfab", "CfabDemon", "TimeFlowDemon"];

/// Korzeń katalogu użytkownika, w którym mieszka folder TimeFlow.
/// - Windows: `%APPDATA%` (zwykle `C:\Users\<user>\AppData\Roaming`)
/// - macOS:   `~/Library/Application Support`
/// - Linux (i inne Unixy): `$XDG_DATA_HOME` lub `$HOME/.local/share` jako fallback
pub fn user_data_root() -> std::io::Result<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "APPDATA environment variable is missing",
                )
            })
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME")
            .map(|h| PathBuf::from(h).join("Library").join("Application Support"))
            .ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "HOME environment variable is missing",
                )
            })
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
            return Ok(PathBuf::from(xdg));
        }
        std::env::var_os("HOME")
            .map(|h| PathBuf::from(h).join(".local").join("share"))
            .ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "HOME environment variable is missing",
                )
            })
    }
}

/// Pełna ścieżka `<user_data_root>/TimeFlow`, z utworzeniem katalogu jeśli
/// nie istnieje i migracją ze starszych nazw (conceptfab, CfabDemon, …).
/// Demon i dashboard muszą używać TEJ SAMEJ ścieżki — współdzielą bazę SQLite.
pub fn timeflow_data_dir() -> std::io::Result<PathBuf> {
    let root = user_data_root()?;
    ensure_timeflow_base_dir(&root)
}

pub fn ensure_timeflow_base_dir(appdata_root: &Path) -> std::io::Result<PathBuf> {
    let base = appdata_root.join(TIMEFLOW_DIR_NAME);

    if !base.exists() {
        for legacy_name in LEGACY_DIR_NAMES {
            let legacy_base = appdata_root.join(legacy_name);
            if !legacy_base.exists() {
                continue;
            }
            match std::fs::rename(&legacy_base, &base) {
                Ok(_) => {
                    log::info!(
                        "Migrated app directory '{}' -> '{}'",
                        legacy_base.display(),
                        base.display()
                    );
                    break;
                }
                Err(e) => {
                    log::warn!(
                        "Failed to migrate app directory '{}' -> '{}': {}",
                        legacy_base.display(),
                        base.display(),
                        e
                    );
                }
            }
        }
    }

    std::fs::create_dir_all(&base)?;
    Ok(base)
}
