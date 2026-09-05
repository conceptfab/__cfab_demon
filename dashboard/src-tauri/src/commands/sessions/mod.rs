use tauri::AppHandle;

use std::collections::HashMap;

use super::analysis::compute_project_activity_unique;
use super::daemon::load_persisted_session_min_duration;
use super::types::{
    DateRange, MultiProjectAnalysis, SessionFilters, SessionSplittableFlag, SessionWithApp,
    SplitPart,
};
use crate::commands::error::CommandError;

mod manual_overrides;
mod mutations;
mod query;
pub(crate) mod rebuild;
mod split;
#[cfg(test)]
mod tests;

pub(crate) use manual_overrides::apply_manual_session_overrides;
// Udostępnione dla `commands::project_limits` — boost ponad limit musi ustawić komentarz
// i mnożnik w JEDNEJ transakcji, w tej kolejności (mnożnik > 1 wymaga komentarza).
pub(crate) use mutations::{update_session_comment_tx, update_session_rate_multiplier_tx};

#[tauri::command]
pub async fn get_sessions(
    app: AppHandle,
    filters: SessionFilters,
) -> Result<Vec<SessionWithApp>, CommandError> {
    query::get_sessions(app, filters)
        .await
        .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn get_session_count(
    app: AppHandle,
    filters: SessionFilters,
) -> Result<i64, CommandError> {
    query::get_session_count(app, filters)
        .await
        .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn get_project_canonical_totals(
    app: AppHandle,
    date_range: DateRange,
) -> Result<HashMap<i64, i64>, CommandError> {
    super::helpers::run_db_blocking(app, move |conn| {
        let (_buckets, totals, meta, _flags, _comments, _effective) =
            compute_project_activity_unique(
                conn,
                &date_range,
                false,
                true,
                None,
                Some(load_persisted_session_min_duration()),
                true,
            )?;
        Ok(totals
            .into_iter()
            .filter_map(|(series_key, seconds)| {
                meta.get(&series_key)
                    .and_then(|series| series.project_id.map(|id| (id, seconds.round() as i64)))
            })
            .collect())
    })
    .await
    .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn assign_session_to_project(
    app: AppHandle,
    session_id: i64,
    project_id: Option<i64>,
    source: Option<String>,
) -> Result<(), CommandError> {
    mutations::assign_session_to_project(app, session_id, project_id, source)
        .await
        .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn assign_sessions_to_project(
    app: AppHandle,
    session_ids: Vec<i64>,
    project_id: Option<i64>,
    source: Option<String>,
) -> Result<(), CommandError> {
    mutations::assign_sessions_to_project(app, session_ids, project_id, source)
        .await
        .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn update_session_rate_multiplier(
    app: AppHandle,
    session_id: i64,
    multiplier: Option<f64>,
) -> Result<(), CommandError> {
    mutations::update_session_rate_multiplier(app, session_id, multiplier)
        .await
        .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn update_session_rate_multipliers(
    app: AppHandle,
    session_ids: Vec<i64>,
    multiplier: Option<f64>,
) -> Result<(), CommandError> {
    mutations::update_session_rate_multipliers(app, session_ids, multiplier)
        .await
        .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn delete_session(app: AppHandle, session_id: i64) -> Result<(), CommandError> {
    mutations::delete_session(app, session_id)
        .await
        .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn delete_sessions(app: AppHandle, session_ids: Vec<i64>) -> Result<(), CommandError> {
    mutations::delete_sessions(app, session_ids)
        .await
        .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn update_session_comment(
    app: AppHandle,
    session_id: i64,
    comment: Option<String>,
) -> Result<(), CommandError> {
    mutations::update_session_comment(app, session_id, comment)
        .await
        .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn update_session_comments(
    app: AppHandle,
    session_ids: Vec<i64>,
    comment: Option<String>,
) -> Result<(), CommandError> {
    mutations::update_session_comments(app, session_ids, comment)
        .await
        .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn rebuild_sessions(app: AppHandle, gap_fill_minutes: i64) -> Result<i64, CommandError> {
    rebuild::rebuild_sessions(app, gap_fill_minutes)
        .await
        .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn split_session(
    app: AppHandle,
    session_id: i64,
    ratio: f64,
    project_a_id: Option<i64>,
    project_b_id: Option<i64>,
) -> Result<(), CommandError> {
    split::split_session(app, session_id, ratio, project_a_id, project_b_id)
        .await
        .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn analyze_session_projects(
    app: AppHandle,
    session_id: i64,
    tolerance_threshold: f64,
    max_projects: i64,
) -> Result<MultiProjectAnalysis, CommandError> {
    split::analyze_session_projects(app, session_id, tolerance_threshold, max_projects)
        .await
        .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn analyze_sessions_splittable(
    app: AppHandle,
    session_ids: Vec<i64>,
    tolerance_threshold: f64,
    max_projects: i64,
) -> Result<Vec<SessionSplittableFlag>, CommandError> {
    split::analyze_sessions_splittable(app, session_ids, tolerance_threshold, max_projects)
        .await
        .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn split_session_multi(
    app: AppHandle,
    session_id: i64,
    splits: Vec<SplitPart>,
    not_modified_since: Option<String>,
) -> Result<(), CommandError> {
    split::split_session_multi(app, session_id, splits, not_modified_since)
        .await
        .map_err(CommandError::Other)
}
