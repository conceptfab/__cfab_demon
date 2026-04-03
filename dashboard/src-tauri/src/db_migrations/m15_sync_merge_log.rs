pub fn run(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS sync_merge_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sync_timestamp TEXT NOT NULL DEFAULT (datetime('now')),
            table_name TEXT NOT NULL,
            record_key TEXT NOT NULL,
            resolution TEXT NOT NULL DEFAULT 'last_writer_wins',
            local_updated_at TEXT,
            remote_updated_at TEXT,
            winner TEXT NOT NULL,
            details TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sync_merge_log_ts ON sync_merge_log(sync_timestamp);
        CREATE INDEX IF NOT EXISTS idx_sync_merge_log_table ON sync_merge_log(table_name, record_key);",
    )?;
    Ok(())
}
