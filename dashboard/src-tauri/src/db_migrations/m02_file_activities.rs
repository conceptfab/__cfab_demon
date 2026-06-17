pub fn run(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    // Check if file_activities has old schema (session_id column but no app_id column)
    let has_session_id: bool = db
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('file_activities') WHERE name='session_id'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    let has_app_id: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('file_activities') WHERE name='app_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if has_session_id && !has_app_id {
        log::info!("Migrating file_activities: old session-based schema -> app+date schema");

        // Migrate data: create new table, copy data, swap
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS file_activities_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id INTEGER NOT NULL,
                date TEXT NOT NULL,
                file_name TEXT NOT NULL,
                file_path TEXT NOT NULL,
                total_seconds INTEGER NOT NULL,
                first_seen TEXT NOT NULL,
                last_seen TEXT NOT NULL,
                project_id INTEGER,
                FOREIGN KEY (app_id) REFERENCES applications(id),
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
                UNIQUE(app_id, date, file_path)
            );

            INSERT OR REPLACE INTO file_activities_new (
                app_id, date, file_name, file_path, total_seconds, first_seen, last_seen, project_id
            )
            SELECT
                s.app_id,
                s.date,
                MIN(fa.file_name),
                CASE
                    WHEN TRIM(REPLACE(fa.file_name, '\\', '/')) = '' THEN '(unknown)'
                    ELSE TRIM(REPLACE(fa.file_name, '\\', '/'))
                END,
                MAX(fa.total_seconds),
                MIN(fa.first_seen),
                MAX(fa.last_seen),
                MAX(a.project_id)
            FROM file_activities fa
            JOIN sessions s ON s.id = fa.session_id
            LEFT JOIN applications a ON a.id = s.app_id
            GROUP BY s.app_id, s.date,
                CASE
                    WHEN TRIM(REPLACE(fa.file_name, '\\', '/')) = '' THEN '(unknown)'
                    ELSE TRIM(REPLACE(fa.file_name, '\\', '/'))
                END;

            DROP TABLE file_activities;
            ALTER TABLE file_activities_new RENAME TO file_activities;

            CREATE INDEX IF NOT EXISTS idx_file_activities_app_id ON file_activities(app_id);
            CREATE INDEX IF NOT EXISTS idx_file_activities_date ON file_activities(date);",
        )?;
        log::info!("file_activities migration complete");
    }
    Ok(())
}
