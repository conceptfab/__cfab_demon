use std::collections::{HashMap, HashSet};

pub const DEFAULT_MODE: &str = "suggest";
pub const DEFAULT_MIN_CONFIDENCE_SUGGEST: f64 = 0.60;
pub const DEFAULT_MIN_CONFIDENCE_AUTO: f64 = 0.85;
pub const DEFAULT_MIN_EVIDENCE_AUTO: i64 = 3;
pub const AUTO_SAFE_MIN_MARGIN: f64 = 0.20;
pub const DEFAULT_FEEDBACK_WEIGHT: f64 = 5.0;
pub const MIN_TRAINING_HORIZON_DAYS: i64 = 30;
pub const MAX_TRAINING_HORIZON_DAYS: i64 = 730;
pub const DEFAULT_TRAINING_HORIZON_DAYS: i64 = 730;

pub fn parse_state_f64(state: &HashMap<String, String>, key: &str, default: f64) -> f64 {
    state
        .get(key)
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(default)
}

pub fn parse_state_i64(state: &HashMap<String, String>, key: &str, default: i64) -> i64 {
    state
        .get(key)
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(default)
}

pub fn parse_state_bool(state: &HashMap<String, String>, key: &str, default: bool) -> bool {
    state.get(key).map(|v| v == "true").unwrap_or(default)
}

pub fn parse_state_opt_string(state: &HashMap<String, String>, key: &str) -> Option<String> {
    state
        .get(key)
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string())
}

pub fn parse_state_string_list(state: &HashMap<String, String>, key: &str) -> Vec<String> {
    state
        .get(key)
        .and_then(|v| serde_json::from_str::<Vec<String>>(v).ok())
        .unwrap_or_default()
}

pub fn normalize_blacklist_app(raw: &str) -> Option<String> {
    let normalized = raw.trim().to_lowercase();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

pub fn normalize_blacklist_folder(raw: &str) -> Option<String> {
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

pub fn normalize_blacklist_entries(values: &[String], folder_mode: bool) -> Vec<String> {
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

pub fn upsert_state(conn: &rusqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO assignment_model_state (key, value, updated_at)
         VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_state_map(conn: &rusqlite::Connection) -> Result<HashMap<String, String>, String> {
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

pub fn normalize_mode(mode: &str) -> String {
    match mode {
        "off" | "suggest" | "auto_safe" => mode.to_string(),
        _ => DEFAULT_MODE.to_string(),
    }
}

pub fn clamp01(value: f64, default: f64) -> f64 {
    if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        default
    }
}

pub fn clamp_i64(value: i64, min: i64, max: i64) -> i64 {
    value.max(min).min(max)
}

pub fn ratio_or_zero(numerator: i64, denominator: i64) -> f64 {
    if denominator <= 0 {
        0.0
    } else {
        numerator as f64 / denominator as f64
    }
}

pub fn increment_feedback_counter(conn: &rusqlite::Connection) {
    let _ = conn.execute(
        "INSERT INTO assignment_model_state (key, value, updated_at)
         VALUES ('feedback_since_train', '1', datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
           value = CAST(COALESCE(NULLIF(assignment_model_state.value, ''), '0') AS INTEGER) + 1,
           updated_at = datetime('now')",
        [],
    );
}

pub fn is_project_active(conn: &rusqlite::Connection, project_id: i64) -> bool {
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

pub fn is_project_active_cached(
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
