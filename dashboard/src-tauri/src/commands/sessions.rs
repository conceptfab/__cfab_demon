use rusqlite::OptionalExtension;
use std::collections::HashMap;
use tauri::AppHandle;

use super::types::{FileActivity, SessionFilters, SessionWithApp};
use crate::db;

fn apply_session_filters(
    filters: &SessionFilters,
    sql: &mut String,
    params: &mut Vec<Box<dyn rusqlite::types::ToSql>>,
    idx: &mut usize,
) {
    if let Some(ref dr) = filters.date_range {
        sql.push_str(&format!(" AND s.date >= ?{}", *idx));
        params.push(Box::new(dr.start.clone()));
        *idx += 1;
        sql.push_str(&format!(" AND s.date <= ?{}", *idx));
        params.push(Box::new(dr.end.clone()));
        *idx += 1;
    }
    if let Some(aid) = filters.app_id {
        sql.push_str(&format!(" AND s.app_id = ?{}", *idx));
        params.push(Box::new(aid));
        *idx += 1;
    }
    if let Some(min) = filters.min_duration {
        sql.push_str(&format!(" AND s.duration_seconds >= ?{}", *idx));
        params.push(Box::new(min));
        *idx += 1;
    }
    if let Some(unassigned) = filters.unassigned {
        if unassigned {
            sql.push_str(" AND s.project_id IS NULL");
        } else {
            sql.push_str(" AND s.project_id IS NOT NULL");
        }
    }
}

