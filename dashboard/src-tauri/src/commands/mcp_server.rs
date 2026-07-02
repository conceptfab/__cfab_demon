use tauri::AppHandle;

use crate::commands::error::CommandError;
use crate::mcp;
use crate::webui;

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[tauri::command]
pub async fn mcp_status(_app: AppHandle) -> Result<mcp::McpStatus, CommandError> {
    let cfg = mcp::config::load();
    let web_cfg = webui::config::load();
    Ok(mcp::McpStatus {
        enabled: cfg.enabled,
        running: cfg.enabled && webui::server_running(),
        read_write: cfg.read_write,
        port: web_cfg.port,
        active_sessions: mcp::sessions().active_count(now_secs()),
        token: cfg.token,
    })
}

#[tauri::command]
pub async fn mcp_set_config(
    app: AppHandle,
    enabled: bool,
    read_write: bool,
) -> Result<mcp::McpStatus, CommandError> {
    let mut cfg = mcp::config::load();
    cfg.enabled = enabled;
    cfg.read_write = read_write;
    cfg.ensure_token(webui::auth::random_token);
    mcp::config::save(&cfg).map_err(CommandError::Other)?;

    if enabled {
        let web_cfg = webui::config::load();
        let lan = web_cfg.enabled && web_cfg.lan_exposure;
        webui::ensure_started(&app, web_cfg.port, lan).map_err(CommandError::Other)?;
    }
    log::info!("[mcp] config updated: enabled={enabled}, read_write={read_write}");
    mcp_status(app).await
}

#[tauri::command]
pub async fn mcp_regenerate_token(app: AppHandle) -> Result<mcp::McpStatus, CommandError> {
    let mut cfg = mcp::config::load();
    cfg.token = webui::auth::random_token();
    mcp::config::save(&cfg).map_err(CommandError::Other)?;
    log::info!("[mcp] token regenerated");
    mcp_status(app).await
}

#[tauri::command]
pub async fn mcp_list_sessions(_app: AppHandle) -> Result<Vec<mcp::McpSessionInfo>, CommandError> {
    Ok(mcp::sessions().list(now_secs()))
}
