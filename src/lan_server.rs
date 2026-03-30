// LAN Server — HTTP server running in the daemon process.
// Listens on port 47891, handles sync endpoints.
// Uses std::net::TcpListener — no extra dependencies.
// This server runs even when the dashboard is closed.

use crate::config;
use crate::lan_common;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const DEFAULT_LAN_PORT: u16 = 47891;
const MAX_REQUEST_BODY: usize = 50 * 1024 * 1024; // 50MB

// ── Types ──

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TableHashes {
    pub projects: String,
    pub applications: String,
    pub sessions: String,
    pub manual_sessions: String,
}

#[derive(Deserialize)]
struct StatusRequest {
    device_id: String,
    table_hashes: TableHashes,
}

#[derive(Serialize)]
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
}

impl SyncProgress {
    pub fn idle() -> Self {
        Self {
            step: 0, total_steps: 13,
            phase: "idle".into(), direction: "idle".into(),
            bytes_transferred: 0, bytes_total: 0,
            started_at: 0,
            role: "undecided".into(),
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
        }
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
        if !self.db_frozen.load(Ordering::Relaxed) {
            return false;
        }
        let guard = self.frozen_at.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(frozen_at) = *guard {
            if frozen_at.elapsed() > AUTO_UNFREEZE_TIMEOUT {
                drop(guard);
                log::warn!("Auto-unfreezing database after {:?} timeout", AUTO_UNFREEZE_TIMEOUT);
                self.unfreeze();
                self.reset_progress();
                self.set_role("undecided");
                return true;
            }
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

    // Use blocking accept with a timeout so we can check stop_signal periodically
    listener
        .set_nonblocking(false)
        .unwrap_or_else(|e| log::warn!("LAN server: set_nonblocking failed: {}", e));

    // Set SO_RCVTIMEO equivalent via std — accept will time out and we can check stop_signal
    // On Windows, TcpListener doesn't support set_read_timeout directly,
    // so we use non-blocking + short sleep instead (but with 500ms instead of 100ms).
    listener
        .set_nonblocking(true)
        .unwrap_or_else(|e| log::warn!("LAN server: set_nonblocking failed: {}", e));

    loop {
        if stop_signal.load(Ordering::Relaxed) {
            break;
        }

        // Safety net: auto-unfreeze if frozen for too long
        sync_state.check_auto_unfreeze();

        match listener.accept() {
            Ok((stream, addr)) => {
                let state = sync_state.clone();
                let stop = stop_signal.clone();
                thread::spawn(move || {
                    if let Err(e) = handle_connection(stream, state, stop) {
                        log::debug!("LAN server: connection error from {}: {}", addr, e);
                    }
                });
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(500));
            }
            Err(e) => {
                log::warn!("LAN server: accept error: {}", e);
                thread::sleep(Duration::from_millis(500));
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
    loop {
        let mut header_line = String::new();
        reader.read_line(&mut header_line).map_err(|e| e.to_string())?;
        let trimmed = header_line.trim();
        if trimmed.is_empty() {
            break;
        }
        let lower = trimmed.to_ascii_lowercase();
        if let Some(value) = lower.strip_prefix("content-length:") {
            content_length = value.trim().parse().unwrap_or(0);
        }
    }

    // Read body
    let body = if content_length > 0 && content_length <= MAX_REQUEST_BODY {
        let mut buf = vec![0u8; content_length];
        reader.read_exact(&mut buf).map_err(|e| e.to_string())?;
        String::from_utf8(buf).map_err(|e| e.to_string())?
    } else {
        String::new()
    };

    // Route
    let (status, response_body) = match (method, path) {
        ("GET", "/lan/ping") => handle_ping(&state),
        ("GET", "/lan/sync-progress") => handle_sync_progress(&state),
        ("POST", "/lan/status") => handle_status(&body),
        ("POST", "/lan/negotiate") => handle_negotiate(&state, &body),
        ("POST", "/lan/freeze-ack") => handle_freeze_ack(&state),
        ("POST", "/lan/upload-db") => handle_upload_db(&state, &body),
        ("POST", "/lan/upload-ack") => (200, json_ok()),
        ("POST", "/lan/db-ready") => handle_db_ready(&state),
        ("GET", "/lan/download-db") => handle_download_db(),
        ("POST", "/lan/verify-ack") => handle_verify_ack(&state),
        ("POST", "/lan/unfreeze") => handle_unfreeze(&state),
        ("POST", "/lan/trigger-sync") => handle_trigger_sync(&state, &stop_signal, &body),
        // Online sync endpoints
        ("POST", "/online/trigger-sync") => handle_online_trigger_sync(&state, &stop_signal),
        ("GET", "/online/sync-progress") => handle_sync_progress(&state),
        // Legacy endpoints (backward compat with existing Tauri client)
        ("POST", "/lan/pull") => handle_pull(&body),
        ("POST", "/lan/push") => handle_push(&body),
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

fn get_device_id() -> String {
    lan_common::get_device_id()
}

fn get_machine_name() -> String {
    lan_common::get_machine_name()
}

fn get_latest_marker_hash(conn: &rusqlite::Connection) -> Option<String> {
    conn.query_row(
        "SELECT marker_hash FROM sync_markers ORDER BY created_at DESC LIMIT 1",
        [],
        |row| row.get(0),
    )
    .ok()
}

fn sync_log(msg: &str) {
    lan_common::sync_log(msg);
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
    let marker_hash = open_dashboard_db_readonly()
        .ok()
        .and_then(|conn| get_latest_marker_hash(&conn));

    let resp = PingResponse {
        ok: true,
        version: crate::VERSION.trim().to_string(),
        device_id: get_device_id(),
        machine_name: get_machine_name(),
        role: state.get_role(),
        sync_marker_hash: marker_hash,
    };
    (200, serde_json::to_string(&resp).unwrap_or_default())
}

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

    let local_marker = open_dashboard_db_readonly()
        .ok()
        .and_then(|conn| get_latest_marker_hash(&conn));

    let mode = match (&local_marker, &req.master_marker_hash) {
        (Some(local), Some(remote)) if local == remote => "delta",
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
    let temp_path = dir.join("lan_sync_incoming.json");
    if let Err(e) = std::fs::write(&temp_path, body) {
        return (500, json_error(&format!("Failed to write incoming data: {}", e)));
    }

    let resp = UploadAckResponse {
        ok: true,
        bytes_received: body.len(),
    };
    (200, serde_json::to_string(&resp).unwrap_or_default())
}

fn handle_db_ready(state: &LanSyncState) -> (u16, String) {
    state.set_progress(11, "slave_downloading", "download");
    sync_log("[SLAVE] Master zakonczyl scalanie — pobieram scalone dane...");

    let marker_hash = state
        .latest_marker_hash
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .unwrap_or_default();

    let resp = DbReadyResponse {
        ok: true,
        marker_hash,
        transfer_mode: "json".to_string(),
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
            let kb = data.len() as f64 / 1024.0;
            sync_log(&format!("[SLAVE] Wysylam {:.1} KB scalonych danych do mastera", kb));
            (200, data)
        },
        Err(e) => (500, json_error(&format!("No merged data available: {}", e))),
    }
}

fn handle_verify_ack(state: &LanSyncState) -> (u16, String) {
    state.set_progress(12, "verifying", "local");
    sync_log("[SLAVE] Weryfikacja scalonych danych...");
    let dir = config::config_dir().ok();
    if let Some(d) = &dir {
        let _ = std::fs::remove_file(d.join("lan_sync_incoming.json"));
        let _ = std::fs::remove_file(d.join("lan_sync_merged.json"));
    }
    state.sync_in_progress.store(false, Ordering::SeqCst);
    (200, json_ok())
}

fn handle_unfreeze(state: &LanSyncState) -> (u16, String) {
    state.unfreeze();
    state.set_role("undecided");
    sync_log("[SLAVE] Baza odmrozona — synchronizacja zakonczona!");
    // Set completed — UI will auto-dismiss after seeing this phase
    state.set_progress(13, "completed", "local");
    (200, json_ok())
}

// ── Legacy pull/push (backward compat with Tauri dashboard client) ──

fn handle_pull(body: &str) -> (u16, String) {
    #[derive(Deserialize)]
    #[allow(dead_code)]
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

fn handle_push(body: &str) -> (u16, String) {
    let conn = match open_dashboard_db() {
        Ok(c) => c,
        Err(e) => return (500, json_error(&e)),
    };

    // Import the delta archive directly
    match import_push_data(&conn, body) {
        Ok(summary) => (200, summary),
        Err(e) => (500, json_error(&e)),
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

    if state.sync_in_progress.load(Ordering::Relaxed) {
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
    if state.sync_in_progress.load(Ordering::Relaxed) {
        return (409, json_error("Sync already in progress"));
    }

    let settings = crate::config::load_online_sync_settings();
    if !settings.enabled {
        return (400, json_error("Online sync is not enabled"));
    }
    if settings.server_url.is_empty() || settings.auth_token.is_empty() {
        return (400, json_error("Online sync not configured (missing server_url or auth_token)"));
    }

    log::info!("Online trigger-sync: dashboard requested online sync");

    let state_clone = state.clone();
    let stop_clone = stop_signal.clone();
    std::thread::spawn(move || {
        crate::online_sync::run_online_sync(settings, state_clone, stop_clone);
    });

    (200, r#"{"ok":true,"message":"online sync started"}"#.to_string())
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
        "device_id": get_device_id(),
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

fn import_push_data(_conn: &rusqlite::Connection, body: &str) -> Result<String, String> {
    // Parse the delta archive and apply it
    // This is a simplified import — the full merge logic lives in the dashboard Tauri commands.
    // For the daemon server, we accept the data and write it directly.
    let _archive: serde_json::Value = serde_json::from_str(body)
        .map_err(|e| format!("Invalid push data: {}", e))?;

    // Save to temp file for dashboard to process on next sync cycle
    let dir = config::config_dir().map_err(|e| e.to_string())?;
    let path = dir.join("lan_sync_push_pending.json");
    std::fs::write(&path, body).map_err(|e| format!("Failed to save push data: {}", e))?;

    log::info!("LAN server: saved push data ({} bytes) for processing", body.len());

    Ok(r#"{"ok":true,"imported":{"projects_merged":0,"apps_merged":0,"sessions_merged":0,"manual_sessions_merged":0,"tombstones_applied":0}}"#.to_string())
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
