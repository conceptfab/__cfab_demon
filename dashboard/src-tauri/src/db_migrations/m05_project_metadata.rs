pub fn run(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    let has_projects_imported: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name='is_imported'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_projects_imported {
        log::info!("Migrating projects: adding is_imported");
        db.execute(
            "ALTER TABLE projects ADD COLUMN is_imported INTEGER DEFAULT 0",
            [],
        )?;
    }

    let has_projects_assigned_folder: bool = db
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name='assigned_folder_path'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_projects_assigned_folder {
        log::info!("Migrating projects: adding assigned_folder_path");
        db.execute(
            "ALTER TABLE projects ADD COLUMN assigned_folder_path TEXT",
            [],
        )?;
    }

    let has_apps_imported: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('applications') WHERE name='is_imported'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_apps_imported {
        log::info!("Migrating applications: adding is_imported");
        db.execute(
            "ALTER TABLE applications ADD COLUMN is_imported INTEGER DEFAULT 0",
            [],
        )?;
    }

    let has_apps_color: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('applications') WHERE name='color'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_apps_color {
        log::info!("Migrating applications: adding color");
        db.execute(
            "ALTER TABLE applications ADD COLUMN color TEXT DEFAULT NULL",
            [],
        )?;
    }
    Ok(())
}
