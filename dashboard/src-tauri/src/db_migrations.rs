const LATEST_SCHEMA_VERSION: i64 = 9;

pub fn run_migrations(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER NOT NULL DEFAULT 0
        );",
    )?;

    let current_version: i64 = db
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if current_version >= LATEST_SCHEMA_VERSION {
        return Ok(());
    }

    // Run all pending migrations inside a transaction so that partial failures
    // don't leave the DB in an inconsistent state with an outdated schema_version.
    let tx = db.unchecked_transaction()?;

    if current_version < 1 {
        migrate_vital_tables_and_blacklist(&tx)?;
    }
    if current_version < 2 {
        migrate_file_activities_schema(&tx)?;
    }
    if current_version < 3 {
        migrate_manual_sessions(&tx)?;
    }
    if current_version < 4 {
        migrate_sessions_app_start_unique(&tx)?;
    }
    if current_version < 5 {
        migrate_project_and_app_metadata(&tx)?;
    }
    if current_version < 6 {
        migrate_file_activities_v2(&tx)?;
    }
    if current_version < 7 {
        migrate_sessions_v2_and_cleanup(&tx)?;
    }
    if current_version < 8 {
        migrate_estimates_and_split_source(&tx)?;
    }
    if current_version < 9 {
        migrate_timestamps_and_overrides(&tx)?;
    }

    tx.execute(
        "INSERT OR REPLACE INTO schema_version (rowid, version) VALUES (1, ?1)",
        [LATEST_SCHEMA_VERSION],
    )?;

    tx.commit()?;

    Ok(())
}

fn migrate_vital_tables_and_blacklist(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    // Ensure vital system tables exist
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
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
    Ok(())
}

fn migrate_file_activities_schema(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
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
                file_path TEXT NOT NULL,
                total_seconds INTEGER NOT NULL,
                first_seen TEXT NOT NULL,
                last_seen TEXT NOT NULL,
                project_id INTEGER,
                FOREIGN KEY (app_id) REFERENCES applications(id),
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
                UNIQUE(app_id, date, file_path)
            );

            INSERT OR REPLACE INTO file_activities_new (
                app_id, date, file_name, file_path, total_seconds, first_seen, last_seen, project_id
            )
            SELECT
                s.app_id,
                s.date,
                MIN(fa.file_name),
                CASE
                    WHEN TRIM(REPLACE(fa.file_name, '\\', '/')) = '' THEN '(unknown)'
                    ELSE TRIM(REPLACE(fa.file_name, '\\', '/'))
                END,
                MAX(fa.total_seconds),
                MIN(fa.first_seen),
                MAX(fa.last_seen),
                MAX(a.project_id)
            FROM file_activities fa
            JOIN sessions s ON s.id = fa.session_id
            LEFT JOIN applications a ON a.id = s.app_id
            GROUP BY s.app_id, s.date,
                CASE
                    WHEN TRIM(REPLACE(fa.file_name, '\\', '/')) = '' THEN '(unknown)'
                    ELSE TRIM(REPLACE(fa.file_name, '\\', '/'))
                END;

            DROP TABLE file_activities;
            ALTER TABLE file_activities_new RENAME TO file_activities;

            CREATE INDEX IF NOT EXISTS idx_file_activities_app_id ON file_activities(app_id);
            CREATE INDEX IF NOT EXISTS idx_file_activities_date ON file_activities(date);",
        )?;
        log::info!("file_activities migration complete");
    }
    Ok(())
}

fn migrate_manual_sessions(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
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
                app_id INTEGER,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                date TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_manual_sessions_project_id ON manual_sessions(project_id);
            CREATE INDEX IF NOT EXISTS idx_manual_sessions_app_id ON manual_sessions(app_id);
            CREATE INDEX IF NOT EXISTS idx_manual_sessions_date ON manual_sessions(date);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_sessions_unique ON manual_sessions(project_id, start_time, title);",
        )?;
    }

    // Deduplicate existing manual_sessions before adding unique index (migration for existing DBs)
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
        if page_count > 0 && freelist_count > page_count / 4 {
            log::info!(
                "DB has {} free pages out of {} — running VACUUM",
                freelist_count,
                page_count
            );
            db.execute_batch("VACUUM;")?;
        }
    }
    Ok(())
}

