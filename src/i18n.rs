// Minimalna lokalizacja demona (PL/EN).
// Język odczytywany z %APPDATA%/TimeFlow/language.json (wspólny z dashboardem).

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::SystemTime;

use crate::config;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    Pl,
    En,
}

impl Lang {
    pub fn t(&self, key: TrayText) -> &'static str {
        match (self, key) {
            (Lang::Pl, TrayText::RunningInBackground) => "działa w tle",
            (Lang::En, TrayText::RunningInBackground) => "running in background",

            (Lang::Pl, TrayText::UnassignedSessions) => "nieprzypisanych sesji",
            (Lang::En, TrayText::UnassignedSessions) => "unassigned sessions",

            (Lang::Pl, TrayText::Close) => "Zamknij",
            (Lang::En, TrayText::Close) => "Close",

            (Lang::Pl, TrayText::Restart) => "Uruchom ponownie",
            (Lang::En, TrayText::Restart) => "Restart",

            (Lang::Pl, TrayText::OpenDashboard) => "Otwórz Dashboard",
            (Lang::En, TrayText::OpenDashboard) => "Open Dashboard",

            (Lang::Pl, TrayText::DashboardNotFound) => "Nie znaleziono TIMEFLOW Dashboard (timeflow-dashboard.exe).\nUpewnij się, że znajduje się w tym samym folderze co timeflow-demon.exe.",
            (Lang::En, TrayText::DashboardNotFound) => "TIMEFLOW Dashboard (timeflow-dashboard.exe) not found.\nMake sure it is in the same folder as timeflow-demon.exe.",

            (Lang::Pl, TrayText::VersionMismatchTemplate) => "Niezgodność wersji TIMEFLOW!\nDemon: {}\nDashboard: {}\n\nTo połączenie może działać nieprawidłowo.",
            (Lang::En, TrayText::VersionMismatchTemplate) => "TIMEFLOW Version mismatch!\nDaemon: {}\nDashboard: {}\n\nThis connection may not work properly.",

            (Lang::Pl, TrayText::VersionErrorTitle) => "TIMEFLOW - Błąd wersji",
            (Lang::En, TrayText::VersionErrorTitle) => "TIMEFLOW - Version Error",

            (Lang::Pl, TrayText::DemonErrorTitle) => "TIMEFLOW - Demon",
            (Lang::En, TrayText::DemonErrorTitle) => "TIMEFLOW - Daemon",

            (Lang::Pl, TrayText::AlreadyRunning) => {
                "Inna instancja TIMEFLOW Demon jest już uruchomiona."
            }
            (Lang::En, TrayText::AlreadyRunning) => {
                "Another TIMEFLOW Daemon instance is already running."
            }

            (Lang::Pl, TrayText::SyncDelta) => "Synchronizuj",
            (Lang::En, TrayText::SyncDelta) => "Synchronize",

            (Lang::Pl, TrayText::SyncForceFull) => "Synchronizuj (pełna)",
            (Lang::En, TrayText::SyncForceFull) => "Synchronize (full)",

            (Lang::Pl, TrayText::SyncCompleted) => "Synchronizacja zakończona pomyślnie",
            (Lang::En, TrayText::SyncCompleted) => "Synchronization completed successfully",

            (Lang::Pl, TrayText::SyncNotNeeded) => "Synchronizacja niepotrzebna \u{2014} bazy są identyczne",
            (Lang::En, TrayText::SyncNotNeeded) => "Synchronization not needed \u{2014} databases are identical",

            (Lang::Pl, TrayText::SyncFailed) => "Synchronizacja nie powiodła się",
            (Lang::En, TrayText::SyncFailed) => "Synchronization failed",

            (Lang::Pl, TrayText::SyncIdle) => "Sync: bezczynny",
            (Lang::En, TrayText::SyncIdle) => "Sync: idle",

            (Lang::Pl, TrayText::SyncStatusPrefix) => "Sync",
            (Lang::En, TrayText::SyncStatusPrefix) => "Sync",

            (Lang::Pl, TrayText::SyncFrozenSuffix) => "zamrożony",
            (Lang::En, TrayText::SyncFrozenSuffix) => "frozen",

            (Lang::Pl, TrayText::LanSyncInProgress) => "LAN Sync...",
            (Lang::En, TrayText::LanSyncInProgress) => "LAN Sync...",
        }
    }
}

// Większość wariantów konsumowana jest wyłącznie przez tray Windowsa
// (platform/windows/tray.rs); na macOS tray ma inne menu i `cargo check`
// oznacza je jako dead_code. `#[allow]` trzyma ostrzeżenia z daleka bez
// ukrywania prawdziwych nieużywanych tłumaczeń.
#[derive(Debug, Clone, Copy)]
#[allow(dead_code)]
pub enum TrayText {
    RunningInBackground,
    UnassignedSessions,
    Close,
    Restart,
    OpenDashboard,
    DashboardNotFound,
    VersionMismatchTemplate,
    VersionErrorTitle,
    DemonErrorTitle,
    AlreadyRunning,
    SyncDelta,
    SyncForceFull,
    SyncCompleted,
    SyncNotNeeded,
    SyncFailed,
    SyncIdle,
    SyncStatusPrefix,
    SyncFrozenSuffix,
    LanSyncInProgress,
}

fn language_file_path() -> Option<PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    Some(
        PathBuf::from(appdata)
            .join("TimeFlow")
            .join("language.json"),
    )
}

static LANG_CACHE: Mutex<Option<(SystemTime, Lang)>> = Mutex::new(None);

/// Odczytuje język z pliku współdzielonego z dashboardem.
/// Fallback: PL (zachowanie dotychczasowe).
/// Wynik cachowany na podstawie mtime pliku.
pub fn load_language() -> Lang {
    let path = match language_file_path() {
        Some(p) => p,
        None => return Lang::Pl,
    };
    let mtime = match config::file_mtime(&path) {
        Some(t) => t,
        None => return Lang::Pl,
    };
    // Hold the lock for the entire check-read-update cycle to avoid TOCTOU
    let mut guard = match LANG_CACHE.lock() {
        Ok(g) => g,
        Err(_) => return Lang::Pl,
    };
    if let Some((cached_mtime, cached_lang)) = guard.as_ref() {
        if *cached_mtime == mtime {
            return *cached_lang;
        }
    }
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Lang::Pl,
    };
    let lang = if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
        if parsed
            .get("code")
            .and_then(|v| v.as_str())
            .map_or(false, |c| c.eq_ignore_ascii_case("en"))
        {
            Lang::En
        } else {
            Lang::Pl
        }
    } else {
        Lang::Pl
    };
    *guard = Some((mtime, lang));
    lang
}
