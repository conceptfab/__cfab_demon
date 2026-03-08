// Moduł storage — zapis/odczyt dziennych plików JSON
// Lokalizacja: %APPDATA%/TimeFlow/data/YYYY-MM-DD.json

use anyhow::{Context, Result};
use chrono::{Local, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use crate::config;

const MAX_FILE_ENTRY_NAME_CHARS: usize = 260;
const MAX_WINDOW_TITLE_CHARS: usize = 240;
const MAX_DETECTED_PATH_CHARS: usize = 512;
const MAX_TITLE_HISTORY_ENTRY_CHARS: usize = 180;
const MAX_TITLE_HISTORY_LEN: usize = 12;

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

/// Sesja ciągłej pracy
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Session {
    pub start: String,
    pub end: String,
    pub duration_seconds: u64,
}

/// Wpis o pliku/projekcie
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FileEntry {
    pub name: String,
    pub total_seconds: u64,
    pub first_seen: String,
    pub last_seen: String,
    /// Pełny tytuł okna z ostatniego pollingu — dashboard może parsować bogatszy kontekst.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub window_title: String,
    /// Ścieżka wykryta z argumentów procesu (np. workspace/file path z IDE).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detected_path: Option<String>,
    /// Unikalna historia tytułów okien dla wpisu (limitowana w trackerze).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub title_history: Vec<String>,
    /// Kategoria aktywności (np. coding/browsing/design).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity_type: Option<String>,
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

    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= max_chars {
        return value.to_string();
    }

    if max_chars <= 3 {
        return chars.into_iter().take(max_chars).collect();
    }

    let head_len = (max_chars - 3) / 2;
    let tail_len = max_chars - 3 - head_len;
    let head: String = chars.iter().take(head_len).copied().collect();
    let tail: String = chars
        .iter()
        .skip(chars.len() - tail_len)
        .copied()
        .collect();
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
                if sanitized.is_empty() || normalized_history.iter().any(|entry| entry == &sanitized)
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

/// Katalog danych: %APPDATA%/TimeFlow/data (zakłada że ensure_app_dirs() wywołano przy starcie)
pub fn data_dir() -> Result<PathBuf> {
    Ok(config::config_dir()?.join("data"))
}

/// Ścieżka do pliku dziennego w data/
fn daily_path(date: NaiveDate) -> Result<PathBuf> {
    Ok(data_dir()?.join(format!("{}.json", date.format("%Y-%m-%d"))))
}

/// Ścieżka do pliku dziennego w archive/
fn archive_path(date: NaiveDate) -> Result<PathBuf> {
    Ok(config::config_dir()?
        .join("archive")
        .join(format!("{}.json", date.format("%Y-%m-%d"))))
}

#[cfg(windows)]
fn atomic_replace_file(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    // Atomic replace using MoveFileExW — no window where the target file is missing
    let from_wide: Vec<u16> = from
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let to_wide: Vec<u16> = to
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    extern "system" {
        fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
    }
    let ret = unsafe {
        MoveFileExW(
            from_wide.as_ptr(),
            to_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING,
        )
    };
    if ret == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn atomic_replace_file(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    std::fs::rename(from, to)
}

/// Ładuje dane dzienne (lub tworzy pustą strukturę)
/// Sprawdza najpierw data/, potem archive/, na końcu tworzy pustą strukturę
pub fn load_daily(date: NaiveDate) -> DailyData {
    // Najpierw próbuj data/
    let path = match daily_path(date) {
        Ok(p) => p,
        Err(_) => {
            // Jeśli nie można ustalić ścieżki, sprawdź archive
            return load_from_archive_or_empty(date);
        }
    };

    if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(contents) => {
                return serde_json::from_str(&contents).unwrap_or_else(|e| {
                    log::warn!("Error parsing daily file from data/: {}", e);
                    load_from_archive_or_empty(date)
                });
            }
            Err(e) => {
                log::warn!("Nie można odczytać pliku dziennego z data/: {}", e);
            }
        }
    }

    // Jeśli nie ma w data/, sprawdź archive/
    load_from_archive_or_empty(date)
}

/// Ładuje dane z archive/ lub zwraca pustą strukturę
fn load_from_archive_or_empty(date: NaiveDate) -> DailyData {
    let archive_path = match archive_path(date) {
        Ok(p) => p,
        Err(_) => return empty_daily(date),
    };

    if !archive_path.exists() {
        return empty_daily(date);
    }

    match std::fs::read_to_string(&archive_path) {
        Ok(contents) => {
            let mut data: DailyData = serde_json::from_str(&contents).unwrap_or_else(|e| {
                log::warn!("Error parsing daily file from archive/: {}", e);
                empty_daily(date)
            });

            // Jeśli udało się załadować z archive, przywróć do data/ żeby demon mógł kontynuować
            log::info!(
                "Przywracanie danych z archive/ do data/ dla daty {}",
                date.format("%Y-%m-%d")
            );
            if let Err(e) = save_daily(&mut data) {
                log::warn!("Failed to restore data from archive/: {}", e);
            }

            data
        }
        Err(e) => {
            log::warn!("Nie można odczytać pliku dziennego z archive/: {}", e);
            empty_daily(date)
        }
    }
}

/// Ładuje dane na dzisiaj
pub fn load_today() -> DailyData {
    load_daily(Local::now().date_naive())
}

/// Zapisuje dane dzienne (atomowo: tmp → rename)
pub fn save_daily(data: &mut DailyData) -> Result<()> {
    let date = NaiveDate::parse_from_str(&data.date, "%Y-%m-%d")
        .unwrap_or_else(|_| Local::now().date_naive());

    let path = daily_path(date)?;
    let tmp_path = path.with_extension("json.tmp");

    // Aktualizuj timestamp i podsumowanie
    data.generated_at = Local::now().to_rfc3339();
    prepare_daily_for_storage(data);
    update_summary(data);

    let json = serde_json::to_vec(data).context("Serializacja danych dziennych")?;

    // Atomowy zapis: write tmp → rename
    std::fs::write(&tmp_path, json)
        .with_context(|| format!("Zapis tymczasowy: {:?}", tmp_path))?;
    if let Err(e) = atomic_replace_file(&tmp_path, &path) {
        // Przy błędzie rename NIE usuwamy tmp — plik może służyć do odzyskania danych
        log::error!(
            "Rename {:?} → {:?} nie powiódł się: {}. Plik tmp pozostaje.",
            tmp_path,
            path,
            e
        );
        return Err(e.into());
    }

    Ok(())
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
        assert!(
            file_entry
                .title_history
                .iter()
                .all(|entry| entry.chars().count() <= MAX_TITLE_HISTORY_ENTRY_CHARS)
        );
    }
}
