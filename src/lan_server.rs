// LAN Server — HTTP server running in the daemon process.
// Listens on port 47891, handles sync endpoints.
// Uses std::net::TcpListener — no extra dependencies.
// This server runs even when the dashboard is closed.

use crate::config;
use crate::lan_common::{self, sync_log};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DEFAULT_LAN_PORT: u16 = 47891;
const MAX_REQUEST_BODY: usize = 50 * 1024 * 1024; // 50MB
const MAX_CONNECTIONS: usize = 32;
/// Minimum seconds after a completed sync before accepting a new manual trigger.
const TRIGGER_SYNC_COOLDOWN_SECS: u64 = 30;

struct ConnectionGuard(Arc<AtomicUsize>);
impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}

// ── Types ──

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TableHashes {
    pub projects: String,
    pub applications: String,
    pub sessions: String,
    pub manual_sessions: String,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct StatusRequest {
    device_id: String,
    table_hashes: TableHashes,
}

#[derive(Serialize)]
#[allow(dead_code)]
struct StatusResponse {
    needs_push: bool,
    needs_pull: bool,
    their_hashes: TableHashes,
}

#[derive(Serialize)]
struct PingResponse {
    ok: bool,
    version: String,
    device_id: String,
    machine_name: String,
    role: String,
    sync_marker_hash: Option<String>,
}

#[derive(Serialize)]
struct ErrorResponse {
    ok: bool,
    error: String,
}

#[derive(Deserialize)]
struct NegotiateRequest {
    master_device_id: String,
    master_marker_hash: Option<String>,
}

#[derive(Serialize)]
struct NegotiateResponse {
    ok: bool,
    mode: String, // "delta" or "full"
    slave_marker_hash: Option<String>,
}

#[derive(Serialize)]
struct FreezeAckResponse {
    ok: bool,
    frozen: bool,
}

#[derive(Serialize)]
#[allow(dead_code)]
struct UploadAckResponse {
    ok: bool,
    bytes_received: usize,
}

#[derive(Serialize)]
struct DbReadyResponse {
    ok: bool,
    marker_hash: String,
    transfer_mode: String,
}

// ── Sync progress ──

/// Transfer progress visible to the UI layer.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SyncProgress {
    pub step: u32,                   // current step 0-13
    pub total_steps: u32,            // always 13
    pub phase: String,               // human-readable phase label key
    pub direction: String,           // "upload" | "download" | "local" | "idle"
    pub bytes_transferred: u64,
    pub bytes_total: u64,            // 0 = unknown
    pub started_at: u64,             // unix millis when this phase started
    #[serde(default)]
    pub role: String,                // "master" | "slave" | "undecided"
    #[serde(default)]
    pub sync_type: String,           // "lan" | "online" | "" (idle)
}

impl SyncProgress {
    pub fn idle() -> Self {
        Self {
            step: 0, total_steps: 13,
            phase: "idle".into(), direction: "idle".into(),
            bytes_transferred: 0, bytes_total: 0,
            started_at: 0,
            role: "undecided".into(),
            sync_type: String::new(),
        }
    }
}

// ── Shared state ──

/// Global sync state shared between the server, discovery, and orchestrator.
pub struct LanSyncState {
    pub role: std::sync::Mutex<String>, // "master", "slave", "undecided"
    pub db_frozen: AtomicBool,
    pub sync_in_progress: AtomicBool,
    pub latest_marker_hash: std::sync::Mutex<Option<String>>,
    /// Timestamp when db_frozen was set to true (for auto-unfreeze timeout).
    pub frozen_at: std::sync::Mutex<Option<Instant>>,
    /// Current sync progress for UI polling.
    pub progress: std::sync::Mutex<SyncProgress>,
    /// Unix timestamp (seconds) of last completed sync — used for cooldown.
    pub last_sync_completed: AtomicU64,
}

/// Guard that resets sync_in_progress to false on drop (panic-safe).
/// Shared by main.rs and tray.rs — defined here to avoid duplication.
pub struct SyncGuard(pub Arc<LanSyncState>);
impl Drop for SyncGuard {
    fn drop(&mut self) {
        self.0.sync_in_progress.store(false, Ordering::SeqCst);
        log::info!("SyncGuard dropped — sync_in_progress reset to false");
    }
}

const AUTO_UNFREEZE_TIMEOUT: Duration = Duration::from_secs(300); // 5 minutes

impl LanSyncState {
    pub fn new() -> Self {
        Self {
            role: std::sync::Mutex::new("undecided".to_string()),
            db_frozen: AtomicBool::new(false),
            sync_in_progress: AtomicBool::new(false),
            latest_marker_hash: std::sync::Mutex::new(None),
            frozen_at: std::sync::Mutex::new(None),
            progress: std::sync::Mutex::new(SyncProgress::idle()),
            last_sync_completed: AtomicU64::new(0),
        }
    }

    /// Record that a sync just completed (for cooldown logic).
    pub fn mark_sync_completed(&self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        self.last_sync_completed.store(now, Ordering::Relaxed);
    }

