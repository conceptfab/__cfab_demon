// Moduł konfiguracji demona:
// - interwały: %APPDATA%/TimeFlow/monitored_apps.json (legacy/config)
// - monitorowane aplikacje: tabela monitored_apps w %APPDATA%/TimeFlow/timeflow_dashboard.db

use anyhow::{Context, Result};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;

#[path = "../shared/timeflow_paths.rs"]
mod timeflow_paths;

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
    let base = timeflow_paths::ensure_timeflow_base_dir(&appdata_path)
        .with_context(|| format!("Nie można przygotować katalogu: {:?}", appdata_path))?;

    let data = base.join("data");
    let import = base.join("import");
    let archive = base.join("archive");
    std::fs::create_dir_all(&data)
        .with_context(|| format!("Nie można utworzyć katalogu danych: {:?}", data))?;
    std::fs::create_dir_all(&import)
        .with_context(|| format!("Nie można utworzyć katalogu importu: {:?}", import))?;
    std::fs::create_dir_all(&archive)
        .with_context(|| format!("Nie można utworzyć katalogu archiwum: {:?}", archive))?;
    Ok(())
}

/// Zwraca ścieżkę do katalogu konfiguracji: %APPDATA%/TimeFlow
pub fn config_dir() -> Result<PathBuf> {
    let appdata = std::env::var("APPDATA").context("Brak zmiennej APPDATA")?;
    Ok(PathBuf::from(appdata).join("TimeFlow"))
}

/// Ścieżka do pliku konfiguracyjnego
fn config_path() -> Result<PathBuf> {
    Ok(config_dir()?.join("monitored_apps.json"))
}

fn dashboard_db_path() -> Result<PathBuf> {
    Ok(config_dir()?.join("timeflow_dashboard.db"))
}

