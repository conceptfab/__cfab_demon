use chrono::{Datelike, Timelike};
use rusqlite::{OptionalExtension, ToSql};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use tauri::{command, AppHandle};

use super::types::DateRange;
use crate::db;

const DEFAULT_MODE: &str = "suggest";
const DEFAULT_MIN_CONFIDENCE_SUGGEST: f64 = 0.60;
const DEFAULT_MIN_CONFIDENCE_AUTO: f64 = 0.85;
const DEFAULT_MIN_EVIDENCE_AUTO: i64 = 3;
const AUTO_SAFE_MIN_MARGIN: f64 = 0.20;

#[derive(Debug, Serialize, Deserialize)]
pub struct AssignmentModelStatus {
    pub mode: String,
    pub min_confidence_suggest: f64,
    pub min_confidence_auto: f64,
    pub min_evidence_auto: i64,
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

#[derive(Debug)]
struct SessionContext {
    app_id: i64,
    hour_bucket: i64,
    weekday: i64,
    tokens: Vec<String>,
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
    for row in rows.flatten() {
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

fn parse_timestamp(value: &str) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(value) {
        return Some(dt);
    }

    if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S") {
        let offset = chrono::FixedOffset::east_opt(0)?;
        return Some(chrono::DateTime::from_naive_utc_and_offset(ndt, offset));
    }

    if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S") {
        let offset = chrono::FixedOffset::east_opt(0)?;
        return Some(chrono::DateTime::from_naive_utc_and_offset(ndt, offset));
    }

    if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S.%f") {
        let offset = chrono::FixedOffset::east_opt(0)?;
        return Some(chrono::DateTime::from_naive_utc_and_offset(ndt, offset));
    }

    if let Ok(ndt) = chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S.%f") {
        let offset = chrono::FixedOffset::east_opt(0)?;
        return Some(chrono::DateTime::from_naive_utc_and_offset(ndt, offset));
    }

    None
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
            "SELECT app_id, date, start_time FROM sessions WHERE id = ?1",
            rusqlite::params![session_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some((app_id, date, start_time)) = session else {
        return Ok(None);
    };

    let mut file_stmt = conn
        .prepare("SELECT file_name FROM file_activities WHERE app_id = ?1 AND date = ?2")
        .map_err(|e| e.to_string())?;
    let mut file_rows = file_stmt
        .query(rusqlite::params![app_id, date])
        .map_err(|e| e.to_string())?;
    let mut uniq_tokens = HashSet::new();
    let mut tokens = Vec::new();
    while let Some(row) = file_rows.next().map_err(|e| e.to_string())? {
        let file_name: String = row.get(0).map_err(|e| e.to_string())?;
        for token in tokenize(&file_name) {
            if uniq_tokens.insert(token.clone()) {
                tokens.push(token);
            }
        }
    }

    let (hour_bucket, weekday) = extract_hour_weekday(&start_time);
    Ok(Some(SessionContext {
        app_id,
        hour_bucket,
        weekday,
        tokens,
    }))
}