fn migrate_sessions_app_start_unique(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
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
    Ok(())
}

fn migrate_project_and_app_metadata(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
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
    Ok(())
}

fn migrate_file_activities_v2(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
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

    // Migrate file_activities to stable file path identity and unique(app_id, date, file_path).
    let has_file_activities_file_path: bool = db
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('file_activities') WHERE name='file_path'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    let file_activities_table_sql: String = db
        .query_row(
            "SELECT COALESCE(sql, '') FROM sqlite_master WHERE type='table' AND name='file_activities' LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap_or_default();
    let normalized_file_activities_sql = file_activities_table_sql
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_lowercase();
    let uses_legacy_unique =
        normalized_file_activities_sql.contains("unique(app_id,date,file_name)");

    if !has_file_activities_file_path || uses_legacy_unique {
        log::info!(
            "Migrating file_activities: rebuilding with file_path identity (has_file_path={}, legacy_unique={})",
            has_file_activities_file_path,
            uses_legacy_unique
        );
        if has_file_activities_file_path {
            db.execute_batch(
                "CREATE TABLE IF NOT EXISTS file_activities_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    app_id INTEGER NOT NULL,
                    date TEXT NOT NULL,
                    file_name TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    total_seconds INTEGER NOT NULL,
                    first_seen TEXT NOT NULL,
                    last_seen TEXT NOT NULL,
                    project_id INTEGER,
                    FOREIGN KEY (app_id) REFERENCES applications(id),
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
                    UNIQUE(app_id, date, file_path)
                );

                INSERT OR REPLACE INTO file_activities_new (
                    app_id, date, file_name, file_path, total_seconds, first_seen, last_seen, project_id
                )
                SELECT
                    app_id,
                    date,
                    MIN(file_name) AS file_name,
                    CASE
                        WHEN TRIM(REPLACE(COALESCE(file_path, file_name), '\\', '/')) = '' THEN '(unknown)'
                        ELSE TRIM(REPLACE(COALESCE(file_path, file_name), '\\', '/'))
                    END AS normalized_file_path,
                    MAX(total_seconds) AS total_seconds,
                    MIN(first_seen) AS first_seen,
                    MAX(last_seen) AS last_seen,
                    MAX(project_id) AS project_id
                FROM file_activities
                GROUP BY app_id, date,
                    CASE
                        WHEN TRIM(REPLACE(COALESCE(file_path, file_name), '\\', '/')) = '' THEN '(unknown)'
                        ELSE TRIM(REPLACE(COALESCE(file_path, file_name), '\\', '/'))
                    END;

                DROP TABLE file_activities;
                ALTER TABLE file_activities_new RENAME TO file_activities;",
            )?;
        } else {
            db.execute_batch(
                "CREATE TABLE IF NOT EXISTS file_activities_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    app_id INTEGER NOT NULL,
                    date TEXT NOT NULL,
                    file_name TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    total_seconds INTEGER NOT NULL,
                    first_seen TEXT NOT NULL,
                    last_seen TEXT NOT NULL,
                    project_id INTEGER,
                    FOREIGN KEY (app_id) REFERENCES applications(id),
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
                    UNIQUE(app_id, date, file_path)
                );

                INSERT OR REPLACE INTO file_activities_new (
                    app_id, date, file_name, file_path, total_seconds, first_seen, last_seen, project_id
                )
                SELECT
                    app_id,
                    date,
                    MIN(file_name) AS file_name,
                    CASE
                        WHEN TRIM(REPLACE(file_name, '\\', '/')) = '' THEN '(unknown)'
                        ELSE TRIM(REPLACE(file_name, '\\', '/'))
                    END AS normalized_file_path,
                    MAX(total_seconds) AS total_seconds,
                    MIN(first_seen) AS first_seen,
                    MAX(last_seen) AS last_seen,
                    MAX(project_id) AS project_id
                FROM file_activities
                GROUP BY app_id, date,
                    CASE
                        WHEN TRIM(REPLACE(file_name, '\\', '/')) = '' THEN '(unknown)'
                        ELSE TRIM(REPLACE(file_name, '\\', '/'))
                    END;

                DROP TABLE file_activities;
                ALTER TABLE file_activities_new RENAME TO file_activities;",
            )?;
        }
    }

    // Add window_title to file_activities (richer context for AI tokenization)
    let has_file_activities_window_title: bool = db
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('file_activities') WHERE name='window_title'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_file_activities_window_title {
        log::info!("Migrating file_activities: adding window_title");
        db.execute(
            "ALTER TABLE file_activities ADD COLUMN window_title TEXT DEFAULT NULL",
            [],
        )?;
    }

    let has_file_activities_detected_path: bool = db
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('file_activities') WHERE name='detected_path'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_file_activities_detected_path {
        log::info!("Migrating file_activities: adding detected_path");
        db.execute(
            "ALTER TABLE file_activities ADD COLUMN detected_path TEXT DEFAULT NULL",
            [],
        )?;
    }

    let has_file_activities_title_history: bool = db
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('file_activities') WHERE name='title_history'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_file_activities_title_history {
        log::info!("Migrating file_activities: adding title_history");
        db.execute(
            "ALTER TABLE file_activities ADD COLUMN title_history TEXT DEFAULT NULL",
            [],
        )?;
    }

    let has_file_activities_activity_type: bool = db
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('file_activities') WHERE name='activity_type'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_file_activities_activity_type {
        log::info!("Migrating file_activities: adding activity_type");
        db.execute(
            "ALTER TABLE file_activities ADD COLUMN activity_type TEXT DEFAULT NULL",
            [],
        )?;
    }
    Ok(())
}

