use std::path::{Path, PathBuf};

const TIMEFLOW_DIR_NAME: &str = "TimeFlow";
const LEGACY_DIR_NAMES: [&str; 3] = ["conceptfab", "CfabDemon", "TimeFlowDemon"];

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
