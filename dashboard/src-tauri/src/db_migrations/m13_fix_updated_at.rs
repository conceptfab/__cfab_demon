/// Fix updated_at for delta sync:
/// 1. Add INSERT triggers for sessions and applications so new records get updated_at = datetime('now')
/// 2. Backfill records that still have the epoch default ('1970-01-01 00:00:00')
pub fn run(tx: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    // 1. INSERT trigger for sessions — set updated_at on new rows
    tx.execute_batch(
        "CREATE TRIGGER IF NOT EXISTS trg_sessions_updated_at_insert
         AFTER INSERT ON sessions
         FOR EACH ROW
         WHEN NEW.updated_at = '1970-01-01 00:00:00' OR NEW.updated_at IS NULL
         BEGIN
             UPDATE sessions SET updated_at = datetime('now') WHERE id = NEW.id;
         END;",
    )?;

    // 2. INSERT trigger for applications — set updated_at on new rows
    tx.execute_batch(
        "CREATE TRIGGER IF NOT EXISTS trg_applications_updated_at_insert
         AFTER INSERT ON applications
         FOR EACH ROW
         WHEN NEW.updated_at = '1970-01-01 00:00:00' OR NEW.updated_at IS NULL
         BEGIN
             UPDATE applications SET updated_at = datetime('now') WHERE id = NEW.id;
         END;",
    )?;

    // 3. Backfill sessions still at epoch default
    tx.execute(
        "UPDATE sessions SET updated_at = datetime('now') WHERE updated_at = '1970-01-01 00:00:00'",
        [],
    )?;

    // 4. Backfill applications still at epoch default
    tx.execute(
        "UPDATE applications SET updated_at = datetime('now') WHERE updated_at = '1970-01-01 00:00:00'",
        [],
    )?;

    log::info!("Migration m13: added INSERT triggers for updated_at, backfilled epoch defaults");
    Ok(())
}
