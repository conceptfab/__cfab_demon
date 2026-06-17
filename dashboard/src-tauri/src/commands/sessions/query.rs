use std::collections::{HashMap, HashSet};
use tauri::AppHandle;

use super::super::datetime::parse_datetime_ms_opt;
use super::super::helpers::run_db_blocking;
use super::super::sql_fragments::{
    ensure_session_project_cache, ensure_session_project_cache_all, ACTIVE_SESSION_FILTER_S,
    SESSION_PROJECT_CTE_ALL_TIME,
};
use super::super::types::{FileActivity, SessionFilters, SessionWithApp};

#[derive(Clone)]
struct IndexedFileActivity {
    activity: FileActivity,
    first_seen_ms: Option<i64>,
    last_seen_ms: Option<i64>,
    parsed_spans: Vec<(i64, i64)>,
}

struct TempFileActivityKeysCleanup<'a> {
    conn: &'a rusqlite::Connection,
}

impl Drop for TempFileActivityKeysCleanup<'_> {
    fn drop(&mut self) {
        let _ = self.conn.execute_batch("DROP TABLE IF EXISTS _fa_keys");
    }
}

impl IndexedFileActivity {
    fn new(activity: FileActivity) -> Self {
        let parsed_spans: Vec<(i64, i64)> = activity
            .activity_spans
            .iter()
            .filter_map(|(s, e)| {
                Some((parse_datetime_ms_opt(s)?, parse_datetime_ms_opt(e)?))
            })
            .collect();

        Self {
            first_seen_ms: parse_datetime_ms_opt(&activity.first_seen),
            last_seen_ms: parse_datetime_ms_opt(&activity.last_seen),
            activity,
            parsed_spans,
        }
    }

    fn overlap_ms(&self, session_start_ms: i64, session_end_ms: i64) -> Option<i64> {
        // If we have spans, use them for precise overlap
        if !self.parsed_spans.is_empty() {
            let total: i64 = self
                .parsed_spans
                .iter()
                .filter_map(|&(span_start, span_end)| {
                    compute_overlap_ms(session_start_ms, session_end_ms, span_start, span_end)
                })
                .sum();
            return if total > 0 { Some(total) } else { None };
        }

        // Fallback to first_seen/last_seen for legacy data
        compute_overlap_ms(
            session_start_ms,
            session_end_ms,
            self.first_seen_ms?,
            self.last_seen_ms?,
        )
    }
}

fn compute_overlap_ms(
    range_start_ms: i64,
    range_end_ms: i64,
    other_start_ms: i64,
    other_end_ms: i64,
) -> Option<i64> {
    if range_end_ms <= range_start_ms || other_end_ms <= other_start_ms {
        return None;
    }

    let overlap_ms =
        std::cmp::min(range_end_ms, other_end_ms) - std::cmp::max(range_start_ms, other_start_ms);
    if overlap_ms > 0 {
        Some(overlap_ms)
    } else {
        None
    }
}

fn collect_session_file_activities<'a>(
    files_by_key: &'a HashMap<(i64, String), Vec<IndexedFileActivity>>,
    app_id: i64,
    session_date: &str,
    session_start_ms: i64,
    session_end_ms: i64,
) -> Vec<&'a IndexedFileActivity> {
    files_by_key
        .get(&(app_id, session_date.to_string()))
        .into_iter()
        .flat_map(|files| files.iter())
        .filter(|file| file.overlap_ms(session_start_ms, session_end_ms).is_some())
        .collect()
}

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

fn apply_limit_offset(
    sql: &mut String,
    params: &mut Vec<Box<dyn rusqlite::types::ToSql>>,
    idx: &mut usize,
    limit: Option<i64>,
    offset: Option<i64>,
) {
    if let Some(limit) = limit {
        sql.push_str(&format!(" LIMIT ?{}", *idx));
        params.push(Box::new(limit));
        *idx += 1;
    } else if offset.is_some() {
        // SQLite requires LIMIT when OFFSET is present.
        sql.push_str(" LIMIT -1");
    }

    if let Some(offset) = offset {
        sql.push_str(&format!(" OFFSET ?{}", *idx));
        params.push(Box::new(offset));
        *idx += 1;
    }
}

