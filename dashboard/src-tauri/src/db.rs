use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#38bdf8',
    hourly_rate REAL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    excluded_at TEXT,
    assigned_folder_path TEXT,
    is_imported INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project_name_blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_project_name_blacklist_name_key
ON project_name_blacklist(name_key);

CREATE TRIGGER IF NOT EXISTS trg_projects_blacklist_block_insert
BEFORE INSERT ON projects
FOR EACH ROW
WHEN NEW.excluded_at IS NULL
 AND trim(NEW.name) <> ''
 AND EXISTS (
    SELECT 1
    FROM project_name_blacklist b
    WHERE b.name_key = lower(trim(NEW.name))
 )
BEGIN
    SELECT RAISE(ABORT, 'Project name is blacklisted');
END;

CREATE TRIGGER IF NOT EXISTS trg_projects_blacklist_block_update
BEFORE UPDATE OF name, excluded_at ON projects
FOR EACH ROW
WHEN NEW.excluded_at IS NULL
 AND trim(NEW.name) <> ''
 AND EXISTS (
    SELECT 1
    FROM project_name_blacklist b
    WHERE b.name_key = lower(trim(NEW.name))
 )
BEGIN
    SELECT RAISE(ABORT, 'Project name is blacklisted');
END;

CREATE TRIGGER IF NOT EXISTS trg_projects_blacklist_sync_insert
AFTER INSERT ON projects
FOR EACH ROW
WHEN NEW.excluded_at IS NOT NULL AND trim(NEW.name) <> ''
BEGIN
    INSERT OR IGNORE INTO project_name_blacklist (name, name_key, created_at)
    VALUES (NEW.name, lower(trim(NEW.name)), COALESCE(NEW.excluded_at, datetime('now')));
    UPDATE project_name_blacklist
    SET name = NEW.name
    WHERE name_key = lower(trim(NEW.name));
END;

CREATE TRIGGER IF NOT EXISTS trg_projects_blacklist_sync_exclude
AFTER UPDATE OF excluded_at ON projects
FOR EACH ROW
WHEN NEW.excluded_at IS NOT NULL AND trim(NEW.name) <> ''
BEGIN
    INSERT OR IGNORE INTO project_name_blacklist (name, name_key, created_at)
    VALUES (NEW.name, lower(trim(NEW.name)), COALESCE(NEW.excluded_at, datetime('now')));
    UPDATE project_name_blacklist
    SET name = NEW.name
    WHERE name_key = lower(trim(NEW.name));
END;

CREATE TRIGGER IF NOT EXISTS trg_projects_blacklist_sync_restore
AFTER UPDATE OF excluded_at ON projects
FOR EACH ROW
WHEN OLD.excluded_at IS NOT NULL AND NEW.excluded_at IS NULL AND trim(NEW.name) <> ''
BEGIN
    DELETE FROM project_name_blacklist
    WHERE name_key = lower(trim(NEW.name));
END;

CREATE TRIGGER IF NOT EXISTS trg_projects_blacklist_sync_delete
AFTER DELETE ON projects
FOR EACH ROW
WHEN OLD.excluded_at IS NOT NULL AND trim(OLD.name) <> ''
BEGIN
    DELETE FROM project_name_blacklist
    WHERE name_key = lower(trim(OLD.name));
END;

CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    executable_name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    project_id INTEGER,
    color TEXT DEFAULT NULL,
    is_imported INTEGER DEFAULT 0,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS monitored_apps (
    exe_name TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    added_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    date TEXT NOT NULL,
    rate_multiplier REAL NOT NULL DEFAULT 1.0,
    project_id INTEGER,
    FOREIGN KEY (app_id) REFERENCES applications(id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    UNIQUE(app_id, start_time)
);

CREATE TABLE IF NOT EXISTS file_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    file_name TEXT NOT NULL,
    total_seconds INTEGER NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    project_id INTEGER,
    FOREIGN KEY (app_id) REFERENCES applications(id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    UNIQUE(app_id, date, file_name)
);

CREATE TABLE IF NOT EXISTS imported_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL UNIQUE,
    import_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    records_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    added_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_app_id ON sessions(app_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);
CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time);
CREATE INDEX IF NOT EXISTS idx_applications_project_id ON applications(project_id);

