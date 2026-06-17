use rusqlite::Connection;

/// Idempotentna wersja — pomija ALTER dla kolumn które są już w schema.sql.
pub fn run(conn: &Connection) -> Result<(), rusqlite::Error> {
    let has_column = |name: &str| -> Result<bool, rusqlite::Error> {
        conn.prepare(&format!(
            "SELECT COUNT(*) FROM pragma_table_info('project_folders') WHERE name='{}'",
            name
        ))?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
    };

    if !has_column("color")? {
        conn.execute_batch(
            "ALTER TABLE project_folders ADD COLUMN color TEXT NOT NULL DEFAULT '';",
        )?;
    }
    if !has_column("category")? {
        conn.execute_batch(
            "ALTER TABLE project_folders ADD COLUMN category TEXT NOT NULL DEFAULT '';",
        )?;
    }
    if !has_column("badge")? {
        conn.execute_batch(
            "ALTER TABLE project_folders ADD COLUMN badge TEXT NOT NULL DEFAULT '';",
        )?;
    }
    Ok(())
}
