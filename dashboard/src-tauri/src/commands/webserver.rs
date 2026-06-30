use tauri::AppHandle;

use crate::commands::error::CommandError;
use crate::webui::{self, auth::SessionInfo, config::WebServerConfig};

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[tauri::command]
pub async fn webserver_status(_app: AppHandle) -> Result<webui::WebServerStatus, CommandError> {
    let cfg = webui::config::load();
    Ok(webui::WebServerStatus {
        enabled: cfg.enabled,
        running: cfg.enabled,
        port: cfg.port,
        lan_exposure: cfg.lan_exposure,
    })
}

#[tauri::command]
pub async fn webserver_set_config(
    _app: AppHandle,
    enabled: bool,
    port: u16,
    lan_exposure: bool,
) -> Result<(), CommandError> {
    webui::config::save(&WebServerConfig {
        enabled,
        port,
        lan_exposure,
    })
    .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn webserver_generate_pairing_code(_app: AppHandle) -> Result<String, CommandError> {
    let code = webui::auth::random_pairing_code();
    webui::auth().set_pairing_code(code.clone(), now_secs());
    Ok(code)
}

#[tauri::command]
pub async fn webserver_list_sessions(_app: AppHandle) -> Result<Vec<SessionInfo>, CommandError> {
    Ok(webui::auth().list_sessions(now_secs()))
}

#[tauri::command]
pub async fn webserver_revoke_session(_app: AppHandle, id: String) -> Result<(), CommandError> {
    webui::auth().revoke(&id);
    Ok(())
}