CREATE TABLE IF NOT EXISTS assignment_model_app (
    app_id INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    cnt INTEGER NOT NULL DEFAULT 0,
    last_seen TEXT NOT NULL,
    PRIMARY KEY (app_id, project_id)
);

CREATE TABLE IF NOT EXISTS assignment_model_token (
    token TEXT NOT NULL,
    project_id INTEGER NOT NULL,
    cnt INTEGER NOT NULL DEFAULT 0,
    last_seen TEXT NOT NULL,
    PRIMARY KEY (token, project_id)
);

CREATE TABLE IF NOT EXISTS assignment_model_time (
    app_id INTEGER NOT NULL,
    hour_bucket INTEGER NOT NULL,
    weekday INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    cnt INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (app_id, hour_bucket, weekday, project_id)
);

CREATE TABLE IF NOT EXISTS assignment_model_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS estimate_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignment_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    app_id INTEGER NOT NULL,
    suggested_project_id INTEGER NOT NULL,
    suggested_confidence REAL NOT NULL,
    suggested_evidence_count INTEGER NOT NULL,
    model_version TEXT,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignment_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    suggestion_id INTEGER,
    session_id INTEGER,
    app_id INTEGER,
    from_project_id INTEGER,
    to_project_id INTEGER,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignment_auto_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    mode TEXT NOT NULL,
    min_confidence_auto REAL NOT NULL,
    min_evidence_auto INTEGER NOT NULL,
    sessions_scanned INTEGER NOT NULL DEFAULT 0,
    sessions_suggested INTEGER NOT NULL DEFAULT 0,
    sessions_assigned INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    rolled_back_at TEXT,
    rollback_reverted INTEGER NOT NULL DEFAULT 0,
    rollback_skipped INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS assignment_auto_run_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    session_id INTEGER NOT NULL,
    app_id INTEGER NOT NULL,
    from_project_id INTEGER,
    to_project_id INTEGER NOT NULL,
    suggestion_id INTEGER,
    confidence REAL NOT NULL,
    evidence_count INTEGER NOT NULL,
    applied_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES assignment_auto_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_assignment_model_app_app ON assignment_model_app(app_id);
CREATE INDEX IF NOT EXISTS idx_assignment_model_token_token ON assignment_model_token(token);
CREATE INDEX IF NOT EXISTS idx_assignment_model_time_key ON assignment_model_time(app_id, hour_bucket, weekday);
CREATE INDEX IF NOT EXISTS idx_assignment_feedback_created ON assignment_feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_assignment_feedback_source ON assignment_feedback(source);
CREATE INDEX IF NOT EXISTS idx_assignment_suggestions_session ON assignment_suggestions(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignment_suggestions_status ON assignment_suggestions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_assignment_auto_runs_started ON assignment_auto_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignment_auto_runs_rollback ON assignment_auto_runs(rolled_back_at);
CREATE INDEX IF NOT EXISTS idx_assignment_auto_run_items_run ON assignment_auto_run_items(run_id);
CREATE INDEX IF NOT EXISTS idx_assignment_auto_run_items_session ON assignment_auto_run_items(session_id);

CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"#;

const PRIMARY_DB_FILE_NAME: &str = "timeflow_dashboard.db";
const DEMO_DB_FILE_NAME: &str = "timeflow_dashboard_demo.db";
const DB_MODE_FILE_NAME: &str = "timeflow_dashboard_mode.json";
const LEGACY_PRIMARY_DB_FILE_NAME: &str = "cfab_dashboard.db";
const LEGACY_DEMO_DB_FILE_NAME: &str = "cfab_dashboard_demo.db";
const LEGACY_DB_MODE_FILE_NAME: &str = "cfab_dashboard_mode.json";

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
        let preferred = appdata_path.join("TimeFlow");

        if !preferred.exists() {
            for legacy_name in ["conceptfab", "CfabDemon", "TimeFlowDemon"] {
                let legacy_dir = appdata_path.join(legacy_name);
                if !legacy_dir.exists() {
                    continue;
                }
                match std::fs::rename(&legacy_dir, &preferred) {
                    Ok(_) => {
                        log::info!(
                            "Migrated app storage dir '{}' -> '{}'",
                            legacy_dir.display(),
                            preferred.display()
                        );
                        break;
                    }
                    Err(e) => {
                        log::warn!(
                            "Failed to migrate app storage dir '{}' -> '{}': {}",
                            legacy_dir.display(),
                            preferred.display(),
                            e
                        );
                    }
                }
            }
        }

        preferred
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

pub async fn initialize(app: &AppHandle) -> Result<(), String> {
    let demo_mode = read_persisted_demo_mode(app);
    let path = active_db_path_for_mode(app, demo_mode);
    let path_str = path.to_string_lossy().to_string();

    log::info!(
        "Database path: {} (mode: {})",
        path_str,
        if demo_mode { "demo" } else { "primary" }
    );

    initialize_database_file(&path_str)?;

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
                            let diff = chrono::Local::now().signed_duration_since(last.with_timezone(&chrono::Local));
                            diff.num_days() >= interval_days
                        } else {
                            true
                        }
                    },
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
    }

    // Store db path for later use
    app.manage(DbPath(Mutex::new(path_str)));
    app.manage(DemoModeFlag(Mutex::new(demo_mode)));

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

