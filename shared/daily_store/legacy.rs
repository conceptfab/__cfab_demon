use crate::daily_store::{open_store, replace_day_snapshot, StoredDailyData};
use rusqlite::OptionalExtension;
use std::fs;
use std::path::{Path, PathBuf};
pub fn load_legacy_json_file(path: &Path) -> Result<StoredDailyData, String> {
    let content = fs::read_to_string(path).map_err(|e| {
        format!(
            "Failed to read legacy daily JSON '{}': {}",
            path.display(),
            e
        )
    })?;
    serde_json::from_str::<StoredDailyData>(&content).map_err(|e| {
        format!(
            "Failed to parse legacy daily JSON '{}': {}",
            path.display(),
            e
        )
    })
}

// Used by the dashboard Tauri crate via the shared module include.
#[allow(dead_code)]
pub fn migrate_legacy_json_files(base_dir: &Path) -> Result<usize, String> {
    let mut conn = open_store(base_dir)?;
    let mut migrated = 0usize;

    for dir_name in ["data", "archive"] {
        let dir_path = base_dir.join(dir_name);
        if !dir_path.exists() {
            continue;
        }

        let mut entries: Vec<PathBuf> = fs::read_dir(&dir_path)
            .map_err(|e| {
                format!(
                    "Failed to read legacy daily directory '{}': {}",
                    dir_path.display(),
                    e
                )
            })?
            .filter_map(|entry| entry.ok().map(|value| value.path()))
            .filter(|path| {
                path.is_file()
                    && path.extension().map(|ext| ext == "json").unwrap_or(false)
                    && !path
                        .file_name()
                        .map(|name| name.to_string_lossy().starts_with('.'))
                        .unwrap_or(false)
            })
            .collect();
        entries.sort();

        for path in entries {
            let snapshot = match load_legacy_json_file(&path) {
                Ok(snapshot) => snapshot,
                Err(err) => {
                    log::warn!("{}", err);
                    continue;
                }
            };

            let already_exists = conn
                .query_row(
                    "SELECT 1 FROM daily_snapshots WHERE date = ?1 LIMIT 1",
                    [snapshot.date.as_str()],
                    |row| row.get::<_, i64>(0),
                )
                .optional()
                .map_err(|e| {
                    format!(
                        "Failed to check daily snapshot existence for {}: {}",
                        snapshot.date, e
                    )
                })?
                .is_some();
            if already_exists {
                continue;
            }

            replace_day_snapshot(&mut conn, &snapshot)?;
            migrated += 1;
        }
    }

    Ok(migrated)
}

