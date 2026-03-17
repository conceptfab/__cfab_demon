pub fn run(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
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
