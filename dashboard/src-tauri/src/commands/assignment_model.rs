//! # Assignment Model — AI Session-to-Project Classification
//!
//! This module implements a multi-layer evidence scoring system that assigns
//! sessions to projects. It is NOT a neural network — it uses deterministic
//! feature-based scoring with 4 evidence layers:
//!
//! - **Layer 0 (0.80)**: Direct file-activity overlap — strongest signal
//! - **Layer 1 (0.30)**: Historical app→project mapping (logarithmic scaling)
//! - **Layer 2 (0.10)**: Time-of-day + weekday patterns
//! - **Layer 3 (0.30)**: File name token matching
//!
//! ## Training
//! `retrain_model_sync()` rebuilds 3 database tables from historical data,
//! then applies reinforcement from `assignment_feedback` (manual corrections
//! get `feedback_weight`× boost, wrong predictions get penalized).
//!
//! ## Modes
//! - `off`: No suggestions
//! - `suggest`: Show suggestions, user accepts/rejects
//! - `auto_safe`: Auto-assign when confidence ≥ threshold + evidence ≥ min + margin ≥ 0.20
//!
//! ## Manual Override Protection
//! Sessions with entries in `session_manual_overrides` are never overridden
//! by auto-safe or re-suggested to a different project.

use chrono::{Datelike, Timelike};
use rusqlite::{OptionalExtension, ToSql};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use tauri::{command, AppHandle};

use super::datetime::parse_datetime_fixed;
use super::types::DateRange;
use crate::db;

const DEFAULT_MODE: &str = "suggest";
const DEFAULT_MIN_CONFIDENCE_SUGGEST: f64 = 0.60;
const DEFAULT_MIN_CONFIDENCE_AUTO: f64 = 0.85;
const DEFAULT_MIN_EVIDENCE_AUTO: i64 = 3;
const AUTO_SAFE_MIN_MARGIN: f64 = 0.20;
const DEFAULT_FEEDBACK_WEIGHT: f64 = 5.0;
const MIN_TRAINING_HORIZON_DAYS: i64 = 30;
const MAX_TRAINING_HORIZON_DAYS: i64 = 730;
const DEFAULT_TRAINING_HORIZON_DAYS: i64 = 730;

#[derive(Debug, Serialize, Deserialize)]
pub struct AssignmentModelStatus {
    pub mode: String,
    pub min_confidence_suggest: f64,
    pub min_confidence_auto: f64,
    pub min_evidence_auto: i64,
    pub training_horizon_days: i64,
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

#[derive(Debug)]
struct SessionContext {
    app_id: i64,
    hour_bucket: i64,
    weekday: i64,
    tokens: Vec<String>,
    /// project_ids found on overlapping file_activities (direct evidence)
    file_project_ids: Vec<i64>,
}

fn parse_state_f64(state: &HashMap<String, String>, key: &str, default: f64) -> f64 {
    state
        .get(key)
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(default)
}

fn parse_state_i64(state: &HashMap<String, String>, key: &str, default: i64) -> i64 {
    state
        .get(key)
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(default)
}

fn parse_state_bool(state: &HashMap<String, String>, key: &str, default: bool) -> bool {
    state.get(key).map(|v| v == "true").unwrap_or(default)
}

fn parse_state_opt_string(state: &HashMap<String, String>, key: &str) -> Option<String> {
    state
        .get(key)
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string())
}

fn parse_state_string_list(state: &HashMap<String, String>, key: &str) -> Vec<String> {
    state
        .get(key)
        .and_then(|v| serde_json::from_str::<Vec<String>>(v).ok())
        .unwrap_or_default()
}

fn normalize_blacklist_app(raw: &str) -> Option<String> {
    let normalized = raw.trim().to_lowercase();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn normalize_blacklist_folder(raw: &str) -> Option<String> {
    let mut normalized = raw.trim().replace('\\', "/");
    while normalized.ends_with('/') {
        normalized.pop();
    }
    let normalized = normalized.trim().to_lowercase();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn normalize_blacklist_entries(values: &[String], folder_mode: bool) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for value in values {
        let normalized = if folder_mode {
            normalize_blacklist_folder(value)
        } else {
            normalize_blacklist_app(value)
        };
        if let Some(entry) = normalized {
            if seen.insert(entry.clone()) {
                result.push(entry);
            }
        }
    }
    result
}

fn upsert_state(conn: &rusqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO assignment_model_state (key, value, updated_at)
         VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn load_state_map(conn: &rusqlite::Connection) -> Result<HashMap<String, String>, String> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM assignment_model_state")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let key: String = row.get(0)?;
            let value: String = row.get(1)?;
            Ok((key, value))
        })
        .map_err(|e| e.to_string())?;

    let mut state = HashMap::new();
    for row in rows {
        let row = row.map_err(|e| format!("Failed to read assignment_model_state row: {}", e))?;
        state.insert(row.0, row.1);
    }
    Ok(state)
}

fn normalize_mode(mode: &str) -> String {
    match mode {
        "off" | "suggest" | "auto_safe" => mode.to_string(),
        _ => DEFAULT_MODE.to_string(),
    }
}

fn clamp01(value: f64, default: f64) -> f64 {
    if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        default
    }
}

fn clamp_i64(value: i64, min: i64, max: i64) -> i64 {
    value.max(min).min(max)
}

fn ratio_or_zero(numerator: i64, denominator: i64) -> f64 {
    if denominator <= 0 {
        0.0
    } else {
        numerator as f64 / denominator as f64
    }
}