    /// Seconds since last completed sync.
    pub fn secs_since_last_sync(&self) -> u64 {
        let last = self.last_sync_completed.load(Ordering::Relaxed);
        if last == 0 {
            return u64::MAX; // never synced
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        now.saturating_sub(last)
    }

    /// Update sync progress (called by orchestrator).
    pub fn set_progress(&self, step: u32, phase: &str, direction: &str) {
        let mut guard = self.progress.lock().unwrap_or_else(|e| e.into_inner());
        guard.step = step;
        guard.phase = phase.to_string();
        guard.direction = direction.to_string();
        guard.bytes_transferred = 0;
        guard.bytes_total = 0;
        guard.started_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
    }

    /// Update transfer byte counters (called during upload/download).
    pub fn update_transfer_bytes(&self, transferred: u64, total: u64) {
        let mut guard = self.progress.lock().unwrap_or_else(|e| e.into_inner());
        guard.bytes_transferred = transferred;
        guard.bytes_total = total;
    }

    /// Get a snapshot of current progress.
    pub fn get_progress(&self) -> SyncProgress {
        self.progress.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Set the sync type label ("lan" | "online").
    pub fn set_sync_type(&self, sync_type: &str) {
        let mut guard = self.progress.lock().unwrap_or_else(|e| e.into_inner());
        guard.sync_type = sync_type.to_string();
    }

    /// Reset progress to idle.
    pub fn reset_progress(&self) {
        let mut guard = self.progress.lock().unwrap_or_else(|e| e.into_inner());
        *guard = SyncProgress::idle();
    }

    /// Freeze the database. Records the freeze timestamp for auto-unfreeze.
    pub fn freeze(&self) {
        self.db_frozen.store(true, Ordering::SeqCst);
        self.sync_in_progress.store(true, Ordering::SeqCst);
        let mut guard = self.frozen_at.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some(Instant::now());
    }

    /// Unfreeze the database (does NOT reset progress — call reset_progress() separately).
    pub fn unfreeze(&self) {
        self.db_frozen.store(false, Ordering::SeqCst);
        self.sync_in_progress.store(false, Ordering::SeqCst);
        let mut guard = self.frozen_at.lock().unwrap_or_else(|e| e.into_inner());
        *guard = None;
    }

    /// Check if frozen for too long and auto-unfreeze if needed.
    pub fn check_auto_unfreeze(&self) -> bool {
        if !self.db_frozen.load(Ordering::Acquire) {
            return false;
        }
        let should_unfreeze = {
            let guard = self.frozen_at.lock().unwrap_or_else(|e| e.into_inner());
            guard.map_or(false, |t| t.elapsed() > AUTO_UNFREEZE_TIMEOUT)
        };
        if should_unfreeze {
            log::warn!("Auto-unfreezing database after {:?} timeout", AUTO_UNFREEZE_TIMEOUT);
            self.unfreeze();
            self.reset_progress();
            self.set_role("undecided");
            return true;
        }
        false
    }

    pub fn get_role(&self) -> String {
        self.role.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn set_role(&self, new_role: &str) {
        let mut guard = self.role.lock().unwrap_or_else(|e| e.into_inner());
        *guard = new_role.to_string();
    }
}

// ── Server start/stop ──

pub fn start(stop_signal: Arc<AtomicBool>, sync_state: Arc<LanSyncState>) -> JoinHandle<()> {
    thread::spawn(move || {
        log::info!("LAN server thread started");
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_server(stop_signal, sync_state);
        })) {
            Ok(()) => log::info!("LAN server thread stopped"),
            Err(_) => log::error!("LAN server thread PANICKED"),
        }
        log::logger().flush();
    })
}

// LAN server listens on 0.0.0.0. Mutating endpoints require X-Auth-Secret header
// matching the shared secret from lan_secret.txt. Read-only + pairing endpoints are open.
fn run_server(stop_signal: Arc<AtomicBool>, sync_state: Arc<LanSyncState>) {
    let listener = match TcpListener::bind(format!("0.0.0.0:{}", DEFAULT_LAN_PORT)) {
        Ok(s) => {
            log::info!("LAN server: listening on port {}", DEFAULT_LAN_PORT);
            s
        }
        Err(e) => {
            log::error!("LAN server: failed to bind port {}: {}", DEFAULT_LAN_PORT, e);
            return;
        }
    };

    // Non-blocking accept with short sleep to check stop_signal periodically.
    listener
        .set_nonblocking(true)
        .unwrap_or_else(|e| log::warn!("LAN server: set_nonblocking failed: {}", e));

    let active_connections = Arc::new(AtomicUsize::new(0));
    let mut last_unfreeze_check = std::time::Instant::now();

    loop {
        if stop_signal.load(Ordering::Relaxed) {
            break;
        }

        // Safety net: auto-unfreeze if frozen for too long (check every ~5s, not every 500ms)
        if last_unfreeze_check.elapsed() >= Duration::from_secs(5) {
            sync_state.check_auto_unfreeze();
            last_unfreeze_check = std::time::Instant::now();
        }

        match listener.accept() {
            Ok((stream, addr)) => {
                let conn_count = active_connections.clone();
                if conn_count.load(Ordering::Relaxed) >= MAX_CONNECTIONS {
                    log::warn!(
                        "LAN server: max connections ({}) reached, dropping {}",
                        MAX_CONNECTIONS,
                        addr
                    );
                    drop(stream);
                    continue;
                }
                conn_count.fetch_add(1, Ordering::Relaxed);
                let state = sync_state.clone();
                let stop = stop_signal.clone();
                thread::spawn(move || {
                    let _decrement = ConnectionGuard(conn_count);
                    if let Err(e) = handle_connection(stream, state, stop) {
                        log::debug!("LAN server: connection error from {}: {}", addr, e);
                    }
                });
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                log::warn!("LAN server: accept error: {}", e);
                thread::sleep(Duration::from_millis(100));
            }
        }
    }

    log::info!("LAN server: stopped");
}

// ── HTTP handling ──

