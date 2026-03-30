// LAN Sync Orchestrator — state machine implementing the 13-step sync protocol.
// Runs as a sub-thread spawned when peers are discovered and roles assigned.

use crate::config;
use crate::lan_common;
use crate::lan_server::LanSyncState;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const SYNC_TIMEOUT: Duration = Duration::from_secs(300); // 5 min max
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);

fn sync_log(msg: &str) {
    lan_common::sync_log(msg);
}

// ── Sync types ──

#[derive(Debug, Clone)]
pub struct PeerTarget {
    pub ip: String,
    pub port: u16,
    pub device_id: String,
}

// ── HTTP client helpers ──

fn http_post(url: &str, body: &str) -> Result<String, String> {
    let stream = std::net::TcpStream::connect_timeout(
        &url_to_addr(url)?,
        HTTP_TIMEOUT,
    )
    .map_err(|e| format!("Connect failed: {}", e))?;
    http_request(stream, "POST", url, Some(body), None)
}

/// HTTP POST with progress callback — used for large data transfers.
fn http_post_with_progress(
    url: &str,
    body: &str,
    on_progress: impl Fn(u64, u64),
) -> Result<String, String> {
    let stream = std::net::TcpStream::connect_timeout(
        &url_to_addr(url)?,
        HTTP_TIMEOUT,
    )
    .map_err(|e| format!("Connect failed: {}", e))?;
    http_request(stream, "POST", url, Some(body), Some(&on_progress))
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
    on_progress: Option<&dyn Fn(u64, u64)>,
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

    // Read body — chunked with progress reporting
    if response_content_length > 0 {
        let total = response_content_length as u64;
        let mut buf = vec![0u8; response_content_length];
        let mut read_so_far: usize = 0;
        const CHUNK: usize = 64 * 1024; // 64 KB chunks

        while read_so_far < response_content_length {
            let end = (read_so_far + CHUNK).min(response_content_length);
            reader.read_exact(&mut buf[read_so_far..end])
                .map_err(|e| e.to_string())?;
            read_so_far = end;
            if let Some(cb) = &on_progress {
                cb(read_so_far as u64, total);
            }
        }
        String::from_utf8(buf).map_err(|e| e.to_string())
    } else {
        // Read until connection close — report progress periodically
        let mut buf = Vec::new();
        let mut tmp = [0u8; 64 * 1024];
        loop {
            match reader.read(&mut tmp) {
                Ok(0) => break,
                Ok(n) => {
                    buf.extend_from_slice(&tmp[..n]);
                    if let Some(cb) = &on_progress {
                        cb(buf.len() as u64, 0); // total unknown
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut => break,
                Err(e) => return Err(e.to_string()),
            }
        }
        String::from_utf8(buf).map_err(|e| e.to_string())
    }
}

// ── Orchestrator ──

const MAX_RETRIES: u32 = 3;

pub fn run_sync_as_master(
    peer: PeerTarget,
    sync_state: Arc<LanSyncState>,
    stop_signal: Arc<AtomicBool>,
) -> JoinHandle<()> {
    run_sync_as_master_with_options(peer, sync_state, stop_signal, false)
}

pub fn run_sync_as_master_with_options(
    peer: PeerTarget,
    sync_state: Arc<LanSyncState>,
    stop_signal: Arc<AtomicBool>,
    force: bool,
) -> JoinHandle<()> {
    thread::spawn(move || {
        sync_log(&format!("=== START SYNC z {}:{} {} ===",
            peer.ip, peer.port, if force { "[FORCE]" } else { "" }));
        sync_state.set_progress(1, "starting", "local");
        let _start = Instant::now();

        let mut last_err = String::new();
        for attempt in 1..=MAX_RETRIES {
            if stop_signal.load(Ordering::Relaxed) {
                sync_log("[!] Stop signal — przerywam sync");
                break;
            }
            if attempt > 1 {
                sync_log(&format!("[!] Ponowna proba {}/{}", attempt, MAX_RETRIES));
            }
            match execute_master_sync(&peer, &sync_state, &stop_signal, force) {
                Ok(()) => {
                    last_err.clear();
                    break;
                }
                Err(e) => {
                    sync_log(&format!("[!] Proba {}/{} nieudana: {}", attempt, MAX_RETRIES, e));
                    sync_state.unfreeze();
                    sync_state.reset_progress();
                    last_err = e;

                    if attempt < MAX_RETRIES {
                        let backoff = Duration::from_secs(5 * 3u64.pow(attempt - 1));
                        sync_log(&format!("[!] Ponowienie za {:?}...", backoff));
                        let deadline = Instant::now() + backoff;
                        while Instant::now() < deadline {
                            if stop_signal.load(Ordering::Relaxed) {
                                sync_log("[!] Stop signal podczas backoff — przerywam");
                                return;
                            }
                            thread::sleep(Duration::from_secs(1));
                        }
                    }
                }
            }
        }

        if !last_err.is_empty() {
            sync_log(&format!("=== SYNC NIEUDANY po {} probach: {} ===", MAX_RETRIES, last_err));
        }

        sync_state.set_role("undecided");
    })
}

fn execute_master_sync(
    peer: &PeerTarget,
    sync_state: &LanSyncState,
    stop_signal: &AtomicBool,
    force: bool,
) -> Result<(), String> {
    let base_url = format!("http://{}:{}", peer.ip, peer.port);
    let sync_start = Instant::now();

    // Open single DB connection for entire sync flow
    let mut conn = open_dashboard_db()?;

    // Step 3: Negotiate with SLAVE
    sync_state.set_progress(3, "negotiating", "local");
    sync_log(&format!("[3/13] Negocjacja z peerem {}:{} ...", peer.ip, peer.port));
    let device_id = get_device_id();
    let local_marker = get_local_marker_hash_with_conn(&conn);

    let negotiate_body = serde_json::json!({
        "master_device_id": device_id,
        "master_marker_hash": local_marker,
    });

    let negotiate_resp = http_post(
        &format!("{}/lan/negotiate", base_url),
        &negotiate_body.to_string(),
    ).map_err(|e| { sync_log(&format!("[3/13] BLAD negocjacji: {}", e)); e })?;

    #[derive(Deserialize)]
    struct NegResp {
        ok: bool,
        mode: String,
        slave_marker_hash: Option<String>,
    }
    let neg: NegResp = serde_json::from_str(&negotiate_resp)
        .map_err(|e| { sync_log(&format!("[3/13] BLAD parsowania: {}", e)); format!("Negotiate parse error: {}", e) })?;

    if !neg.ok {
        sync_log("[3/13] Peer odrzucil negocjacje");
        return Err("Slave rejected negotiation".to_string());
    }

    // Step 4: Mode established
    let transfer_mode = if force {
        sync_log("[4/13] FORCE MODE — wymuszam pelny transfer");
        "full".to_string()
    } else {
        neg.mode.clone()
    };
    sync_state.set_progress(4, "negotiated", "local");
    sync_log(&format!("[4/13] Tryb: {} | marker local={:?} remote={:?}",
        transfer_mode, local_marker, neg.slave_marker_hash));

    if sync_start.elapsed() > SYNC_TIMEOUT || stop_signal.load(Ordering::Relaxed) {
        sync_log("[!] Timeout lub stop signal");
        return Err("Sync timeout or stop signal".to_string());
    }

    // Step 5: Freeze both databases
    sync_state.set_progress(5, "freezing", "local");
    sync_log("[5/13] Zamrazanie baz danych (master + slave)...");
    sync_state.freeze();
    if let Err(e) = http_post(&format!("{}/lan/freeze-ack", base_url), "{}") {
        sync_log(&format!("[5/13] BLAD freeze slave: {} — rollback master freeze", e));
        sync_state.unfreeze();
        return Err(e);
    }
    sync_log("[5/13] Obie bazy zamrozone");

    // Step 6: Pull data from SLAVE
    sync_state.set_progress(6, "downloading_from_slave", "download");
    let since = match transfer_mode.as_str() {
        "delta" => neg.slave_marker_hash.as_deref()
            .and_then(|_| get_local_marker_created_at_with_conn(&conn))
            .unwrap_or_else(|| "1970-01-01 00:00:00".to_string()),
        _ => "1970-01-01 00:00:00".to_string(),
    };
    sync_log(&format!("[6/13] Pobieranie danych z peera (since={})...", since));

    let pull_body = serde_json::json!({
        "device_id": device_id,
        "since": since,
    });

    let slave_data = http_post_with_progress(
        &format!("{}/lan/pull", base_url),
        &pull_body.to_string(),
        |transferred, total| {
            sync_state.update_transfer_bytes(transferred, total);
        },
    ).map_err(|e| { sync_log(&format!("[6/13] BLAD pobierania: {}", e)); e })?;

    sync_state.set_progress(7, "received_from_slave", "local");
    let slave_kb = slave_data.len() as f64 / 1024.0;
    sync_log(&format!("[7/13] Odebrano {:.1} KB danych z peera", slave_kb));

    // Step 8: Backup
    sync_state.set_progress(8, "backing_up", "local");
    sync_log("[8/13] Tworzenie kopii zapasowej bazy...");
    backup_database().map_err(|e| { sync_log(&format!("[8/13] BLAD backup: {}", e)); e })?;
    sync_log("[8/13] Kopia zapasowa utworzona");

    // Step 9: Merge
    sync_state.set_progress(9, "merging", "local");
    sync_log("[9/13] Scalanie danych peera z lokalna baza...");
    let dir = config::config_dir().map_err(|e| e.to_string())?;
    std::fs::write(dir.join("lan_sync_incoming.json"), &slave_data)
        .map_err(|e| format!("Failed to write incoming data: {}", e))?;

    merge_incoming_data(&mut conn, &slave_data)
        .map_err(|e| { sync_log(&format!("[9/13] BLAD scalania: {}", e)); e })?;
    sync_log("[9/13] Scalanie zakonczone");

    // Step 10: Verify
    sync_state.set_progress(10, "verifying", "local");
    sync_log("[10/13] Weryfikacja integralnosci bazy...");
    verify_merge_integrity(&conn)
        .map_err(|e| { sync_log(&format!("[10/13] BLAD weryfikacji: {}", e)); e })?;
    sync_log("[10/13] Baza zweryfikowana — OK");

    // Generate new sync marker
    let new_tables_hash = compute_tables_hash_string_conn(&conn);
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let new_marker = generate_marker_hash_simple(&new_tables_hash, &now, &device_id);
    insert_sync_marker_db(&conn, &new_marker, &now, &device_id, Some(&peer.device_id), &new_tables_hash,
        transfer_mode == "full")?;
    sync_log(&format!("[10/13] Nowy marker: {}", &new_marker[..16.min(new_marker.len())]));

    {
        let mut guard = sync_state.latest_marker_hash.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some(new_marker.clone());
    }

    // Step 11: Upload merged data to SLAVE
    sync_state.set_progress(11, "uploading_to_slave", "upload");
    sync_log("[11/13] Budowanie pelnego eksportu dla peera...");
    let merged_export = build_full_export(&conn)
        .map_err(|e| { sync_log(&format!("[11/13] BLAD budowania eksportu: {}", e)); e })?;
    let export_kb = merged_export.len() as f64 / 1024.0;
    sync_log(&format!("[11/13] Wysylanie {:.1} KB do peera...", export_kb));

    std::fs::write(dir.join("lan_sync_merged.json"), &merged_export)
        .map_err(|e| e.to_string())?;

    let ready_body = serde_json::json!({
        "marker_hash": new_marker,
        "transfer_mode": transfer_mode,
    });
    sync_state.update_transfer_bytes(merged_export.len() as u64, merged_export.len() as u64);
    http_post(&format!("{}/lan/db-ready", base_url), &ready_body.to_string())
        .map_err(|e| { sync_log(&format!("[11/13] BLAD wysylania db-ready: {}", e)); e })?;
    sync_log("[11/13] Peer poinformowany — dane gotowe do pobrania");

    // Step 12: Wait for slave to download and verify
    sync_state.set_progress(12, "slave_downloading", "upload");
    sync_log("[12/13] Peer pobiera i importuje dane...");

    // Step 13: Unfreeze + cleanup
    sync_log("[13/13] Odmrazanie baz danych...");
    sync_state.unfreeze();
    http_post(&format!("{}/lan/unfreeze", base_url), "{}").ok();
    sync_log("[13/13] Bazy odmrozone — zbieranie danych wznowione");

    // Clean up temp files
    let _ = std::fs::remove_file(dir.join("lan_sync_incoming.json"));
    let _ = std::fs::remove_file(dir.join("lan_sync_merged.json"));

    let elapsed = sync_start.elapsed().as_secs_f64();
    sync_log(&format!("=== SYNC ZAKONCZONY w {:.1}s (tryb: {}) ===", elapsed, transfer_mode));

    // Set completed AFTER unfreeze — stays visible for UI polling
    sync_state.set_progress(13, "completed", "local");

    Ok(())
}

// ── DB helper functions ──

fn get_device_id() -> String {
    lan_common::get_device_id()
}

fn get_local_marker_hash_with_conn(conn: &rusqlite::Connection) -> Option<String> {
    conn.query_row(
        "SELECT marker_hash FROM sync_markers ORDER BY created_at DESC LIMIT 1",
        [],
        |row| row.get(0),
    )
    .ok()
}

fn get_local_marker_created_at_with_conn(conn: &rusqlite::Connection) -> Option<String> {
    conn.query_row(
        "SELECT created_at FROM sync_markers ORDER BY created_at DESC LIMIT 1",
        [],
        |row| row.get(0),
    )
    .ok()
}

fn open_dashboard_db() -> Result<rusqlite::Connection, String> {
    lan_common::open_dashboard_db()
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

fn merge_incoming_data(conn: &mut rusqlite::Connection, slave_data: &str) -> Result<(), String> {
    let archive: serde_json::Value = serde_json::from_str(slave_data)
        .map_err(|e| format!("Failed to parse slave data: {}", e))?;

    // Log counts for visibility
    let count = |path: &str| archive.pointer(path).and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
    sync_log(&format!("  Dane peera: {} projektow, {} aplikacji, {} sesji, {} sesji manualnych, {} tombstones",
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
                    sync_log(&format!("  SKIP sesja (brak lokalnego app_id dla remote={})", remote_app_id));
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
                    if updated_at > local {
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

    tx.commit().map_err(|e| e.to_string())?;
    sync_log("  Scalanie zakonczone — commit transakcji");
    Ok(())
}

fn verify_merge_integrity(conn: &rusqlite::Connection) -> Result<(), String> {

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

fn compute_tables_hash_string_conn(conn: &rusqlite::Connection) -> String {
    lan_common::compute_tables_hash_string(conn)
}

fn generate_marker_hash_simple(tables_hash: &str, timestamp: &str, device_id: &str) -> String {
    lan_common::generate_marker_hash(tables_hash, timestamp, device_id)
}

fn insert_sync_marker_db(
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

fn build_full_export(conn: &rusqlite::Connection) -> Result<String, String> {
    let since = "1970-01-01 00:00:00";
    crate::lan_server::build_delta_for_pull_public(conn, since)
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

fn json_f64(v: &serde_json::Value, key: &str) -> f64 {
    v.get(key).and_then(|v| v.as_f64()).unwrap_or(0.0)
}
