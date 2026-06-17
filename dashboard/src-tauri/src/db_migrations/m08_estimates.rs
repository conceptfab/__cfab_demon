pub fn run(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
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
