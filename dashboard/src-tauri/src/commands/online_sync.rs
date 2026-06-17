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

/// Keychain accounts for the online-sync secrets. Shared with the daemon
/// (timeflow_shared::secret_store, service "TIMEFLOW") so both read the same
/// entries — see src/config.rs::load_online_sync_settings.
const KC_AUTH: &str = "online.auth_token";
const KC_ENC: &str = "online.encryption_key";

/// Get online sync settings. Secrets are hydrated from the OS keychain; the JSON
/// on disk holds only non-sensitive fields. Legacy JSON with inline secrets is
/// migrated into the keychain (and stripped from the file) on first read.
#[tauri::command]
pub fn get_online_sync_settings() -> Result<OnlineSyncSettings, String> {
    let path = timeflow_data_dir()?.join("online_sync_settings.json");
    let mut settings = if path.exists() {
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str::<OnlineSyncSettings>(&content).map_err(|e| e.to_string())?
    } else {
        OnlineSyncSettings::default()
    };
    // Migracja: jeśli JSON nadal trzyma sekrety, przenieś do keychaina i wyczyść plik.
    let needs_migration =
        !settings.auth_token.is_empty() || !settings.encryption_key.is_empty();
    if needs_migration {
        // save_* zapisze sekrety do keychaina i wyzeruje je w pliku na dysku.
        save_online_sync_settings(settings.clone())?;
    }
    settings.auth_token = timeflow_shared::secret_store::get_secret(KC_AUTH).unwrap_or_default();
    settings.encryption_key = timeflow_shared::secret_store::get_secret(KC_ENC).unwrap_or_default();
    Ok(settings)
}

/// Save online sync settings. Secrets go to the OS keychain; the JSON on disk is
/// written WITHOUT secrets (the daemon hydrates them from the keychain too).
#[tauri::command]
pub fn save_online_sync_settings(settings: OnlineSyncSettings) -> Result<(), String> {
    timeflow_shared::secret_store::set_secret(KC_AUTH, &settings.auth_token)?;
    timeflow_shared::secret_store::set_secret(KC_ENC, &settings.encryption_key)?;
    let on_disk = OnlineSyncSettings {
        auth_token: String::new(),
        encryption_key: String::new(),
        ..settings
    };
    let path = timeflow_data_dir()?.join("online_sync_settings.json");
    let json = serde_json::to_string_pretty(&on_disk).map_err(|e| e.to_string())?;
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

/// Cancel online sync via daemon HTTP endpoint.
#[tauri::command]
pub async fn cancel_online_sync() -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let client = build_http_client();
        let url = format!("{}/online/cancel-sync", DAEMON_BASE);
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
        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}
