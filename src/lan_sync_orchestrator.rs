// LAN Sync Orchestrator — state machine implementing the 13-step sync protocol.
// Runs as a sub-thread spawned when peers are discovered and roles assigned.

use crate::lan_common;
use crate::lan_common::sync_log;
use crate::lan_server::LanSyncState;
use crate::sync_common;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const SYNC_TIMEOUT: Duration = Duration::from_secs(300); // 5 min max

/// RAII guard that removes temporary files on drop (even on early return / panic).
struct TempFileGuard {
    paths: Vec<std::path::PathBuf>,
}

impl TempFileGuard {
    fn new() -> Self {
        Self { paths: Vec::new() }
    }

    fn track(&mut self, path: std::path::PathBuf) {
        self.paths.push(path);
    }
}

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        for path in &self.paths {
            let _ = std::fs::remove_file(path);
        }
    }
}
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_RESPONSE_BODY: usize = 100 * 1024 * 1024; // 100 MB — prevent OOM from malicious Content-Length

// ── Sync types ──

#[derive(Debug, Clone)]
pub struct PeerTarget {
    pub ip: String,
    pub port: u16,
    pub device_id: String,
}

// ── HTTP client helpers ──

/// Resolve the secret to use for a given peer: paired secret first, fallback to local.
fn resolve_peer_secret(peer_device_id: &str) -> String {
    if let Some(secret) = crate::lan_pairing::get_paired_secret(peer_device_id) {
        return secret;
    }
    crate::lan_server::lan_secret()
}

fn http_post(url: &str, body: &str, secret: &str) -> Result<String, String> {
    let stream = std::net::TcpStream::connect_timeout(
        &url_to_addr(url)?,
        HTTP_TIMEOUT,
    )
    .map_err(|e| format!("Connect failed: {}", e))?;
    http_request(stream, "POST", url, Some(body), None, secret)
}

/// HTTP POST with custom timeout — used when slave needs more time (e.g. import).
fn http_post_with_timeout(url: &str, body: &str, timeout: Duration, secret: &str) -> Result<String, String> {
    let stream = std::net::TcpStream::connect_timeout(
        &url_to_addr(url)?,
        timeout,
    )
    .map_err(|e| format!("Connect failed: {}", e))?;
    http_request_with_timeout(stream, "POST", url, Some(body), None, timeout, secret)
}

/// HTTP POST with progress callback — used for large data transfers.
fn http_post_with_progress(
    url: &str,
    body: &str,
    on_progress: impl Fn(u64, u64),
    secret: &str,
) -> Result<String, String> {
    let stream = std::net::TcpStream::connect_timeout(
        &url_to_addr(url)?,
        HTTP_TIMEOUT,
    )
    .map_err(|e| format!("Connect failed: {}", e))?;
    http_request(stream, "POST", url, Some(body), Some(&on_progress), secret)
}

fn url_to_addr(url: &str) -> Result<std::net::SocketAddr, String> {
    // Parse "http://1.2.3.4:47891/path" or "http://[::1]:47891/path" → SocketAddr
    let without_scheme = url
        .strip_prefix("http://")
        .unwrap_or(url);
    // For IPv6, bracket notation [::1]:port — find the closing ']' first
    let host_port = if without_scheme.starts_with('[') {
        // IPv6: find ']:port' then skip anything after the next '/'
        let end = without_scheme.find("]/")
            .map(|i| i + 1) // include the ']'
            .unwrap_or(without_scheme.find(']').map(|i| i + 1).unwrap_or(without_scheme.len()));
        // Include :port after ']'
        let rest = &without_scheme[end..];
        let port_end = rest.find('/').unwrap_or(rest.len());
        &without_scheme[..end + port_end]
    } else {
        without_scheme.split('/').next().unwrap_or(without_scheme)
    };
    host_port
        .parse()
        .map_err(|e| format!("Invalid address {}: {}", host_port, e))
}

fn url_path(url: &str) -> &str {
    let without_scheme = url.strip_prefix("http://").unwrap_or(url);
    without_scheme.find('/').map(|i| &without_scheme[i..]).unwrap_or("/")
}

fn http_request(
    stream: std::net::TcpStream,
    method: &str,
    url: &str,
    body: Option<&str>,
    on_progress: Option<&dyn Fn(u64, u64)>,
    secret: &str,
) -> Result<String, String> {
    http_request_with_timeout(stream, method, url, body, on_progress, HTTP_TIMEOUT, secret)
}

