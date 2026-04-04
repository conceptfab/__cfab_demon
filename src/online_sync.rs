//! Online Sync Orchestrator — 13-step state machine using server coordination + SFTP transfer.

use crate::config;
use crate::lan_common::sync_log;
use crate::lan_server::LanSyncState;
use crate::sftp_client::SftpClient;
use crate::sync_common;
use crate::sync_encryption;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

const POLL_INTERVAL: Duration = Duration::from_secs(3);
const SYNC_TIMEOUT: Duration = Duration::from_secs(1800); // 30 min
const MAX_POLL_ATTEMPTS: u32 = 200; // ~10 min at 3s intervals
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(10);
const MAX_RETRIES: u32 = 3;
const RETRY_BASE_DELAY: Duration = Duration::from_secs(5);

// ── Server response types ──

#[derive(Deserialize)]
struct SessionCreateResponse {
    ok: bool,
    #[serde(rename = "sessionId")]
    session_id: String,
    role: String,
    status: String,
    #[serde(rename = "syncMode")]
    sync_mode: Option<String>,
}

#[derive(Deserialize)]
struct SessionStatusResponse {
    status: String,
    #[serde(rename = "currentStep")]
    current_step: u32,
    #[serde(rename = "syncMode")]
    sync_mode: Option<String>,
    #[serde(rename = "storageCredentials")]
    storage_credentials: Option<StorageCredentialsWrapper>,
}

#[derive(Deserialize)]
struct StorageCredentialsWrapper {
    encrypted: sync_encryption::EncryptedCredentials,
}

#[derive(Deserialize)]
struct ReportResponse {}

// ── Retry helper ──

fn with_retry<T, F: Fn() -> Result<T, String>>(label: &str, f: F) -> Result<T, String> {
    let mut last_err = String::new();
    for attempt in 0..MAX_RETRIES {
        match f() {
            Ok(v) => return Ok(v),
            Err(e) => {
                last_err = e.clone();
                if attempt + 1 < MAX_RETRIES {
                    let delay = RETRY_BASE_DELAY * 3u32.pow(attempt); // 5s, 15s, 45s
                    sync_log(&format!(
                        "[retry] {} attempt {}/{} failed: {} — retrying in {:?}",
                        label, attempt + 1, MAX_RETRIES, e, delay
                    ));
                    thread::sleep(delay);
                }
            }
        }
    }
    Err(format!("{} failed after {} retries: {}", label, MAX_RETRIES, last_err))
}

// ── Heartbeat thread ──

struct HeartbeatGuard {
    stop: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
}

impl HeartbeatGuard {
    fn start(
        server_url: String,
        token: String,
        session_id: String,
        device_id: String,
    ) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_clone = stop.clone();
        let handle = thread::spawn(move || {
            while !stop_clone.load(Ordering::Relaxed) {
                thread::sleep(HEARTBEAT_INTERVAL);
                if stop_clone.load(Ordering::Relaxed) {
                    break;
                }
                send_heartbeat(&server_url, &token, &session_id, &device_id).ok();
            }
        });
        Self {
            stop,
            handle: Some(handle),
        }
    }
}

impl Drop for HeartbeatGuard {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            h.join().ok();
        }
    }
}

// ── HTTP client using ureq (supports TLS, DNS, chunked encoding) ──

fn server_post(server_url: &str, path: &str, token: &str, body: &str) -> Result<String, String> {
    let url = format!("{}{}", server_url.trim_end_matches('/'), path);
    let resp = ureq::post(&url)
        .set("Authorization", &format!("Bearer {}", token))
        .set("Content-Type", "application/json")
        .timeout(std::time::Duration::from_secs(30))
        .send_string(body)
        .map_err(|e| format!("HTTP POST failed: {}", e))?;
    resp.into_string().map_err(|e| format!("Read response: {}", e))
}

fn server_get(server_url: &str, path: &str, token: &str) -> Result<String, String> {
    let url = format!("{}{}", server_url.trim_end_matches('/'), path);
    let resp = ureq::get(&url)
        .set("Authorization", &format!("Bearer {}", token))
        .timeout(std::time::Duration::from_secs(30))
        .call()
        .map_err(|e| format!("HTTP GET failed: {}", e))?;
    resp.into_string().map_err(|e| format!("Read response: {}", e))
}

// ── Server API wrappers ──

fn create_session(
    server_url: &str,
    token: &str,
    device_id: &str,
    marker_hash: Option<&str>,
    table_hashes: Option<&str>,
    force_full: bool,
) -> Result<SessionCreateResponse, String> {
    let body = serde_json::json!({
        "deviceId": device_id,
        "markerHash": marker_hash,
        "tableHashes": table_hashes.map(|h| serde_json::json!({"combined": h})),
        "forceFullSync": force_full,
    });
    let resp = server_post(
        server_url,
        "/api/sync/session/create",
        token,
        &body.to_string(),
    )?;
    serde_json::from_str(&resp).map_err(|e| format!("Parse create response: {}", e))
}

