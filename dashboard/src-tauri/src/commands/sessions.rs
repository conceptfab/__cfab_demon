use rusqlite::OptionalExtension;
use std::collections::{HashMap, HashSet};
use tauri::AppHandle;

use super::assignment_model;
use super::datetime::{parse_datetime_fixed, parse_datetime_ms};
use super::helpers::run_db_blocking;
use super::sql_fragments::SESSION_PROJECT_CTE_ALL_TIME;
use super::types::{
    FileActivity, MultiProjectAnalysis, ProjectCandidate, SessionFilters, SessionSplittableFlag,
    SessionWithApp, SplitPart,
};

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
    let include_files = filters.include_files.unwrap_or(true);
    let include_ai_suggestions = filters.include_ai_suggestions.unwrap_or(true);
    let (mut sessions, needs_suggestion) = run_db_blocking(app.clone(), move |conn| {
        let project_filter = filters.project_id;
        let mut sql = if project_filter.is_some() {
            format!(
                "{SESSION_PROJECT_CTE_ALL_TIME}
                 SELECT s.id, s.app_id, s.start_time, s.end_time, s.duration_seconds,
                    COALESCE(s.rate_multiplier, 1.0),
                    a.display_name, a.executable_name, s.project_id, p.name, p.color,
                    CASE WHEN af_last.source = 'auto_accept' THEN 1 ELSE 0 END,
                    s.comment,
                    s.split_source_session_id,
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
                    s.split_source_session_id,
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
                let split_source_session_id: Option<i64> = row.get(13)?;
                let hist_confidence: Option<f64> = row.get(14).unwrap_or(None);
                let hist_suggested_pid: Option<i64> = row.get(15).unwrap_or(None);
                let hist_suggested_pname: Option<String> = row.get(16).unwrap_or(None);
                Ok((
                    SessionWithApp {
                        id,
                        app_id: row.get(1)?,
                        project_id: explicit_pid,
                        split_source_session_id,
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
        if include_files {
            for s in &sessions {
                let date = s.start_time.split('T').next().unwrap_or("").to_string();
                if !date.is_empty() {
                    let key = (s.app_id, date);
                    if key_set.insert(key.clone()) {
                        keys.push(key);
                    }
                }
            }
        }

        let mut files_by_key: HashMap<(i64, String), Vec<FileActivity>> = HashMap::new();
        if include_files && !keys.is_empty() {
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
            if let Some(pid) = explicit_pids.get(&session.id).copied().flatten() {
                inferred_project_by_session.insert(session.id, Some(pid));
            } else {
                inferred_project_by_session.insert(session.id, None);
            }

            if !include_files {
                continue;
            }

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

            if explicit_pids.get(&session.id).copied().flatten().is_some() {
                continue;
            }

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

            if let Some((pid, (overlap_ms, name, _color))) = overlap_by_project
                .into_iter()
                .max_by_key(|(_, (ms, _, _))| *ms)
            {
                let span_ms = session_end - session_start;
                if overlap_ms * 2 >= span_ms {
                    inferred_project_by_session.insert(session.id, Some(pid));
                    session.suggested_project_name = Some(name);
                    session.suggested_project_id = Some(pid);
                    session.suggested_confidence = Some(1.0);
                }
            }
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
        Ok((sessions, suggestion_candidate_batch))
    })
    .await?;

    if include_ai_suggestions && !needs_suggestion.is_empty() {
        let status = crate::commands::get_assignment_model_status(app.clone()).await?;
        if status.mode != "off" {
            sessions = run_db_blocking(app.clone(), move |conn| {
                let mut suggestions =
                    super::assignment_model::suggest_projects_for_sessions_with_status(
                        conn,
                        &status,
                        &needs_suggestion,
                    )?;

                if suggestions.len() < needs_suggestion.len() {
                    let needs_suggestion_set: HashSet<i64> =
                        needs_suggestion.iter().copied().collect();
                    let assigned_without_threshold: Vec<i64> = sessions
                        .iter()
                        .filter(|s| s.project_name.is_some())
                        .map(|s| s.id)
                        .filter(|id| {
                            needs_suggestion_set.contains(id) && !suggestions.contains_key(id)
                        })
                        .collect();

                    if !assigned_without_threshold.is_empty() {
                        let raw = super::assignment_model::suggest_projects_for_sessions_raw(
                            conn,
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
                        let placeholders =
                            pid_list.iter().map(|_| "?").collect::<Vec<_>>().join(",");
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

                Ok(sessions)
            })
            .await?;
        }
    }

    Ok(sessions)
}

#[tauri::command]
pub async fn get_session_count(app: AppHandle, filters: SessionFilters) -> Result<i64, String> {
    if let Some(pid) = filters.project_id {
        return run_db_blocking(app, move |conn| {
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
            temp_filters.project_id = None;
            apply_session_filters(&temp_filters, &mut sql, &mut params, &mut idx);

            let params_ref: Vec<&dyn rusqlite::types::ToSql> =
                params.iter().map(|p| p.as_ref()).collect();
            conn.query_row(&sql, params_ref.as_slice(), |row| row.get(0))
                .map_err(|e| e.to_string())
        })
        .await;
    }

    run_db_blocking(app, move |conn| {
        let mut sql = String::from(
            "SELECT COUNT(*) FROM sessions s
             JOIN applications a ON a.id = s.app_id
             WHERE (s.is_hidden IS NULL OR s.is_hidden = 0)",
        );
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        let mut idx = 1;

        apply_session_filters(&filters, &mut sql, &mut params, &mut idx);

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        conn.query_row(&sql, params_ref.as_slice(), |row| row.get(0))
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn assign_session_to_project(
    app: AppHandle,
    session_id: i64,
    project_id: Option<i64>,
    source: Option<String>,
) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        let session = tx
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

        let updated_session = tx
            .execute(
                "UPDATE sessions SET project_id = ?1 WHERE id = ?2",
                rusqlite::params![project_id, session_id],
            )
            .map_err(|e| e.to_string())?;

        let updated = tx
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

        upsert_manual_session_override(&tx, session_id, project_id).map_err(|e| {
            format!(
                "Failed to persist manual override for session {}: {}",
                session_id, e
            )
        })?;

        let action_source = source.unwrap_or_else(|| "manual_session_assign".to_string());
        tx.execute(
            "INSERT INTO assignment_feedback (session_id, app_id, from_project_id, to_project_id, source, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
            rusqlite::params![session_id, app_id, old_project_id, project_id, action_source],
        )
        .map_err(|e| e.to_string())?;

        tx.execute(
            "INSERT INTO assignment_model_state (key, value, updated_at)
             VALUES ('feedback_since_train', '1', datetime('now'))
             ON CONFLICT(key) DO UPDATE SET
               value = CAST(COALESCE(NULLIF(assignment_model_state.value, ''), '0') AS INTEGER) + 1,
               updated_at = datetime('now')",
            [],
        )
        .map_err(|e| e.to_string())?;

        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
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

    run_db_blocking(app, move |conn| {
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
    })
    .await
}

#[tauri::command]
pub async fn delete_session(app: AppHandle, session_id: i64) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
        conn.execute(
            "UPDATE sessions SET is_hidden = 1 WHERE id = ?1",
            [session_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn update_session_comment(
    app: AppHandle,
    session_id: i64,
    comment: Option<String>,
) -> Result<(), String> {
    let normalized = comment.and_then(|c| {
        let trimmed = c.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });
    run_db_blocking(app, move |conn| {
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
    })
    .await
}

#[tauri::command]
pub async fn rebuild_sessions(app: AppHandle, gap_fill_minutes: i64) -> Result<i64, String> {
    run_db_blocking(app, move |conn| {
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
                    let start_ms = parse_datetime_ms(&start_time);
                    let end_ms = parse_datetime_ms(&end_time);

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
                    && (sessions[c_idx].rate_multiplier - sessions[i].rate_multiplier).abs()
                        < 0.000_001
                    && (sessions[i].start_ms - curr_end) <= gap_ms
                {
                    let gap_duration = (sessions[i].start_ms - curr_end) / 1000;
                    let new_end = std::cmp::max(curr_end, sessions[i].end_ms);
                    sessions[c_idx].end_ms = new_end;
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
                    if let Some(orig_end) = parse_datetime_fixed(&s.end_time) {
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
    })
    .await
}

#[derive(Clone, Debug)]
struct SplitSegmentMutation {
    session_id: i64,
    start_time: String,
    end_time: String,
    project_id: Option<i64>,
    feedback_source: String,
}

fn parse_iso_datetime(value: &str) -> Result<chrono::DateTime<chrono::FixedOffset>, String> {
    parse_datetime_fixed(value).ok_or_else(|| format!("Unsupported datetime format: {}", value))
}

fn apply_split_side_effects(
    tx: &rusqlite::Transaction<'_>,
    app_id: i64,
    date: &str,
    from_project_id: Option<i64>,
    segments: &[SplitSegmentMutation],
) -> Result<(), String> {
    if segments.is_empty() {
        return Ok(());
    }

    let mut parsed_segments = Vec::with_capacity(segments.len());
    for segment in segments {
        let start = parse_iso_datetime(&segment.start_time)
            .map_err(|e| format!("Invalid split segment start_time: {}", e))?;
        let end = parse_iso_datetime(&segment.end_time)
            .map_err(|e| format!("Invalid split segment end_time: {}", e))?;
        parsed_segments.push((segment, start, end));
    }

    let overall_start = segments
        .first()
        .map(|segment| segment.start_time.as_str())
        .ok_or_else(|| "Missing first split segment".to_string())?;
    let overall_end = segments
        .last()
        .map(|segment| segment.end_time.as_str())
        .ok_or_else(|| "Missing last split segment".to_string())?;

    let activities: Vec<(i64, String, String)> = {
        let mut stmt = tx
            .prepare_cached(
                "SELECT id, first_seen, last_seen
                 FROM file_activities
                 WHERE app_id = ?1
                   AND date = ?2
                   AND last_seen > ?3
                   AND first_seen < ?4",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(
                rusqlite::params![app_id, date, overall_start, overall_end],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read file_activities for split: {}", e))?
    };

    for (activity_id, first_seen, last_seen) in activities {
        let first_dt = match parse_iso_datetime(&first_seen) {
            Ok(value) => value,
            Err(error) => {
                log::warn!(
                    "Skipping split file_activity {} due to invalid first_seen '{}': {}",
                    activity_id,
                    first_seen,
                    error
                );
                continue;
            }
        };
        let last_dt = match parse_iso_datetime(&last_seen) {
            Ok(value) => value,
            Err(error) => {
                log::warn!(
                    "Skipping split file_activity {} due to invalid last_seen '{}': {}",
                    activity_id,
                    last_seen,
                    error
                );
                continue;
            }
        };
        let midpoint = first_dt
            + chrono::Duration::milliseconds(
                (last_dt.timestamp_millis() - first_dt.timestamp_millis()).max(0) / 2,
            );
        let chosen_segment = parsed_segments
            .iter()
            .find(|(_, _, end)| midpoint < *end)
            .or_else(|| parsed_segments.last())
            .ok_or_else(|| "No parsed split segment available".to_string())?;
        tx.execute(
            "UPDATE file_activities SET project_id = ?1 WHERE id = ?2",
            rusqlite::params![chosen_segment.0.project_id, activity_id],
        )
        .map_err(|e| e.to_string())?;
    }

    for segment in segments {
        tx.execute(
            "INSERT INTO assignment_feedback (session_id, app_id, from_project_id, to_project_id, source, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
            rusqlite::params![
                segment.session_id,
                app_id,
                from_project_id,
                segment.project_id,
                segment.feedback_source
            ],
        )
        .map_err(|e| e.to_string())?;

        if let Err(error) =
            upsert_manual_session_override(tx, segment.session_id, segment.project_id)
        {
            log::warn!(
                "Failed to update manual override after split for session {}: {}",
                segment.session_id,
                error
            );
        }
    }

    let feedback_count = segments.len() as i64;
    tx.execute(
        "INSERT INTO assignment_model_state (key, value, updated_at)
         VALUES ('feedback_since_train', ?1, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
           value = CAST(COALESCE(NULLIF(assignment_model_state.value, ''), '0') AS INTEGER) + ?1,
           updated_at = datetime('now')",
        [feedback_count],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(Clone, Debug)]
struct SplitSourceSession {
    app_id: i64,
    start_time: String,
    end_time: String,
    duration_seconds: i64,
    date_str: String,
    rate_multiplier: f64,
    orig_project_id: Option<i64>,
    comment: Option<String>,
}

fn load_split_source_session(
    conn: &rusqlite::Connection,
    session_id: i64,
    only_visible: bool,
) -> Result<SplitSourceSession, String> {
    let sql = if only_visible {
        "SELECT app_id, start_time, end_time, duration_seconds, date, rate_multiplier, project_id, comment, split_source_session_id
         FROM sessions WHERE id = ?1 AND (is_hidden IS NULL OR is_hidden = 0)"
    } else {
        "SELECT app_id, start_time, end_time, duration_seconds, date, rate_multiplier, project_id, comment, split_source_session_id
         FROM sessions WHERE id = ?1"
    };

    let (session, split_source) = conn
        .query_row(sql, [session_id], |row| {
            Ok((
                SplitSourceSession {
                    app_id: row.get::<_, i64>(0)?,
                    start_time: row.get::<_, String>(1)?,
                    end_time: row.get::<_, String>(2)?,
                    duration_seconds: row.get::<_, i64>(3)?,
                    date_str: row.get::<_, String>(4)?,
                    rate_multiplier: row.get::<_, f64>(5)?,
                    orig_project_id: row.get::<_, Option<i64>>(6)?,
                    comment: row.get::<_, Option<String>>(7)?,
                },
                row.get::<_, Option<i64>>(8)?,
            ))
        })
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Session not found".to_string())?;

    if split_source.is_some() {
        return Err("Session has already been split and cannot be split again".to_string());
    }

    Ok(session)
}

fn validate_split_parts(splits: &[SplitPart]) -> Result<(), String> {
    if splits.is_empty() || splits.len() > 5 {
        return Err("Splits must have 1-5 parts".to_string());
    }

    let ratio_sum: f64 = splits.iter().map(|s| s.ratio).sum();
    if (ratio_sum - 1.0).abs() > 0.01 {
        return Err(format!("Ratios must sum to 1.0, got {:.4}", ratio_sum));
    }

    for (i, part) in splits.iter().enumerate() {
        if part.ratio <= 0.0 || part.ratio > 1.0 {
            return Err(format!("Part {} ratio must be between 0 and 1", i));
        }
    }

    Ok(())
}

/// Remove all "Split N/M" markers (including parenthesized and pipe-separated)
/// from a comment string to prevent nested markers like "Split 1/2 (Split 1/2)".
fn strip_split_markers(input: &str) -> String {
    let mut result = input.to_string();
    // Remove patterns like "(Split 1/2)", "Split 1/2", "| Split 1/2"
    loop {
        let before = result.clone();
        // Remove parenthesized: (Split N/N)
        if let Some(start) = result.find("(Split ") {
            if let Some(end) = result[start..].find(')') {
                let candidate = &result[start..start + end + 1];
                if candidate.contains('/') {
                    result = format!(
                        "{}{}",
                        &result[..start],
                        &result[start + end + 1..]
                    );
                }
            }
        }
        // Remove bare: Split N/N (only if it looks like a split marker)
        if let Some(start) = result.find("Split ") {
            let rest = &result[start + 6..];
            if let Some(slash) = rest.find('/') {
                let before_slash = &rest[..slash];
                let after_slash_end = rest[slash + 1..]
                    .find(|c: char| !c.is_ascii_digit())
                    .unwrap_or(rest.len() - slash - 1);
                let after_slash = &rest[slash + 1..slash + 1 + after_slash_end];
                if before_slash.chars().all(|c| c.is_ascii_digit())
                    && !before_slash.is_empty()
                    && after_slash.chars().all(|c| c.is_ascii_digit())
                    && !after_slash.is_empty()
                {
                    let marker_end = start + 6 + slash + 1 + after_slash_end;
                    result = format!("{}{}", &result[..start], &result[marker_end..]);
                }
            }
        }
        // Remove leftover separators
        result = result.replace(" | ", " ").replace("  ", " ");
        result = result.trim().to_string();
        if result == before {
            break;
        }
    }
    result
}

fn execute_session_split(
    conn: &mut rusqlite::Connection,
    session_id: i64,
    source: &SplitSourceSession,
    splits: &[SplitPart],
) -> Result<(), String> {
    validate_split_parts(splits)?;

    let start_dt =
        parse_iso_datetime(&source.start_time).map_err(|e| format!("Invalid start time: {}", e))?;
    let end_dt =
        parse_iso_datetime(&source.end_time).map_err(|e| format!("Invalid end time: {}", e))?;
    let total_ms = (end_dt.timestamp_millis() - start_dt.timestamp_millis()).max(0);

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let n = splits.len();
    let mut cursor_ms: i64 = 0;
    let mut cursor_secs: i64 = 0;
    let mut split_segments: Vec<SplitSegmentMutation> = Vec::with_capacity(n);

    for (i, part) in splits.iter().enumerate() {
        let is_last = i == n - 1;

        let part_ms = if is_last {
            total_ms - cursor_ms
        } else {
            (total_ms as f64 * part.ratio).round() as i64
        };

        let part_secs = if is_last {
            source.duration_seconds - cursor_secs
        } else {
            (source.duration_seconds as f64 * part.ratio).round() as i64
        };

        let part_start = start_dt + chrono::Duration::milliseconds(cursor_ms);
        let part_end = start_dt + chrono::Duration::milliseconds(cursor_ms + part_ms);
        let part_start_str = part_start.to_rfc3339();
        let part_end_str = part_end.to_rfc3339();
        let split_marker = format!("Split {}/{}", i + 1, n);
        let part_comment = match source.comment.as_deref() {
            Some(c) if c.is_empty() => split_marker,
            Some(c) => {
                // Strip any existing split markers to prevent nesting like "Split 1/2 (Split 1/2)"
                let cleaned = strip_split_markers(c);
                if cleaned.is_empty() {
                    split_marker
                } else {
                    format!("{} | {}", cleaned, split_marker)
                }
            }
            None => split_marker,
        };
        let feedback_source = format!("manual_session_split_part_{}", i + 1);

        if i == 0 {
            tx.execute(
                "UPDATE sessions
                 SET end_time = ?1,
                     duration_seconds = ?2,
                     project_id = ?3,
                     comment = ?4,
                     split_source_session_id = ?5
                 WHERE id = ?6",
                rusqlite::params![
                    part_end_str.as_str(),
                    part_secs,
                    part.project_id,
                    part_comment,
                    session_id,
                    session_id,
                ],
            )
            .map_err(|e| e.to_string())?;
            split_segments.push(SplitSegmentMutation {
                session_id,
                start_time: part_start_str,
                end_time: part_end_str,
                project_id: part.project_id,
                feedback_source,
            });
        } else {
            tx.execute(
                "INSERT INTO sessions (
                    app_id, start_time, end_time, duration_seconds, date, rate_multiplier, project_id, comment, split_source_session_id
                 )
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![
                    source.app_id,
                    part_start_str.as_str(),
                    part_end_str.as_str(),
                    part_secs,
                    source.date_str.as_str(),
                    source.rate_multiplier,
                    part.project_id,
                    part_comment,
                    session_id,
                ],
            )
            .map_err(|e| e.to_string())?;
            split_segments.push(SplitSegmentMutation {
                session_id: tx.last_insert_rowid(),
                start_time: part_start_str,
                end_time: part_end_str,
                project_id: part.project_id,
                feedback_source,
            });
        }

        cursor_ms += part_ms;
        cursor_secs += part_secs;
    }

    apply_split_side_effects(
        &tx,
        source.app_id,
        &source.date_str,
        source.orig_project_id,
        split_segments.as_slice(),
    )?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
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

    let splits = vec![
        SplitPart {
            project_id: project_a_id,
            ratio,
        },
        SplitPart {
            project_id: project_b_id,
            ratio: 1.0 - ratio,
        },
    ];
    run_db_blocking(app, move |conn| {
        let source = load_split_source_session(conn, session_id, false)?;
        execute_session_split(conn, session_id, &source, splits.as_slice())
    })
    .await
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
    run_db_blocking(app, move |conn| {
        let (app_id, date, current_project_id, suggested_project_id): (
            i64,
            String,
            Option<i64>,
            Option<i64>,
        ) = conn
            .query_row(
                "SELECT app_id, date, project_id,
                        (SELECT af.to_project_id FROM assignment_feedback af WHERE af.session_id = sessions.id ORDER BY af.created_at DESC LIMIT 1)
                 FROM sessions WHERE id = ?1",
                [session_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(|e| format!("Session not found: {}", e))?;

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

        if let (Some(cur), Some(sug)) = (current_project_id, suggested_project_id) {
            if cur != sug {
                let name_a: String = conn
                    .query_row("SELECT name FROM projects WHERE id = ?1", [cur], |r| r.get(0))
                    .unwrap_or_default();
                let name_b: String = conn
                    .query_row("SELECT name FROM projects WHERE id = ?1", [sug], |r| r.get(0))
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

        Ok(SplitSuggestion {
            project_a_id: current_project_id,
            project_a_name: None,
            project_b_id: None,
            project_b_name: None,
            suggested_ratio: 0.5,
            confidence: 0.0,
        })
    })
    .await
}

/// Analyzes file activities for a session to determine which projects are present
/// and whether the session is a candidate for multi-project splitting.
#[tauri::command]
pub async fn analyze_session_projects(
    app: AppHandle,
    session_id: i64,
    tolerance_threshold: f64,
    max_projects: i64,
) -> Result<MultiProjectAnalysis, String> {
    let normalized_max_projects = max_projects.clamp(2, 5);
    let normalized_tolerance = tolerance_threshold.clamp(0.2, 1.0);

    // Prefer 4-layer assignment model scoring if available.
    if let Ok(score_breakdown) =
        assignment_model::get_session_score_breakdown(app.clone(), session_id).await
    {
        if !score_breakdown.candidates.is_empty() {
            let mut top = score_breakdown.candidates;
            top.sort_by(|a, b| {
                b.total_score
                    .partial_cmp(&a.total_score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            top.truncate(normalized_max_projects as usize);

            let leader_score = top.first().map(|c| c.total_score).unwrap_or(0.0);
            let leader_project_id = top.first().map(|c| c.project_id);

            let candidates: Vec<ProjectCandidate> = top
                .into_iter()
                .map(|candidate| ProjectCandidate {
                    project_id: candidate.project_id,
                    project_name: candidate.project_name,
                    score: candidate.total_score,
                    ratio_to_leader: if leader_score > 0.0 {
                        candidate.total_score / leader_score
                    } else {
                        0.0
                    },
                })
                .collect();

            let qualifying = candidates
                .iter()
                .filter(|candidate| candidate.ratio_to_leader >= normalized_tolerance)
                .count();

            return Ok(MultiProjectAnalysis {
                session_id,
                candidates,
                is_splittable: qualifying >= 2,
                leader_project_id,
                leader_score,
            });
        }
    }

    run_db_blocking(app, move |conn| {
        let (app_id, date): (i64, String) = conn
            .query_row(
                "SELECT app_id, date FROM sessions WHERE id = ?1",
                [session_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| format!("Session not found: {}", e))?;

        let mut stmt = conn
            .prepare_cached(
                "SELECT fa.project_id, p.name, SUM(fa.total_seconds) as total
                 FROM file_activities fa
                 LEFT JOIN projects p ON p.id = fa.project_id
                  WHERE fa.app_id = ?1 AND fa.date = ?2 AND fa.project_id IS NOT NULL
                  GROUP BY fa.project_id
                  ORDER BY total DESC
                  LIMIT ?3",
            )
            .map_err(|e| e.to_string())?;

        let candidates: Vec<(i64, String, f64)> = stmt
            .query_map(
                rusqlite::params![app_id, date, normalized_max_projects],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get::<_, String>(1).unwrap_or_default(),
                        row.get::<_, i64>(2).unwrap_or(0) as f64,
                    ))
                },
            )
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        if candidates.is_empty() {
            return Ok(MultiProjectAnalysis {
                session_id,
                candidates: vec![],
                is_splittable: false,
                leader_project_id: None,
                leader_score: 0.0,
            });
        }

        let leader_score = candidates[0].2;
        let leader_id = candidates[0].0;

        let project_candidates: Vec<ProjectCandidate> = candidates
            .iter()
            .map(|(pid, name, score)| ProjectCandidate {
                project_id: *pid,
                project_name: name.clone(),
                score: *score,
                ratio_to_leader: if leader_score > 0.0 {
                    *score / leader_score
                } else {
                    0.0
                },
            })
            .collect();

        let qualifying = project_candidates
            .iter()
            .filter(|c| c.ratio_to_leader >= normalized_tolerance)
            .count();

        Ok(MultiProjectAnalysis {
            session_id,
            candidates: project_candidates,
            is_splittable: qualifying >= 2,
            leader_project_id: Some(leader_id),
            leader_score,
        })
    })
    .await
}

/// Batch variant of `analyze_session_projects` that returns only splittable flags.
#[tauri::command]
pub async fn analyze_sessions_splittable(
    app: AppHandle,
    session_ids: Vec<i64>,
    tolerance_threshold: f64,
    max_projects: i64,
) -> Result<Vec<SessionSplittableFlag>, String> {
    if session_ids.is_empty() {
        return Ok(Vec::new());
    }

    let normalized_tolerance = tolerance_threshold.clamp(0.2, 1.0);
    let normalized_max_projects = max_projects.clamp(2, 5) as usize;
    run_db_blocking(app, move |conn| {
        let placeholders = std::iter::repeat("?")
            .take(session_ids.len())
            .collect::<Vec<_>>()
            .join(",");

        let sql = format!(
            "SELECT s.id AS session_id,
                    fa.project_id AS project_id,
                    COALESCE(p.name, '') AS project_name,
                    SUM(fa.total_seconds) AS total
             FROM sessions s
             LEFT JOIN file_activities fa
               ON fa.app_id = s.app_id
              AND fa.date = s.date
              AND fa.project_id IS NOT NULL
             LEFT JOIN projects p ON p.id = fa.project_id
             WHERE s.id IN ({})
             GROUP BY s.id, fa.project_id, p.name",
            placeholders
        );

        let mut stmt = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(session_ids.iter()), |row| {
                Ok((
                    row.get::<_, i64>("session_id")?,
                    row.get::<_, Option<i64>>("project_id")?,
                    row.get::<_, String>("project_name").unwrap_or_default(),
                    row.get::<_, Option<i64>>("total")?.unwrap_or(0),
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut candidates_by_session: HashMap<i64, Vec<ProjectCandidate>> = HashMap::new();
        for row in rows {
            let (session_id, project_id, project_name, total) =
                row.map_err(|e| format!("Failed to read split eligibility row: {}", e))?;
            let Some(pid) = project_id else {
                continue;
            };
            candidates_by_session
                .entry(session_id)
                .or_default()
                .push(ProjectCandidate {
                    project_id: pid,
                    project_name,
                    score: total as f64,
                    ratio_to_leader: 0.0,
                });
        }

        let mut result = Vec::with_capacity(session_ids.len());
        for session_id in session_ids {
            let Some(mut candidates) = candidates_by_session.remove(&session_id) else {
                result.push(SessionSplittableFlag {
                    session_id,
                    is_splittable: false,
                });
                continue;
            };

            if candidates.len() < 2 {
                result.push(SessionSplittableFlag {
                    session_id,
                    is_splittable: false,
                });
                continue;
            }

            candidates.sort_by(|a, b| {
                b.score
                    .partial_cmp(&a.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            candidates.truncate(normalized_max_projects);

            let leader_score = candidates[0].score;
            let qualifying = candidates
                .iter_mut()
                .map(|candidate| {
                    candidate.ratio_to_leader = if leader_score > 0.0 {
                        candidate.score / leader_score
                    } else {
                        0.0
                    };
                    candidate.ratio_to_leader >= normalized_tolerance
                })
                .filter(|is_qualifying| *is_qualifying)
                .count();

            result.push(SessionSplittableFlag {
                session_id,
                is_splittable: qualifying >= 2,
            });
        }

        Ok(result)
    })
    .await
}

/// Splits a session into N parts (max 5) with given ratios and optional project assignments.
#[tauri::command]
pub async fn split_session_multi(
    app: AppHandle,
    session_id: i64,
    splits: Vec<SplitPart>,
) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
        let source = load_split_source_session(conn, session_id, true)?;
        execute_session_split(conn, session_id, &source, splits.as_slice())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::{
        execute_session_split, load_split_source_session, parse_iso_datetime, SplitPart,
        SESSION_PROJECT_CTE_ALL_TIME,
    };

    fn setup_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE projects (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT DEFAULT '#38bdf8'
            );
            CREATE TABLE applications (
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
                split_source_session_id INTEGER,
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
            );
            CREATE TABLE assignment_feedback (
                id INTEGER PRIMARY KEY,
                session_id INTEGER,
                app_id INTEGER,
                from_project_id INTEGER,
                to_project_id INTEGER,
                source TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE assignment_model_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE session_manual_overrides (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER,
                executable_name TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                project_name TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(executable_name, start_time, end_time)
            );",
        )
        .expect("schema");
        conn.execute(
            "INSERT INTO applications (id, display_name, executable_name) VALUES (?1, ?2, ?3)",
            rusqlite::params![1_i64, "Editor", "editor.exe"],
        )
        .expect("insert app");
        conn.execute_batch(
            "INSERT INTO projects (id, name, color) VALUES
                (10, 'Alpha', '#1d4ed8'),
                (20, 'Beta', '#16a34a'),
                (30, 'Gamma', '#d97706');",
        )
        .expect("insert projects");
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

    #[test]
    fn split_suggestion_fallback_reads_latest_to_project_id() {
        let conn = setup_conn();
        conn.execute(
            "INSERT INTO sessions (id, app_id, start_time, end_time, duration_seconds, date, project_id, rate_multiplier, comment, is_hidden)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1.0, NULL, 0)",
            rusqlite::params![
                99_i64,
                1_i64,
                "2026-01-01T10:00:00Z",
                "2026-01-01T11:00:00Z",
                3600_i64,
                "2026-01-01",
                10_i64,
            ],
        )
        .expect("insert session");
        conn.execute(
            "INSERT INTO assignment_feedback (id, session_id, app_id, from_project_id, to_project_id, source, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                1_i64,
                99_i64,
                1_i64,
                10_i64,
                20_i64,
                "manual_session_assign",
                "2026-01-01T10:00:00Z",
            ],
        )
        .expect("insert feedback");
        conn.execute(
            "INSERT INTO assignment_feedback (id, session_id, app_id, from_project_id, to_project_id, source, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                2_i64,
                99_i64,
                1_i64,
                20_i64,
                30_i64,
                "manual_session_assign",
                "2026-01-01T11:00:00Z",
            ],
        )
        .expect("insert newer feedback");

        let suggested_project_id: Option<i64> = conn
            .query_row(
                "SELECT (SELECT af.to_project_id
                         FROM assignment_feedback af
                         WHERE af.session_id = sessions.id
                         ORDER BY af.created_at DESC
                         LIMIT 1)
                 FROM sessions
                 WHERE id = ?1",
                [99_i64],
                |row| row.get(0),
            )
            .expect("query suggested project");
        assert_eq!(suggested_project_id, Some(30));
    }

    #[test]
    fn split_single_updates_feedback_files_and_duration_consistently() {
        let mut conn = setup_conn();
        conn.execute(
            "INSERT INTO sessions (id, app_id, start_time, end_time, duration_seconds, date, project_id, rate_multiplier, comment, is_hidden)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 1.0, ?7, 0)",
            rusqlite::params![
                1_i64,
                1_i64,
                "2026-01-01T10:00:00Z",
                "2026-01-01T11:00:00Z",
                3600_i64,
                "2026-01-01",
                "Work block",
            ],
        )
        .expect("insert source session");
        conn.execute_batch(
            "INSERT INTO file_activities (id, app_id, date, file_name, total_seconds, first_seen, last_seen, project_id) VALUES
                (1, 1, '2026-01-01', 'a.rs', 600, '2026-01-01T10:05:00Z', '2026-01-01T10:20:00Z', NULL),
                (2, 1, '2026-01-01', 'b.rs', 600, '2026-01-01T10:40:00Z', '2026-01-01T10:55:00Z', NULL);",
        )
        .expect("insert file activities");

        let source = load_split_source_session(&conn, 1_i64, false).expect("load split source");
        let splits = vec![
            SplitPart {
                project_id: Some(10),
                ratio: 0.5,
            },
            SplitPart {
                project_id: Some(20),
                ratio: 0.5,
            },
        ];
        execute_session_split(&mut conn, 1_i64, &source, splits.as_slice()).expect("run split");

        let (session_count, total_duration): (i64, i64) = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(duration_seconds), 0) FROM sessions",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read session totals");
        assert_eq!(session_count, 2);
        assert_eq!(total_duration, 3600);

        let first_end: String = conn
            .query_row("SELECT end_time FROM sessions WHERE id = 1", [], |row| {
                row.get(0)
            })
            .expect("read first end");
        let first_end_ms = parse_iso_datetime(&first_end)
            .expect("parse first end")
            .timestamp_millis();
        let expected_split_ms = parse_iso_datetime("2026-01-01T10:30:00Z")
            .expect("parse expected split")
            .timestamp_millis();
        assert_eq!(first_end_ms, expected_split_ms);

        let second_id: i64 = conn
            .query_row("SELECT id FROM sessions WHERE id <> 1 LIMIT 1", [], |row| {
                row.get(0)
            })
            .expect("read second id");
        let (second_start, second_end, second_project): (String, String, Option<i64>) = conn
            .query_row(
                "SELECT start_time, end_time, project_id FROM sessions WHERE id = ?1",
                [second_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read second session");
        assert_eq!(
            parse_iso_datetime(&second_start)
                .expect("parse second start")
                .timestamp_millis(),
            expected_split_ms
        );
        assert_eq!(
            parse_iso_datetime(&second_end)
                .expect("parse second end")
                .timestamp_millis(),
            parse_iso_datetime("2026-01-01T11:00:00Z")
                .expect("parse expected end")
                .timestamp_millis()
        );
        assert_eq!(second_project, Some(20));

        let mut stmt = conn
            .prepare(
                "SELECT to_project_id FROM assignment_feedback
                 WHERE session_id IN (?1, ?2)
                 ORDER BY session_id ASC, to_project_id ASC",
            )
            .expect("prepare feedback query");
        let rows = stmt
            .query_map(rusqlite::params![1_i64, second_id], |row| {
                row.get::<_, Option<i64>>(0)
            })
            .expect("query feedback rows");
        let to_projects: Vec<Option<i64>> = rows
            .collect::<Result<Vec<_>, _>>()
            .expect("collect feedback projects");
        assert_eq!(to_projects, vec![Some(10), Some(20)]);

        let activities: Vec<Option<i64>> = conn
            .prepare("SELECT project_id FROM file_activities ORDER BY id ASC")
            .expect("prepare file activity query")
            .query_map([], |row| row.get::<_, Option<i64>>(0))
            .expect("query file activity projects")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect activity projects");
        assert_eq!(activities, vec![Some(10), Some(20)]);

        let feedback_since_train: String = conn
            .query_row(
                "SELECT value FROM assignment_model_state WHERE key = 'feedback_since_train'",
                [],
                |row| row.get(0),
            )
            .expect("read feedback_since_train");
        assert_eq!(feedback_since_train, "2");
    }

    #[test]
    fn split_multi_preserves_total_duration_and_writes_feedback_per_part() {
        let mut conn = setup_conn();
        conn.execute(
            "INSERT INTO sessions (id, app_id, start_time, end_time, duration_seconds, date, project_id, rate_multiplier, comment, is_hidden)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 1.0, ?7, 0)",
            rusqlite::params![
                5_i64,
                1_i64,
                "2026-01-01T10:00:00Z",
                "2026-01-01T12:00:00Z",
                7200_i64,
                "2026-01-01",
                "Long block",
            ],
        )
        .expect("insert source session");
        conn.execute_batch(
            "INSERT INTO file_activities (id, app_id, date, file_name, total_seconds, first_seen, last_seen, project_id) VALUES
                (1, 1, '2026-01-01', 'a.rs', 900, '2026-01-01T10:05:00Z', '2026-01-01T10:20:00Z', NULL),
                (2, 1, '2026-01-01', 'b.rs', 1200, '2026-01-01T10:40:00Z', '2026-01-01T11:00:00Z', NULL),
                (3, 1, '2026-01-01', 'c.rs', 1200, '2026-01-01T11:20:00Z', '2026-01-01T11:40:00Z', NULL);",
        )
        .expect("insert file activities");

        let source = load_split_source_session(&conn, 5_i64, true).expect("load split source");
        let splits = vec![
            SplitPart {
                project_id: Some(10),
                ratio: 0.25,
            },
            SplitPart {
                project_id: Some(20),
                ratio: 0.25,
            },
            SplitPart {
                project_id: Some(30),
                ratio: 0.5,
            },
        ];
        execute_session_split(&mut conn, 5_i64, &source, splits.as_slice()).expect("run split");

        let (session_count, total_duration): (i64, i64) = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(duration_seconds), 0) FROM sessions",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read session totals");
        assert_eq!(session_count, 3);
        assert_eq!(total_duration, 7200);

        let max_end: String = conn
            .query_row(
                "SELECT end_time FROM sessions ORDER BY end_time DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .expect("read last end");
        assert_eq!(
            parse_iso_datetime(&max_end)
                .expect("parse max end")
                .timestamp_millis(),
            parse_iso_datetime("2026-01-01T12:00:00Z")
                .expect("parse expected end")
                .timestamp_millis()
        );

        let feedback_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM assignment_feedback WHERE session_id IN (SELECT id FROM sessions)",
                [],
                |row| row.get(0),
            )
            .expect("read feedback count");
        assert_eq!(feedback_count, 3);

        let feedback_since_train: String = conn
            .query_row(
                "SELECT value FROM assignment_model_state WHERE key = 'feedback_since_train'",
                [],
                |row| row.get(0),
            )
            .expect("read feedback_since_train");
        assert_eq!(feedback_since_train, "3");

        let activities: Vec<Option<i64>> = conn
            .prepare("SELECT project_id FROM file_activities ORDER BY id ASC")
            .expect("prepare file activity query")
            .query_map([], |row| row.get::<_, Option<i64>>(0))
            .expect("query file activity projects")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect activity projects");
        assert_eq!(activities, vec![Some(10), Some(20), Some(30)]);
    }
}
