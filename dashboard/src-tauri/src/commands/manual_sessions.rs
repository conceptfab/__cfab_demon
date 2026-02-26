use tauri::AppHandle;

use super::projects::project_id_is_active;
use super::types::{
    CreateManualSessionInput, ManualSession, ManualSessionFilters, ManualSessionWithProject,
};
use crate::db;

#[tauri::command]
pub fn create_manual_session(
    app: AppHandle,
    input: CreateManualSessionInput,
) -> Result<ManualSession, String> {
    let conn = db::get_connection(&app)?;
    if !project_id_is_active(&conn, input.project_id)? {
        return Err("Cannot assign manual session to an excluded or missing project".to_string());
    }

    // Parse start_time to compute date and duration
    let start_dt = chrono::NaiveDateTime::parse_from_str(&input.start_time, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(&input.start_time, "%Y-%m-%dT%H:%M"))
        .map_err(|e| format!("Invalid start_time: {}", e))?;
    let end_dt = chrono::NaiveDateTime::parse_from_str(&input.end_time, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(&input.end_time, "%Y-%m-%dT%H:%M"))
        .map_err(|e| format!("Invalid end_time: {}", e))?;

    if end_dt <= start_dt {
        return Err("end_time must be after start_time".to_string());
    }

    let duration_seconds = (end_dt - start_dt).num_seconds();
    let date = start_dt.format("%Y-%m-%d").to_string();

    conn.execute(
        "INSERT INTO manual_sessions (title, session_type, project_id, app_id, start_time, end_time, duration_seconds, date)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            input.title,
            input.session_type,
            input.project_id,
            input.app_id,
            input.start_time,
            input.end_time,
            duration_seconds,
            date,
        ],
    )
    .map_err(|e| format!("Failed to create manual session: {}", e))?;

    let id = conn.last_insert_rowid();

    conn.query_row(
        "SELECT id, title, session_type, project_id, app_id, start_time, end_time, duration_seconds, date, created_at, updated_at
         FROM manual_sessions WHERE id = ?1",
        [id],
        |row| {
            Ok(ManualSession {
                id: row.get(0)?,
                title: row.get(1)?,
                session_type: row.get(2)?,
                project_id: row.get(3)?,
                app_id: row.get(4)?,
                start_time: row.get(5)?,
                end_time: row.get(6)?,
                duration_seconds: row.get(7)?,
                date: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        },
    )
    .map_err(|e| format!("Failed to read created session: {}", e))
}

#[tauri::command]
pub fn get_manual_sessions(
    app: AppHandle,
    filters: ManualSessionFilters,
) -> Result<Vec<ManualSessionWithProject>, String> {
    let conn = db::get_connection(&app)?;

    let mut sql = String::from(
        "SELECT ms.id, ms.title, ms.session_type, ms.project_id, ms.app_id, p.name, p.color,
                ms.start_time, ms.end_time, ms.duration_seconds, ms.date
         FROM manual_sessions ms
         JOIN projects p ON p.id = ms.project_id
         WHERE 1=1",
    );
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref dr) = filters.date_range {
        sql.push_str(" AND ms.date >= ?");
        params.push(Box::new(dr.start.clone()));
        sql.push_str(" AND ms.date <= ?");
        params.push(Box::new(dr.end.clone()));
    }

    if let Some(pid) = filters.project_id {
        sql.push_str(" AND ms.project_id = ?");
        params.push(Box::new(pid));
    }

    sql.push_str(" ORDER BY ms.start_time ASC");

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok(ManualSessionWithProject {
                id: row.get(0)?,
                title: row.get(1)?,
                session_type: row.get(2)?,
                project_id: row.get(3)?,
                app_id: row.get(4)?,
                project_name: row.get(5)?,
                project_color: row.get(6)?,
                start_time: row.get(7)?,
                end_time: row.get(8)?,
                duration_seconds: row.get(9)?,
                date: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

#[tauri::command]
pub fn update_manual_session(
    app: AppHandle,
    id: i64,
    input: CreateManualSessionInput,
) -> Result<(), String> {
    let conn = db::get_connection(&app)?;
    if !project_id_is_active(&conn, input.project_id)? {
        return Err("Cannot assign manual session to an excluded or missing project".to_string());
    }

    let start_dt = chrono::NaiveDateTime::parse_from_str(&input.start_time, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(&input.start_time, "%Y-%m-%dT%H:%M"))
        .map_err(|e| format!("Invalid start_time: {}", e))?;
    let end_dt = chrono::NaiveDateTime::parse_from_str(&input.end_time, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(&input.end_time, "%Y-%m-%dT%H:%M"))
        .map_err(|e| format!("Invalid end_time: {}", e))?;

    if end_dt <= start_dt {
        return Err("end_time must be after start_time".to_string());
    }

    let duration_seconds = (end_dt - start_dt).num_seconds();
    let date = start_dt.format("%Y-%m-%d").to_string();

    conn.execute(
        "UPDATE manual_sessions SET title=?1, session_type=?2, project_id=?3, app_id=?4, start_time=?5, end_time=?6, duration_seconds=?7, date=?8 WHERE id=?9",
        rusqlite::params![input.title, input.session_type, input.project_id, input.app_id, input.start_time, input.end_time, duration_seconds, date, id],
    )
    .map_err(|e| format!("Failed to update manual session: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn delete_manual_session(app: AppHandle, id: i64) -> Result<(), String> {
    let conn = db::get_connection(&app)?;
    conn.execute("DELETE FROM manual_sessions WHERE id = ?1", [id])
        .map_err(|e| format!("Failed to delete manual session: {}", e))?;
    Ok(())
}