fn migrate_sessions_v2_and_cleanup(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
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

    let has_projects_unfreeze_reason: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name='unfreeze_reason'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_projects_unfreeze_reason {
        log::info!("Migrating projects: adding unfreeze_reason");
        db.execute("ALTER TABLE projects ADD COLUMN unfreeze_reason TEXT", [])?;
    }
    Ok(())
}

fn migrate_estimates_and_split_source(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
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

    let has_sessions_split_source_session_id: bool = db
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='split_source_session_id'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_sessions_split_source_session_id {
        log::info!("Migrating sessions: adding split_source_session_id");
        db.execute(
            "ALTER TABLE sessions ADD COLUMN split_source_session_id INTEGER DEFAULT NULL",
            [],
        )?;
    }
    db.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_split_source_session_id ON sessions(split_source_session_id)",
        [],
    )
    .ok();
    // Backfill legacy split markers (older versions encoded split info in comment text only).
    db.execute(
        "UPDATE sessions
         SET split_source_session_id = id
         WHERE split_source_session_id IS NULL
           AND comment IS NOT NULL
           AND comment LIKE '%Split %/%'",
        [],
    )
    .ok();

    let has_assignment_feedback_weight: bool = db
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('assignment_feedback') WHERE name='weight'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_assignment_feedback_weight {
        log::info!("Migrating assignment_feedback: adding weight");
        db.execute(
            "ALTER TABLE assignment_feedback ADD COLUMN weight REAL NOT NULL DEFAULT 1.0",
            [],
        )?;
    }
    Ok(())
}

