use rusqlite::Connection;

/// Migration 16: Add activity_spans column to file_activities.
/// For existing rows, generate a single span from (first_seen, last_seen).
pub fn run(db: &Connection) -> Result<(), rusqlite::Error> {
    db.execute_batch(
        "ALTER TABLE file_activities ADD COLUMN activity_spans TEXT NOT NULL DEFAULT '[]';",
    )?;

    // Backfill: create a single span [first_seen, last_seen] for every existing row
    db.execute_batch(
        "UPDATE file_activities
         SET activity_spans = '[' || '[\"' || first_seen || '\",\"' || last_seen || '\"]' || ']'
         WHERE first_seen != '' AND last_seen != '' AND activity_spans = '[]';",
    )?;

    Ok(())
}