fn compute_raw_suggestion(
    conn: &rusqlite::Connection,
    context: &SessionContext,
) -> Result<Option<ProjectSuggestion>, String> {
    let mut candidate_scores: HashMap<i64, f64> = HashMap::new();
    let mut candidate_evidence: HashMap<i64, i64> = HashMap::new();

    let mut app_stmt = conn
        .prepare("SELECT project_id, cnt FROM assignment_model_app WHERE app_id = ?1")
        .map_err(|e| e.to_string())?;
    let mut app_rows = app_stmt
        .query(rusqlite::params![context.app_id])
        .map_err(|e| e.to_string())?;
    while let Some(row) = app_rows.next().map_err(|e| e.to_string())? {
        let project_id: i64 = row.get(0).map_err(|e| e.to_string())?;
        let cnt = row.get::<_, i64>(1).map_err(|e| e.to_string())? as f64;
        let score = 0.50 * (1.0 + cnt).ln();
        *candidate_scores.entry(project_id).or_insert(0.0) += score;
        *candidate_evidence.entry(project_id).or_insert(0) += 1;
    }

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
        let cnt = row.get::<_, i64>(1).map_err(|e| e.to_string())? as f64;
        let score = 0.15 * (1.0 + cnt).ln();
        *candidate_scores.entry(project_id).or_insert(0.0) += score;
        *candidate_evidence.entry(project_id).or_insert(0) += 1;
    }

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
            let avg_log =
                (1.0 + (sum_cnt / matches_cnt.max(1.0))).ln() * (matches_cnt / token_total);
            let score = 0.30 * avg_log;
            *candidate_scores.entry(project_id).or_insert(0.0) += score;
            *candidate_evidence.entry(project_id).or_insert(0) += 1;
        }
    }

    if candidate_scores.is_empty() {
        return Ok(None);
    }

    let mut sorted = candidate_scores.into_iter().collect::<Vec<_>>();
    sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal));
    let Some((best_project_id, best_score)) = sorted.first().copied() else {
        return Ok(None);
    };

    let second_score = sorted.get(1).map(|(_, s)| *s).unwrap_or(0.0);
    let margin = (best_score - second_score).max(0.0);
    let evidence_count = *candidate_evidence.get(&best_project_id).unwrap_or(&1);
    let evidence_factor = ((evidence_count as f64) / 3.0).min(1.0);
    let sigmoid_margin = 1.0 / (1.0 + (-margin).exp());
    let confidence = sigmoid_margin * evidence_factor;

    Ok(Some(ProjectSuggestion {
        project_id: best_project_id,
        confidence,
        evidence_count,
        margin,
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
    Ok(rows.flatten().collect())
}

#[command]
pub async fn get_assignment_model_status(app: AppHandle) -> Result<AssignmentModelStatus, String> {
    let conn = db::get_connection(&app)?;
    let state = load_state_map(&conn)?;

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
    upsert_state(&conn, "is_training", "true")?;
    let start_time = std::time::Instant::now();

    let result = (|| -> rusqlite::Result<i64> {
        let tx = conn.unchecked_transaction()?;

        tx.execute_batch(
            "
            DELETE FROM assignment_model_app;
            DELETE FROM assignment_model_time;
            DELETE FROM assignment_model_token;

            INSERT INTO assignment_model_app (app_id, project_id, cnt, last_seen)
            SELECT app_id, project_id, COUNT(*) as cnt, MAX(start_time)
            FROM sessions
            WHERE project_id IS NOT NULL AND duration_seconds > 10
            GROUP BY app_id, project_id;

            INSERT INTO assignment_model_time (app_id, hour_bucket, weekday, project_id, cnt)
            SELECT
                app_id,
                CAST(strftime('%H', start_time) AS INTEGER) as hour_bucket,
                CAST(strftime('%w', start_time) AS INTEGER) as weekday,
                project_id,
                COUNT(*) as cnt
            FROM sessions
            WHERE project_id IS NOT NULL AND duration_seconds > 10
            GROUP BY app_id, hour_bucket, weekday, project_id;
            ",
        )?;

        let mut token_counts: HashMap<(String, i64), i64> = HashMap::new();
        {
            let mut file_stmt = tx.prepare(
                "SELECT file_name, project_id FROM file_activities WHERE project_id IS NOT NULL",
            )?;
            let mut file_rows = file_stmt.query([])?;
            while let Some(row) = file_rows.next()? {
                let file_name: String = row.get(0)?;
                let project_id: i64 = row.get(1)?;
                for token in tokenize(&file_name) {
                    *token_counts.entry((token, project_id)).or_insert(0) += 1;
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
    let _ = upsert_state(&conn, "is_training", "false");

    match result {
        Ok(total_samples) => {
            upsert_state(&conn, "last_train_at", &chrono::Local::now().to_rfc3339())?;
            upsert_state(&conn, "feedback_since_train", "0")?;
            upsert_state(&conn, "last_train_duration_ms", &duration_ms.to_string())?;
            upsert_state(&conn, "last_train_samples", &total_samples.to_string())?;
            let _ = conn.execute(
                "DELETE FROM assignment_model_state WHERE key = 'train_error_last'",
                [],
            );
            let _ = conn.execute(
                "DELETE FROM assignment_model_state WHERE key = 'cooldown_until'",
                [],
            );
            get_assignment_model_status(app).await
        }
        Err(e) => {
            upsert_state(&conn, "train_error_last", &e.to_string()).ok();
            Err(format!("Model training failed: {}", e))
        }
    }
}

pub async fn suggest_project_for_session(
    app: AppHandle,
    session_id: i64,
) -> Result<Option<ProjectSuggestion>, String> {
    let status = get_assignment_model_status(app.clone()).await?;
    if status.mode == "off" {
        return Ok(None);
    }

    let conn = db::get_connection(&app)?;
    let Some(context) = build_session_context(&conn, session_id)? else {
        return Ok(None);
    };
    let Some(suggestion) = compute_raw_suggestion(&conn, &context)? else {
        return Ok(None);
    };

    let accepted = if status.mode == "auto_safe" {
        meets_auto_safe_threshold(&status, &suggestion)
    } else {
        meets_suggest_threshold(&status, &suggestion)
    };

    if accepted {
        Ok(Some(suggestion))
    } else {
        Ok(None)
    }
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
        if result.assigned > 0 {
            increment_feedback_counter(&tx);
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
        rows.filter_map(|r| r.ok()).collect()
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
            rows.filter_map(|r| r.ok()).collect()
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
