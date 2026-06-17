pub fn run(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    // Ensure vital system tables exist
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
    )?;

    let has_projects_excluded_at: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name='excluded_at'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_projects_excluded_at {
        log::info!("Migrating projects: adding excluded_at");
        db.execute("ALTER TABLE projects ADD COLUMN excluded_at TEXT", [])?;
    }

    // Backfill DB-level project blacklist from existing excluded projects.
    db.execute(
        "INSERT OR IGNORE INTO project_name_blacklist (name, name_key, created_at)
         SELECT name, lower(trim(name)), COALESCE(excluded_at, datetime('now'))
         FROM projects
         WHERE excluded_at IS NOT NULL AND trim(name) <> ''",
        [],
    )?;
    Ok(())
}
