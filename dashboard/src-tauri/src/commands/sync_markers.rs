// Sync Markers — CRUD operations for the sync_markers table.
// Used by LAN sync to track synchronization state between peers.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::helpers::run_db_blocking;

const MAX_SYNC_BACKUPS: usize = 5;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncMarker {
    pub id: i64,
    pub marker_hash: String,
    pub created_at: String,
    pub device_id: String,
    pub peer_id: Option<String>,
    pub tables_hash: String,
    pub full_sync: bool,
}

/// Generate a deterministic marker hash.
pub(crate) fn generate_marker_hash(
    _conn: &rusqlite::Connection,
    tables_hash: &str,
    timestamp: &str,
    device_id: &str,
) -> Result<String, String> {
    use std::hash::{Hash, Hasher};
    let input = format!("{}{}{}", tables_hash, timestamp, device_id);
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    input.hash(&mut hasher);
    Ok(format!("{:016x}", hasher.finish()))
}

#[tauri::command]
pub async fn insert_sync_marker(
    app: AppHandle,
    tables_hash: String,
    device_id: String,
    peer_id: Option<String>,
    full_sync: bool,
) -> Result<SyncMarker, String> {
    run_db_blocking(app, move |conn| {
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let marker_hash = generate_marker_hash(conn, &tables_hash, &now, &device_id)?;

        conn.execute(
            "INSERT INTO sync_markers (marker_hash, created_at, device_id, peer_id, tables_hash, full_sync)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![marker_hash, now, device_id, peer_id, tables_hash, full_sync as i64],
        )
        .map_err(|e| e.to_string())?;

        let id = conn.last_insert_rowid();
        Ok(SyncMarker {
            id,
            marker_hash,
            created_at: now,
            device_id,
            peer_id,
            tables_hash,
            full_sync,
        })
    })
    .await
}

#[tauri::command]
pub async fn get_latest_sync_marker(app: AppHandle) -> Result<Option<SyncMarker>, String> {
    run_db_blocking(app, move |conn| {
        let result = conn.query_row(
            "SELECT id, marker_hash, created_at, device_id, peer_id, tables_hash, full_sync
             FROM sync_markers ORDER BY created_at DESC LIMIT 1",
            [],
            |row| {
                Ok(SyncMarker {
                    id: row.get(0)?,
                    marker_hash: row.get(1)?,
                    created_at: row.get(2)?,
                    device_id: row.get(3)?,
                    peer_id: row.get(4)?,
                    tables_hash: row.get(5)?,
                    full_sync: row.get::<_, i64>(6)? != 0,
                })
            },
        );
        match result {
            Ok(marker) => Ok(Some(marker)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
}

/// Create a backup of the database before sync. Rotates old backups (max 5).
#[tauri::command]
pub async fn backup_before_sync(app: AppHandle) -> Result<String, String> {
    let data_dir = super::helpers::timeflow_data_dir()?;
    let backup_dir = data_dir.join("sync_backups");

    if !backup_dir.exists() {
        std::fs::create_dir_all(&backup_dir)
            .map_err(|e| format!("Failed to create sync backup dir: {}", e))?;
    }

    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let file_name = format!("timeflow_sync_backup_{}.db", timestamp);
    let dest_path = backup_dir.join(&file_name);
    let dest_path_string = dest_path.to_string_lossy().to_string();

    let backup_path = run_db_blocking(app, move |conn| {
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|e| format!("WAL checkpoint failed: {}", e))?;

        let quoted_path: String = conn
            .query_row("SELECT quote(?1)", [&dest_path_string], |row| row.get(0))
            .map_err(|e| format!("Failed to escape backup path: {}", e))?;
        conn.execute_batch(&format!("VACUUM INTO {}", quoted_path))
            .map_err(|e| format!("Backup failed: {}", e))?;

        Ok(dest_path_string)
    })
    .await?;

    // Rotate: keep only MAX_SYNC_BACKUPS newest files
    let mut backups: Vec<std::path::PathBuf> = std::fs::read_dir(&backup_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("timeflow_sync_backup_") && n.ends_with(".db"))
                .unwrap_or(false)
        })
        .collect();

    backups.sort();
    while backups.len() > MAX_SYNC_BACKUPS {
        if let Some(oldest) = backups.first() {
            let _ = std::fs::remove_file(oldest);
        }
        backups.remove(0);
    }

    log::info!("Sync backup created: {}", file_name);
    Ok(backup_path)
}

#[tauri::command]
pub async fn markers_match(
    app: AppHandle,
    remote_marker_hash: Option<String>,
) -> Result<bool, String> {
    let local = get_latest_sync_marker(app).await?;
    match (local, remote_marker_hash) {
        (Some(local_marker), Some(remote_hash)) => Ok(local_marker.marker_hash == remote_hash),
        (None, None) => Ok(true),
        _ => Ok(false),
    }
}