pub async fn get_sessions(
    app: AppHandle,
    filters: SessionFilters,
) -> Result<Vec<SessionWithApp>, String> {
    let include_files = filters.include_files.unwrap_or(true);
    let include_ai_suggestions = filters.include_ai_suggestions.unwrap_or(true);
    let (mut sessions, needs_suggestion) = run_db_blocking(app.clone(), move |conn| {
        let project_filter = filters.project_id;
        if project_filter.is_some() {
            if let Some(date_range) = filters.date_range.as_ref() {
                ensure_session_project_cache(conn, &date_range.start, &date_range.end)?;
            } else {
                ensure_session_project_cache_all(conn)?;
            }
        }
        let mut sql = if project_filter.is_some() {
            format!(
                "{SESSION_PROJECT_CTE_ALL_TIME}
                 SELECT s.id, s.app_id, s.start_time, s.end_time, s.duration_seconds,
                    COALESCE(s.rate_multiplier, 1.0),
                    a.display_name, a.executable_name, s.project_id, COALESCE(p.name, s.project_name), p.color,
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
             WHERE 1=1 AND {ACTIVE_SESSION_FILTER_S}"
            )
        } else {
            format!(
                "SELECT s.id, s.app_id, s.start_time, s.end_time, s.duration_seconds,
                    COALESCE(s.rate_multiplier, 1.0),
                    a.display_name, a.executable_name, s.project_id, COALESCE(p.name, s.project_name), p.color,
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
             WHERE 1=1 AND {ACTIVE_SESSION_FILTER_S}",
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

        apply_limit_offset(&mut sql, &mut params, &mut idx, filters.limit, filters.offset);

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

        let mut files_by_key: HashMap<(i64, String), Vec<IndexedFileActivity>> = HashMap::new();
        if include_files && !keys.is_empty() {
            conn.execute_batch(
                "CREATE TEMP TABLE IF NOT EXISTS _fa_keys (app_id INTEGER, date TEXT)",
            )
            .map_err(|e| e.to_string())?;
            let _temp_keys_cleanup = TempFileActivityKeysCleanup { conn };
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
                            fa.project_id, p.name, p.color, fa.activity_spans
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
                            activity_spans: {
                                let json: String = row.get::<_, String>(10).unwrap_or_else(|_| "[]".to_string());
                                serde_json::from_str(&json).unwrap_or_default()
                            },
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
                    .push(IndexedFileActivity::new(activity));
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

            let session_start = match parse_datetime_ms_opt(&session.start_time) {
                Some(dt) => dt,
                None => continue,
            };
            let session_end = match parse_datetime_ms_opt(&session.end_time) {
                Some(dt) => dt,
                None => continue,
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
            let matching_files = collect_session_file_activities(
                &files_by_key,
                session.app_id,
                &session_date,
                session_start,
                session_end,
            );
            session.files = matching_files
                .iter()
                .map(|file| file.activity.clone())
                .collect();

            if explicit_pids.get(&session.id).copied().flatten().is_some() {
                continue;
            }

            let mut overlap_by_project: HashMap<i64, (i64, Option<String>, String)> =
                HashMap::new();
            for indexed_file in matching_files {
                let f = &indexed_file.activity;
                let Some(pid) = f.project_id else { continue };
                let Some(overlap_ms) = indexed_file.overlap_ms(session_start, session_end) else {
                    continue;
                };
                let name = f.project_name.clone().filter(|value| !value.trim().is_empty());
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
                    session.suggested_project_name = name;
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
                    super::super::assignment_model::suggest_projects_for_sessions_with_status(
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
                        let raw =
                            super::super::assignment_model::suggest_projects_for_sessions_unfiltered(
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
                    let mut project_name_by_id: HashMap<i64, String> = HashMap::new();
                    for session in &sessions {
                        if let (Some(pid), Some(name)) = (
                            session.project_id,
                            session
                                .project_name
                                .as_ref()
                                .map(|value| value.trim())
                                .filter(|value| !value.is_empty()),
                        ) {
                            project_name_by_id
                                .entry(pid)
                                .or_insert_with(|| name.to_string());
                        }
                        if let (Some(pid), Some(name)) = (
                            session.suggested_project_id,
                            session
                                .suggested_project_name
                                .as_ref()
                                .map(|value| value.trim())
                                .filter(|value| !value.is_empty()),
                        ) {
                            project_name_by_id
                                .entry(pid)
                                .or_insert_with(|| name.to_string());
                        }
                    }

                    let mut suggested_project_ids: HashSet<i64> = HashSet::new();
                    for suggestion in suggestions.values() {
                        if !project_name_by_id.contains_key(&suggestion.project_id) {
                            suggested_project_ids.insert(suggestion.project_id);
                        }
                    }

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

#[cfg(test)]
mod tests {
    use super::{
        apply_limit_offset, collect_session_file_activities, compute_overlap_ms,
        IndexedFileActivity,
    };
    use crate::commands::datetime::parse_datetime_ms_opt;
    use crate::commands::types::FileActivity;
    use std::collections::HashMap;

    fn activity(
        id: i64,
        first_seen: &str,
        last_seen: &str,
        file_name: &str,
    ) -> IndexedFileActivity {
        IndexedFileActivity::new(FileActivity {
            id,
            app_id: 1,
            file_name: file_name.to_string(),
            total_seconds: 300,
            first_seen: first_seen.to_string(),
            last_seen: last_seen.to_string(),
            project_id: None,
            project_name: None,
            project_color: None,
            activity_spans: vec![],
        })
    }

    #[test]
    fn overlap_ms_only_counts_real_intersection() {
        assert_eq!(compute_overlap_ms(1_000, 5_000, 4_000, 8_000), Some(1_000));
        assert_eq!(compute_overlap_ms(1_000, 5_000, 5_000, 8_000), None);
        assert_eq!(compute_overlap_ms(1_000, 5_000, 7_000, 8_000), None);
    }

    #[test]
    fn collect_session_file_activities_keeps_only_overlapping_files() {
        let mut files_by_key: HashMap<(i64, String), Vec<IndexedFileActivity>> = HashMap::new();
        files_by_key.insert(
            (1, "2026-01-01".to_string()),
            vec![
                activity(
                    1,
                    "2026-01-01T10:05:00Z",
                    "2026-01-01T10:20:00Z",
                    "inside.rs",
                ),
                activity(
                    2,
                    "2026-01-01T09:00:00Z",
                    "2026-01-01T09:30:00Z",
                    "before.rs",
                ),
                activity(
                    3,
                    "2026-01-01T11:00:00Z",
                    "2026-01-01T11:30:00Z",
                    "touching-end.rs",
                ),
                activity(
                    4,
                    "2026-01-01T10:50:00Z",
                    "2026-01-01T11:10:00Z",
                    "partial.rs",
                ),
            ],
        );

        let files = collect_session_file_activities(
            &files_by_key,
            1,
            "2026-01-01",
            parse_datetime_ms_opt("2026-01-01T10:00:00Z").expect("valid session start"),
            parse_datetime_ms_opt("2026-01-01T11:00:00Z").expect("valid session end"),
        );

        let file_ids: Vec<i64> = files.iter().map(|file| file.activity.id).collect();
        assert_eq!(file_ids, vec![1, 4]);
    }

    #[test]
    fn apply_limit_offset_adds_limit_minus_one_when_only_offset_is_provided() {
        let mut sql = String::from("SELECT * FROM sessions");
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        let mut idx = 3;

        apply_limit_offset(&mut sql, &mut params, &mut idx, None, Some(0));

        assert_eq!(sql, "SELECT * FROM sessions LIMIT -1 OFFSET ?3");
        assert_eq!(params.len(), 1);
        assert_eq!(idx, 4);
    }

    #[test]
    fn apply_limit_offset_keeps_standard_limit_and_offset_order() {
        let mut sql = String::from("SELECT * FROM sessions");
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        let mut idx = 1;

        apply_limit_offset(&mut sql, &mut params, &mut idx, Some(100), Some(50));

        assert_eq!(sql, "SELECT * FROM sessions LIMIT ?1 OFFSET ?2");
        assert_eq!(params.len(), 2);
        assert_eq!(idx, 3);
    }
}

pub async fn get_session_count(app: AppHandle, filters: SessionFilters) -> Result<i64, String> {
    if let Some(pid) = filters.project_id {
        return run_db_blocking(app, move |conn| {
            if let Some(date_range) = filters.date_range.as_ref() {
                ensure_session_project_cache(conn, &date_range.start, &date_range.end)?;
            } else {
                ensure_session_project_cache_all(conn)?;
            }

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
        let mut sql = format!(
            "SELECT COUNT(*) FROM sessions s
             JOIN applications a ON a.id = s.app_id
             WHERE {ACTIVE_SESSION_FILTER_S}",
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