pub(crate) fn upsert_manual_session_override(
    conn: &rusqlite::Connection,
    session_id: i64,
    project_id: Option<i64>,
) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS session_manual_overrides (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             executable_name TEXT NOT NULL,
             start_time TEXT NOT NULL,
             end_time TEXT NOT NULL,
             project_name TEXT,
             updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
             UNIQUE(executable_name, start_time, end_time)
         );
         CREATE INDEX IF NOT EXISTS idx_session_manual_overrides_lookup
         ON session_manual_overrides(executable_name, start_time, end_time);",
    )
    .map_err(|e| e.to_string())?;

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

    conn.execute(
        "INSERT INTO session_manual_overrides (executable_name, start_time, end_time, project_name, updated_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'))
         ON CONFLICT(executable_name, start_time, end_time) DO UPDATE SET
           project_name = excluded.project_name,
           updated_at = excluded.updated_at",
        rusqlite::params![executable_name, start_time, end_time, project_name],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub(crate) fn apply_manual_session_overrides(
    conn: &rusqlite::Connection,
) -> Result<i64, String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS session_manual_overrides (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             executable_name TEXT NOT NULL,
             start_time TEXT NOT NULL,
             end_time TEXT NOT NULL,
             project_name TEXT,
             updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
             UNIQUE(executable_name, start_time, end_time)
         );
         CREATE INDEX IF NOT EXISTS idx_session_manual_overrides_lookup
         ON session_manual_overrides(executable_name, start_time, end_time);",
    )
    .map_err(|e| e.to_string())?;

    let mut total_reapplied = 0_i64;

    let overrides: Vec<(String, String, String, Option<String>)> = {
        let mut stmt = conn
            .prepare_cached(
                "SELECT executable_name, start_time, end_time, project_name
                 FROM session_manual_overrides
                 ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };

    for (exe_name, start_time, end_time, project_name) in overrides {
        let target_project_id: Option<i64> = match project_name {
            Some(name) => conn
                .query_row(
                    "SELECT id
                     FROM projects
                     WHERE lower(name) = lower(?1)
                       AND excluded_at IS NULL
                     LIMIT 1",
                    [name],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?,
            None => None,
        };

        let sessions_to_update: Vec<(i64, i64, String, String, String, Option<i64>)> = {
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
                .query_map(
                    rusqlite::params![exe_name, start_time, end_time],
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
                .map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };

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

#[tauri::command]
pub async fn get_sessions(
    app: AppHandle,
    filters: SessionFilters,
) -> Result<Vec<SessionWithApp>, String> {
    let (mut sessions, needs_suggestion) = {
        let conn = db::get_connection(&app)?;

        let mut sql = String::from(
            "SELECT s.id, s.app_id, s.start_time, s.end_time, s.duration_seconds,
                    COALESCE(s.rate_multiplier, 1.0),
                    a.display_name, a.executable_name, s.project_id, p.name, p.color,
                    CASE WHEN af_last.source = 'auto_accept' THEN 1 ELSE 0 END,
                    s.comment
             FROM sessions s
             JOIN applications a ON a.id = s.app_id
             LEFT JOIN projects p ON p.id = s.project_id
             LEFT JOIN (
                 SELECT session_id, source
                 FROM assignment_feedback
                 WHERE id IN (SELECT MAX(id) FROM assignment_feedback GROUP BY session_id)
             ) af_last ON af_last.session_id = s.id
             WHERE 1=1 AND (s.is_hidden IS NULL OR s.is_hidden = 0)",
        );
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        let mut idx = 1;
        let project_filter = filters.project_id;

        if let Some(pid) = project_filter {
            sql.push_str(&format!(
                " AND (s.project_id = ?{} OR (s.project_id IS NULL AND EXISTS (
                    SELECT 1 FROM file_activities fa 
                    WHERE fa.app_id = s.app_id 
                    AND fa.date = s.date 
                    AND fa.project_id = ?{}
                )))",
                idx, idx
            ));
            params.push(Box::new(pid));
            idx += 1;
        }

        apply_session_filters(&filters, &mut sql, &mut params, &mut idx);

        sql.push_str(" ORDER BY s.start_time DESC");

        if let Some(limit) = filters.limit {
            sql.push_str(&format!(" LIMIT ?{}", idx));
            params.push(Box::new(limit));
            idx += 1;
        }
        if let Some(offset) = filters.offset {
            sql.push_str(&format!(" OFFSET ?{}", idx));
            params.push(Box::new(offset));
        }

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;
        let mut explicit_pids: HashMap<i64, Option<i64>> = HashMap::new();
        let rows = stmt
            .query_map(params_ref.as_slice(), |row| {
                let id: i64 = row.get(0)?;
                let explicit_pid: Option<i64> = row.get(8)?;
                let explicit_pname: Option<String> = row.get(9)?;
                let explicit_pcolor: Option<String> = row.get(10)?;
                let ai_assigned_flag: i64 = row.get(11).unwrap_or(0);
                let comment: Option<String> = row.get(12)?;
                Ok((
                    SessionWithApp {
                        id,
                        app_id: row.get(1)?,
                        start_time: row.get(2)?,
                        end_time: row.get(3)?,
                        duration_seconds: row.get(4)?,
                        rate_multiplier: row.get(5)?,
                        app_name: row.get(6)?,
                        executable_name: row.get(7)?,
                        project_name: explicit_pname,
                        project_color: explicit_pcolor,
                        files: Vec::new(),
                        suggested_project_id: None,
                        suggested_project_name: None,
                        suggested_confidence: None,
                        ai_assigned: ai_assigned_flag != 0,
                        comment,
                    },
                    explicit_pid,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut sessions: Vec<SessionWithApp> = Vec::new();
        for r in rows.flatten() {
            explicit_pids.insert(r.0.id, r.1);
            sessions.push(r.0);
        }

        // Load file activities in one batch (avoid N+1 queries), keyed by (app_id, date).
        let mut keys: Vec<(i64, String)> = Vec::new();
        for s in &sessions {
            let date = s.start_time.split('T').next().unwrap_or("").to_string();
            if !date.is_empty()
                && !keys
                    .iter()
                    .any(|(app_id, d)| *app_id == s.app_id && d == &date)
            {
                keys.push((s.app_id, date));
            }
        }

        let mut files_by_key: HashMap<(i64, String), Vec<FileActivity>> = HashMap::new();
        if !keys.is_empty() {
            conn.execute_batch(
                "CREATE TEMP TABLE IF NOT EXISTS _fa_keys (app_id INTEGER, date TEXT)",
            )
            .map_err(|e| e.to_string())?;
            conn.execute_batch("DELETE FROM _fa_keys")
                .map_err(|e| e.to_string())?;

            {
                let mut insert_key = conn
                    .prepare_cached("INSERT INTO _fa_keys (app_id, date) VALUES (?1, ?2)")
                    .map_err(|e| e.to_string())?;
                for (app_id, date) in &keys {
                    insert_key
                        .execute(rusqlite::params![app_id, date])
                        .map_err(|e| e.to_string())?;
                }
            }

            let mut fstmt = conn
                .prepare_cached(
                    "SELECT fa.id, fa.app_id, fa.date, fa.file_name, fa.total_seconds, fa.first_seen, fa.last_seen,
                            fa.project_id, p.name, p.color
                     FROM file_activities fa
                     LEFT JOIN projects p ON p.id = fa.project_id
                     INNER JOIN _fa_keys k ON fa.app_id = k.app_id AND fa.date = k.date",
                )
                .map_err(|e| e.to_string())?;
            let rows = fstmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        FileActivity {
                            id: row.get(0)?,
                            app_id: row.get(1)?,
                            file_name: row.get(3)?,
                            total_seconds: row.get(4)?,
                            first_seen: row.get(5)?,
                            last_seen: row.get(6)?,
                            project_id: row.get(7)?,
                            project_name: row.get(8)?,
                            project_color: row.get(9)?,
                        },
                    ))
                })
                .map_err(|e| e.to_string())?;

            for (app_id, date, activity) in rows.flatten() {
                files_by_key
                    .entry((app_id, date))
                    .or_default()
                    .push(activity);
            }
        }

        let mut inferred_project_by_session: HashMap<i64, Option<i64>> = HashMap::new();
        for session in &mut sessions {
            let session_start = match chrono::DateTime::parse_from_rfc3339(&session.start_time) {
                Ok(dt) => dt.timestamp_millis(),
                Err(_) => continue,
            };
            let session_end = match chrono::DateTime::parse_from_rfc3339(&session.end_time) {
                Ok(dt) => dt.timestamp_millis(),
                Err(_) => continue,
            };
            if session_end <= session_start {
                continue;
            }

            let session_date = session
                .start_time
                .split('T')
                .next()
                .unwrap_or("")
                .to_string();
            session.files = files_by_key
                .get(&(session.app_id, session_date))
                .cloned()
                .unwrap_or_default();

            if let Some(pid) = explicit_pids.get(&session.id).copied().flatten() {
                inferred_project_by_session.insert(session.id, Some(pid));
                continue;
            }

            // Project-first attribution:
            // assign a session only if overlapping file activity points to exactly one project.
            let mut overlap_by_project: HashMap<i64, (i64, String, String)> = HashMap::new();
            for f in &session.files {
                let Some(pid) = f.project_id else { continue };
                let file_start = match chrono::DateTime::parse_from_rfc3339(&f.first_seen) {
                    Ok(dt) => dt.timestamp_millis(),
                    Err(_) => continue,
                };
                let file_end = match chrono::DateTime::parse_from_rfc3339(&f.last_seen) {
                    Ok(dt) => dt.timestamp_millis(),
                    Err(_) => continue,
                };
                if file_end <= file_start {
                    continue;
                }
                let overlap_ms =
                    std::cmp::min(session_end, file_end) - std::cmp::max(session_start, file_start);
                if overlap_ms <= 0 {
                    continue;
                }
                let name = f
                    .project_name
                    .clone()
                    .unwrap_or_else(|| "Unassigned".to_string());
                let color = f
                    .project_color
                    .clone()
                    .unwrap_or_else(|| "#64748b".to_string());
                let entry = overlap_by_project.entry(pid).or_insert((0, name, color));
                entry.0 += overlap_ms;
            }

            let mut inferred_project_id: Option<i64> = None;
            if !overlap_by_project.is_empty() {
                // Pick project with highest overlap
                if let Some((pid, (overlap_ms, name, _color))) = overlap_by_project
                    .into_iter()
                    .max_by_key(|(_, (ms, _, _))| *ms)
                {
                    let span_ms = session_end - session_start;
                    // Conservative rule: assign only when project evidence covers most of the session.
                    if overlap_ms * 2 >= span_ms {
                        inferred_project_id = Some(pid);
                        session.suggested_project_name = Some(name);
                        session.suggested_project_id = Some(pid);
                        session.suggested_confidence = Some(1.0);
                    }
                }
            }
            inferred_project_by_session.insert(session.id, inferred_project_id);
        }

        if let Some(pid) = project_filter {
            sessions.retain(|s| {
                matches!(
                    inferred_project_by_session.get(&s.id),
                    Some(Some(inferred_pid)) if *inferred_pid == pid
                )
            });
        }

        let mut needs_suggestion_batch: Vec<i64> = Vec::new();
        for session in &mut sessions {
            if inferred_project_by_session
                .get(&session.id)
                .unwrap_or(&None)
                .is_none()
            {
                needs_suggestion_batch.push(session.id);
            }
        }
        (sessions, needs_suggestion_batch)
    };

    // Now call async outside of any SQLite statements
    for session_id in needs_suggestion {
        if let Ok(Some(suggestion)) =
            crate::commands::suggest_project_for_session(app.clone(), session_id).await
        {
            // Find session and update
            if let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) {
                session.suggested_project_id = Some(suggestion.project_id);
                session.suggested_confidence = Some(suggestion.confidence);

                // Re-open fresh conn just for this name lookup (or use a shared pool if available)
                if let Ok(conn) = db::get_connection(&app) {
                    if let Ok(name) = conn.query_row(
                        "SELECT name FROM projects WHERE id = ?1",
                        [suggestion.project_id],
                        |row| row.get::<_, String>(0),
                    ) {
                        session.suggested_project_name = Some(name);
                    }
                }
            }
        }
    }

    Ok(sessions)
}

