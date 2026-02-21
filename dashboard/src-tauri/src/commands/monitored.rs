use super::helpers::cfab_demon_dir;
use super::types::{MonitoredApp, MonitoredConfig};
use std::collections::HashSet;

fn monitored_apps_path() -> Result<std::path::PathBuf, String> {
    let dir = cfab_demon_dir()?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir.join("monitored_apps.json"))
}

fn load_monitored_config() -> Result<MonitoredConfig, String> {
    let path = monitored_apps_path()?;
    if !path.exists() {
        return Ok(MonitoredConfig::default());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut cfg: MonitoredConfig = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    // Normalize legacy entries for case-insensitive matching/removal.
    for app in &mut cfg.apps {
        app.exe_name = app.exe_name.trim().to_lowercase();
    }
    Ok(cfg)
}

pub(crate) fn monitored_exe_name_set() -> Result<HashSet<String>, String> {
    let cfg = load_monitored_config()?;
    Ok(cfg
        .apps
        .into_iter()
        .map(|a| a.exe_name.trim().to_lowercase())
        .filter(|n| !n.is_empty())
        .collect())
}

fn save_monitored_config(config: &MonitoredConfig) -> Result<(), String> {
    let path = monitored_apps_path()?;
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_monitored_apps() -> Result<Vec<MonitoredApp>, String> {
    let config = load_monitored_config()?;
    Ok(config.apps)
}

#[tauri::command]
pub async fn add_monitored_app(exe_name: String, display_name: String) -> Result<(), String> {
    let mut config = load_monitored_config()?;
    let exe = exe_name.trim().to_lowercase();
    if exe.is_empty() {
        return Err("exe_name cannot be empty".to_string());
    }
    if config.apps.iter().any(|a| a.exe_name == exe) {
        return Err(format!("{} is already monitored", exe));
    }
    let display = if display_name.trim().is_empty() {
        exe.clone()
    } else {
        display_name.trim().to_string()
    };
    config.apps.push(MonitoredApp {
        exe_name: exe,
        display_name: display,
        added_at: chrono::Local::now().to_rfc3339(),
    });
    save_monitored_config(&config)
}

#[tauri::command]
pub async fn remove_monitored_app(exe_name: String) -> Result<(), String> {
    let mut config = load_monitored_config()?;
    let exe = exe_name.trim().to_lowercase();
    config.apps.retain(|a| a.exe_name != exe);
    save_monitored_config(&config)
}