fn increment_feedback_counter(conn: &rusqlite::Connection) {
    let _ = conn.execute(
        "INSERT INTO assignment_model_state (key, value, updated_at)
         VALUES ('feedback_since_train', '1', datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
           value = CAST(COALESCE(NULLIF(assignment_model_state.value, ''), '0') AS INTEGER) + 1,
           updated_at = datetime('now')",
        [],
    );
}

/// Check if a session has a manual override that forces it to a specific project.
/// Returns Some(project_id) if override exists and target project is valid, None otherwise.
fn check_manual_override(conn: &rusqlite::Connection, session_id: i64) -> Option<i64> {
    let meta = match conn
        .query_row(
            "SELECT a.executable_name, s.start_time, s.end_time
             FROM sessions s
             JOIN applications a ON a.id = s.app_id
             WHERE s.id = ?1",
            rusqlite::params![session_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
    {
        Ok(v) => v,
        Err(e) => {
            log::warn!(
                "Failed to read session metadata for manual override check (session_id={}): {}",
                session_id,
                e
            );
            return None;
        }
    }?;

    let (exe_name, start_time, end_time) = meta;

    let project_name: Option<String> = match conn
        .query_row(
            "SELECT project_name
             FROM session_manual_overrides
             WHERE session_id = ?1
                OR (
                    session_id IS NULL
                    AND lower(executable_name) = lower(?2)
                    AND start_time = ?3
                    AND end_time = ?4
                )
             ORDER BY CASE WHEN session_id = ?1 THEN 0 ELSE 1 END, updated_at DESC
             LIMIT 1",
            rusqlite::params![session_id, exe_name, start_time, end_time],
            |row| row.get(0),
        )
        .optional()
    {
        Ok(v) => v,
        Err(e) => {
            log::warn!(
                "Failed to read manual override mapping (session_id={}): {}",
                session_id,
                e
            );
            return None;
        }
    };

    let project_name = project_name?;

    match conn
        .query_row(
            "SELECT id FROM projects
         WHERE lower(name) = lower(?1)
           AND excluded_at IS NULL
           AND frozen_at IS NULL
         LIMIT 1",
            rusqlite::params![project_name],
            |row| row.get::<_, i64>(0),
        )
        .optional()
    {
        Ok(v) => v,
        Err(e) => {
            log::warn!(
                "Failed to resolve target project for manual override (session_id={}): {}",
                session_id,
                e
            );
            None
        }
    }
}

fn is_project_active(conn: &rusqlite::Connection, project_id: i64) -> bool {
    conn.query_row(
        "SELECT COUNT(*) > 0
         FROM projects
         WHERE id = ?1
           AND excluded_at IS NULL
           AND frozen_at IS NULL",
        rusqlite::params![project_id],
        |row| row.get(0),
    )
    .unwrap_or(false)
}

fn is_project_active_cached(
    conn: &rusqlite::Connection,
    cache: &mut HashMap<i64, bool>,
    project_id: i64,
) -> bool {
    if let Some(active) = cache.get(&project_id) {
        return *active;
    }
    let active = is_project_active(conn, project_id);
    cache.insert(project_id, active);
    active
}

fn tokenize(text: &str) -> Vec<String> {
    let separators = [
        ' ', '-', '_', '.', '/', '\\', '|', ',', ':', ';', '(', ')', '[', ']', '{', '}',
    ];
    text.to_lowercase()
        .split(&separators[..])
        .filter(|t| t.len() >= 2 && t.chars().any(|c| c.is_alphabetic()))
        .map(|t| t.to_string())
        .collect()
}

fn parse_title_history(raw: Option<&str>) -> Vec<String> {
    raw.and_then(|value| serde_json::from_str::<Vec<String>>(value).ok())
        .unwrap_or_default()
}

fn normalize_path_for_compare(raw: &str) -> String {
    let mut normalized = raw.trim().replace('\\', "/").to_lowercase();
    while normalized.ends_with('/') {
        normalized.pop();
    }
    normalized
}

fn is_under_blacklisted_folder(
    file_path: Option<&str>,
    detected_path: Option<&str>,
    folder_blacklist: &[String],
) -> bool {
    if folder_blacklist.is_empty() {
        return false;
    }

    let mut candidates = Vec::new();
    if let Some(path) = file_path {
        candidates.push(normalize_path_for_compare(path));
    }
    if let Some(path) = detected_path {
        candidates.push(normalize_path_for_compare(path));
    }

    candidates.into_iter().any(|candidate| {
        if candidate.is_empty() || candidate == "(unknown)" {
            return false;
        }
        folder_blacklist.iter().any(|folder| {
            candidate == *folder
                || candidate
                    .strip_prefix(folder.as_str())
                    .is_some_and(|suffix| suffix.starts_with('/'))
        })
    })
}

fn app_matches_blacklist_rule(exe_name: &str, rule: &str) -> bool {
    if exe_name == rule {
        return true;
    }
    match (exe_name.strip_suffix(".exe"), rule.strip_suffix(".exe")) {
        (Some(exe_no_ext), Some(rule_no_ext)) => exe_no_ext == rule_no_ext,
        (Some(exe_no_ext), None) => exe_no_ext == rule,
        (None, Some(rule_no_ext)) => exe_name == rule_no_ext,
        (None, None) => false,
    }
}

fn resolve_blacklisted_app_ids(
    conn: &rusqlite::Connection,
    app_blacklist: &[String],
) -> Result<HashSet<i64>, String> {
    if app_blacklist.is_empty() {
        return Ok(HashSet::new());
    }

    let mut stmt = conn
        .prepare("SELECT id, lower(executable_name) FROM applications")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut blacklisted_ids = HashSet::new();
    for row in rows {
        let (app_id, exe_name) =
            row.map_err(|e| format!("Failed to read applications row for blacklist: {}", e))?;
        if app_blacklist
            .iter()
            .any(|rule| app_matches_blacklist_rule(&exe_name, rule))
        {
            blacklisted_ids.insert(app_id);
        }
    }

    Ok(blacklisted_ids)
}

fn parse_timestamp(value: &str) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    parse_datetime_fixed(value)
}

fn extract_hour_weekday(start_time: &str) -> (i64, i64) {
    if let Some(dt) = parse_timestamp(start_time) {
        let hour = i64::from(dt.hour());
        let weekday = i64::from(dt.weekday().num_days_from_sunday());
        return (hour, weekday);
    }
    (12, 0)
}

fn build_session_context(
    conn: &rusqlite::Connection,
    session_id: i64,
) -> Result<Option<SessionContext>, String> {
    let session = conn
        .query_row(
            "SELECT app_id, date, start_time, end_time FROM sessions WHERE id = ?1",
            rusqlite::params![session_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some((app_id, date, start_time, end_time)) = session else {
        return Ok(None);
    };

    // Filter file_activities to only those overlapping with the session time window
    let mut file_stmt = conn
        .prepare(
            "SELECT file_name, file_path, detected_path, project_id, window_title, title_history
             FROM file_activities
             WHERE app_id = ?1 AND date = ?2
               AND last_seen > ?3 AND first_seen < ?4",
        )
        .map_err(|e| e.to_string())?;
    let mut file_rows = file_stmt
        .query(rusqlite::params![app_id, date, start_time, end_time])
        .map_err(|e| e.to_string())?;
    let mut uniq_tokens = HashSet::new();
    let mut tokens = Vec::new();
    let mut file_project_set = HashSet::new();
    while let Some(row) = file_rows.next().map_err(|e| e.to_string())? {
        let file_name: String = row.get(0).map_err(|e| e.to_string())?;
        let file_path: String = row.get(1).map_err(|e| e.to_string())?;
        let detected_path: Option<String> = row.get(2).map_err(|e| e.to_string())?;
        let project_id: Option<i64> = row.get(3).map_err(|e| e.to_string())?;
        let window_title: Option<String> = row.get(4).map_err(|e| e.to_string())?;
        let title_history: Option<String> = row.get(5).map_err(|e| e.to_string())?;
        for token in tokenize(&file_name) {
            if uniq_tokens.insert(token.clone()) {
                tokens.push(token);
            }
        }
        for token in tokenize(&file_path) {
            if uniq_tokens.insert(token.clone()) {
                tokens.push(token);
            }
        }
        if let Some(ref path) = detected_path {
            for token in tokenize(path) {
                if uniq_tokens.insert(token.clone()) {
                    tokens.push(token);
                }
            }
        }
        // Tokenize window_title for richer context (e.g. project name from IDE title bar)
        if let Some(ref wt) = window_title {
            for token in tokenize(wt) {
                if uniq_tokens.insert(token.clone()) {
                    tokens.push(token);
                }
            }
        }
        for title in parse_title_history(title_history.as_deref()) {
            for token in tokenize(&title) {
                if uniq_tokens.insert(token.clone()) {
                    tokens.push(token);
                }
            }
        }
        if let Some(pid) = project_id {
            file_project_set.insert(pid);
        }
    }

    let (hour_bucket, weekday) = extract_hour_weekday(&start_time);
    Ok(Some(SessionContext {
        app_id,
        hour_bucket,
        weekday,
        tokens,
        file_project_ids: file_project_set.into_iter().collect(),
    }))
}

fn compute_raw_suggestion(
    conn: &rusqlite::Connection,
    context: &SessionContext,
) -> Result<Option<ProjectSuggestion>, String> {
    let mut candidate_scores: HashMap<i64, f64> = HashMap::new();
    let mut candidate_evidence: HashMap<i64, i64> = HashMap::new();
    let mut active_project_cache: HashMap<i64, bool> = HashMap::new();

    let mut candidate_file_scores: HashMap<i64, f64> = HashMap::new();
    let mut candidate_app_scores: HashMap<i64, f64> = HashMap::new();
    let mut candidate_time_scores: HashMap<i64, f64> = HashMap::new();
    let mut candidate_token_scores: HashMap<i64, f64> = HashMap::new();

    // Layer 0 (strongest): direct file-activity project evidence
    // If file_activities overlapping the session already have assigned project_ids,
    // this is the most reliable signal – it mirrors what the frontend shows.
    for &pid in &context.file_project_ids {
        if is_project_active_cached(conn, &mut active_project_cache, pid) {
            let score = 0.80;
            *candidate_scores.entry(pid).or_insert(0.0) += score;
            *candidate_file_scores.entry(pid).or_insert(0.0) += score;
            *candidate_evidence.entry(pid).or_insert(0) += 2; // counts as strong evidence
        }
    }

    // Layer 1: app→project historical mapping (reduced weight)
    let mut app_stmt = conn
        .prepare("SELECT project_id, cnt FROM assignment_model_app WHERE app_id = ?1")
        .map_err(|e| e.to_string())?;
    let mut app_rows = app_stmt
        .query(rusqlite::params![context.app_id])
        .map_err(|e| e.to_string())?;
    while let Some(row) = app_rows.next().map_err(|e| e.to_string())? {
        let project_id: i64 = row.get(0).map_err(|e| e.to_string())?;
        if !is_project_active_cached(conn, &mut active_project_cache, project_id) {
            continue;
        }
        let cnt = row.get::<_, i64>(1).map_err(|e| e.to_string())? as f64;
        let score = 0.30 * (1.0 + cnt).ln();
        *candidate_scores.entry(project_id).or_insert(0.0) += score;
        *candidate_app_scores.entry(project_id).or_insert(0.0) += score;
        *candidate_evidence.entry(project_id).or_insert(0) += 1;
    }

    // Layer 2: time-of-day patterns (reduced weight)
    let mut time_stmt = conn
        .prepare(
            "SELECT project_id, cnt
             FROM assignment_model_time
             WHERE app_id = ?1 AND hour_bucket = ?2 AND weekday = ?3",
        )
        .map_err(|e| e.to_string())?;
    let mut time_rows = time_stmt
        .query(rusqlite::params![
            context.app_id,
            context.hour_bucket,
            context.weekday
        ])
        .map_err(|e| e.to_string())?;
    while let Some(row) = time_rows.next().map_err(|e| e.to_string())? {
        let project_id: i64 = row.get(0).map_err(|e| e.to_string())?;
        if !is_project_active_cached(conn, &mut active_project_cache, project_id) {
            continue;
        }
        let cnt = row.get::<_, i64>(1).map_err(|e| e.to_string())? as f64;
        let score = 0.10 * (1.0 + cnt).ln();
        *candidate_scores.entry(project_id).or_insert(0.0) += score;
        *candidate_time_scores.entry(project_id).or_insert(0.0) += score;
        *candidate_evidence.entry(project_id).or_insert(0) += 1;
    }

    // Layer 3: token matching (unchanged weight)
    if !context.tokens.is_empty() {
        let mut token_stats: HashMap<i64, (f64, f64)> = HashMap::new();
        for chunk in context.tokens.chunks(200) {
            let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let sql = format!(
                "SELECT project_id, SUM(cnt), COUNT(cnt)
                 FROM assignment_model_token
                 WHERE token IN ({})
                 GROUP BY project_id",
                placeholders
            );
            let mut token_stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let params: Vec<&dyn ToSql> = chunk.iter().map(|t| t as &dyn ToSql).collect();
            let mut token_rows = token_stmt
                .query(rusqlite::params_from_iter(params))
                .map_err(|e| e.to_string())?;
            while let Some(row) = token_rows.next().map_err(|e| e.to_string())? {
                let project_id: i64 = row.get(0).map_err(|e| e.to_string())?;
                let sum_cnt = row.get::<_, i64>(1).map_err(|e| e.to_string())? as f64;
                let matches_cnt = row.get::<_, i64>(2).map_err(|e| e.to_string())? as f64;
                let entry = token_stats.entry(project_id).or_insert((0.0, 0.0));
                entry.0 += sum_cnt;
                entry.1 += matches_cnt;
            }
        }

        let token_total = context.tokens.len() as f64;
        for (project_id, (sum_cnt, matches_cnt)) in token_stats {
            if !is_project_active_cached(conn, &mut active_project_cache, project_id) {
                continue;
            }
            let avg_log =
                (1.0 + (sum_cnt / matches_cnt.max(1.0))).ln() * (matches_cnt / token_total);
            let score = 0.30 * avg_log;
            *candidate_scores.entry(project_id).or_insert(0.0) += score;
            *candidate_token_scores.entry(project_id).or_insert(0.0) += score;
            *candidate_evidence.entry(project_id).or_insert(0) += 1;
        }
    }

    if candidate_scores.is_empty() {
        return Ok(None);
    }

    let mut sorted = candidate_scores.into_iter().collect::<Vec<_>>();
    sorted.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(Ordering::Equal)
            .then_with(|| a.0.cmp(&b.0))
    });
    let Some((best_project_id, best_score)) = sorted.first().copied() else {
        return Ok(None);
    };

    let second_score = sorted.get(1).map(|(_, s)| *s).unwrap_or(0.0);
    let margin = (best_score - second_score).max(0.0);
    let evidence_count = *candidate_evidence.get(&best_project_id).unwrap_or(&1);
    // Soft scaling: approaches 1.0 asymptotically (count=1→0.39, count=2→0.63, count=3→0.78, count=6→0.95)
    let evidence_factor = 1.0 - (-(evidence_count as f64) / 2.0).exp();
    let sigmoid_margin = 1.0 / (1.0 + (-margin).exp());
    let confidence = sigmoid_margin * evidence_factor;

    let breakdown = SuggestionBreakdown {
        file_score: *candidate_file_scores.get(&best_project_id).unwrap_or(&0.0),
        app_score: *candidate_app_scores.get(&best_project_id).unwrap_or(&0.0),
        time_score: *candidate_time_scores.get(&best_project_id).unwrap_or(&0.0),
        token_score: *candidate_token_scores.get(&best_project_id).unwrap_or(&0.0),
    };

    Ok(Some(ProjectSuggestion {
        project_id: best_project_id,
        confidence,
        evidence_count,
        margin,
        breakdown: Some(breakdown),
    }))
}

fn meets_suggest_threshold(status: &AssignmentModelStatus, suggestion: &ProjectSuggestion) -> bool {
    suggestion.confidence >= status.min_confidence_suggest
}

fn meets_auto_safe_threshold(
    status: &AssignmentModelStatus,
    suggestion: &ProjectSuggestion,
) -> bool {
    suggestion.confidence >= status.min_confidence_auto
        && suggestion.evidence_count >= status.min_evidence_auto
        && suggestion.margin >= AUTO_SAFE_MIN_MARGIN
}

fn fetch_unassigned_session_ids(
    conn: &rusqlite::Connection,
    limit: i64,
    date_range: Option<DateRange>,
    min_duration: Option<i64>,
) -> Result<Vec<i64>, String> {
    let mut sql = String::from(
        "SELECT id
         FROM sessions
         WHERE (is_hidden IS NULL OR is_hidden = 0) AND project_id IS NULL",
    );
    let mut params: Vec<Box<dyn ToSql>> = Vec::new();
    let mut idx = 1;

    if let Some(min_dur) = min_duration {
        if min_dur > 0 {
            sql.push_str(&format!(" AND duration_seconds > ?{}", idx));
            params.push(Box::new(min_dur));
            idx += 1;
        }
    }

    if let Some(dr) = date_range {
        sql.push_str(&format!(" AND date >= ?{}", idx));
        params.push(Box::new(dr.start));
        idx += 1;
        sql.push_str(&format!(" AND date <= ?{}", idx));
        params.push(Box::new(dr.end));
        idx += 1;
    }

    sql.push_str(" ORDER BY start_time DESC");
    sql.push_str(&format!(" LIMIT ?{}", idx));
    params.push(Box::new(limit));

    let params_ref: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params_ref.as_slice(), |row| row.get::<_, i64>(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read unassigned session id row: {}", e))
}

#[command]
pub async fn get_assignment_model_status(app: AppHandle) -> Result<AssignmentModelStatus, String> {
    let conn = db::get_connection(&app)?;
    let state = load_state_map(&conn)?;
    let training_horizon_days = clamp_i64(
        parse_state_i64(
            &state,
            "training_horizon_days",
            DEFAULT_TRAINING_HORIZON_DAYS,
        ),
        MIN_TRAINING_HORIZON_DAYS,
        MAX_TRAINING_HORIZON_DAYS,
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
        min_evidence_auto: parse_state_i64(&state, "min_evidence_auto", DEFAULT_MIN_EVIDENCE_AUTO),
        training_horizon_days,
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
}

#[command]
pub async fn get_assignment_model_metrics(
    app: AppHandle,
    days: Option<i64>,
) -> Result<AssignmentModelMetrics, String> {
    let conn = db::get_connection(&app)?;
    let window_days = clamp_i64(days.unwrap_or(30), 7, 365);
    let from_modifier = format!("-{} days", window_days.saturating_sub(1));

    let mut feedback_by_day: HashMap<String, (i64, i64, i64)> = HashMap::new();
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
                    END) AS manual_change
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
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (date, accepted, rejected, manual_change) =
                row.map_err(|e| format!("Failed to read feedback metrics row: {}", e))?;
            feedback_by_day.insert(date, (accepted, rejected, manual_change));
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
            let (date, total_entries, with_detected_path, with_title_history, with_activity_type) =
                row.map_err(|e| format!("Failed to read coverage metrics row: {}", e))?;
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
        let (feedback_accepted, feedback_rejected, feedback_manual_change) =
            feedback_by_day.get(&date).copied().unwrap_or((0, 0, 0));
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
        summary.feedback_accepted + summary.feedback_rejected,
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
}

#[command]
pub async fn set_assignment_mode(
    app: AppHandle,
    mode: String,
    suggest_conf: f64,
    auto_conf: f64,
    auto_ev: i64,
) -> Result<(), String> {
    let conn = db::get_connection(&app)?;

    let mode = normalize_mode(&mode);
    let suggest_conf = clamp01(suggest_conf, DEFAULT_MIN_CONFIDENCE_SUGGEST);
    let auto_conf = clamp01(auto_conf, DEFAULT_MIN_CONFIDENCE_AUTO);
    let auto_ev = clamp_i64(auto_ev, 1, 50);

    upsert_state(&conn, "mode", &mode)?;
    upsert_state(
        &conn,
        "min_confidence_suggest",
        &format!("{:.4}", suggest_conf),
    )?;
    upsert_state(&conn, "min_confidence_auto", &format!("{:.4}", auto_conf))?;
    upsert_state(&conn, "min_evidence_auto", &auto_ev.to_string())?;

    Ok(())
}

#[command]
pub async fn set_assignment_model_cooldown(
    app: AppHandle,
    hours: i64,
) -> Result<AssignmentModelStatus, String> {
    let conn = db::get_connection(&app)?;
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
        upsert_state(&conn, "cooldown_until", &cooldown_until)?;
    }

    get_assignment_model_status(app).await
}

#[command]
pub async fn set_training_horizon_days(
    app: AppHandle,
    days: i64,
) -> Result<AssignmentModelStatus, String> {
    let conn = db::get_connection(&app)?;
    let clamped_days = clamp_i64(days, MIN_TRAINING_HORIZON_DAYS, MAX_TRAINING_HORIZON_DAYS);
    upsert_state(&conn, "training_horizon_days", &clamped_days.to_string())?;
    get_assignment_model_status(app).await
}

#[command]
pub async fn set_training_blacklists(
    app: AppHandle,
    app_blacklist: Vec<String>,
    folder_blacklist: Vec<String>,
) -> Result<AssignmentModelStatus, String> {
    let conn = db::get_connection(&app)?;
    let normalized_apps = normalize_blacklist_entries(&app_blacklist, false);
    let normalized_folders = normalize_blacklist_entries(&folder_blacklist, true);
    let apps_payload = serde_json::to_string(&normalized_apps).map_err(|e| e.to_string())?;
    let folders_payload = serde_json::to_string(&normalized_folders).map_err(|e| e.to_string())?;
    upsert_state(&conn, "training_app_blacklist", &apps_payload)?;
    upsert_state(&conn, "training_folder_blacklist", &folders_payload)?;
    get_assignment_model_status(app).await
}

#[command]
pub async fn reset_assignment_model_knowledge(
    app: AppHandle,
) -> Result<AssignmentModelStatus, String> {
    {
        let conn = db::get_connection(&app)?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(
            "DELETE FROM assignment_model_app;
             DELETE FROM assignment_model_time;
             DELETE FROM assignment_model_token;
             DELETE FROM assignment_feedback;
             DELETE FROM assignment_suggestions;
             DELETE FROM assignment_auto_run_items;
             DELETE FROM assignment_auto_runs;",
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM assignment_model_state
             WHERE key IN (
                 'feedback_since_train',
                 'last_train_at',
                 'last_train_duration_ms',
                 'last_train_samples',
                 'train_error_last',
                 'cooldown_until',
                 'is_training'
             )",
            [],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    get_assignment_model_status(app).await
}

/// Retrain the assignment model synchronously using the given connection.
/// This is the core training logic, callable from any module after destructive
/// DB operations (compact, reset, import) to keep the model in sync with data.
// THREADING: Runs on Tauri's async thread pool. Long transaction — may hold
// a write lock for seconds on large datasets, blocking other writers until done.
pub fn retrain_model_sync(conn: &rusqlite::Connection) -> Result<i64, String> {
    upsert_state(conn, "is_training", "true")?;
    let start_time = std::time::Instant::now();

    let state = load_state_map(conn).unwrap_or_default();
    let feedback_weight = parse_state_f64(&state, "feedback_weight", DEFAULT_FEEDBACK_WEIGHT);
    let training_horizon_days = clamp_i64(
        parse_state_i64(
            &state,
            "training_horizon_days",
            DEFAULT_TRAINING_HORIZON_DAYS,
        ),
        MIN_TRAINING_HORIZON_DAYS,
        MAX_TRAINING_HORIZON_DAYS,
    );
    let training_horizon_modifier = format!("-{} days", training_horizon_days);
    let training_app_blacklist = normalize_blacklist_entries(
        &parse_state_string_list(&state, "training_app_blacklist"),
        false,
    );
    let training_folder_blacklist = normalize_blacklist_entries(
        &parse_state_string_list(&state, "training_folder_blacklist"),
        true,
    );
    let blacklisted_app_ids = resolve_blacklisted_app_ids(conn, &training_app_blacklist)?;

    let result = (|| -> rusqlite::Result<i64> {
        let tx = conn.unchecked_transaction()?;

        tx.execute_batch(
            "
            DELETE FROM assignment_model_app;
            DELETE FROM assignment_model_time;
            DELETE FROM assignment_model_token;
            CREATE TEMP TABLE IF NOT EXISTS temp_training_blacklist_apps (
                app_id INTEGER PRIMARY KEY
            );
            DELETE FROM temp_training_blacklist_apps;",
        )?;

        if !blacklisted_app_ids.is_empty() {
            let mut insert_blocked =
                tx.prepare("INSERT INTO temp_training_blacklist_apps (app_id) VALUES (?1)")?;
            for app_id in &blacklisted_app_ids {
                insert_blocked.execute(rusqlite::params![app_id])?;
            }
        }

        tx.execute(
            "INSERT INTO assignment_model_app (app_id, project_id, cnt, last_seen)
             SELECT s.app_id, s.project_id, COUNT(*) as cnt, MAX(s.start_time)
             FROM sessions s
             WHERE s.project_id IS NOT NULL
               AND s.duration_seconds > 10
               AND date(s.start_time) >= date('now', ?1)
               AND NOT EXISTS (
                    SELECT 1 FROM temp_training_blacklist_apps b WHERE b.app_id = s.app_id
               )
               AND COALESCE((
                     SELECT af.source
                     FROM assignment_feedback af
                     WHERE af.session_id = s.id
                     ORDER BY af.created_at DESC, af.id DESC
                     LIMIT 1
                   ), '') <> 'auto_accept'
             GROUP BY s.app_id, s.project_id",
            rusqlite::params![&training_horizon_modifier],
        )?;

        tx.execute(
            "INSERT INTO assignment_model_time (app_id, hour_bucket, weekday, project_id, cnt)
             SELECT
                 s.app_id,
                 CAST(strftime('%H', s.start_time) AS INTEGER) as hour_bucket,
                 CAST(strftime('%w', s.start_time) AS INTEGER) as weekday,
                 s.project_id,
                 COUNT(*) as cnt
             FROM sessions s
             WHERE s.project_id IS NOT NULL
               AND s.duration_seconds > 10
               AND date(s.start_time) >= date('now', ?1)
               AND NOT EXISTS (
                    SELECT 1 FROM temp_training_blacklist_apps b WHERE b.app_id = s.app_id
               )
               AND COALESCE((
                     SELECT af.source
                     FROM assignment_feedback af
                     WHERE af.session_id = s.id
                     ORDER BY af.created_at DESC, af.id DESC
                     LIMIT 1
                   ), '') <> 'auto_accept'
             GROUP BY s.app_id, hour_bucket, weekday, s.project_id",
            rusqlite::params![&training_horizon_modifier],
        )?;

        // Reinforcement: boost counts based on manual feedback.
        // For each manual correction (from_project -> to_project), boost the correct
        // project and penalize the wrong one in assignment_model_app.
        {
            let mut fb_stmt = tx.prepare(
                "SELECT app_id, from_project_id, to_project_id, COUNT(*) as cnt
                 FROM assignment_feedback
                 WHERE source IN (
                   'manual_session_assign',
                   'manual_session_change',
                   'manual_project_card_change',
                   'manual_session_unassign',
                   'bulk_unassign',
                   'manual_app_assign',
                   'ai_suggestion_reject',
                   'ai_suggestion_accept'
                  )
                    AND to_project_id IS NOT NULL
                    AND app_id IS NOT NULL
                    AND NOT EXISTS (
                        SELECT 1
                        FROM temp_training_blacklist_apps b
                        WHERE b.app_id = assignment_feedback.app_id
                    )
                  GROUP BY app_id, from_project_id, to_project_id",
            )?;
            let mut fb_rows = fb_stmt.query([])?;
            while let Some(row) = fb_rows.next()? {
                let app_id: i64 = row.get(0)?;
                let from_project_id: Option<i64> = row.get(1)?;
                let to_project_id: i64 = row.get(2)?;
                let cnt: i64 = row.get(3)?;

                let boost = (cnt as f64 * feedback_weight).round() as i64;

                // Boost the correct project (user moved the session here)
                tx.execute(
                    "INSERT INTO assignment_model_app (app_id, project_id, cnt, last_seen)
                     VALUES (?1, ?2, ?3, datetime('now'))
                     ON CONFLICT(app_id, project_id) DO UPDATE SET
                       cnt = assignment_model_app.cnt + ?3",
                    rusqlite::params![app_id, to_project_id, boost],
                )?;

                // Penalize the wrong project (system was wrong about this one)
                if let Some(from_pid) = from_project_id {
                    let penalty = (boost / 2).max(1);
                    tx.execute(
                        "UPDATE assignment_model_app
                         SET cnt = MAX(cnt - ?3, 1)
                         WHERE app_id = ?1 AND project_id = ?2",
                        rusqlite::params![app_id, from_pid, penalty],
                    )?;
                }
            }
        }

        // Reinforcement for time model: boost (app, hour, weekday) -> project buckets
        // based on manual assignment feedback.
        {
            let mut fb_stmt = tx.prepare(
                "SELECT app_id, to_project_id, COUNT(*) as cnt
                 FROM assignment_feedback
                 WHERE source IN (
                   'manual_session_assign',
                   'manual_session_change',
                   'manual_project_card_change',
                   'manual_app_assign',
                   'ai_suggestion_accept'
                  )
                    AND to_project_id IS NOT NULL
                    AND app_id IS NOT NULL
                    AND NOT EXISTS (
                        SELECT 1
                        FROM temp_training_blacklist_apps b
                        WHERE b.app_id = assignment_feedback.app_id
                    )
                  GROUP BY app_id, to_project_id",
            )?;
            let mut fb_rows = fb_stmt.query([])?;
            while let Some(row) = fb_rows.next()? {
                let app_id: i64 = row.get(0)?;
                let to_project_id: i64 = row.get(1)?;
                let cnt: i64 = row.get(2)?;
                let boost = (cnt as f64 * feedback_weight).round() as i64;
                tx.execute(
                    "INSERT INTO assignment_model_time (app_id, hour_bucket, weekday, project_id, cnt)
                     SELECT s.app_id,
                            CAST(strftime('%H', s.start_time) AS INTEGER),
                            CAST(strftime('%w', s.start_time) AS INTEGER),
                            ?2, ?3
                     FROM sessions s
                     WHERE s.app_id = ?1
                       AND s.project_id = ?2
                       AND s.duration_seconds > 10
                       AND date(s.start_time) >= date('now', ?4)
                       AND NOT EXISTS (
                            SELECT 1 FROM temp_training_blacklist_apps b WHERE b.app_id = s.app_id
                       )
                     GROUP BY s.app_id,
                              CAST(strftime('%H', s.start_time) AS INTEGER),
                              CAST(strftime('%w', s.start_time) AS INTEGER)
                     ON CONFLICT(app_id, hour_bucket, weekday, project_id) DO UPDATE SET
                        cnt = assignment_model_time.cnt + ?3",
                    rusqlite::params![app_id, to_project_id, boost, &training_horizon_modifier],
                )?;
            }
        }

        let mut token_counts: HashMap<(String, i64), i64> = HashMap::new();
        {
            let mut file_stmt = tx.prepare(
                "SELECT app_id, file_name, file_path, detected_path, project_id, window_title, title_history
                 FROM file_activities
                 WHERE project_id IS NOT NULL
                   AND date >= date('now', ?1)",
            )?;
            let mut file_rows = file_stmt.query(rusqlite::params![&training_horizon_modifier])?;
            while let Some(row) = file_rows.next()? {
                let app_id: i64 = row.get(0)?;
                let file_name: String = row.get(1)?;
                let file_path: String = row.get(2)?;
                let detected_path: Option<String> = row.get(3)?;
                let project_id: i64 = row.get(4)?;
                let window_title: Option<String> = row.get(5)?;
                let title_history: Option<String> = row.get(6)?;

                if blacklisted_app_ids.contains(&app_id) {
                    continue;
                }
                if is_under_blacklisted_folder(
                    Some(&file_path),
                    detected_path.as_deref(),
                    &training_folder_blacklist,
                ) {
                    continue;
                }

                for token in tokenize(&file_name) {
                    *token_counts.entry((token, project_id)).or_insert(0) += 1;
                }
                for token in tokenize(&file_path) {
                    *token_counts.entry((token, project_id)).or_insert(0) += 1;
                }
                if let Some(ref path) = detected_path {
                    for token in tokenize(path) {
                        *token_counts.entry((token, project_id)).or_insert(0) += 1;
                    }
                }
                // Tokenize window_title for richer training signal
                if let Some(ref wt) = window_title {
                    for token in tokenize(wt) {
                        *token_counts.entry((token, project_id)).or_insert(0) += 1;
                    }
                }
                for title in parse_title_history(title_history.as_deref()) {
                    for token in tokenize(&title) {
                        *token_counts.entry((token, project_id)).or_insert(0) += 1;
                    }
                }
            }
        }

        {
            let mut insert_token = tx.prepare(
                "INSERT INTO assignment_model_token (token, project_id, cnt, last_seen)
                 VALUES (?1, ?2, ?3, datetime('now'))",
            )?;
            for ((token, project_id), count) in token_counts {
                insert_token.execute(rusqlite::params![token, project_id, count])?;
            }
        }

        let app_samples: i64 =
            tx.query_row("SELECT COUNT(*) FROM assignment_model_app", [], |row| {
                row.get(0)
            })?;
        let time_samples: i64 =
            tx.query_row("SELECT COUNT(*) FROM assignment_model_time", [], |row| {
                row.get(0)
            })?;
        let token_samples: i64 =
            tx.query_row("SELECT COUNT(*) FROM assignment_model_token", [], |row| {
                row.get(0)
            })?;

        tx.commit()?;
        Ok(app_samples + time_samples + token_samples)
    })();

    let duration_ms = start_time.elapsed().as_millis() as i64;
    let _ = upsert_state(conn, "is_training", "false");

    match result {
        Ok(total_samples) => {
            upsert_state(conn, "last_train_at", &chrono::Local::now().to_rfc3339())?;
            upsert_state(conn, "feedback_since_train", "0")?;
            upsert_state(conn, "last_train_duration_ms", &duration_ms.to_string())?;
            upsert_state(conn, "last_train_samples", &total_samples.to_string())?;
            let _ = conn.execute(
                "DELETE FROM assignment_model_state WHERE key = 'train_error_last'",
                [],
            );
            let _ = conn.execute(
                "DELETE FROM assignment_model_state WHERE key = 'cooldown_until'",
                [],
            );
            Ok(total_samples)
        }
        Err(e) => {
            upsert_state(conn, "train_error_last", &e.to_string()).ok();
            Err(format!("Model training failed: {}", e))
        }
    }
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

    let conn = db::get_connection(&app)?;
    retrain_model_sync(&conn)?;
    get_assignment_model_status(app).await
}

#[allow(dead_code)]
pub async fn suggest_project_for_session(
    app: AppHandle,
    session_id: i64,
) -> Result<Option<ProjectSuggestion>, String> {
    let status = get_assignment_model_status(app.clone()).await?;
    let conn = db::get_connection(&app)?;
    suggest_project_for_session_with_status(&conn, &status, session_id)
}

pub(crate) fn suggest_project_for_session_with_status(
    conn: &rusqlite::Connection,
    status: &AssignmentModelStatus,
    session_id: i64,
) -> Result<Option<ProjectSuggestion>, String> {
    if status.mode == "off" {
        return Ok(None);
    }

    let Some(context) = build_session_context(conn, session_id)? else {
        return Ok(None);
    };
    let Some(suggestion) = compute_raw_suggestion(conn, &context)? else {
        return Ok(None);
    };

    let accepted = if status.mode == "auto_safe" {
        meets_auto_safe_threshold(status, &suggestion)
    } else {
        meets_suggest_threshold(status, &suggestion)
    };

    if accepted {
        Ok(Some(suggestion))
    } else {
        Ok(None)
    }
}

pub(crate) fn suggest_projects_for_sessions_with_status(
    conn: &rusqlite::Connection,
    status: &AssignmentModelStatus,
    session_ids: &[i64],
) -> Result<HashMap<i64, ProjectSuggestion>, String> {
    let mut out = HashMap::new();
    if status.mode == "off" || session_ids.is_empty() {
        return Ok(out);
    }

    for &session_id in session_ids {
        if let Some(suggestion) = suggest_project_for_session_with_status(conn, status, session_id)?
        {
            out.insert(session_id, suggestion);
        }
    }
    Ok(out)
}

pub(crate) fn suggest_project_for_session_raw(
    conn: &rusqlite::Connection,
    status: &AssignmentModelStatus,
    session_id: i64,
) -> Result<Option<ProjectSuggestion>, String> {
    if status.mode == "off" {
        return Ok(None);
    }

    let Some(context) = build_session_context(conn, session_id)? else {
        return Ok(None);
    };
    compute_raw_suggestion(conn, &context)
}

pub(crate) fn suggest_projects_for_sessions_raw(
    conn: &rusqlite::Connection,
    status: &AssignmentModelStatus,
    session_ids: &[i64],
) -> Result<HashMap<i64, ProjectSuggestion>, String> {
    let mut out = HashMap::new();
    if status.mode == "off" || session_ids.is_empty() {
        return Ok(out);
    }

    for &session_id in session_ids {
        if let Some(suggestion) = suggest_project_for_session_raw(conn, status, session_id)? {
            out.insert(session_id, suggestion);
        }
    }

    Ok(out)
}

#[command]
pub async fn run_auto_safe_assignment(
    app: AppHandle,
    limit: Option<i64>,
    date_range: Option<DateRange>,
    min_duration: Option<i64>,
) -> Result<AutoSafeRunResult, String> {
    let status = get_assignment_model_status(app.clone()).await?;
    if status.mode != "auto_safe" {
        return Err("Mode must be 'auto_safe' to run auto assignment".to_string());
    }

    let mut conn = db::get_connection(&app)?;
    let effective_limit = clamp_i64(limit.unwrap_or(500), 1, 10_000);
    let session_ids =
        fetch_unassigned_session_ids(&conn, effective_limit, date_range, min_duration)?;

    conn.execute(
        "INSERT INTO assignment_auto_runs (
            started_at,
            mode,
            min_confidence_auto,
            min_evidence_auto,
            sessions_scanned,
            sessions_suggested,
            sessions_assigned
         ) VALUES (datetime('now'), ?1, ?2, ?3, 0, 0, 0)",
        rusqlite::params![
            status.mode,
            status.min_confidence_auto,
            status.min_evidence_auto
        ],
    )
    .map_err(|e| e.to_string())?;
    let run_id = conn.last_insert_rowid();

    let mut result = AutoSafeRunResult {
        run_id: Some(run_id),
        scanned: 0,
        suggested: 0,
        assigned: 0,
        skipped_low_confidence: 0,
        skipped_ambiguous: 0,
        skipped_already_assigned: 0,
    };

    let run_work = (|| -> Result<(), String> {
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        for session_id in session_ids {
            result.scanned += 1;

            let session = tx
                .query_row(
                    "SELECT app_id, date, start_time, end_time, project_id
                     FROM sessions
                     WHERE id = ?1",
                    rusqlite::params![session_id],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, Option<i64>>(4)?,
                        ))
                    },
                )
                .optional()
                .map_err(|e| e.to_string())?;

            let Some((app_id, date, start_time, end_time, current_project_id)) = session else {
                continue;
            };

            if current_project_id.is_some() {
                result.skipped_already_assigned += 1;
                continue;
            }

            // Respect manual overrides: never auto-assign sessions the user explicitly moved
            if check_manual_override(&tx, session_id).is_some() {
                result.skipped_already_assigned += 1;
                continue;
            }

            let Some(context) = build_session_context(&tx, session_id)? else {
                result.skipped_low_confidence += 1;
                continue;
            };
            let Some(suggestion) = compute_raw_suggestion(&tx, &context)? else {
                result.skipped_low_confidence += 1;
                continue;
            };

            if !meets_auto_safe_threshold(&status, &suggestion) {
                let has_confidence_and_evidence = suggestion.confidence
                    >= status.min_confidence_auto
                    && suggestion.evidence_count >= status.min_evidence_auto;
                if has_confidence_and_evidence && suggestion.margin < AUTO_SAFE_MIN_MARGIN {
                    result.skipped_ambiguous += 1;
                } else {
                    result.skipped_low_confidence += 1;
                }
                continue;
            }

            result.suggested += 1;

            tx.execute(
                "INSERT INTO assignment_suggestions (
                    session_id, app_id, suggested_project_id, suggested_confidence,
                    suggested_evidence_count, model_version, created_at, status
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'), 'pending')",
                rusqlite::params![
                    session_id,
                    app_id,
                    suggestion.project_id,
                    suggestion.confidence,
                    suggestion.evidence_count,
                    "auto_safe_v1"
                ],
            )
            .map_err(|e| e.to_string())?;
            let suggestion_id = tx.last_insert_rowid();

            let updated_session = tx
                .execute(
                    "UPDATE sessions
                     SET project_id = ?1
                     WHERE id = ?2 AND project_id IS NULL",
                    rusqlite::params![suggestion.project_id, session_id],
                )
                .map_err(|e| e.to_string())?;

            if updated_session == 0 {
                result.skipped_already_assigned += 1;
                let _ = tx.execute(
                    "UPDATE assignment_suggestions SET status = 'expired' WHERE id = ?1",
                    rusqlite::params![suggestion_id],
                );
                continue;
            }

            tx.execute(
                "UPDATE file_activities
                 SET project_id = ?1
                 WHERE app_id = ?2
                   AND date = ?3
                   AND last_seen > ?4
                   AND first_seen < ?5",
                rusqlite::params![suggestion.project_id, app_id, date, start_time, end_time],
            )
            .map_err(|e| e.to_string())?;

            tx.execute(
                "INSERT INTO assignment_auto_run_items (
                    run_id, session_id, app_id, from_project_id, to_project_id,
                    suggestion_id, confidence, evidence_count, applied_at
                 ) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, datetime('now'))",
                rusqlite::params![
                    run_id,
                    session_id,
                    app_id,
                    suggestion.project_id,
                    suggestion_id,
                    suggestion.confidence,
                    suggestion.evidence_count
                ],
            )
            .map_err(|e| e.to_string())?;

            tx.execute(
                "UPDATE assignment_suggestions SET status = 'accepted' WHERE id = ?1",
                rusqlite::params![suggestion_id],
            )
            .map_err(|e| e.to_string())?;

            tx.execute(
                "INSERT INTO assignment_feedback (
                    suggestion_id, session_id, app_id, from_project_id, to_project_id, source, created_at
                 ) VALUES (?1, ?2, ?3, NULL, ?4, 'auto_accept', datetime('now'))",
                rusqlite::params![suggestion_id, session_id, app_id, suggestion.project_id],
            )
            .map_err(|e| e.to_string())?;

            result.assigned += 1;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })();

    if let Err(err) = run_work {
        conn.execute(
            "UPDATE assignment_auto_runs
             SET finished_at = datetime('now'),
                 sessions_scanned = ?2,
                 sessions_suggested = ?3,
                 sessions_assigned = ?4,
                 error = ?5
             WHERE id = ?1",
            rusqlite::params![
                run_id,
                result.scanned,
                result.suggested,
                result.assigned,
                err
            ],
        )
        .map_err(|e| e.to_string())?;
        return Err("Auto-safe assignment failed".to_string());
    }

    conn.execute(
        "UPDATE assignment_auto_runs
         SET finished_at = datetime('now'),
             sessions_scanned = ?2,
             sessions_suggested = ?3,
             sessions_assigned = ?4
         WHERE id = ?1",
        rusqlite::params![run_id, result.scanned, result.suggested, result.assigned],
    )
    .map_err(|e| e.to_string())?;

    Ok(result)
}

