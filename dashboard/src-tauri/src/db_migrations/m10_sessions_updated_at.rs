/// Adds `updated_at` column to `sessions` table with an auto-update trigger.
/// This enables optimistic concurrency guards (e.g., auto-split checking
/// whether a user modified a session since the cycle started).
///
/// Idempotent: przy świeżej bazie kolumna `updated_at` może już istnieć
/// (m01 tworzy ją w schema), więc ALTER pomijamy; trigger używa
/// `CREATE TRIGGER IF NOT EXISTS`.
pub fn run(conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    let has_updated_at: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='updated_at'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_updated_at {
        conn.execute_batch(
            "ALTER TABLE sessions ADD COLUMN updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00';

             UPDATE sessions SET updated_at = COALESCE(
                 (SELECT MAX(created_at) FROM assignment_feedback WHERE session_id = sessions.id),
                 datetime('now')
             );",
        )?;
    }

    conn.execute_batch(
        "CREATE TRIGGER IF NOT EXISTS trg_sessions_updated_at
         AFTER UPDATE OF app_id, start_time, end_time, duration_seconds, date,
                         rate_multiplier, project_id, split_source_session_id, comment
         ON sessions
         FOR EACH ROW
         WHEN NEW.updated_at IS OLD.updated_at
         BEGIN
             UPDATE sessions SET updated_at = datetime('now') WHERE id = OLD.id;
         END;",
    )?;
    Ok(())
}
