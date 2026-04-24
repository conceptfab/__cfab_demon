use rusqlite::Connection;

pub fn run(tx: &Connection) -> Result<(), rusqlite::Error> {
    tx.execute("DROP TRIGGER IF EXISTS trg_sessions_tombstone", [])?;
    tx.execute(
        "CREATE TRIGGER IF NOT EXISTS trg_sessions_tombstone
         AFTER DELETE ON sessions
         FOR EACH ROW
         BEGIN
             INSERT INTO tombstones (table_name, record_id, sync_key)
             VALUES (
                 'sessions',
                 OLD.id,
                 COALESCE(
                     (SELECT executable_name FROM applications WHERE id = OLD.app_id),
                     CAST(OLD.app_id AS TEXT)
                 ) || '|' || OLD.start_time
             );
         END;",
        [],
    )?;

    Ok(())
}
