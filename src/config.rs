// Moduł konfiguracji demona:
// - interwały: %APPDATA%/TimeFlow/monitored_apps.json (legacy/config)
// - monitorowane aplikacje: tabela monitored_apps w %APPDATA%/TimeFlow/timeflow_dashboard.db

use anyhow::{Context, Result};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use timeflow_shared::monitored_app::MonitoredApp;
use timeflow_shared::timeflow_paths;

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
    let appdata = std::env::var("APPDATA").context("APPDATA environment variable is missing")?;
    let appdata_path = PathBuf::from(&appdata);
    let base = timeflow_paths::ensure_timeflow_base_dir(&appdata_path).with_context(|| {
        format!(
            "Failed to prepare application directory: {:?}",
            appdata_path
        )
    })?;

    let data = base.join("data");
    let import = base.join("import");
    let archive = base.join("archive");
    let logs = base.join("logs");
    std::fs::create_dir_all(&data)
        .with_context(|| format!("Failed to create data directory: {:?}", data))?;
    std::fs::create_dir_all(&import)
        .with_context(|| format!("Failed to create import directory: {:?}", import))?;
    std::fs::create_dir_all(&archive)
        .with_context(|| format!("Failed to create archive directory: {:?}", archive))?;
    std::fs::create_dir_all(&logs)
        .with_context(|| format!("Failed to create logs directory: {:?}", logs))?;
    Ok(())
}

/// Zwraca ścieżkę do katalogu konfiguracji: %APPDATA%/TimeFlow
pub fn config_dir() -> Result<PathBuf> {
    let appdata = std::env::var("APPDATA").context("APPDATA environment variable is missing")?;
    Ok(PathBuf::from(appdata).join("TimeFlow"))
}

/// Ścieżka do pliku konfiguracyjnego
fn config_path() -> Result<PathBuf> {
    Ok(config_dir()?.join("monitored_apps.json"))
}

pub(crate) fn dashboard_db_path() -> Result<PathBuf> {
    Ok(config_dir()?.join("timeflow_dashboard.db"))
}

/// SAFETY: Uses `SQLITE_OPEN_NO_MUTEX` (multi-thread mode) — each thread must use its own connection.
pub fn open_dashboard_db_readonly() -> Result<rusqlite::Connection> {
    let db_path = dashboard_db_path()?;
    if !db_path.exists() {
        anyhow::bail!("Dashboard DB not found: {:?}", db_path);
    }

    let conn = rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .with_context(|| format!("Failed to open dashboard DB: {:?}", db_path))?;
    conn.busy_timeout(std::time::Duration::from_millis(2000))
        .context("Failed to set busy_timeout for dashboard DB")?;
    Ok(conn)
}

/// LAN sync settings persisted by the dashboard for the daemon to read.
#[derive(Deserialize, Debug, Clone)]
pub struct LanSyncSettings {
    #[serde(default = "default_sync_interval")]
    pub sync_interval_hours: u32,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// Manual role override: "auto" (default) = election decides, "master" / "slave" = forced.
    #[serde(default)]
    pub forced_role: String,
    /// When true, daemon auto-triggers sync when a peer is found. When false, sync is manual only.
    #[serde(default)]
    pub auto_sync_on_peer_found: bool,
}

fn default_sync_interval() -> u32 { 12 }
fn default_enabled() -> bool { true }

impl Default for LanSyncSettings {
    fn default() -> Self {
        Self {
            sync_interval_hours: default_sync_interval(),
            enabled: default_enabled(),
            forced_role: String::new(),
            auto_sync_on_peer_found: false,
        }
    }
}

/// Read LAN sync settings from the shared file (written by dashboard).
pub fn load_lan_sync_settings() -> LanSyncSettings {
    let dir = match config_dir() {
        Ok(d) => d,
        Err(_) => return LanSyncSettings::default(),
    };
    let path = dir.join("lan_sync_settings.json");
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => LanSyncSettings::default(),
    }
}

/// Online sync settings persisted by the dashboard for the daemon to read.
#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct OnlineSyncSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub server_url: String,
    #[serde(default)]
    pub auth_token: String,
    #[serde(default)]
    pub device_id: String,
    #[serde(default)]
    pub encryption_key: String,
    #[serde(default)]
    pub sync_interval_hours: u32,
    #[serde(default)]
    pub auto_sync_on_startup: bool,
    /// Sync mode: "session" (13-step), "async" (store-and-forward delta), "auto" (auto-detect)
    #[serde(default = "default_sync_mode")]
    pub sync_mode: String,
    /// Group ID for license-based features (async delta, etc.)
    #[serde(default)]
    pub group_id: String,
}

fn default_sync_mode() -> String {
    "session".to_string()
}

impl Default for OnlineSyncSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            server_url: String::new(),
            auth_token: String::new(),
            device_id: String::new(),
            encryption_key: String::new(),
            sync_interval_hours: 0,
            auto_sync_on_startup: false,
            sync_mode: "session".to_string(),
            group_id: String::new(),
        }
    }
}

/// Read online sync settings from the shared file (written by dashboard).
pub fn load_online_sync_settings() -> OnlineSyncSettings {
    let path = match config_dir() {
        Ok(d) => d.join("online_sync_settings.json"),
        Err(_) => return OnlineSyncSettings::default(),
    };
    match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => OnlineSyncSettings::default(),
    }
}