#[tauri::command]
pub async fn get_session_count(app: AppHandle, filters: SessionFilters) -> Result<i64, String> {
    if let Some(pid) = filters.project_id {
        let conn = db::get_connection(&app)?;
        let mut sql = String::from(
            "SELECT COUNT(DISTINCT s.id) FROM sessions s
             JOIN applications a ON a.id = s.app_id
             LEFT JOIN file_activities fa ON fa.app_id = s.app_id AND fa.date = date(s.start_time)
             WHERE (s.is_hidden IS NULL OR s.is_hidden = 0)
               AND (s.project_id = ?1 OR fa.project_id = ?1)",
        );
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(pid)];
        let mut idx = 2;

        let mut temp_filters = filters.clone();
        temp_filters.project_id = None; // Already handled
        apply_session_filters(&temp_filters, &mut sql, &mut params, &mut idx);

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        let count: i64 = conn
            .query_row(&sql, params_ref.as_slice(), |row| row.get(0))
            .map_err(|e| e.to_string())?;
        return Ok(count);
    }

    let conn = db::get_connection(&app)?;

    let mut sql = String::from(
        "SELECT COUNT(*) FROM sessions s
         JOIN applications a ON a.id = s.app_id
         WHERE (s.is_hidden IS NULL OR s.is_hidden = 0)",
    );
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut idx = 1;

    apply_session_filters(&filters, &mut sql, &mut params, &mut idx);

    let params_ref: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let count: i64 = conn
        .query_row(&sql, params_ref.as_slice(), |row| row.get(0))
        .map_err(|e| e.to_string())?;

    Ok(count)
}

