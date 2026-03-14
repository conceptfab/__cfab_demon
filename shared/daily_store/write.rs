use crate::daily_store::{
    dedupe_files_preserving_last, detected_path_key, DaySignature, StoredDailyData,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::BTreeSet;
use std::time::{SystemTime, UNIX_EPOCH};
pub fn replace_day_snapshot(
    conn: &mut Connection,
    snapshot: &StoredDailyData,
) -> Result<DaySignature, String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start daily store transaction: {}", e))?;
    let previous_revision = tx
        .query_row(
            "SELECT revision FROM daily_snapshots WHERE date = ?1",
            [snapshot.date.as_str()],
            |row| row.get::<_, u64>(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read previous daily store revision: {}", e))?
        .unwrap_or(0);
    let revision = previous_revision.saturating_add(1);
    let updated_unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Failed to get current time for daily store: {}", e))?
        .as_millis() as u64;

    tx.execute(
        "INSERT INTO daily_snapshots (date, generated_at, updated_unix_ms, revision)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(date) DO UPDATE SET
             generated_at = excluded.generated_at,
             updated_unix_ms = excluded.updated_unix_ms,
             revision = excluded.revision",
        params![
            snapshot.date,
            snapshot.generated_at,
            updated_unix_ms,
            revision
        ],
    )
    .map_err(|e| format!("Failed to persist daily snapshot header: {}", e))?;

    let incoming_app_names: BTreeSet<String> = snapshot.apps.keys().cloned().collect();
    let mut existing_apps_stmt = tx
        .prepare_cached(
            "SELECT exe_name
             FROM daily_apps
             WHERE date = ?1",
        )
        .map_err(|e| format!("Failed to prepare daily app cleanup select: {}", e))?;
    let existing_app_rows = existing_apps_stmt
        .query_map([snapshot.date.as_str()], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Failed to query existing daily apps for cleanup: {}", e))?;
    let mut removed_apps = Vec::new();
    for row in existing_app_rows {
        let exe_name = row.map_err(|e| format!("Failed to map existing daily app row: {}", e))?;
        if !incoming_app_names.contains(&exe_name) {
            removed_apps.push(exe_name);
        }
    }
    drop(existing_apps_stmt);

    let mut delete_app_stmt = tx
        .prepare_cached(
            "DELETE FROM daily_apps
             WHERE date = ?1 AND exe_name = ?2",
        )
        .map_err(|e| format!("Failed to prepare daily app delete: {}", e))?;
    for exe_name in removed_apps {
        delete_app_stmt
            .execute(params![snapshot.date, exe_name])
            .map_err(|e| format!("Failed to delete removed daily app: {}", e))?;
    }

    let mut app_stmt = tx
        .prepare_cached(
            "INSERT INTO daily_apps (date, exe_name, display_name, total_seconds)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(date, exe_name) DO UPDATE SET
                 display_name = excluded.display_name,
                 total_seconds = excluded.total_seconds",
        )
        .map_err(|e| format!("Failed to prepare daily app insert: {}", e))?;
    let mut session_stmt = tx
        .prepare_cached(
            "INSERT INTO daily_sessions (
                 date, exe_name, session_index, start_time, end_time, duration_seconds
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(date, exe_name, session_index) DO UPDATE SET
                 start_time = excluded.start_time,
                 end_time = excluded.end_time,
                 duration_seconds = excluded.duration_seconds",
        )
        .map_err(|e| format!("Failed to prepare daily session insert: {}", e))?;
    let mut delete_extra_sessions_stmt = tx
        .prepare_cached(
            "DELETE FROM daily_sessions
             WHERE date = ?1 AND exe_name = ?2 AND session_index >= ?3",
        )
        .map_err(|e| format!("Failed to prepare daily session trim: {}", e))?;
    let mut file_stmt = tx
        .prepare_cached(
            "INSERT INTO daily_files (
                 date, exe_name, file_name, ordinal, total_seconds, first_seen, last_seen,
                 window_title, detected_path, title_history_json, activity_type
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(date, exe_name, file_name, detected_path) DO UPDATE SET
                 ordinal = excluded.ordinal,
                 total_seconds = excluded.total_seconds,
                 first_seen = excluded.first_seen,
                 last_seen = excluded.last_seen,
                 window_title = excluded.window_title,
                 detected_path = excluded.detected_path,
                 title_history_json = excluded.title_history_json,
                 activity_type = excluded.activity_type",
        )
        .map_err(|e| format!("Failed to prepare daily file insert: {}", e))?;
    tx.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS _daily_store_file_keys (
             file_name TEXT NOT NULL,
             detected_path TEXT NOT NULL,
             PRIMARY KEY (file_name, detected_path)
         );",
    )
    .map_err(|e| format!("Failed to prepare temp daily file key table: {}", e))?;
    let mut clear_file_keys_stmt = tx
        .prepare_cached(
            "DELETE FROM _daily_store_file_keys",
        )
        .map_err(|e| format!("Failed to prepare temp daily file key cleanup: {}", e))?;
    let mut insert_file_key_stmt = tx
        .prepare_cached(
            "INSERT OR IGNORE INTO _daily_store_file_keys (file_name, detected_path)
             VALUES (?1, ?2)",
        )
        .map_err(|e| format!("Failed to prepare temp daily file key insert: {}", e))?;
    let mut delete_stale_files_stmt = tx
        .prepare_cached(
            "DELETE FROM daily_files
             WHERE date = ?1
               AND exe_name = ?2
               AND NOT EXISTS (
                   SELECT 1
                   FROM _daily_store_file_keys keys
                   WHERE keys.file_name = daily_files.file_name
                     AND keys.detected_path = daily_files.detected_path
               )",
        )
        .map_err(|e| format!("Failed to prepare stale daily file delete: {}", e))?;

    for (exe_name, app) in &snapshot.apps {
        app_stmt
            .execute(params![
                snapshot.date,
                exe_name,
                app.display_name,
                app.total_seconds
            ])
            .map_err(|e| {
                format!(
                    "Failed to persist daily app '{}' for date {}: {}",
                    exe_name, snapshot.date, e
                )
            })?;

        for (index, session) in app.sessions.iter().enumerate() {
            session_stmt
                .execute(params![
                    snapshot.date,
                    exe_name,
                    index as i64,
                    session.start,
                    session.end,
                    session.duration_seconds
                ])
                .map_err(|e| {
                    format!(
                        "Failed to persist session {} for app '{}' on {}: {}",
                        index, exe_name, snapshot.date, e
                    )
                })?;
        }

        delete_extra_sessions_stmt
            .execute(params![snapshot.date, exe_name, app.sessions.len() as i64])
            .map_err(|e| {
                format!(
                    "Failed to trim stale sessions for app '{}' on {}: {}",
                    exe_name, snapshot.date, e
                )
            })?;

        clear_file_keys_stmt.execute([]).map_err(|e| {
            format!(
                "Failed to reset temp file keys for app '{}' on {}: {}",
                exe_name, snapshot.date, e
            )
        })?;

        let deduped_files = dedupe_files_preserving_last(&app.files);
        for (ordinal, file) in deduped_files.into_iter().enumerate() {
            let detected_path = detected_path_key(file.detected_path.as_deref()).to_string();
            let title_history_json = serde_json::to_string(&file.title_history).map_err(|e| {
                format!(
                    "Failed to serialize title history for '{}' on {}: {}",
                    file.name, snapshot.date, e
                )
            })?;
            insert_file_key_stmt
                .execute(params![file.name, detected_path.as_str()])
                .map_err(|e| {
                    format!(
                        "Failed to register retained file key '{}' for app '{}' on {}: {}",
                        file.name, exe_name, snapshot.date, e
                    )
                })?;
            file_stmt
                .execute(params![
                    snapshot.date,
                    exe_name,
                    file.name,
                    ordinal as i64,
                    file.total_seconds,
                    file.first_seen,
                    file.last_seen,
                    file.window_title,
                    detected_path.as_str(),
                    title_history_json,
                    file.activity_type
                ])
                .map_err(|e| {
                    format!(
                        "Failed to persist file '{}' for app '{}' on {}: {}",
                        file.name, exe_name, snapshot.date, e
                    )
                })?;
        }

        delete_stale_files_stmt
            .execute(params![snapshot.date, exe_name])
            .map_err(|e| {
                format!(
                    "Failed to delete stale files for app '{}' on {}: {}",
                    exe_name, snapshot.date, e
                )
            })?;
    }

    drop(delete_stale_files_stmt);
    drop(insert_file_key_stmt);
    drop(clear_file_keys_stmt);
    tx.execute_batch("DROP TABLE IF EXISTS _daily_store_file_keys")
        .map_err(|e| format!("Failed to clean up temp daily file key table: {}", e))?;
    drop(file_stmt);
    drop(delete_extra_sessions_stmt);
    drop(session_stmt);
    drop(app_stmt);
    drop(delete_app_stmt);
    tx.commit()
        .map_err(|e| format!("Failed to commit daily store transaction: {}", e))?;

    Ok(DaySignature {
        updated_unix_ms,
        revision,
    })
}

