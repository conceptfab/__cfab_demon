/// Migration 14: Create sync_markers table for LAN sync state tracking.
/// Stores a marker after each successful synchronization so peers can
/// determine whether a delta or full sync is needed.
pub fn run(tx: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS sync_markers (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            marker_hash TEXT    NOT NULL,
            created_at  TEXT    NOT NULL,
            device_id   TEXT    NOT NULL,
            peer_id     TEXT,
            tables_hash TEXT    NOT NULL,
            full_sync   INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_sync_markers_created
            ON sync_markers(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sync_markers_device
            ON sync_markers(device_id, created_at DESC);",
    )?;

    log::info!("Migration m14: created sync_markers table");
    Ok(())
}