fn http_request_with_timeout(
    mut stream: std::net::TcpStream,
    method: &str,
    url: &str,
    body: Option<&str>,
    on_progress: Option<&dyn Fn(u64, u64)>,
    timeout: Duration,
    secret: &str,
) -> Result<String, String> {
    use std::io::{BufRead, BufReader, Read, Write};

    stream.set_read_timeout(Some(timeout)).map_err(|e| e.to_string())?;
    stream.set_write_timeout(Some(timeout)).map_err(|e| e.to_string())?;

    let path = url_path(url);
    let content_length = body.map(|b| b.len()).unwrap_or(0);

    let request = if let Some(body) = body {
        format!(
            "{} {} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\nX-TimeFlow-Secret: {}\r\nConnection: close\r\n\r\n{}",
            method, path, content_length, secret, body
        )
    } else {
        format!(
            "{} {} HTTP/1.1\r\nHost: localhost\r\nX-TimeFlow-Secret: {}\r\nConnection: close\r\n\r\n",
            method, path, secret
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

    if status_code == 401 {
        return Err("pairing_invalid: 401 Unauthorized — device may need re-pairing".to_string());
    }

    // Read headers
    let mut response_content_length: usize = 0;
    let mut content_type = String::new();
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
        if let Some(val) = lower.strip_prefix("content-type:") {
            content_type = val.trim().to_string();
        }
    }

    // Validate content-type for sync data responses
    if status_code == 200 && response_content_length > 0
        && !content_type.is_empty()
        && !content_type.contains("json") && !content_type.contains("octet-stream")
    {
        log::warn!("Unexpected content-type from LAN peer: {}", content_type);
    }

    // Read body — chunked with progress reporting
    if response_content_length > MAX_RESPONSE_BODY {
        return Err(format!(
            "Response too large: {} bytes (max {})",
            response_content_length, MAX_RESPONSE_BODY
        ));
    }
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
                    if buf.len() > MAX_RESPONSE_BODY {
                        return Err(format!(
                            "Response body without Content-Length exceeded {} bytes limit",
                            MAX_RESPONSE_BODY
                        ));
                    }
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
        sync_state.set_sync_type("lan");
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
                    // Unfreeze DB but keep sync_in_progress = true to prevent
                    // another thread from starting a concurrent sync during backoff.
                    sync_state.db_frozen.store(false, Ordering::SeqCst);
                    // Unfreeze slave too — otherwise slave stays frozen until auto-unfreeze (5 min)
                    let slave_unfreeze_url = format!("http://{}:{}/lan/unfreeze", peer.ip, peer.port);
                    let retry_secret = resolve_peer_secret(&peer.device_id);
                    if let Err(ue) = http_post(&slave_unfreeze_url, "{}", &retry_secret) {
                        sync_log(&format!("[!] Nie udalo sie odmrozic slave: {}", ue));
                    }
                    sync_state.reset_progress();
                    last_err = e;

                    if attempt < MAX_RETRIES {
                        let backoff = Duration::from_secs(5 * 3u64.pow(attempt - 1));
                        sync_log(&format!("[!] Ponowienie za {:?}...", backoff));
                        let deadline = Instant::now() + backoff;
                        while Instant::now() < deadline {
                            if stop_signal.load(Ordering::Relaxed) {
                                sync_log("[!] Stop signal podczas backoff — przerywam");
                                break;
                            }
                            thread::sleep(Duration::from_secs(1));
                        }
                        if stop_signal.load(Ordering::Relaxed) {
                            break;
                        }
                    }
                }
            }
        }

        if !last_err.is_empty() {
            sync_log(&format!("=== SYNC NIEUDANY po {} probach: {} ===", MAX_RETRIES, last_err));
        }

        // Guarantee cleanup: always unfreeze + reset progress when thread exits.
        // This prevents the "stuck in syncing" state if any step panics or errors
        // without proper cleanup.
        sync_state.unfreeze();
        if last_err.is_empty() {
            sync_state.mark_sync_completed();
        }
        // Small delay so UI can see "completed" phase before reset
        thread::sleep(Duration::from_secs(3));
        sync_state.reset_progress();
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
    let secret = resolve_peer_secret(&peer.device_id);
    let sync_start = Instant::now();

    // Open single DB connection for entire sync flow
    let mut conn = lan_common::open_dashboard_db()?;

    // Step 3: Negotiate with SLAVE
    sync_state.set_progress(3, "negotiating", "local");
    sync_log(&format!("[3/13] Negocjacja z peerem {}:{} ...", peer.ip, peer.port));
    let device_id = lan_common::get_device_id();
    let local_marker = get_local_marker_hash_with_conn(&conn);

    let negotiate_body = serde_json::json!({
        "master_device_id": device_id,
        "master_marker_hash": local_marker,
    });

    let negotiate_resp = http_post(
        &format!("{}/lan/negotiate", base_url),
        &negotiate_body.to_string(),
        &secret,
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
    if let Err(e) = http_post(&format!("{}/lan/freeze-ack", base_url), "{}", &secret) {
        sync_log(&format!("[5/13] BLAD freeze slave: {} — rollback master freeze", e));
        sync_state.unfreeze();
        return Err(e);
    }
    sync_log("[5/13] Obie bazy zamrozone");

    // Step 6: Pull data from SLAVE
    sync_state.set_progress(6, "downloading_from_slave", "download");
    let since = match transfer_mode.as_str() {
        "delta" => neg.slave_marker_hash.as_deref()
            .and_then(|hash| get_marker_created_at_by_hash(&conn, hash))
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
        &secret,
    ).map_err(|e| { sync_log(&format!("[6/13] BLAD pobierania: {}", e)); e })?;

    sync_state.set_progress(7, "received_from_slave", "local");
    let slave_kb = slave_data.len() as f64 / 1024.0;
    sync_log(&format!("[7/13] Odebrano {:.1} KB danych z peera", slave_kb));

    // Step 8: Backup
    sync_state.set_progress(8, "backing_up", "local");
    sync_log("[8/13] Tworzenie kopii zapasowej bazy...");
    sync_common::backup_database(&conn).map_err(|e| { sync_log(&format!("[8/13] BLAD backup: {}", e)); e })?;
    sync_log("[8/13] Kopia zapasowa utworzona");

    // Step 9: Merge
    sync_state.set_progress(9, "merging", "local");
    sync_log("[9/13] Scalanie danych peera z lokalna baza...");
    let dir = crate::config::config_dir().map_err(|e| e.to_string())?;
    // Use unique filename to avoid race condition
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let incoming_file = dir.join(format!("lan_sync_incoming_{}.json", ts));
    let mut temp_guard = TempFileGuard::new();
    temp_guard.track(incoming_file.clone());
    temp_guard.track(dir.join("lan_sync_merged.json"));
    temp_guard.track(dir.join("lan_sync_incoming_latest.txt"));

    // NOTE: slave_data is passed directly to merge_incoming_data in memory.
    // No need to write it to a file first (data already available).

    sync_common::merge_incoming_data(&mut conn, &slave_data)
        .map_err(|e| {
            sync_log(&format!("[9/13] BLAD scalania: {} — przywracam backup", e));
            if let Err(re) = sync_common::restore_database_backup(&mut conn) {
                sync_log(&format!("[9/13] BLAD przywracania backupu: {}", re));
            }
            e
        })?;
    sync_log("[9/13] Scalanie zakonczone");

    // Step 10: Verify
    sync_state.set_progress(10, "verifying", "local");
    sync_log("[10/13] Weryfikacja integralnosci bazy...");
    sync_common::verify_merge_integrity(&conn)
        .map_err(|e| {
            sync_log(&format!("[10/13] BLAD weryfikacji: {} — przywracam backup", e));
            if let Err(re) = sync_common::restore_database_backup(&mut conn) {
                sync_log(&format!("[10/13] BLAD przywracania backupu: {}", re));
            }
            e
        })?;
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
    let merged_export = if transfer_mode == "delta" {
        sync_log("[11/13] Budowanie delta eksportu dla peera...");
        let (data, _size) = sync_common::build_delta_export(&conn, Some(&since))
            .map_err(|e| { sync_log(&format!("[11/13] BLAD budowania delta eksportu: {}", e)); e })?;
        data
    } else {
        sync_log("[11/13] Budowanie pelnego eksportu dla peera...");
        sync_common::build_full_export(&conn)
            .map_err(|e| { sync_log(&format!("[11/13] BLAD budowania eksportu: {}", e)); e })?
    };
    let export_kb = merged_export.len() as f64 / 1024.0;
    sync_log(&format!("[11/13] Wysylanie {:.1} KB do peera...", export_kb));

    std::fs::write(dir.join("lan_sync_merged.json"), &merged_export)
        .map_err(|e| e.to_string())?;

    // Send merged data to slave via /lan/upload-db
    let upload_resp = http_post_with_progress(
        &format!("{}/lan/upload-db", base_url),
        &merged_export,
        |transferred, total| {
            sync_state.update_transfer_bytes(transferred, total);
        },
        &secret,
    ).map_err(|e| { sync_log(&format!("[11/13] BLAD wysylania danych do peera: {}", e)); e })?;
    sync_log("[11/13] Dane wyslane do peera");

    // Extract incoming_file from upload-db response to pass to db-ready (avoids race condition on pointer file)
    let incoming_file = serde_json::from_str::<serde_json::Value>(&upload_resp)
        .ok()
        .and_then(|v| v.get("incoming_file").and_then(|f| f.as_str().map(String::from)))
        .unwrap_or_default();

    // Step 12: Tell slave to merge + verify + insert marker
    sync_state.set_progress(12, "slave_importing", "upload");
    sync_log("[12/13] Polecenie importu dla peera (db-ready)...");
    let ready_body = serde_json::json!({
        "marker_hash": new_marker,
        "transfer_mode": transfer_mode,
        "master_device_id": device_id,
        "incoming_file": incoming_file,
    });

    // db-ready now blocks until slave finishes import — use long timeout with retry
    let db_ready_url = format!("{}/lan/db-ready", base_url);
    let db_ready_body = ready_body.to_string();
    let db_ready_timeouts = [180u64, 180, 180]; // 3 attempts × 180s each
    let mut db_ready_resp = Err("db-ready not attempted".to_string());

    for (i, &timeout_secs) in db_ready_timeouts.iter().enumerate() {
        if stop_signal.load(Ordering::Relaxed) {
            return Err("Stop signal during db-ready".to_string());
        }
        sync_log(&format!("[12/13] Proba db-ready {}/{}...", i + 1, db_ready_timeouts.len()));
        match http_post_with_timeout(&db_ready_url, &db_ready_body, Duration::from_secs(timeout_secs), &secret) {
            Ok(resp) => {
                db_ready_resp = Ok(resp);
                break;
            }
            Err(e) => {
                sync_log(&format!("[12/13] db-ready proba {}/{} nieudana: {}", i + 1, db_ready_timeouts.len(), e));
                db_ready_resp = Err(e);
                if i + 1 < db_ready_timeouts.len() {
                    let backoff = Duration::from_secs(10 * (i as u64 + 1));
                    sync_log(&format!("[12/13] Ponowienie db-ready za {:?}...", backoff));
                    thread::sleep(backoff);
                }
            }
        }
    }

    let db_ready_resp = db_ready_resp.map_err(|e| {
        sync_log(&format!("[12/13] BLAD — slave nie zakonczyl importu po {} probach: {}", db_ready_timeouts.len(), e));
        if let Err(re) = sync_common::restore_database_backup(&mut conn) {
            sync_log(&format!("[12/13] BLAD przywracania backupu master: {}", re));
        }
        e
    })?;

    // Verify slave response
    if let Ok(resp) = serde_json::from_str::<serde_json::Value>(&db_ready_resp) {
        if resp.get("ok").and_then(|v| v.as_bool()) != Some(true) {
            let err_msg = resp.get("error").and_then(|v| v.as_str()).unwrap_or("unknown");
            sync_log(&format!("[12/13] Slave zglosil blad importu: {}", err_msg));
            if let Err(re) = sync_common::restore_database_backup(&mut conn) {
                sync_log(&format!("[12/13] BLAD przywracania backupu master: {}", re));
            }
            return Err(format!("Slave import failed: {}", err_msg));
        }
    }
    sync_log("[12/13] Peer zakonczyl import — dane scalone");

    // Step 13: Unfreeze + cleanup
    sync_log("[13/13] Odmrazanie baz danych...");
    sync_state.unfreeze();
    http_post(&format!("{}/lan/unfreeze", base_url), "{}", &secret).ok();
    sync_log("[13/13] Bazy odmrozone — zbieranie danych wznowione");

    // Temp files cleaned up by TempFileGuard on drop
    drop(temp_guard);

    sync_common::run_gc_tombstones();

    let elapsed = sync_start.elapsed().as_secs_f64();
    sync_log(&format!("=== SYNC ZAKONCZONY w {:.1}s (tryb: {}) ===", elapsed, transfer_mode));

    // Set completed AFTER unfreeze — stays visible for UI polling
    sync_state.set_progress(13, "completed", "local");

    Ok(())
}

