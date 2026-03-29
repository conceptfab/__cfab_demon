use std::process::Command;

use crate::commands::helpers::{
    no_console, timeflow_data_dir, DAEMON_AUTOSTART_LNK, DAEMON_EXE_NAME,
};

use super::{clear_cached_daemon_process_status, find_daemon_exe, session_settings, startup_dir};

#[tauri::command]
pub async fn set_autostart_enabled(enabled: bool) -> Result<(), String> {
    let dir = startup_dir()?;
    let lnk_path = dir.join(DAEMON_AUTOSTART_LNK);

    if enabled {
        let exe = find_daemon_exe()?;
        let ps_script = format!(
            "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut('{}'); $sc.TargetPath = '{}'; $sc.Save()",
            lnk_path.to_string_lossy().replace('\'', "''"),
            exe.to_string_lossy().replace('\'', "''")
        );
        let mut cmd = Command::new("powershell");
        no_console(&mut cmd);
        let output = cmd
            .args(["-NoProfile", "-Command", &ps_script])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(format!(
                "Failed to create shortcut: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
    } else if lnk_path.exists() {
        std::fs::remove_file(&lnk_path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn start_daemon() -> Result<(), String> {
    let exe = find_daemon_exe()?;
    let mut cmd = Command::new(&exe);
    no_console(&mut cmd);
    cmd.spawn()
        .map_err(|e| format!("Failed to start daemon: {}", e))?;
    clear_cached_daemon_process_status();
    Ok(())
}

#[tauri::command]
pub async fn stop_daemon() -> Result<(), String> {
    let mut cmd = Command::new("taskkill");
    no_console(&mut cmd);
    let output = cmd
        .args(["/F", "/T", "/IM", DAEMON_EXE_NAME])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !stderr.contains("not found") {
            return Err(format!("Failed to stop daemon: {}", stderr));
        }
    }
    clear_cached_daemon_process_status();
    Ok(())
}

#[tauri::command]
pub async fn restart_daemon() -> Result<(), String> {
    let mut kill_cmd = Command::new("taskkill");
    no_console(&mut kill_cmd);
    let _ = kill_cmd.args(["/F", "/T", "/IM", DAEMON_EXE_NAME]).output();
    clear_cached_daemon_process_status();
    tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
    let exe = find_daemon_exe()?;
    let mut start_cmd = Command::new(&exe);
    no_console(&mut start_cmd);
    start_cmd
        .spawn()
        .map_err(|e| format!("Failed to start daemon: {}", e))?;
    clear_cached_daemon_process_status();
    Ok(())
}

#[tauri::command]
pub async fn persist_language_for_daemon(code: String) -> Result<(), String> {
    let base_dir = timeflow_data_dir()?;
    let lang_file = base_dir.join("language.json");
    let normalized = if code.to_lowercase().starts_with("pl") {
        "pl"
    } else {
        "en"
    };
    let content = format!("{{\"code\":\"{}\"}}", normalized);
    std::fs::write(&lang_file, content).map_err(|e| format!("Failed to write language.json: {}", e))
}

#[tauri::command]
pub async fn persist_session_settings_for_daemon(
    min_session_duration_seconds: i64,
) -> Result<(), String> {
    let base_dir = timeflow_data_dir()?;
    let settings = session_settings::SharedSessionSettings {
        min_session_duration_seconds,
    };
    session_settings::write_session_settings(&base_dir, &settings)
}

#[tauri::command]
pub async fn persist_lan_sync_settings_for_daemon(
    sync_interval_hours: u32,
    discovery_duration_minutes: u32,
    enabled: bool,
) -> Result<(), String> {
    let base_dir = timeflow_data_dir()?;
    let path = base_dir.join("lan_sync_settings.json");
    let content = serde_json::json!({
        "sync_interval_hours": sync_interval_hours,
        "discovery_duration_minutes": discovery_duration_minutes,
        "enabled": enabled,
    });
    std::fs::write(&path, content.to_string())
        .map_err(|e| format!("Failed to write lan_sync_settings.json: {}", e))
}