fn handle_connection(
    mut stream: std::net::TcpStream,
    state: Arc<LanSyncState>,
    stop_signal: Arc<AtomicBool>,
) -> Result<(), String> {
    // On Windows, streams accepted from a non-blocking listener inherit non-blocking mode.
    // We must explicitly switch to blocking mode before setting timeouts, otherwise
    // read_exact on large payloads (e.g. upload-db with ~6MB) fails with WSAEWOULDBLOCK.
    stream
        .set_nonblocking(false)
        .map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(30)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(30)))
        .map_err(|e| e.to_string())?;

    let mut reader = BufReader::new(&stream);

    // Parse request line
    let mut request_line = String::new();
    reader.read_line(&mut request_line).map_err(|e| e.to_string())?;
    let parts: Vec<&str> = request_line.trim().split_whitespace().collect();
    if parts.len() < 2 {
        return Err("Invalid HTTP request".to_string());
    }
    let method = parts[0];
    let path = parts[1];

    // Parse headers (case-insensitive)
    let mut content_length: usize = 0;
    let mut auth_secret = String::new();
    let mut header_count = 0;
    loop {
        let mut header_line = String::new();
        reader.read_line(&mut header_line).map_err(|e| e.to_string())?;
        let trimmed = header_line.trim();
        if trimmed.is_empty() {
            break;
        }
        header_count += 1;
        if header_count > 100 {
            return Err("Too many headers".to_string());
        }
        let lower = trimmed.to_ascii_lowercase();
        if let Some(value) = lower.strip_prefix("content-length:") {
            content_length = value.trim().parse().unwrap_or(0);
        }
        if let Some(value) = lower.strip_prefix("x-timeflow-secret:") {
            auth_secret = value.trim().to_string();
        }
    }

    // Verify shared secret for mutating endpoints (skip ping, pairing, and read-only)
    let requires_auth = !matches!(path,
        "/lan/ping" | "/lan/pair" | "/lan/sync-progress" | "/online/sync-progress"
        | "/lan/paired-devices" | "/lan/generate-pairing-code"
        | "/lan/store-paired-device" | "/lan/remove-paired-device"
        | "/lan/local-identity"
        | "/lan/trigger-sync" | "/online/trigger-sync"
    );
    if requires_auth {
        let expected = get_or_create_lan_secret();
        if expected.is_empty() || auth_secret != expected {
            let msg = if expected.is_empty() {
                r#"{"ok":false,"error":"server secret unavailable"}"#
            } else {
                r#"{"ok":false,"error":"unauthorized"}"#
            };
            let response = format!(
                "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                msg.len(), msg
            );
            stream.write_all(response.as_bytes()).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }

    // Read body as UTF-8 String — reject payloads that exceed the limit with HTTP 413
    // NOTE: Body is read as String (not Vec<u8>) because all handlers parse JSON text.
    let body_too_large = content_length > MAX_REQUEST_BODY;
    let body = if body_too_large {
        String::new()
    } else if content_length > 0 {
        let mut buf = vec![0u8; content_length];
        reader.read_exact(&mut buf).map_err(|e| e.to_string())?;
        String::from_utf8(buf).map_err(|e| e.to_string())?
    } else {
        String::new()
    };

    // Reject oversized payloads before routing
    if body_too_large {
        let msg = format!(r#"{{"ok":false,"error":"Payload too large ({} bytes, max {})"}}"#, content_length, MAX_REQUEST_BODY);
        let response = format!(
            "HTTP/1.1 413 Payload Too Large\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            msg.len(), msg
        );
        stream.write_all(response.as_bytes()).map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Route
    let (status, response_body) = match (method, path) {
        ("GET", "/lan/ping") => handle_ping(&state),
        ("POST", "/lan/preflight") => handle_preflight(&state),
        ("GET", "/lan/sync-progress") => handle_sync_progress(&state),
        ("POST", "/lan/status") => (410, json_error("deprecated endpoint")),
        ("POST", "/lan/negotiate") => handle_negotiate(&state, &body),
        ("POST", "/lan/freeze-ack") => handle_freeze_ack(&state),
        ("POST", "/lan/upload-db") => handle_upload_db(&state, &body),
        ("POST", "/lan/upload-ack") => (200, json_ok()),
        ("POST", "/lan/db-ready") => handle_db_ready(&state, &body),
        ("GET", "/lan/download-db") => handle_download_db(),
        ("POST", "/lan/verify-ack") => (410, json_error("deprecated endpoint")),
        ("POST", "/lan/unfreeze") => handle_unfreeze(&state),
        ("POST", "/lan/pair") => handle_pair(&body),
        ("POST", "/lan/generate-pairing-code") => handle_generate_pairing_code(),
        ("POST", "/lan/store-paired-device") => handle_store_paired_device(&body),
        ("POST", "/lan/remove-paired-device") => handle_remove_paired_device(&body),
        ("GET", "/lan/paired-devices") => handle_get_paired_devices(),
        ("GET", "/lan/local-identity") => handle_local_identity(),
        ("POST", "/lan/trigger-sync") => handle_trigger_sync(&state, &stop_signal, &body),
        // Online sync endpoints
        ("POST", "/online/trigger-sync") => handle_online_trigger_sync(&state, &stop_signal),
        ("GET", "/online/sync-progress") => handle_sync_progress(&state),
        // Legacy endpoints — /lan/pull used by 13-step protocol (step 6, master fetches from slave)
        ("POST", "/lan/pull") => handle_pull(&body),
        ("POST", "/lan/push") => (410, json_error("deprecated: use 13-step sync protocol")),
        _ => (404, r#"{"ok":false,"error":"not found"}"#.to_string()),
    };

    // Write response
    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{}",
        status,
        status_text(status),
        response_body.len(),
        response_body
    );
    stream.write_all(response.as_bytes()).map_err(|e| e.to_string())?;
    stream.flush().map_err(|e| e.to_string())?;
    Ok(())
}

fn status_text(code: u16) -> &'static str {
    match code {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        409 => "Conflict",
        413 => "Payload Too Large",
        500 => "Internal Server Error",
        _ => "Unknown",
    }
}

fn json_ok() -> String {
    r#"{"ok":true}"#.to_string()
}

fn json_error(msg: &str) -> String {
    serde_json::to_string(&ErrorResponse {
        ok: false,
        error: msg.to_string(),
    })
    .unwrap_or_else(|_| format!(r#"{{"ok":false,"error":"{}"}}"#, msg))
}

// ── Auth ──

/// Get or create a shared secret for LAN sync authentication.
/// Stored in config dir as `lan_secret.txt`. Created on first run.
fn get_or_create_lan_secret() -> String {
    let dir = match config::config_dir() {
        Ok(d) => d,
        Err(_) => return String::new(),
    };
    let path = dir.join("lan_secret.txt");
    if let Ok(secret) = std::fs::read_to_string(&path) {
        let s = secret.trim().to_string();
        if !s.is_empty() {
            return s;
        }
    }
    // Generate new secret
    let mut bytes = [0u8; 32];
    if let Err(e) = getrandom::getrandom(&mut bytes) {
        log::error!("CRITICAL: getrandom failed, cannot generate LAN secret: {}", e);
        return String::new();
    }
    let secret: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
    let _ = std::fs::write(&path, &secret);
    log::info!("Generated new LAN sync secret");
    secret
}

/// Public accessor for the LAN secret (used by orchestrator to send with requests).
pub fn lan_secret() -> String {
    get_or_create_lan_secret()
}

// ── DB helpers ──

fn open_dashboard_db() -> Result<rusqlite::Connection, String> {
    lan_common::open_dashboard_db()
}

fn open_dashboard_db_readonly() -> Result<rusqlite::Connection, String> {
    config::open_dashboard_db_readonly().map_err(|e| e.to_string())
}

fn compute_table_hash(conn: &rusqlite::Connection, table: &str) -> String {
    lan_common::compute_table_hash(conn, table)
}

fn build_table_hashes(conn: &rusqlite::Connection) -> TableHashes {
    TableHashes {
        projects: compute_table_hash(conn, "projects"),
        applications: compute_table_hash(conn, "applications"),
        sessions: compute_table_hash(conn, "sessions"),
        manual_sessions: compute_table_hash(conn, "manual_sessions"),
    }
}

fn get_latest_marker_hash(conn: &rusqlite::Connection) -> Option<String> {
    conn.query_row(
        "SELECT marker_hash FROM sync_markers ORDER BY created_at DESC LIMIT 1",
        [],
        |row| row.get(0),
    )
    .ok()
}

/// Check if a marker hash exists in our history; return its timestamp if found.
fn find_marker_timestamp(conn: &rusqlite::Connection, marker_hash: &str) -> Option<String> {
    conn.query_row(
        "SELECT created_at FROM sync_markers WHERE marker_hash = ?1 LIMIT 1",
        rusqlite::params![marker_hash],
        |row| row.get(0),
    )
    .ok()
}

// ── Endpoint handlers ──

fn handle_sync_progress(state: &LanSyncState) -> (u16, String) {
    let mut progress = state.get_progress();
    progress.role = state.get_role();

    // Auto-reset "completed" to idle after 5 seconds
    if progress.phase == "completed" && progress.started_at > 0 {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        if now.saturating_sub(progress.started_at) > 5000 {
            state.reset_progress();
            progress = state.get_progress();
            progress.role = state.get_role();
        }
    }

    let json = serde_json::to_string(&progress).unwrap_or_else(|_| r#"{"step":0}"#.to_string());
    (200, json)
}

fn handle_ping(state: &LanSyncState) -> (u16, String) {
    // Ping is unauthenticated (used for discovery), so minimize exposed data.
    // sync_marker_hash and machine_name are omitted to reduce info leakage.
    let resp = PingResponse {
        ok: true,
        version: crate::VERSION.trim().to_string(),
        device_id: lan_common::get_device_id(),
        machine_name: String::new(),
        role: state.get_role(),
        sync_marker_hash: None,
    };
    (200, serde_json::to_string(&resp).unwrap_or_default())
}

fn handle_preflight(state: &LanSyncState) -> (u16, String) {
    let in_sync = state.sync_in_progress.load(Ordering::SeqCst);
    let frozen = state.db_frozen.load(Ordering::SeqCst);
    let device_id = lan_common::get_device_id();
    let version = env!("CARGO_PKG_VERSION");

    let resp = serde_json::json!({
        "ok": true,
        "auth": "valid",
        "device_id": device_id,
        "version": version,
        "sync_in_progress": in_sync,
        "db_frozen": frozen,
    });
    (200, resp.to_string())
}

#[allow(dead_code)]
fn handle_status(body: &str) -> (u16, String) {
    let req: StatusRequest = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return (400, json_error(&format!("Invalid request: {}", e))),
    };
    log::debug!("LAN server: /lan/status from device_id={}", req.device_id);

    let conn = match open_dashboard_db_readonly() {
        Ok(c) => c,
        Err(e) => return (500, json_error(&e)),
    };

    let local_hashes = build_table_hashes(&conn);

    let needs_push = local_hashes != req.table_hashes;
    let needs_pull = needs_push;

    let resp = StatusResponse {
        needs_push,
        needs_pull,
        their_hashes: local_hashes,
    };
    (200, serde_json::to_string(&resp).unwrap_or_default())
}

fn handle_negotiate(state: &LanSyncState, body: &str) -> (u16, String) {
    let req: NegotiateRequest = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return (400, json_error(&format!("Invalid request: {}", e))),
    };

    // If we're already syncing as master, use device_id tiebreaker
    if state.sync_in_progress.load(Ordering::SeqCst) {
        let local_device_id = lan_common::get_device_id();
        let role = state.get_role();
        if role == "master" {
            // Lower device_id wins master role
            if req.master_device_id > local_device_id {
                // We have priority — reject remote's negotiate
                sync_log(&format!("[NEGOTIATE] Conflict: we win master role (lower device_id than {})", req.master_device_id));
                return (409, json_error("Master conflict: this device has priority"));
            }
            // Remote wins — let it through, our sync will fail on its own
            sync_log(&format!("[NEGOTIATE] Conflict: remote {} wins master role (lower device_id)", req.master_device_id));
        }
    }

    let db = open_dashboard_db_readonly().ok();
    let local_marker = db.as_ref().and_then(|conn| get_latest_marker_hash(conn));

    let mode = match (&local_marker, &req.master_marker_hash) {
        (Some(local), Some(remote)) if local == remote => "delta",
        (_, Some(remote)) => {
            // Check if remote marker exists in our history — allows delta from a common ancestor
            if db.as_ref().and_then(|conn| find_marker_timestamp(conn, remote)).is_some() {
                "delta"
            } else {
                "full"
            }
        }
        _ => "full",
    };

    // Accept slave role when master negotiates
    state.set_role("slave");
    state.set_progress(3, "negotiating", "local");
    sync_log(&format!("[SLAVE] Master {} rozpoczyna sync — tryb: {}", req.master_device_id, mode));

    let resp = NegotiateResponse {
        ok: true,
        mode: mode.to_string(),
        slave_marker_hash: local_marker,
    };
    (200, serde_json::to_string(&resp).unwrap_or_default())
}

fn handle_freeze_ack(state: &LanSyncState) -> (u16, String) {
    state.freeze();
    state.set_progress(5, "freezing", "local");
    sync_log("[SLAVE] Baza zamrozona — oczekiwanie na dane...");

    let resp = FreezeAckResponse {
        ok: true,
        frozen: true,
    };
    (200, serde_json::to_string(&resp).unwrap_or_default())
}

fn handle_upload_db(state: &LanSyncState, body: &str) -> (u16, String) {
    if !state.db_frozen.load(Ordering::SeqCst) {
        return (400, json_error("Database not frozen — call /lan/freeze-ack first"));
    }

    state.set_progress(9, "merging", "download");
    let kb = body.len() as f64 / 1024.0;
    sync_log(&format!("[SLAVE] Odebrano {:.1} KB danych od mastera", kb));

    let dir = match config::config_dir() {
        Ok(d) => d,
        Err(e) => return (500, json_error(&format!("Config dir error: {}", e))),
    };
    // Use unique filename to avoid race condition when multiple syncs trigger simultaneously
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let temp_path = dir.join(format!("lan_sync_incoming_{}.json", ts));
    if let Err(e) = std::fs::write(&temp_path, body) {
        return (500, json_error(&format!("Failed to write incoming data: {}", e)));
    }

    // Return the file path in the response so db-ready can reference it directly
    // instead of relying on a racy pointer file.
    let resp = serde_json::json!({
        "ok": true,
        "bytes_received": body.len(),
        "incoming_file": temp_path.to_string_lossy(),
    });
    (200, resp.to_string())
}

fn handle_db_ready(state: &LanSyncState, body: &str) -> (u16, String) {
    #[derive(Deserialize)]
    struct DbReadyRequest {
        marker_hash: String,
        transfer_mode: String,
        #[serde(default)]
        master_device_id: String,
        #[serde(default)]
        incoming_file: String,
    }
    let req: DbReadyRequest = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return (400, json_error(&format!("Invalid db-ready request: {}", e))),
    };

    state.set_progress(12, "slave_importing", "local");
    sync_log("[SLAVE] Master zakonczyl scalanie — importuje dane...");

    // Read the merged data that was sent via /lan/upload-db earlier
    let dir = match config::config_dir() {
        Ok(d) => d,
        Err(e) => return (500, json_error(&format!("Config dir error: {}", e))),
    };
    // Prefer the incoming_file path from the request (race-free),
    // fall back to pointer file for backward compat with older masters.
    let incoming_path = if !req.incoming_file.is_empty() {
        std::path::PathBuf::from(&req.incoming_file)
    } else {
        let pointer_path = dir.join("lan_sync_incoming_latest.txt");
        match std::fs::read_to_string(&pointer_path) {
            Ok(p) => std::path::PathBuf::from(p.trim()),
            Err(_) => dir.join("lan_sync_incoming.json"),
        }
    };
    let merged_data = match std::fs::read_to_string(&incoming_path) {
        Ok(data) => data,
        Err(e) => {
            sync_log(&format!("[SLAVE] BLAD — brak danych do importu: {}", e));
            return (500, json_error(&format!("No incoming data file: {}", e)));
        }
    };
    // Clean up temp file and pointer after reading
    let _ = std::fs::remove_file(&incoming_path);
    let _ = std::fs::remove_file(dir.join("lan_sync_incoming_latest.txt"));

    let data_kb = merged_data.len() as f64 / 1024.0;
    sync_log(&format!("[SLAVE] Importuje {:.1} KB scalonych danych...", data_kb));

    // Open DB connection
    let mut conn = match open_dashboard_db() {
        Ok(c) => c,
        Err(e) => return (500, json_error(&format!("DB open error: {}", e))),
    };

    // Backup before merge
    sync_log("[SLAVE] Tworzenie kopii zapasowej...");
    if let Err(e) = crate::sync_common::backup_database(&conn) {
        sync_log(&format!("[SLAVE] BLAD backup: {}", e));
        return (500, json_error(&format!("Backup failed: {}", e)));
    }

    // Merge incoming data
    sync_log("[SLAVE] Scalanie danych...");
    if let Err(e) = crate::sync_common::merge_incoming_data(&mut conn, &merged_data) {
        sync_log(&format!("[SLAVE] BLAD scalania: {} — przywracam backup", e));
        if let Err(re) = crate::sync_common::restore_database_backup(&mut conn) {
            sync_log(&format!("[SLAVE] BLAD przywracania backupu: {}", re));
        }
        return (500, json_error(&format!("Merge failed: {}", e)));
    }

    // Verify integrity
    sync_log("[SLAVE] Weryfikacja integralnosci...");
    if let Err(e) = crate::sync_common::verify_merge_integrity(&conn) {
        sync_log(&format!("[SLAVE] BLAD weryfikacji: {} — przywracam backup", e));
        if let Err(re) = crate::sync_common::restore_database_backup(&mut conn) {
            sync_log(&format!("[SLAVE] BLAD przywracania backupu: {}", re));
        }
        return (500, json_error(&format!("Verify failed: {}", e)));
    }

    // Generate OWN marker hash based on slave's actual post-merge state
    let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let device_id = lan_common::get_device_id();
    let tables_hash = lan_common::compute_tables_hash_string(&conn);
    let own_marker = crate::sync_common::generate_marker_hash_simple(&tables_hash, &now, &device_id);
    sync_log(&format!("[SLAVE] Own marker: {} (master sent: {})", &own_marker[..8], &req.marker_hash[..8.min(req.marker_hash.len())]));
    if let Err(e) = crate::sync_common::insert_sync_marker_db(
        &conn, &own_marker, &now, &device_id,
        Some(&req.master_device_id), &tables_hash,
        req.transfer_mode == "full",
    ) {
        sync_log(&format!("[SLAVE] BLAD zapisu markera: {}", e));
        return (500, json_error(&format!("Marker insert failed: {}", e)));
    }

    // Store master's marker in our history so next negotiate can find it for delta
    if !req.marker_hash.is_empty() {
        let _ = crate::sync_common::insert_sync_marker_db(
            &conn, &req.marker_hash, &now, &req.master_device_id,
            Some(&device_id), &tables_hash, req.transfer_mode == "full",
        );
        sync_log(&format!("[SLAVE] Stored master marker: {}", &req.marker_hash[..16.min(req.marker_hash.len())]));
    }

    // Update shared state with own marker
    {
        let mut guard = state.latest_marker_hash.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some(own_marker.clone());
    }

    // Clean up temp file
    let _ = std::fs::remove_file(&incoming_path);

    state.set_progress(12, "slave_import_done", "local");
    sync_log("[SLAVE] Import zakonczony — dane scalone i zweryfikowane");

    let resp = DbReadyResponse {
        ok: true,
        marker_hash: own_marker,
        transfer_mode: req.transfer_mode,
    };
    (200, serde_json::to_string(&resp).unwrap_or_default())
}

fn handle_download_db() -> (u16, String) {
    let dir = match config::config_dir() {
        Ok(d) => d,
        Err(e) => return (500, json_error(&format!("Config dir error: {}", e))),
    };
    let merged_path = dir.join("lan_sync_merged.json");
    match std::fs::read_to_string(&merged_path) {
        Ok(data) => {
            // Validate JSON once; the raw string is sent as the response body
            match serde_json::from_str::<serde_json::Value>(&data) {
                Err(_) => return (500, json_error("Merged JSON file is corrupted")),
                Ok(_) => {}
            }
            let kb = data.len() as f64 / 1024.0;
            sync_log(&format!("[SLAVE] Wysylam {:.1} KB scalonych danych do mastera", kb));
            (200, data)
        },
        Err(e) => (500, json_error(&format!("No merged data available: {}", e))),
    }
}

/// DEPRECATED: This endpoint is not called by the orchestrator. Kept for backwards compatibility.
#[allow(dead_code)]
fn handle_verify_ack(state: &LanSyncState) -> (u16, String) {
    state.set_progress(12, "verifying", "local");
    sync_log("[SLAVE] Weryfikacja scalonych danych...");
    let dir = config::config_dir().ok();
    if let Some(d) = &dir {
        let _ = std::fs::remove_file(d.join("lan_sync_incoming.json"));
        let _ = std::fs::remove_file(d.join("lan_sync_merged.json"));
    }
    state.unfreeze();
    (200, json_ok())
}

fn handle_unfreeze(state: &LanSyncState) -> (u16, String) {
    state.unfreeze();
    state.set_role("undecided");
    state.mark_sync_completed();

    crate::sync_common::run_gc_tombstones();

    sync_log("[SLAVE] Baza odmrozona — synchronizacja zakonczona!");
    // Set completed — UI will auto-dismiss after seeing this phase
    state.set_progress(13, "completed", "local");
    (200, json_ok())
}

// ── Legacy pull/push (backward compat with Tauri dashboard client) ──

fn handle_pull(body: &str) -> (u16, String) {
    #[derive(Deserialize)]
    struct PullRequest {
        device_id: String,
        since: String,
    }
    let req: PullRequest = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return (400, json_error(&format!("Invalid request: {}", e))),
    };
    sync_log(&format!("[SLAVE] Master pobiera dane (since={})...", req.since));

    let conn = match open_dashboard_db_readonly() {
        Ok(c) => c,
        Err(e) => return (500, json_error(&e)),
    };

    match build_delta_for_pull(&conn, &req.since) {
        Ok(json) => {
            let kb = json.len() as f64 / 1024.0;
            sync_log(&format!("[SLAVE] Wyslano {:.1} KB danych do mastera", kb));
            (200, json)
        },
        Err(e) => {
            sync_log(&format!("[SLAVE] BLAD przygotowania danych: {}", e));
            (500, json_error(&e))
        },
    }
}

