use tauri::AppHandle;

use super::types::{
    MultiProjectAnalysis, SessionFilters, SessionSplittableFlag, SessionWithApp, SplitPart,
};

mod manual_overrides;
mod mutations;
mod query;
mod rebuild;
mod split;
#[cfg(test)]
mod tests;

pub(crate) use manual_overrides::apply_manual_session_overrides;

#[tauri::command]
pub async fn get_sessions(
    app: AppHandle,
    filters: SessionFilters,
) -> Result<Vec<SessionWithApp>, String> {
    query::get_sessions(app, filters).await
}

#[tauri::command]
pub async fn get_session_count(app: AppHandle, filters: SessionFilters) -> Result<i64, String> {
    query::get_session_count(app, filters).await
}

#[tauri::command]
pub async fn assign_session_to_project(
    app: AppHandle,
    session_id: i64,
    project_id: Option<i64>,
    source: Option<String>,
) -> Result<(), String> {
    mutations::assign_session_to_project(app, session_id, project_id, source).await
}

#[tauri::command]
pub async fn assign_sessions_to_project(
    app: AppHandle,
    session_ids: Vec<i64>,
    project_id: Option<i64>,
    source: Option<String>,
) -> Result<(), String> {
    mutations::assign_sessions_to_project(app, session_ids, project_id, source).await
}

#[tauri::command]
pub async fn update_session_rate_multiplier(
    app: AppHandle,
    session_id: i64,
    multiplier: Option<f64>,
) -> Result<(), String> {
    mutations::update_session_rate_multiplier(app, session_id, multiplier).await
}

#[tauri::command]
pub async fn update_session_rate_multipliers(
    app: AppHandle,
    session_ids: Vec<i64>,
    multiplier: Option<f64>,
) -> Result<(), String> {
    mutations::update_session_rate_multipliers(app, session_ids, multiplier).await
}

#[tauri::command]
pub async fn delete_session(app: AppHandle, session_id: i64) -> Result<(), String> {
    mutations::delete_session(app, session_id).await
}

#[tauri::command]
pub async fn delete_sessions(app: AppHandle, session_ids: Vec<i64>) -> Result<(), String> {
    mutations::delete_sessions(app, session_ids).await
}

#[tauri::command]
pub async fn update_session_comment(
    app: AppHandle,
    session_id: i64,
    comment: Option<String>,
) -> Result<(), String> {
    mutations::update_session_comment(app, session_id, comment).await
}

#[tauri::command]
pub async fn update_session_comments(
    app: AppHandle,
    session_ids: Vec<i64>,
    comment: Option<String>,
) -> Result<(), String> {
    mutations::update_session_comments(app, session_ids, comment).await
}

#[tauri::command]
pub async fn rebuild_sessions(app: AppHandle, gap_fill_minutes: i64) -> Result<i64, String> {
    rebuild::rebuild_sessions(app, gap_fill_minutes).await
}

#[tauri::command]
pub async fn split_session(
    app: AppHandle,
    session_id: i64,
    ratio: f64,
    project_a_id: Option<i64>,
    project_b_id: Option<i64>,
) -> Result<(), String> {
    split::split_session(app, session_id, ratio, project_a_id, project_b_id).await
}

#[tauri::command]
pub async fn suggest_session_split(
    app: AppHandle,
    session_id: i64,
) -> Result<split::SplitSuggestion, String> {
    split::suggest_session_split(app, session_id).await
}

#[tauri::command]
pub async fn analyze_session_projects(
    app: AppHandle,
    session_id: i64,
    tolerance_threshold: f64,
    max_projects: i64,
) -> Result<MultiProjectAnalysis, String> {
    split::analyze_session_projects(app, session_id, tolerance_threshold, max_projects).await
}

#[tauri::command]
pub async fn analyze_sessions_splittable(
    app: AppHandle,
    session_ids: Vec<i64>,
    tolerance_threshold: f64,
    max_projects: i64,
) -> Result<Vec<SessionSplittableFlag>, String> {
    split::analyze_sessions_splittable(app, session_ids, tolerance_threshold, max_projects).await
}

#[tauri::command]
pub async fn split_session_multi(
    app: AppHandle,
    session_id: i64,
    splits: Vec<SplitPart>,
    not_modified_since: Option<String>,
) -> Result<(), String> {
    split::split_session_multi(app, session_id, splits, not_modified_since).await
}
