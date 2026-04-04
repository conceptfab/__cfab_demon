// Moduł storage — trwały zapis dziennych snapshotów w SQLite
// Legacy JSON pozostaje tylko jako źródło migracji/fallback dla starszych instalacji.

use anyhow::Result;
use chrono::{Local, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::config;

const MAX_FILE_ENTRY_NAME_CHARS: usize = 260;
const MAX_WINDOW_TITLE_CHARS: usize = 240;
const MAX_DETECTED_PATH_CHARS: usize = 512;
const MAX_TITLE_HISTORY_ENTRY_CHARS: usize = 180;
const MAX_TITLE_HISTORY_LEN: usize = 12;

/// Sesja ciągłej pracy — alias na typ ze shared crate.
pub type Session = crate::daily_store::StoredSession;
/// Wpis o pliku/projekcie — alias na typ ze shared crate.
pub type FileEntry = crate::daily_store::StoredFileEntry;

/// Dane dzienne — jeden plik na dzień
#[derive(Serialize, Deserialize, Debug)]
pub struct DailyData {
    pub date: String,
    pub generated_at: String,
    pub apps: HashMap<String, AppDailyData>,
    pub summary: DailySummary,
}

/// Dane dzienne dla jednej aplikacji
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AppDailyData {
    pub display_name: String,
    pub total_seconds: u64,
    pub total_time_formatted: String,
    pub sessions: Vec<Session>,
    pub files: Vec<FileEntry>,
}

/// Podsumowanie dnia
#[derive(Serialize, Deserialize, Debug)]
pub struct DailySummary {
    pub total_app_seconds: u64,
    pub total_app_formatted: String,
    pub apps_active_count: usize,
}

fn truncate_middle(value: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }

    // Fast path: avoid allocation when string fits within limit (most common case)
    if value.chars().count() <= max_chars {
        return value.to_string();
    }

    let chars: Vec<char> = value.chars().collect();

    if max_chars <= 3 {
        return chars.into_iter().take(max_chars).collect();
    }

    let head_len = (max_chars - 3) / 2;
    let tail_len = max_chars - 3 - head_len;
    let head: String = chars.iter().take(head_len).copied().collect();
    let tail: String = chars.iter().skip(chars.len() - tail_len).copied().collect();
    format!("{}...{}", head, tail)
}

fn sanitize_text(value: &str, max_chars: usize) -> String {
    truncate_middle(value.trim(), max_chars)
}

pub(crate) fn sanitize_file_entry_name(value: &str) -> String {
    sanitize_text(value, MAX_FILE_ENTRY_NAME_CHARS)
}

pub(crate) fn sanitize_window_title(value: &str) -> String {
    sanitize_text(value, MAX_WINDOW_TITLE_CHARS)
}

pub(crate) fn sanitize_detected_path(value: &str) -> String {
    sanitize_text(value, MAX_DETECTED_PATH_CHARS)
}

pub(crate) fn sanitize_title_history_entry(value: &str) -> String {
    sanitize_text(value, MAX_TITLE_HISTORY_ENTRY_CHARS)
}

pub(crate) fn prepare_daily_for_storage(data: &mut DailyData) {
    for app_data in data.apps.values_mut() {
        for file_entry in &mut app_data.files {
            file_entry.name = sanitize_file_entry_name(&file_entry.name);
            file_entry.window_title = sanitize_window_title(&file_entry.window_title);
            file_entry.detected_path = file_entry
                .detected_path
                .as_deref()
                .map(sanitize_detected_path)
                .filter(|value| !value.is_empty());

            let mut normalized_history = Vec::new();
            for title in &file_entry.title_history {
                let sanitized = sanitize_title_history_entry(title);
                if sanitized.is_empty()
                    || normalized_history.iter().any(|entry| entry == &sanitized)
                {
                    continue;
                }
                normalized_history.push(sanitized);
            }
            if normalized_history.len() > MAX_TITLE_HISTORY_LEN {
                let drain_count = normalized_history.len() - MAX_TITLE_HISTORY_LEN;
                normalized_history.drain(0..drain_count);
            }
            file_entry.title_history = normalized_history;
        }
    }
}

fn open_daily_store() -> Result<rusqlite::Connection> {
    let base_dir = config::config_dir()?;
    crate::daily_store::open_store(&base_dir).map_err(anyhow::Error::msg)
}

fn to_stored_daily(data: &DailyData) -> crate::daily_store::StoredDailyData {
    crate::daily_store::StoredDailyData {
        date: data.date.clone(),
        generated_at: data.generated_at.clone(),
        apps: data
            .apps
            .iter()
            .map(|(exe_name, app_data)| {
                (
                    exe_name.clone(),
                    crate::daily_store::StoredAppDailyData {
                        display_name: app_data.display_name.clone(),
                        total_seconds: app_data.total_seconds,
                        sessions: app_data.sessions.clone(),
                        files: app_data.files.clone(),
                    },
                )
            })
            .collect(),
    }
}

fn from_stored_daily(data: crate::daily_store::StoredDailyData) -> DailyData {
    let mut daily = DailyData {
        date: data.date,
        generated_at: data.generated_at,
        apps: data
            .apps
            .into_iter()
            .map(|(exe_name, app_data)| {
                (
                    exe_name,
                    AppDailyData {
                        display_name: app_data.display_name,
                        total_seconds: app_data.total_seconds,
                        total_time_formatted: String::new(),
                        sessions: app_data.sessions,
                        files: app_data.files,
                    },
                )
            })
            .collect(),
        summary: DailySummary {
            total_app_seconds: 0,
            total_app_formatted: String::new(),
            apps_active_count: 0,
        },
    };
    update_summary(&mut daily);
    daily
}

