#[path = "../../../shared/timeflow_paths.rs"]
mod timeflow_paths;

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::ops::{Deref, DerefMut};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Manager};

const SCHEMA: &str = include_str!("../resources/sql/schema.sql");

const PRIMARY_DB_FILE_NAME: &str = "timeflow_dashboard.db";
const DEMO_DB_FILE_NAME: &str = "timeflow_dashboard_demo.db";
const DB_MODE_FILE_NAME: &str = "timeflow_dashboard_mode.json";
const LEGACY_PRIMARY_DB_FILE_NAME: &str = "cfab_dashboard.db";
const LEGACY_DEMO_DB_FILE_NAME: &str = "cfab_dashboard_demo.db";
const LEGACY_DB_MODE_FILE_NAME: &str = "cfab_dashboard_mode.json";
const DB_POOL_MAX_IDLE_CONNECTIONS: usize = 4;

fn initialized_db_paths() -> &'static Mutex<HashSet<String>> {
    static INITIALIZED_DB_PATHS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    INITIALIZED_DB_PATHS.get_or_init(|| Mutex::new(HashSet::new()))
}

#[derive(Serialize, Deserialize, Default)]
struct StoredDbModeConfig {
    #[serde(default)]
    demo_mode: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DemoModeStatus {
    pub enabled: bool,
    pub active_db_path: String,
    pub primary_db_path: String,
    pub demo_db_path: String,
}

#[derive(Default)]
struct ConnectionPoolInner {
    path: Option<String>,
    idle: Vec<rusqlite::Connection>,
}

struct ConnectionPool {
    inner: Mutex<ConnectionPoolInner>,
    max_idle: usize,
}

pub struct PooledConnection {
    conn: Option<rusqlite::Connection>,
    path: String,
    pool: Arc<ConnectionPool>,
}

struct ActiveDbPool(pub Arc<ConnectionPool>);
struct PrimaryDbPool(pub Arc<ConnectionPool>);

impl ConnectionPool {
    fn new(max_idle: usize) -> Self {
        Self {
            inner: Mutex::new(ConnectionPoolInner::default()),
            max_idle,
        }
    }

    fn acquire(self: &Arc<Self>, path: &str) -> Result<PooledConnection, String> {
        let maybe_conn = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| "DB connection pool mutex poisoned".to_string())?;
            if inner.path.as_deref() != Some(path) {
                inner.path = Some(path.to_string());
                inner.idle.clear();
            }
            inner.idle.pop()
        };

        let conn = match maybe_conn {
            Some(conn) => conn,
            None => rusqlite_open(path).map_err(|e| e.to_string())?,
        };

        Ok(PooledConnection {
            conn: Some(conn),
            path: path.to_string(),
            pool: Arc::clone(self),
        })
    }

    fn reset(&self, path: &str) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "DB connection pool mutex poisoned".to_string())?;
        inner.path = Some(path.to_string());
        inner.idle.clear();
        Ok(())
    }

    fn release(&self, path: &str, mut conn: rusqlite::Connection) {
        if !prepare_connection_for_pool(&mut conn) {
            return;
        }

        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        if inner.path.as_deref() != Some(path) || inner.idle.len() >= self.max_idle {
            return;
        }
        inner.idle.push(conn);
    }
}

impl Deref for PooledConnection {
    type Target = rusqlite::Connection;

    fn deref(&self) -> &Self::Target {
        self.conn
            .as_ref()
            .expect("pooled database connection missing")
    }
}

impl DerefMut for PooledConnection {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.conn
            .as_mut()
            .expect("pooled database connection missing")
    }
}

impl Drop for PooledConnection {
    fn drop(&mut self) {
        if let Some(conn) = self.conn.take() {
            self.pool.release(&self.path, conn);
        }
    }
}

fn copy_first_existing_file_if_missing(
    dest: &PathBuf,
    label: &str,
    candidates: impl IntoIterator<Item = PathBuf>,
) {
    if dest.exists() {
        return;
    }

    for candidate in candidates {
        if !candidate.exists() {
            continue;
        }
        match std::fs::copy(&candidate, dest) {
            Ok(_) => {
                log::info!(
                    "Migrated {} '{}' -> '{}'",
                    label,
                    candidate.display(),
                    dest.display()
                );
                break;
            }
            Err(e) => {
                log::warn!(
                    "Failed to migrate {} '{}' -> '{}': {}",
                    label,
                    candidate.display(),
                    dest.display(),
                    e
                );
            }
        }
    }
}

