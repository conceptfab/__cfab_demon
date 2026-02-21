use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#38bdf8',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    excluded_at TEXT,
    assigned_folder_path TEXT,
    is_imported INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    executable_name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    project_id INTEGER,
    color TEXT DEFAULT NULL,
    is_imported INTEGER DEFAULT 0,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    date TEXT NOT NULL,
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
    FOREIGN KEY (run_id) REFERENCES assignment_auto_runs(id) ON DELETE CASCADE
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
"#;

pub fn db_path(app: &AppHandle) -> PathBuf {
    let app_dir = std::env::var("APPDATA")
        .map(PathBuf::from)
        .map(|p| p.join("conceptfab"))
        .unwrap_or_else(|_| {
            app.path()
                .app_data_dir()
                .expect("Failed to get app data dir")
        });
    std::fs::create_dir_all(&app_dir).ok();
    let db_path = app_dir.join("cfab_dashboard.db");

    // One-time migration from legacy Tauri app_data_dir location.
    if !db_path.exists() {
        if let Ok(legacy_dir) = app.path().app_data_dir() {
            let legacy_db = legacy_dir.join("cfab_dashboard.db");
            if legacy_db.exists() {
                if let Err(e) = std::fs::copy(&legacy_db, &db_path) {
                    log::warn!(
                        "Failed to migrate legacy database '{}' -> '{}': {}",
                        legacy_db.display(),
                        db_path.display(),
                        e
                    );
                } else {
                    log::info!(
                        "Migrated legacy database '{}' -> '{}'",
                        legacy_db.display(),
                        db_path.display()
                    );
                }
            }
        }
    }

    db_path
}

pub async fn initialize(app: &AppHandle) -> Result<(), String> {
    let path = db_path(app);
    let path_str = path.to_string_lossy().to_string();

    log::info!("Database path: {}", path_str);

    let db = rusqlite_open(&path_str).map_err(|e| e.to_string())?;

    db.execute_batch(SCHEMA)
        .map_err(|e| format!("Schema error: {}", e))?;

    // Run migrations for existing databases
    run_migrations(&db).map_err(|e| format!("Migration error: {}", e))?;
    ensure_post_migration_indexes(&db).map_err(|e| format!("Index creation error: {}", e))?;

    // Store db path for later use
    app.manage(DbPath(path_str));

    Ok(())
}

pub struct DbPath(pub String);

fn run_migrations(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    let has_projects_excluded_at: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name='excluded_at'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_projects_excluded_at {
        log::info!("Migrating projects: adding excluded_at");
        db.execute("ALTER TABLE projects ADD COLUMN excluded_at TEXT", [])?;
    }

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
            CREATE INDEX IF NOT EXISTS idx_manual_sessions_date ON manual_sessions(date);",
        )?;
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

    // Clean up projects that match application display names (e.g. "Antigravity" auto-created from app name)
    // First clear references so they don't become orphaned "(background)" entries
    db.execute(
        "UPDATE file_activities SET project_id = NULL
         WHERE project_id IN (
             SELECT p.id FROM projects p
             JOIN applications a ON LOWER(p.name) = LOWER(a.display_name)
         ) OR project_id IN (SELECT id FROM projects WHERE LOWER(name) = '(background)')",
        [],
    ).ok();
    db.execute(
        "UPDATE sessions SET project_id = NULL
         WHERE project_id IN (
             SELECT p.id FROM projects p
             JOIN applications a ON LOWER(p.name) = LOWER(a.display_name)
         ) OR project_id IN (SELECT id FROM projects WHERE LOWER(name) = '(background)')",
        [],
    ).ok();
    let cleaned = db.execute(
        "DELETE FROM projects WHERE LOWER(name) IN (SELECT LOWER(display_name) FROM applications) OR LOWER(name) = '(background)'",
        [],
    ).unwrap_or(0);
    if cleaned > 0 {
        log::info!("Removed {} project(s) that matched application display names or were named (background)", cleaned);
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
    rusqlite_open(&db_path.0).map_err(|e| e.to_string())
}
