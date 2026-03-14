use tauri::AppHandle;

use crate::commands::helpers::run_app_blocking;

use super::{
    build_daemon_status, daemon_log_path, read_last_n_lines, startup_dir, DAEMON_AUTOSTART_LNK,
};

#[tauri::command]
pub async fn get_daemon_status(
    app: AppHandle,
    min_duration: Option<i64>,
) -> Result<super::DaemonStatus, String> {
    run_app_blocking(app, move |app| {
        build_daemon_status(&app, min_duration, false, true)
    })
    .await
}

#[tauri::command]
pub async fn get_daemon_runtime_status(app: AppHandle) -> Result<super::DaemonStatus, String> {
    run_app_blocking(app, move |app| build_daemon_status(&app, None, true, false)).await
}

#[tauri::command]
pub async fn get_daemon_logs(tail_lines: Option<usize>) -> Result<String, String> {
    let log_path = daemon_log_path()?;
    if !log_path.exists() {
        return Ok(String::new());
    }
    let n = tail_lines.unwrap_or(100).clamp(1, 5000);
    read_last_n_lines(&log_path, n)
}

#[tauri::command]
pub async fn get_autostart_enabled() -> Result<bool, String> {
    let dir = startup_dir()?;
    Ok(dir.join(DAEMON_AUTOSTART_LNK).exists())
}
