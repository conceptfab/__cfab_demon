use rusqlite::Connection;

pub fn run(tx: &Connection) -> Result<(), rusqlite::Error> {
    // 1. Add updated_at to applications if it doesn't exist
    let has_updated_at: bool = tx
        .prepare("SELECT COUNT(*) FROM pragma_table_info('applications') WHERE name='updated_at'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_updated_at {
        tx.execute(
            "ALTER TABLE applications ADD COLUMN updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'",
            [],
        )?;
        tx.execute(
            "UPDATE applications SET updated_at = datetime('now')",
            [],
        )?;
    }

    // 2. Trigger to auto-update applications.updated_at
    tx.execute(
        "CREATE TRIGGER IF NOT EXISTS trg_applications_updated_at
         AFTER UPDATE OF executable_name, display_name, project_id, is_imported
         ON applications
         FOR EACH ROW
         WHEN NEW.updated_at IS OLD.updated_at
         BEGIN
             UPDATE applications SET updated_at = datetime('now') WHERE id = OLD.id;
         END;",
        [],
    )?;

    // 3. Tombstones triggers for delta sync deletions
    tx.execute(
        "CREATE TRIGGER IF NOT EXISTS trg_sessions_tombstone
         AFTER DELETE ON sessions
         FOR EACH ROW
         BEGIN
             INSERT INTO tombstones (table_name, record_id, sync_key)
             VALUES ('sessions', OLD.id, OLD.app_id || '|' || OLD.start_time);
         END;",
        [],
    )?;

    tx.execute(
        "CREATE TRIGGER IF NOT EXISTS trg_applications_tombstone
         AFTER DELETE ON applications
         FOR EACH ROW
         BEGIN
             INSERT INTO tombstones (table_name, record_id, sync_key)
             VALUES ('applications', OLD.id, OLD.executable_name);
         END;",
        [],
    )?;

    Ok(())
}