fn app_storage_dir(app: &AppHandle) -> PathBuf {
    let app_dir = if let Ok(appdata) = std::env::var("APPDATA") {
        let appdata_path = PathBuf::from(&appdata);
        match timeflow_paths::ensure_timeflow_base_dir(&appdata_path) {
            Ok(path) => path,
            Err(error) => {
                let fallback = appdata_path.join("TimeFlow");
                log::warn!(
                    "Failed to resolve TIMEFLOW storage dir via shared helper, falling back to '{}': {}",
                    fallback.display(),
                    error
                );
                std::fs::create_dir_all(&fallback).ok();
                fallback
            }
        }
    } else {
        app.path()
            .app_data_dir()
            .expect("Failed to get app data dir")
    };
    std::fs::create_dir_all(&app_dir).ok();
    app_dir
}

fn primary_db_path(app: &AppHandle) -> PathBuf {
    let app_dir = app_storage_dir(app);
    let db_path = app_dir.join(PRIMARY_DB_FILE_NAME);

    // One-time migration from legacy names / old Tauri app_data_dir location.
    let mut candidates = vec![app_dir.join(LEGACY_PRIMARY_DB_FILE_NAME)];
    if let Ok(legacy_dir) = app.path().app_data_dir() {
        candidates.push(legacy_dir.join(PRIMARY_DB_FILE_NAME));
        candidates.push(legacy_dir.join(LEGACY_PRIMARY_DB_FILE_NAME));
    }
    copy_first_existing_file_if_missing(&db_path, "primary database", candidates);

    db_path
}

pub fn db_path(app: &AppHandle) -> PathBuf {
    primary_db_path(app)
}

pub fn demo_db_path(app: &AppHandle) -> PathBuf {
    let app_dir = app_storage_dir(app);
    let db_path = app_dir.join(DEMO_DB_FILE_NAME);
    let mut candidates = vec![app_dir.join(LEGACY_DEMO_DB_FILE_NAME)];
    if let Ok(legacy_dir) = app.path().app_data_dir() {
        candidates.push(legacy_dir.join(DEMO_DB_FILE_NAME));
        candidates.push(legacy_dir.join(LEGACY_DEMO_DB_FILE_NAME));
    }
    copy_first_existing_file_if_missing(&db_path, "demo database", candidates);
    db_path
}

fn db_mode_file_path(app: &AppHandle) -> PathBuf {
    let app_dir = app_storage_dir(app);
    let mode_path = app_dir.join(DB_MODE_FILE_NAME);
    let mut candidates = vec![app_dir.join(LEGACY_DB_MODE_FILE_NAME)];
    if let Ok(legacy_dir) = app.path().app_data_dir() {
        candidates.push(legacy_dir.join(DB_MODE_FILE_NAME));
        candidates.push(legacy_dir.join(LEGACY_DB_MODE_FILE_NAME));
    }
    copy_first_existing_file_if_missing(&mode_path, "db mode file", candidates);
    mode_path
}

fn read_persisted_demo_mode(app: &AppHandle) -> bool {
    let path = db_mode_file_path(app);
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(_) => return false,
    };

    serde_json::from_str::<StoredDbModeConfig>(&raw)
        .map(|cfg| cfg.demo_mode)
        .unwrap_or(false)
}

fn write_persisted_demo_mode(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let path = db_mode_file_path(app);
    let payload = serde_json::to_string_pretty(&StoredDbModeConfig { demo_mode: enabled })
        .map_err(|e| e.to_string())?;
    std::fs::write(path, payload).map_err(|e| e.to_string())
}

fn active_db_path_for_mode(app: &AppHandle, demo_mode: bool) -> PathBuf {
    if demo_mode {
        demo_db_path(app)
    } else {
        primary_db_path(app)
    }
}

