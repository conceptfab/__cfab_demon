use rusqlite::OptionalExtension;
use std::collections::HashMap;

type ManualOverrideRow = (Option<i64>, String, String, String, Option<String>);

pub(crate) fn upsert_manual_session_override(
    conn: &rusqlite::Connection,
    session_id: i64,
    project_id: Option<i64>,
) -> Result<(), String> {
    let session_meta = conn
        .query_row(
            "SELECT a.executable_name, s.start_time, s.end_time
             FROM sessions s
             JOIN applications a ON a.id = s.app_id
             WHERE s.id = ?1",
            [session_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some((executable_name, start_time, end_time)) = session_meta else {
        return Ok(());
    };

    let project_name: Option<String> = match project_id {
        Some(pid) => conn
            .query_row("SELECT name FROM projects WHERE id = ?1", [pid], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?,
        None => None,
    };

    let updated_legacy = conn
        .execute(
            "UPDATE session_manual_overrides
             SET session_id = ?1,
                 project_name = ?2,
                 updated_at = datetime('now')
             WHERE lower(executable_name) = lower(?3)
               AND start_time = ?4
               AND end_time = ?5",
            rusqlite::params![
                session_id,
                project_name,
                executable_name,
                start_time,
                end_time
            ],
        )
        .map_err(|e| e.to_string())?;

    if updated_legacy == 0 {
        conn.execute(
            "INSERT INTO session_manual_overrides (
                session_id, executable_name, start_time, end_time, project_name, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
             ON CONFLICT(executable_name, start_time, end_time) DO UPDATE SET
               session_id = excluded.session_id,
               executable_name = excluded.executable_name,
               start_time = excluded.start_time,
               end_time = excluded.end_time,
               project_name = excluded.project_name,
               updated_at = excluded.updated_at",
            rusqlite::params![
                session_id,
                executable_name,
                start_time,
                end_time,
                project_name
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub(crate) fn apply_manual_session_overrides(conn: &rusqlite::Connection) -> Result<i64, String> {
    let mut total_reapplied = 0_i64;

    let overrides: Vec<ManualOverrideRow> = {
        let mut stmt = conn
            .prepare_cached(
                "SELECT session_id, executable_name, start_time, end_time, project_name
                 FROM session_manual_overrides
                 ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, Option<i64>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read session_manual_overrides row: {}", e))?
    };

    let project_name_to_id: HashMap<String, i64> = {
        let mut stmt = conn
            .prepare_cached(
                "SELECT id, name
                 FROM projects
                 WHERE excluded_at IS NULL",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        let mut map = HashMap::new();
        for row in rows {
            let (id, name) =
                row.map_err(|e| format!("Failed to read projects row for override map: {}", e))?;
            let key = name.trim().to_lowercase();
            if !key.is_empty() {
                map.entry(key).or_insert(id);
            }
        }
        map
    };

    for (override_session_id, exe_name, start_time, end_time, project_name) in overrides {
        let target_project_id: Option<i64> = match project_name {
            Some(name) => {
                let key = name.trim().to_lowercase();
                if key.is_empty() {
                    None
                } else {
                    project_name_to_id.get(&key).copied()
                }
            }
            None => None,
        };

        let mut sessions_to_update: Vec<(i64, i64, String, String, String, Option<i64>)> =
            Vec::new();

        // Try by session_id first
        if let Some(sid) = override_session_id {
            if let Some(row) = conn
                .query_row(
                    "SELECT s.id, s.app_id, s.date, s.start_time, s.end_time, s.project_id
                     FROM sessions s
                     WHERE s.id = ?1",
                    rusqlite::params![sid],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, Option<i64>>(5)?,
                        ))
                    },
                )
                .optional()
                .map_err(|e| e.to_string())?
            {
                sessions_to_update.push(row);
            }
        }

        // Fallback: match by executable_name + start_time + end_time (session_id
        // may have changed after sync-pull reimport).
        if sessions_to_update.is_empty() {
            let mut stmt = conn
                .prepare_cached(
                    "SELECT s.id, s.app_id, s.date, s.start_time, s.end_time, s.project_id
                     FROM sessions s
                     JOIN applications a ON a.id = s.app_id
                     WHERE lower(a.executable_name) = lower(?1)
                       AND s.start_time = ?2
                       AND s.end_time = ?3",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(rusqlite::params![exe_name, start_time, end_time], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, Option<i64>>(5)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            sessions_to_update = rows
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Failed to read sessions row for manual override: {}", e))?;
        }

        for (session_id, app_id, date, s_start, s_end, current_project_id) in sessions_to_update {
            if current_project_id == target_project_id {
                continue;
            }

            let changed = conn
                .execute(
                    "UPDATE sessions SET project_id = ?1 WHERE id = ?2",
                    rusqlite::params![target_project_id, session_id],
                )
                .map_err(|e| e.to_string())?;
            if changed > 0 {
                total_reapplied += changed as i64;
                conn.execute(
                    "UPDATE file_activities
                     SET project_id = ?1
                     WHERE app_id = ?2
                       AND date = ?3
                       AND last_seen > ?4
                       AND first_seen < ?5",
                    rusqlite::params![target_project_id, app_id, date, s_start, s_end],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    Ok(total_reapplied)
}
