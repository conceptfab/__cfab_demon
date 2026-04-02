//! Online Sync Orchestrator — 13-step state machine using server coordination + SFTP transfer.

use crate::config;
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
const SYNC_TIMEOUT: Duration = Duration::from_secs(300); // 5 min
const MAX_POLL_ATTEMPTS: u32 = 100; // ~5 min at 3s intervals

fn sync_log(msg: &str) {
    sync_common::sync_log(msg);
}

// ── Server response types ──

#[allow(dead_code)]
#[derive(Deserialize)]
struct SessionCreateResponse {
    ok: bool,
    #[serde(rename = "sessionId")]
    session_id: String,
    role: String,
    status: String,
    #[serde(rename = "peerDeviceId")]
    peer_device_id: Option<String>,
    #[serde(rename = "peerMarkerHash")]
    peer_marker_hash: Option<String>,
    #[serde(rename = "syncMode")]
    sync_mode: Option<String>,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct SessionStatusResponse {
    ok: bool,
    status: String,
    #[serde(rename = "myRole")]
    my_role: String,
    #[serde(rename = "currentStep")]
    current_step: u32,
    #[serde(rename = "syncMode")]
    sync_mode: Option<String>,
    #[serde(rename = "peerReady")]
    peer_ready: bool,
    #[serde(rename = "nextAction")]
    next_action: Option<String>,
    #[serde(rename = "storageCredentials")]
    storage_credentials: Option<StorageCredentialsWrapper>,
}

#[derive(Deserialize)]
struct StorageCredentialsWrapper {
    encrypted: sync_encryption::EncryptedCredentials,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct ReportResponse {
    ok: bool,
    #[serde(rename = "currentStep")]
    current_step: u32,
    #[serde(rename = "sessionStatus")]
    session_status: String,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct HeartbeatResponse {
    ok: bool,
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
) -> Result<SessionCreateResponse, String> {
    let body = serde_json::json!({
        "deviceId": device_id,
        "markerHash": marker_hash,
        "tableHashes": table_hashes.map(|h| serde_json::json!({"combined": h})),
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
        return Err("Online sync timeout".to_string());
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
    sync_state.set_role("undecided");
}

fn execute_online_sync(
    settings: &config::OnlineSyncSettings,
    sync_state: &LanSyncState,
    stop_signal: &AtomicBool,
    session_id_out: &mut Option<String>,
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

    sync_log("[1/13] Tworzenie sesji na serwerze...");
    let create_resp = create_session(
        server_url,
        token,
        &device_id,
        local_marker.as_deref(),
        Some(&tables_hash),
    )?;
    if !create_resp.ok {
        return Err("Server rejected session creation".to_string());
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
        sftp.upload_data(&encrypted, &remote_file, |sent, total| {
            sync_state.update_transfer_bytes(sent, total);
        })?;
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
        let merged_encrypted =
            sftp.download_data(&remote_merged, |recv, total| {
                sync_state.update_transfer_bytes(recv, total);
            })?;
        let merged_data =
            sync_encryption::decrypt_file_data(&merged_encrypted, file_key)?;
        let merged_str = String::from_utf8(merged_data).map_err(|e| e.to_string())?;

        // Import merged data
        sync_log("[12/13] Importowanie scalonych danych...");
        sync_common::backup_database()?;
        sync_common::merge_incoming_data(conn, &merged_str)?;
        sync_common::verify_merge_integrity(conn)?;

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

        report_step(
            server_url,
            token,
            session_id,
            12,
            "slave_imported",
            device_id,
            serde_json::json!({"marker": &new_marker[..16.min(new_marker.len())]}),
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
        let slave_encrypted =
            sftp.download_data(&remote_file, |recv, total| {
                sync_state.update_transfer_bytes(recv, total);
            })?;
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
        sync_common::backup_database()?;
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

        // Step 9: Merge
        sync_state.set_progress(9, "merging", "local");
        sync_log("[9/13] Scalanie danych...");
        sync_common::merge_incoming_data(conn, &slave_str)?;
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

        // Step 10: Verify
        sync_state.set_progress(10, "verifying", "local");
        sync_log("[10/13] Weryfikacja...");
        sync_common::verify_merge_integrity(conn)?;

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
        report_step(
            server_url,
            token,
            session_id,
            10,
            "verify_complete",
            device_id,
            serde_json::json!({"marker": &new_marker[..16.min(new_marker.len())]}),
            "ok",
        )?;

        // Step 11: Upload merged result for slave
        sync_state.set_progress(11, "uploading_merged", "upload");
        sync_log("[11/13] Budowanie i wysyłanie scalonych danych...");
        let merged_export = sync_common::build_full_export(conn)?;
        let merged_encrypted =
            sync_encryption::encrypt_file_data(merged_export.as_bytes(), file_key)?;
        let remote_merged = format!("{}data.enc", creds.download_path);
        sftp.upload_data(&merged_encrypted, &remote_merged, |sent, total| {
            sync_state.update_transfer_bytes(sent, total);
        })?;
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
