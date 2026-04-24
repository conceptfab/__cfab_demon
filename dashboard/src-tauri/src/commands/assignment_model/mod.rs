//! # Assignment Model — AI Session-to-Project Classification
//!
//! This module implements a multi-layer evidence scoring system that assigns
//! sessions to projects. It is NOT a neural network — it uses deterministic
//! feature-based scoring with 4 evidence layers.

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{command, AppHandle};

use crate::commands::helpers::run_db_blocking;
use crate::commands::types::DateRange;

pub mod auto_safe;
pub mod config;
pub mod context;
pub mod folder_scan;
pub mod scoring;
pub mod training;

pub use auto_safe::*;
pub use config::*;
pub use folder_scan::*;
pub use scoring::*;
pub use training::*;

#[derive(Debug, Serialize, Deserialize)]
pub struct AssignmentModelStatus {
    pub mode: String,
    pub min_confidence_suggest: f64,
    pub min_confidence_auto: f64,
    pub min_evidence_auto: i64,
    pub training_horizon_days: i64,
    pub decay_half_life_days: i64,
    pub training_app_blacklist: Vec<String>,
    pub training_folder_blacklist: Vec<String>,
    pub last_train_at: Option<String>,
    pub feedback_since_train: i64,
    pub is_training: bool,
    pub last_train_duration_ms: Option<i64>,
    pub last_train_samples: Option<i64>,
    pub train_error_last: Option<String>,
    pub cooldown_until: Option<String>,
    pub last_auto_run_at: Option<String>,
    pub last_auto_assigned_count: i64,
    pub last_auto_rolled_back_at: Option<String>,
    pub can_rollback_last_auto_run: bool,
    pub feedback_weight: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectSuggestion {
    pub project_id: i64,
    pub confidence: f64,
    pub evidence_count: i64,
    pub margin: f64,
    pub breakdown: Option<SuggestionBreakdown>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SuggestionBreakdown {
    pub file_score: f64,
    pub app_score: f64,
    pub time_score: f64,
    pub token_score: f64,
    pub folder_score: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AutoSafeRunResult {
    pub run_id: Option<i64>,
    pub scanned: i64,
    pub suggested: i64,
    pub assigned: i64,
    pub skipped_low_confidence: i64,
    pub skipped_ambiguous: i64,
    pub skipped_already_assigned: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AutoSafeRollbackResult {
    pub run_id: i64,
    pub reverted: i64,
    pub skipped: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeterministicResult {
    pub apps_with_rules: i64,
    pub sessions_assigned: i64,
    pub sessions_skipped: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AssignmentModelMetricsPoint {
    pub date: String,
    pub feedback_total: i64,
    pub feedback_accepted: i64,
    pub feedback_rejected: i64,
    pub feedback_manual_change: i64,
    pub auto_runs: i64,
    pub auto_assigned: i64,
    pub auto_rollbacks: i64,
    pub coverage_total_entries: i64,
    pub coverage_with_detected_path: i64,
    pub coverage_with_title_history: i64,
    pub coverage_with_activity_type: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AssignmentModelMetricsSummary {
    pub feedback_total: i64,
    pub feedback_accepted: i64,
    pub feedback_rejected: i64,
    pub feedback_manual_change: i64,
    pub feedback_manual_corrections: i64,
    pub feedback_precision: f64,
    pub auto_runs: i64,
    pub auto_assigned: i64,
    pub auto_rollbacks: i64,
    pub coverage_total_entries: i64,
    pub coverage_detected_path_ratio: f64,
    pub coverage_title_history_ratio: f64,
    pub coverage_activity_type_ratio: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AssignmentModelMetrics {
    pub window_days: i64,
    pub points: Vec<AssignmentModelMetricsPoint>,
    pub summary: AssignmentModelMetricsSummary,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CandidateScore {
    pub project_id: i64,
    pub project_name: String,
    pub layer0_file_score: f64,
    pub layer1_app_score: f64,
    pub layer2_time_score: f64,
    pub layer3_token_score: f64,
    pub layer3b_folder_score: f64,
    pub total_score: f64,
    pub evidence_count: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScoreBreakdown {
    pub candidates: Vec<CandidateScore>,
    pub final_suggestion: Option<ProjectSuggestion>,
    pub has_manual_override: bool,
    pub manual_override_project_id: Option<i64>,
}

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

#[command]
pub async fn get_assignment_model_status(app: AppHandle) -> Result<AssignmentModelStatus, String> {
    run_db_blocking(app, move |conn| {
        let state = load_state_map(conn)?;
        let training_horizon_days = clamp_i64(
            parse_state_i64(
                &state,
                "training_horizon_days",
                DEFAULT_TRAINING_HORIZON_DAYS,
            ),
            MIN_TRAINING_HORIZON_DAYS,
            MAX_TRAINING_HORIZON_DAYS,
        );
        let decay_half_life_days = clamp_i64(
            parse_state_i64(&state, "decay_half_life_days", DEFAULT_DECAY_HALF_LIFE_DAYS),
            MIN_DECAY_HALF_LIFE_DAYS,
            MAX_DECAY_HALF_LIFE_DAYS,
        );
        let training_app_blacklist = normalize_blacklist_entries(
            &parse_state_string_list(&state, "training_app_blacklist"),
            false,
        );
        let training_folder_blacklist = normalize_blacklist_entries(
            &parse_state_string_list(&state, "training_folder_blacklist"),
            true,
        );

        let mut status = AssignmentModelStatus {
            mode: normalize_mode(
                state
                    .get("mode")
                    .map(|v| v.as_str())
                    .unwrap_or(DEFAULT_MODE),
            ),
            min_confidence_suggest: parse_state_f64(
                &state,
                "min_confidence_suggest",
                DEFAULT_MIN_CONFIDENCE_SUGGEST,
            ),
            min_confidence_auto: parse_state_f64(
                &state,
                "min_confidence_auto",
                DEFAULT_MIN_CONFIDENCE_AUTO,
            ),
            min_evidence_auto: parse_state_i64(
                &state,
                "min_evidence_auto",
                DEFAULT_MIN_EVIDENCE_AUTO,
            ),
            training_horizon_days,
            decay_half_life_days,
            training_app_blacklist,
            training_folder_blacklist,
            last_train_at: parse_state_opt_string(&state, "last_train_at"),
            feedback_since_train: parse_state_i64(&state, "feedback_since_train", 0),
            is_training: parse_state_bool(&state, "is_training", false),
            last_train_duration_ms: state
                .get("last_train_duration_ms")
                .and_then(|v| v.parse::<i64>().ok()),
            last_train_samples: state
                .get("last_train_samples")
                .and_then(|v| v.parse::<i64>().ok()),
            train_error_last: parse_state_opt_string(&state, "train_error_last"),
            cooldown_until: parse_state_opt_string(&state, "cooldown_until"),
            last_auto_run_at: None,
            last_auto_assigned_count: 0,
            last_auto_rolled_back_at: None,
            can_rollback_last_auto_run: false,
            feedback_weight: parse_state_f64(&state, "feedback_weight", DEFAULT_FEEDBACK_WEIGHT),
        };

        let last_auto = conn
            .query_row(
                "SELECT COALESCE(finished_at, started_at), sessions_assigned, rolled_back_at
                 FROM assignment_auto_runs
                 ORDER BY id DESC
                 LIMIT 1",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some((last_auto_run_at, assigned_count, rolled_back_at)) = last_auto {
            status.last_auto_run_at = Some(last_auto_run_at);
            status.last_auto_assigned_count = assigned_count;
            status.last_auto_rolled_back_at = rolled_back_at.clone();
            status.can_rollback_last_auto_run = assigned_count > 0 && rolled_back_at.is_none();
        }

        Ok(status)
    })
    .await
}

#[command]
pub async fn get_assignment_model_metrics(
    app: AppHandle,
    days: Option<i64>,
) -> Result<AssignmentModelMetrics, String> {
    run_db_blocking(app, move |conn| {
        let window_days = clamp_i64(days.unwrap_or(30), 7, 365);
        let from_modifier = format!("-{} days", window_days.saturating_sub(1));

        let mut feedback_by_day: HashMap<String, (i64, i64, i64, i64)> = HashMap::new();
        {
            let mut stmt = conn
                .prepare(
                    "SELECT
                        date(created_at) AS d,
                        SUM(CASE WHEN source = 'ai_suggestion_accept' THEN 1 ELSE 0 END) AS accepted,
                        SUM(CASE WHEN source = 'ai_suggestion_reject' THEN 1 ELSE 0 END) AS rejected,
                        SUM(CASE
                            WHEN source IN (
                                'manual_session_assign',
                                'manual_session_change',
                                'manual_project_card_change',
                                'manual_session_unassign',
                                'bulk_unassign',
                                'manual_app_assign'
                            ) THEN 1
                            ELSE 0
                        END) AS manual_change,
                        SUM(CASE
                            WHEN source IN (
                                'manual_session_assign',
                                'manual_session_change',
                                'manual_project_card_change',
                                'manual_session_unassign',
                                'bulk_unassign',
                                'manual_app_assign'
                            ) AND from_project_id IS NOT NULL THEN 1
                            ELSE 0
                        END) AS manual_corrections
                     FROM assignment_feedback
                     WHERE created_at >= date('now', ?1)
                     GROUP BY date(created_at)",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(rusqlite::params![&from_modifier], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            for row in rows {
                let (date, accepted, rejected, manual_change, manual_corrections) =
                    row.map_err(|e| format!("Failed to read feedback metrics row: {}", e))?;
                feedback_by_day.insert(date, (accepted, rejected, manual_change, manual_corrections));
            }
        }

        let mut auto_by_day: HashMap<String, (i64, i64, i64)> = HashMap::new();
        {
            let mut stmt = conn
                .prepare(
                    "SELECT
                        date(started_at) AS d,
                        COUNT(*) AS runs,
                        COALESCE(SUM(sessions_assigned), 0) AS assigned,
                        SUM(CASE WHEN rolled_back_at IS NOT NULL THEN 1 ELSE 0 END) AS rollbacks
                     FROM assignment_auto_runs
                     WHERE started_at >= date('now', ?1)
                     GROUP BY date(started_at)",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(rusqlite::params![&from_modifier], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            for row in rows {
                let (date, runs, assigned, rollbacks) =
                    row.map_err(|e| format!("Failed to read auto-run metrics row: {}", e))?;
                auto_by_day.insert(date, (runs, assigned, rollbacks));
            }
        }

        let mut coverage_by_day: HashMap<String, (i64, i64, i64, i64)> = HashMap::new();
        {
            let mut stmt = conn
                .prepare(
                    "SELECT
                        date,
                        COUNT(*) AS total_entries,
                        SUM(CASE WHEN detected_path IS NOT NULL AND trim(detected_path) <> '' THEN 1 ELSE 0 END) AS with_detected_path,
                        SUM(CASE WHEN title_history IS NOT NULL AND trim(title_history) NOT IN ('', '[]') THEN 1 ELSE 0 END) AS with_title_history,
                        SUM(CASE WHEN activity_type IS NOT NULL AND trim(activity_type) <> '' THEN 1 ELSE 0 END) AS with_activity_type
                     FROM file_activities
                     WHERE date >= date('now', ?1)
                     GROUP BY date",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(rusqlite::params![&from_modifier], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            for row in rows {
                let (
                    date,
                    total_entries,
                    with_detected_path,
                    with_title_history,
                    with_activity_type,
                ) = row.map_err(|e| format!("Failed to read coverage metrics row: {}", e))?;
                coverage_by_day.insert(
                    date,
                    (
                        total_entries,
                        with_detected_path,
                        with_title_history,
                        with_activity_type,
                    ),
                );
            }
        }

        let today = chrono::Local::now().date_naive();
        let mut points = Vec::with_capacity(window_days as usize);
        let mut summary = AssignmentModelMetricsSummary {
            feedback_total: 0,
            feedback_accepted: 0,
            feedback_rejected: 0,
            feedback_manual_change: 0,
            feedback_manual_corrections: 0,
            feedback_precision: 0.0,
            auto_runs: 0,
            auto_assigned: 0,
            auto_rollbacks: 0,
            coverage_total_entries: 0,
            coverage_detected_path_ratio: 0.0,
            coverage_title_history_ratio: 0.0,
            coverage_activity_type_ratio: 0.0,
        };
        let mut coverage_with_detected_total = 0_i64;
        let mut coverage_with_title_total = 0_i64;
        let mut coverage_with_activity_total = 0_i64;

        for offset in (0..window_days).rev() {
            let date = (today - chrono::Duration::days(offset))
                .format("%Y-%m-%d")
                .to_string();
            let (feedback_accepted, feedback_rejected, feedback_manual_change, feedback_manual_corrections) =
                feedback_by_day.get(&date).copied().unwrap_or((0, 0, 0, 0));
            let feedback_total = feedback_accepted + feedback_rejected + feedback_manual_change;
            let (auto_runs, auto_assigned, auto_rollbacks) =
                auto_by_day.get(&date).copied().unwrap_or((0, 0, 0));
            let (
                coverage_total_entries,
                coverage_with_detected_path,
                coverage_with_title_history,
                coverage_with_activity_type,
            ) = coverage_by_day.get(&date).copied().unwrap_or((0, 0, 0, 0));

            summary.feedback_total += feedback_total;
            summary.feedback_accepted += feedback_accepted;
            summary.feedback_rejected += feedback_rejected;
            summary.feedback_manual_change += feedback_manual_change;
            summary.feedback_manual_corrections += feedback_manual_corrections;
            summary.auto_runs += auto_runs;
            summary.auto_assigned += auto_assigned;
            summary.auto_rollbacks += auto_rollbacks;
            summary.coverage_total_entries += coverage_total_entries;
            coverage_with_detected_total += coverage_with_detected_path;
            coverage_with_title_total += coverage_with_title_history;
            coverage_with_activity_total += coverage_with_activity_type;

            points.push(AssignmentModelMetricsPoint {
                date,
                feedback_total,
                feedback_accepted,
                feedback_rejected,
                feedback_manual_change,
                auto_runs,
                auto_assigned,
                auto_rollbacks,
                coverage_total_entries,
                coverage_with_detected_path,
                coverage_with_title_history,
                coverage_with_activity_type,
            });
        }

        summary.feedback_precision = ratio_or_zero(
            summary.feedback_accepted,
            summary.feedback_accepted
                + summary.feedback_rejected
                + summary.feedback_manual_corrections,
        );
        summary.coverage_detected_path_ratio =
            ratio_or_zero(coverage_with_detected_total, summary.coverage_total_entries);
        summary.coverage_title_history_ratio =
            ratio_or_zero(coverage_with_title_total, summary.coverage_total_entries);
        summary.coverage_activity_type_ratio =
            ratio_or_zero(coverage_with_activity_total, summary.coverage_total_entries);

        Ok(AssignmentModelMetrics {
            window_days,
            points,
            summary,
        })
    })
    .await
}

#[command]
pub async fn set_assignment_mode(
    app: AppHandle,
    mode: String,
    suggest_conf: f64,
    auto_conf: f64,
    auto_ev: i64,
) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
        let mode = normalize_mode(&mode);
        let suggest_conf = clamp01(suggest_conf, DEFAULT_MIN_CONFIDENCE_SUGGEST);
        let auto_conf = clamp01(auto_conf, DEFAULT_MIN_CONFIDENCE_AUTO);
        let auto_ev = clamp_i64(auto_ev, 1, 50);
        validate_assignment_confidences(suggest_conf, auto_conf)?;

        upsert_state(conn, "mode", &mode)?;
        upsert_state(
            conn,
            "min_confidence_suggest",
            &format!("{:.4}", suggest_conf),
        )?;
        upsert_state(conn, "min_confidence_auto", &format!("{:.4}", auto_conf))?;
        upsert_state(conn, "min_evidence_auto", &auto_ev.to_string())?;

        Ok(())
    })
    .await
}

fn validate_assignment_confidences(suggest_conf: f64, auto_conf: f64) -> Result<(), String> {
    if auto_conf < suggest_conf {
        return Err(
            "auto_confidence must be greater than or equal to suggest_confidence".to_string(),
        );
    }
    Ok(())
}

#[command]
pub async fn set_assignment_model_cooldown(
    app: AppHandle,
    hours: i64,
) -> Result<AssignmentModelStatus, String> {
    run_db_blocking(app.clone(), move |conn| {
        let clamped_hours = clamp_i64(hours, 0, 24 * 14);

        if clamped_hours <= 0 {
            conn.execute(
                "DELETE FROM assignment_model_state WHERE key = 'cooldown_until'",
                [],
            )
            .map_err(|e| e.to_string())?;
        } else {
            let cooldown_until =
                (chrono::Local::now() + chrono::Duration::hours(clamped_hours)).to_rfc3339();
            upsert_state(conn, "cooldown_until", &cooldown_until)?;
        }

        Ok(())
    })
    .await?;
    get_assignment_model_status(app).await
}

#[command]
pub async fn set_training_horizon_days(
    app: AppHandle,
    days: i64,
) -> Result<AssignmentModelStatus, String> {
    run_db_blocking(app.clone(), move |conn| {
        let clamped_days = clamp_i64(days, MIN_TRAINING_HORIZON_DAYS, MAX_TRAINING_HORIZON_DAYS);
        upsert_state(conn, "training_horizon_days", &clamped_days.to_string())
    })
    .await?;
    get_assignment_model_status(app).await
}

#[command]
pub async fn set_decay_half_life_days(
    app: AppHandle,
    days: i64,
) -> Result<AssignmentModelStatus, String> {
    run_db_blocking(app.clone(), move |conn| {
        let clamped_days = clamp_i64(days, MIN_DECAY_HALF_LIFE_DAYS, MAX_DECAY_HALF_LIFE_DAYS);
        upsert_state(conn, "decay_half_life_days", &clamped_days.to_string())
    })
    .await?;
    get_assignment_model_status(app).await
}

#[command]
pub async fn set_training_blacklists(
    app: AppHandle,
    app_blacklist: Vec<String>,
    folder_blacklist: Vec<String>,
) -> Result<AssignmentModelStatus, String> {
    run_db_blocking(app.clone(), move |conn| {
        let normalized_apps = normalize_blacklist_entries(&app_blacklist, false);
        let normalized_folders = normalize_blacklist_entries(&folder_blacklist, true);
        let apps_payload = serde_json::to_string(&normalized_apps).map_err(|e| e.to_string())?;
        let folders_payload =
            serde_json::to_string(&normalized_folders).map_err(|e| e.to_string())?;
        upsert_state(conn, "training_app_blacklist", &apps_payload)?;
        upsert_state(conn, "training_folder_blacklist", &folders_payload)?;
        Ok(())
    })
    .await?;
    get_assignment_model_status(app).await
}

#[command]
pub async fn reset_assignment_model_knowledge(
    app: AppHandle,
) -> Result<AssignmentModelStatus, String> {
    run_db_blocking(app.clone(), move |mut conn| {
        reset_assignment_model_knowledge_sync(&mut conn)
    })
    .await?;
    get_assignment_model_status(app).await
}

#[command]
pub async fn train_assignment_model(
    app: AppHandle,
    force: bool,
) -> Result<AssignmentModelStatus, String> {
    let status = get_assignment_model_status(app.clone()).await?;

    if status.is_training {
        return Err("Training already in progress".to_string());
    }

    if !force && status.feedback_since_train < 30 {
        return Ok(status);
    }

    // Guard: prevent wiping model tables when there is no feedback data
    let feedback_count: i64 = run_db_blocking(app.clone(), move |conn| {
        conn.query_row("SELECT COUNT(*) FROM assignment_feedback", [], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())
    })
    .await?;
    if feedback_count == 0 {
        return Err("Nothing to train: no feedback data available".to_string());
    }

    run_db_blocking(app.clone(), move |mut conn| {
        retrain_model_sync(&mut conn)?;
        Ok(())
    })
    .await?;

    get_assignment_model_status(app).await
}

#[command]
pub async fn run_auto_safe_assignment(
    app: AppHandle,
    limit: Option<i64>,
    date_range: Option<DateRange>,
    min_duration: Option<i64>,
) -> Result<AutoSafeRunResult, String> {
    let status = get_assignment_model_status(app.clone()).await?;
    run_db_blocking(app, move |mut conn| {
        run_auto_safe_sync(&mut conn, &status, limit, date_range, min_duration)
    })
    .await
}

#[command]
pub async fn rollback_last_auto_safe_run(app: AppHandle) -> Result<AutoSafeRollbackResult, String> {
    run_db_blocking(app, move |mut conn| rollback_sync(&mut conn)).await
}

#[command]
pub async fn apply_deterministic_assignment(
    app: AppHandle,
    min_history: Option<i64>,
) -> Result<DeterministicResult, String> {
    run_db_blocking(app, move |mut conn| {
        deterministic_sync(&mut conn, min_history)
    })
    .await
}

#[command]
pub async fn auto_run_if_needed(
    app: AppHandle,
    min_duration: Option<i64>,
) -> Result<Option<AutoSafeRunResult>, String> {
    let mode = run_db_blocking(app.clone(), move |conn| {
        let state = load_state_map(conn)?;
        Ok(parse_state_opt_string(&state, "mode").unwrap_or_else(|| DEFAULT_MODE.to_string()))
    })
    .await?;

    if mode != "auto_safe" {
        return Ok(None);
    }

    let result = run_auto_safe_assignment(app, None, None, min_duration).await?;
    if result.assigned == 0 && result.scanned == 0 {
        return Ok(None);
    }
    Ok(Some(result))
}

#[command]
pub async fn get_session_score_breakdown(
    app: AppHandle,
    session_id: i64,
) -> Result<ScoreBreakdown, String> {
    run_db_blocking(app, move |conn| {
        get_session_score_breakdown_sync(conn, session_id)
    })
    .await
}

#[command]
pub async fn set_feedback_weight(app: AppHandle, weight: f64) -> Result<(), String> {
    if !weight.is_finite() || !(1.0..=50.0).contains(&weight) {
        return Err("Feedback weight must be between 1.0 and 50.0".to_string());
    }
    run_db_blocking(app, move |conn| {
        upsert_state(conn, "feedback_weight", &format!("{:.1}", weight))
    })
    .await
}

#[command]
pub async fn scan_project_folders_for_ai(app: AppHandle) -> Result<FolderScanResult, String> {
    run_db_blocking(app, |mut conn| {
        folder_scan::scan_project_folders_sync(&mut conn)
    })
    .await
}

#[command]
pub async fn get_folder_scan_status(app: AppHandle) -> Result<FolderScanStatus, String> {
    run_db_blocking(app, |conn| {
        folder_scan::get_folder_scan_status_sync(conn)
    })
    .await
}

#[command]
pub async fn clear_folder_scan_data(app: AppHandle) -> Result<(), String> {
    run_db_blocking(app, |conn| folder_scan::clear_folder_scan_sync(conn)).await
}

#[cfg(test)]
mod tests {
    use super::validate_assignment_confidences;

    #[test]
    fn rejects_auto_confidence_below_suggest_confidence() {
        assert!(validate_assignment_confidences(0.95, 0.5).is_err());
    }

    #[test]
    fn accepts_auto_confidence_equal_or_above_suggest_confidence() {
        assert!(validate_assignment_confidences(0.6, 0.6).is_ok());
        assert!(validate_assignment_confidences(0.6, 0.85).is_ok());
    }
}