pub fn perform_backup_internal(db: &rusqlite::Connection, backup_dir: &str) -> Result<String, String> {
    let dest_dir = std::path::Path::new(backup_dir);
    if !dest_dir.exists() {
        std::fs::create_dir_all(dest_dir).map_err(|e| format!("Failed to create backup directory: {}", e))?;
    }
    
    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let file_name = format!("timeflow_backup_{}.db", timestamp);
    let dest_path = dest_dir.join(file_name);
    
    // Flush WAL
    db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| format!("WAL checkpoint failed: {}", e))?;

    let escaped_path = dest_path.to_string_lossy().replace('\'', "''");
    let sql = format!("VACUUM INTO '{}'", escaped_path);
    
    db.execute_batch(&sql).map_err(|e| format!("Backup VACUUM INTO failed: {}", e))?;
    
    Ok(dest_path.to_string_lossy().to_string())
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

fn run_migrations(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    // Ensure vital system tables exist
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );"
    )?;

    let has_projects_excluded_at: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name='excluded_at'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_projects_excluded_at {
        log::info!("Migrating projects: adding excluded_at");
        db.execute("ALTER TABLE projects ADD COLUMN excluded_at TEXT", [])?;
    }

    // Backfill DB-level project blacklist from existing excluded projects.
    db.execute(
        "INSERT OR IGNORE INTO project_name_blacklist (name, name_key, created_at)
         SELECT name, lower(trim(name)), COALESCE(excluded_at, datetime('now'))
         FROM projects
         WHERE excluded_at IS NOT NULL AND trim(name) <> ''",
        [],
    )?;

    // Check if file_activities has old schema (session_id column but no app_id column)
    let has_session_id: bool = db
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('file_activities') WHERE name='session_id'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    let has_app_id: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('file_activities') WHERE name='app_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if has_session_id && !has_app_id {
        log::info!("Migrating file_activities: old session-based schema -> app+date schema");

        // Migrate data: create new table, copy data, swap
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS file_activities_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id INTEGER NOT NULL,
                date TEXT NOT NULL,
                file_name TEXT NOT NULL,
                total_seconds INTEGER NOT NULL,
                first_seen TEXT NOT NULL,
                last_seen TEXT NOT NULL,
                FOREIGN KEY (app_id) REFERENCES applications(id),
                UNIQUE(app_id, date, file_name)
            );

            INSERT OR REPLACE INTO file_activities_new (app_id, date, file_name, total_seconds, first_seen, last_seen)
            SELECT s.app_id, s.date, fa.file_name, MAX(fa.total_seconds), MIN(fa.first_seen), MAX(fa.last_seen)
            FROM file_activities fa
            JOIN sessions s ON s.id = fa.session_id
            GROUP BY s.app_id, s.date, fa.file_name;

            DROP TABLE file_activities;
            ALTER TABLE file_activities_new RENAME TO file_activities;

            CREATE INDEX IF NOT EXISTS idx_file_activities_app_id ON file_activities(app_id);
            CREATE INDEX IF NOT EXISTS idx_file_activities_date ON file_activities(date);",
        )?;
        log::info!("file_activities migration complete");
    }

    // Add manual_sessions table if it doesn't exist
    let has_manual_sessions: bool = db
        .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='manual_sessions'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_manual_sessions {
        log::info!("Creating manual_sessions table");
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS manual_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                session_type TEXT NOT NULL DEFAULT 'other',
                project_id INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                date TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_manual_sessions_project_id ON manual_sessions(project_id);
            CREATE INDEX IF NOT EXISTS idx_manual_sessions_date ON manual_sessions(date);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_sessions_unique ON manual_sessions(project_id, start_time, title);",
        )?;
    }

    // Deduplicate existing manual_sessions before adding unique index (migration for existing DBs)
    {
        let has_unique_idx: bool = db
            .prepare(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_manual_sessions_unique'",
            )?
            .query_row([], |row| row.get::<_, i64>(0))
            .map(|c| c > 0)
            .unwrap_or(false);
        if !has_unique_idx {
            log::info!("Deduplicating manual_sessions and adding unique index");
            db.execute_batch(
                "DELETE FROM manual_sessions WHERE id NOT IN (
                    SELECT MIN(id) FROM manual_sessions
                    GROUP BY project_id, start_time, title
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_sessions_unique ON manual_sessions(project_id, start_time, title);",
            )?;
            log::info!("Running VACUUM after manual_sessions dedup");
            db.execute_batch("VACUUM;")?;
        } else {
            // One-time VACUUM for DBs where dedup ran but VACUUM didn't
            let page_count: i64 = db
                .pragma_query_value(None, "page_count", |row| row.get(0))
                .unwrap_or(0);
            let freelist_count: i64 = db
                .pragma_query_value(None, "freelist_count", |row| row.get(0))
                .unwrap_or(0);
            if freelist_count > page_count / 4 {
                log::info!("DB has {} free pages out of {} — running VACUUM", freelist_count, page_count);
                db.execute_batch("VACUUM;")?;
            }
        }
    }

    // Ensure sessions has UNIQUE(app_id, start_time) - recreate if needed
    // Check by trying to create the unique index; if it fails, the constraint already exists or we need to dedupe
    let has_unique: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_index_list('sessions') WHERE origin='u'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_unique {
        log::info!("Migrating sessions: adding UNIQUE(app_id, start_time)");
        // Remove duplicates first (keep the one with highest duration)
        db.execute_batch(
            "DELETE FROM sessions WHERE id NOT IN (
                SELECT id FROM sessions s1
                WHERE duration_seconds = (
                    SELECT MAX(duration_seconds) FROM sessions s2
                    WHERE s2.app_id = s1.app_id AND s2.start_time = s1.start_time
                )
                GROUP BY app_id, start_time
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_app_start_unique
            ON sessions(app_id, start_time);",
        )?;
        log::info!("sessions unique constraint migration complete");
    }

    // Add is_imported column if missing
    let has_projects_imported: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name='is_imported'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_projects_imported {
        log::info!("Migrating projects: adding is_imported");
        db.execute(
            "ALTER TABLE projects ADD COLUMN is_imported INTEGER DEFAULT 0",
            [],
        )?;
    }

    let has_projects_assigned_folder: bool = db
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name='assigned_folder_path'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_projects_assigned_folder {
        log::info!("Migrating projects: adding assigned_folder_path");
        db.execute(
            "ALTER TABLE projects ADD COLUMN assigned_folder_path TEXT",
            [],
        )?;
    }

    let has_apps_imported: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('applications') WHERE name='is_imported'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_apps_imported {
        log::info!("Migrating applications: adding is_imported");
        db.execute(
            "ALTER TABLE applications ADD COLUMN is_imported INTEGER DEFAULT 0",
            [],
        )?;
    }

    let has_apps_color: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('applications') WHERE name='color'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_apps_color {
        log::info!("Migrating applications: adding color");
        db.execute(
            "ALTER TABLE applications ADD COLUMN color TEXT DEFAULT NULL",
            [],
        )?;
    }

    // Add project_id to file_activities if missing
    let has_file_activities_project_id: bool = db
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('file_activities') WHERE name='project_id'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_file_activities_project_id {
        log::info!("Migrating file_activities: adding project_id");
        db.execute(
            "ALTER TABLE file_activities ADD COLUMN project_id INTEGER DEFAULT NULL",
            [],
        )?;
        // Optional backfill from applications:
        db.execute(
            "UPDATE file_activities
             SET project_id = (SELECT project_id FROM applications WHERE applications.id = file_activities.app_id)",
            []
        )?;
    }

    let has_sessions_project_id: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='project_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_sessions_project_id {
        log::info!("Migrating sessions: adding project_id");
        db.execute(
            "ALTER TABLE sessions ADD COLUMN project_id INTEGER DEFAULT NULL",
            [],
        )?;
    }

    let has_sessions_is_hidden: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='is_hidden'")
        .and_then(|mut s| s.query_row([], |row| row.get::<_, i64>(0)))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_sessions_is_hidden {
        log::info!("Migrating sessions: adding is_hidden");
        db.execute(
            "ALTER TABLE sessions ADD COLUMN is_hidden INTEGER DEFAULT 0",
            [],
        )?;
    }

    let has_sessions_rate_multiplier: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='rate_multiplier'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_sessions_rate_multiplier {
        log::info!("Migrating sessions: adding rate_multiplier");
        db.execute(
            "ALTER TABLE sessions ADD COLUMN rate_multiplier REAL NOT NULL DEFAULT 1.0",
            [],
        )?;
    } else {
        // Normalize any legacy null/invalid values to 1.0.
        db.execute(
            "UPDATE sessions
             SET rate_multiplier = 1.0
             WHERE rate_multiplier IS NULL OR rate_multiplier <= 0",
            [],
        )
        .ok();
    }

    // Clean up '(background)' entries (which were pseudo-projects) on startup
    // Normal project names matching app display names shouldn't be deleted implicitly here
    db.execute(
        "UPDATE file_activities SET project_id = NULL
         WHERE project_id IN (SELECT id FROM projects WHERE LOWER(name) = '(background)')",
        [],
    )
    .ok();

    db.execute(
        "UPDATE sessions SET project_id = NULL
         WHERE project_id IN (SELECT id FROM projects WHERE LOWER(name) = '(background)')",
        [],
    )
    .ok();

    let cleaned = db
        .execute(
            "DELETE FROM projects WHERE LOWER(name) = '(background)'",
            [],
        )
        .unwrap_or(0);

    if cleaned > 0 {
        log::info!("Removed {} '(background)' pseudo-project(s)", cleaned);
    }

    let has_projects_hourly_rate: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name='hourly_rate'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_projects_hourly_rate {
        log::info!("Migrating projects: adding hourly_rate");
        db.execute("ALTER TABLE projects ADD COLUMN hourly_rate REAL", [])?;
    }

    let has_projects_frozen_at: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name='frozen_at'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_projects_frozen_at {
        log::info!("Migrating projects: adding frozen_at");
        db.execute("ALTER TABLE projects ADD COLUMN frozen_at TEXT", [])?;
    }

    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS estimate_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
    )?;

    // Seed default global hourly rate
    db.execute(
        "INSERT OR IGNORE INTO estimate_settings (key, value, updated_at) VALUES ('global_hourly_rate', '100', datetime('now'))",
        [],
    )?;

    let has_sessions_comment: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='comment'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_sessions_comment {
        log::info!("Migrating sessions: adding comment");
        db.execute("ALTER TABLE sessions ADD COLUMN comment TEXT", [])?;
    }

    Ok(())
}

