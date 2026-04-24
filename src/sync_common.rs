// sync_common.rs — shared sync utilities used by both LAN and online sync.

use crate::config;
use crate::lan_common;
use crate::lan_server;

use std::sync::Mutex;

pub(crate) static MERGE_MUTEX: Mutex<()> = Mutex::new(());

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
    let since = "1970-01-01 00:00:00";
    lan_server::build_delta_for_pull_public(conn, since)
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
    lan_common::sync_log(&format!(
        "  [DIAG] Projekty: NEW={} ({:?}), UPDATED={} ({:?}), LOCAL_WINS={}",
        diag_proj_new.len(), diag_proj_new,
        diag_proj_updated.len(), diag_proj_updated,
        diag_proj_local_wins
    ));

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
            let local_app_id = match remote_app_id_to_name.get(&remote_app_id)
                .and_then(|name| app_name_to_local_id.get(name))
            {
                Some(&id) => id,
                None => {
                    lan_common::sync_log(&format!("  SKIP sesja (brak lokalnego app_id dla remote={})", remote_app_id));
                    continue;
                }
            };

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

    lan_common::sync_log(&format!(
        "  [DIAG] Sesje: total={}, z remote project_id={}, zresolwowane={}, NIEZRESOLWOWANE_po_nazwie={:?}, remote_id_nieznane={}",
        diag_sess_total, diag_sess_with_remote_pid, diag_sess_resolved_pid,
        diag_sess_unresolved_by_name, diag_sess_unresolved_remote_id_unknown
    ));

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

    // Merge tombstones
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
                        // sync_key = "app_id|start_time"
                        if let Some((_app_id_str, start_time)) = sync_key.split_once('|') {
                            let local_updated: Option<String> = tx
                                .query_row(
                                    "SELECT updated_at FROM sessions WHERE start_time = ?1",
                                    [start_time],
                                    |row| row.get(0),
                                )
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
                        if proj_exists {
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
                        // sync_key = "app_id|start_time" — app_id is local integer, NOT portable
                        // Use start_time (unique within an app) combined with app_id to find session
                        if let Some((app_id_str, start_time)) = sync_key.split_once('|') {
                            // Try to match by app_id + start_time (same machine) or just start_time
                            let deleted = tx.execute(
                                "DELETE FROM sessions WHERE app_id = CAST(?1 AS INTEGER) AND start_time = ?2",
                                rusqlite::params![app_id_str, start_time],
                            ).unwrap_or(0);
                            if deleted == 0 {
                                // Cross-machine: app_id differs, match by start_time alone
                                // (start_time is unique enough per device)
                                let _ = tx.execute(
                                    "DELETE FROM sessions WHERE start_time = ?1",
                                    [start_time],
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
    if reattached > 0 {
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
        if !rows.is_empty() {
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
            "rate": 3.14,
            "empty": null
        });
        assert_eq!(json_str(&v, "name"), "test");
        assert_eq!(json_str(&v, "missing"), "");
        assert_eq!(json_i64(&v, "count"), 42);
        assert_eq!(json_i64(&v, "missing"), 0);
        assert!((json_f64(&v, "rate") - 3.14).abs() < f64::EPSILON);
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
}
