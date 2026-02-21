// Moduł konfiguracji — ładowanie/zapisywanie listy monitorowanych aplikacji
// Plik konfiguracyjny: %APPDATA%/conceptfab/monitored_apps.json

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;

/// Pojedyncza monitorowana aplikacja
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MonitoredApp {
    pub exe_name: String,
    pub display_name: String,
    pub added_at: String,
}

/// Opcjonalne interwały (sekundy). Domyślne jeśli brak.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Intervals {
    pub poll_secs: Option<u64>,
    pub save_secs: Option<u64>,
    pub cache_evict_secs: Option<u64>,
    pub cache_max_age_secs: Option<u64>,
    pub session_gap_secs: Option<u64>,
    pub config_reload_secs: Option<u64>,
    /// Próg CPU (ułamek jednego rdzenia) powyżej którego aplikacja w tle jest "aktywna".
    /// Domyślnie 0.05 (5% jednego rdzenia).
    pub cpu_threshold: Option<f64>,
}

impl Default for Intervals {
    fn default() -> Self {
        Self {
            poll_secs: None,
            save_secs: None,
            cache_evict_secs: None,
            cache_max_age_secs: None,
            session_gap_secs: None,
            config_reload_secs: None,
            cpu_threshold: None,
        }
    }
}

/// Lista monitorowanych aplikacji
#[derive(Serialize, Deserialize, Default, Debug, Clone)]
pub struct Config {
    pub apps: Vec<MonitoredApp>,
    #[serde(default)]
    pub intervals: Intervals,
}

/// Tworzy katalogi aplikacji raz przy starcie. Wywołać na początku main().
pub fn ensure_app_dirs() -> Result<()> {
    let appdata = std::env::var("APPDATA").context("Brak zmiennej APPDATA")?;
    let appdata_path = PathBuf::from(&appdata);
    let base = appdata_path.join("conceptfab");
    let legacy_base = appdata_path.join("CfabDemon");

    // One-time migration from legacy folder name.
    if !base.exists() && legacy_base.exists() {
        if let Err(e) = std::fs::rename(&legacy_base, &base) {
            log::warn!(
                "Failed to migrate directory {:?} -> {:?}: {}",
                legacy_base, base, e
            );
        }
    }

    let data = base.join("data");
    let import = base.join("import");
    let archive = base.join("archive");
    std::fs::create_dir_all(&base)
        .with_context(|| format!("Nie można utworzyć katalogu: {:?}", base))?;
    std::fs::create_dir_all(&data)
        .with_context(|| format!("Nie można utworzyć katalogu danych: {:?}", data))?;
    std::fs::create_dir_all(&import)
        .with_context(|| format!("Nie można utworzyć katalogu importu: {:?}", import))?;
    std::fs::create_dir_all(&archive)
        .with_context(|| format!("Nie można utworzyć katalogu archiwum: {:?}", archive))?;
    Ok(())
}

/// Zwraca ścieżkę do katalogu konfiguracji: %APPDATA%/conceptfab
pub fn config_dir() -> Result<PathBuf> {
    let appdata = std::env::var("APPDATA").context("Brak zmiennej APPDATA")?;
    Ok(PathBuf::from(appdata).join("conceptfab"))
}

/// Ścieżka do pliku konfiguracyjnego
fn config_path() -> Result<PathBuf> {
    Ok(config_dir()?.join("monitored_apps.json"))
}

/// Ładuje konfigurację z pliku. Zwraca pustą jeśli plik nie istnieje.
pub fn load() -> Config {
    let path = match config_path() {
        Ok(p) => p,
        Err(e) => {
            log::warn!("Nie można ustalić ścieżki konfiguracji: {}", e);
            return Config::default();
        }
    };

    if !path.exists() {
        return Config::default();
    }

    let mut cfg = match std::fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_else(|e| {
            log::warn!("Configuration parsing error: {}", e);
            Config::default()
        }),
        Err(e) => {
            log::warn!("Nie można odczytać konfiguracji: {}", e);
            Config::default()
        }
    };

    // Legacy compatibility: normalize exe names so comparisons are case-insensitive.
    for app in &mut cfg.apps {
        app.exe_name = app.exe_name.trim().to_lowercase();
    }

    cfg
}

/// Zwraca zbiór nazw exe (lowercase) — do szybkiego porównania.
/// Clones strings because the caller stores the set across config reloads.
pub fn monitored_exe_names(config: &Config) -> HashSet<String> {
    config
        .apps
        .iter()
        .map(|a| a.exe_name.trim().to_lowercase())
        .collect()
}

/// Resolved intervals with defaults applied.
pub struct ResolvedIntervals {
    pub poll_secs: u64,
    pub save_secs: u64,
    pub cache_evict_secs: u64,
    pub cache_max_age_secs: u64,
    pub session_gap_secs: u64,
    pub config_reload_secs: u64,
    pub cpu_threshold: f64,
}

/// Zwraca interwały z domyślnymi wartościami dla brakujących pól.
pub fn intervals(config: &Config) -> ResolvedIntervals {
    ResolvedIntervals {
        poll_secs: config.intervals.poll_secs.unwrap_or(10),
        save_secs: config.intervals.save_secs.unwrap_or(5 * 60),
        cache_evict_secs: config.intervals.cache_evict_secs.unwrap_or(10 * 60),
        cache_max_age_secs: config.intervals.cache_max_age_secs.unwrap_or(3 * 60),
        session_gap_secs: config.intervals.session_gap_secs.unwrap_or(5 * 60),
        config_reload_secs: config.intervals.config_reload_secs.unwrap_or(30),
        cpu_threshold: config.intervals.cpu_threshold.unwrap_or(0.05),
    }
}

/// Szuka display_name po exe_name
pub fn display_name_for(config: &Config, exe_name: &str) -> String {
    config
        .apps
        .iter()
        .find(|a| a.exe_name == exe_name)
        .map(|a| a.display_name.clone())
        .unwrap_or_else(|| exe_name.to_string())
}
