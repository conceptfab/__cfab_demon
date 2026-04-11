use chrono::{Datelike, Timelike};
use rusqlite::OptionalExtension;
use std::collections::{HashMap, HashSet};

use crate::commands::datetime::parse_datetime_fixed;
use crate::commands::projects::{infer_project_from_path_pub, load_project_folders_from_db};

#[derive(Debug)]
pub struct SessionContext {
    pub app_id: i64,
    pub hour_bucket: i64,
    pub weekday: i64,
    pub tokens: Vec<String>,
    /// project_ids with their overlap weight (0.0..1.0) relative to session duration
    pub file_project_weights: HashMap<i64, f64>,
}

/// Tokens considered too common to carry project-discriminating signal.
const STOP_TOKENS: &[&str] = &[
    // filesystem / code structure
    "src", "lib", "app", "bin", "pkg", "cmd", "api", "dist", "build", "out",
    "node_modules", "vendor", "target", "debug", "release",
    "index", "main", "mod", "init", "setup", "config", "utils", "helpers",
    "test", "tests", "spec", "specs", "bench",
    "tmp", "temp", "cache", "log", "logs",
    // common file extensions leaked as tokens
    "rs", "ts", "js", "tsx", "jsx", "py", "go", "css", "html", "json", "toml", "yaml", "yml",
    "md", "txt", "xml", "svg", "png", "jpg",
    // English function words
    "the", "and", "for", "with", "from", "into", "that", "this", "not", "but",
    "all", "are", "was", "were", "been", "have", "has", "had", "will", "would",
    "new", "old", "get", "set", "add", "del", "run", "use",
    // common IDE / UI labels
    "file", "edit", "view", "window", "help", "tools", "terminal", "output",
    "untitled", "welcome", "settings", "preferences",
];

pub fn tokenize(text: &str) -> Vec<String> {
    let separators = [
        ' ', '-', '_', '.', '/', '\\', '|', ',', ':', ';', '(', ')', '[', ']', '{', '}',
    ];
    let raw_tokens: Vec<String> = text
        .to_lowercase()
        .split(&separators[..])
        .filter(|t| t.len() >= 2 && t.chars().any(|c| c.is_alphabetic()))
        .filter(|t| !STOP_TOKENS.contains(t))
        .map(|t| t.to_string())
        .collect();

    // Generate bigrams from consecutive tokens for compound names
    // e.g. ["user", "service"] → also produces "user~service"
    let mut result = raw_tokens.clone();
    for window in raw_tokens.windows(2) {
        let bigram = format!("{}~{}", window[0], window[1]);
        result.push(bigram);
    }
    result
}

pub fn parse_title_history(raw: Option<&str>) -> Vec<String> {
    raw.and_then(|value| serde_json::from_str::<Vec<String>>(value).ok())
        .unwrap_or_default()
}

pub fn normalize_path_for_compare(raw: &str) -> String {
    let mut normalized = raw.trim().replace('\\', "/").to_lowercase();
    while normalized.ends_with('/') {
        normalized.pop();
    }
    normalized
}

