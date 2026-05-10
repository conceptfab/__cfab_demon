use std::process::Command;

use crate::commands::helpers::{
    no_console, timeflow_data_dir, DAEMON_AUTOSTART_LNK, DAEMON_EXE_NAME,
};

use super::{clear_cached_daemon_process_status, find_daemon_exe, session_settings, startup_dir};

#[cfg(windows)]
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

/// macOS autostart: generuje LaunchAgent plist w ~/Library/LaunchAgents
/// i rejestruje go przez `launchctl load -w`. Wyłączenie — `launchctl unload -w`
/// i usunięcie pliku plist.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn set_autostart_enabled(enabled: bool) -> Result<(), String> {
    let dir = startup_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let plist_path = dir.join(DAEMON_AUTOSTART_LNK);

    if enabled {
        let exe = find_daemon_exe()?;
        let label = DAEMON_AUTOSTART_LNK
            .strip_suffix(".plist")
            .unwrap_or(DAEMON_AUTOSTART_LNK);
        let plist = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{exe}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
</dict>
</plist>
"#,
            label = label,
            exe = exe.to_string_lossy(),
        );
        std::fs::write(&plist_path, plist).map_err(|e| e.to_string())?;

        // Odśwież rejestrację w launchctl (unload ignoruje błąd gdy brak wpisu).
        let _ = Command::new("launchctl")
            .args(["unload", "-w"])
            .arg(&plist_path)
            .output();
        let output = Command::new("launchctl")
            .args(["load", "-w"])
            .arg(&plist_path)
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(format!(
                "launchctl load failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
    } else if plist_path.exists() {
        let _ = Command::new("launchctl")
            .args(["unload", "-w"])
            .arg(&plist_path)
            .output();
        std::fs::remove_file(&plist_path).map_err(|e| e.to_string())?;
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

#[cfg(windows)]
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

/// macOS/Linux: zatrzymuje daemona przez `pkill -f <exe_name>`. pkill zwraca 1
/// gdy nie znajdzie procesu — interpretujemy to jako sukces ("nic do zabicia").
#[cfg(not(windows))]
#[tauri::command]
pub async fn stop_daemon() -> Result<(), String> {
    let output = Command::new("pkill")
        .args(["-TERM", "-f", DAEMON_EXE_NAME])
        .output()
        .map_err(|e| e.to_string())?;
    // pkill exit codes: 0 = znaleziono+zabito, 1 = brak procesu (to też OK),
    // 2 = błąd składni, 3 = błąd wewnętrzny.
    let code = output.status.code().unwrap_or(-1);
    if !(code == 0 || code == 1) {
        return Err(format!(
            "pkill zakończył się kodem {code}: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    clear_cached_daemon_process_status();
    Ok(())
}

#[cfg(windows)]
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

#[cfg(not(windows))]
#[tauri::command]
pub async fn restart_daemon() -> Result<(), String> {
    let _ = Command::new("pkill")
        .args(["-TERM", "-f", DAEMON_EXE_NAME])
        .output();
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
    let content = serde_json::json!({ "code": normalized });
    std::fs::write(&lang_file, content.to_string())
        .map_err(|e| format!("Failed to write language.json: {}", e))
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
    forced_role: Option<String>,
    auto_sync_on_peer_found: Option<bool>,
) -> Result<(), String> {
    let base_dir = timeflow_data_dir()?;
    let path = base_dir.join("lan_sync_settings.json");
    let content = serde_json::json!({
        "sync_interval_hours": sync_interval_hours,
        "discovery_duration_minutes": discovery_duration_minutes,
        "enabled": enabled,
        "forced_role": forced_role.unwrap_or_default(),
        "auto_sync_on_peer_found": auto_sync_on_peer_found.unwrap_or(false),
    });
    std::fs::write(&path, content.to_string())
        .map_err(|e| format!("Failed to write lan_sync_settings.json: {}", e))
}
