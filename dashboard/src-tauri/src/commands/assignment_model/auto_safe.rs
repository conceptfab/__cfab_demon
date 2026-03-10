use rusqlite::{OptionalExtension, ToSql};
use crate::commands::types::DateRange;
use crate::commands::assignment_model::{
    config::{clamp_i64, increment_feedback_counter},
    context::build_session_context,
    scoring::{check_manual_override, compute_raw_suggestion, meets_auto_safe_threshold},
    AssignmentModelStatus, AutoSafeRollbackResult, AutoSafeRunResult, DeterministicResult,
    AUTO_SAFE_MIN_MARGIN,
};

pub fn fetch_unassigned_session_ids(
    conn: &rusqlite::Connection,
    limit: i64,
    date_range: Option<DateRange>,
    min_duration: Option<i64>,
) -> Result<Vec<i64>, String> {
    let mut sql = String::from(
        "SELECT id
         FROM sessions
         WHERE (is_hidden IS NULL OR is_hidden = 0) AND project_id IS NULL",
    );
    let mut params: Vec<Box<dyn ToSql>> = Vec::new();
    let mut idx = 1;

    if let Some(min_dur) = min_duration {
        if min_dur > 0 {
            sql.push_str(&format!(" AND duration_seconds > ?{}", idx));
            params.push(Box::new(min_dur));
            idx += 1;
        }
    }

    if let Some(dr) = date_range {
        sql.push_str(&format!(" AND date >= ?{}", idx));
        params.push(Box::new(dr.start));
        idx += 1;
        sql.push_str(&format!(" AND date <= ?{}", idx));
        params.push(Box::new(dr.end));
        idx += 1;
    }

    sql.push_str(" ORDER BY start_time DESC");
    sql.push_str(&format!(" LIMIT ?{}", idx));
    params.push(Box::new(limit));

    let params_ref: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params_ref.as_slice(), |row| row.get::<_, i64>(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read unassigned session id row: {}", e))
}

pub fn run_auto_safe_sync(
    conn: &mut rusqlite::Connection,
    status: &AssignmentModelStatus,
    limit: Option<i64>,
    date_range: Option<DateRange>,
    min_duration: Option<i64>,
) -> Result<AutoSafeRunResult, String> {
    if status.mode != "auto_safe" {
        return Err("Mode must be 'auto_safe' to run auto assignment".to_string());
    }

    let effective_limit = clamp_i64(limit.unwrap_or(500), 1, 10_000);
    let session_ids =
        fetch_unassigned_session_ids(conn, effective_limit, date_range, min_duration)?;

    conn.execute(
        "INSERT INTO assignment_auto_runs (
            started_at,
            mode,
            min_confidence_auto,
            min_evidence_auto,
            sessions_scanned,
            sessions_suggested,
            sessions_assigned
         ) VALUES (datetime('now'), ?1, ?2, ?3, 0, 0, 0)",
        rusqlite::params![
            status.mode,
            status.min_confidence_auto,
            status.min_evidence_auto
        ],
    )
    .map_err(|e| e.to_string())?;
    let run_id = conn.last_insert_rowid();

    let mut result = AutoSafeRunResult {
        run_id: Some(run_id),
        scanned: 0,
        suggested: 0,
        assigned: 0,
        skipped_low_confidence: 0,
        skipped_ambiguous: 0,
        skipped_already_assigned: 0,
    };

    let run_work = (|| -> Result<(), String> {
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        for session_id in session_ids {
            result.scanned += 1;

            let session = tx
                .query_row(
                    "SELECT app_id, date, start_time, end_time, project_id
                     FROM sessions
                     WHERE id = ?1",
                    rusqlite::params![session_id],
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

            let Some((app_id, date, start_time, end_time, current_project_id)) = session else {
                continue;
            };

            if current_project_id.is_some() {
                result.skipped_already_assigned += 1;
                continue;
            }

            if check_manual_override(&tx, session_id).is_some() {
                result.skipped_already_assigned += 1;
                continue;
            }

            let Some(context) = build_session_context(&tx, session_id)? else {
                result.skipped_low_confidence += 1;
                continue;
            };
            let Some(suggestion) = compute_raw_suggestion(&tx, &context)? else {
                result.skipped_low_confidence += 1;
                continue;
            };

            if !meets_auto_safe_threshold(status, &suggestion) {
                let has_confidence_and_evidence = suggestion.confidence
                    >= status.min_confidence_auto
                    && suggestion.evidence_count >= status.min_evidence_auto;
                if has_confidence_and_evidence && suggestion.margin < AUTO_SAFE_MIN_MARGIN {
                    result.skipped_ambiguous += 1;
                } else {
                    result.skipped_low_confidence += 1;
                }
                continue;
            }

            result.suggested += 1;

            tx.execute(
                "INSERT INTO assignment_suggestions (
                    session_id, app_id, suggested_project_id, suggested_confidence,
                    suggested_evidence_count, model_version, created_at, status
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'), 'pending')",
                rusqlite::params![
                    session_id,
                    app_id,
                    suggestion.project_id,
                    suggestion.confidence,
                    suggestion.evidence_count,
                    "auto_safe_v1"
                ],
            )
            .map_err(|e| e.to_string())?;
            let suggestion_id = tx.last_insert_rowid();

            let updated_session = tx
                .execute(
                    "UPDATE sessions
                     SET project_id = ?1
                     WHERE id = ?2 AND project_id IS NULL",
                    rusqlite::params![suggestion.project_id, session_id],
                )
                .map_err(|e| e.to_string())?;

            if updated_session == 0 {
                result.skipped_already_assigned += 1;
                let _ = tx.execute(
                    "UPDATE assignment_suggestions SET status = 'expired' WHERE id = ?1",
                    rusqlite::params![suggestion_id],
                );
                continue;
            }

            tx.execute(
                "UPDATE file_activities
                 SET project_id = ?1
                 WHERE app_id = ?2
                   AND date = ?3
                   AND last_seen > ?4
                   AND first_seen < ?5",
                rusqlite::params![suggestion.project_id, app_id, date, start_time, end_time],
            )
            .map_err(|e| e.to_string())?;

            tx.execute(
                "INSERT INTO assignment_auto_run_items (
                    run_id, session_id, app_id, from_project_id, to_project_id,
                    suggestion_id, confidence, evidence_count, applied_at
                 ) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, datetime('now'))",
                rusqlite::params![
                    run_id,
                    session_id,
                    app_id,
                    suggestion.project_id,
                    suggestion_id,
                    suggestion.confidence,
                    suggestion.evidence_count
                ],
            )
            .map_err(|e| e.to_string())?;

            tx.execute(
                "UPDATE assignment_suggestions SET status = 'accepted' WHERE id = ?1",
                rusqlite::params![suggestion_id],
            )
            .map_err(|e| e.to_string())?;

            tx.execute(
                "INSERT INTO assignment_feedback (
                    suggestion_id, session_id, app_id, from_project_id, to_project_id, source, created_at
                 ) VALUES (?1, ?2, ?3, NULL, ?4, 'auto_accept', datetime('now'))",
                rusqlite::params![suggestion_id, session_id, app_id, suggestion.project_id],
            )
            .map_err(|e| e.to_string())?;

            result.assigned += 1;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })();

    if let Err(err) = run_work {
        conn.execute(
            "UPDATE assignment_auto_runs
             SET finished_at = datetime('now'),
                 sessions_scanned = ?2,
                 sessions_suggested = ?3,
                 sessions_assigned = ?4,
                 error = ?5
             WHERE id = ?1",
            rusqlite::params![
                run_id,
                result.scanned,
                result.suggested,
                result.assigned,
                err
            ],
        )
        .map_err(|e| e.to_string())?;
        return Err("Auto-safe assignment failed".to_string());
    }

    conn.execute(
        "UPDATE assignment_auto_runs
         SET finished_at = datetime('now'),
             sessions_scanned = ?2,
             sessions_suggested = ?3,
             sessions_assigned = ?4
         WHERE id = ?1",
        rusqlite::params![run_id, result.scanned, result.suggested, result.assigned],
    )
    .map_err(|e| e.to_string())?;

    Ok(result)
}