/// Save online sync settings to disk.
#[allow(dead_code)]
pub fn save_online_sync_settings(settings: &OnlineSyncSettings) -> Result<()> {
    let dir = config_dir()?;
    let path = dir.join("online_sync_settings.json");
    let json = serde_json::to_string_pretty(settings)
        .context("Failed to serialize OnlineSyncSettings")?;
    std::fs::write(&path, json)
        .with_context(|| format!("Failed to write {:?}", path))?;
    Ok(())
}

/// Ładuje legacy konfigurację z pliku JSON (interwały + fallback lista aplikacji).
fn load_legacy_json_config() -> Config {
    let path = match config_path() {
        Ok(p) => p,
        Err(e) => {
            log::warn!("Failed to resolve config path: {}", e);
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
            log::warn!("Failed to read config file: {}", e);
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
    let conn = open_dashboard_db_readonly()?;

    let table_exists = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='monitored_apps' LIMIT 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .context("Failed to check monitored_apps table")?
        .is_some();
    if !table_exists {
        anyhow::bail!("monitored_apps table does not exist yet");
    }

    let mut stmt = conn
        .prepare(
            "SELECT exe_name, display_name, added_at
             FROM monitored_apps
             ORDER BY display_name COLLATE NOCASE, exe_name COLLATE NOCASE",
        )
        .context("Failed to prepare monitored_apps query")?;
    let rows = stmt
        .query_map([], |row| {
            Ok(MonitoredApp {
                exe_name: row.get(0)?,
                display_name: row.get(1)?,
                added_at: row.get(2)?,
            })
        })
        .context("Failed to read monitored_apps from DB")?;

    let mut apps = Vec::new();
    for row in rows {
        let mut app = row.context("Failed to map monitored_apps row")?;
        app.exe_name = app.exe_name.trim().to_lowercase();
        apps.push(app);
    }
    Ok(apps)
}

use std::sync::Mutex;
use std::time::SystemTime;

struct ConfigCache {
    json_mtime: Option<SystemTime>,
    db_mtime: Option<SystemTime>,
    config: Config,
}

static CONFIG_CACHE: Mutex<Option<ConfigCache>> = Mutex::new(None);

pub(crate) fn file_mtime(path: &std::path::Path) -> Option<SystemTime> {
    std::fs::metadata(path).ok().and_then(|m| m.modified().ok())
}

/// Ładuje konfigurację demona. Lista monitorowanych aplikacji pochodzi z DB dashboardu.
/// JSON pozostaje fallbackiem (legacy) oraz źródłem interwałów.
/// Wynik cachowany na podstawie mtime pliku JSON i DB.
pub fn load() -> Config {
    let json_mtime = config_path().ok().and_then(|p| file_mtime(&p));
    let db_mtime = dashboard_db_path().ok().and_then(|p| file_mtime(&p));

    // NOTE: Loose consistency — file may change between mtime check and cache return.
    // This is acceptable as config is re-read on next call.
    if let Ok(guard) = CONFIG_CACHE.lock() {
        if let Some(cached) = guard.as_ref() {
            if cached.json_mtime == json_mtime && cached.db_mtime == db_mtime {
                return cached.config.clone();
            }
        }
    }

    let mut cfg = load_legacy_json_config();

    match load_monitored_apps_from_dashboard_db() {
        Ok(apps) => {
            cfg.apps = apps;
        }
        Err(e) => {
            log::warn!(
                "Failed to read monitored_apps from dashboard DB (fallback to JSON): {}",
                e
            );
        }
    }

    if let Ok(mut guard) = CONFIG_CACHE.lock() {
        *guard = Some(ConfigCache {
            json_mtime,
            db_mtime,
            config: cfg.clone(),
        });
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

// ── Logging ──

/// Returns the centralized logs directory: %APPDATA%/TimeFlow/logs
pub fn logs_dir() -> Result<PathBuf> {
    Ok(config_dir()?.join("logs"))
}

/// Log level settings persisted by dashboard, read by daemon.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LogSettings {
    #[serde(default = "default_log_level")]
    pub daemon_level: String,
    #[serde(default = "default_log_level")]
    pub lan_sync_level: String,
    #[serde(default = "default_log_level")]
    pub online_sync_level: String,
    #[serde(default = "default_log_level")]
    pub dashboard_level: String,
    /// Max size per log file in KB (default 1024 = 1 MB)
    #[serde(default = "default_max_log_size_kb")]
    pub max_log_size_kb: u32,
}

fn default_log_level() -> String { "info".to_string() }
fn default_max_log_size_kb() -> u32 { 1024 }

impl Default for LogSettings {
    fn default() -> Self {
        Self {
            daemon_level: default_log_level(),
            lan_sync_level: default_log_level(),
            online_sync_level: default_log_level(),
            dashboard_level: default_log_level(),
            max_log_size_kb: default_max_log_size_kb(),
        }
    }
}

pub fn load_log_settings() -> LogSettings {
    let path = match config_dir() {
        Ok(d) => d.join("log_settings.json"),
        Err(_) => return LogSettings::default(),
    };
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => LogSettings::default(),
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