/// Ładuje dane dzienne (lub tworzy pustą strukturę)
pub fn load_daily(date: NaiveDate) -> DailyData {
    let date_str = date.format("%Y-%m-%d").to_string();

    match open_daily_store() {
        Ok(conn) => match crate::daily_store::load_day_snapshot(&conn, &date_str) {
            Ok(Some(snapshot)) => return from_stored_daily(snapshot),
            Ok(None) => {}
            Err(e) => {
                log::warn!("Error loading daily snapshot from SQLite store: {}", e);
            }
        },
        Err(e) => {
            log::warn!("Cannot open SQLite daily store: {}", e);
        }
    }

    empty_daily(date)
}

/// Ładuje dane na dzisiaj
pub fn load_today() -> DailyData {
    load_daily(Local::now().date_naive())
}

/// Zapisuje dane dzienne w SQLite daily store.
pub fn save_daily(data: &mut DailyData) -> Result<()> {
    // Aktualizuj timestamp i podsumowanie
    data.generated_at = Local::now().to_rfc3339();
    prepare_daily_for_storage(data);
    update_summary(data);
    let mut conn = open_daily_store()?;
    crate::daily_store::replace_day_snapshot(&mut conn, &to_stored_daily(data))
        .map(|_| ())
        .map_err(anyhow::Error::msg)
}

/// Tworzy pustą strukturę dzienną
fn empty_daily(date: NaiveDate) -> DailyData {
    DailyData {
        date: date.format("%Y-%m-%d").to_string(),
        generated_at: Local::now().to_rfc3339(),
        apps: HashMap::new(),
        summary: DailySummary {
            total_app_seconds: 0,
            total_app_formatted: "0h 0m 0s".to_string(),
            apps_active_count: 0,
        },
    }
}

/// Aktualizuje podsumowanie na podstawie danych aplikacji
fn update_summary(data: &mut DailyData) {
    let mut total_seconds = 0u64;

    for app_data in data.apps.values_mut() {
        // Przelicz total_time_formatted
        app_data.total_time_formatted = format_duration(app_data.total_seconds);
        total_seconds += app_data.total_seconds;
    }

    data.summary.total_app_seconds = total_seconds;
    data.summary.total_app_formatted = format_duration(total_seconds);
    data.summary.apps_active_count = data.apps.len();
}

/// Formatuje sekundy jako "Xh Ym Zs"
pub(crate) fn format_duration(seconds: u64) -> String {
    let h = seconds / 3600;
    let m = (seconds % 3600) / 60;
    let s = seconds % 60;
    format!("{}h {}m {}s", h, m, s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_middle_preserves_prefix_and_suffix() {
        let value = truncate_middle("abcdefghijklmnop", 9);
        assert_eq!(value, "abc...nop");
    }

    #[test]
    fn prepare_daily_for_storage_prunes_text_fields() {
        let mut data = DailyData {
            date: "2026-03-08".to_string(),
            generated_at: String::new(),
            apps: HashMap::from([(
                "code.exe".to_string(),
                AppDailyData {
                    display_name: "VS Code".to_string(),
                    total_seconds: 10,
                    total_time_formatted: String::new(),
                    sessions: vec![Session {
                        start: "2026-03-08T10:00:00Z".to_string(),
                        end: "2026-03-08T10:00:10Z".to_string(),
                        duration_seconds: 10,
                    }],
                    files: vec![FileEntry {
                        name: "a".repeat(400),
                        total_seconds: 10,
                        first_seen: "2026-03-08T10:00:00Z".to_string(),
                        last_seen: "2026-03-08T10:00:10Z".to_string(),
                        window_title: "b".repeat(400),
                        detected_path: Some("c".repeat(700)),
                        title_history: vec![
                            " same ".to_string(),
                            "same".to_string(),
                            "d".repeat(400),
                            "e".repeat(400),
                            "f".repeat(400),
                            "g".repeat(400),
                            "h".repeat(400),
                            "i".repeat(400),
                            "j".repeat(400),
                            "k".repeat(400),
                            "l".repeat(400),
                            "m".repeat(400),
                            "n".repeat(400),
                        ],
                        activity_type: Some("coding".to_string()),
                    }],
                },
            )]),
            summary: DailySummary {
                total_app_seconds: 0,
                total_app_formatted: String::new(),
                apps_active_count: 0,
            },
        };

        prepare_daily_for_storage(&mut data);

        let file_entry = &data.apps["code.exe"].files[0];
        assert!(file_entry.name.chars().count() <= MAX_FILE_ENTRY_NAME_CHARS);
        assert!(file_entry.window_title.chars().count() <= MAX_WINDOW_TITLE_CHARS);
        assert!(
            file_entry
                .detected_path
                .as_ref()
                .expect("detected_path should be present")
                .chars()
                .count()
                <= MAX_DETECTED_PATH_CHARS
        );
        assert_eq!(file_entry.title_history.len(), MAX_TITLE_HISTORY_LEN);
        assert_eq!(file_entry.title_history[0], "same");
        assert!(file_entry
            .title_history
            .iter()
            .all(|entry| entry.chars().count() <= MAX_TITLE_HISTORY_ENTRY_CHARS));
    }
}
