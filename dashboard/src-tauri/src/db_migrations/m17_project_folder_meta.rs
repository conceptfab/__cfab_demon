use rusqlite::Connection;

pub fn run(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "ALTER TABLE project_folders ADD COLUMN color TEXT NOT NULL DEFAULT '';
         ALTER TABLE project_folders ADD COLUMN category TEXT NOT NULL DEFAULT '';
         ALTER TABLE project_folders ADD COLUMN badge TEXT NOT NULL DEFAULT '';",
    )?;
    Ok(())
}