// THREADING: All operations here are synchronous (rusqlite). No async needed.
pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let demo_mode = read_persisted_demo_mode(app);
    let path = active_db_path_for_mode(app, demo_mode);
    let path_str = path.to_string_lossy().to_string();

    log::info!(
        "Database path: {} (mode: {})",
        path_str,
        if demo_mode { "demo" } else { "primary" }
    );

    initialize_database_file_once(&path_str)?;

    // Perform vacuum on startup if enabled
    {
        let db = rusqlite_open(&path_str).map_err(|e| e.to_string())?;
        let vacuum_on_startup = get_system_setting_internal(&db, "vacuum_on_startup")
            .map(|v| v == "true")
            .unwrap_or(false);
        if vacuum_on_startup {
            log::info!("Performing startup VACUUM...");
            db.execute_batch("VACUUM;")
                .map_err(|e| format!("Startup VACUUM failed: {}", e))?;
        }

        // Auto backup check
        let backup_enabled = get_system_setting_internal(&db, "backup_enabled")
            .map(|v| v == "true")
            .unwrap_or(false);
        if backup_enabled {
            let backup_path = get_system_setting_internal(&db, "backup_path").unwrap_or_default();
            if !backup_path.is_empty() {
                let interval_days = get_system_setting_internal(&db, "backup_interval_days")
                    .and_then(|v| v.parse::<i64>().ok())
                    .unwrap_or(7);
                let last_backup = get_system_setting_internal(&db, "last_backup_at");

                let should_backup = match last_backup {
                    Some(date_str) => {
                        if let Ok(last) = chrono::DateTime::parse_from_rfc3339(&date_str) {
                            let diff = chrono::Local::now()
                                .signed_duration_since(last.with_timezone(&chrono::Local));
                            diff.num_days() >= interval_days
                        } else {
                            true
                        }
                    }
                    None => true,
                };

                if should_backup {
                    log::info!("Auto-backup is due. Performing backup...");
                    if let Err(e) = perform_backup_internal(&db, &backup_path) {
                        log::error!("Auto-backup failed: {}", e);
                    } else {
                        let now = chrono::Local::now().to_rfc3339();
                        if let Err(e) = db.execute(
                            "INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('last_backup_at', ?1, datetime('now'))",
                            [now],
                        ) {
                             log::error!("Failed to update last_backup_at: {}", e);
                        }
                    }
                }
            }
        }

        // Auto optimization check
        let auto_optimize_enabled = get_system_setting_internal(&db, "auto_optimize_enabled")
            .map(|v| v == "true")
            .unwrap_or(true);
        if auto_optimize_enabled {
            let interval_hours = get_system_setting_internal(&db, "auto_optimize_interval_hours")
                .and_then(|v| v.parse::<i64>().ok())
                .unwrap_or(24)
                .clamp(1, 24 * 30);
            let last_optimize = get_system_setting_internal(&db, "last_optimize_at");
            let should_optimize = match last_optimize {
                Some(date_str) => {
                    if let Ok(last) = chrono::DateTime::parse_from_rfc3339(&date_str) {
                        let diff = chrono::Local::now()
                            .signed_duration_since(last.with_timezone(&chrono::Local));
                        diff.num_hours() >= interval_hours
                    } else {
                        true
                    }
                }
                None => true,
            };
            if should_optimize {
                if let Err(e) = optimize_database_internal(&db) {
                    log::error!("Auto optimization failed: {}", e);
                }
            }
        }
    }

    let active_pool = Arc::new(ConnectionPool::new(DB_POOL_MAX_IDLE_CONNECTIONS));
    active_pool.reset(&path_str)?;
    let primary_pool = Arc::new(ConnectionPool::new(DB_POOL_MAX_IDLE_CONNECTIONS));
    primary_pool.reset(&db_path(app).to_string_lossy())?;

    // Store db state for later use.
    app.manage(DbPath(Mutex::new(path_str)));
    app.manage(DemoModeFlag(Mutex::new(demo_mode)));
    app.manage(ActiveDbPool(active_pool));
    app.manage(PrimaryDbPool(primary_pool));

    Ok(())
}

