use rusqlite::Connection;

/// Migration 16: Add activity_spans column to file_activities.
/// For existing rows, generate a single span from (first_seen, last_seen).
///
/// Idempotent: przy świeżej bazie kolumna jest już w schema.sql, więc ALTER
/// pomijamy (inaczej SQLite rzuca "duplicate column name").
pub fn run(db: &Connection) -> Result<(), rusqlite::Error> {
    let has_activity_spans: bool = db
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('file_activities') WHERE name='activity_spans'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_activity_spans {
        db.execute_batch(
            "ALTER TABLE file_activities ADD COLUMN activity_spans TEXT NOT NULL DEFAULT '[]';",
        )?;
    }

    // Backfill: create a single span [first_seen, last_seen] for every existing row
    db.execute_batch(
        "UPDATE file_activities
         SET activity_spans = '[' || '[\"' || first_seen || '\",\"' || last_seen || '\"]' || ']'
         WHERE first_seen != '' AND last_seen != '' AND activity_spans = '[]';",
    )?;

    Ok(())
}
