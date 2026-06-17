pub fn run(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    // Add project_id to file_activities if missing
    let has_file_activities_project_id: bool = db
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('file_activities') WHERE name='project_id'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_file_activities_project_id {
        log::info!("Migrating file_activities: adding project_id");
        db.execute(
            "ALTER TABLE file_activities ADD COLUMN project_id INTEGER DEFAULT NULL",
            [],
        )?;
        // Optional backfill from applications:
        db.execute(
            "UPDATE file_activities
             SET project_id = (SELECT project_id FROM applications WHERE applications.id = file_activities.app_id)",
            []
        )?;
    }

    // Migrate file_activities to stable file path identity and unique(app_id, date, file_path).
    let has_file_activities_file_path: bool = db
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('file_activities') WHERE name='file_path'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    let file_activities_table_sql: String = db
        .query_row(
            "SELECT COALESCE(sql, '') FROM sqlite_master WHERE type='table' AND name='file_activities' LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap_or_default();
    let normalized_file_activities_sql = file_activities_table_sql
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_lowercase();
    let uses_legacy_unique =
        normalized_file_activities_sql.contains("unique(app_id,date,file_name)");

    if !has_file_activities_file_path || uses_legacy_unique {
        log::info!(
            "Migrating file_activities: rebuilding with file_path identity (has_file_path={}, legacy_unique={})",
            has_file_activities_file_path,
            uses_legacy_unique
        );
        if has_file_activities_file_path {
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
                    app_id,
                    date,
                    MIN(file_name) AS file_name,
                    CASE
                        WHEN TRIM(REPLACE(COALESCE(file_path, file_name), '\\', '/')) = '' THEN '(unknown)'
                        ELSE TRIM(REPLACE(COALESCE(file_path, file_name), '\\', '/'))
                    END AS normalized_file_path,
                    MAX(total_seconds) AS total_seconds,
                    MIN(first_seen) AS first_seen,
                    MAX(last_seen) AS last_seen,
                    MAX(project_id) AS project_id
                FROM file_activities
                GROUP BY app_id, date,
                    CASE
                        WHEN TRIM(REPLACE(COALESCE(file_path, file_name), '\\', '/')) = '' THEN '(unknown)'
                        ELSE TRIM(REPLACE(COALESCE(file_path, file_name), '\\', '/'))
                    END;

                DROP TABLE file_activities;
                ALTER TABLE file_activities_new RENAME TO file_activities;",
            )?;
        } else {
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
                    app_id,
                    date,
                    MIN(file_name) AS file_name,
                    CASE
                        WHEN TRIM(REPLACE(file_name, '\\', '/')) = '' THEN '(unknown)'
                        ELSE TRIM(REPLACE(file_name, '\\', '/'))
                    END AS normalized_file_path,
                    MAX(total_seconds) AS total_seconds,
                    MIN(first_seen) AS first_seen,
                    MAX(last_seen) AS last_seen,
                    MAX(project_id) AS project_id
                FROM file_activities
                GROUP BY app_id, date,
                    CASE
                        WHEN TRIM(REPLACE(file_name, '\\', '/')) = '' THEN '(unknown)'
                        ELSE TRIM(REPLACE(file_name, '\\', '/'))
                    END;

                DROP TABLE file_activities;
                ALTER TABLE file_activities_new RENAME TO file_activities;",
            )?;
        }
    }

    // Add window_title to file_activities (richer context for AI tokenization)
    let has_file_activities_window_title: bool = db
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('file_activities') WHERE name='window_title'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_file_activities_window_title {
        log::info!("Migrating file_activities: adding window_title");
        db.execute(
            "ALTER TABLE file_activities ADD COLUMN window_title TEXT DEFAULT NULL",
            [],
        )?;
    }

    let has_file_activities_detected_path: bool = db
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('file_activities') WHERE name='detected_path'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_file_activities_detected_path {
        log::info!("Migrating file_activities: adding detected_path");
        db.execute(
            "ALTER TABLE file_activities ADD COLUMN detected_path TEXT DEFAULT NULL",
            [],
        )?;
    }

    let has_file_activities_title_history: bool = db
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('file_activities') WHERE name='title_history'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_file_activities_title_history {
        log::info!("Migrating file_activities: adding title_history");
        db.execute(
            "ALTER TABLE file_activities ADD COLUMN title_history TEXT DEFAULT NULL",
            [],
        )?;
    }

    let has_file_activities_activity_type: bool = db
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('file_activities') WHERE name='activity_type'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_file_activities_activity_type {
        log::info!("Migrating file_activities: adding activity_type");
        db.execute(
            "ALTER TABLE file_activities ADD COLUMN activity_type TEXT DEFAULT NULL",
            [],
        )?;
    }
    Ok(())
}