fn ensure_post_migration_indexes(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    // These indexes require file_activities(app_id, date); create them after migrations.
    db.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_file_activities_app_id ON file_activities(app_id);
         CREATE INDEX IF NOT EXISTS idx_file_activities_date ON file_activities(date);
         CREATE INDEX IF NOT EXISTS idx_file_activities_app_date ON file_activities(app_id, date);",
    )?;
    Ok(())
}

fn rusqlite_open(path: &str) -> Result<rusqlite::Connection, rusqlite::Error> {
    let conn = rusqlite::Connection::open(path)?;
    conn.busy_timeout(std::time::Duration::from_millis(5000))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;",
    )?;
    Ok(conn)
}

pub fn get_connection(app: &AppHandle) -> Result<rusqlite::Connection, String> {
    let db_path = app
        .try_state::<DbPath>()
        .ok_or_else(|| "DbPath state unavailable (database not initialized)".to_string())?;
    let path = db_path
        .0
        .lock()
        .map_err(|_| "DbPath mutex poisoned".to_string())?
        .clone();
    rusqlite_open(&path).map_err(|e| e.to_string())
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

    initialize_database_file(&target_path_str)?;
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

    log::info!(
        "Switched dashboard database mode to {} ({})",
        if enabled { "demo" } else { "primary" },
        target_path_str
    );

    get_demo_mode_status(app)
}
