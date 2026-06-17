use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredDailyData {
    pub date: String,
    #[serde(default)]
    pub generated_at: String,
    #[serde(default)]
    pub apps: BTreeMap<String, StoredAppDailyData>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredAppDailyData {
    pub display_name: String,
    pub total_seconds: u64,
    #[serde(default)]
    pub sessions: Vec<StoredSession>,
    #[serde(default)]
    pub files: Vec<StoredFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredSession {
    pub start: String,
    pub end: String,
    pub duration_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredFileEntry {
    pub name: String,
    pub total_seconds: u64,
    pub first_seen: String,
    pub last_seen: String,
    #[serde(default)]
    pub window_title: String,
    #[serde(default)]
    pub detected_path: Option<String>,
    #[serde(default)]
    pub title_history: Vec<String>,
    #[serde(default)]
    pub activity_type: Option<String>,
    #[serde(default)]
    pub activity_spans: Vec<(String, String)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DaySignature {
    pub updated_unix_ms: u64,
    pub revision: u64,
}

pub(crate) fn dedupe_files_preserving_last(files: &[StoredFileEntry]) -> Vec<&StoredFileEntry> {
    let mut seen = BTreeSet::new();
    let mut deduped = Vec::with_capacity(files.len());
    for file in files.iter().rev() {
        if seen.insert((
            file.name.clone(),
            detected_path_key(file.detected_path.as_deref()).to_string(),
        )) {
            deduped.push(file);
        }
    }
    deduped.reverse();
    deduped
}

pub(crate) fn detected_path_key(value: Option<&str>) -> &str {
    value.unwrap_or("")
}

pub(crate) fn decode_detected_path(value: String) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

const SPAN_MERGE_GAP_SECS: i64 = 30;
const MAX_SPANS_PER_FILE: usize = 100;

fn parse_rfc3339(s: &str) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    chrono::DateTime::parse_from_rfc3339(s).ok()
}

fn rfc3339_diff_secs(a: &str, b: &str) -> i64 {
    match (parse_rfc3339(a), parse_rfc3339(b)) {
        (Some(da), Some(db)) => da.signed_duration_since(db).num_seconds(),
        _ => i64::MAX,
    }
}

/// Extend spans with a new interval, merging adjacent spans (gap < 30s).
/// Caps at MAX_SPANS_PER_FILE by merging the two shortest-gap neighbors.
pub fn extend_activity_spans(
    spans: &[(String, String)],
    new_start: &str,
    new_end: &str,
) -> Vec<(String, String)> {
    let mut result: Vec<(String, String)> = spans.to_vec();
    result.push((new_start.to_string(), new_end.to_string()));
    result.sort_by(|a, b| a.0.cmp(&b.0));

    let mut merged: Vec<(String, String)> = Vec::with_capacity(result.len());
    for span in result {
        if let Some(last) = merged.last_mut() {
            if rfc3339_diff_secs(&span.0, &last.1) <= SPAN_MERGE_GAP_SECS {
                if span.1 > last.1 {
                    last.1 = span.1;
                }
                continue;
            }
        }
        merged.push(span);
    }

    while merged.len() > MAX_SPANS_PER_FILE {
        let mut min_gap = i64::MAX;
        let mut min_idx = 0;
        for i in 0..merged.len() - 1 {
            let gap = rfc3339_diff_secs(&merged[i + 1].0, &merged[i].1);
            if gap < min_gap {
                min_gap = gap;
                min_idx = i;
            }
        }
        let next_end = merged[min_idx + 1].1.clone();
        if next_end > merged[min_idx].1 {
            merged[min_idx].1 = next_end;
        }
        merged.remove(min_idx + 1);
    }

    merged
}