fn get_system_setting_internal(db: &rusqlite::Connection, key: &str) -> Option<String> {
    db.query_row(
        "SELECT value FROM system_settings WHERE key = ?1",
        [key],
        |row| row.get(0),
    )
    .ok()
}

pub fn get_system_setting(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
    let conn = get_connection(app)?;
    Ok(get_system_setting_internal(&conn, key))
}

pub fn set_system_setting(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
    log::info!("DB: set_system_setting: {} = {}", key, value);
    let conn = get_connection(app)?;
    conn.execute(
        "INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))",
        [key, value],
    )
    .map_err(|e| {
        log::error!("DB Error: failed to set {}: {}", key, e);
        e.to_string()
    })?;
    Ok(())
}

pub fn perform_backup_internal(
    db: &rusqlite::Connection,
    backup_dir: &str,
) -> Result<String, String> {
    let dest_dir = std::path::Path::new(backup_dir);
    if !dest_dir.exists() {
        std::fs::create_dir_all(dest_dir)
            .map_err(|e| format!("Failed to create backup directory: {}", e))?;
    }

    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let file_name = format!("timeflow_backup_{}.db", timestamp);
    let dest_path = dest_dir.join(file_name);

    // Flush WAL
    db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| format!("WAL checkpoint failed: {}", e))?;

    let escaped_path = dest_path.to_string_lossy().replace('\'', "''");
    let sql = format!("VACUUM INTO '{}'", escaped_path);

    db.execute_batch(&sql)
        .map_err(|e| format!("Backup VACUUM INTO failed: {}", e))?;

    Ok(dest_path.to_string_lossy().to_string())
}

pub fn optimize_database_internal(db: &rusqlite::Connection) -> Result<(), String> {
    db.execute_batch("PRAGMA wal_checkpoint(PASSIVE); PRAGMA optimize;")
        .map_err(|e| format!("PRAGMA optimize failed: {}", e))?;

    let page_count: i64 = db
        .pragma_query_value(None, "page_count", |row| row.get(0))
        .map_err(|e| format!("Failed reading page_count: {}", e))?;
    let freelist_count: i64 = db
        .pragma_query_value(None, "freelist_count", |row| row.get(0))
        .map_err(|e| format!("Failed reading freelist_count: {}", e))?;

    // Run full VACUUM only when fragmentation is noticeable.
    if page_count > 0 && (freelist_count as f64 / page_count as f64) >= 0.20 {
        db.execute_batch("VACUUM;")
            .map_err(|e| format!("VACUUM during optimize failed: {}", e))?;
    }

    let now = chrono::Local::now().to_rfc3339();
    db.execute(
        "INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('last_optimize_at', ?1, datetime('now'))",
        [now],
    )
    .map_err(|e| format!("Failed to persist last_optimize_at: {}", e))?;

    Ok(())
}

pub struct DbPath(pub Mutex<String>);
pub struct DemoModeFlag(pub Mutex<bool>);

fn initialize_database_file(path_str: &str) -> Result<(), String> {
    let db = rusqlite_open(path_str).map_err(|e| e.to_string())?;

    db.execute_batch(SCHEMA)
        .map_err(|e| format!("Schema error: {}", e))?;

    // Run migrations for existing databases
    run_migrations(&db).map_err(|e| format!("Migration error: {}", e))?;
    ensure_post_migration_indexes(&db).map_err(|e| format!("Index creation error: {}", e))?;

    Ok(())
}

fn initialize_database_file_once(path_str: &str) -> Result<(), String> {
    let mut initialized_paths = initialized_db_paths()
        .lock()
        .map_err(|_| "Initialized DB paths mutex poisoned".to_string())?;
    if initialized_paths.contains(path_str) {
        return Ok(());
    }

    initialize_database_file(path_str)?;
    initialized_paths.insert(path_str.to_string());
    Ok(())
}

fn run_migrations(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    crate::db_migrations::run_migrations(db)
}

fn ensure_post_migration_indexes(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    crate::db_migrations::ensure_post_migration_indexes(db)
}

fn prepare_connection_for_pool(conn: &mut rusqlite::Connection) -> bool {
    if !conn.is_autocommit() {
        let _ = conn.execute_batch("ROLLBACK;");
    }

    conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")
        .is_ok()
}

