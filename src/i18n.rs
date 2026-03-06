// Minimalna lokalizacja demona (PL/EN).
// Język odczytywany z %APPDATA%/TimeFlow/language.json (wspólny z dashboardem).

use std::path::PathBuf;

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
            (Lang::En, TrayText::VersionMismatchTemplate) => "TIMEFLOW Version mismatch!\nDemon: {}\nDashboard: {}\n\nThis connection may not work properly.",

            (Lang::Pl, TrayText::VersionErrorTitle) => "TIMEFLOW - Błąd wersji",
            (Lang::En, TrayText::VersionErrorTitle) => "TIMEFLOW - Version Error",

            (Lang::Pl, TrayText::DemonErrorTitle) => "TIMEFLOW - Demon",
            (Lang::En, TrayText::DemonErrorTitle) => "TIMEFLOW - Daemon",
        }
    }
}

#[derive(Debug, Clone, Copy)]
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
}

fn language_file_path() -> Option<PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    Some(PathBuf::from(appdata).join("TimeFlow").join("language.json"))
}

/// Odczytuje język z pliku współdzielonego z dashboardem.
/// Fallback: PL (zachowanie dotychczasowe).
pub fn load_language() -> Lang {
    let path = match language_file_path() {
        Some(p) => p,
        None => return Lang::Pl,
    };
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Lang::Pl,
    };
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
        if let Some(code) = parsed.get("code").and_then(|v| v.as_str()) {
            if code.eq_ignore_ascii_case("en") {
                return Lang::En;
            }
        }
    }
    Lang::Pl
}
