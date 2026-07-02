use std::path::Path;

use tauri::AppHandle;

pub const MAX_MCP_BACKUPS: usize = 20;
const BACKUP_PREFIX: &str = "timeflow_mcp_backup_";

/// Backup bazy przed sesją MCP: WAL checkpoint + VACUUM INTO (spójna kopia,
/// jak backup_before_sync w commands/sync_markers.rs). Zwraca ścieżkę pliku.
pub async fn perform_mcp_backup(app: AppHandle) -> Result<String, String> {
    let data_dir = crate::commands::helpers::timeflow_data_dir()?;
    let backup_dir = data_dir.join("mcp_backups");
    if !backup_dir.exists() {
        std::fs::create_dir_all(&backup_dir)
            .map_err(|e| format!("Failed to create mcp backup dir: {e}"))?;
    }

    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let dest_path = backup_dir.join(format!("{BACKUP_PREFIX}{timestamp}.db"));
    let dest_path_string = dest_path.to_string_lossy().to_string();
    let dest_for_task = dest_path_string.clone();

    crate::commands::helpers::run_db_blocking(app, move |conn| {
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|e| format!("WAL checkpoint failed: {e}"))?;
        let quoted_path: String = conn
            .query_row("SELECT quote(?1)", [&dest_for_task], |row| row.get(0))
            .map_err(|e| format!("Failed to escape backup path: {e}"))?;
        conn.execute_batch(&format!("VACUUM INTO {quoted_path}"))
            .map_err(|e| format!("Backup failed: {e}"))?;
        Ok(())
    })
    .await?;

    rotate_backups(&backup_dir, MAX_MCP_BACKUPS)?;
    Ok(dest_path_string)
}

fn rotate_backups(dir: &Path, keep: usize) -> Result<(), String> {
    let mut backups: Vec<std::path::PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with(BACKUP_PREFIX) && n.ends_with(".db"))
                .unwrap_or(false)
        })
        .collect();
    // Timestamp w nazwie sortuje się leksykograficznie == chronologicznie.
    backups.sort();
    while backups.len() > keep {
        let oldest = backups.remove(0);
        if let Err(e) = std::fs::remove_file(&oldest) {
            log::warn!(
                "[mcp] failed to remove old backup {}: {e}",
                oldest.display()
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time moves forward")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "timeflow-mcp-backup-test-{}-{}",
            std::process::id(),
            unique
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn rotate_keeps_only_newest_files() {
        let dir = temp_dir();
        for i in 0..25 {
            let name = format!("timeflow_mcp_backup_2026-01-{:02}_00-00-00.db", i + 1);
            std::fs::write(dir.join(name), b"x").expect("write");
        }
        rotate_backups(&dir, 20).expect("rotate");
        let left = std::fs::read_dir(&dir).expect("read dir").count();
        assert_eq!(left, 20);
        // Najstarsze (01..05) usunięte, najnowszy (25) zostaje.
        assert!(!dir
            .join("timeflow_mcp_backup_2026-01-01_00-00-00.db")
            .exists());
        assert!(dir
            .join("timeflow_mcp_backup_2026-01-25_00-00-00.db")
            .exists());
        std::fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn rotate_ignores_foreign_files() {
        let dir = temp_dir();
        std::fs::write(dir.join("unrelated.txt"), b"keep me").expect("write");
        for i in 0..21 {
            let name = format!("timeflow_mcp_backup_2026-02-{:02}_00-00-00.db", i + 1);
            std::fs::write(dir.join(name), b"x").expect("write");
        }
        rotate_backups(&dir, 20).expect("rotate");
        assert!(dir.join("unrelated.txt").exists());
        std::fs::remove_dir_all(dir).expect("cleanup");
    }
}
