// LAN Sync Orchestrator — state machine implementing the 13-step sync protocol.
// Runs as a sub-thread spawned when peers are discovered and roles assigned.

use crate::config;
use crate::lan_server::LanSyncState;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const SYNC_TIMEOUT: Duration = Duration::from_secs(300); // 5 min max
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);

// ── Sync state machine ──

#[derive(Debug, Clone, PartialEq)]
pub enum SyncPhase {
    Idle,
    Discovering,
    RoleAssigned,
    RequestingDatabase,   // MASTER: step 3
    Negotiating,          // step 4
    Frozen,               // step 5
    TransferringToMaster, // step 6
    AckReceived,          // step 7
    BackingUp,            // step 8
    Merging,              // step 9
    Verifying,            // step 10
    DistributingToSlave,  // step 11
    SlaveVerifying,       // step 12
    Completed,            // step 13
    Error(String),
}

impl std::fmt::Display for SyncPhase {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SyncPhase::Idle => write!(f, "idle"),
            SyncPhase::Discovering => write!(f, "discovering"),
            SyncPhase::RoleAssigned => write!(f, "role_assigned"),
            SyncPhase::RequestingDatabase => write!(f, "requesting_database"),
            SyncPhase::Negotiating => write!(f, "negotiating"),
            SyncPhase::Frozen => write!(f, "frozen"),
            SyncPhase::TransferringToMaster => write!(f, "transferring_to_master"),
            SyncPhase::AckReceived => write!(f, "ack_received"),
            SyncPhase::BackingUp => write!(f, "backing_up"),
            SyncPhase::Merging => write!(f, "merging"),
            SyncPhase::Verifying => write!(f, "verifying"),
            SyncPhase::DistributingToSlave => write!(f, "distributing_to_slave"),
            SyncPhase::SlaveVerifying => write!(f, "slave_verifying"),
            SyncPhase::Completed => write!(f, "completed"),
            SyncPhase::Error(e) => write!(f, "error: {}", e),
        }
    }
}

#[derive(Debug, Clone)]
pub struct PeerTarget {
    pub ip: String,
    pub port: u16,
    pub device_id: String,
}

// ── HTTP client helpers ──

fn http_get(url: &str) -> Result<String, String> {
    let stream = std::net::TcpStream::connect_timeout(
        &url_to_addr(url)?,
        HTTP_TIMEOUT,
    )
    .map_err(|e| format!("Connect failed: {}", e))?;
    http_request(stream, "GET", url, None)
}

fn http_post(url: &str, body: &str) -> Result<String, String> {
    let stream = std::net::TcpStream::connect_timeout(
        &url_to_addr(url)?,
        HTTP_TIMEOUT,
    )
    .map_err(|e| format!("Connect failed: {}", e))?;
    http_request(stream, "POST", url, Some(body))
}

fn url_to_addr(url: &str) -> Result<std::net::SocketAddr, String> {
    // Parse "http://1.2.3.4:47891/path" → "1.2.3.4:47891"
    let without_scheme = url
        .strip_prefix("http://")
        .unwrap_or(url);
    let host_port = without_scheme.split('/').next().unwrap_or(without_scheme);
    host_port
        .parse()
        .map_err(|e| format!("Invalid address {}: {}", host_port, e))
}

fn url_path(url: &str) -> &str {
    let without_scheme = url.strip_prefix("http://").unwrap_or(url);
    without_scheme.find('/').map(|i| &without_scheme[i..]).unwrap_or("/")
}

fn http_request(
    mut stream: std::net::TcpStream,
    method: &str,
    url: &str,
    body: Option<&str>,
) -> Result<String, String> {
    use std::io::{BufRead, BufReader, Read, Write};

    stream.set_read_timeout(Some(HTTP_TIMEOUT)).map_err(|e| e.to_string())?;
    stream.set_write_timeout(Some(HTTP_TIMEOUT)).map_err(|e| e.to_string())?;

    let path = url_path(url);
    let content_length = body.map(|b| b.len()).unwrap_or(0);

    let request = if let Some(body) = body {
        format!(
            "{} {} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            method, path, content_length, body
        )
    } else {
        format!(
            "{} {} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
            method, path
        )
    };

    stream.write_all(request.as_bytes()).map_err(|e| e.to_string())?;
    stream.flush().map_err(|e| e.to_string())?;

    let mut reader = BufReader::new(&stream);

    // Read status line
    let mut status_line = String::new();
    reader.read_line(&mut status_line).map_err(|e| e.to_string())?;

    // Read headers
    let mut response_content_length: usize = 0;
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).map_err(|e| e.to_string())?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }
        let lower = trimmed.to_ascii_lowercase();
        if let Some(val) = lower.strip_prefix("content-length:") {
            response_content_length = val.trim().parse().unwrap_or(0);
        }
    }

    // Read body
    if response_content_length > 0 {
        let mut buf = vec![0u8; response_content_length];
        reader.read_exact(&mut buf).map_err(|e| e.to_string())?;
        String::from_utf8(buf).map_err(|e| e.to_string())
    } else {
        // Read until connection close
        let mut buf = String::new();
        let _ = reader.read_to_string(&mut buf);
        Ok(buf)
    }
}