/// Ładuje legacy konfigurację z pliku JSON (interwały + fallback lista aplikacji).
fn load_legacy_json_config() -> Config {
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

fn load_monitored_apps_from_dashboard_db() -> Result<Vec<MonitoredApp>> {
    let db_path = dashboard_db_path()?;
    if !db_path.exists() {
        anyhow::bail!("Dashboard DB not found: {:?}", db_path);
    }

    let conn = rusqlite::Connection::open(&db_path)
        .with_context(|| format!("Nie można otworzyć DB dashboardu: {:?}", db_path))?;
    conn.busy_timeout(std::time::Duration::from_millis(2000))
        .context("Nie można ustawić busy_timeout dla DB dashboardu")?;

    let table_exists = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='monitored_apps' LIMIT 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .context("Nie można sprawdzić tabeli monitored_apps")?
        .is_some();
    if !table_exists {
        anyhow::bail!("Tabela monitored_apps nie istnieje jeszcze");
    }

    let mut stmt = conn
        .prepare(
            "SELECT exe_name, display_name, added_at
             FROM monitored_apps
             ORDER BY display_name COLLATE NOCASE, exe_name COLLATE NOCASE",
        )
        .context("Nie można przygotować zapytania monitored_apps")?;
    let rows = stmt
        .query_map([], |row| {
            Ok(MonitoredApp {
                exe_name: row.get(0)?,
                display_name: row.get(1)?,
                added_at: row.get(2)?,
            })
        })
        .context("Nie można odczytać monitored_apps z DB")?;

    let mut apps = Vec::new();
    for row in rows {
        let mut app = row.context("Błąd mapowania monitored_apps row")?;
        app.exe_name = app.exe_name.trim().to_lowercase();
        apps.push(app);
    }
    Ok(apps)
}

/// Ładuje konfigurację demona. Lista monitorowanych aplikacji pochodzi z DB dashboardu.
/// JSON pozostaje fallbackiem (legacy) oraz źródłem interwałów.
pub fn load() -> Config {
    let mut cfg = load_legacy_json_config();

    match load_monitored_apps_from_dashboard_db() {
        Ok(apps) => {
            cfg.apps = apps;
        }
        Err(e) => {
            // Fallback dla pierwszego uruchomienia / starszych DB.
            log::warn!(
                "Nie można odczytać monitored_apps z DB dashboardu (fallback do JSON): {}",
                e
            );
        }
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

const POLL_DEFAULT_SECS: u64 = 10;
const SAVE_DEFAULT_SECS: u64 = 5 * 60;
const CACHE_EVICT_DEFAULT_SECS: u64 = 10 * 60;
const CACHE_MAX_AGE_DEFAULT_SECS: u64 = 3 * 60;
const SESSION_GAP_DEFAULT_SECS: u64 = 5 * 60;
const CONFIG_RELOAD_DEFAULT_SECS: u64 = 30;
const CPU_THRESHOLD_DEFAULT: f64 = 0.05;

fn clamp_interval_secs(name: &str, value: u64, min: u64, max: u64) -> u64 {
    if value < min {
        log::warn!(
            "Invalid interval '{}': {}s is below minimum {}s. Using {}s.",
            name,
            value,
            min,
            min
        );
        return min;
    }
    if value > max {
        log::warn!(
            "Invalid interval '{}': {}s is above maximum {}s. Using {}s.",
            name,
            value,
            max,
            max
        );
        return max;
    }
    value
}

fn clamp_cpu_threshold(value: f64) -> f64 {
    if !value.is_finite() {
        log::warn!(
            "Invalid cpu_threshold '{}': non-finite value. Using default {}.",
            value,
            CPU_THRESHOLD_DEFAULT
        );
        return CPU_THRESHOLD_DEFAULT;
    }
    let min = 0.001;
    let max = 1.0;
    if value < min {
        log::warn!(
            "Invalid cpu_threshold '{}': below minimum {}. Using {}.",
            value,
            min,
            min
        );
        return min;
    }
    if value > max {
        log::warn!(
            "Invalid cpu_threshold '{}': above maximum {}. Using {}.",
            value,
            max,
            max
        );
        return max;
    }
    value
}

/// Zwraca interwały z domyślnymi wartościami dla brakujących pól.
pub fn intervals(config: &Config) -> ResolvedIntervals {
    let poll_secs = clamp_interval_secs(
        "poll_secs",
        config.intervals.poll_secs.unwrap_or(POLL_DEFAULT_SECS),
        1,
        300,
    );
    let save_secs = clamp_interval_secs(
        "save_secs",
        config.intervals.save_secs.unwrap_or(SAVE_DEFAULT_SECS),
        10,
        86_400,
    );
    let cache_evict_secs = clamp_interval_secs(
        "cache_evict_secs",
        config
            .intervals
            .cache_evict_secs
            .unwrap_or(CACHE_EVICT_DEFAULT_SECS),
        10,
        86_400,
    );
    let cache_max_age_secs = clamp_interval_secs(
        "cache_max_age_secs",
        config
            .intervals
            .cache_max_age_secs
            .unwrap_or(CACHE_MAX_AGE_DEFAULT_SECS),
        30,
        86_400,
    );
    let session_gap_secs = clamp_interval_secs(
        "session_gap_secs",
        config
            .intervals
            .session_gap_secs
            .unwrap_or(SESSION_GAP_DEFAULT_SECS),
        10,
        86_400,
    );
    let config_reload_secs = clamp_interval_secs(
        "config_reload_secs",
        config
            .intervals
            .config_reload_secs
            .unwrap_or(CONFIG_RELOAD_DEFAULT_SECS),
        5,
        3600,
    );
    let cpu_threshold = clamp_cpu_threshold(
        config
            .intervals
            .cpu_threshold
            .unwrap_or(CPU_THRESHOLD_DEFAULT),
    );

    ResolvedIntervals {
        poll_secs,
        save_secs,
        cache_evict_secs,
        cache_max_age_secs,
        session_gap_secs,
        config_reload_secs,
        cpu_threshold,
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