fn poll_status(
    server_url: &str,
    token: &str,
    session_id: &str,
    device_id: &str,
) -> Result<SessionStatusResponse, String> {
    let path = format!(
        "/api/sync/session/{}/status?deviceId={}",
        session_id, device_id
    );
    let resp = server_get(server_url, &path, token)?;
    serde_json::from_str(&resp).map_err(|e| format!("Parse status response: {}", e))
}

fn report_step(
    server_url: &str,
    token: &str,
    session_id: &str,
    step: u32,
    action: &str,
    device_id: &str,
    details: serde_json::Value,
    status: &str,
) -> Result<ReportResponse, String> {
    let body = serde_json::json!({
        "step": step,
        "action": action,
        "deviceId": device_id,
        "details": details,
        "status": status,
    });
    let path = format!("/api/sync/session/{}/report", session_id);
    let resp = server_post(server_url, &path, token, &body.to_string())?;
    serde_json::from_str(&resp).map_err(|e| format!("Parse report response: {}", e))
}

fn send_heartbeat(
    server_url: &str,
    token: &str,
    session_id: &str,
    device_id: &str,
) -> Result<(), String> {
    let body = serde_json::json!({ "deviceId": device_id });
    let path = format!("/api/sync/session/{}/heartbeat", session_id);
    server_post(server_url, &path, token, &body.to_string())?;
    Ok(())
}

fn cancel_session(
    server_url: &str,
    token: &str,
    session_id: &str,
    device_id: &str,
    reason: &str,
) -> Result<(), String> {
    let body = serde_json::json!({ "deviceId": device_id, "reason": reason });
    let path = format!("/api/sync/session/{}/cancel", session_id);
    server_post(server_url, &path, token, &body.to_string())?;
    Ok(())
}

// ── Helper functions ──

fn check_timeout_and_stop(start: Instant, stop: &AtomicBool) -> Result<(), String> {
    if start.elapsed() > SYNC_TIMEOUT {
        return Err("Online sync timeout (30 min)".to_string());
    }
    if stop.load(Ordering::Relaxed) {
        return Err("Stop signal received".to_string());
    }
    Ok(())
}

fn wait_for_peer(
    server_url: &str,
    token: &str,
    session_id: &str,
    device_id: &str,
    _sync_state: &LanSyncState,
    stop_signal: &AtomicBool,
    sync_start: Instant,
) -> Result<(String, Option<StorageCredentialsWrapper>), String> {
    for _ in 0..MAX_POLL_ATTEMPTS {
        check_timeout_and_stop(sync_start, stop_signal)?;
        thread::sleep(POLL_INTERVAL);
        send_heartbeat(server_url, token, session_id, device_id).ok();

        let status = poll_status(server_url, token, session_id, device_id)?;
        if status.status != "awaiting_peer" {
            let mode = status
                .sync_mode
                .unwrap_or_else(|| "full".to_string());
            return Ok((mode, status.storage_credentials));
        }
    }
    Err("Timeout waiting for peer".to_string())
}

fn wait_for_storage(
    server_url: &str,
    token: &str,
    session_id: &str,
    device_id: &str,
    stop_signal: &AtomicBool,
    sync_start: Instant,
) -> Result<StorageCredentialsWrapper, String> {
    for _ in 0..MAX_POLL_ATTEMPTS {
        check_timeout_and_stop(sync_start, stop_signal)?;
        thread::sleep(POLL_INTERVAL);
        let status = poll_status(server_url, token, session_id, device_id)?;
        if let Some(creds) = status.storage_credentials {
            return Ok(creds);
        }
    }
    Err("Timeout waiting for storage credentials".to_string())
}

fn wait_for_step(
    server_url: &str,
    token: &str,
    session_id: &str,
    device_id: &str,
    target_step: u32,
    stop_signal: &AtomicBool,
    sync_start: Instant,
) -> Result<(), String> {
    for _ in 0..MAX_POLL_ATTEMPTS {
        check_timeout_and_stop(sync_start, stop_signal)?;
        thread::sleep(POLL_INTERVAL);
        send_heartbeat(server_url, token, session_id, device_id).ok();

        let status = poll_status(server_url, token, session_id, device_id)?;
        if status.status == "failed"
            || status.status == "cancelled"
            || status.status == "expired"
        {
            return Err(format!("Session ended: {}", status.status));
        }
        if status.current_step >= target_step {
            return Ok(());
        }
    }
    Err(format!("Timeout waiting for step {}", target_step))
}

// ── Async delta types ──

#[derive(Deserialize)]
struct AsyncPushResponse {
    #[serde(rename = "packageId")]
    package_id: String,
    #[serde(rename = "storageCredentials")]
    storage_credentials: Option<StorageCredentialsWrapper>,
}

#[derive(Deserialize)]
struct AsyncPendingPackage {
    id: String,
    #[serde(rename = "fromDeviceId")]
    from_device_id: String,
    #[serde(rename = "baseMarkerHash")]
    base_marker_hash: Option<String>,
}

#[derive(Deserialize)]
struct AsyncPendingResponse {
    packages: Vec<AsyncPendingPackage>,
}

#[derive(Deserialize)]
struct AsyncAckResponse {}

// ── Async delta API wrappers ──

