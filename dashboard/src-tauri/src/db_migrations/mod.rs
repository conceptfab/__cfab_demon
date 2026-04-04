mod m01_vital_tables;
mod m02_file_activities;
mod m03_manual_sessions;
mod m04_sessions_unique;
mod m05_project_metadata;
mod m06_file_activities_v2;
mod m07_sessions_v2;
mod m08_estimates;
mod m09_timestamps;
mod m10_sessions_updated_at;
mod m11_session_project_cache;
mod m12_delta_sync;
mod m13_fix_updated_at;
mod m14_sync_markers;
mod m15_sync_merge_log;
mod m16_file_activity_spans;

const LATEST_SCHEMA_VERSION: i64 = 16;

pub fn run_migrations(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER NOT NULL DEFAULT 0
        );",
    )?;

    let current_version: i64 = db
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if current_version >= LATEST_SCHEMA_VERSION {
        return Ok(());
    }

    // Run all pending migrations inside a transaction so that partial failures
    // don't leave the DB in an inconsistent state with an outdated schema_version.
    let tx = db.unchecked_transaction()?;

    if current_version < 1 {
        m01_vital_tables::run(&tx)?;
    }
    if current_version < 2 {
        m02_file_activities::run(&tx)?;
    }
    if current_version < 3 {
        m03_manual_sessions::run(&tx)?;
    }
    if current_version < 4 {
        m04_sessions_unique::run(&tx)?;
    }
    if current_version < 5 {
        m05_project_metadata::run(&tx)?;
    }
    if current_version < 6 {
        m06_file_activities_v2::run(&tx)?;
    }
    if current_version < 7 {
        m07_sessions_v2::run(&tx)?;
    }
    if current_version < 8 {
        m08_estimates::run(&tx)?;
    }
    if current_version < 9 {
        m09_timestamps::run(&tx)?;
    }
    if current_version < 10 {
        m10_sessions_updated_at::run(&tx)?;
    }
    if current_version < 11 {
        m11_session_project_cache::run(&tx)?;
    }
    if current_version < 12 {
        m12_delta_sync::run(&tx)?;
    }
    if current_version < 13 {
        m13_fix_updated_at::run(&tx)?;
    }
    if current_version < 14 {
        m14_sync_markers::run(&tx)?;
    }
    if current_version < 15 {
        m15_sync_merge_log::run(&tx)?;
    }
    if current_version < 16 {
        m16_file_activity_spans::run(&tx)?;
    }

    tx.execute(
        "INSERT OR REPLACE INTO schema_version (rowid, version) VALUES (1, ?1)",
        [LATEST_SCHEMA_VERSION],
    )?;

    tx.commit()?;

    Ok(())
}

pub fn ensure_post_migration_indexes(db: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    // These indexes require file_activities(app_id, date); create them after migrations.
    db.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_file_activities_app_id ON file_activities(app_id);
         CREATE INDEX IF NOT EXISTS idx_file_activities_date ON file_activities(date);
         CREATE INDEX IF NOT EXISTS idx_file_activities_app_date ON file_activities(app_id, date);
         CREATE INDEX IF NOT EXISTS idx_file_activities_app_date_overlap ON file_activities(app_id, date, last_seen, first_seen);
         CREATE INDEX IF NOT EXISTS idx_file_activities_project_id ON file_activities(project_id);
         CREATE INDEX IF NOT EXISTS idx_file_activities_file_path ON file_activities(file_path);
         CREATE INDEX IF NOT EXISTS idx_sessions_app_date ON sessions(app_id, date, start_time);
         CREATE INDEX IF NOT EXISTS idx_sessions_date_standalone ON sessions(date);
         CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
         CREATE INDEX IF NOT EXISTS idx_assignment_feedback_session ON assignment_feedback(session_id, created_at DESC);",
    )?;

    let has_manual_overrides: bool = db
        .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='session_manual_overrides'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if has_manual_overrides {
        db.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_session_manual_overrides_lookup
             ON session_manual_overrides(executable_name, start_time, end_time);",
        )?;

        let has_session_id_column: bool = db
            .prepare(
                "SELECT COUNT(*) FROM pragma_table_info('session_manual_overrides') WHERE name='session_id'",
            )?
            .query_row([], |row| row.get::<_, i64>(0))
            .map(|c| c > 0)
            .unwrap_or(false);

        if has_session_id_column {
            if let Err(e) = db.execute_batch(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_session_manual_overrides_session_id
                 ON session_manual_overrides(session_id);",
            ) {
                log::warn!(
                    "Could not create idx_session_manual_overrides_session_id: {}",
                    e
                );
            }
        }
    }

    Ok(())
}
