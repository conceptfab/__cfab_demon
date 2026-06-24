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

/// Uwaga: ten struct świadomie zna tylko podzbiór pól pliku. Pozostałe pola demona
/// (`sync_master_key`, `sync_mode`, `group_id`, `user_id`, przyszłe) NIE są tu
/// wymienione — `save_online_sync_settings` scala, więc są zachowywane nietknięte.
/// Gdy front zacznie nimi zarządzać, trafią do tego structu + formularza UI.
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

/// Get online sync settings. Wszystkie pola — w tym sekrety — są w pliku JSON
/// w katalogu danych (bez keychaina). Demon czyta ten sam plik.
#[tauri::command]
pub fn get_online_sync_settings() -> Result<OnlineSyncSettings, String> {
    let path = timeflow_data_dir()?.join("online_sync_settings.json");
    if path.exists() {
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str::<OnlineSyncSettings>(&content).map_err(|e| e.to_string())
    } else {
        Ok(OnlineSyncSettings::default())
    }
}

/// Save online sync settings. SCALA z istniejącym plikiem zamiast nadpisywać:
/// nadpisuje tylko pola znane temu strukturowi, a zachowuje wszystkie pozostałe
/// (np. ustawione przez demona pola, których ten front nie zna). Eliminuje parity
/// trap — wcześniej `fs::write` całości kasował np. `group_id`/`sync_mode`.
#[tauri::command]
pub fn save_online_sync_settings(settings: serde_json::Value) -> Result<(), String> {
    let path = timeflow_data_dir()?.join("online_sync_settings.json");

    let mut root = if path.exists() {
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str::<serde_json::Value>(&content).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    // `settings` jest nietypowane (Value), więc pola NIEZNANE temu backendowi
    // (`sync_master_key`, `sync_mode`, `group_id` ustawiane przez demona/front)
    // też przechodzą. Front wysyła sekrety tylko gdy mają wartość, więc pusty
    // formularz nie nadpisze ich pustym stringiem.
    if let (Some(obj), Some(inc)) = (root.as_object_mut(), settings.as_object()) {
        for (k, v) in inc {
            obj.insert(k.clone(), v.clone());
        }
    } else {
        root = settings;
    }

    let json = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// Trigger online sync via daemon HTTP endpoint.
///
/// `background=true` oznacza automatyczny trigger (sync po starcie) — demon
/// wymusi wtedy pełny interwał względem ostatniego ukończonego synca i odrzuci
/// żądanie z HTTP 429, jeśli interwał jeszcze nie minął.
///
/// `force=true` (manualny sync z UI) omija zarówno bramkę interwału, jak i cooldown
/// po nieudanych próbach. Auto-wyzwalacze wysyłają `force=false` i podlegają cooldownowi,
/// dzięki czemu padający serwer nie wywołuje retry stormu.
#[tauri::command]
pub async fn run_online_sync(background: Option<bool>, force: Option<bool>) -> Result<String, String> {
    let background = background.unwrap_or(false);
    let force = force.unwrap_or(false);
    let result = tokio::task::spawn_blocking(move || {
        let client = build_http_client();
        let url = format!("{}/online/trigger-sync", DAEMON_BASE);
        let resp = client
            .post(&url)
            .json(&serde_json::json!({ "background": background, "force": force }))
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

#[derive(serde::Deserialize, serde::Serialize)]
pub struct OnlineSyncResult {
    pub ok: bool,
    pub phase: String,
    pub error: Option<String>,
    #[serde(rename = "syncedHash", alias = "synced_hash")]
    pub synced_hash: Option<String>,
    #[serde(rename = "finishedAt", alias = "finished_at")]
    pub finished_at: u64,
}

/// Get last online sync result from the daemon.
#[tauri::command]
pub async fn get_online_sync_result() -> Result<OnlineSyncResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(format!("{}/online/last-result", DAEMON_BASE))
        .send()
        .await
        .map_err(|e| format!("Daemon not reachable: {}", e))?;

    resp.json::<OnlineSyncResult>().await.map_err(|e| e.to_string())
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
