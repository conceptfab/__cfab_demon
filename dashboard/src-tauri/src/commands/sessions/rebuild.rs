use tauri::AppHandle;

use super::super::datetime::{parse_datetime_fixed, parse_datetime_ms};
use super::super::helpers::run_db_blocking;
use super::super::sql_fragments::ACTIVE_SESSION_FILTER;

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
            let sql = format!(
                "SELECT id, app_id, project_id, COALESCE(rate_multiplier, 1.0), start_time, end_time, date, duration_seconds
                 FROM sessions
                 WHERE {ACTIVE_SESSION_FILTER}
                   AND split_source_session_id IS NULL
                 ORDER BY app_id, project_id, start_time ASC"
            );
            let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;

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
                    let gap_duration = ((sessions[i].start_ms - curr_end) / 1000).max(0);
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
            }
            if !merged_into.is_empty() {
                let from_ids: Vec<String> = merged_into
                    .iter()
                    .filter(|(f, t)| f != t)
                    .map(|(f, _)| f.to_string())
                    .collect();
                if !from_ids.is_empty() {
                    let placeholders = from_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                    tx.execute(
                        &format!(
                            "DELETE FROM session_manual_overrides WHERE session_id IN ({})",
                            placeholders
                        ),
                        rusqlite::params_from_iter(from_ids.iter()),
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
        }

        if !to_delete.is_empty() {
            let placeholders = to_delete.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            tx.execute(
                &format!("DELETE FROM sessions WHERE id IN ({})", placeholders),
                rusqlite::params_from_iter(to_delete.iter()),
            )
            .map_err(|e| e.to_string())?;
        }

        tx.commit().map_err(|e| e.to_string())?;

        Ok(to_delete.len() as i64)
    })
    .await
}