pub fn rollback_sync(conn: &mut rusqlite::Connection) -> Result<AutoSafeRollbackResult, String> {
    let run_id = conn
        .query_row(
            "SELECT id
             FROM assignment_auto_runs
             WHERE sessions_assigned > 0 AND rolled_back_at IS NULL
             ORDER BY id DESC
             LIMIT 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No rollbackable auto-safe run found".to_string())?;

    let mut reverted = 0_i64;
    let mut skipped = 0_i64;

    let trx = conn.transaction().map_err(|e| e.to_string())?;

    let item_rows: Vec<_> = {
        let mut item_stmt = trx
            .prepare(
                "SELECT session_id, app_id, from_project_id, to_project_id, suggestion_id
                 FROM assignment_auto_run_items
                 WHERE run_id = ?1
                 ORDER BY id DESC",
            )
            .map_err(|e| e.to_string())?;
        let res: Vec<_> = item_stmt
            .query_map(rusqlite::params![run_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        res
    };

    for row in item_rows {
        let (session_id, app_id, from_project_id, to_project_id, suggestion_id) = row;

        let updated = trx
            .execute(
                "UPDATE sessions
                 SET project_id = ?1
                 WHERE id = ?2 AND project_id = ?3",
                rusqlite::params![from_project_id, session_id, to_project_id],
            )
            .map_err(|e| e.to_string())?;

        if updated == 0 {
            skipped += 1;
            continue;
        }

        let session_time = trx
            .query_row(
                "SELECT date, start_time, end_time FROM sessions WHERE id = ?1",
                rusqlite::params![session_id],
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

        if let Some((date, start_time, end_time)) = session_time {
            trx.execute(
                "UPDATE file_activities
                 SET project_id = ?1
                 WHERE app_id = ?2
                   AND date = ?3
                   AND last_seen > ?4
                   AND first_seen < ?5",
                rusqlite::params![from_project_id, app_id, date, start_time, end_time],
            )
            .map_err(|e| e.to_string())?;
        }

        if let Some(suggestion_id) = suggestion_id {
            trx.execute(
                "UPDATE assignment_suggestions SET status = 'rejected' WHERE id = ?1",
                rusqlite::params![suggestion_id],
            )
            .map_err(|e| e.to_string())?;
        }

        trx.execute(
            "INSERT INTO assignment_feedback (
                suggestion_id, session_id, app_id, from_project_id, to_project_id, source, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, 'auto_reject', datetime('now'))",
            rusqlite::params![
                suggestion_id,
                session_id,
                app_id,
                to_project_id,
                from_project_id
            ],
        )
        .map_err(|e| e.to_string())?;
        increment_feedback_counter(&trx);

        reverted += 1;
    }

    trx.execute(
        "UPDATE assignment_auto_runs
         SET rolled_back_at = datetime('now'),
             rollback_reverted = ?2,
             rollback_skipped = ?3
         WHERE id = ?1",
        rusqlite::params![run_id, reverted, skipped],
    )
    .map_err(|e| e.to_string())?;

    trx.commit().map_err(|e| e.to_string())?;

    Ok(AutoSafeRollbackResult {
        run_id,
        reverted,
        skipped,
    })
}

pub fn deterministic_sync(
    conn: &mut rusqlite::Connection,
    min_history: Option<i64>,
) -> Result<DeterministicResult, String> {
    let min_sessions = min_history.unwrap_or(5).max(1);

    let app_rules: Vec<(i64, i64)> = {
        let mut stmt = conn
            .prepare(
                "SELECT app_id, project_id
                 FROM (
                     SELECT app_id, project_id, COUNT(*) as cnt,
                            COUNT(DISTINCT project_id) as distinct_projects
                     FROM sessions
                     WHERE project_id IS NOT NULL AND duration_seconds > 10
                     GROUP BY app_id
                     HAVING distinct_projects = 1 AND cnt >= ?1
                 )",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![min_sessions], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read deterministic app rule row: {}", e))?
    };

    let apps_with_rules = app_rules.len() as i64;
    let mut sessions_assigned: i64 = 0;
    let mut sessions_skipped: i64 = 0;

    if app_rules.is_empty() {
        return Ok(DeterministicResult {
            apps_with_rules: 0,
            sessions_assigned: 0,
            sessions_skipped: 0,
        });
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (app_id, project_id) in &app_rules {
        let project_valid: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0
                 FROM projects
                 WHERE id = ?1
                   AND excluded_at IS NULL
                   AND frozen_at IS NULL",
                rusqlite::params![project_id],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !project_valid {
            continue;
        }

        let session_ids: Vec<(i64, String, String, String)> = {
            let mut stmt = tx
                .prepare(
                    "SELECT id, date, start_time, end_time
                     FROM sessions
                     WHERE app_id = ?1 AND project_id IS NULL AND duration_seconds > 10",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(rusqlite::params![app_id], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Failed to read deterministic session row: {}", e))?
        };

        for (session_id, date, start_time, end_time) in &session_ids {
            let updated = tx
                .execute(
                    "UPDATE sessions SET project_id = ?1 WHERE id = ?2 AND project_id IS NULL",
                    rusqlite::params![project_id, session_id],
                )
                .map_err(|e| e.to_string())?;

            if updated == 0 {
                sessions_skipped += 1;
                continue;
            }

            tx.execute(
                "UPDATE file_activities
                 SET project_id = ?1
                 WHERE app_id = ?2
                   AND date = ?3
                   AND last_seen > ?4
                   AND first_seen < ?5
                   AND project_id IS NULL",
                rusqlite::params![project_id, app_id, date, start_time, end_time],
            )
            .map_err(|e| e.to_string())?;

            tx.execute(
                "INSERT INTO assignment_feedback (
                    suggestion_id, session_id, app_id, from_project_id, to_project_id, source, created_at
                 ) VALUES (NULL, ?1, ?2, NULL, ?3, 'deterministic_rule', datetime('now'))",
                rusqlite::params![session_id, app_id, project_id],
            )
            .map_err(|e| e.to_string())?;

            sessions_assigned += 1;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    if sessions_assigned > 0 {
        log::info!(
            "Deterministic assignment: {} apps with rules, {} sessions assigned, {} skipped",
            apps_with_rules,
            sessions_assigned,
            sessions_skipped
        );
    }

    Ok(DeterministicResult {
        apps_with_rules,
        sessions_assigned,
        sessions_skipped,
    })
}
