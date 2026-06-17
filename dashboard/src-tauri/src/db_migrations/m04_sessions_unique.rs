pub fn run(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
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