pub fn is_under_blacklisted_folder(
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

pub fn app_matches_blacklist_rule(exe_name: &str, rule: &str) -> bool {
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

pub fn resolve_blacklisted_app_ids(
    conn: &rusqlite::Connection,
    app_blacklist: &[String],
) -> Result<HashSet<i64>, String> {
    if app_blacklist.is_empty() {
        return Ok(HashSet::new());
    }

    let mut stmt = conn
        .prepare_cached("SELECT id, lower(executable_name) FROM applications")
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

pub fn parse_timestamp(value: &str) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    parse_datetime_fixed(value)
}

pub fn extract_hour_weekday(start_time: &str) -> (i64, i64) {
    if let Some(dt) = parse_timestamp(start_time) {
        let hour = i64::from(dt.hour());
        let weekday = i64::from(dt.weekday().num_days_from_sunday());
        return (hour, weekday);
    }
    (12, 0)
}

/// Resolves a project name (from path inference) to project_id.
/// Returns None if no active project with that name exists.
fn resolve_project_id_by_name(conn: &rusqlite::Connection, name: &str) -> Option<i64> {
    conn.query_row(
        "SELECT id FROM projects WHERE lower(name) = lower(?1) AND excluded_at IS NULL AND frozen_at IS NULL LIMIT 1",
        rusqlite::params![name],
        |row| row.get(0),
    )
    .ok()
}

pub fn build_session_context(
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

    let project_roots = load_project_folders_from_db(conn).unwrap_or_default();

    // Filter file_activities to only those overlapping with the session time window
    let mut file_stmt = conn
        .prepare_cached(
            "SELECT file_name, file_path, detected_path, project_id, window_title, title_history,
                    activity_spans, first_seen, last_seen
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
    let mut file_project_overlap: HashMap<i64, f64> = HashMap::new();

    let session_start_ts = parse_timestamp(&start_time);
    let session_end_ts = parse_timestamp(&end_time);
    let session_duration_secs = session_start_ts
        .zip(session_end_ts)
        .map(|(s, e)| (e - s).num_seconds().max(1) as f64)
        .unwrap_or(1.0);

    while let Some(row) = file_rows.next().map_err(|e| e.to_string())? {
        let file_name: String = row.get(0).map_err(|e| e.to_string())?;
        let file_path: String = row.get(1).map_err(|e| e.to_string())?;
        let detected_path: Option<String> = row.get(2).map_err(|e| e.to_string())?;
        let project_id: Option<i64> = row.get(3).map_err(|e| e.to_string())?;
        let window_title: Option<String> = row.get(4).map_err(|e| e.to_string())?;
        let title_history: Option<String> = row.get(5).map_err(|e| e.to_string())?;
        let activity_spans_json: String = row.get::<_, String>(6).unwrap_or_else(|_| "[]".to_string());
        let activity_spans: Vec<(String, String)> =
            serde_json::from_str(&activity_spans_json).unwrap_or_default();
        let file_first_seen: String = row.get(7).map_err(|e| e.to_string())?;
        let file_last_seen: String = row.get(8).map_err(|e| e.to_string())?;

        // If spans exist, verify at least one overlaps with the session window
        if !activity_spans.is_empty() {
            let has_overlap = activity_spans.iter().any(|(s, e)| {
                if let (Some(span_s), Some(span_e)) = (parse_timestamp(s), parse_timestamp(e)) {
                    if let (Some(ss), Some(se)) = (parse_timestamp(&start_time), parse_timestamp(&end_time)) {
                        span_s < se && span_e > ss
                    } else {
                        true
                    }
                } else {
                    true // unparseable → keep for safety
                }
            });
            if !has_overlap {
                continue; // skip this file — no span actually overlaps
            }
        }

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
        // Compute overlap weight for this file entry
        let overlap = if let (Some(ss), Some(se), Some(fs), Some(fe)) = (
            session_start_ts,
            session_end_ts,
            parse_timestamp(&file_first_seen),
            parse_timestamp(&file_last_seen),
        ) {
            let overlap_start = ss.max(fs);
            let overlap_end = se.min(fe);
            let overlap_secs = (overlap_end - overlap_start).num_seconds().max(0) as f64;
            (overlap_secs / session_duration_secs).clamp(0.05, 1.0)
        } else {
            1.0
        };

        if let Some(pid) = project_id {
            let entry = file_project_overlap.entry(pid).or_insert(0.0);
            *entry = (*entry).max(overlap);
        } else if !project_roots.is_empty() {
            // Path-based inference: try detected_path first, then file_path
            let inferred_name = detected_path
                .as_deref()
                .and_then(|p| infer_project_from_path_pub(p, &project_roots))
                .or_else(|| {
                    let fp = file_path.as_str();
                    if fp.is_empty() || fp == "(unknown)" {
                        None
                    } else {
                        infer_project_from_path_pub(fp, &project_roots)
                    }
                });
            if let Some(ref name) = inferred_name {
                if let Some(pid) = resolve_project_id_by_name(conn, name) {
                    let entry = file_project_overlap.entry(pid).or_insert(0.0);
                    *entry = (*entry).max(overlap);
                }
            }
        }
    }

    let (hour_bucket, weekday) = extract_hour_weekday(&start_time);
    Ok(Some(SessionContext {
        app_id,
        hour_bucket,
        weekday,
        tokens,
        file_project_weights: file_project_overlap,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_filters_stop_words() {
        let tokens = tokenize("src/app/user_service.rs");
        assert!(!tokens.contains(&"src".to_string()));
        assert!(!tokens.contains(&"app".to_string()));
        assert!(!tokens.contains(&"rs".to_string()));
        assert!(tokens.contains(&"user".to_string()));
        assert!(tokens.contains(&"service".to_string()));
    }

    #[test]
    fn tokenize_generates_bigrams() {
        let tokens = tokenize("user-service");
        assert!(tokens.contains(&"user".to_string()));
        assert!(tokens.contains(&"service".to_string()));
        assert!(tokens.contains(&"user~service".to_string()));
    }

    #[test]
    fn tokenize_no_bigram_for_single_token() {
        let tokens = tokenize("dashboard");
        assert!(tokens.contains(&"dashboard".to_string()));
        assert_eq!(tokens.len(), 1);
    }

    #[test]
    fn tokenize_handles_empty_and_short() {
        assert!(tokenize("").is_empty());
        assert!(tokenize("a").is_empty()); // too short
    }

    #[test]
    fn resolve_project_id_by_name_finds_active() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, excluded_at TEXT, frozen_at TEXT);
             INSERT INTO projects (id, name, excluded_at, frozen_at) VALUES (1, 'Alpha', NULL, NULL);
             INSERT INTO projects (id, name, excluded_at, frozen_at) VALUES (2, 'Beta', '2024-01-01', NULL);
             INSERT INTO projects (id, name, excluded_at, frozen_at) VALUES (3, 'Gamma', NULL, '2024-01-01');",
        ).unwrap();

        assert_eq!(super::resolve_project_id_by_name(&conn, "Alpha"), Some(1));
        assert_eq!(super::resolve_project_id_by_name(&conn, "alpha"), Some(1)); // case-insensitive
        assert_eq!(super::resolve_project_id_by_name(&conn, "Beta"), None); // excluded
        assert_eq!(super::resolve_project_id_by_name(&conn, "Gamma"), None); // frozen
        assert_eq!(super::resolve_project_id_by_name(&conn, "Nope"), None);
    }
}