// THREADING: Each call creates a new connection. WAL mode allows concurrent readers.
// busy_timeout=5000ms prevents SQLITE_BUSY on short write contention.
// No PRAGMA locking_mode=EXCLUSIVE — concurrent access is safe.
fn rusqlite_open(path: &str) -> Result<rusqlite::Connection, rusqlite::Error> {
    let conn = rusqlite::Connection::open(path)?;
    conn.busy_timeout(std::time::Duration::from_millis(5000))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;",
    )?;
    Ok(conn)
}

// THREADING: Reuses a small pool of warm connections for the currently active DB.
// WAL mode still allows concurrent readers; long write transactions may still block other writers.
pub fn get_connection(app: &AppHandle) -> Result<PooledConnection, String> {
    let path = current_active_db_path_string(app)?;
    let pool = app
        .try_state::<ActiveDbPool>()
        .ok_or_else(|| "ActiveDbPool state unavailable (database not initialized)".to_string())?;
    pool.0.acquire(&path)
}

pub fn get_primary_connection(app: &AppHandle) -> Result<PooledConnection, String> {
    let path = db_path(app);
    let path_str = path.to_string_lossy().to_string();
    initialize_database_file_once(&path_str)?;
    let pool = app
        .try_state::<PrimaryDbPool>()
        .ok_or_else(|| "PrimaryDbPool state unavailable (database not initialized)".to_string())?;
    pool.0.acquire(&path_str)
}

fn current_demo_mode_enabled(app: &AppHandle) -> Result<bool, String> {
    let state = app
        .try_state::<DemoModeFlag>()
        .ok_or_else(|| "DemoModeFlag state unavailable (database not initialized)".to_string())?;
    let guard = state
        .0
        .lock()
        .map_err(|_| "DemoModeFlag mutex poisoned".to_string())?;
    Ok(*guard)
}

pub fn is_demo_mode_enabled(app: &AppHandle) -> Result<bool, String> {
    current_demo_mode_enabled(app)
}

fn current_active_db_path_string(app: &AppHandle) -> Result<String, String> {
    let state = app
        .try_state::<DbPath>()
        .ok_or_else(|| "DbPath state unavailable (database not initialized)".to_string())?;
    let guard = state
        .0
        .lock()
        .map_err(|_| "DbPath mutex poisoned".to_string())?;
    Ok(guard.clone())
}

pub fn get_demo_mode_status(app: &AppHandle) -> Result<DemoModeStatus, String> {
    Ok(DemoModeStatus {
        enabled: current_demo_mode_enabled(app)?,
        active_db_path: current_active_db_path_string(app)?,
        primary_db_path: db_path(app).to_string_lossy().to_string(),
        demo_db_path: demo_db_path(app).to_string_lossy().to_string(),
    })
}

pub fn set_demo_mode(app: &AppHandle, enabled: bool) -> Result<DemoModeStatus, String> {
    let target_path = active_db_path_for_mode(app, enabled);
    let target_path_str = target_path.to_string_lossy().to_string();

    initialize_database_file_once(&target_path_str)?;
    write_persisted_demo_mode(app, enabled)?;

    let db_path_state = app
        .try_state::<DbPath>()
        .ok_or_else(|| "DbPath state unavailable (database not initialized)".to_string())?;
    {
        let mut guard = db_path_state
            .0
            .lock()
            .map_err(|_| "DbPath mutex poisoned".to_string())?;
        *guard = target_path_str.clone();
    }

    let demo_mode_state = app
        .try_state::<DemoModeFlag>()
        .ok_or_else(|| "DemoModeFlag state unavailable (database not initialized)".to_string())?;
    {
        let mut guard = demo_mode_state
            .0
            .lock()
            .map_err(|_| "DemoModeFlag mutex poisoned".to_string())?;
        *guard = enabled;
    }

    if let Some(active_pool) = app.try_state::<ActiveDbPool>() {
        active_pool.0.reset(&target_path_str)?;
    }

    log::info!(
        "Switched dashboard database mode to {} ({})",
        if enabled { "demo" } else { "primary" },
        target_path_str
    );

    get_demo_mode_status(app)
}
