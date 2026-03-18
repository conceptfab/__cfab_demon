pub fn run(db: &rusqlite::Transaction) -> Result<(), rusqlite::Error> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS session_project_cache (
            session_id INTEGER PRIMARY KEY,
            session_date TEXT NOT NULL,
            app_id INTEGER NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            project_id INTEGER,
            multiplier REAL NOT NULL,
            duration_seconds REAL NOT NULL,
            comment TEXT,
            built_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_session_project_cache_date
        ON session_project_cache(session_date);
        CREATE INDEX IF NOT EXISTS idx_session_project_cache_project_date
        ON session_project_cache(project_id, session_date);

        CREATE TABLE IF NOT EXISTS session_project_cache_dirty (
            date TEXT PRIMARY KEY,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TRIGGER IF NOT EXISTS trg_sessions_cache_dirty_insert
        AFTER INSERT ON sessions
        FOR EACH ROW
        BEGIN
            INSERT INTO session_project_cache_dirty (date, updated_at)
            VALUES (NEW.date, CURRENT_TIMESTAMP)
            ON CONFLICT(date) DO UPDATE SET updated_at = CURRENT_TIMESTAMP;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_sessions_cache_dirty_update
        AFTER UPDATE ON sessions
        FOR EACH ROW
        BEGIN
            INSERT INTO session_project_cache_dirty (date, updated_at)
            VALUES (OLD.date, CURRENT_TIMESTAMP)
            ON CONFLICT(date) DO UPDATE SET updated_at = CURRENT_TIMESTAMP;
            INSERT INTO session_project_cache_dirty (date, updated_at)
            VALUES (NEW.date, CURRENT_TIMESTAMP)
            ON CONFLICT(date) DO UPDATE SET updated_at = CURRENT_TIMESTAMP;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_sessions_cache_dirty_delete
        AFTER DELETE ON sessions
        FOR EACH ROW
        BEGIN
            INSERT INTO session_project_cache_dirty (date, updated_at)
            VALUES (OLD.date, CURRENT_TIMESTAMP)
            ON CONFLICT(date) DO UPDATE SET updated_at = CURRENT_TIMESTAMP;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_file_activities_cache_dirty_insert
        AFTER INSERT ON file_activities
        FOR EACH ROW
        BEGIN
            INSERT INTO session_project_cache_dirty (date, updated_at)
            VALUES (NEW.date, CURRENT_TIMESTAMP)
            ON CONFLICT(date) DO UPDATE SET updated_at = CURRENT_TIMESTAMP;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_file_activities_cache_dirty_update
        AFTER UPDATE ON file_activities
        FOR EACH ROW
        BEGIN
            INSERT INTO session_project_cache_dirty (date, updated_at)
            VALUES (OLD.date, CURRENT_TIMESTAMP)
            ON CONFLICT(date) DO UPDATE SET updated_at = CURRENT_TIMESTAMP;
            INSERT INTO session_project_cache_dirty (date, updated_at)
            VALUES (NEW.date, CURRENT_TIMESTAMP)
            ON CONFLICT(date) DO UPDATE SET updated_at = CURRENT_TIMESTAMP;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_file_activities_cache_dirty_delete
        AFTER DELETE ON file_activities
        FOR EACH ROW
        BEGIN
            INSERT INTO session_project_cache_dirty (date, updated_at)
            VALUES (OLD.date, CURRENT_TIMESTAMP)
            ON CONFLICT(date) DO UPDATE SET updated_at = CURRENT_TIMESTAMP;
        END;

        INSERT OR REPLACE INTO session_project_cache_dirty (date, updated_at)
        SELECT DISTINCT date, CURRENT_TIMESTAMP
        FROM sessions;",
    )?;

    Ok(())
}