#[allow(dead_code)]
fn handle_push(body: &str) -> (u16, String) {
    let mut conn = match open_dashboard_db() {
        Ok(c) => c,
        Err(e) => return (500, json_error(&e)),
    };

    match crate::sync_common::merge_incoming_data(&mut conn, body) {
        Ok(()) => {
            sync_log("[SLAVE] Push data merged successfully");
            (200, r#"{"ok":true}"#.to_string())
        }
        Err(e) => {
            sync_log(&format!("[SLAVE] Push merge failed: {}", e));
            (500, json_error(&e))
        }
    }
}

fn handle_trigger_sync(state: &Arc<LanSyncState>, stop_signal: &Arc<AtomicBool>, body: &str) -> (u16, String) {
    #[derive(Deserialize)]
    struct TriggerReq {
        peer_ip: String,
        peer_port: u16,
        peer_device_id: String,
        #[serde(default)]
        force: bool,
    }
    let req: TriggerReq = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return (400, json_error(&format!("Invalid request: {}", e))),
    };

    if !req.force && state.secs_since_last_sync() < TRIGGER_SYNC_COOLDOWN_SECS {
        return (429, json_error("Sync completed recently, wait before retrying"));
    }

    // Auto-clear stale sync lock: if sync_in_progress but DB not frozen and no active sync phase,
    // the previous sync thread likely finished or died without cleanup.
    if state.sync_in_progress.load(Ordering::SeqCst) && !state.db_frozen.load(Ordering::SeqCst) {
        let progress = state.progress.lock().unwrap_or_else(|e| e.into_inner());
        let is_idle = progress.phase == "idle" || progress.phase == "completed" || progress.phase == "error";
        drop(progress);
        if is_idle {
            log::warn!("LAN trigger-sync: clearing stale sync_in_progress (phase is idle/completed but flag was still set)");
            state.sync_in_progress.store(false, Ordering::SeqCst);
        }
    }
    if state.sync_in_progress.compare_exchange(
        false, true, Ordering::SeqCst, Ordering::SeqCst
    ).is_err() {
        log::warn!("LAN trigger-sync: REJECTED — sync already in progress");
        return (409, json_error("Sync already in progress"));
    }

    log::info!("LAN trigger-sync: dashboard requested sync with {}:{}{}", req.peer_ip, req.peer_port, if req.force { " [FORCE]" } else { "" });

    let peer = crate::lan_sync_orchestrator::PeerTarget {
        ip: req.peer_ip,
        port: req.peer_port,
        device_id: req.peer_device_id,
    };

    state.set_role("master");
    crate::lan_sync_orchestrator::run_sync_as_master_with_options(peer, state.clone(), stop_signal.clone(), req.force);

    (200, r#"{"ok":true,"message":"sync started"}"#.to_string())
}

fn handle_online_trigger_sync(state: &Arc<LanSyncState>, stop_signal: &Arc<AtomicBool>) -> (u16, String) {
    if state.sync_in_progress.compare_exchange(
        false, true, Ordering::SeqCst, Ordering::SeqCst
    ).is_err() {
        log::warn!("Online trigger-sync: REJECTED — sync already in progress");
        return (409, json_error("Sync already in progress"));
    }

    let settings = crate::config::load_online_sync_settings();
    if settings.server_url.is_empty() || settings.auth_token.is_empty() {
        state.sync_in_progress.store(false, Ordering::SeqCst);
        return (400, json_error("Online sync not configured (missing server_url or auth_token)"));
    }

    log::info!("Online trigger-sync: dashboard requested online sync");

    let state_clone = state.clone();
    let stop_clone = stop_signal.clone();
    std::thread::spawn(move || {
        log::info!("Online sync thread started");
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            match settings.sync_mode.as_str() {
                "async" if !settings.group_id.is_empty() => {
                    let group_id = settings.group_id.clone();
                    crate::online_sync::run_async_delta_sync(settings, state_clone.clone(), &group_id, stop_clone.clone());
                }
                _ => {
                    crate::online_sync::run_online_sync(settings, state_clone.clone(), stop_clone);
                }
            }
        }));
        if let Err(e) = result {
            log::error!("Online sync thread panicked: {:?}", e);
        }
        state_clone.sync_in_progress.store(false, Ordering::SeqCst);
        log::info!("Online sync thread finished — sync_in_progress reset to false");
    });

    (200, r#"{"ok":true,"message":"online sync started"}"#.to_string())
}

