// sync_common.rs — shared sync utilities used by both LAN and online sync.

use crate::config;
use crate::lan_common;
use crate::lan_server;

use std::sync::Mutex;

pub(crate) static MERGE_MUTEX: Mutex<()> = Mutex::new(());

fn diag_logging_enabled() -> bool {
    cfg!(debug_assertions) || config::load_log_settings().lan_sync_level.eq_ignore_ascii_case("debug")
}

pub fn compute_tables_hash_string_conn(conn: &rusqlite::Connection) -> String {
    lan_common::compute_tables_hash_string(conn)
}

pub fn generate_marker_hash_simple(tables_hash: &str, timestamp: &str, device_id: &str) -> String {
    lan_common::generate_marker_hash(tables_hash, timestamp, device_id)
}

// ── Database helpers ──

pub fn insert_sync_marker_db(
    conn: &rusqlite::Connection,
    marker_hash: &str,
    created_at: &str,
    device_id: &str,
    peer_id: Option<&str>,
    tables_hash: &str,
    full_sync: bool,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO sync_markers (marker_hash, created_at, device_id, peer_id, tables_hash, full_sync) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![marker_hash, created_at, device_id, peer_id, tables_hash, full_sync as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn build_full_export(conn: &rusqlite::Connection) -> Result<String, String> {
    // Full convergence snapshot: include tombstones so deletes propagate in full
    // and force sync. The merge path applies tombstones before live rows, so rows
    // still present in the snapshot are restored by the following record merge.
    lan_server::build_full_snapshot_public(conn)
}

// ── Backup ──

#[allow(dead_code)]
pub fn backup_database(conn: &rusqlite::Connection) -> Result<(), String> {
    backup_database_typed(conn, "lan")
}

pub fn backup_database_typed(conn: &rusqlite::Connection, sync_type: &str) -> Result<(), String> {
    let dir = config::config_dir().map_err(|e| e.to_string())?;
    let backup_dir = dir.join("sync_backups").join(sync_type);
    if !backup_dir.exists() {
        std::fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
    }

    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let dest = backup_dir.join(format!("timeflow_sync_backup_{}.db", timestamp));

    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| e.to_string())?;

    // Use rusqlite backup API instead of string-interpolated VACUUM INTO
    let mut dest_conn = rusqlite::Connection::open(&dest)
        .map_err(|e| format!("Backup: cannot open dest: {}", e))?;
    let backup = rusqlite::backup::Backup::new(conn, &mut dest_conn)
        .map_err(|e| format!("Backup init failed: {}", e))?;
    backup.run_to_completion(100, std::time::Duration::from_millis(50), None)
        .map_err(|e| format!("Backup failed: {}", e))?;
    drop(backup);
    drop(dest_conn);

    // Rotate: keep max 5
    let mut backups: Vec<std::path::PathBuf> = std::fs::read_dir(&backup_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str())
            .map(|n| n.starts_with("timeflow_sync_backup_")).unwrap_or(false))
        .collect();
    backups.sort();
    while backups.len() > 5 {
        if let Some(oldest) = backups.first() {
            let _ = std::fs::remove_file(oldest);
        }
        backups.remove(0);
    }

    log::info!("Sync backup created: {:?}", dest);

    // Also create persistent backup to user-configured Backup Destination
    if let Err(e) = create_pre_sync_backup_to_destination(conn, "lan") {
        log::warn!("Pre-sync backup to Backup Destination skipped: {}", e);
    }

    Ok(())
}

/// Create a persistent pre-sync backup to the user-configured Backup Destination.
/// Reads `backup_path` from system_settings. Falls back silently if not configured.
fn create_pre_sync_backup_to_destination(conn: &rusqlite::Connection, sync_type: &str) -> Result<String, String> {
    // Read backup_path from system_settings
    let backup_path: Option<String> = conn.query_row(
        "SELECT value FROM system_settings WHERE key = 'backup_path'",
        [],
        |row| row.get(0),
    ).ok().filter(|p: &String| !p.is_empty());

    let backup_dir = match backup_path {
        Some(ref p) => std::path::PathBuf::from(p),
        None => return Err("backup_path not configured".to_string()),
    };

    // Validate path — reject traversal attempts
    let canonical = backup_dir.to_string_lossy();
    if canonical.contains("..") {
        return Err(format!("Invalid backup_path: path traversal detected in '{}'", canonical));
    }

    if !backup_dir.exists() {
        std::fs::create_dir_all(&backup_dir)
            .map_err(|e| format!("Failed to create backup dir: {}", e))?;
    }

    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let file_name = format!("timeflow_pre_{}_sync_{}.db", sync_type, timestamp);
    let dest_path = backup_dir.join(&file_name);

    // Use rusqlite backup API instead of string-interpolated VACUUM INTO to prevent SQL injection
    let mut dest_conn = rusqlite::Connection::open(&dest_path)
        .map_err(|e| format!("Pre-sync backup: cannot open dest: {}", e))?;
    let backup = rusqlite::backup::Backup::new(conn, &mut dest_conn)
        .map_err(|e| format!("Pre-sync backup init failed: {}", e))?;
    backup.run_to_completion(100, std::time::Duration::from_millis(50), None)
        .map_err(|e| format!("Pre-sync backup failed: {}", e))?;
    drop(backup);
    drop(dest_conn);

    // Rotate: keep max 10 pre-sync backups per type
    let prefix = format!("timeflow_pre_{}_sync_", sync_type);
    let mut backups: Vec<std::path::PathBuf> = std::fs::read_dir(&backup_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str())
            .map(|n| n.starts_with(&prefix)).unwrap_or(false))
        .collect();
    backups.sort();
    while backups.len() > 10 {
        if let Some(oldest) = backups.first() {
            let _ = std::fs::remove_file(oldest);
        }
        backups.remove(0);
    }

    log::info!("Pre-{}-sync backup to Backup Destination: {:?}", sync_type, dest_path);
    Ok(dest_path.to_string_lossy().to_string())
}

/// Restores from the most recent backup using SQLite backup API.
/// This is safe even with the caller's connection open — the backup API
/// handles locking correctly, unlike raw fs::copy which can corrupt on Windows.
/// Callers MUST re-open the connection after restore.
#[allow(dead_code)]
pub fn restore_database_backup(conn: &mut rusqlite::Connection) -> Result<(), String> {
    restore_database_backup_typed(conn, "lan")
}

pub fn restore_database_backup_typed(conn: &mut rusqlite::Connection, sync_type: &str) -> Result<(), String> {
    let dir = config::config_dir().map_err(|e| e.to_string())?;
    let backup_dir = dir.join("sync_backups").join(sync_type);

    let mut backups: Vec<std::path::PathBuf> = std::fs::read_dir(&backup_dir)
        .map_err(|e| format!("Cannot read backup dir: {}", e))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("timeflow_sync_backup_"))
                .unwrap_or(false)
        })
        .collect();
    backups.sort();

    let latest = backups.last().ok_or("No backup files found")?.clone();

    // Open backup file as source, then use SQLite backup API to restore safely
    let src = rusqlite::Connection::open(&latest)
        .map_err(|e| format!("Cannot open backup file: {}", e))?;
    let backup = rusqlite::backup::Backup::new(&src, conn)
        .map_err(|e| format!("Backup init failed: {}", e))?;
    backup.run_to_completion(100, std::time::Duration::from_millis(50), None)
        .map_err(|e| format!("Backup restore failed: {}", e))?;

    drop(backup);
    drop(src);

    // Re-open connection to ensure clean state after restore
    let db_path = config::dashboard_db_path().map_err(|e| e.to_string())?;
    let new_conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("Re-open after restore failed: {}", e))?;
    *conn = new_conn;

    log::warn!("Database restored from backup: {:?}. Connection re-opened.", latest);
    Ok(())
}

// ── Delta export for async sync ──

/// Build a delta export containing only records changed since `since_ts`.
/// Returns (json_string, byte_count). If since_ts is None, exports everything.
pub fn build_delta_export(conn: &rusqlite::Connection, since_ts: Option<&str>) -> Result<(String, usize), String> {
    let since = since_ts.unwrap_or("1970-01-01 00:00:00");
    let json = lan_server::build_delta_for_pull_public(conn, since)?;
    let size = json.len();
    Ok((json, size))
}

/// Get the timestamp of the last successful sync marker, or None if never synced.
pub fn get_last_sync_timestamp(conn: &rusqlite::Connection) -> Option<String> {
    conn.query_row(
        "SELECT created_at FROM sync_markers ORDER BY created_at DESC LIMIT 1",
        [],
        |row| row.get(0),
    )
    .ok()
}

// ── Timestamp normalization ──

/// Normalize ISO/mixed timestamps to `YYYY-MM-DD HH:MM:SS` for safe string comparison.
/// Handles timezone-aware formats (RFC3339, explicit offset) by converting to UTC,
/// and naive formats (`2024-01-02T15:04:05`, `2024-01-02 15:04:05`).
fn normalize_ts(ts: &str) -> String {
    // Try timezone-aware formats first (convert to UTC for comparison)
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) {
        return dt.naive_utc().format("%Y-%m-%d %H:%M:%S").to_string();
    }
    if let Ok(dt) = chrono::DateTime::parse_from_str(ts, "%Y-%m-%dT%H:%M:%S%z") {
        return dt.naive_utc().format("%Y-%m-%d %H:%M:%S").to_string();
    }
    // Fallback: naive (no timezone) — assume same timezone
    chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%d %H:%M:%S"))
        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_else(|_| ts.to_string())
}

