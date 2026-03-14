use std::collections::HashSet;

use rusqlite::{OptionalExtension, Transaction};
use tauri::AppHandle;

use super::super::helpers::run_db_blocking;
use super::manual_overrides::upsert_manual_session_override;

fn sanitize_session_ids(session_ids: Vec<i64>) -> Vec<i64> {
    let mut seen = HashSet::new();
    session_ids
        .into_iter()
        .filter(|id| *id > 0 && seen.insert(*id))
        .collect()
}

fn normalize_multiplier(multiplier: Option<f64>) -> Result<f64, String> {
    match multiplier {
        None => Ok(1.0),
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
                Ok(1.0)
            } else {
                Ok(v)
            }
        }
    }
}

fn normalize_comment(comment: Option<String>) -> Option<String> {
    comment.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn assign_session_to_project_tx(
    tx: &Transaction<'_>,
    session_id: i64,
    project_id: Option<i64>,
    source: Option<&str>,
) -> Result<(), String> {
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

    let _updated_session = tx
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

    if updated == 0 {
        log::debug!("Assignment updated the session row without overlapping file activity.");
    }

    upsert_manual_session_override(tx, session_id, project_id).map_err(|e| {
        format!(
            "Failed to persist manual override for session {}: {}",
            session_id, e
        )
    })?;

    tx.execute(
        "INSERT INTO assignment_feedback (session_id, app_id, from_project_id, to_project_id, source, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
        rusqlite::params![
            session_id,
            app_id,
            old_project_id,
            project_id,
            source.unwrap_or("manual_session_assign")
        ],
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

    Ok(())
}

fn update_session_rate_multiplier_tx(
    tx: &Transaction<'_>,
    session_id: i64,
    multiplier: f64,
) -> Result<(), String> {
    let comment_for_session: Option<Option<String>> = tx
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

    if multiplier > 1.000_001 {
        let has_comment = existing_comment
            .as_deref()
            .map(|c| !c.trim().is_empty())
            .unwrap_or(false);
        if !has_comment {
            return Err("Boost requires a non-empty session comment".to_string());
        }
    }

    let updated = tx
        .execute(
            "UPDATE sessions SET rate_multiplier = ?1 WHERE id = ?2",
            rusqlite::params![multiplier, session_id],
        )
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        return Err("Session not found".to_string());
    }
    Ok(())
}

fn delete_session_tx(tx: &Transaction<'_>, session_id: i64) -> Result<(), String> {
    tx.execute(
        "UPDATE sessions SET is_hidden = 1 WHERE id = ?1",
        [session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn update_session_comment_tx(
    tx: &Transaction<'_>,
    session_id: i64,
    comment: &Option<String>,
) -> Result<(), String> {
    let updated = tx
        .execute(
            "UPDATE sessions SET comment = ?1 WHERE id = ?2",
            rusqlite::params![comment, session_id],
        )
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        return Err("Session not found".to_string());
    }
    Ok(())
}

pub async fn assign_session_to_project(
    app: AppHandle,
    session_id: i64,
    project_id: Option<i64>,
    source: Option<String>,
) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        assign_session_to_project_tx(&tx, session_id, project_id, source.as_deref())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

pub async fn assign_sessions_to_project(
    app: AppHandle,
    session_ids: Vec<i64>,
    project_id: Option<i64>,
    source: Option<String>,
) -> Result<(), String> {
    let session_ids = sanitize_session_ids(session_ids);
    if session_ids.is_empty() {
        return Ok(());
    }

    run_db_blocking(app, move |conn| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for session_id in session_ids {
            assign_session_to_project_tx(&tx, session_id, project_id, source.as_deref())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

pub async fn update_session_rate_multiplier(
    app: AppHandle,
    session_id: i64,
    multiplier: Option<f64>,
) -> Result<(), String> {
    let normalized = normalize_multiplier(multiplier)?;

    run_db_blocking(app, move |conn| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        update_session_rate_multiplier_tx(&tx, session_id, normalized)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

pub async fn update_session_rate_multipliers(
    app: AppHandle,
    session_ids: Vec<i64>,
    multiplier: Option<f64>,
) -> Result<(), String> {
    let session_ids = sanitize_session_ids(session_ids);
    if session_ids.is_empty() {
        return Ok(());
    }

    let normalized = normalize_multiplier(multiplier)?;

    run_db_blocking(app, move |conn| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for session_id in session_ids {
            update_session_rate_multiplier_tx(&tx, session_id, normalized)?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

pub async fn delete_session(app: AppHandle, session_id: i64) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        delete_session_tx(&tx, session_id)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

pub async fn delete_sessions(app: AppHandle, session_ids: Vec<i64>) -> Result<(), String> {
    let session_ids = sanitize_session_ids(session_ids);
    if session_ids.is_empty() {
        return Ok(());
    }

    run_db_blocking(app, move |conn| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for session_id in session_ids {
            delete_session_tx(&tx, session_id)?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

pub async fn update_session_comment(
    app: AppHandle,
    session_id: i64,
    comment: Option<String>,
) -> Result<(), String> {
    let normalized = normalize_comment(comment);
    run_db_blocking(app, move |conn| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        update_session_comment_tx(&tx, session_id, &normalized)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

pub async fn update_session_comments(
    app: AppHandle,
    session_ids: Vec<i64>,
    comment: Option<String>,
) -> Result<(), String> {
    let session_ids = sanitize_session_ids(session_ids);
    if session_ids.is_empty() {
        return Ok(());
    }

    let normalized = normalize_comment(comment);
    run_db_blocking(app, move |conn| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for session_id in session_ids {
            update_session_comment_tx(&tx, session_id, &normalized)?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}