#[command]
pub async fn rollback_last_auto_safe_run(app: AppHandle) -> Result<AutoSafeRollbackResult, String> {
    let mut conn = db::get_connection(&app)?;

    let run_id = conn
        .query_row(
            "SELECT id
             FROM assignment_auto_runs
             WHERE sessions_assigned > 0 AND rolled_back_at IS NULL
             ORDER BY id DESC
             LIMIT 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No rollbackable auto-safe run found".to_string())?;

    let mut reverted = 0_i64;
    let mut skipped = 0_i64;

    let trx = conn.transaction().map_err(|e| e.to_string())?;

    let item_rows: Vec<_> = {
        let mut item_stmt = trx
            .prepare(
                "SELECT session_id, app_id, from_project_id, to_project_id, suggestion_id
                 FROM assignment_auto_run_items
                 WHERE run_id = ?1
                 ORDER BY id DESC",
            )
            .map_err(|e| e.to_string())?;
        let res: Vec<_> = item_stmt
            .query_map(rusqlite::params![run_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        res
    };

    for row in item_rows {
        let (session_id, app_id, from_project_id, to_project_id, suggestion_id) = row;

        let updated = trx
            .execute(
                "UPDATE sessions
                 SET project_id = ?1
                 WHERE id = ?2 AND project_id = ?3",
                rusqlite::params![from_project_id, session_id, to_project_id],
            )
            .map_err(|e| e.to_string())?;

        if updated == 0 {
            skipped += 1;
            continue;
        }

        let session_time = trx
            .query_row(
                "SELECT date, start_time, end_time FROM sessions WHERE id = ?1",
                rusqlite::params![session_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some((date, start_time, end_time)) = session_time {
            trx.execute(
                "UPDATE file_activities
                 SET project_id = ?1
                 WHERE app_id = ?2
                   AND date = ?3
                   AND last_seen > ?4
                   AND first_seen < ?5",
                rusqlite::params![from_project_id, app_id, date, start_time, end_time],
            )
            .map_err(|e| e.to_string())?;
        }

        if let Some(suggestion_id) = suggestion_id {
            trx.execute(
                "UPDATE assignment_suggestions SET status = 'rejected' WHERE id = ?1",
                rusqlite::params![suggestion_id],
            )
            .map_err(|e| e.to_string())?;
        }

        trx.execute(
            "INSERT INTO assignment_feedback (
                suggestion_id, session_id, app_id, from_project_id, to_project_id, source, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, 'auto_reject', datetime('now'))",
            rusqlite::params![
                suggestion_id,
                session_id,
                app_id,
                to_project_id,
                from_project_id
            ],
        )
        .map_err(|e| e.to_string())?;
        increment_feedback_counter(&trx);

        reverted += 1;
    }

    trx.execute(
        "UPDATE assignment_auto_runs
         SET rolled_back_at = datetime('now'),
             rollback_reverted = ?2,
             rollback_skipped = ?3
         WHERE id = ?1",
        rusqlite::params![run_id, reverted, skipped],
    )
    .map_err(|e| e.to_string())?;

    trx.commit().map_err(|e| e.to_string())?;

    Ok(AutoSafeRollbackResult {
        run_id,
        reverted,
        skipped,
    })
}

/// Layer 2: Deterministic assignment based on historical consistency.
/// For apps where 100% of previously assigned sessions point to the same project,
/// automatically assign unassigned sessions to that project.
#[command]
pub async fn apply_deterministic_assignment(
    app: AppHandle,
    min_history: Option<i64>,
) -> Result<DeterministicResult, String> {
    let mut conn = db::get_connection(&app)?;
    let min_sessions = min_history.unwrap_or(5).max(1);

    // Find apps where ALL assigned sessions (duration > 10s) map to exactly one project
    let app_rules: Vec<(i64, i64)> = {
        let mut stmt = conn
            .prepare(
                "SELECT app_id, project_id
                 FROM (
                     SELECT app_id, project_id, COUNT(*) as cnt,
                            COUNT(DISTINCT project_id) as distinct_projects
                     FROM sessions
                     WHERE project_id IS NOT NULL AND duration_seconds > 10
                     GROUP BY app_id
                     HAVING distinct_projects = 1 AND cnt >= ?1
                 )",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![min_sessions], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read deterministic app rule row: {}", e))?
    };

    let apps_with_rules = app_rules.len() as i64;
    let mut sessions_assigned: i64 = 0;
    let mut sessions_skipped: i64 = 0;

    if app_rules.is_empty() {
        return Ok(DeterministicResult {
            apps_with_rules: 0,
            sessions_assigned: 0,
            sessions_skipped: 0,
        });
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (app_id, project_id) in &app_rules {
        // Verify the target project still exists and is not excluded/frozen
        let project_valid: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0
                 FROM projects
                 WHERE id = ?1
                   AND excluded_at IS NULL
                   AND frozen_at IS NULL",
                rusqlite::params![project_id],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !project_valid {
            continue;
        }

        // Get unassigned sessions for this app
        let session_ids: Vec<(i64, String, String, String)> = {
            let mut stmt = tx
                .prepare(
                    "SELECT id, date, start_time, end_time
                     FROM sessions
                     WHERE app_id = ?1 AND project_id IS NULL AND duration_seconds > 10",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(rusqlite::params![app_id], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Failed to read deterministic session row: {}", e))?
        };

        for (session_id, date, start_time, end_time) in &session_ids {
            let updated = tx
                .execute(
                    "UPDATE sessions SET project_id = ?1 WHERE id = ?2 AND project_id IS NULL",
                    rusqlite::params![project_id, session_id],
                )
                .map_err(|e| e.to_string())?;

            if updated == 0 {
                sessions_skipped += 1;
                continue;
            }

            // Sync file_activities for the same time range
            tx.execute(
                "UPDATE file_activities
                 SET project_id = ?1
                 WHERE app_id = ?2
                   AND date = ?3
                   AND last_seen > ?4
                   AND first_seen < ?5
                   AND project_id IS NULL",
                rusqlite::params![project_id, app_id, date, start_time, end_time],
            )
            .map_err(|e| e.to_string())?;

            // Record feedback for ML training
            tx.execute(
                "INSERT INTO assignment_feedback (
                    suggestion_id, session_id, app_id, from_project_id, to_project_id, source, created_at
                 ) VALUES (NULL, ?1, ?2, NULL, ?3, 'deterministic_rule', datetime('now'))",
                rusqlite::params![session_id, app_id, project_id],
            )
            .map_err(|e| e.to_string())?;

            sessions_assigned += 1;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    if sessions_assigned > 0 {
        log::info!(
            "Deterministic assignment: {} apps with rules, {} sessions assigned, {} skipped",
            apps_with_rules,
            sessions_assigned,
            sessions_skipped
        );
    }

    Ok(DeterministicResult {
        apps_with_rules,
        sessions_assigned,
        sessions_skipped,
    })
}

/// Automatically run auto-safe assignment if mode is set to auto_safe.
/// Called on app startup (after import) so new sessions are assigned without manual intervention.
/// Returns None when mode is not auto_safe or no unassigned sessions were found.
#[command]
pub async fn auto_run_if_needed(
    app: AppHandle,
    min_duration: Option<i64>,
) -> Result<Option<AutoSafeRunResult>, String> {
    let mode = {
        let conn = db::get_connection(&app)?;
        let state = load_state_map(&conn)?;
        parse_state_opt_string(&state, "mode").unwrap_or_else(|| DEFAULT_MODE.to_string())
    };

    if mode != "auto_safe" {
        return Ok(None);
    }

    let result = run_auto_safe_assignment(app, None, None, min_duration).await?;
    if result.assigned == 0 && result.scanned == 0 {
        return Ok(None);
    }
    Ok(Some(result))
}

// ---------------------------------------------------------------------------
// Score Breakdown & Reinforcement Commands
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct CandidateScore {
    pub project_id: i64,
    pub project_name: String,
    pub layer0_file_score: f64,
    pub layer1_app_score: f64,
    pub layer2_time_score: f64,
    pub layer3_token_score: f64,
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

/// Compute and return the full per-layer score breakdown for a session.
#[command]
pub async fn get_session_score_breakdown(
    app: AppHandle,
    session_id: i64,
) -> Result<ScoreBreakdown, String> {
    let conn = db::get_connection(&app)?;
    let context = build_session_context(&conn, session_id)?;

    let manual_override_pid = check_manual_override(&conn, session_id);

    let Some(context) = context else {
        return Ok(ScoreBreakdown {
            candidates: vec![],
            final_suggestion: None,
            has_manual_override: manual_override_pid.is_some(),
            manual_override_project_id: manual_override_pid,
        });
    };

    // Compute per-layer scores for all candidates
    let mut layer0: HashMap<i64, f64> = HashMap::new();
    let mut layer1: HashMap<i64, f64> = HashMap::new();
    let mut layer2: HashMap<i64, f64> = HashMap::new();
    let mut layer3: HashMap<i64, f64> = HashMap::new();
    let mut candidate_evidence: HashMap<i64, i64> = HashMap::new();

    // Layer 0: file-activity evidence
    let mut active_project_cache: HashMap<i64, bool> = HashMap::new();
    for &pid in &context.file_project_ids {
        if is_project_active_cached(&conn, &mut active_project_cache, pid) {
            *layer0.entry(pid).or_insert(0.0) += 0.80;
            *candidate_evidence.entry(pid).or_insert(0) += 2;
        }
    }

    // Layer 1: app→project
    {
        let mut stmt = conn
            .prepare("SELECT project_id, cnt FROM assignment_model_app WHERE app_id = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query(rusqlite::params![context.app_id])
            .map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let pid: i64 = row.get(0).map_err(|e| e.to_string())?;
            if !is_project_active_cached(&conn, &mut active_project_cache, pid) {
                continue;
            }
            let cnt = row.get::<_, i64>(1).map_err(|e| e.to_string())? as f64;
            let score = 0.30 * (1.0 + cnt).ln();
            *layer1.entry(pid).or_insert(0.0) += score;
            *candidate_evidence.entry(pid).or_insert(0) += 1;
        }
    }

    // Layer 2: time patterns
    {
        let mut stmt = conn
            .prepare(
                "SELECT project_id, cnt FROM assignment_model_time WHERE app_id = ?1 AND hour_bucket = ?2 AND weekday = ?3",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query(rusqlite::params![
                context.app_id,
                context.hour_bucket,
                context.weekday
            ])
            .map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let pid: i64 = row.get(0).map_err(|e| e.to_string())?;
            if !is_project_active_cached(&conn, &mut active_project_cache, pid) {
                continue;
            }
            let cnt = row.get::<_, i64>(1).map_err(|e| e.to_string())? as f64;
            let score = 0.10 * (1.0 + cnt).ln();
            *layer2.entry(pid).or_insert(0.0) += score;
            *candidate_evidence.entry(pid).or_insert(0) += 1;
        }
    }

    // Layer 3: token matching
    if !context.tokens.is_empty() {
        let mut token_stats: HashMap<i64, (f64, f64)> = HashMap::new();
        for chunk in context.tokens.chunks(200) {
            let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let sql = format!(
                "SELECT project_id, SUM(cnt), COUNT(cnt) FROM assignment_model_token WHERE token IN ({}) GROUP BY project_id",
                placeholders
            );
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let params: Vec<&dyn ToSql> = chunk.iter().map(|t| t as &dyn ToSql).collect();
            let mut rows = stmt
                .query(rusqlite::params_from_iter(params))
                .map_err(|e| e.to_string())?;
            while let Some(row) = rows.next().map_err(|e| e.to_string())? {
                let pid: i64 = row.get(0).map_err(|e| e.to_string())?;
                let sum_cnt = row.get::<_, i64>(1).map_err(|e| e.to_string())? as f64;
                let matches_cnt = row.get::<_, i64>(2).map_err(|e| e.to_string())? as f64;
                let entry = token_stats.entry(pid).or_insert((0.0, 0.0));
                entry.0 += sum_cnt;
                entry.1 += matches_cnt;
            }
        }
        let token_total = context.tokens.len() as f64;
        for (pid, (sum_cnt, matches_cnt)) in token_stats {
            if !is_project_active_cached(&conn, &mut active_project_cache, pid) {
                continue;
            }
            let avg_log =
                (1.0 + (sum_cnt / matches_cnt.max(1.0))).ln() * (matches_cnt / token_total);
            let score = 0.30 * avg_log;
            *layer3.entry(pid).or_insert(0.0) += score;
            *candidate_evidence.entry(pid).or_insert(0) += 1;
        }
    }

    // Collect all candidate project IDs
    let mut all_pids: HashSet<i64> = HashSet::new();
    all_pids.extend(layer0.keys());
    all_pids.extend(layer1.keys());
    all_pids.extend(layer2.keys());
    all_pids.extend(layer3.keys());

    let mut candidates: Vec<CandidateScore> = Vec::new();
    for pid in all_pids {
        let l0 = *layer0.get(&pid).unwrap_or(&0.0);
        let l1 = *layer1.get(&pid).unwrap_or(&0.0);
        let l2 = *layer2.get(&pid).unwrap_or(&0.0);
        let l3 = *layer3.get(&pid).unwrap_or(&0.0);
        let total = l0 + l1 + l2 + l3;
        let evidence = *candidate_evidence.get(&pid).unwrap_or(&0);

        let project_name: String = conn
            .query_row(
                "SELECT name FROM projects WHERE id = ?1",
                rusqlite::params![pid],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| format!("#{}", pid));

        candidates.push(CandidateScore {
            project_id: pid,
            project_name,
            layer0_file_score: (l0 * 1000.0).round() / 1000.0,
            layer1_app_score: (l1 * 1000.0).round() / 1000.0,
            layer2_time_score: (l2 * 1000.0).round() / 1000.0,
            layer3_token_score: (l3 * 1000.0).round() / 1000.0,
            total_score: (total * 1000.0).round() / 1000.0,
            evidence_count: evidence,
        });
    }

    candidates.sort_by(|a, b| {
        b.total_score
            .partial_cmp(&a.total_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.project_id.cmp(&b.project_id))
    });

    let final_suggestion = compute_raw_suggestion(&conn, &context)?;

    Ok(ScoreBreakdown {
        candidates,
        final_suggestion,
        has_manual_override: manual_override_pid.is_some(),
        manual_override_project_id: manual_override_pid,
    })
}

/// Get the current feedback weight setting.
#[command]
pub async fn get_feedback_weight(app: AppHandle) -> Result<f64, String> {
    let conn = db::get_connection(&app)?;
    let state = load_state_map(&conn)?;
    Ok(parse_state_f64(
        &state,
        "feedback_weight",
        DEFAULT_FEEDBACK_WEIGHT,
    ))
}

/// Set the feedback weight (how much manual corrections influence the model).
#[command]
pub async fn set_feedback_weight(app: AppHandle, weight: f64) -> Result<(), String> {
    if !weight.is_finite() || !(1.0..=50.0).contains(&weight) {
        return Err("Feedback weight must be between 1.0 and 50.0".to_string());
    }
    let conn = db::get_connection(&app)?;
    upsert_state(&conn, "feedback_weight", &format!("{:.1}", weight))
}