// ── Merge conflict logging ──

fn log_merge_conflict(
    tx: &rusqlite::Transaction,
    table_name: &str,
    record_key: &str,
    local_updated_at: &str,
    remote_updated_at: &str,
    winner: &str,
) {
    let _ = tx.execute(
        "INSERT INTO sync_merge_log (table_name, record_key, resolution, local_updated_at, remote_updated_at, winner) \
         VALUES (?1, ?2, 'last_writer_wins', ?3, ?4, ?5)",
        rusqlite::params![table_name, record_key, local_updated_at, remote_updated_at, winner],
    );
}

fn local_tombstone_covers(
    tx: &rusqlite::Transaction,
    table_name: &str,
    sync_key: &str,
    record_updated_at: &str,
) -> bool {
    let deleted_at: Option<String> = tx
        .query_row(
            "SELECT MAX(deleted_at) FROM tombstones WHERE table_name = ?1 AND sync_key = ?2",
            rusqlite::params![table_name, sync_key],
            |row| row.get(0),
        )
        .ok()
        .flatten();

    deleted_at
        .as_deref()
        .map(|deleted| normalize_ts(deleted) >= normalize_ts(record_updated_at))
        .unwrap_or(false)
}

fn local_manual_tombstone_covers(
    tx: &rusqlite::Transaction,
    start_time: &str,
    title: &str,
    record_updated_at: &str,
) -> bool {
    let pattern = format!("%|{}|{}", start_time, title);
    let deleted_at: Option<String> = tx
        .query_row(
            "SELECT MAX(deleted_at) FROM tombstones WHERE table_name = 'manual_sessions' AND sync_key LIKE ?1",
            rusqlite::params![pattern],
            |row| row.get(0),
        )
        .ok()
        .flatten();

    deleted_at
        .as_deref()
        .map(|deleted| normalize_ts(deleted) >= normalize_ts(record_updated_at))
        .unwrap_or(false)
}

// ── Merge ──

