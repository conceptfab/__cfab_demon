use super::helpers::timeflow_data_dir;
use serde::{Deserialize, Serialize};

const LOG_FILES: &[(&str, &str)] = &[
    ("daemon", "daemon.log"),
    ("lan_sync", "lan_sync.log"),
    ("online_sync", "online_sync.log"),
    ("dashboard", "dashboard.log"),
];

fn logs_dir() -> Result<std::path::PathBuf, String> {
    let base = timeflow_data_dir()?;
    let logs = base.join("logs");
    std::fs::create_dir_all(&logs).map_err(|e| format!("Failed to create logs dir: {}", e))?;
    Ok(logs)
}

// ── Log Settings ──

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LogSettings {
    #[serde(default = "default_level")]
    pub daemon_level: String,
    #[serde(default = "default_level")]
    pub lan_sync_level: String,
    #[serde(default = "default_level")]
    pub online_sync_level: String,
    #[serde(default = "default_level")]
    pub dashboard_level: String,
    #[serde(default = "default_max_size")]
    pub max_log_size_kb: u32,
}

fn default_level() -> String { "info".to_string() }
fn default_max_size() -> u32 { 1024 }

impl Default for LogSettings {
    fn default() -> Self {
        Self {
            daemon_level: default_level(),
            lan_sync_level: default_level(),
            online_sync_level: default_level(),
            dashboard_level: default_level(),
            max_log_size_kb: default_max_size(),
        }
    }
}

#[tauri::command]
pub async fn get_log_settings() -> Result<LogSettings, String> {
    let base = timeflow_data_dir()?;
    let path = base.join("log_settings.json");
    if !path.exists() {
        return Ok(LogSettings::default());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_log_settings(settings: LogSettings) -> Result<(), String> {
    let base = timeflow_data_dir()?;
    let path = base.join("log_settings.json");
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

// ── Log Reading ──

#[derive(Serialize)]
pub struct LogFileInfo {
    pub name: String,
    pub key: String,
    pub size_bytes: u64,
    pub exists: bool,
}

#[tauri::command]
pub async fn get_log_files_info() -> Result<Vec<LogFileInfo>, String> {
    let dir = logs_dir()?;
    let mut files = Vec::new();
    for (key, filename) in LOG_FILES {
        let path = dir.join(filename);
        let (exists, size_bytes) = if path.exists() {
            let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
            (true, meta.len())
        } else {
            (false, 0)
        };
        files.push(LogFileInfo {
            name: filename.to_string(),
            key: key.to_string(),
            size_bytes,
            exists,
        });
    }
    Ok(files)
}

#[tauri::command]
pub async fn read_log_file(key: String, tail_lines: Option<usize>) -> Result<String, String> {
    let filename = LOG_FILES
        .iter()
        .find(|(k, _)| *k == key.as_str())
        .map(|(_, f)| *f)
        .ok_or_else(|| format!("Unknown log key: {}", key))?;

    let dir = logs_dir()?;
    let path = dir.join(filename);
    if !path.exists() {
        return Ok(String::new());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    match tail_lines {
        Some(n) => {
            let all: Vec<&str> = content.lines().collect();
            let start = all.len().saturating_sub(n);
            Ok(all[start..].join("\n"))
        }
        None => Ok(content),
    }
}

#[tauri::command]
pub async fn clear_log_file(key: String) -> Result<(), String> {
    let filename = LOG_FILES
        .iter()
        .find(|(k, _)| *k == key.as_str())
        .map(|(_, f)| *f)
        .ok_or_else(|| format!("Unknown log key: {}", key))?;

    let dir = logs_dir()?;
    let path = dir.join(filename);
    if path.exists() {
        std::fs::write(&path, "").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_logs_folder() -> Result<(), String> {
    let dir = logs_dir()?;
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer")
            .arg(dir.to_string_lossy().to_string())
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(dir.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(dir.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