fn handle_pair(body: &str) -> (u16, String) {
    #[derive(Deserialize)]
    struct PairReq {
        code: String,
        /// Slave sends its own identity so master can store it (mutual pairing).
        slave_device_id: Option<String>,
        slave_secret: Option<String>,
        slave_machine_name: Option<String>,
    }
    let req: PairReq = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return (400, json_error(&format!("Invalid request: {}", e))),
    };

    match crate::lan_pairing::validate_code(&req.code) {
        Ok(()) => {
            // Master stores slave's secret (mutual pairing)
            if let (Some(slave_id), Some(slave_sec)) = (&req.slave_device_id, &req.slave_secret) {
                let slave_name = req.slave_machine_name.as_deref().unwrap_or("");
                crate::lan_pairing::store_paired_device(slave_id, slave_sec, slave_name);
                log::info!("LAN pairing: master stored slave secret for {}", slave_id);
            }

            let device_id = crate::lan_common::get_device_id();
            let secret = get_or_create_lan_secret();
            let machine_name = crate::lan_common::get_machine_name();
            let resp = serde_json::json!({
                "ok": true,
                "device_id": device_id,
                "secret": secret,
                "machine_name": machine_name,
            });
            (200, resp.to_string())
        }
        Err(reason) => {
            log::warn!("LAN pair attempt failed: {}", reason);
            (403, json_error(reason))
        }
    }
}

