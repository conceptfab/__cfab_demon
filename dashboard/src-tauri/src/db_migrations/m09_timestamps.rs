pub fn run(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
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
