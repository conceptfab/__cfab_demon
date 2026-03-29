// LAN Server — Embedded HTTP server for peer-to-peer sync.
// Listens on port 47891 (configurable), handles /lan/ping, /lan/status, /lan/pull, /lan/push.
// Uses std::net::TcpListener — no extra dependencies.

use super::delta_export::{DeltaArchive, TableHashes};
use super::helpers::compute_table_hash;
use super::lan_sync::{import_delta_into_db, LanImportSummary};
use crate::db;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::AppHandle;

const DEFAULT_LAN_PORT: u16 = 47891;
const MAX_REQUEST_BODY: usize = 50 * 1024 * 1024; // 50MB max

// ── Global server state ──

static SERVER_RUNNING: AtomicBool = AtomicBool::new(false);
static SERVER_STOP: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);
static SERVER_PORT: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(0);

// ── Request/Response types ──

#[derive(Deserialize)]
struct StatusRequest {
    #[allow(dead_code)]
    device_id: String,
    table_hashes: TableHashes,
}

#[derive(Serialize)]
struct StatusResponse {
    needs_push: bool,
    needs_pull: bool,
    their_hashes: TableHashes,
}

#[derive(Deserialize)]
struct PullRequest {
    #[allow(dead_code)]
    device_id: String,
    since: String,
}

#[derive(Serialize)]
struct PushResponse {
    ok: bool,
    imported: LanImportSummary,
}

#[derive(Serialize)]
struct PingResponse {
    ok: bool,
    version: String,
    device_id: String,
    machine_name: String,
}

#[derive(Serialize)]
struct ErrorResponse {
    ok: bool,
    error: String,
}

// ── Tauri commands ──

#[tauri::command]
pub fn start_lan_server(app: AppHandle, port: Option<u16>) -> Result<(), String> {
    if SERVER_RUNNING.load(Ordering::SeqCst) {
        return Err("LAN server is already running".to_string());
    }

    let port = port.unwrap_or(DEFAULT_LAN_PORT);
    let stop_signal = Arc::new(AtomicBool::new(false));

    {
        let mut guard = SERVER_STOP.lock().map_err(|e| e.to_string())?;
        *guard = Some(stop_signal.clone());
    }

    let listener = TcpListener::bind(format!("0.0.0.0:{}", port))
        .map_err(|e| format!("Failed to bind port {}: {}", port, e))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Failed to set non-blocking: {}", e))?;

    SERVER_RUNNING.store(true, Ordering::SeqCst);
    SERVER_PORT.store(port, Ordering::SeqCst);
    log::info!("LAN server started on port {}", port);

    thread::spawn(move || {
        run_server(listener, stop_signal, app);
    });

    Ok(())
}