fn handle_local_identity() -> (u16, String) {
    let device_id = crate::lan_common::get_device_id();
    let machine_name = crate::lan_common::get_machine_name();
    let resp = serde_json::json!({
        "ok": true,
        "device_id": device_id,
        "machine_name": machine_name,
    });
    (200, resp.to_string())
}

fn handle_generate_pairing_code() -> (u16, String) {
    let code = crate::lan_pairing::generate_code();
    let remaining = crate::lan_pairing::active_code_remaining_secs();
    let resp = serde_json::json!({
        "ok": true,
        "code": code,
        "expires_in_secs": remaining,
    });
    (200, resp.to_string())
}

fn handle_store_paired_device(body: &str) -> (u16, String) {
    #[derive(Deserialize)]
    struct Req { device_id: String, secret: String, machine_name: String }
    let req: Req = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return (400, json_error(&format!("Invalid request: {}", e))),
    };
    crate::lan_pairing::store_paired_device(&req.device_id, &req.secret, &req.machine_name);
    (200, json_ok())
}

fn handle_remove_paired_device(body: &str) -> (u16, String) {
    #[derive(Deserialize)]
    struct Req { device_id: String }
    let req: Req = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return (400, json_error(&format!("Invalid request: {}", e))),
    };
    crate::lan_pairing::remove_paired_device(&req.device_id);
    (200, json_ok())
}

