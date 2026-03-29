// LAN Server proxy — delegates to the daemon's LAN server (port 47891).
// The daemon starts the LAN server automatically; these commands let the
// dashboard query its status without running a second server.

use super::lan_sync::LanServerStatus;

const DAEMON_LAN_URL: &str = "http://127.0.0.1:47891/lan/ping";

/// Start is a no-op — the daemon manages the LAN server lifecycle.
#[tauri::command]
pub fn start_lan_server(_port: Option<u16>) -> Result<(), String> {
    Ok(())
}

/// Stop is a no-op — the daemon manages the LAN server lifecycle.
#[tauri::command]
pub fn stop_lan_server() -> Result<(), String> {
    Ok(())
}

/// Check if the daemon's LAN server is reachable.
#[tauri::command]
pub async fn get_lan_server_status() -> Result<LanServerStatus, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;

    match client.get(DAEMON_LAN_URL).send().await {
        Ok(resp) if resp.status().is_success() => Ok(LanServerStatus {
            running: true,
            port: Some(47891),
        }),
        _ => Ok(LanServerStatus {
            running: false,
            port: None,
        }),
    }
}