// ── Orchestrator ──

const MAX_RETRIES: u32 = 3;

pub fn run_sync_as_master(
    peer: PeerTarget,
    sync_state: Arc<LanSyncState>,
    stop_signal: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        log::info!("Sync orchestrator: starting as MASTER with peer {}:{}", peer.ip, peer.port);
        let start = Instant::now();

        let mut last_err = String::new();
        for attempt in 1..=MAX_RETRIES {
            if stop_signal.load(Ordering::Relaxed) {
                break;
            }
            match execute_master_sync(&peer, &sync_state, &stop_signal) {
                Ok(()) => {
                    log::info!(
                        "Sync orchestrator: completed successfully in {:.1}s (attempt {})",
                        start.elapsed().as_secs_f64(),
                        attempt,
                    );
                    last_err.clear();
                    break;
                }
                Err(e) => {
                    log::error!("Sync orchestrator: attempt {}/{} failed — {}", attempt, MAX_RETRIES, e);
                    sync_state.unfreeze();
                    last_err = e;

                    if attempt < MAX_RETRIES {
                        // Exponential backoff: 5s, 15s, 45s
                        let backoff = Duration::from_secs(5 * 3u64.pow(attempt - 1));
                        log::info!("Sync orchestrator: retrying in {:?}", backoff);
                        thread::sleep(backoff);
                    }
                }
            }
        }

        if !last_err.is_empty() {
            log::error!("Sync orchestrator: all {} attempts failed, last error: {}", MAX_RETRIES, last_err);
        }

        // Reset role after sync
        sync_state.set_role("undecided");
    })
}

fn execute_master_sync(
    peer: &PeerTarget,
    sync_state: &LanSyncState,
    stop_signal: &AtomicBool,
) -> Result<(), String> {
    let base_url = format!("http://{}:{}", peer.ip, peer.port);
    let sync_start = Instant::now();

    // Step 3: Request database — negotiate with SLAVE
    log::info!("Sync orchestrator: step 3 — requesting database from slave");
    let device_id = get_device_id();
    let local_marker = get_local_marker_hash();

    let negotiate_body = serde_json::json!({
        "master_device_id": device_id,
        "master_marker_hash": local_marker,
    });

    let negotiate_resp = http_post(
        &format!("{}/lan/negotiate", base_url),
        &negotiate_body.to_string(),
    )?;

    #[derive(Deserialize)]
    struct NegResp {
        ok: bool,
        mode: String,
        slave_marker_hash: Option<String>,
    }
    let neg: NegResp = serde_json::from_str(&negotiate_resp)
        .map_err(|e| format!("Negotiate parse error: {}", e))?;

    if !neg.ok {
        return Err("Slave rejected negotiation".to_string());
    }

    let transfer_mode = neg.mode.clone();
    log::info!("Sync orchestrator: step 4 — negotiated mode={}", transfer_mode);

    // Check timeout
    if sync_start.elapsed() > SYNC_TIMEOUT || stop_signal.load(Ordering::Relaxed) {
        return Err("Sync timeout or stop signal".to_string());
    }

    // Step 5: Freeze both databases
    log::info!("Sync orchestrator: step 5 — freezing databases");
    sync_state.freeze();

    let freeze_resp = http_post(&format!("{}/lan/freeze-ack", base_url), "{}")?;
    log::debug!("Sync orchestrator: slave freeze response: {}", freeze_resp);

    // Step 6: Pull data from SLAVE
    log::info!("Sync orchestrator: step 6 — pulling data from slave");
    let since = match transfer_mode.as_str() {
        "delta" => neg.slave_marker_hash.as_deref()
            .and_then(|_| get_local_marker_created_at())
            .unwrap_or_else(|| "1970-01-01 00:00:00".to_string()),
        _ => "1970-01-01 00:00:00".to_string(),
    };

    let pull_body = serde_json::json!({
        "device_id": device_id,
        "since": since,
    });

    let slave_data = http_post(
        &format!("{}/lan/pull", base_url),
        &pull_body.to_string(),
    )?;

    log::info!("Sync orchestrator: step 7 — received {} bytes from slave", slave_data.len());

    // Step 8: Backup
    log::info!("Sync orchestrator: step 8 — backing up database");
    backup_database()?;

    // Step 9: Merge
    log::info!("Sync orchestrator: step 9 — merging slave data into master");
    let dir = config::config_dir().map_err(|e| e.to_string())?;
    std::fs::write(dir.join("lan_sync_incoming.json"), &slave_data)
        .map_err(|e| format!("Failed to write incoming data: {}", e))?;

    // The actual merge is done via the dashboard DB
    merge_incoming_data(&slave_data)?;

    // Step 10: Verify
    log::info!("Sync orchestrator: step 10 — verifying merge integrity");
    verify_merge_integrity()?;

    // Generate new marker
    let new_tables_hash = compute_tables_hash_string()?;
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let new_marker = generate_marker_hash_simple(&new_tables_hash, &now, &device_id);
    insert_sync_marker_db(&new_marker, &now, &device_id, Some(&peer.device_id), &new_tables_hash,
        transfer_mode == "full")?;

    {
        let mut guard = sync_state.latest_marker_hash.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some(new_marker.clone());
    }

    // Step 11: Distribute merged data to SLAVE
    log::info!("Sync orchestrator: step 11 — distributing merged database to slave");
    // Build full export for slave
    let merged_export = build_full_export()?;
    std::fs::write(dir.join("lan_sync_merged.json"), &merged_export)
        .map_err(|e| e.to_string())?;

    let ready_body = serde_json::json!({
        "marker_hash": new_marker,
        "transfer_mode": transfer_mode,
    });
    http_post(&format!("{}/lan/db-ready", base_url), &ready_body.to_string())?;

    // SLAVE downloads via GET /lan/download-db (from our server)
    // Wait for slave to verify
    log::info!("Sync orchestrator: step 12 — waiting for slave verification");
    // The slave will call /lan/verify-ack on our server when done

    // Step 13: Unfreeze
    log::info!("Sync orchestrator: step 13 — unfreezing databases");
    sync_state.unfreeze();

    http_post(&format!("{}/lan/unfreeze", base_url), "{}").ok(); // Best-effort

    // Clean up
    let _ = std::fs::remove_file(dir.join("lan_sync_incoming.json"));
    let _ = std::fs::remove_file(dir.join("lan_sync_merged.json"));

    Ok(())
}

