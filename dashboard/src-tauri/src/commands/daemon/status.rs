use tauri::AppHandle;

use crate::commands::helpers::run_app_blocking;
use crate::commands::types::{BackgroundDiagnostics, DateRange};

use super::{
    build_daemon_status, daemon_log_path, load_persisted_session_min_duration, read_last_n_lines,
    startup_dir, DAEMON_AUTOSTART_LNK,
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

#[tauri::command]
pub async fn get_background_diagnostics(
    app: AppHandle,
) -> Result<BackgroundDiagnostics, String> {
    use crate::commands::get_assignment_model_status;
    use crate::commands::get_session_count;
    use crate::commands::types::SessionFilters;

    let min_duration = load_persisted_session_min_duration();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    let today_filters = SessionFilters {
        date_range: Some(DateRange {
            start: today.clone(),
            end: today,
        }),
        app_id: None,
        project_id: None,
        unassigned: Some(true),
        min_duration: Some(min_duration),
        include_files: None,
        include_ai_suggestions: None,
        limit: None,
        offset: None,
    };
    let all_filters = SessionFilters {
        date_range: None,
        app_id: None,
        project_id: None,
        unassigned: Some(true),
        min_duration: Some(min_duration),
        include_files: None,
        include_ai_suggestions: None,
        limit: None,
        offset: None,
    };

    let app1 = app.clone();
    let app2 = app.clone();
    let app3 = app.clone();

    let daemon_handle = tauri::async_runtime::spawn(get_daemon_runtime_status(app));
    let ai_handle = tauri::async_runtime::spawn(get_assignment_model_status(app1));
    let today_handle = tauri::async_runtime::spawn(get_session_count(app2, today_filters));
    let all_handle = tauri::async_runtime::spawn(get_session_count(app3, all_filters));

    let daemon_status = daemon_handle
        .await
        .map_err(|e| format!("daemon join error: {}", e))??;
    let ai_status = ai_handle
        .await
        .map_err(|e| format!("ai join error: {}", e))??;
    let today_unassigned = today_handle
        .await
        .map_err(|e| format!("today count join error: {}", e))??;
    let all_unassigned = all_handle
        .await
        .map_err(|e| format!("all count join error: {}", e))??;

    Ok(BackgroundDiagnostics {
        daemon_status,
        ai_status,
        today_unassigned,
        all_unassigned,
    })
}
