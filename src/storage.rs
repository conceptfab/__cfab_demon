// Moduł storage — zapis/odczyt dziennych plików JSON
// Lokalizacja: %APPDATA%/TimeFlow/data/YYYY-MM-DD.json

use anyhow::{Context, Result};
use chrono::{Local, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use crate::config;

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
}

/// Podsumowanie dnia
#[derive(Serialize, Deserialize, Debug)]
pub struct DailySummary {
    pub total_app_seconds: u64,
    pub total_app_formatted: String,
    pub apps_active_count: usize,
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
    Ok(config::config_dir()?.join("archive").join(format!("{}.json", date.format("%Y-%m-%d"))))
}

#[cfg(windows)]
fn atomic_replace_file(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    // Atomic replace using MoveFileExW — no window where the target file is missing
    let from_wide: Vec<u16> = from.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let to_wide: Vec<u16> = to.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    extern "system" {
        fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
    }
    let ret = unsafe { MoveFileExW(from_wide.as_ptr(), to_wide.as_ptr(), MOVEFILE_REPLACE_EXISTING) };
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
            log::info!("Przywracanie danych z archive/ do data/ dla daty {}", date.format("%Y-%m-%d"));
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
    update_summary(data);

    let json = serde_json::to_string_pretty(data).context("Serializacja danych dziennych")?;

    // Atomowy zapis: write tmp → rename
    std::fs::write(&tmp_path, &json)
        .with_context(|| format!("Zapis tymczasowy: {:?}", tmp_path))?;
    if let Err(e) = atomic_replace_file(&tmp_path, &path) {
        // Przy błędzie rename NIE usuwamy tmp — plik może służyć do odzyskania danych
        log::error!("Rename {:?} → {:?} nie powiódł się: {}. Plik tmp pozostaje.", tmp_path, path, e);
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

