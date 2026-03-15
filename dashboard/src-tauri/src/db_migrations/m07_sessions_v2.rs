pub fn run(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    let has_sessions_project_id: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='project_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_sessions_project_id {
        log::info!("Migrating sessions: adding project_id");
        db.execute(
            "ALTER TABLE sessions ADD COLUMN project_id INTEGER DEFAULT NULL",
            [],
        )?;
    }

    let has_sessions_is_hidden: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='is_hidden'")
        .and_then(|mut s| s.query_row([], |row| row.get::<_, i64>(0)))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_sessions_is_hidden {
        log::info!("Migrating sessions: adding is_hidden");
        db.execute(
            "ALTER TABLE sessions ADD COLUMN is_hidden INTEGER DEFAULT 0",
            [],
        )?;
    }

    let has_sessions_rate_multiplier: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='rate_multiplier'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_sessions_rate_multiplier {
        log::info!("Migrating sessions: adding rate_multiplier");
        db.execute(
            "ALTER TABLE sessions ADD COLUMN rate_multiplier REAL NOT NULL DEFAULT 1.0",
            [],
        )?;
    } else {
        // Normalize any legacy null/invalid values to 1.0.
        db.execute(
            "UPDATE sessions
             SET rate_multiplier = 1.0
             WHERE rate_multiplier IS NULL OR rate_multiplier <= 0",
            [],
        )
        .ok();
    }

    // Clean up '(background)' entries (which were pseudo-projects) on startup
    // Normal project names matching app display names shouldn't be deleted implicitly here
    db.execute(
        "UPDATE file_activities SET project_id = NULL
         WHERE project_id IN (SELECT id FROM projects WHERE LOWER(name) = '(background)')",
        [],
    )
    .ok();

    db.execute(
        "UPDATE sessions SET project_id = NULL
         WHERE project_id IN (SELECT id FROM projects WHERE LOWER(name) = '(background)')",
        [],
    )
    .ok();

    let cleaned = db
        .execute(
            "DELETE FROM projects WHERE LOWER(name) = '(background)'",
            [],
        )
        .unwrap_or(0);

    if cleaned > 0 {
        log::info!("Removed {} '(background)' pseudo-project(s)", cleaned);
    }

    let has_projects_hourly_rate: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name='hourly_rate'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_projects_hourly_rate {
        log::info!("Migrating projects: adding hourly_rate");
        db.execute("ALTER TABLE projects ADD COLUMN hourly_rate REAL", [])?;
    }

    let has_projects_frozen_at: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name='frozen_at'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_projects_frozen_at {
        log::info!("Migrating projects: adding frozen_at");
        db.execute("ALTER TABLE projects ADD COLUMN frozen_at TEXT", [])?;
    }

    let has_projects_unfreeze_reason: bool = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name='unfreeze_reason'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_projects_unfreeze_reason {
        log::info!("Migrating projects: adding unfreeze_reason");
        db.execute("ALTER TABLE projects ADD COLUMN unfreeze_reason TEXT", [])?;
    }
    Ok(())
}
