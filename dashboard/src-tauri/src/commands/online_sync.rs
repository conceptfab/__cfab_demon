//! Online Sync — Tauri commands for server-based synchronization.

use serde::{Deserialize, Serialize};

const DAEMON_BASE: &str = "http://127.0.0.1:47891";

fn build_http_client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::blocking::Client::new())
}

fn timeflow_data_dir() -> Result<std::path::PathBuf, String> {
    super::helpers::timeflow_data_dir()
}

// ── Types ──

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct OnlineSyncSettings {
    pub enabled: bool,
    pub server_url: String,
    pub auth_token: String,
    #[serde(default)]
    pub device_id: String,
    #[serde(default)]
    pub encryption_key: String,
    pub sync_interval_minutes: u32,
    pub auto_sync_on_startup: bool,
}

impl Default for OnlineSyncSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            server_url: String::new(),
            auth_token: String::new(),
            device_id: String::new(),
            encryption_key: String::new(),
            sync_interval_minutes: 30,
            auto_sync_on_startup: false,
        }
    }
}

// ── Commands ──

/// Get online sync settings from file.
#[tauri::command]
pub fn get_online_sync_settings() -> Result<OnlineSyncSettings, String> {
    let path = timeflow_data_dir()?.join("online_sync_settings.json");
    if !path.exists() {
        return Ok(OnlineSyncSettings::default());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// Save online sync settings to file.
/// auth_token IS persisted because the daemon process reads this file directly
/// and has no access to Tauri secure storage.
#[tauri::command]
pub fn save_online_sync_settings(settings: OnlineSyncSettings) -> Result<(), String> {
    let path = timeflow_data_dir()?.join("online_sync_settings.json");
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// Trigger online sync via daemon HTTP endpoint.
#[tauri::command]
pub async fn run_online_sync() -> Result<String, String> {
    let result = tokio::task::spawn_blocking(move || {
        let client = build_http_client();
        let url = format!("{}/online/trigger-sync", DAEMON_BASE);
        let resp = client
            .post(&url)
            .send()
            .map_err(|e| format!("Daemon unreachable: {}", e))?;
        let status = resp.status();
        let body = resp
            .text()
            .map_err(|e| format!("Read response failed: {}", e))?;
        if !status.is_success() {
            return Err(format!("Daemon refused: {} — {}", status, body));
        }
        Ok(body)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    Ok(result)
}

/// Get online sync progress (reuses LAN sync progress endpoint since they share state).
#[tauri::command]
pub async fn get_online_sync_progress() -> Result<super::lan_sync::SyncProgress, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(format!("{}/online/sync-progress", DAEMON_BASE))
        .send()
        .await
        .map_err(|e| format!("Daemon not reachable: {}", e))?;

    let progress: super::lan_sync::SyncProgress = resp.json().await.map_err(|e| e.to_string())?;
    Ok(progress)
}

/// Cancel online sync — placeholder until daemon exposes /online/cancel-sync endpoint.
#[tauri::command]
pub fn cancel_online_sync() -> Result<(), String> {
    log::warn!("cancel_online_sync called but daemon endpoint not yet implemented");
    // TODO: implement /online/cancel-sync endpoint in daemon
    Ok(())
}
