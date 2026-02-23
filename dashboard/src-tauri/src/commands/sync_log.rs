use super::helpers::timeflow_data_dir;
use std::fs::{self, OpenOptions};
use std::io::Write;

const SYNC_LOG_FILENAME: &str = "sync.log";
const MAX_LOG_SIZE_BYTES: u64 = 2 * 1024 * 1024; // 2 MB
const ROTATED_LOG_FILENAME: &str = "sync.log.old";

#[tauri::command]
pub async fn append_sync_log(lines: Vec<String>) -> Result<(), String> {
    let base_dir = timeflow_data_dir()?;
    let log_path = base_dir.join(SYNC_LOG_FILENAME);
    let rotated_path = base_dir.join(ROTATED_LOG_FILENAME);

    // Rotate if the log file exceeds the size limit.
    if let Ok(meta) = fs::metadata(&log_path) {
        if meta.len() >= MAX_LOG_SIZE_BYTES {
            let _ = fs::copy(&log_path, &rotated_path);
            let _ = fs::write(&log_path, b"");
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
    let base_dir = timeflow_data_dir()?;
    let log_path = base_dir.join(SYNC_LOG_FILENAME);

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