#[tauri::command]
pub async fn assign_session_to_project(
    app: AppHandle,
    session_id: i64,
    project_id: Option<i64>,
    source: Option<String>,
) -> Result<(), String> {
    let conn = db::get_connection(&app)?;

    let session = conn
        .query_row(
            "SELECT app_id, date, start_time, end_time, project_id FROM sessions WHERE id = ?1",
            [session_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some((app_id, date, start_time, end_time, old_project_id)) = session else {
        return Err("Session not found".to_string());
    };

    let updated_session = conn
        .execute(
            "UPDATE sessions SET project_id = ?1 WHERE id = ?2",
            rusqlite::params![project_id, session_id],
        )
        .map_err(|e| e.to_string())?;

    let updated = conn
        .execute(
            "UPDATE file_activities
             SET project_id = ?1
             WHERE app_id = ?2
               AND date = ?3
               AND last_seen > ?4
               AND first_seen < ?5",
            rusqlite::params![project_id, app_id, date, start_time, end_time],
        )
        .map_err(|e| e.to_string())?;

    if updated == 0 && updated_session == 0 {
        log::warn!("No overlapping file activity and no session found? Assignment saved nothing.");
    }

    if let Err(e) = upsert_manual_session_override(&conn, session_id, project_id) {
        log::warn!(
            "Failed to persist manual override for session {}: {}",
            session_id,
            e
        );
    }

    // Feedback Loop logging
    let action_source = source.unwrap_or_else(|| "manual_session_assign".to_string());
    let _ = conn.execute(
        "INSERT INTO assignment_feedback (session_id, app_id, from_project_id, to_project_id, source, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
        rusqlite::params![session_id, app_id, old_project_id, project_id, action_source]
    );

    let _ = conn.execute(
        "INSERT INTO assignment_model_state (key, value, updated_at)
         VALUES ('feedback_since_train', '1', datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
           value = CAST(COALESCE(NULLIF(assignment_model_state.value, ''), '0') AS INTEGER) + 1,
           updated_at = datetime('now')",
        [],
    );

    Ok(())
}

#[tauri::command]
pub async fn update_session_rate_multiplier(
    app: AppHandle,
    session_id: i64,
    multiplier: Option<f64>,
) -> Result<(), String> {
    let normalized = match multiplier {
        None => 1.0,
        Some(v) => {
            if !v.is_finite() {
                return Err("Multiplier must be a finite number".to_string());
            }
            if v <= 0.0 {
                return Err("Multiplier must be > 0".to_string());
            }
            if v > 100.0 {
                return Err("Multiplier must be <= 100".to_string());
            }
            if (v - 1.0).abs() < 0.000_001 {
                1.0
            } else {
                v
            }
        }
    };

    let conn = db::get_connection(&app)?;
    let comment_for_session: Option<Option<String>> = conn
        .query_row(
            "SELECT comment FROM sessions WHERE id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some(existing_comment) = comment_for_session else {
        return Err("Session not found".to_string());
    };

    if normalized > 1.000_001 {
        let has_comment = existing_comment
            .as_deref()
            .map(|c| !c.trim().is_empty())
            .unwrap_or(false);
        if !has_comment {
            return Err("Boost requires a non-empty session comment".to_string());
        }
    }

    let updated = conn
        .execute(
            "UPDATE sessions SET rate_multiplier = ?1 WHERE id = ?2",
            rusqlite::params![normalized, session_id],
        )
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        return Err("Session not found".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_session(app: AppHandle, session_id: i64) -> Result<(), String> {
    let conn = db::get_connection(&app)?;
    conn.execute(
        "UPDATE sessions SET is_hidden = 1 WHERE id = ?1",
        [session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn update_session_comment(
    app: AppHandle,
    session_id: i64,
    comment: Option<String>,
) -> Result<(), String> {
    let conn = db::get_connection(&app)?;
    let normalized = comment.and_then(|c| {
        let trimmed = c.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });
    let updated = conn
        .execute(
            "UPDATE sessions SET comment = ?1 WHERE id = ?2",
            rusqlite::params![normalized, session_id],
        )
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        return Err("Session not found".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn rebuild_sessions(app: AppHandle, gap_fill_minutes: i64) -> Result<i64, String> {
    let mut conn = db::get_connection(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    #[derive(Debug, Clone)]
    struct SessionRow {
        id: i64,
        app_id: i64,
        project_id: Option<i64>,
        rate_multiplier: f64,
        end_time: String,
        start_ms: i64,
        end_ms: i64,
        original_end_ms: i64,
        duration_seconds: i64,
    }

    let mut sessions: Vec<SessionRow> = {
        let mut stmt = tx.prepare(
            "SELECT id, app_id, project_id, COALESCE(rate_multiplier, 1.0), start_time, end_time, date, duration_seconds
             FROM sessions
             WHERE (is_hidden IS NULL OR is_hidden = 0)
             ORDER BY app_id, project_id, start_time ASC"
        ).map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                let start_time: String = row.get(4)?;
                let end_time: String = row.get(5)?;

                let parse_time_to_ms = |ts_str: &str| -> i64 {
                    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts_str) {
                        return dt.timestamp_millis();
                    }
                    if let Ok(ndt) =
                        chrono::NaiveDateTime::parse_from_str(ts_str, "%Y-%m-%d %H:%M:%S")
                    {
                        return ndt.and_utc().timestamp_millis();
                    }
                    if let Ok(ndt) =
                        chrono::NaiveDateTime::parse_from_str(ts_str, "%Y-%m-%dT%H:%M:%S")
                    {
                        return ndt.and_utc().timestamp_millis();
                    }
                    if let Ok(ndt) =
                        chrono::NaiveDateTime::parse_from_str(ts_str, "%Y-%m-%d %H:%M:%S.%f")
                    {
                        return ndt.and_utc().timestamp_millis();
                    }
                    if let Ok(ndt) =
                        chrono::NaiveDateTime::parse_from_str(ts_str, "%Y-%m-%dT%H:%M:%S.%f")
                    {
                        return ndt.and_utc().timestamp_millis();
                    }
                    0
                };

                let start_ms = parse_time_to_ms(&start_time);
                let end_ms = parse_time_to_ms(&end_time);

                Ok(SessionRow {
                    id: row.get(0)?,
                    app_id: row.get(1)?,
                    project_id: row.get(2)?,
                    rate_multiplier: row.get(3)?,
                    end_time,
                    start_ms,
                    end_ms,
                    original_end_ms: end_ms,
                    duration_seconds: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.flatten()
            .filter(|r| r.start_ms > 0 && r.end_ms > 0)
            .collect()
    };

    let gap_ms = gap_fill_minutes * 60 * 1000;
    let mut to_delete = Vec::new();

    let mut current_idx: Option<usize> = None;

    for i in 0..sessions.len() {
        if let Some(c_idx) = current_idx {
            let curr_app_id = sessions[c_idx].app_id;
            let curr_proj_id = sessions[c_idx].project_id;
            let curr_end = sessions[c_idx].end_ms;

            if curr_app_id == sessions[i].app_id
                && curr_proj_id == sessions[i].project_id
                && (sessions[c_idx].rate_multiplier - sessions[i].rate_multiplier).abs() < 0.000_001
                && (sessions[i].start_ms - curr_end) <= gap_ms
            {
                let gap_duration = (sessions[i].start_ms - curr_end) / 1000;
                let new_end = std::cmp::max(curr_end, sessions[i].end_ms);
                sessions[c_idx].end_ms = new_end;
                // Add the duration of the merged session AND the gap to the main session
                sessions[c_idx].duration_seconds += sessions[i].duration_seconds + gap_duration;
                to_delete.push(sessions[i].id);
            } else {
                current_idx = Some(i);
            }
        } else {
            current_idx = Some(i);
        }
    }

    {
        let mut update_stmt = tx
            .prepare("UPDATE sessions SET end_time = ?1, duration_seconds = ?2 WHERE id = ?3")
            .map_err(|e| e.to_string())?;

        for s in &sessions {
            if s.end_ms > s.original_end_ms {
                // Parse original so we can format it back
                let parse_to_datetime =
                    |ts_str: &str| -> Option<chrono::DateTime<chrono::FixedOffset>> {
                        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts_str) {
                            return Some(dt);
                        }
                        if let Ok(ndt) =
                            chrono::NaiveDateTime::parse_from_str(ts_str, "%Y-%m-%d %H:%M:%S")
                        {
                            return Some(chrono::DateTime::from_naive_utc_and_offset(
                                ndt,
                                chrono::FixedOffset::east_opt(0).unwrap(),
                            ));
                        }
                        if let Ok(ndt) =
                            chrono::NaiveDateTime::parse_from_str(ts_str, "%Y-%m-%dT%H:%M:%S")
                        {
                            return Some(chrono::DateTime::from_naive_utc_and_offset(
                                ndt,
                                chrono::FixedOffset::east_opt(0).unwrap(),
                            ));
                        }
                        if let Ok(ndt) =
                            chrono::NaiveDateTime::parse_from_str(ts_str, "%Y-%m-%d %H:%M:%S.%f")
                        {
                            return Some(chrono::DateTime::from_naive_utc_and_offset(
                                ndt,
                                chrono::FixedOffset::east_opt(0).unwrap(),
                            ));
                        }
                        if let Ok(ndt) =
                            chrono::NaiveDateTime::parse_from_str(ts_str, "%Y-%m-%dT%H:%M:%S.%f")
                        {
                            return Some(chrono::DateTime::from_naive_utc_and_offset(
                                ndt,
                                chrono::FixedOffset::east_opt(0).unwrap(),
                            ));
                        }
                        None
                    };

                if let Some(orig_end) = parse_to_datetime(&s.end_time) {
                    let added_ms = s.end_ms - s.original_end_ms;
                    let new_end = orig_end + chrono::Duration::milliseconds(added_ms);
                    let new_end_time = new_end.to_rfc3339();

                    update_stmt
                        .execute(rusqlite::params![new_end_time, s.duration_seconds, s.id])
                        .map_err(|e| e.to_string())?;
                }
            }
        }
    }

    {
        let mut delete_stmt = tx
            .prepare("DELETE FROM sessions WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        for id in &to_delete {
            delete_stmt.execute([id]).map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(to_delete.len() as i64)
}