pub fn merge_incoming_data(conn: &mut rusqlite::Connection, slave_data: &str) -> Result<(), String> {
    let _merge_guard = MERGE_MUTEX
        .lock()
        .map_err(|_| "merge mutex poisoned".to_string())?;
    const MAX_PAYLOAD_SIZE: usize = 200 * 1024 * 1024; // 200 MB
    if slave_data.len() > MAX_PAYLOAD_SIZE {
        return Err(format!(
            "Sync payload too large: {} MB (limit {} MB)",
            slave_data.len() / (1024 * 1024),
            MAX_PAYLOAD_SIZE / (1024 * 1024)
        ));
    }

    // Parse into Value — the source string is caller-owned and will be freed after this call.
    // NOTE: For payloads >50 MB, peak memory usage is ~3× payload size (source + parsed Value).
    // Consider serde_json::StreamDeserializer for very large databases in the future.
    let payload_mb = slave_data.len() as f64 / (1024.0 * 1024.0);
    if payload_mb > 10.0 {
        lan_common::sync_log(&format!("  Parsowanie {:.1} MB payloadu...", payload_mb));
    }
    let archive: serde_json::Value = serde_json::from_str(slave_data)
        .map_err(|e| format!("Failed to parse slave data: {}", e))?;

    // Log counts for visibility
    let count = |path: &str| archive.pointer(path).and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
    lan_common::sync_log(&format!("  Dane peera: {} projektow, {} aplikacji, {} sesji, {} sesji manualnych, {} tombstones",
        count("/data/projects"), count("/data/applications"), count("/data/sessions"),
        count("/data/manual_sessions"), count("/data/tombstones")));

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Merge tombstones FIRST.
    //
    // Tombstones must be applied BEFORE merging records — otherwise a tombstone
    // arriving in the same payload as a fresh INSERT/UPDATE for the same key
    // can wipe out the row we just inserted (the skip_tombstone guard fails
    // when the freshly-inserted row carries a stale `updated_at` from its
    // historical state). Applying deletions first means the subsequent
    // INSERT/UPDATE re-introduces the record exactly as the peer last saw it,
    // and a no-op when the peer also lost it.
    if let Some(tombstones) = archive.pointer("/data/tombstones").and_then(|v| v.as_array()) {
        for ts in tombstones {
            let table_name = ts.get("table_name").and_then(|v| v.as_str()).unwrap_or("");
            let sync_key = ts.get("sync_key").and_then(|v| v.as_str()).unwrap_or("");
            if table_name.is_empty() || sync_key.is_empty() {
                continue;
            }

            let exists: bool = tx
                .query_row(
                    "SELECT 1 FROM tombstones WHERE table_name = ?1 AND sync_key = ?2",
                    rusqlite::params![table_name, sync_key],
                    |_| Ok(()),
                )
                .is_ok();

            if !exists {
                let deleted_at_str = ts.get("deleted_at").and_then(|v| v.as_str()).unwrap_or("");

                // Guard: don't delete a record that was re-created/updated AFTER the tombstone
                // Applied to ALL tables, not just projects (5.7 fix)
                let skip_tombstone = match table_name {
                    "projects" => {
                        let local_updated: Option<String> = tx
                            .query_row("SELECT updated_at FROM projects WHERE name = ?1", [sync_key], |row| row.get(0))
                            .ok();
                        local_updated.as_deref().map(|lu| normalize_ts(lu) > normalize_ts(deleted_at_str)).unwrap_or(false)
                    }
                    "applications" => {
                        let local_updated: Option<String> = tx
                            .query_row("SELECT updated_at FROM applications WHERE executable_name = ?1", [sync_key], |row| row.get(0))
                            .ok();
                        local_updated.as_deref().map(|lu| normalize_ts(lu) > normalize_ts(deleted_at_str)).unwrap_or(false)
                    }
                    "sessions" => {
                        // sync_key = "executable_name|start_time" (legacy: "app_id|start_time")
                        if let Some((app_key, start_time)) = sync_key.split_once('|') {
                            let local_updated: Option<String> = tx
                                .query_row(
                                    "SELECT s.updated_at
                                     FROM sessions s
                                     JOIN applications a ON a.id = s.app_id
                                     WHERE a.executable_name = ?1 AND s.start_time = ?2",
                                    rusqlite::params![app_key, start_time],
                                    |row| row.get(0),
                                )
                                .or_else(|_| {
                                    tx.query_row(
                                        "SELECT updated_at
                                         FROM sessions
                                         WHERE app_id = CAST(?1 AS INTEGER) AND start_time = ?2",
                                        rusqlite::params![app_key, start_time],
                                        |row| row.get(0),
                                    )
                                })
                                .ok();
                            local_updated.as_deref().map(|lu| normalize_ts(lu) > normalize_ts(deleted_at_str)).unwrap_or(false)
                        } else { false }
                    }
                    "manual_sessions" => {
                        // sync_key = "project_id|start_time|title"
                        let parts: Vec<&str> = sync_key.splitn(3, '|').collect();
                        if parts.len() == 3 {
                            let local_updated: Option<String> = tx
                                .query_row(
                                    "SELECT updated_at FROM manual_sessions WHERE start_time = ?1 AND title = ?2",
                                    rusqlite::params![parts[1], parts[2]],
                                    |row| row.get(0),
                                )
                                .ok();
                            local_updated.as_deref().map(|lu| normalize_ts(lu) > normalize_ts(deleted_at_str)).unwrap_or(false)
                        } else { false }
                    }
                    _ => false,
                };
                if skip_tombstone {
                    // Record was updated after tombstone — skip deletion, just record the tombstone
                    tx.execute(
                        "INSERT OR IGNORE INTO tombstones (table_name, record_id, deleted_at, sync_key) \
                         VALUES (?1, ?2, ?3, ?4)",
                        rusqlite::params![table_name, json_i64(ts, "record_id"), deleted_at_str, sync_key],
                    ).map_err(|e| e.to_string())?;
                    continue;
                }

                // Delete the record — also clean up FK references to prevent orphans
                match table_name {
                    "projects" => {
                        // Diagnostyka: czy istnieje lokalny projekt który zostanie usunięty?
                        let proj_exists: bool = tx
                            .query_row("SELECT 1 FROM projects WHERE name = ?1", [sync_key], |_| Ok(()))
                            .is_ok();
                        if proj_exists && diag_logging_enabled() {
                            lan_common::sync_log(&format!(
                                "  [DIAG] TOMBSTONE kasuje projekt '{}' (deleted_at={})",
                                sync_key, deleted_at_str
                            ));
                        }
                        // Null out project_id in sessions/manual_sessions BEFORE deleting the project
                        if let Err(e) = tx.execute(
                            "UPDATE sessions SET project_id = NULL \
                             WHERE project_id IN (SELECT id FROM projects WHERE name = ?1)",
                            [sync_key],
                        ) { log::warn!("tombstone FK cleanup sessions for project '{}': {}", sync_key, e); }
                        if let Err(e) = tx.execute(
                            "UPDATE manual_sessions SET project_id = 0 \
                             WHERE project_id IN (SELECT id FROM projects WHERE name = ?1)",
                            [sync_key],
                        ) { log::warn!("tombstone FK cleanup manual_sessions for project '{}': {}", sync_key, e); }
                        if let Err(e) = tx.execute(
                            "UPDATE applications SET project_id = NULL \
                             WHERE project_id IN (SELECT id FROM projects WHERE name = ?1)",
                            [sync_key],
                        ) { log::warn!("tombstone FK cleanup applications for project '{}': {}", sync_key, e); }
                        let _ = tx.execute("DELETE FROM projects WHERE name = ?1", [sync_key]);
                    }
                    "applications" => {
                        if let Err(e) = tx.execute(
                            "DELETE FROM sessions WHERE app_id IN \
                             (SELECT id FROM applications WHERE executable_name = ?1)",
                            [sync_key],
                        ) { log::warn!("tombstone FK cleanup sessions for app '{}': {}", sync_key, e); }
                        let _ = tx.execute("DELETE FROM applications WHERE executable_name = ?1", [sync_key]);
                    }
                    "sessions" => {
                        // sync_key = "executable_name|start_time" (legacy: "app_id|start_time")
                        if let Some((app_key, start_time)) = sync_key.split_once('|') {
                            let deleted = tx.execute(
                                "DELETE FROM sessions
                                 WHERE app_id IN (
                                     SELECT id FROM applications WHERE executable_name = ?1
                                 ) AND start_time = ?2",
                                rusqlite::params![app_key, start_time],
                            ).unwrap_or(0);
                            if deleted == 0 {
                                let _ = tx.execute(
                                    "DELETE FROM sessions WHERE app_id = CAST(?1 AS INTEGER) AND start_time = ?2",
                                    rusqlite::params![app_key, start_time],
                                );
                            }
                        } else {
                            // Fallback for legacy integer sync_key
                            let _ = tx.execute("DELETE FROM sessions WHERE id = CAST(?1 AS INTEGER)", [sync_key]);
                        }
                    }
                    "manual_sessions" => {
                        // sync_key = "project_id|start_time|title"
                        let parts: Vec<&str> = sync_key.splitn(3, '|').collect();
                        if parts.len() == 3 {
                            let _ = tx.execute(
                                "DELETE FROM manual_sessions WHERE start_time = ?1 AND title = ?2",
                                rusqlite::params![parts[1], parts[2]],
                            );
                        } else {
                            // Fallback for legacy integer sync_key
                            let _ = tx.execute("DELETE FROM manual_sessions WHERE id = CAST(?1 AS INTEGER)", [sync_key]);
                        }
                    }
                    _ => { log::warn!("Tombstone for unknown table: {}", table_name); }
                }

                tx.execute(
                    "INSERT OR IGNORE INTO tombstones (table_name, record_id, deleted_at, sync_key) \
                     VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![
                        table_name,
                        json_i64(ts, "record_id"),
                        json_str(ts, "deleted_at"),
                        sync_key,
                    ],
                ).map_err(|e| e.to_string())?;
            }
        }
    }

    // Merge projects
    let mut diag_proj_new: Vec<String> = Vec::new();
    let mut diag_proj_updated: Vec<String> = Vec::new();
    let mut diag_proj_local_wins: u32 = 0;
    if let Some(projects) = archive.pointer("/data/projects").and_then(|v| v.as_array()) {
        for proj in projects {
            let name = proj.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let updated_at = proj.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
            if name.is_empty() {
                continue;
            }
            if local_tombstone_covers(&tx, "projects", name, updated_at) {
                lan_common::sync_log(&format!(
                    "  SKIP projekt '{}' — lokalny tombstone jest nowszy niz rekord peera",
                    name
                ));
                continue;
            }

            let existing: Option<String> = tx
                .query_row("SELECT updated_at FROM projects WHERE name = ?1", [name], |row| row.get(0))
                .ok();

            match existing {
                Some(local_ts) if normalize_ts(&local_ts) >= normalize_ts(updated_at) => {
                    // Local wins — log only if timestamps differ (actual conflict)
                    if normalize_ts(&local_ts) != normalize_ts(updated_at) {
                        log_merge_conflict(&tx, "projects", name, &local_ts, updated_at, "local");
                    }
                    diag_proj_local_wins += 1;
                }
                Some(ref local_ts) => {
                    log_merge_conflict(&tx, "projects", name, local_ts, updated_at, "remote");
                    // Note: assigned_folder_path is machine-specific — never overwrite from remote
                    tx.execute(
                        "UPDATE projects SET color = ?1, hourly_rate = ?2, excluded_at = ?3, \
                         frozen_at = ?4, updated_at = ?5 WHERE name = ?6",
                        rusqlite::params![
                            json_str(proj, "color"),
                            json_f64_opt(proj, "hourly_rate"),
                            json_str_opt(proj, "excluded_at"),
                            json_str_opt(proj, "frozen_at"),
                            updated_at,
                            name,
                        ],
                    ).map_err(|e| e.to_string())?;
                    diag_proj_updated.push(name.to_string());
                }
                None => {
                    tx.execute(
                        "INSERT INTO projects (name, color, hourly_rate, created_at, excluded_at, \
                         frozen_at, assigned_folder_path, is_imported, updated_at) \
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8)",
                        rusqlite::params![
                            name,
                            json_str(proj, "color"),
                            json_f64_opt(proj, "hourly_rate"),
                            json_str(proj, "created_at"),
                            json_str_opt(proj, "excluded_at"),
                            json_str_opt(proj, "frozen_at"),
                            json_str_opt(proj, "assigned_folder_path"),
                            updated_at,
                        ],
                    ).map_err(|e| e.to_string())?;
                    diag_proj_new.push(name.to_string());
                }
            }
        }
    }
    if diag_logging_enabled() {
        lan_common::sync_log(&format!(
            "  [DIAG] Projekty: NEW={} ({:?}), UPDATED={} ({:?}), LOCAL_WINS={}",
            diag_proj_new.len(), diag_proj_new,
            diag_proj_updated.len(), diag_proj_updated,
            diag_proj_local_wins
        ));
    }

    // Build ID maps once: remote ID → name, local name → ID
    // These are used by applications, sessions, and manual_sessions merge.
    // Built AFTER project/app merge so local IDs reflect newly-inserted records.
    let mut remote_app_id_to_name: std::collections::HashMap<i64, String> = std::collections::HashMap::new();
    if let Some(apps) = archive.pointer("/data/applications").and_then(|v| v.as_array()) {
        for app in apps {
            let remote_id = app.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let exe_name = app.get("executable_name").and_then(|v| v.as_str()).unwrap_or("");
            if remote_id > 0 && !exe_name.is_empty() {
                remote_app_id_to_name.insert(remote_id, exe_name.to_string());
            }
        }
    }

    let mut remote_project_id_to_name: std::collections::HashMap<i64, String> = std::collections::HashMap::new();
    if let Some(projects) = archive.pointer("/data/projects").and_then(|v| v.as_array()) {
        for proj in projects {
            let remote_id = proj.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let name = proj.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if remote_id > 0 && !name.is_empty() {
                remote_project_id_to_name.insert(remote_id, name.to_string());
            }
        }
    }

    // Refresh local ID maps from DB (includes newly-merged projects/apps)
    let mut project_name_to_local_id: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    {
        let mut stmt = tx.prepare("SELECT id, name FROM projects")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            project_name_to_local_id.insert(row.1, row.0);
        }
    }

    let mut app_name_to_local_id: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    {
        let mut stmt = tx.prepare("SELECT id, executable_name FROM applications")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            app_name_to_local_id.insert(row.1, row.0);
        }
    }

    // Merge applications (resolve remote project_id → local via name)
    if let Some(apps) = archive.pointer("/data/applications").and_then(|v| v.as_array()) {
        for app in apps {
            let exe_name = app.get("executable_name").and_then(|v| v.as_str()).unwrap_or("");
            let updated_at = app.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
            if exe_name.is_empty() {
                continue;
            }
            if local_tombstone_covers(&tx, "applications", exe_name, updated_at) {
                lan_common::sync_log(&format!(
                    "  SKIP aplikacja '{}' — lokalny tombstone jest nowszy niz rekord peera",
                    exe_name
                ));
                continue;
            }

            // Resolve remote project_id → local project_id via name
            let remote_project_id = app.get("project_id").and_then(|v| v.as_i64());
            let local_project_id: Option<i64> = remote_project_id
                .and_then(|rid| remote_project_id_to_name.get(&rid))
                .and_then(|name| project_name_to_local_id.get(name))
                .copied();

            let existing: Option<(i64, Option<String>)> = tx
                .query_row(
                    "SELECT id, updated_at FROM applications WHERE executable_name = ?1",
                    [exe_name],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .ok();

            match existing {
                Some((_id, local_ts)) => {
                    let local = local_ts.as_deref().unwrap_or("");
                    if normalize_ts(updated_at) > normalize_ts(local) {
                        log_merge_conflict(&tx, "applications", exe_name, local, updated_at, "remote");
                        // Sync project_id: prefer remote if set, else keep local
                        tx.execute(
                            "UPDATE applications SET display_name = ?1, \
                             project_id = COALESCE(?2, project_id), \
                             updated_at = ?3 WHERE executable_name = ?4",
                            rusqlite::params![
                                json_str_opt(app, "display_name"),
                                local_project_id,
                                updated_at,
                                exe_name,
                            ],
                        ).map_err(|e| e.to_string())?;
                    }
                }
                None => {
                    tx.execute(
                        "INSERT INTO applications (executable_name, display_name, project_id, is_imported, updated_at) \
                         VALUES (?1, ?2, ?3, 1, ?4)",
                        rusqlite::params![exe_name, json_str_opt(app, "display_name"), local_project_id, updated_at],
                    ).map_err(|e| e.to_string())?;
                    // Update app_name_to_local_id for newly-inserted apps
                    if let Ok(new_id) = tx.query_row(
                        "SELECT id FROM applications WHERE executable_name = ?1", [exe_name], |row| row.get::<_, i64>(0)
                    ) {
                        app_name_to_local_id.insert(exe_name.to_string(), new_id);
                    }
                }
            }
        }
    }

    // Merge sessions (using local IDs resolved via name maps)
    let mut diag_sess_total: u32 = 0;
    let mut diag_sess_with_remote_pid: u32 = 0;
    let mut diag_sess_resolved_pid: u32 = 0;
    let mut diag_sess_unresolved_by_name: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    let mut diag_sess_unresolved_remote_id_unknown: u32 = 0;
    if let Some(sessions) = archive.pointer("/data/sessions").and_then(|v| v.as_array()) {
        for sess in sessions {
            let remote_app_id = sess.get("app_id").and_then(|v| v.as_i64()).unwrap_or(0);
            let start_time = sess.get("start_time").and_then(|v| v.as_str()).unwrap_or("");
            let updated_at = sess.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
            if start_time.is_empty() || remote_app_id == 0 {
                continue;
            }
            diag_sess_total += 1;

            // Resolve remote app_id → local app_id via executable_name
            let remote_app_name = match remote_app_id_to_name.get(&remote_app_id) {
                Some(name) => name,
                None => {
                    lan_common::sync_log(&format!("  SKIP sesja (brak nazwy app dla remote={})", remote_app_id));
                    continue;
                }
            };
            let local_app_id = match app_name_to_local_id.get(remote_app_name) {
                Some(&id) => id,
                None => {
                    lan_common::sync_log(&format!("  SKIP sesja (brak lokalnego app_id dla remote={})", remote_app_id));
                    continue;
                }
            };
            let session_sync_key = format!("{}|{}", remote_app_name, start_time);
            if local_tombstone_covers(&tx, "sessions", &session_sync_key, updated_at) {
                lan_common::sync_log(&format!(
                    "  SKIP sesja '{}' — lokalny tombstone jest nowszy niz rekord peera",
                    session_sync_key
                ));
                continue;
            }

            // Resolve remote project_id → local project_id via name
            let remote_pid_opt = sess.get("project_id").and_then(|v| v.as_i64());
            let local_project_id: Option<i64> = remote_pid_opt
                .and_then(|rid| remote_project_id_to_name.get(&rid))
                .and_then(|name| project_name_to_local_id.get(name))
                .copied();
            // Determine project_name to persist. Priority:
            //   1) Remote sent explicit project_name (newer schema) — use it
            //   2) Look up peer's project_id in the peer's project list and use that name
            // This preserves the assignment LABEL even when the project is not present
            // locally (so sessions never appear "unassigned" just because the project
            // list differs per machine).
            let remote_project_name: Option<String> = sess
                .get("project_name")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .or_else(|| {
                    remote_pid_opt
                        .and_then(|rid| remote_project_id_to_name.get(&rid))
                        .cloned()
                });
            if let Some(rid) = remote_pid_opt {
                diag_sess_with_remote_pid += 1;
                if local_project_id.is_some() {
                    diag_sess_resolved_pid += 1;
                } else {
                    match remote_project_id_to_name.get(&rid) {
                        Some(pname) => {
                            *diag_sess_unresolved_by_name.entry(pname.clone()).or_insert(0) += 1;
                        }
                        None => { diag_sess_unresolved_remote_id_unknown += 1; }
                    }
                }
            }

            let existing: Option<(i64, Option<String>)> = tx
                .query_row(
                    "SELECT id, updated_at FROM sessions WHERE app_id = ?1 AND start_time = ?2",
                    rusqlite::params![local_app_id, start_time],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .ok();

            match existing {
                Some((id, local_ts)) => {
                    let local = local_ts.as_deref().unwrap_or("");
                    if normalize_ts(updated_at) > normalize_ts(local) {
                        let key = format!("app_id={}|start_time={}", local_app_id, start_time);
                        log_merge_conflict(&tx, "sessions", &key, local, updated_at, "remote");
                        // COALESCE for project_id: prefer remote-resolved if set, else keep local.
                        // project_name: prefer remote (peer's label), fallback to local — this
                        // ensures that even when the project isn't present locally, the label
                        // persists and the session is not rendered as "Unassigned".
                        tx.execute(
                            "UPDATE sessions SET end_time = ?1, duration_seconds = ?2, \
                             rate_multiplier = ?3, comment = ?4, is_hidden = ?5, \
                             project_id = COALESCE(?6, project_id), \
                             project_name = COALESCE(?7, project_name), \
                             updated_at = ?8 WHERE id = ?9",
                            rusqlite::params![
                                json_str_opt(sess, "end_time"),
                                json_i64(sess, "duration_seconds"),
                                json_f64(sess, "rate_multiplier"),
                                json_str_opt(sess, "comment"),
                                json_i64(sess, "is_hidden"),
                                local_project_id,
                                remote_project_name,
                                updated_at,
                                id,
                            ],
                        ).map_err(|e| e.to_string())?;
                    }
                }
                None => {
                    tx.execute(
                        "INSERT OR IGNORE INTO sessions (app_id, project_id, project_name, start_time, end_time, \
                         duration_seconds, date, rate_multiplier, comment, is_hidden, updated_at) \
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                        rusqlite::params![
                            local_app_id,
                            local_project_id,
                            remote_project_name,
                            start_time,
                            json_str_opt(sess, "end_time"),
                            json_i64(sess, "duration_seconds"),
                            json_str(sess, "date"),
                            json_f64(sess, "rate_multiplier"),
                            json_str_opt(sess, "comment"),
                            json_i64(sess, "is_hidden"),
                            updated_at,
                        ],
                    ).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    if diag_logging_enabled() {
        lan_common::sync_log(&format!(
            "  [DIAG] Sesje: total={}, z remote project_id={}, zresolwowane={}, NIEZRESOLWOWANE_po_nazwie={:?}, remote_id_nieznane={}",
            diag_sess_total, diag_sess_with_remote_pid, diag_sess_resolved_pid,
            diag_sess_unresolved_by_name, diag_sess_unresolved_remote_id_unknown
        ));
    }

    // Merge manual_sessions (using resolved local IDs)
    if let Some(manual_sessions) = archive.pointer("/data/manual_sessions").and_then(|v| v.as_array()) {
        log::info!("Sync orchestrator: merging {} manual sessions", manual_sessions.len());
        for ms in manual_sessions {
            let title = ms.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let start_time = ms.get("start_time").and_then(|v| v.as_str()).unwrap_or("");
            let updated_at = ms.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
            if title.is_empty() || start_time.is_empty() {
                continue;
            }
            if local_manual_tombstone_covers(&tx, start_time, title, updated_at) {
                lan_common::sync_log(&format!(
                    "  SKIP sesja manualna '{}|{}' — lokalny tombstone jest nowszy niz rekord peera",
                    start_time, title
                ));
                continue;
            }

            // Resolve remote IDs to local
            let local_project_id: Option<i64> = ms.get("project_id").and_then(|v| v.as_i64())
                .and_then(|rid| remote_project_id_to_name.get(&rid))
                .and_then(|name| project_name_to_local_id.get(name))
                .copied();
            let local_app_id: Option<i64> = ms.get("app_id").and_then(|v| v.as_i64())
                .and_then(|rid| remote_app_id_to_name.get(&rid))
                .and_then(|name| app_name_to_local_id.get(name))
                .copied();

            let existing: Option<(i64, Option<String>)> = tx
                .query_row(
                    "SELECT id, updated_at FROM manual_sessions WHERE title = ?1 AND start_time = ?2",
                    rusqlite::params![title, start_time],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .ok();

            match existing {
                Some((id, local_ts)) => {
                    let local = local_ts.as_deref().unwrap_or("");
                    if normalize_ts(updated_at) > normalize_ts(local) {
                        let key = format!("title={}|start_time={}", title, start_time);
                        log_merge_conflict(&tx, "manual_sessions", &key, local, updated_at, "remote");
                        tx.execute(
                            "UPDATE manual_sessions SET session_type = ?1, project_id = ?2, \
                             app_id = ?3, end_time = ?4, duration_seconds = ?5, \
                             date = ?6, updated_at = ?7 WHERE id = ?8",
                            rusqlite::params![
                                json_str_opt(ms, "session_type"),
                                local_project_id,
                                local_app_id,
                                json_str_opt(ms, "end_time"),
                                json_i64(ms, "duration_seconds"),
                                json_str_opt(ms, "date"),
                                updated_at,
                                id,
                            ],
                        ).map_err(|e| e.to_string())?;
                    }
                }
                None => {
                    tx.execute(
                        "INSERT INTO manual_sessions (title, session_type, project_id, app_id, \
                         start_time, end_time, duration_seconds, date, created_at, updated_at) \
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                        rusqlite::params![
                            title,
                            json_str_opt(ms, "session_type"),
                            local_project_id,
                            local_app_id,
                            start_time,
                            json_str_opt(ms, "end_time"),
                            json_i64(ms, "duration_seconds"),
                            json_str_opt(ms, "date"),
                            json_str_opt(ms, "created_at"),
                            updated_at,
                        ],
                    ).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    // Tombstones were merged at the top of the transaction (before records),
    // so any peer deletions are already applied. Subsequent INSERT/UPDATE
    // re-introduce records the peer still has — by design.

    tx.commit().map_err(|e| {
        log::error!("Transaction commit failed: {}", e);
        e.to_string()
    })?;
    lan_common::sync_log("  Scalanie zakonczone — commit transakcji");
    Ok(())
}

// ── Tombstone garbage collection ──

/// Delete tombstones older than `max_age_days`. Returns number of deleted rows.
pub fn gc_tombstones(conn: &rusqlite::Connection, max_age_days: u32) -> Result<usize, String> {
    let cutoff = chrono::Utc::now() - chrono::Duration::days(max_age_days as i64);
    let cutoff_str = cutoff.format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "DELETE FROM tombstones WHERE deleted_at < ?1",
        rusqlite::params![cutoff_str],
    )
    .map_err(|e| e.to_string())
}

/// Run tombstone GC using settings from lan_sync_settings.json. Opens its own DB connection.
pub fn run_gc_tombstones() {
    let gc_days = config::load_lan_sync_settings().tombstone_max_age_days;
    if let Ok(conn) = lan_common::open_dashboard_db() {
        match gc_tombstones(&conn, gc_days) {
            Ok(deleted) if deleted > 0 => {
                lan_common::sync_log(&format!("GC: usunięto {} starych tombstones", deleted));
            }
            _ => {}
        }
    }
}

// ── Integrity check ──

pub fn verify_merge_integrity(conn: &rusqlite::Connection) -> Result<(), String> {
    // Before nulling orphan project_id, try to re-attach sessions to local projects
    // by matching project_name → local projects.name. This catches the case where
    // a session's remote project_id points to a project whose name DOES exist
    // locally (possibly with a different local ID).
    let reattached = conn.execute(
        "UPDATE sessions SET project_id = (SELECT id FROM projects WHERE projects.name = sessions.project_name) \
         WHERE sessions.project_name IS NOT NULL AND sessions.project_name != '' \
           AND (sessions.project_id IS NULL \
                OR sessions.project_id NOT IN (SELECT id FROM projects)) \
           AND EXISTS (SELECT 1 FROM projects WHERE projects.name = sessions.project_name)",
        [],
    ).map_err(|e| e.to_string())?;
    if reattached > 0 && diag_logging_enabled() {
        lan_common::sync_log(&format!(
            "  [DIAG] Przywrocono project_id dla {} sesji po nazwie projektu",
            reattached
        ));
    }
    // Diagnostyka: PRZED zerowaniem zlicz pozostałe orphany per project_id
    {
        let mut stmt = conn.prepare(
            "SELECT project_id, COUNT(*) FROM sessions \
             WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects) \
             GROUP BY project_id"
        ).map_err(|e| e.to_string())?;
        let rows: Vec<(i64, i64)> = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        if !rows.is_empty() && diag_logging_enabled() {
            lan_common::sync_log(&format!(
                "  [DIAG] verify_merge_integrity ZARAZ wyzeruje project_id w sesjach: {:?} (project_id → liczba sesji). project_name zachowane.",
                rows
            ));
        }
    }
    // Null out orphan project_id references (FK consistency). project_name is preserved
    // so the UI can still display the project label even without a local project row.
    let orphan_sessions = conn.execute(
        "UPDATE sessions SET project_id = NULL \
         WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects)",
        [],
    ).map_err(|e| e.to_string())?;
    if orphan_sessions > 0 {
        log::warn!("Sync verify: fixed {} sessions with orphan project_id (project_name preserved)", orphan_sessions);
    }

    let orphan_manual = conn.execute(
        "UPDATE manual_sessions SET project_id = 0 \
         WHERE project_id NOT IN (SELECT id FROM projects) AND project_id != 0",
        [],
    ).map_err(|e| e.to_string())?;
    if orphan_manual > 0 {
        log::warn!("Sync verify: fixed {} manual_sessions with orphan project_id", orphan_manual);
    }

    let orphan_apps = conn.execute(
        "UPDATE applications SET project_id = NULL \
         WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects)",
        [],
    ).map_err(|e| e.to_string())?;
    if orphan_apps > 0 {
        log::warn!("Sync verify: fixed {} applications with orphan project_id", orphan_apps);
    }

    // Check FK integrity
    let fk_errors: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA foreign_key_check")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let table: String = row.get(0)?;
                Ok(table)
            })
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };

    if !fk_errors.is_empty() {
        log::warn!("Sync orchestrator: {} FK violations found, cleaning up", fk_errors.len());
        // Delete orphaned sessions (app_id not in applications)
        conn.execute(
            "DELETE FROM sessions WHERE app_id NOT IN (SELECT id FROM applications)",
            [],
        )
        .map_err(|e| e.to_string())?;
    }

    // Integrity check
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    if integrity != "ok" {
        return Err(format!("Integrity check failed: {}", integrity));
    }

    Ok(())
}

// ── JSON helpers (private) ──

fn json_str<'a>(v: &'a serde_json::Value, key: &str) -> &'a str {
    v.get(key).and_then(|v| v.as_str()).unwrap_or("")
}

fn json_str_opt(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

fn json_i64(v: &serde_json::Value, key: &str) -> i64 {
    v.get(key).and_then(|v| v.as_i64()).unwrap_or(0)
}

fn json_f64(v: &serde_json::Value, key: &str) -> f64 {
    v.get(key).and_then(|v| v.as_f64()).unwrap_or(0.0)
}

fn json_f64_opt(v: &serde_json::Value, key: &str) -> Option<f64> {
    v.get(key)
        .and_then(|inner| inner.as_f64())
        .filter(|n| n.is_finite() && *n > 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_ts_iso_format() {
        assert_eq!(normalize_ts("2024-01-15T10:30:00"), "2024-01-15 10:30:00");
    }

    #[test]
    fn test_normalize_ts_already_normalized() {
        assert_eq!(normalize_ts("2024-01-15 10:30:00"), "2024-01-15 10:30:00");
    }

    #[test]
    fn test_normalize_ts_invalid_returns_original() {
        assert_eq!(normalize_ts("invalid"), "invalid");
    }

    #[test]
    fn test_json_helpers() {
        let v: serde_json::Value = serde_json::json!({
            "name": "test",
            "count": 42,
            "rate": 2.5,
            "empty": null
        });
        assert_eq!(json_str(&v, "name"), "test");
        assert_eq!(json_str(&v, "missing"), "");
        assert_eq!(json_i64(&v, "count"), 42);
        assert_eq!(json_i64(&v, "missing"), 0);
        assert!((json_f64(&v, "rate") - 2.5).abs() < f64::EPSILON);
        assert_eq!(json_str_opt(&v, "name"), Some("test".to_string()));
        assert_eq!(json_str_opt(&v, "empty"), None);
    }

    #[test]
    fn test_generate_marker_hash_deterministic() {
        let h1 = generate_marker_hash_simple("abc", "2024-01-01 00:00:00", "dev1");
        let h2 = generate_marker_hash_simple("abc", "2024-01-01 00:00:00", "dev1");
        assert_eq!(h1, h2);
        // Different input → different hash
        let h3 = generate_marker_hash_simple("abc", "2024-01-01 00:00:00", "dev2");
        assert_ne!(h1, h3);
    }

    #[test]
    fn merge_incoming_data_waits_for_merge_mutex() {
        let guard = MERGE_MUTEX.lock().expect("merge mutex lock");
        let (tx, rx) = std::sync::mpsc::channel();

        let handle = std::thread::spawn(move || {
            let mut conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
            let result = merge_incoming_data(&mut conn, "{");
            tx.send(result).expect("send merge result");
        });

        assert!(
            rx.recv_timeout(std::time::Duration::from_millis(50))
                .is_err(),
            "merge should not start parsing while another merge holds the mutex"
        );

        drop(guard);

        let result = rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("merge finishes after mutex release");
        assert!(result
            .expect_err("invalid JSON should fail after mutex release")
            .contains("Failed to parse slave data"));
        handle.join().expect("merge thread joins");
    }

    // ── Diagnostic round-trip test ──
    // Simulates two daemons sharing data via the real sync funnel
    // (build_delta_for_pull → merge_incoming_data, both directions).
    // Run with:  cargo test --release roundtrip -- --ignored --nocapture
    fn open_test_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL DEFAULT '#38bdf8',
                hourly_rate REAL,
                created_at TEXT,
                excluded_at TEXT,
                assigned_folder_path TEXT,
                frozen_at TEXT,
                is_imported INTEGER DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
            );
            CREATE TABLE applications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                executable_name TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                project_id INTEGER,
                is_imported INTEGER DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
            );
            CREATE TABLE sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                date TEXT NOT NULL,
                rate_multiplier REAL NOT NULL DEFAULT 1.0,
                split_source_session_id INTEGER,
                project_id INTEGER,
                project_name TEXT,
                comment TEXT,
                is_hidden INTEGER DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00',
                UNIQUE(app_id, start_time)
            );
            CREATE TABLE manual_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                session_type TEXT NOT NULL,
                project_id INTEGER NOT NULL,
                project_name TEXT,
                app_id INTEGER,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                date TEXT NOT NULL,
                created_at TEXT,
                updated_at TEXT,
                UNIQUE(project_id, start_time, title)
            );
            CREATE TABLE tombstones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                table_name TEXT NOT NULL,
                record_id INTEGER,
                record_uuid TEXT,
                deleted_at TEXT,
                sync_key TEXT
            );
            CREATE TABLE sync_markers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                marker_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                device_id TEXT NOT NULL,
                peer_id TEXT,
                tables_hash TEXT NOT NULL,
                full_sync INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE sync_merge_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sync_timestamp TEXT NOT NULL DEFAULT (datetime('now')),
                table_name TEXT NOT NULL,
                record_key TEXT NOT NULL,
                resolution TEXT NOT NULL DEFAULT 'last_writer_wins',
                local_updated_at TEXT,
                remote_updated_at TEXT,
                winner TEXT NOT NULL,
                details TEXT
            );
            CREATE TABLE system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )
        .expect("schema");
        conn
    }

    #[derive(Debug, PartialEq)]
    struct Counts {
        projects: i64,
        apps: i64,
        sessions: i64,
        manual: i64,
        tombstones: i64,
    }

    fn counts(conn: &rusqlite::Connection) -> Counts {
        let q = |sql: &str| -> i64 {
            conn.query_row(sql, [], |row| row.get(0)).unwrap_or(-1)
        };
        Counts {
            projects: q("SELECT COUNT(*) FROM projects"),
            apps: q("SELECT COUNT(*) FROM applications"),
            sessions: q("SELECT COUNT(*) FROM sessions"),
            manual: q("SELECT COUNT(*) FROM manual_sessions"),
            tombstones: q("SELECT COUNT(*) FROM tombstones"),
        }
    }

    fn query_snapshot_rows(conn: &rusqlite::Connection, sql: &str) -> Vec<String> {
        let mut stmt = conn.prepare(sql).expect("snapshot query");
        stmt.query_map([], |row| row.get::<_, String>(0))
            .expect("snapshot rows")
            .map(|row| row.expect("snapshot row"))
            .collect()
    }

    fn user_data_snapshot(conn: &rusqlite::Connection) -> Vec<String> {
        let mut rows = Vec::new();
        rows.extend(query_snapshot_rows(
            conn,
            "SELECT 'P|' || name || '|' || COALESCE(color, '') || '|' || COALESCE(hourly_rate, '') || '|' || COALESCE(excluded_at, '') || '|' || COALESCE(frozen_at, '')
             FROM projects ORDER BY name",
        ));
        rows.extend(query_snapshot_rows(
            conn,
            "SELECT 'A|' || a.executable_name || '|' || COALESCE(a.display_name, '') || '|' || COALESCE(p.name, '')
             FROM applications a LEFT JOIN projects p ON p.id = a.project_id
             ORDER BY a.executable_name",
        ));
        rows.extend(query_snapshot_rows(
            conn,
            "SELECT 'S|' || a.executable_name || '|' || s.start_time || '|' || s.end_time || '|' || s.duration_seconds || '|' || s.date || '|' || COALESCE(s.rate_multiplier, 1.0) || '|' || COALESCE(p.name, s.project_name, '') || '|' || COALESCE(s.comment, '') || '|' || COALESCE(s.is_hidden, 0)
             FROM sessions s
             JOIN applications a ON a.id = s.app_id
             LEFT JOIN projects p ON p.id = s.project_id
             ORDER BY a.executable_name, s.start_time",
        ));
        rows.extend(query_snapshot_rows(
            conn,
            "SELECT 'M|' || title || '|' || session_type || '|' || start_time || '|' || end_time || '|' || duration_seconds || '|' || date || '|' || COALESCE(p.name, manual_sessions.project_name, CAST(manual_sessions.project_id AS TEXT), '') || '|' || COALESCE(a.executable_name, '')
             FROM manual_sessions
             LEFT JOIN projects p ON p.id = manual_sessions.project_id
             LEFT JOIN applications a ON a.id = manual_sessions.app_id
             ORDER BY title, start_time",
        ));
        rows
    }

    /// Seed disjoint data so master + slave should reach a perfect union.
    /// Prefix is a single character so unique keys never collide across peers.
    fn seed(conn: &rusqlite::Connection, prefix: &str) {
        let ts = "2026-04-20 10:00:00";

        for i in 1..=3 {
            conn.execute(
                "INSERT INTO projects (name, color, updated_at) VALUES (?1, '#abcdef', ?2)",
                rusqlite::params![format!("{}-proj-{}", prefix, i), ts],
            )
            .unwrap();
        }

        for i in 1..=2 {
            conn.execute(
                "INSERT INTO applications (executable_name, display_name, project_id, updated_at) \
                 VALUES (?1, ?2, NULL, ?3)",
                rusqlite::params![
                    format!("{}-app-{}.exe", prefix, i),
                    format!("{} App {}", prefix, i),
                    ts
                ],
            )
            .unwrap();
        }

        let app_ids: Vec<i64> = {
            let mut stmt = conn.prepare("SELECT id FROM applications").unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };
        let project_ids: Vec<i64> = {
            let mut stmt = conn.prepare("SELECT id FROM projects").unwrap();
            stmt.query_map([], |row| row.get(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };

        for i in 1..=5 {
            let st = format!("2026-04-20 1{}:00:00 {}", i, prefix);
            conn.execute(
                "INSERT INTO sessions (app_id, project_id, start_time, end_time, duration_seconds, \
                 date, rate_multiplier, updated_at) VALUES (?1, ?2, ?3, ?4, 600, '2026-04-20', 1.0, ?5)",
                rusqlite::params![
                    app_ids[(i - 1) % app_ids.len()],
                    project_ids[(i - 1) % project_ids.len()],
                    st,
                    format!("2026-04-20 1{}:10:00 {}", i, prefix),
                    ts,
                ],
            )
            .unwrap();
        }

        for i in 1..=2 {
            let st = format!("2026-04-21 09:0{}:00 {}", i, prefix);
            conn.execute(
                "INSERT INTO manual_sessions (title, session_type, project_id, app_id, start_time, \
                 end_time, duration_seconds, date, created_at, updated_at) \
                 VALUES (?1, 'work', ?2, ?3, ?4, ?5, 1800, '2026-04-21', ?6, ?6)",
                rusqlite::params![
                    format!("{}-manual-{}", prefix, i),
                    project_ids[0],
                    app_ids[0],
                    st,
                    format!("2026-04-21 09:30:00 {}", i),
                    ts,
                ],
            )
            .unwrap();
        }
    }

    #[derive(Clone, Copy)]
    enum SimulatorPullMode {
        Delta,
        Full,
    }

    struct LanSyncSimulator {
        master: rusqlite::Connection,
        slave: rusqlite::Connection,
    }

    impl LanSyncSimulator {
        fn new() -> Self {
            Self {
                master: open_test_db(),
                slave: open_test_db(),
            }
        }

        fn seeded() -> Self {
            let sim = Self::new();
            seed(&sim.master, "M");
            seed(&sim.slave, "S");
            sim
        }

        fn run_master_cycle(&mut self, mode: SimulatorPullMode, since: &str) -> Result<(), String> {
            let slave_export = match mode {
                SimulatorPullMode::Delta => build_delta_export(&self.slave, Some(since))?.0,
                SimulatorPullMode::Full => build_full_export(&self.slave)?,
            };

            merge_incoming_data(&mut self.master, &slave_export)?;

            // This mirrors the LAN orchestrator contract: negotiation decides how
            // much master pulls, but slave always receives the final merged state.
            let master_export = build_full_export(&self.master)?;
            merge_incoming_data(&mut self.slave, &master_export)
        }

        fn assert_converged(&self) {
            assert_eq!(user_data_snapshot(&self.master), user_data_snapshot(&self.slave));
        }
    }

    fn query_string(conn: &rusqlite::Connection, sql: &str) -> String {
        conn.query_row(sql, [], |row| row.get(0)).expect("query string")
    }

    #[test]
    fn lan_sync_simulator_delta_and_full_converge_disjoint_data() {
        for mode in [SimulatorPullMode::Delta, SimulatorPullMode::Full] {
            let mut sim = LanSyncSimulator::seeded();
            let m_pre = counts(&sim.master);
            let s_pre = counts(&sim.slave);

            sim.run_master_cycle(mode, "1970-01-01 00:00:00")
                .expect("simulated LAN sync");
            sim.assert_converged();

            let final_counts = counts(&sim.master);
            assert_eq!(final_counts.projects, m_pre.projects + s_pre.projects);
            assert_eq!(final_counts.apps, m_pre.apps + s_pre.apps);
            assert_eq!(final_counts.sessions, m_pre.sessions + s_pre.sessions);
            assert_eq!(final_counts.manual, m_pre.manual + s_pre.manual);
        }
    }

    #[test]
    fn lan_sync_simulator_newer_update_wins_on_both_peers() {
        for mode in [SimulatorPullMode::Delta, SimulatorPullMode::Full] {
            let mut sim = LanSyncSimulator::new();

            sim.master
                .execute(
                    "INSERT INTO applications (executable_name, display_name, updated_at)
                     VALUES ('conflict.exe', 'Older Master Name', '2026-04-20 10:00:00')",
                    [],
                )
                .unwrap();
            sim.slave
                .execute(
                    "INSERT INTO applications (executable_name, display_name, updated_at)
                     VALUES ('conflict.exe', 'Newer Slave Name', '2026-04-20 11:00:00')",
                    [],
                )
                .unwrap();

            sim.run_master_cycle(mode, "1970-01-01 00:00:00")
                .expect("simulated LAN sync");
            sim.assert_converged();

            for conn in [&sim.master, &sim.slave] {
                assert_eq!(
                    query_string(conn, "SELECT display_name FROM applications WHERE executable_name = 'conflict.exe'"),
                    "Newer Slave Name"
                );
            }
        }
    }

    #[test]
    fn lan_sync_simulator_master_delete_wins_over_stale_slave_row() {
        for mode in [SimulatorPullMode::Delta, SimulatorPullMode::Full] {
            let mut sim = LanSyncSimulator::new();

            sim.slave
                .execute(
                    "INSERT INTO applications (executable_name, display_name, updated_at)
                     VALUES ('deleted-on-master.exe', 'Deleted On Master', '2026-04-19 08:00:00')",
                    [],
                )
                .unwrap();
            sim.master
                .execute(
                    "INSERT INTO tombstones (table_name, sync_key, deleted_at)
                     VALUES ('applications', 'deleted-on-master.exe', '2026-04-22 12:00:00')",
                    [],
                )
                .unwrap();

            sim.run_master_cycle(mode, "1970-01-01 00:00:00")
                .expect("simulated LAN sync");
            sim.assert_converged();

            for conn in [&sim.master, &sim.slave] {
                assert!(
                    conn.query_row(
                        "SELECT 1 FROM applications WHERE executable_name = 'deleted-on-master.exe'",
                        [],
                        |_| Ok(()),
                    )
                    .is_err(),
                    "stale row must stay deleted after convergence"
                );
            }
        }
    }

    #[test]
    fn full_master_snapshot_converges_and_keeps_local_deletes() {
        use crate::lan_server::build_full_snapshot_public;

        let mut master = open_test_db();
        let mut slave = open_test_db();

        seed(&master, "M");
        seed(&slave, "S");

        slave
            .execute(
                "INSERT INTO applications (executable_name, display_name, updated_at)
                 VALUES ('deleted-on-master.exe', 'Deleted On Master', '2026-04-19 08:00:00')",
                [],
            )
            .unwrap();
        let deleted_app_id: i64 = slave
            .query_row(
                "SELECT id FROM applications WHERE executable_name = 'deleted-on-master.exe'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        slave
            .execute(
                "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, rate_multiplier, updated_at)
                 VALUES (?1, '2026-04-19 08:00:00', '2026-04-19 08:10:00', 600, '2026-04-19', 1.0, '2026-04-19 08:00:00')",
                [deleted_app_id],
            )
            .unwrap();

        master
            .execute(
                "INSERT INTO tombstones (table_name, sync_key, deleted_at)
                 VALUES ('applications', 'deleted-on-master.exe', '2026-04-22 12:00:00')",
                [],
            )
            .unwrap();

        let slave_export = build_full_snapshot_public(&slave).expect("slave full snapshot");
        merge_incoming_data(&mut master, &slave_export).expect("master merges slave");

        assert!(
            master
                .query_row(
                    "SELECT 1 FROM applications WHERE executable_name = 'deleted-on-master.exe'",
                    [],
                    |_| Ok(()),
                )
                .is_err(),
            "master must not resurrect a row covered by a newer local tombstone"
        );

        let master_export = build_full_snapshot_public(&master).expect("master final snapshot");
        merge_incoming_data(&mut slave, &master_export).expect("slave merges master");

        assert_eq!(user_data_snapshot(&master), user_data_snapshot(&slave));
        assert!(
            slave
                .query_row(
                    "SELECT 1 FROM applications WHERE executable_name = 'deleted-on-master.exe'",
                    [],
                    |_| Ok(()),
                )
                .is_err(),
            "slave must receive master's deletion in the final convergence snapshot"
        );
    }

    /// Both peers share the same application name (e.g. Chrome on both
    /// machines) but with DIFFERENT local IDs — typical real-world state.
    /// Merge resolves by `executable_name`, but each side has its own
    /// sessions tied to the local app row. The roundtrip must preserve
    /// all sessions from both sides.
    fn seed_with_shared_app(conn: &rusqlite::Connection, prefix: &str) {
        let ts = "2026-04-20 10:00:00";

        for i in 1..=2 {
            conn.execute(
                "INSERT INTO projects (name, color, updated_at) VALUES (?1, '#abcdef', ?2)",
                rusqlite::params![format!("{}-proj-{}", prefix, i), ts],
            )
            .unwrap();
        }

        // Shared app: both sides have "chrome.exe" but with their own local id.
        conn.execute(
            "INSERT INTO applications (executable_name, display_name, project_id, updated_at) \
             VALUES ('chrome.exe', 'Chrome', NULL, ?1)",
            rusqlite::params![ts],
        )
        .unwrap();
        // Side-specific app
        conn.execute(
            "INSERT INTO applications (executable_name, display_name, project_id, updated_at) \
             VALUES (?1, ?2, NULL, ?3)",
            rusqlite::params![
                format!("{}-only.exe", prefix),
                format!("{} Only", prefix),
                ts
            ],
        )
        .unwrap();

        let chrome_id: i64 = conn
            .query_row(
                "SELECT id FROM applications WHERE executable_name = 'chrome.exe'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let only_id: i64 = conn
            .query_row(
                "SELECT id FROM applications WHERE executable_name LIKE ?1",
                [format!("{}-only.exe", prefix)],
                |row| row.get(0),
            )
            .unwrap();

        // 5 sessions on shared chrome.exe with start_times that differ by side
        for i in 1..=5 {
            conn.execute(
                "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, \
                 rate_multiplier, updated_at) VALUES (?1, ?2, ?3, 600, '2026-04-20', 1.0, ?4)",
                rusqlite::params![
                    chrome_id,
                    format!("2026-04-20 1{}:00:00 {}", i, prefix),
                    format!("2026-04-20 1{}:10:00 {}", i, prefix),
                    ts,
                ],
            )
            .unwrap();
        }
        // 3 sessions on side-only app
        for i in 1..=3 {
            conn.execute(
                "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, \
                 rate_multiplier, updated_at) VALUES (?1, ?2, ?3, 300, '2026-04-20', 1.0, ?4)",
                rusqlite::params![
                    only_id,
                    format!("2026-04-20 1{}:30:00 {}only", i, prefix),
                    format!("2026-04-20 1{}:35:00 {}only", i, prefix),
                    ts,
                ],
            )
            .unwrap();
        }
    }

    #[test]
    #[ignore]
    fn diagnostic_sync_roundtrip_with_shared_app() {
        use crate::lan_server::build_delta_for_pull_public;

        let mut master = open_test_db();
        let mut slave = open_test_db();

        seed_with_shared_app(&master, "M");
        seed_with_shared_app(&slave, "S");

        let m_pre = counts(&master);
        let s_pre = counts(&slave);
        eprintln!("PRE  master: {:?}", m_pre);
        eprintln!("PRE  slave : {:?}", s_pre);

        let slave_export = build_delta_for_pull_public(&slave, "1970-01-01 00:00:00")
            .expect("slave export");
        merge_incoming_data(&mut master, &slave_export).expect("master merge");

        let master_export = build_delta_for_pull_public(&master, "1970-01-01 00:00:00")
            .expect("master export");
        merge_incoming_data(&mut slave, &master_export).expect("slave merge");

        let m_post = counts(&master);
        let s_post = counts(&slave);
        eprintln!("POST master: {:?}", m_post);
        eprintln!("POST slave : {:?}", s_post);

        // Expected: 4 projects (M-proj-1, M-proj-2, S-proj-1, S-proj-2)
        // 3 apps   (chrome.exe shared, M-only.exe, S-only.exe)
        // 16 sessions (5 chrome + 3 only on each side; start_times differ → no collision)
        let total_proj = 4;
        let total_apps = 3;
        let total_sess = 16;
        eprintln!("EXPECTED both sides: projects={} apps={} sessions={}", total_proj, total_apps, total_sess);

        assert_eq!(m_post.projects, total_proj, "MASTER projects: {} (expected {})", m_post.projects, total_proj);
        assert_eq!(s_post.projects, total_proj, "SLAVE  projects: {} (expected {})", s_post.projects, total_proj);
        assert_eq!(m_post.apps, total_apps, "MASTER apps: {} (expected {})", m_post.apps, total_apps);
        assert_eq!(s_post.apps, total_apps, "SLAVE  apps: {} (expected {})", s_post.apps, total_apps);
        assert_eq!(m_post.sessions, total_sess, "MASTER sessions: {} (expected {})", m_post.sessions, total_sess);
        assert_eq!(s_post.sessions, total_sess, "SLAVE  sessions: {} (expected {})", s_post.sessions, total_sess);
    }

    #[test]
    #[ignore]
    fn diagnostic_sync_roundtrip_does_not_lose_records() {
        use crate::lan_server::build_delta_for_pull_public;

        let mut master = open_test_db();
        let mut slave = open_test_db();

        seed(&master, "M");
        seed(&slave, "S");

        let m_pre = counts(&master);
        let s_pre = counts(&slave);
        eprintln!("PRE  master: {:?}", m_pre);
        eprintln!("PRE  slave : {:?}", s_pre);

        // Step 6 in protocol: master pulls slave (slave exports its own data).
        let slave_export = build_delta_for_pull_public(&slave, "1970-01-01 00:00:00")
            .expect("slave export");
        // Step 9: master merges slave's data.
        merge_incoming_data(&mut master, &slave_export).expect("master merges slave");

        let m_after_pull = counts(&master);
        eprintln!("MID  master: {:?}  (after merging slave)", m_after_pull);

        // Step 11: master builds merged export and uploads to slave.
        let master_export = build_delta_for_pull_public(&master, "1970-01-01 00:00:00")
            .expect("master export");
        // Step 12 (slave side): slave merges merged data from master.
        merge_incoming_data(&mut slave, &master_export).expect("slave merges master");

        let m_post = counts(&master);
        let s_post = counts(&slave);
        eprintln!("POST master: {:?}", m_post);
        eprintln!("POST slave : {:?}", s_post);

        let total_proj = m_pre.projects + s_pre.projects;
        let total_apps = m_pre.apps + s_pre.apps;
        let total_sess = m_pre.sessions + s_pre.sessions;
        let total_man = m_pre.manual + s_pre.manual;
        eprintln!(
            "EXPECTED both sides: projects={} apps={} sessions={} manual={}",
            total_proj, total_apps, total_sess, total_man
        );

        assert_eq!(m_post.projects, total_proj, "MASTER projects: {} (expected {})", m_post.projects, total_proj);
        assert_eq!(s_post.projects, total_proj, "SLAVE  projects: {} (expected {})", s_post.projects, total_proj);
        assert_eq!(m_post.apps, total_apps, "MASTER apps: {} (expected {})", m_post.apps, total_apps);
        assert_eq!(s_post.apps, total_apps, "SLAVE  apps: {} (expected {})", s_post.apps, total_apps);
        assert_eq!(m_post.sessions, total_sess, "MASTER sessions: {} (expected {})", m_post.sessions, total_sess);
        assert_eq!(s_post.sessions, total_sess, "SLAVE  sessions: {} (expected {})", s_post.sessions, total_sess);
        assert_eq!(m_post.manual, total_man, "MASTER manual: {} (expected {})", m_post.manual, total_man);
        assert_eq!(s_post.manual, total_man, "SLAVE  manual: {} (expected {})", s_post.manual, total_man);
    }

    /// Full/convergence sync must propagate deletions. If master has a newer
    /// tombstone for a sync_key and slave still has an older live row, the
    /// deletion wins and both sides converge to the deleted state.
    #[test]
    #[ignore]
    fn diagnostic_full_sync_does_not_lose_records_when_tombstones_present() {
        use crate::lan_server::build_full_snapshot_public;

        let mut master = open_test_db();
        let mut slave = open_test_db();

        // Master: chrome.exe (active) + 5 sessions, plus a historical tombstone
        // for "old-app.exe" that never existed on slave.
        master
            .execute(
                "INSERT INTO applications (executable_name, display_name, updated_at) \
                 VALUES ('chrome.exe', 'Chrome', '2024-01-01 00:00:00')",
                [],
            )
            .unwrap();
        let m_chrome_id: i64 = master
            .query_row(
                "SELECT id FROM applications WHERE executable_name='chrome.exe'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        for i in 1..=5 {
            master
                .execute(
                    "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, \
                     rate_multiplier, updated_at) VALUES (?1, ?2, ?3, 600, '2024-01-01', 1.0, '2024-01-01 00:00:00')",
                    rusqlite::params![
                        m_chrome_id,
                        format!("2024-01-01 0{}:00:00 M", i),
                        format!("2024-01-01 0{}:10:00 M", i),
                    ],
                )
                .unwrap();
        }
        master
            .execute(
                "INSERT INTO tombstones (table_name, sync_key, deleted_at) \
                 VALUES ('applications', 'old-app.exe', '2025-06-01 00:00:00')",
                [],
            )
            .unwrap();

        // Slave: has BOTH chrome.exe AND old-app.exe locally, plus its own sessions.
        // chrome.exe.updated_at is older than master's record (no tombstone, just
        // older). old-app.exe is OLDER than master's tombstone — pre-fix this
        // means master's tombstone wins and slave loses old-app.exe + sessions.
        slave
            .execute(
                "INSERT INTO applications (executable_name, display_name, updated_at) \
                 VALUES ('chrome.exe', 'Chrome', '2023-01-01 00:00:00')",
                [],
            )
            .unwrap();
        slave
            .execute(
                "INSERT INTO applications (executable_name, display_name, updated_at) \
                 VALUES ('old-app.exe', 'Old App', '2023-01-01 00:00:00')",
                [],
            )
            .unwrap();
        let s_chrome_id: i64 = slave
            .query_row(
                "SELECT id FROM applications WHERE executable_name='chrome.exe'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let s_old_id: i64 = slave
            .query_row(
                "SELECT id FROM applications WHERE executable_name='old-app.exe'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        for i in 1..=5 {
            slave
                .execute(
                    "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, \
                     rate_multiplier, updated_at) VALUES (?1, ?2, ?3, 600, '2023-01-01', 1.0, '2023-01-01 00:00:00')",
                    rusqlite::params![
                        s_chrome_id,
                        format!("2023-01-01 0{}:00:00 S", i),
                        format!("2023-01-01 0{}:10:00 S", i),
                    ],
                )
                .unwrap();
        }
        for i in 1..=3 {
            slave
                .execute(
                    "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, \
                     rate_multiplier, updated_at) VALUES (?1, ?2, ?3, 600, '2023-02-01', 1.0, '2023-02-01 00:00:00')",
                    rusqlite::params![
                        s_old_id,
                        format!("2023-02-01 0{}:00:00 S", i),
                        format!("2023-02-01 0{}:10:00 S", i),
                    ],
                )
                .unwrap();
        }

        let m_pre = counts(&master);
        let s_pre = counts(&slave);
        eprintln!("PRE  master: {:?}  (1 active app, 5 sessions, 1 tombstone for old-app.exe)", m_pre);
        eprintln!("PRE  slave : {:?}  (2 apps incl. old-app.exe, 8 sessions)", s_pre);

        // Master flow (full): pulls slave's full snapshot, merges, then exports
        // its final convergence snapshot to slave.
        let slave_export = build_full_snapshot_public(&slave).expect("slave full snapshot");
        merge_incoming_data(&mut master, &slave_export).expect("master merges slave");
        let master_export = build_full_snapshot_public(&master).expect("master full snapshot");
        merge_incoming_data(&mut slave, &master_export).expect("slave merges master");

        let m_post = counts(&master);
        let s_post = counts(&slave);
        eprintln!("POST master: {:?}", m_post);
        eprintln!("POST slave : {:?}", s_post);

        // Both sides should converge to chrome.exe only. old-app.exe is older
        // than master's tombstone, so the delete propagates and its 3 sessions
        // disappear on both sides.
        assert_eq!(m_post.apps, 1, "MASTER should keep only chrome.exe");
        assert_eq!(s_post.apps, 1, "SLAVE should keep only chrome.exe");
        assert_eq!(m_post.sessions, 10, "MASTER sessions {} (expected 10)", m_post.sessions);
        assert_eq!(s_post.sessions, 10, "SLAVE  sessions {} (expected 10)", s_post.sessions);
    }
}
