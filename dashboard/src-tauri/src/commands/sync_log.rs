use super::helpers::timeflow_data_dir;
use std::fs::{self, OpenOptions};
use std::io::Write;

const SYNC_LOG_FILENAME: &str = "online_sync.log";
const MAX_LOG_SIZE_BYTES: u64 = 2 * 1024 * 1024; // 2 MB

fn sync_log_path() -> Result<std::path::PathBuf, String> {
    let base_dir = timeflow_data_dir()?;
    let logs_dir = base_dir.join("logs");
    let _ = fs::create_dir_all(&logs_dir);
    Ok(logs_dir.join(SYNC_LOG_FILENAME))
}

#[tauri::command]
pub async fn append_sync_log(lines: Vec<String>) -> Result<(), String> {
    let log_path = sync_log_path()?;

    // Rotate if the log file exceeds the size limit.
    if let Ok(meta) = fs::metadata(&log_path) {
        if meta.len() >= MAX_LOG_SIZE_BYTES {
            // Keep last half instead of full rotate
            if let Ok(content) = fs::read_to_string(&log_path) {
                let keep = content.len() / 2;
                let start = content[keep..].find('\n').map(|i| keep + i + 1).unwrap_or(keep);
                let _ = fs::write(&log_path, &content[start..]);
            }
        }
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to open sync log: {}", e))?;

    for line in &lines {
        writeln!(file, "{}", line).map_err(|e| format!("Failed to write sync log: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn get_sync_log(tail_lines: Option<usize>) -> Result<String, String> {
    let log_path = sync_log_path()?;

    if !log_path.exists() {
        return Ok(String::new());
    }

    let content = fs::read_to_string(&log_path).map_err(|e| e.to_string())?;

    match tail_lines {
        Some(n) => {
            let all: Vec<&str> = content.lines().collect();
            let start = all.len().saturating_sub(n);
            Ok(all[start..].join("\n"))
        }
        None => Ok(content),
    }
}