#[tauri::command]
pub fn stop_lan_server() -> Result<(), String> {
    if !SERVER_RUNNING.load(Ordering::SeqCst) {
        return Ok(());
    }
    let guard = SERVER_STOP.lock().map_err(|e| e.to_string())?;
    if let Some(stop) = guard.as_ref() {
        stop.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub fn get_lan_server_status() -> Result<super::lan_sync::LanServerStatus, String> {
    let running = SERVER_RUNNING.load(Ordering::SeqCst);
    let port = if running {
        Some(SERVER_PORT.load(Ordering::SeqCst))
    } else {
        None
    };
    Ok(super::lan_sync::LanServerStatus { running, port })
}

// ── Server loop ──

fn run_server(listener: TcpListener, stop_signal: Arc<AtomicBool>, app: AppHandle) {
    loop {
        if stop_signal.load(Ordering::Relaxed) {
            break;
        }

        match listener.accept() {
            Ok((stream, _addr)) => {
                let app_clone = app.clone();
                thread::spawn(move || {
                    if let Err(e) = handle_connection(stream, &app_clone) {
                        log::debug!("LAN server: connection error: {}", e);
                    }
                });
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => {
                log::warn!("LAN server: accept error: {}", e);
                thread::sleep(std::time::Duration::from_millis(100));
            }
        }
    }

    SERVER_RUNNING.store(false, Ordering::SeqCst);
    SERVER_PORT.store(0, Ordering::SeqCst);
    log::info!("LAN server stopped");
}

// ── HTTP request handling ──

fn handle_connection(
    mut stream: std::net::TcpStream,
    app: &AppHandle,
) -> Result<(), String> {
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(30)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(std::time::Duration::from_secs(30)))
        .map_err(|e| e.to_string())?;

    let mut reader = BufReader::new(&stream);

    // Parse HTTP request line
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .map_err(|e| e.to_string())?;
    let parts: Vec<&str> = request_line.trim().split_whitespace().collect();
    if parts.len() < 2 {
        return Err("Invalid HTTP request".to_string());
    }
    let method = parts[0];
    let path = parts[1];

    // Parse headers
    let mut content_length: usize = 0;
    loop {
        let mut header_line = String::new();
        reader
            .read_line(&mut header_line)
            .map_err(|e| e.to_string())?;
        let trimmed = header_line.trim();
        if trimmed.is_empty() {
            break;
        }
        if let Some(value) = trimmed.strip_prefix("Content-Length:") {
            content_length = value.trim().parse().unwrap_or(0);
        }
        if let Some(value) = trimmed.strip_prefix("content-length:") {
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

    // Route request
    let (status, response_body) = match (method, path) {
        ("GET", "/lan/ping") => handle_ping(),
        ("POST", "/lan/status") => handle_status(app, &body),
        ("POST", "/lan/pull") => handle_pull(app, &body),
        ("POST", "/lan/push") => handle_push(app, &body),
        _ => (404, r#"{"ok":false,"error":"not found"}"#.to_string()),
    };

    // Write HTTP response
    let response = format!(
        "HTTP/1.1 {} {}\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Connection: close\r\n\
         \r\n\
         {}",
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
        500 => "Internal Server Error",
        _ => "Unknown",
    }
}

// ── Endpoint handlers ──

fn handle_ping() -> (u16, String) {
    let resp = PingResponse {
        ok: true,
        version: crate::VERSION.trim().to_string(),
        device_id: super::helpers::get_machine_id(),
        machine_name: std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string()),
    };
    (200, serde_json::to_string(&resp).unwrap_or_default())
}

fn handle_status(app: &AppHandle, body: &str) -> (u16, String) {
    let req: StatusRequest = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return (400, json_error(&format!("Invalid request: {}", e))),
    };

    let conn = match db::get_connection(app) {
        Ok(c) => c,
        Err(e) => return (500, json_error(&e)),
    };

    let local_hashes = TableHashes {
        projects: compute_table_hash(&conn, "projects"),
        applications: compute_table_hash(&conn, "applications"),
        sessions: compute_table_hash(&conn, "sessions"),
        manual_sessions: compute_table_hash(&conn, "manual_sessions"),
    };

    let needs_push = local_hashes.projects != req.table_hashes.projects
        || local_hashes.applications != req.table_hashes.applications
        || local_hashes.sessions != req.table_hashes.sessions
        || local_hashes.manual_sessions != req.table_hashes.manual_sessions;

    let needs_pull = needs_push; // symmetric: if hashes differ, both sides need data

    let resp = StatusResponse {
        needs_push,
        needs_pull,
        their_hashes: local_hashes,
    };
    (200, serde_json::to_string(&resp).unwrap_or_default())
}

fn handle_pull(app: &AppHandle, body: &str) -> (u16, String) {
    let req: PullRequest = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return (400, json_error(&format!("Invalid request: {}", e))),
    };

    match super::delta_export::build_delta_archive(app.clone(), req.since) {
        Ok((archive, _)) => (200, serde_json::to_string(&archive).unwrap_or_default()),
        Err(e) => (500, json_error(&e)),
    }
}

fn handle_push(app: &AppHandle, body: &str) -> (u16, String) {
    let delta: DeltaArchive = match serde_json::from_str(body) {
        Ok(d) => d,
        Err(e) => return (400, json_error(&format!("Invalid delta archive: {}", e))),
    };

    let mut conn = match db::get_connection(app) {
        Ok(c) => c,
        Err(e) => return (500, json_error(&e)),
    };

    match import_delta_into_db(&mut conn, &delta) {
        Ok(summary) => {
            let resp = PushResponse {
                ok: true,
                imported: summary,
            };
            (200, serde_json::to_string(&resp).unwrap_or_default())
        }
        Err(e) => (500, json_error(&e)),
    }
}

fn json_error(msg: &str) -> String {
    serde_json::to_string(&ErrorResponse {
        ok: false,
        error: msg.to_string(),
    })
    .unwrap_or_else(|_| format!(r#"{{"ok":false,"error":"{}"}}"#, msg))
}