fn async_push(
    server_url: &str,
    token: &str,
    device_id: &str,
    group_id: &str,
    base_marker_hash: Option<&str>,
    new_marker_hash: &str,
    file_size_bytes: usize,
) -> Result<AsyncPushResponse, String> {
    let body = serde_json::json!({
        "deviceId": device_id,
        "groupId": group_id,
        "baseMarkerHash": base_marker_hash,
        "newMarkerHash": new_marker_hash,
        "fileSizeBytes": file_size_bytes,
    });
    let resp = server_post(server_url, "/api/sync/async/push", token, &body.to_string())?;
    serde_json::from_str(&resp).map_err(|e| format!("Parse async push response: {}", e))
}

fn async_pending(
    server_url: &str,
    token: &str,
    device_id: &str,
    group_id: &str,
) -> Result<AsyncPendingResponse, String> {
    let body = serde_json::json!({
        "deviceId": device_id,
        "groupId": group_id,
    });
    let resp = server_post(server_url, "/api/sync/async/pending", token, &body.to_string())?;
    serde_json::from_str(&resp).map_err(|e| format!("Parse async pending response: {}", e))
}

fn async_ack(
    server_url: &str,
    token: &str,
    device_id: &str,
    package_id: &str,
) -> Result<AsyncAckResponse, String> {
    let body = serde_json::json!({
        "deviceId": device_id,
        "packageId": package_id,
    });
    let resp = server_post(server_url, "/api/sync/async/ack", token, &body.to_string())?;
    serde_json::from_str(&resp).map_err(|e| format!("Parse async ack response: {}", e))
}

#[derive(Deserialize)]
struct AsyncCredentialsResponse {
    #[serde(rename = "storageCredentials")]
    storage_credentials: Option<StorageCredentialsWrapper>,
}

fn async_get_credentials(
    server_url: &str,
    token: &str,
    device_id: &str,
    package_id: &str,
) -> Result<AsyncCredentialsResponse, String> {
    let body = serde_json::json!({
        "deviceId": device_id,
        "packageId": package_id,
    });
    let resp = server_post(server_url, "/api/sync/async/credentials", token, &body.to_string())?;
    serde_json::from_str(&resp).map_err(|e| format!("Parse async credentials response: {}", e))
}

fn async_reject(
    server_url: &str,
    token: &str,
    device_id: &str,
    package_id: &str,
    reason: &str,
) -> Result<(), String> {
    let body = serde_json::json!({
        "deviceId": device_id,
        "packageId": package_id,
        "reason": reason,
    });
    server_post(server_url, "/api/sync/async/reject", token, &body.to_string())?;
    Ok(())
}

// ── Async delta orchestrator ──

