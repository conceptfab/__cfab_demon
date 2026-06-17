use rusqlite::Connection;

pub fn run(tx: &Connection) -> Result<(), rusqlite::Error> {
    tx.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_sessions_updated_at
             ON sessions(updated_at);
         CREATE INDEX IF NOT EXISTS idx_manual_sessions_updated_at
             ON manual_sessions(updated_at);
         CREATE INDEX IF NOT EXISTS idx_sync_markers_created_at
             ON sync_markers(created_at);
         CREATE INDEX IF NOT EXISTS idx_tombstones_deleted_at
             ON tombstones(deleted_at);",
    )?;

    Ok(())
}
