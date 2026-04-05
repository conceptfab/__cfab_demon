// sync_common.rs — shared sync utilities used by both LAN and online sync.

use crate::config;
use crate::lan_common;
use crate::lan_server;

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

pub fn backup_database(conn: &rusqlite::Connection) -> Result<(), String> {
    let dir = config::config_dir().map_err(|e| e.to_string())?;
    let backup_dir = dir.join("sync_backups");
    if !backup_dir.exists() {
        std::fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
    }

    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let dest = backup_dir.join(format!("timeflow_sync_backup_{}.db", timestamp));

    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| e.to_string())?;

    let escaped = dest.to_string_lossy().replace('\'', "''");
    conn.execute_batch(&format!("VACUUM INTO '{}'", escaped))
        .map_err(|e| format!("Backup failed: {}", e))?;

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
    Ok(())
}

/// Restore the most recent sync backup by copying it over the current database.
/// Restore result indicating caller MUST re-open the database connection.
pub struct RestoreResult {
    pub restored_from: std::path::PathBuf,
}

/// Uses file copy since the backup feature may not be enabled in rusqlite.
///
/// SAFETY NOTE: The caller's connection remains open during the file copy.
/// We mitigate this by checkpointing WAL, flushing cache, and removing WAL/SHM
/// files after copy. Callers MUST re-open the connection after restore — the
/// returned `RestoreResult` enforces awareness of this requirement.
pub fn restore_database_backup(conn: &rusqlite::Connection) -> Result<RestoreResult, String> {
    let dir = config::config_dir().map_err(|e| e.to_string())?;
    let backup_dir = dir.join("sync_backups");

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
    let db_path = config::dashboard_db_path().map_err(|e| e.to_string())?;

    // Checkpoint WAL to ensure backup is consistent, then restore via file copy
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| format!("WAL checkpoint failed: {}", e))?;

    // Close the connection's internal cache so file copy is safe
    conn.cache_flush()
        .map_err(|e| format!("Cache flush failed: {}", e))?;

    conn.execute_batch("PRAGMA optimize;").ok();

    std::fs::copy(&latest, &db_path)
        .map_err(|e| format!("File copy restore failed: {}", e))?;

    // Remove WAL and SHM files that may reference the old database state
    let wal_path = db_path.with_extension("db-wal");
    let shm_path = db_path.with_extension("db-shm");
    let _ = std::fs::remove_file(&wal_path);
    let _ = std::fs::remove_file(&shm_path);

    log::warn!("Database restored from backup: {:?}. Caller MUST re-open connection.", latest);
    Ok(RestoreResult { restored_from: latest })
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
/// Handles `2024-01-02T15:04:05`, `2024-01-02T15:04:05Z`, `2024-01-02 15:04:05`, etc.
fn normalize_ts(ts: &str) -> String {
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
    let archive: serde_json::Value = serde_json::from_str(slave_data)
        .map_err(|e| format!("Failed to parse slave data: {}", e))?;

    // Log counts for visibility
    let count = |path: &str| archive.pointer(path).and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
    lan_common::sync_log(&format!("  Dane peera: {} projektow, {} aplikacji, {} sesji, {} sesji manualnych, {} tombstones",
        count("/data/projects"), count("/data/applications"), count("/data/sessions"),
        count("/data/manual_sessions"), count("/data/tombstones")));

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Merge projects
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
                }
                Some(ref local_ts) => {
                    log_merge_conflict(&tx, "projects", name, local_ts, updated_at, "remote");
                    // Note: assigned_folder_path is machine-specific — never overwrite from remote
                    tx.execute(
                        "UPDATE projects SET color = ?1, hourly_rate = ?2, excluded_at = ?3, \
                         frozen_at = ?4, updated_at = ?5 WHERE name = ?6",
                        rusqlite::params![
                            json_str(proj, "color"),
                            json_f64(proj, "hourly_rate"),
                            json_str_opt(proj, "excluded_at"),
                            json_str_opt(proj, "frozen_at"),
                            updated_at,
                            name,
                        ],
                    ).map_err(|e| e.to_string())?;
                }
                None => {
                    tx.execute(
                        "INSERT INTO projects (name, color, hourly_rate, created_at, excluded_at, \
                         frozen_at, assigned_folder_path, is_imported, updated_at) \
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8)",
                        rusqlite::params![
                            name,
                            json_str(proj, "color"),
                            json_f64(proj, "hourly_rate"),
                            json_str(proj, "created_at"),
                            json_str_opt(proj, "excluded_at"),
                            json_str_opt(proj, "frozen_at"),
                            json_str_opt(proj, "assigned_folder_path"),
                            updated_at,
                        ],
                    ).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    // Merge applications
    if let Some(apps) = archive.pointer("/data/applications").and_then(|v| v.as_array()) {
        for app in apps {
            let exe_name = app.get("executable_name").and_then(|v| v.as_str()).unwrap_or("");
            let updated_at = app.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
            if exe_name.is_empty() {
                continue;
            }

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
                        tx.execute(
                            "UPDATE applications SET display_name = ?1, updated_at = ?2 WHERE executable_name = ?3",
                            rusqlite::params![
                                json_str_opt(app, "display_name"),
                                updated_at,
                                exe_name,
                            ],
                        ).map_err(|e| e.to_string())?;
                    }
                }
                None => {
                    tx.execute(
                        "INSERT INTO applications (executable_name, display_name, is_imported, updated_at) \
                         VALUES (?1, ?2, 1, ?3)",
                        rusqlite::params![exe_name, json_str_opt(app, "display_name"), updated_at],
                    ).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    // Build ID maps: remote ID → name, local name → ID
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

    // Merge sessions (using local IDs resolved via name maps)
    if let Some(sessions) = archive.pointer("/data/sessions").and_then(|v| v.as_array()) {
        for sess in sessions {
            let remote_app_id = sess.get("app_id").and_then(|v| v.as_i64()).unwrap_or(0);
            let start_time = sess.get("start_time").and_then(|v| v.as_str()).unwrap_or("");
            let updated_at = sess.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
            if start_time.is_empty() || remote_app_id == 0 {
                continue;
            }

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
            let local_project_id: Option<i64> = sess.get("project_id").and_then(|v| v.as_i64())
                .and_then(|rid| remote_project_id_to_name.get(&rid))
                .and_then(|name| project_name_to_local_id.get(name))
                .copied();

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
                        tx.execute(
                            "UPDATE sessions SET end_time = ?1, duration_seconds = ?2, \
                             rate_multiplier = ?3, comment = ?4, is_hidden = ?5, \
                             updated_at = ?6 WHERE id = ?7",
                            rusqlite::params![
                                json_str_opt(sess, "end_time"),
                                json_i64(sess, "duration_seconds"),
                                json_f64(sess, "rate_multiplier"),
                                json_str_opt(sess, "comment"),
                                json_i64(sess, "is_hidden"),
                                updated_at,
                                id,
                            ],
                        ).map_err(|e| e.to_string())?;
                    }
                }
                None => {
                    tx.execute(
                        "INSERT OR IGNORE INTO sessions (app_id, project_id, start_time, end_time, \
                         duration_seconds, date, rate_multiplier, comment, is_hidden, updated_at) \
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                        rusqlite::params![
                            local_app_id,
                            local_project_id,
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
                // Delete the record
                match table_name {
                    "projects" => { let _ = tx.execute("DELETE FROM projects WHERE name = ?1", [sync_key]); }
                    "applications" => { let _ = tx.execute("DELETE FROM applications WHERE executable_name = ?1", [sync_key]); }
                    _ => {}
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
