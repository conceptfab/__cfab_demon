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