/// Execute async delta push: export local changes, encrypt, upload to storage.
fn execute_async_push(
    settings: &config::OnlineSyncSettings,
    sync_state: &LanSyncState,
    group_id: &str,
) -> Result<(), String> {
    let server_url = &settings.server_url;
    let token = &settings.auth_token;
    let device_id = if settings.device_id.is_empty() {
        sync_common::get_device_id()
    } else {
        settings.device_id.clone()
    };

    let conn = sync_common::open_dashboard_db()?;

    // Build delta since last sync
    let last_sync_ts = sync_common::get_last_sync_timestamp(&conn);
    sync_log(&format!("[async-push] Last sync: {:?}", last_sync_ts));

    let (delta_json, delta_size) = sync_common::build_delta_export(&conn, last_sync_ts.as_deref())?;
    if delta_size == 0 {
        sync_log("[async-push] No changes to push");
        return Ok(());
    }

    // Compute new marker hash
    let tables_hash = sync_common::compute_tables_hash_string_conn(&conn);
    let timestamp = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let new_marker = sync_common::generate_marker_hash_simple(&tables_hash, &timestamp, &device_id);

    let local_marker = conn
        .query_row(
            "SELECT marker_hash FROM sync_markers ORDER BY created_at DESC LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();

    // Register package on server
    sync_state.set_progress(1, "async_push_registering", "upload");
    sync_log("[async-push] Registering delta package on server...");
    let push_resp = async_push(
        server_url,
        token,
        &device_id,
        group_id,
        local_marker.as_deref(),
        &new_marker,
        delta_size,
    )?;

    // Decrypt storage credentials and upload
    if let Some(creds_wrapper) = &push_resp.storage_credentials {
        let creds = sync_encryption::decrypt_credentials(
            &creds_wrapper.encrypted,
            &push_resp.package_id,
            &settings.encryption_key,
        )?;

        // Encrypt delta data
        let file_key = &creds.file_encryption_key;
        let encrypted_delta = sync_encryption::encrypt_file_data(delta_json.as_bytes(), file_key)?;

        // Upload via SFTP
        sync_state.set_progress(2, "async_push_uploading", "upload");
        sync_log(&format!("[async-push] Uploading {} bytes to storage...", encrypted_delta.len()));
        let sftp = SftpClient::new(&creds.host, creds.port, &creds.username, &creds.password);
        let remote_path = format!("{}delta.enc", creds.upload_path);
        with_retry("SFTP upload (async delta)", || {
            sftp.upload_data(&encrypted_delta, &remote_path, |sent, total| {
                sync_state.update_transfer_bytes(sent, total);
            })
        })?;
        sync_log("[async-push] Upload complete");
    } else {
        return Err("No storage credentials returned for async push".to_string());
    }

    // Insert sync marker
    sync_common::insert_sync_marker_db(
        &conn,
        &new_marker,
        &timestamp,
        &device_id,
        None,
        &tables_hash,
        false,
    )?;

    sync_log(&format!("[async-push] Delta package {} registered, marker: {}", &push_resp.package_id[..8], &new_marker[..16]));
    Ok(())
}

/// Execute async delta pull: check for pending packages, download, decrypt, merge.
fn execute_async_pull(
    settings: &config::OnlineSyncSettings,
    sync_state: &LanSyncState,
    group_id: &str,
) -> Result<bool, String> {
    let server_url = &settings.server_url;
    let token = &settings.auth_token;
    let device_id = if settings.device_id.is_empty() {
        sync_common::get_device_id()
    } else {
        settings.device_id.clone()
    };

    // Check for pending packages
    sync_state.set_progress(1, "async_pull_checking", "download");
    sync_log("[async-pull] Checking for pending packages...");
    let pending = async_pending(server_url, token, &device_id, group_id)?;

    if pending.packages.is_empty() {
        sync_log("[async-pull] No pending packages");
        return Ok(false);
    }

    sync_log(&format!("[async-pull] Found {} pending package(s)", pending.packages.len()));

    let mut conn = sync_common::open_dashboard_db()?;

    for pkg in &pending.packages {
        sync_log(&format!("[async-pull] Processing package {} from device {}", &pkg.id[..8], &pkg.from_device_id[..8.min(pkg.from_device_id.len())]));

        // Check base marker compatibility
        let local_marker: Option<String> = conn
            .query_row(
                "SELECT marker_hash FROM sync_markers ORDER BY created_at DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .ok();

        if let Some(ref base) = pkg.base_marker_hash {
            if local_marker.as_deref() != Some(base) {
                sync_log(&format!("[async-pull] Base marker mismatch — rejecting package {}", &pkg.id[..8]));
                async_reject(server_url, token, &device_id, &pkg.id, "base_marker_mismatch")?;
                // Signal that caller should fall back to session sync
                return Err("base_marker_mismatch — fallback to session sync needed".to_string());
            }
        }

        // Backup before merge
        sync_state.set_progress(2, "async_pull_backup", "local");
        sync_common::backup_database(&conn)?;

        // Request credentials for this package via server
        sync_state.set_progress(3, "async_pull_downloading", "download");
        sync_log("[async-pull] Requesting storage credentials...");

        let creds_resp = async_get_credentials(server_url, token, &device_id, &pkg.id)?;
        let creds = match creds_resp.storage_credentials {
            Some(cw) => sync_encryption::decrypt_credentials(
                &cw.encrypted,
                &pkg.id,
                &settings.encryption_key,
            )?,
            None => return Err("No storage credentials for async pull".to_string()),
        };

        sync_log("[async-pull] Downloading delta from storage...");
        let sftp = SftpClient::new(&creds.host, creds.port, &creds.username, &creds.password);
        let remote_path = format!("{}delta.enc", creds.upload_path);
        let encrypted = with_retry("SFTP download (async delta)", || {
            sftp.download_data(&remote_path, |sent, total| {
                sync_state.update_transfer_bytes(sent, total);
            })
        })?;
        let file_key = &creds.file_encryption_key;
        let delta_data = sync_encryption::decrypt_file_data(&encrypted, file_key)?;

        // Merge delta
        sync_state.set_progress(4, "async_pull_merging", "local");
        sync_log("[async-pull] Merging delta data...");
        let delta_str = String::from_utf8(delta_data)
            .map_err(|e| format!("Invalid UTF-8 in delta: {}", e))?;

        if let Err(e) = sync_common::merge_incoming_data(&mut conn, &delta_str) {
            sync_log(&format!("[async-pull] Merge failed: {} — restoring backup", e));
            sync_common::restore_database_backup(&conn)?;
            async_reject(server_url, token, &device_id, &pkg.id, &format!("merge_failed: {}", e))?;
            return Err(format!("Async merge failed: {}", e));
        }

        // Verify integrity
        if let Err(e) = sync_common::verify_merge_integrity(&conn) {
            sync_log(&format!("[async-pull] Integrity check failed: {} — restoring backup", e));
            sync_common::restore_database_backup(&conn)?;
            async_reject(server_url, token, &device_id, &pkg.id, &format!("integrity_failed: {}", e))?;
            return Err(format!("Async integrity check failed: {}", e));
        }

        // Insert new sync marker
        let tables_hash = sync_common::compute_tables_hash_string_conn(&conn);
        let timestamp = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let new_marker = sync_common::generate_marker_hash_simple(&tables_hash, &timestamp, &device_id);
        sync_common::insert_sync_marker_db(
            &conn,
            &new_marker,
            &timestamp,
            &device_id,
            Some(&pkg.from_device_id),
            &tables_hash,
            false,
        )?;

        // Acknowledge package
        async_ack(server_url, token, &device_id, &pkg.id)?;
        sync_log(&format!("[async-pull] Package {} applied and acknowledged", &pkg.id[..8]));
    }

    Ok(true)
}

/// Run async delta sync: pull pending packages first, then push local changes.
pub fn run_async_delta_sync(
    settings: config::OnlineSyncSettings,
    sync_state: Arc<LanSyncState>,
    group_id: &str,
) {
    sync_log("=== START ASYNC DELTA SYNC ===");
    sync_state.set_progress(1, "async_delta", "local");

    match execute_async_pull(&settings, &sync_state, group_id) {
        Ok(had_packages) => {
            if had_packages {
                sync_log("[async] Pull complete, now pushing local changes...");
            }
        }
        Err(e) if e.contains("base_marker_mismatch") => {
            sync_log("[async] Base marker mismatch — falling back to session sync");
            sync_state.reset_progress();
            run_online_sync(settings, sync_state, Arc::new(AtomicBool::new(false)));
            return;
        }
        Err(e) => {
            sync_log(&format!("[async] Pull error: {}", e));
            sync_state.unfreeze();
            sync_state.reset_progress();
            return;
        }
    }

    match execute_async_push(&settings, &sync_state, group_id) {
        Ok(()) => {
            sync_log("=== ASYNC DELTA SYNC ZAKOŃCZONY ===");
        }
        Err(e) => {
            sync_log(&format!("[async] Push error: {}", e));
        }
    }

    sync_state.sync_in_progress.store(false, Ordering::SeqCst);
    sync_state.reset_progress();
}

// ── Main orchestrator ──

/// Run online sync. Called from a dedicated thread.
pub fn run_online_sync(
    settings: config::OnlineSyncSettings,
    sync_state: Arc<LanSyncState>,
    stop_signal: Arc<AtomicBool>,
) {
    sync_log("=== START ONLINE SYNC ===");
    sync_state.set_progress(1, "creating_session", "local");

    let server_url = settings.server_url.clone();
    let token = settings.auth_token.clone();
    let device_id = if settings.device_id.is_empty() {
        sync_common::get_device_id()
    } else {
        settings.device_id.clone()
    };

    // Track session_id for error cleanup
    let mut session_id_for_cleanup: Option<String> = None;

    match execute_online_sync(
        &settings,
        &sync_state,
        &stop_signal,
        &mut session_id_for_cleanup,
    ) {
        Ok(()) => {
            sync_log("=== ONLINE SYNC ZAKOŃCZONY ===");
        }
        Err(e) => {
            sync_log(&format!("=== ONLINE SYNC BŁĄD: {} ===", e));
            sync_state.unfreeze();
            sync_state.reset_progress();
            // Try to cancel session on server (best-effort)
            if let Some(sid) = &session_id_for_cleanup {
                cancel_session(&server_url, &token, sid, &device_id, &e).ok();
            }
        }
    }
    // Ensure sync_in_progress is always reset, even on success
    sync_state.sync_in_progress.store(false, Ordering::SeqCst);
    sync_state.set_role("undecided");
}

/// Run online sync with forced full mode. Used when user explicitly requests force sync from tray menu.
pub fn run_online_sync_forced(
    settings: config::OnlineSyncSettings,
    sync_state: Arc<LanSyncState>,
    force_full: bool,
) {
    sync_log(&format!(
        "=== START ONLINE SYNC (force_full={}) ===",
        force_full
    ));
    sync_state.set_progress(1, "creating_session", "local");

    let server_url = settings.server_url.clone();
    let token = settings.auth_token.clone();
    let device_id = if settings.device_id.is_empty() {
        sync_common::get_device_id()
    } else {
        settings.device_id.clone()
    };

    let mut session_id_for_cleanup: Option<String> = None;

    match execute_online_sync_inner(
        &settings,
        &sync_state,
        &AtomicBool::new(false),
        &mut session_id_for_cleanup,
        force_full,
    ) {
        Ok(()) => {
            sync_log("=== ONLINE SYNC ZAKOŃCZONY ===");
        }
        Err(e) => {
            sync_log(&format!("=== ONLINE SYNC BŁĄD: {} ===", e));
            sync_state.unfreeze();
            sync_state.reset_progress();
            if let Some(sid) = &session_id_for_cleanup {
                cancel_session(&server_url, &token, sid, &device_id, &e).ok();
            }
        }
    }
    // Ensure sync_in_progress is always reset, even on success
    sync_state.sync_in_progress.store(false, Ordering::SeqCst);
    sync_state.set_role("undecided");
}

fn execute_online_sync(
    settings: &config::OnlineSyncSettings,
    sync_state: &LanSyncState,
    stop_signal: &AtomicBool,
    session_id_out: &mut Option<String>,
) -> Result<(), String> {
    execute_online_sync_inner(settings, sync_state, stop_signal, session_id_out, false)
}

fn execute_online_sync_inner(
    settings: &config::OnlineSyncSettings,
    sync_state: &LanSyncState,
    stop_signal: &AtomicBool,
    session_id_out: &mut Option<String>,
    force_full: bool,
) -> Result<(), String> {
    let server_url = &settings.server_url;
    let token = &settings.auth_token;
    let device_id = if settings.device_id.is_empty() {
        sync_common::get_device_id()
    } else {
        settings.device_id.clone()
    };
    let sync_start = Instant::now();

    // Open DB connection
    let mut conn = sync_common::open_dashboard_db()?;

    // Step 1-2: Create session on server
    sync_state.set_progress(1, "creating_session", "local");
    let local_marker = conn
        .query_row(
            "SELECT marker_hash FROM sync_markers ORDER BY created_at DESC LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();
    let tables_hash = sync_common::compute_tables_hash_string_conn(&conn);

    sync_log(&format!(
        "[1/13] Tworzenie sesji na serwerze{} ...",
        if force_full { " (force full)" } else { "" }
    ));
    let create_resp = create_session(
        server_url,
        token,
        &device_id,
        local_marker.as_deref(),
        Some(&tables_hash),
        force_full,
    )?;
    if !create_resp.ok {
        return Err("Server rejected session creation".to_string());
    }

    // Check if server says sync is not needed (databases already identical)
    if create_resp.status == "completed"
        || create_resp.sync_mode.as_deref() == Some("none")
    {
        sync_log("[1/13] Sync niepotrzebna — bazy identyczne");
        sync_state.set_progress(13, "not_needed", "local");
        sync_state.sync_in_progress.store(false, Ordering::SeqCst);
        return Ok(());
    }

    let session_id = create_resp.session_id;
    let my_role = create_resp.role.clone();
    *session_id_out = Some(session_id.clone());

    sync_log(&format!(
        "[1/13] Sesja: {} | Rola: {}",
        &session_id[..8.min(session_id.len())],
        my_role
    ));
    sync_state.set_role(&my_role);

    // Step 2: Wait for peer if master, or proceed if slave
    sync_state.set_progress(2, "awaiting_peer", "local");
    let (sync_mode, storage_creds) = if create_resp.status == "awaiting_peer" {
        // We're master, wait for slave to join
        sync_log("[2/13] Oczekiwanie na drugiego klienta...");
        wait_for_peer(
            server_url,
            token,
            &session_id,
            &device_id,
            sync_state,
            stop_signal,
            sync_start,
        )?
    } else {
        // We're slave, session already has peer
        sync_log(&format!(
            "[2/13] Dołączono jako {} | tryb: {:?}",
            my_role, create_resp.sync_mode
        ));
        let status = poll_status(server_url, token, &session_id, &device_id)?;
        let creds = status.storage_credentials;
        (
            create_resp
                .sync_mode
                .unwrap_or_else(|| "full".to_string()),
            creds,
        )
    };

    // Override sync mode if force_full requested
    let sync_mode = if force_full {
        sync_log("[2/13] Force full override — wymuszam tryb 'full'");
        "full".to_string()
    } else {
        sync_mode
    };

    // Step 3-4: Negotiate — get SFTP credentials
    sync_state.set_progress(3, "negotiating", "local");
    sync_log(&format!(
        "[3/13] Negocjacja | tryb: {} | rola: {}",
        sync_mode, my_role
    ));

    // Poll until storage credentials are available
    let sftp_creds = if let Some(creds) = storage_creds {
        creds
    } else {
        wait_for_storage(
            server_url,
            token,
            &session_id,
            &device_id,
            stop_signal,
            sync_start,
        )?
    };

    // Decrypt SFTP credentials using encryption_key (NOT the auth_token)
    if settings.encryption_key.is_empty() {
        return Err("encryption_key not configured in online sync settings".to_string());
    }
    let decrypted =
        sync_encryption::decrypt_credentials(&sftp_creds.encrypted, &session_id, &settings.encryption_key)?;
    sync_log(&format!(
        "[4/13] Kredencjały SFTP odszyfrowane | host: {}",
        decrypted.host
    ));
    sync_state.set_progress(4, "negotiated", "local");

    let sftp = SftpClient::new(
        &decrypted.host,
        decrypted.port,
        &decrypted.username,
        &decrypted.password,
    );

    // Report step 4
    report_step(
        server_url,
        token,
        &session_id,
        4,
        "negotiation_complete",
        &device_id,
        serde_json::json!({"syncMode": sync_mode, "role": my_role}),
        "ok",
    )?;

    check_timeout_and_stop(sync_start, stop_signal)?;

    // Step 5: Freeze local DB
    sync_state.set_progress(5, "freezing", "local");
    sync_log("[5/13] Zamrażanie lokalnej bazy...");
    sync_state.freeze();
    report_step(
        server_url,
        token,
        &session_id,
        5,
        "db_frozen",
        &device_id,
        serde_json::json!({}),
        "ok",
    )?;

    // Start heartbeat thread to keep session alive during long transfers
    let _heartbeat = HeartbeatGuard::start(
        server_url.to_string(),
        token.to_string(),
        session_id.clone(),
        device_id.clone(),
    );

    // From here on, ensure unfreeze on error
    let result = execute_sync_steps(
        server_url,
        token,
        &session_id,
        &device_id,
        &my_role,
        &sync_mode,
        &sftp,
        &decrypted,
        &mut conn,
        sync_state,
        stop_signal,
        sync_start,
    );

    // Step 13: Unfreeze
    sync_log("[13/13] Odmrażanie bazy...");
    sync_state.unfreeze();
    if result.is_ok() {
        report_step(
            server_url,
            token,
            &session_id,
            13,
            "db_unfrozen",
            &device_id,
            serde_json::json!({}),
            "ok",
        )
        .ok();
        sync_state.set_progress(13, "completed", "local");
    } else {
        report_step(
            server_url,
            token,
            &session_id,
            13,
            "sync_failed",
            &device_id,
            serde_json::json!({}),
            "error",
        )
        .ok();
        sync_state.reset_progress();
    }

    result
}

fn execute_sync_steps(
    server_url: &str,
    token: &str,
    session_id: &str,
    device_id: &str,
    my_role: &str,
    sync_mode: &str,
    sftp: &SftpClient,
    creds: &sync_encryption::SftpCredentials,
    conn: &mut rusqlite::Connection,
    sync_state: &LanSyncState,
    stop_signal: &AtomicBool,
    sync_start: Instant,
) -> Result<(), String> {
    let file_key = &creds.file_encryption_key;

    if my_role == "slave" {
        // ── SLAVE flow ──

        // Step 6: SLAVE uploads its database
        sync_state.set_progress(6, "uploading_to_storage", "upload");
        sync_log("[6/13] Budowanie eksportu...");
        let export = sync_common::build_full_export(conn)?;
        let encrypted =
            sync_encryption::encrypt_file_data(export.as_bytes(), file_key)?;
        let remote_file = format!("{}data.enc", creds.upload_path);
        sync_log(&format!(
            "[6/13] Wysyłanie {} KB na SFTP...",
            encrypted.len() / 1024
        ));
        {
            let sftp_ref = sftp;
            let remote_ref = &remote_file;
            let encrypted_ref = &encrypted;
            with_retry("SFTP upload (slave)", || {
                sftp_ref.upload_data(encrypted_ref, remote_ref, |sent, total| {
                    sync_state.update_transfer_bytes(sent, total);
                })
            })?;
        }
        report_step(
            server_url,
            token,
            session_id,
            6,
            "slave_uploaded",
            device_id,
            serde_json::json!({"bytes": encrypted.len()}),
            "ok",
        )?;
        sync_log("[6/13] Dane wysłane");
        check_timeout_and_stop(sync_start, stop_signal)?;

        // Step 7-10: Wait for master to merge
        sync_state.set_progress(7, "waiting_for_merge", "local");
        sync_log("[7-10/13] Oczekiwanie na scalenie przez mastera...");
        wait_for_step(
            server_url,
            token,
            session_id,
            device_id,
            11,
            stop_signal,
            sync_start,
        )?;

        // Step 12: SLAVE downloads merged result
        sync_state.set_progress(12, "downloading_from_storage", "download");
        let remote_merged = format!("{}data.enc", creds.download_path);
        sync_log("[12/13] Pobieranie scalonych danych z SFTP...");
        let merged_encrypted = {
            let sftp_ref = sftp;
            let remote_ref = &remote_merged;
            with_retry("SFTP download (slave)", || {
                sftp_ref.download_data(remote_ref, |recv, total| {
                    sync_state.update_transfer_bytes(recv, total);
                })
            })?
        };
        let merged_data =
            sync_encryption::decrypt_file_data(&merged_encrypted, file_key)?;
        let merged_str = String::from_utf8(merged_data).map_err(|e| e.to_string())?;

        // Import merged data with backup restore on error
        sync_log("[12/13] Importowanie scalonych danych...");
        sync_common::backup_database(conn)?;
        if let Err(e) = sync_common::merge_incoming_data(conn, &merged_str)
            .and_then(|_| sync_common::verify_merge_integrity(conn))
        {
            sync_log(&format!("[12/13] Merge/verify failed: {} — restoring backup", e));
            sync_common::restore_database_backup(conn).map_err(|re| {
                format!("Merge failed: {} AND backup restore failed: {}", e, re)
            })?;
            return Err(format!("Merge failed (backup restored): {}", e));
        }

        // Generate new marker
        let new_hash = sync_common::compute_tables_hash_string_conn(conn);
        let now = chrono::Utc::now()
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
        let new_marker =
            sync_common::generate_marker_hash_simple(&new_hash, &now, device_id);
        sync_common::insert_sync_marker_db(
            conn,
            &new_marker,
            &now,
            device_id,
            None,
            &new_hash,
            sync_mode == "full",
        )?;

        sync_log(&format!(
            "[12/13] Weryfikacja: lokalny marker = {}",
            &new_marker[..16.min(new_marker.len())]
        ));
        report_step(
            server_url,
            token,
            session_id,
            12,
            "slave_imported",
            device_id,
            serde_json::json!({
                "marker": &new_marker[..16.min(new_marker.len())],
                "tablesHash": &new_hash,
            }),
            "ok",
        )?;
        sync_log("[12/13] Import zakończony");
    } else {
        // ── MASTER flow ──

        // Step 6-7: Wait for slave to upload, then download
        sync_state.set_progress(6, "waiting_for_upload", "local");
        sync_log("[6/13] Oczekiwanie na upload slave'a...");
        wait_for_step(
            server_url,
            token,
            session_id,
            device_id,
            6,
            stop_signal,
            sync_start,
        )?;

        sync_state.set_progress(7, "downloading_from_storage", "download");
        let remote_file = format!("{}data.enc", creds.upload_path); // slave uploaded here
        sync_log("[7/13] Pobieranie danych slave'a z SFTP...");
        let slave_encrypted = {
            let sftp_ref = sftp;
            let remote_ref = &remote_file;
            with_retry("SFTP download (master)", || {
                sftp_ref.download_data(remote_ref, |recv, total| {
                    sync_state.update_transfer_bytes(recv, total);
                })
            })?
        };
        let slave_data =
            sync_encryption::decrypt_file_data(&slave_encrypted, file_key)?;
        let slave_str = String::from_utf8(slave_data).map_err(|e| e.to_string())?;
        report_step(
            server_url,
            token,
            session_id,
            7,
            "master_downloaded",
            device_id,
            serde_json::json!({"bytes": slave_encrypted.len()}),
            "ok",
        )?;
        sync_log(&format!(
            "[7/13] Pobrano {} KB",
            slave_encrypted.len() / 1024
        ));
        check_timeout_and_stop(sync_start, stop_signal)?;

        // Step 8: Backup
        sync_state.set_progress(8, "backing_up", "local");
        sync_log("[8/13] Kopia zapasowa...");
        sync_common::backup_database(conn)?;
        report_step(
            server_url,
            token,
            session_id,
            8,
            "backup_created",
            device_id,
            serde_json::json!({}),
            "ok",
        )?;

        // Step 9: Merge with backup restore on error
        sync_state.set_progress(9, "merging", "local");
        sync_log("[9/13] Scalanie danych...");
        if let Err(e) = sync_common::merge_incoming_data(conn, &slave_str) {
            sync_log(&format!("[9/13] Merge failed: {} — restoring backup", e));
            sync_common::restore_database_backup(conn).map_err(|re| {
                format!("Merge failed: {} AND backup restore failed: {}", e, re)
            })?;
            return Err(format!("Merge failed (backup restored): {}", e));
        }
        report_step(
            server_url,
            token,
            session_id,
            9,
            "merge_complete",
            device_id,
            serde_json::json!({}),
            "ok",
        )?;

        // Step 10: Verify with backup restore on error
        sync_state.set_progress(10, "verifying", "local");
        sync_log("[10/13] Weryfikacja...");
        if let Err(e) = sync_common::verify_merge_integrity(conn) {
            sync_log(&format!("[10/13] Verify failed: {} — restoring backup", e));
            sync_common::restore_database_backup(conn).map_err(|re| {
                format!("Verify failed: {} AND backup restore failed: {}", e, re)
            })?;
            return Err(format!("Verify failed (backup restored): {}", e));
        }

        // Generate marker
        let new_hash = sync_common::compute_tables_hash_string_conn(conn);
        let now = chrono::Utc::now()
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
        let new_marker =
            sync_common::generate_marker_hash_simple(&new_hash, &now, device_id);
        sync_common::insert_sync_marker_db(
            conn,
            &new_marker,
            &now,
            device_id,
            None,
            &new_hash,
            sync_mode == "full",
        )?;
        sync_log(&format!(
            "[10/13] Marker po merge: {}",
            &new_marker[..16.min(new_marker.len())]
        ));
        report_step(
            server_url,
            token,
            session_id,
            10,
            "verify_complete",
            device_id,
            serde_json::json!({
                "marker": &new_marker[..16.min(new_marker.len())],
                "tablesHash": &new_hash,
            }),
            "ok",
        )?;

        // Step 11: Upload merged result for slave
        sync_state.set_progress(11, "uploading_merged", "upload");
        sync_log("[11/13] Budowanie i wysyłanie scalonych danych...");
        let merged_export = sync_common::build_full_export(conn)?;
        let merged_encrypted =
            sync_encryption::encrypt_file_data(merged_export.as_bytes(), file_key)?;
        let remote_merged = format!("{}data.enc", creds.download_path);
        {
            let sftp_ref = sftp;
            let remote_ref = &remote_merged;
            let encrypted_ref = &merged_encrypted;
            with_retry("SFTP upload (master merged)", || {
                sftp_ref.upload_data(encrypted_ref, remote_ref, |sent, total| {
                    sync_state.update_transfer_bytes(sent, total);
                })
            })?;
        }
        report_step(
            server_url,
            token,
            session_id,
            11,
            "master_uploaded_merged",
            device_id,
            serde_json::json!({"bytes": merged_encrypted.len()}),
            "ok",
        )?;
        sync_log("[11/13] Dane scalone wysłane");

        // Step 12: Wait for slave to download
        sync_state.set_progress(12, "waiting_for_download", "local");
        sync_log("[12/13] Oczekiwanie na pobranie przez slave'a...");
        wait_for_step(
            server_url,
            token,
            session_id,
            device_id,
            12,
            stop_signal,
            sync_start,
        )?;
    }

    Ok(())
}