fn migrate_timestamps_and_overrides(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    let has_manual_sessions_app_id: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('manual_sessions') WHERE name='app_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_manual_sessions_app_id {
        log::info!("Migrating manual_sessions: adding app_id");
        db.execute("ALTER TABLE manual_sessions ADD COLUMN app_id INTEGER", [])?;
    }

    let has_projects_updated_at: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name='updated_at'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_projects_updated_at {
        log::info!("Migrating projects: adding updated_at");
        db.execute(
            "ALTER TABLE projects ADD COLUMN updated_at TIMESTAMP DEFAULT '2000-01-01 00:00:00'",
            [],
        )?;
        db.execute("UPDATE projects SET updated_at = CURRENT_TIMESTAMP", [])?;
    }

    let has_manual_sessions_updated_at: bool = db
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('manual_sessions') WHERE name='updated_at'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_manual_sessions_updated_at {
        log::info!("Migrating manual_sessions: adding updated_at");
        db.execute("ALTER TABLE manual_sessions ADD COLUMN updated_at TIMESTAMP DEFAULT '2000-01-01 00:00:00'", [])?;
        db.execute(
            "UPDATE manual_sessions SET updated_at = CURRENT_TIMESTAMP",
            [],
        )?;
    }

    let has_manual_overrides: bool = db
        .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='session_manual_overrides'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if has_manual_overrides {
        let has_session_manual_overrides_session_id: bool = db
            .prepare(
                "SELECT COUNT(*) FROM pragma_table_info('session_manual_overrides') WHERE name='session_id'",
            )?
            .query_row([], |row| row.get::<_, i64>(0))
            .map(|c| c > 0)
            .unwrap_or(false);
        if !has_session_manual_overrides_session_id {
            log::info!("Migrating session_manual_overrides: adding session_id");
            db.execute(
                "ALTER TABLE session_manual_overrides ADD COLUMN session_id INTEGER",
                [],
            )?;
        }

        db.execute(
            "UPDATE session_manual_overrides
             SET session_id = (
                SELECT s.id
                FROM sessions s
                JOIN applications a ON a.id = s.app_id
                WHERE lower(a.executable_name) = lower(session_manual_overrides.executable_name)
                  AND s.start_time = session_manual_overrides.start_time
                  AND s.end_time = session_manual_overrides.end_time
                ORDER BY s.id DESC
                LIMIT 1
             )
             WHERE session_id IS NULL",
            [],
        )
        .ok();

        db.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_session_manual_overrides_lookup
             ON session_manual_overrides(executable_name, start_time, end_time);
             CREATE UNIQUE INDEX IF NOT EXISTS idx_session_manual_overrides_session_id
             ON session_manual_overrides(session_id);",
        )
        .ok();
    }
    Ok(())
}

pub fn ensure_post_migration_indexes(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    // These indexes require file_activities(app_id, date); create them after migrations.
    db.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_file_activities_app_id ON file_activities(app_id);
         CREATE INDEX IF NOT EXISTS idx_file_activities_date ON file_activities(date);
         CREATE INDEX IF NOT EXISTS idx_file_activities_app_date ON file_activities(app_id, date);
         CREATE INDEX IF NOT EXISTS idx_file_activities_app_date_overlap ON file_activities(app_id, date, last_seen, first_seen);
         CREATE INDEX IF NOT EXISTS idx_file_activities_project_id ON file_activities(project_id);
         CREATE INDEX IF NOT EXISTS idx_file_activities_file_path ON file_activities(file_path);
         CREATE INDEX IF NOT EXISTS idx_sessions_app_date ON sessions(app_id, date, start_time);
         CREATE INDEX IF NOT EXISTS idx_sessions_date_standalone ON sessions(date);
         CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
         CREATE INDEX IF NOT EXISTS idx_assignment_feedback_session ON assignment_feedback(session_id, created_at DESC);",
    )?;

    let has_manual_overrides: bool = db
        .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='session_manual_overrides'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if has_manual_overrides {
        db.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_session_manual_overrides_lookup
             ON session_manual_overrides(executable_name, start_time, end_time);",
        )?;

        let has_session_id_column: bool = db
            .prepare(
                "SELECT COUNT(*) FROM pragma_table_info('session_manual_overrides') WHERE name='session_id'",
            )?
            .query_row([], |row| row.get::<_, i64>(0))
            .map(|c| c > 0)
            .unwrap_or(false);

        if has_session_id_column {
            if let Err(e) = db.execute_batch(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_session_manual_overrides_session_id
                 ON session_manual_overrides(session_id);",
            ) {
                log::warn!(
                    "Could not create idx_session_manual_overrides_session_id: {}",
                    e
                );
            }
        }
    }

    Ok(())
}