fn handle_get_paired_devices() -> (u16, String) {
    let devices = crate::lan_pairing::load_paired_devices();
    let list: Vec<serde_json::Value> = devices.iter().map(|(id, d)| {
        serde_json::json!({
            "device_id": id,
            "machine_name": d.machine_name,
            "paired_at": d.paired_at,
        })
    }).collect();
    let resp = serde_json::json!({ "ok": true, "devices": list });
    (200, resp.to_string())
}

/// Public wrapper for the orchestrator to call.
pub fn build_delta_for_pull_public(conn: &rusqlite::Connection, since: &str) -> Result<String, String> {
    build_delta_for_pull(conn, since)
}

fn build_delta_for_pull(conn: &rusqlite::Connection, since: &str) -> Result<String, String> {
    // Normalize ISO timestamp for SQLite comparison
    let since_norm = since.replace('T', " ");
    let since_ref = if since_norm.len() > 19 { &since_norm[..19] } else { &since_norm };

    // Fetch projects (always full — small table, needed for ID resolution)
    let projects = fetch_all_rows(conn, "SELECT id, name, color, hourly_rate, created_at, excluded_at, frozen_at, assigned_folder_path, updated_at FROM projects ORDER BY name")?;

    // Fetch applications (always full)
    let apps = fetch_all_rows(conn, "SELECT id, executable_name, display_name, project_id, updated_at FROM applications ORDER BY executable_name")?;

    // Fetch sessions since timestamp (parameterized — no SQL injection)
    let sessions = fetch_all_rows_params(conn,
        "SELECT s.id, s.app_id, s.project_id, s.start_time, s.end_time, s.duration_seconds, \
         s.date, s.rate_multiplier, s.comment, s.is_hidden, s.updated_at \
         FROM sessions s WHERE s.updated_at >= ?1 ORDER BY s.start_time",
        &[&since_ref as &dyn rusqlite::types::ToSql],
    )?;

    // Fetch manual_sessions since timestamp (parameterized)
    let manual = fetch_all_rows_params(conn,
        "SELECT id, title, session_type, project_id, app_id, start_time, end_time, \
         duration_seconds, date, created_at, updated_at \
         FROM manual_sessions WHERE updated_at >= ?1 ORDER BY start_time",
        &[&since_ref as &dyn rusqlite::types::ToSql],
    )?;

    // Fetch tombstones since timestamp (parameterized)
    let tombstones = fetch_all_rows_params(conn,
        "SELECT id, table_name, record_id, record_uuid, deleted_at, sync_key \
         FROM tombstones WHERE deleted_at >= ?1 ORDER BY deleted_at",
        &[&since_ref as &dyn rusqlite::types::ToSql],
    )?;

    let table_hashes = build_table_hashes(conn);

    let archive = serde_json::json!({
        "table_hashes": table_hashes,
        "exported_at": chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        "device_id": lan_common::get_device_id(),
        "data": {
            "projects": projects,
            "applications": apps,
            "sessions": sessions,
            "manual_sessions": manual,
            "tombstones": tombstones,
        }
    });

    serde_json::to_string(&archive).map_err(|e| e.to_string())
}

