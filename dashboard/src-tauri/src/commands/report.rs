use tauri::AppHandle;

use super::estimates::get_project_estimates;
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
    let project = get_projects(app.clone(), Some(date_range.clone()))
        .await?
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| "Project not found".to_string())?;

    let extra = get_project_extra_info(app.clone(), project_id, date_range.clone()).await?;

    let estimate = get_project_estimates(app.clone(), date_range.clone())
        .await?
        .into_iter()
        .find(|row| row.project_id == project_id)
        .map(|row| row.estimated_value)
        .unwrap_or(0.0);

    let sessions = get_sessions(
        app.clone(),
        SessionFilters {
            date_range: Some(date_range.clone()),
            app_id: None,
            project_id: Some(project_id),
            unassigned: None,
            min_duration: None,
            include_ai_suggestions: Some(true),
            limit: None,
            offset: None,
        },
    )
    .await?;

    let manual_sessions = get_manual_sessions(
        app,
        ManualSessionFilters {
            date_range: Some(date_range),
            project_id: Some(project_id),
        },
    )?;

    Ok(ProjectReportData {
        project,
        extra,
        estimate,
        sessions,
        manual_sessions,
    })
}
