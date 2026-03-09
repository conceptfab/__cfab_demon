use tauri::AppHandle;

use super::estimates::get_project_estimates;
use super::helpers::run_app_blocking;
use super::manual_sessions::get_manual_sessions;
use super::projects::{get_project_extra_info, get_projects};
use super::sessions::get_sessions;
use super::types::{DateRange, ManualSessionFilters, ProjectReportData, SessionFilters};

#[tauri::command]
pub async fn get_project_report_data(
    app: AppHandle,
    project_id: i64,
    date_range: DateRange,
) -> Result<ProjectReportData, String> {
    let projects_handle = tauri::async_runtime::spawn({
        let app = app.clone();
        let date_range = date_range.clone();
        async move { get_projects(app, Some(date_range)).await }
    });
    let extra_handle = tauri::async_runtime::spawn({
        let app = app.clone();
        let date_range = date_range.clone();
        async move { get_project_extra_info(app, project_id, date_range).await }
    });
    let estimates_handle = tauri::async_runtime::spawn({
        let app = app.clone();
        let date_range = date_range.clone();
        async move { get_project_estimates(app, date_range).await }
    });
    let sessions_handle = tauri::async_runtime::spawn({
        let app = app.clone();
        let date_range = date_range.clone();
        async move {
            get_sessions(
                app,
                SessionFilters {
                    date_range: Some(date_range),
                    app_id: None,
                    project_id: Some(project_id),
                    unassigned: None,
                    min_duration: None,
                    include_files: Some(true),
                    include_ai_suggestions: Some(true),
                    limit: None,
                    offset: None,
                },
            )
            .await
        }
    });
    let manual_sessions_handle = tauri::async_runtime::spawn({
        let app = app.clone();
        let date_range = date_range.clone();
        async move {
            run_app_blocking(app, move |app| {
                get_manual_sessions(
                    app,
                    ManualSessionFilters {
                        date_range: Some(date_range),
                        project_id: Some(project_id),
                    },
                )
            })
            .await
        }
    });

    let projects = projects_handle
        .await
        .map_err(|e| format!("Projects task join failed: {}", e))??;
    let extra = extra_handle
        .await
        .map_err(|e| format!("Extra info task join failed: {}", e))??;
    let estimates = estimates_handle
        .await
        .map_err(|e| format!("Estimates task join failed: {}", e))??;
    let sessions = sessions_handle
        .await
        .map_err(|e| format!("Sessions task join failed: {}", e))??;
    let manual_sessions = manual_sessions_handle
        .await
        .map_err(|e| format!("Manual sessions task join failed: {}", e))??;

    let project = projects
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    let estimate = estimates
        .into_iter()
        .find(|row| row.project_id == project_id)
        .map(|row| row.estimated_value)
        .unwrap_or(0.0);

    Ok(ProjectReportData {
        project,
        extra,
        estimate,
        sessions,
        manual_sessions,
    })
}