fn fetch_all_rows(conn: &rusqlite::Connection, sql: &str) -> Result<Vec<serde_json::Value>, String> {
    fetch_all_rows_params(conn, sql, &[])
}

fn fetch_all_rows_params(
    conn: &rusqlite::Connection,
    sql: &str,
    params: &[&dyn rusqlite::types::ToSql],
) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let col_count = stmt.column_count();
    let col_names: Vec<String> = (0..col_count)
        .map(|i| stmt.column_name(i).unwrap_or("?").to_string())
        .collect();

    let rows = stmt
        .query_map(params, |row| {
            let mut map = serde_json::Map::new();
            for (i, name) in col_names.iter().enumerate() {
                let val = match row.get_ref(i) {
                    Ok(rusqlite::types::ValueRef::Null) => serde_json::Value::Null,
                    Ok(rusqlite::types::ValueRef::Integer(n)) => serde_json::json!(n),
                    Ok(rusqlite::types::ValueRef::Real(f)) => serde_json::json!(f),
                    Ok(rusqlite::types::ValueRef::Text(s)) => {
                        serde_json::Value::String(String::from_utf8_lossy(s).to_string())
                    }
                    Ok(rusqlite::types::ValueRef::Blob(_)) => serde_json::Value::Null,
                    Err(_) => serde_json::Value::Null,
                };
                map.insert(name.clone(), val);
            }
            Ok(serde_json::Value::Object(map))
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}


// ── PartialEq for TableHashes ──

impl PartialEq for TableHashes {
    fn eq(&self, other: &Self) -> bool {
        self.projects == other.projects
            && self.applications == other.applications
            && self.sessions == other.sessions
            && self.manual_sessions == other.manual_sessions
    }
}