// ── DB helper functions ──

fn get_device_id() -> String {
    let dir = match config::config_dir() {
        Ok(d) => d,
        Err(_) => return get_machine_name(),
    };
    let path = dir.join("device_id.txt");
    if let Ok(id) = std::fs::read_to_string(&path) {
        let trimmed = id.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    get_machine_name()
}

fn get_machine_name() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string())
}

fn get_local_marker_hash() -> Option<String> {
    let conn = open_dashboard_db().ok()?;
    conn.query_row(
        "SELECT marker_hash FROM sync_markers ORDER BY created_at DESC LIMIT 1",
        [],
        |row| row.get(0),
    )
    .ok()
}

fn get_local_marker_created_at() -> Option<String> {
    let conn = open_dashboard_db().ok()?;
    conn.query_row(
        "SELECT created_at FROM sync_markers ORDER BY created_at DESC LIMIT 1",
        [],
        |row| row.get(0),
    )
    .ok()
}

fn open_dashboard_db() -> Result<rusqlite::Connection, String> {
    let db_path = config::dashboard_db_path().map_err(|e| e.to_string())?;
    rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Failed to open dashboard DB: {}", e))
}

fn backup_database() -> Result<(), String> {
    let conn = open_dashboard_db()?;
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

fn merge_incoming_data(slave_data: &str) -> Result<(), String> {
    let archive: serde_json::Value = serde_json::from_str(slave_data)
        .map_err(|e| format!("Failed to parse slave data: {}", e))?;

    let mut conn = open_dashboard_db()?;
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
                Some(local_ts) if local_ts >= updated_at.to_string() => {}
                Some(_) => {
                    tx.execute(
                        "UPDATE projects SET color = ?1, hourly_rate = ?2, excluded_at = ?3, \
                         frozen_at = ?4, assigned_folder_path = ?5, updated_at = ?6 WHERE name = ?7",
                        rusqlite::params![
                            json_str(proj, "color"),
                            json_f64(proj, "hourly_rate"),
                            json_str_opt(proj, "excluded_at"),
                            json_str_opt(proj, "frozen_at"),
                            json_str_opt(proj, "assigned_folder_path"),
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
                    if updated_at > local {
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

    // Merge sessions
    if let Some(sessions) = archive.pointer("/data/sessions").and_then(|v| v.as_array()) {
        for sess in sessions {
            let app_id = sess.get("app_id").and_then(|v| v.as_i64()).unwrap_or(0);
            let start_time = sess.get("start_time").and_then(|v| v.as_str()).unwrap_or("");
            let updated_at = sess.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
            if start_time.is_empty() || app_id == 0 {
                continue;
            }

            let existing: Option<(i64, Option<String>)> = tx
                .query_row(
                    "SELECT id, updated_at FROM sessions WHERE app_id = ?1 AND start_time = ?2",
                    rusqlite::params![app_id, start_time],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .ok();

            match existing {
                Some((id, local_ts)) => {
                    let local = local_ts.as_deref().unwrap_or("");
                    if updated_at > local {
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
                            app_id,
                            json_i64_opt(sess, "project_id"),
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

    tx.commit().map_err(|e| e.to_string())?;
    log::info!("Sync orchestrator: merge completed successfully");
    Ok(())
}

fn verify_merge_integrity() -> Result<(), String> {
    let conn = open_dashboard_db()?;

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

fn compute_tables_hash_string() -> Result<String, String> {
    let conn = open_dashboard_db()?;
    let tables = ["projects", "applications", "sessions", "manual_sessions"];
    let mut combined = String::new();
    for table in &tables {
        let hash: String = compute_single_table_hash(&conn, table);
        combined.push_str(&hash);
    }
    Ok(combined)
}

fn compute_single_table_hash(conn: &rusqlite::Connection, table: &str) -> String {
    let sql = match table {
        "projects" => "SELECT COALESCE(hex(sha256(group_concat(name || '|' || updated_at, ';'))), '') FROM (SELECT name, updated_at FROM projects ORDER BY name)",
        "applications" => "SELECT COALESCE(hex(sha256(group_concat(executable_name || '|' || updated_at, ';'))), '') FROM (SELECT executable_name, updated_at FROM applications ORDER BY executable_name)",
        "sessions" => "SELECT COALESCE(hex(sha256(group_concat(app_name || '|' || start_time || '|' || updated_at, ';'))), '') FROM (SELECT a.executable_name AS app_name, s.start_time, s.updated_at FROM sessions s JOIN applications a ON s.app_id = a.id ORDER BY a.executable_name, s.start_time)",
        "manual_sessions" => "SELECT COALESCE(hex(sha256(group_concat(title || '|' || start_time || '|' || updated_at, ';'))), '') FROM (SELECT title, start_time, updated_at FROM manual_sessions ORDER BY title, start_time)",
        _ => return String::new(),
    };
    conn.query_row(sql, [], |row| row.get(0)).unwrap_or_default()
}

fn generate_marker_hash_simple(tables_hash: &str, timestamp: &str, device_id: &str) -> String {
    let conn = match open_dashboard_db() {
        Ok(c) => c,
        Err(_) => return "unknown".to_string(),
    };
    let input = format!("{}{}{}", tables_hash, timestamp, device_id);
    conn.query_row("SELECT lower(hex(sha256(?1)))", [&input], |row| row.get::<_, String>(0))
        .unwrap_or_else(|_| "unknown".to_string())
}

fn insert_sync_marker_db(
    marker_hash: &str,
    created_at: &str,
    device_id: &str,
    peer_id: Option<&str>,
    tables_hash: &str,
    full_sync: bool,
) -> Result<(), String> {
    let conn = open_dashboard_db()?;
    conn.execute(
        "INSERT INTO sync_markers (marker_hash, created_at, device_id, peer_id, tables_hash, full_sync) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![marker_hash, created_at, device_id, peer_id, tables_hash, full_sync as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn build_full_export() -> Result<String, String> {
    let conn = open_dashboard_db()?;
    let device_id = get_device_id();
    let since = "1970-01-01 00:00:00";

    // Reuse the same export logic as lan_server
    crate::lan_server::build_delta_for_pull_public(&conn, since, &device_id)
}

// ── JSON helpers ──

fn json_str<'a>(v: &'a serde_json::Value, key: &str) -> &'a str {
    v.get(key).and_then(|v| v.as_str()).unwrap_or("")
}

fn json_str_opt(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

fn json_i64(v: &serde_json::Value, key: &str) -> i64 {
    v.get(key).and_then(|v| v.as_i64()).unwrap_or(0)
}

fn json_i64_opt(v: &serde_json::Value, key: &str) -> Option<i64> {
    v.get(key).and_then(|v| v.as_i64())
}

fn json_f64(v: &serde_json::Value, key: &str) -> f64 {
    v.get(key).and_then(|v| v.as_f64()).unwrap_or(0.0)
}
