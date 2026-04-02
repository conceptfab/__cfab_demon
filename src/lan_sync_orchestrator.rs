// LAN Sync Orchestrator — state machine implementing the 13-step sync protocol.
// Runs as a sub-thread spawned when peers are discovered and roles assigned.

use crate::lan_common;
use crate::lan_server::LanSyncState;
use crate::sync_common;
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
    let status_code: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

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
        let body = String::from_utf8(buf).map_err(|e| e.to_string())?;
        if status_code >= 400 {
            return Err(format!("HTTP {}: {}", status_code, body.chars().take(200).collect::<String>()));
        }
        Ok(body)
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
        let body = String::from_utf8(buf).map_err(|e| e.to_string())?;
        if status_code >= 400 {
            return Err(format!("HTTP {}: {}", status_code, body.chars().take(200).collect::<String>()));
        }
        Ok(body)
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
    let mut conn = sync_common::open_dashboard_db()?;

    // Step 3: Negotiate with SLAVE
    sync_state.set_progress(3, "negotiating", "local");
    sync_log(&format!("[3/13] Negocjacja z peerem {}:{} ...", peer.ip, peer.port));
    let device_id = sync_common::get_device_id();
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
    sync_common::backup_database().map_err(|e| { sync_log(&format!("[8/13] BLAD backup: {}", e)); e })?;
    sync_log("[8/13] Kopia zapasowa utworzona");

    // Step 9: Merge
    sync_state.set_progress(9, "merging", "local");
    sync_log("[9/13] Scalanie danych peera z lokalna baza...");
    let dir = crate::config::config_dir().map_err(|e| e.to_string())?;
    std::fs::write(dir.join("lan_sync_incoming.json"), &slave_data)
        .map_err(|e| format!("Failed to write incoming data: {}", e))?;

    sync_common::merge_incoming_data(&mut conn, &slave_data)
        .map_err(|e| { sync_log(&format!("[9/13] BLAD scalania: {}", e)); e })?;
    sync_log("[9/13] Scalanie zakonczone");

    // Step 10: Verify
    sync_state.set_progress(10, "verifying", "local");
    sync_log("[10/13] Weryfikacja integralnosci bazy...");
    sync_common::verify_merge_integrity(&conn)
        .map_err(|e| { sync_log(&format!("[10/13] BLAD weryfikacji: {}", e)); e })?;
    sync_log("[10/13] Baza zweryfikowana — OK");

    // Generate new sync marker
    let new_tables_hash = sync_common::compute_tables_hash_string_conn(&conn);
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let new_marker = sync_common::generate_marker_hash_simple(&new_tables_hash, &now, &device_id);
    sync_common::insert_sync_marker_db(&conn, &new_marker, &now, &device_id, Some(&peer.device_id), &new_tables_hash,
        transfer_mode == "full")?;
    sync_log(&format!("[10/13] Nowy marker: {}", &new_marker[..16.min(new_marker.len())]));

    {
        let mut guard = sync_state.latest_marker_hash.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some(new_marker.clone());
    }

    // Step 11: Upload merged data to SLAVE
    sync_state.set_progress(11, "uploading_to_slave", "upload");
    sync_log("[11/13] Budowanie pelnego eksportu dla peera...");
    let merged_export = sync_common::build_full_export(&conn)
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

// ── DB helper functions (local only) ──

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

