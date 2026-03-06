use rusqlite::OptionalExtension;
use std::collections::{HashMap, HashSet};
use tauri::AppHandle;

use super::sql_fragments::SESSION_PROJECT_CTE_ALL_TIME;
use super::types::{FileActivity, SessionFilters, SessionWithApp};
use crate::db;

type ManualOverrideRow = (Option<i64>, String, String, String, Option<String>);

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
             ON CONFLICT(session_id) DO UPDATE SET
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

    for (override_session_id, exe_name, start_time, end_time, project_name) in overrides {
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

        let sessions_to_update: Vec<(i64, i64, String, String, String, Option<i64>)> =
            if let Some(sid) = override_session_id {
                conn.query_row(
                    "SELECT s.id, s.app_id, s.date, s.start_time, s.end_time, s.project_id
                     FROM sessions s
                     WHERE s.id = ?1",
                    rusqlite::params![sid],
                    |row| {
                        Ok(vec![(
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, Option<i64>>(5)?,
                        )])
                    },
                )
                .optional()
                .map_err(|e| e.to_string())?
                .unwrap_or_default()
            } else {
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
                rows.collect::<Result<Vec<_>, _>>().map_err(|e| {
                    format!("Failed to read sessions row for manual override: {}", e)
                })?
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
    let include_ai_suggestions = filters.include_ai_suggestions.unwrap_or(true);
    let (mut sessions, needs_suggestion) = {
        let conn = db::get_connection(&app)?;

        let project_filter = filters.project_id;
        let mut sql = if project_filter.is_some() {
            format!(
                "{SESSION_PROJECT_CTE_ALL_TIME}
                 SELECT s.id, s.app_id, s.start_time, s.end_time, s.duration_seconds,
                    COALESCE(s.rate_multiplier, 1.0),
                    a.display_name, a.executable_name, s.project_id, p.name, p.color,
                    CASE WHEN af_last.source = 'auto_accept' THEN 1 ELSE 0 END,
                    s.comment,
                    asug_latest.suggested_confidence,
                    asug_latest.suggested_project_id,
                    p_sug.name
             FROM sessions s
             JOIN applications a ON a.id = s.app_id
             LEFT JOIN session_projects sp_filter ON sp_filter.id = s.id
             LEFT JOIN projects p ON p.id = s.project_id
             LEFT JOIN (
                 SELECT session_id, source
                 FROM assignment_feedback
                 WHERE id IN (SELECT MAX(id) FROM assignment_feedback GROUP BY session_id)
             ) af_last ON af_last.session_id = s.id
             LEFT JOIN (
                 SELECT session_id, suggested_confidence, suggested_project_id
                  FROM assignment_suggestions
                  WHERE id IN (SELECT MAX(id) FROM assignment_suggestions GROUP BY session_id)
              ) asug_latest ON asug_latest.session_id = s.id
              LEFT JOIN projects p_sug ON p_sug.id = asug_latest.suggested_project_id
             WHERE 1=1 AND (s.is_hidden IS NULL OR s.is_hidden = 0)"
            )
        } else {
            String::from(
                "SELECT s.id, s.app_id, s.start_time, s.end_time, s.duration_seconds,
                    COALESCE(s.rate_multiplier, 1.0),
                    a.display_name, a.executable_name, s.project_id, p.name, p.color,
                    CASE WHEN af_last.source = 'auto_accept' THEN 1 ELSE 0 END,
                    s.comment,
                    asug_latest.suggested_confidence,
                    asug_latest.suggested_project_id,
                    p_sug.name
             FROM sessions s
             JOIN applications a ON a.id = s.app_id
             LEFT JOIN projects p ON p.id = s.project_id
             LEFT JOIN (
                 SELECT session_id, source
                 FROM assignment_feedback
                 WHERE id IN (SELECT MAX(id) FROM assignment_feedback GROUP BY session_id)
             ) af_last ON af_last.session_id = s.id
             LEFT JOIN (
                 SELECT session_id, suggested_confidence, suggested_project_id
                 FROM assignment_suggestions
                 WHERE id IN (SELECT MAX(id) FROM assignment_suggestions GROUP BY session_id)
             ) asug_latest ON asug_latest.session_id = s.id
             LEFT JOIN projects p_sug ON p_sug.id = asug_latest.suggested_project_id
             WHERE 1=1 AND (s.is_hidden IS NULL OR s.is_hidden = 0)",
            )
        };
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        let mut idx = 1;

        if let Some(pid) = project_filter {
            sql.push_str(&format!(" AND sp_filter.project_id = ?{}", idx));
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
                let hist_confidence: Option<f64> = row.get(13).unwrap_or(None);
                let hist_suggested_pid: Option<i64> = row.get(14).unwrap_or(None);
                let hist_suggested_pname: Option<String> = row.get(15).unwrap_or(None);
                Ok((
                    SessionWithApp {
                        id,
                        app_id: row.get(1)?,
                        project_id: explicit_pid,
                        start_time: row.get(2)?,
                        end_time: row.get(3)?,
                        duration_seconds: row.get(4)?,
                        rate_multiplier: row.get(5)?,
                        app_name: row.get(6)?,
                        executable_name: row.get(7)?,
                        project_name: explicit_pname,
                        project_color: explicit_pcolor,
                        files: Vec::new(),
                        suggested_project_id: hist_suggested_pid,
                        suggested_project_name: hist_suggested_pname,
                        suggested_confidence: hist_confidence,
                        ai_assigned: ai_assigned_flag != 0,
                        comment,
                    },
                    explicit_pid,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut sessions: Vec<SessionWithApp> = Vec::new();
        for r in rows {
            let r = r.map_err(|e| format!("Failed to read session row: {}", e))?;
            explicit_pids.insert(r.0.id, r.1);
            sessions.push(r.0);
        }

        // Load file activities in one batch (avoid N+1 queries), keyed by (app_id, date).
        let mut keys: Vec<(i64, String)> = Vec::new();
        let mut key_set: HashSet<(i64, String)> = HashSet::new();
        for s in &sessions {
            let date = s.start_time.split('T').next().unwrap_or("").to_string();
            if !date.is_empty() {
                let key = (s.app_id, date);
                if key_set.insert(key.clone()) {
                    keys.push(key);
                }
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

            for row in rows {
                let (app_id, date, activity) =
                    row.map_err(|e| format!("Failed to read file_activities row: {}", e))?;
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

        let mut suggestion_candidate_batch: Vec<i64> = Vec::new();
        for session in &mut sessions {
            if inferred_project_by_session
                .get(&session.id)
                .unwrap_or(&None)
                .is_none()
            {
                suggestion_candidate_batch.push(session.id);
                continue;
            }

            // In AI Data mode we also want score hints for already assigned sessions.
            // Keep existing historical suggestion fields untouched; only fill missing data later.
            if session.suggested_project_id.is_none()
                && session.suggested_project_name.is_none()
                && session.suggested_confidence.is_none()
            {
                suggestion_candidate_batch.push(session.id);
            }
        }
        (sessions, suggestion_candidate_batch)
    };

    if include_ai_suggestions && !needs_suggestion.is_empty() {
        let status = crate::commands::get_assignment_model_status(app.clone()).await?;
        if status.mode != "off" {
            let conn = db::get_connection(&app)?;
            let mut suggestions =
                super::assignment_model::suggest_projects_for_sessions_with_status(
                    &conn,
                    &status,
                    &needs_suggestion,
                )?;

            if suggestions.len() < needs_suggestion.len() {
                let needs_suggestion_set: HashSet<i64> = needs_suggestion.iter().copied().collect();
                let assigned_without_threshold: Vec<i64> = sessions
                    .iter()
                    .filter(|s| s.project_name.is_some())
                    .map(|s| s.id)
                    .filter(|id| needs_suggestion_set.contains(id) && !suggestions.contains_key(id))
                    .collect();

                if !assigned_without_threshold.is_empty() {
                    let raw = super::assignment_model::suggest_projects_for_sessions_raw(
                        &conn,
                        &status,
                        &assigned_without_threshold,
                    )?;
                    for (session_id, suggestion) in raw {
                        suggestions.entry(session_id).or_insert(suggestion);
                    }
                }
            }

            if !suggestions.is_empty() {
                let mut suggested_project_ids: HashSet<i64> = HashSet::new();
                for s in suggestions.values() {
                    suggested_project_ids.insert(s.project_id);
                }

                let mut project_name_by_id: HashMap<i64, String> = HashMap::new();
                if !suggested_project_ids.is_empty() {
                    let pid_list: Vec<i64> = suggested_project_ids.into_iter().collect();
                    let placeholders = pid_list.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                    let sql = format!(
                        "SELECT id, name FROM projects WHERE id IN ({})",
                        placeholders
                    );
                    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
                    let params: Vec<&dyn rusqlite::types::ToSql> = pid_list
                        .iter()
                        .map(|id| id as &dyn rusqlite::types::ToSql)
                        .collect();
                    let rows = stmt
                        .query_map(rusqlite::params_from_iter(params), |row| {
                            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                        })
                        .map_err(|e| e.to_string())?;
                    for row in rows {
                        let (pid, name) = row.map_err(|e| e.to_string())?;
                        project_name_by_id.insert(pid, name);
                    }
                }

                let mut index_by_session_id: HashMap<i64, usize> = HashMap::new();
                for (idx, session) in sessions.iter().enumerate() {
                    index_by_session_id.insert(session.id, idx);
                }

                for (session_id, suggestion) in suggestions {
                    if let Some(&idx) = index_by_session_id.get(&session_id) {
                        if sessions[idx].suggested_project_id.is_none() {
                            sessions[idx].suggested_project_id = Some(suggestion.project_id);
                        }
                        if sessions[idx].suggested_confidence.is_none() {
                            sessions[idx].suggested_confidence = Some(suggestion.confidence);
                        }
                        if sessions[idx].suggested_project_name.is_none() {
                            sessions[idx].suggested_project_name =
                                project_name_by_id.get(&suggestion.project_id).cloned();
                        }
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
        let mut sql = format!(
            "{SESSION_PROJECT_CTE_ALL_TIME}
             SELECT COUNT(*) FROM session_projects sp
             JOIN sessions s ON s.id = sp.id
             JOIN applications a ON a.id = s.app_id
             WHERE sp.project_id = ?1",
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

        let rows = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read sessions row during rebuild: {}", e))?;
        rows.into_iter()
            .filter(|r| r.start_ms > 0 && r.end_ms > 0)
            .collect()
    };

    let gap_ms = gap_fill_minutes * 60 * 1000;
    let mut to_delete = Vec::new();
    let mut merged_into: Vec<(i64, i64)> = Vec::new();

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
                merged_into.push((sessions[i].id, sessions[c_idx].id));
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
        for (from_session_id, to_session_id) in &merged_into {
            if from_session_id == to_session_id {
                continue;
            }
            tx.execute(
                "UPDATE OR IGNORE session_manual_overrides
                 SET session_id = ?1,
                     updated_at = datetime('now')
                 WHERE session_id = ?2",
                rusqlite::params![to_session_id, from_session_id],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "DELETE FROM session_manual_overrides WHERE session_id = ?1",
                rusqlite::params![from_session_id],
            )
            .map_err(|e| e.to_string())?;
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

#[tauri::command]
pub async fn split_session(
    app: AppHandle,
    session_id: i64,
    ratio: f64,
    project_a_id: Option<i64>,
    project_b_id: Option<i64>,
) -> Result<(), String> {
    if ratio <= 0.0 || ratio >= 1.0 {
        return Err("Ratio must be strictly between 0.0 and 1.0".to_string());
    }

    let mut conn = db::get_connection(&app)?;
    let session = conn
        .query_row(
            "SELECT app_id, start_time, end_time, duration_seconds, date, rate_multiplier, project_id, comment
             FROM sessions WHERE id = ?1",
            [session_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, f64>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some((
        app_id,
        start_time,
        end_time,
        duration_seconds,
        date_str,
        rate_multiplier,
        _orig_project_id,
        comment,
    )) = session
    else {
        return Err("Session not found".to_string());
    };

    let start_dt = chrono::DateTime::parse_from_rfc3339(&start_time)
        .map_err(|e| format!("Invalid start time: {}", e))?;
    let end_dt = chrono::DateTime::parse_from_rfc3339(&end_time)
        .map_err(|e| format!("Invalid end time: {}", e))?;

    let total_ms = (end_dt.timestamp_millis() - start_dt.timestamp_millis()).max(0);
    let duration_a_ms = (total_ms as f64 * ratio).round() as i64;

    let split_point = start_dt + chrono::Duration::milliseconds(duration_a_ms);
    let split_time_str = split_point.to_rfc3339();

    let duration_a_secs = (duration_seconds as f64 * ratio).round() as i64;
    let duration_b_secs = duration_seconds - duration_a_secs;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Step 1: Hide original session
    // We add an "is_hidden" column if it doesn't exist, though it should from other logic.
    tx.execute(
        "UPDATE sessions SET is_hidden = 1 WHERE id = ?1",
        rusqlite::params![session_id],
    )
    .map_err(|e| e.to_string())?;

    // Step 2: Insert part A
    tx.execute(
        "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, rate_multiplier, project_id, comment)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            app_id,
            start_time,
            split_time_str,
            duration_a_secs,
            date_str,
            rate_multiplier,
            project_a_id,
            comment.as_deref().map(|c| format!("{} (Split 1/2)", c)).unwrap_or_else(|| "Split 1/2".to_string())
        ],
    )
    .map_err(|e| e.to_string())?;

    // Step 3: Insert part B
    tx.execute(
        "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, rate_multiplier, project_id, comment)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            app_id,
            split_time_str,
            end_time,
            duration_b_secs,
            date_str,
            rate_multiplier,
            project_b_id,
            comment.as_deref().map(|c| format!("{} (Split 2/2)", c)).unwrap_or_else(|| "Split 2/2".to_string())
        ],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(serde::Serialize)]
pub struct SplitSuggestion {
    pub project_a_id: Option<i64>,
    pub project_a_name: Option<String>,
    pub project_b_id: Option<i64>,
    pub project_b_name: Option<String>,
    pub suggested_ratio: f64,
    pub confidence: f64,
}

/// Analyzes file activities for a session's app + date to suggest an automatic split.
/// Returns which two projects dominate the file time and a ratio between them.
#[tauri::command]
pub async fn suggest_session_split(
    app: AppHandle,
    session_id: i64,
) -> Result<SplitSuggestion, String> {
    let conn = db::get_connection(&app)?;

    // Get session info
    let (app_id, date, current_project_id, suggested_project_id): (i64, String, Option<i64>, Option<i64>) = conn
        .query_row(
            "SELECT app_id, date, project_id,
                    (SELECT af.project_id FROM assignment_feedback af WHERE af.session_id = sessions.id ORDER BY af.created_at DESC LIMIT 1)
             FROM sessions WHERE id = ?1",
            [session_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| format!("Session not found: {}", e))?;

    // Query file activities for this app on this date, grouped by project
    let mut stmt = conn
        .prepare_cached(
            "SELECT fa.project_id, p.name, SUM(fa.total_seconds) as total
             FROM file_activities fa
             LEFT JOIN projects p ON p.id = fa.project_id
             WHERE fa.app_id = ?1 AND fa.date = ?2 AND fa.project_id IS NOT NULL
             GROUP BY fa.project_id
             ORDER BY total DESC
             LIMIT 10",
        )
        .map_err(|e| e.to_string())?;

    let projects: Vec<(i64, String, i64)> = stmt
        .query_map(rusqlite::params![app_id, date], |row| {
            Ok((
                row.get(0)?,
                row.get::<_, String>(1).unwrap_or_default(),
                row.get(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // If we have ≥2 projects from file activities, use those
    if projects.len() >= 2 {
        let total_time: i64 = projects.iter().map(|(_, _, t)| *t).sum();
        let ratio = if total_time > 0 {
            (projects[0].2 as f64 / total_time as f64).clamp(0.05, 0.95)
        } else {
            0.5
        };
        return Ok(SplitSuggestion {
            project_a_id: Some(projects[0].0),
            project_a_name: Some(projects[0].1.clone()),
            project_b_id: Some(projects[1].0),
            project_b_name: Some(projects[1].1.clone()),
            suggested_ratio: ratio,
            confidence: 0.8,
        });
    }

    // Fallback: use current project + AI suggested project
    if let (Some(cur), Some(sug)) = (current_project_id, suggested_project_id) {
        if cur != sug {
            let name_a: String = conn
                .query_row("SELECT name FROM projects WHERE id = ?1", [cur], |r| {
                    r.get(0)
                })
                .unwrap_or_default();
            let name_b: String = conn
                .query_row("SELECT name FROM projects WHERE id = ?1", [sug], |r| {
                    r.get(0)
                })
                .unwrap_or_default();
            return Ok(SplitSuggestion {
                project_a_id: Some(cur),
                project_a_name: Some(name_a),
                project_b_id: Some(sug),
                project_b_name: Some(name_b),
                suggested_ratio: 0.5,
                confidence: 0.4,
            });
        }
    }

    // No suggestion possible
    Ok(SplitSuggestion {
        project_a_id: current_project_id,
        project_a_name: None,
        project_b_id: None,
        project_b_name: None,
        suggested_ratio: 0.5,
        confidence: 0.0,
    })
}

#[cfg(test)]
mod tests {
    use super::SESSION_PROJECT_CTE_ALL_TIME;

    fn setup_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE applications (
                id INTEGER PRIMARY KEY,
                display_name TEXT,
                executable_name TEXT
            );
            CREATE TABLE sessions (
                id INTEGER PRIMARY KEY,
                app_id INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                date TEXT NOT NULL,
                project_id INTEGER,
                rate_multiplier REAL,
                comment TEXT,
                is_hidden INTEGER
            );
            CREATE TABLE file_activities (
                id INTEGER PRIMARY KEY,
                app_id INTEGER NOT NULL,
                date TEXT NOT NULL,
                file_name TEXT NOT NULL,
                total_seconds INTEGER NOT NULL,
                first_seen TEXT NOT NULL,
                last_seen TEXT NOT NULL,
                project_id INTEGER
            );",
        )
        .expect("schema");
        conn.execute(
            "INSERT INTO applications (id, display_name, executable_name) VALUES (?1, ?2, ?3)",
            rusqlite::params![1_i64, "Editor", "editor.exe"],
        )
        .expect("insert app");
        conn
    }

    #[test]
    fn session_project_cte_does_not_assign_non_overlapping_activity() {
        let conn = setup_conn();
        conn.execute(
            "INSERT INTO sessions (id, app_id, start_time, end_time, duration_seconds, date, project_id, rate_multiplier, comment, is_hidden)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 1.0, NULL, 0)",
            rusqlite::params![
                1_i64,
                1_i64,
                "2026-01-01T10:00:00Z",
                "2026-01-01T11:00:00Z",
                3600_i64,
                "2026-01-01",
            ],
        )
        .expect("insert session");
        conn.execute(
            "INSERT INTO file_activities (id, app_id, date, file_name, total_seconds, first_seen, last_seen, project_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                1_i64,
                1_i64,
                "2026-01-01",
                "main.rs",
                1800_i64,
                "2026-01-01T12:00:00Z",
                "2026-01-01T12:30:00Z",
                10_i64
            ],
        )
        .expect("insert file activity");

        let sql = format!(
            "{SESSION_PROJECT_CTE_ALL_TIME}
             SELECT project_id FROM session_projects WHERE id = ?1"
        );
        let project_id: Option<i64> = conn
            .query_row(&sql, [1_i64], |row| row.get(0))
            .expect("query cte project id");
        assert_eq!(project_id, None);
    }

    #[test]
    fn session_project_cte_assigns_single_project_with_major_overlap() {
        let conn = setup_conn();
        conn.execute(
            "INSERT INTO sessions (id, app_id, start_time, end_time, duration_seconds, date, project_id, rate_multiplier, comment, is_hidden)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 1.0, NULL, 0)",
            rusqlite::params![
                1_i64,
                1_i64,
                "2026-01-01T10:00:00Z",
                "2026-01-01T11:00:00Z",
                3600_i64,
                "2026-01-01",
            ],
        )
        .expect("insert session");
        conn.execute(
            "INSERT INTO file_activities (id, app_id, date, file_name, total_seconds, first_seen, last_seen, project_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                1_i64,
                1_i64,
                "2026-01-01",
                "main.rs",
                1800_i64,
                "2026-01-01T10:00:00Z",
                "2026-01-01T10:30:00Z",
                10_i64
            ],
        )
        .expect("insert file activity");

        let sql = format!(
            "{SESSION_PROJECT_CTE_ALL_TIME}
             SELECT project_id FROM session_projects WHERE id = ?1"
        );
        let project_id: Option<i64> = conn
            .query_row(&sql, [1_i64], |row| row.get(0))
            .expect("query cte project id");
        assert_eq!(project_id, Some(10));
    }

    #[test]
    fn project_count_query_matches_overlap_and_hidden_rules() {
        let conn = setup_conn();
        conn.execute_batch(
            "INSERT INTO sessions (id, app_id, start_time, end_time, duration_seconds, date, project_id, rate_multiplier, comment, is_hidden) VALUES
                (1, 1, '2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z', 3600, '2026-01-01', NULL, 1.0, NULL, 0),
                (2, 1, '2026-01-01T11:00:00Z', '2026-01-01T12:00:00Z', 3600, '2026-01-01', 10,   1.0, NULL, 0),
                (3, 1, '2026-01-01T12:00:00Z', '2026-01-01T13:00:00Z', 3600, '2026-01-01', NULL, 1.0, NULL, 0),
                (4, 1, '2026-01-01T13:00:00Z', '2026-01-01T14:00:00Z', 3600, '2026-01-01', 10,   1.0, NULL, 1);
             INSERT INTO file_activities (id, app_id, date, file_name, total_seconds, first_seen, last_seen, project_id) VALUES
                (1, 1, '2026-01-01', 'a.txt', 1800, '2026-01-01T08:00:00Z', '2026-01-01T08:30:00Z', 10),
                (2, 1, '2026-01-01', 'b.txt', 2400, '2026-01-01T12:10:00Z', '2026-01-01T12:50:00Z', 10);",
        )
        .expect("seed data");

        let sql = format!(
            "{SESSION_PROJECT_CTE_ALL_TIME}
             SELECT COUNT(*) FROM session_projects sp
             JOIN sessions s ON s.id = sp.id
             JOIN applications a ON a.id = s.app_id
             WHERE sp.project_id = ?1"
        );
        let count: i64 = conn
            .query_row(&sql, [10_i64], |row| row.get(0))
            .expect("query count");

        // Session 2 counts (explicit project), Session 3 counts (overlap with project 10),
        // Session 1 does not count (same day but no overlap), Session 4 is hidden.
        assert_eq!(count, 2);
    }
}