// ── DB helper functions (local only) ──

/// Returns (marker_hash, created_at) of the latest sync marker, or None.
fn get_latest_marker(conn: &rusqlite::Connection) -> Option<(String, String)> {
    conn.query_row(
        "SELECT marker_hash, created_at FROM sync_markers ORDER BY created_at DESC LIMIT 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .ok()
}

fn get_local_marker_hash_with_conn(conn: &rusqlite::Connection) -> Option<String> {
    get_latest_marker(conn).map(|(hash, _)| hash)
}

fn get_local_marker_created_at_with_conn(conn: &rusqlite::Connection) -> Option<String> {
    get_latest_marker(conn).map(|(_, created_at)| created_at)
}

/// Find the created_at timestamp for a specific marker hash.
/// Used to determine the correct `since` for delta sync — we need
/// the date of the marker matching the remote peer's hash, not our latest.
fn get_marker_created_at_by_hash(conn: &rusqlite::Connection, hash: &str) -> Option<String> {
    conn.query_row(
        "SELECT created_at FROM sync_markers WHERE marker_hash = ?1 LIMIT 1",
        [hash],
        |row| row.get(0),
    )
    .ok()
    // Fallback to latest marker if hash not found locally
    .or_else(|| get_local_marker_created_at_with_conn(conn))
}

