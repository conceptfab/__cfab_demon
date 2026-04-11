use rusqlite::Connection;

pub fn run(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS project_folder_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            token TEXT NOT NULL,
            count INTEGER NOT NULL DEFAULT 1,
            scanned_at TEXT NOT NULL,
            UNIQUE(project_id, token)
        );
        CREATE INDEX IF NOT EXISTS idx_pft_token ON project_folder_tokens(token);",
    )?;
    Ok(())
}
