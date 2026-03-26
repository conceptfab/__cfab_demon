use super::types::{ApplicationRow, ManualSession, Project, SessionRow, Tombstone};
use crate::db;
use serde::Serialize;

#[derive(Serialize)]
pub struct TableHashes {
    pub projects: String,
    pub applications: String,
    pub sessions: String,
    pub manual_sessions: String,
}

#[derive(Serialize)]
pub struct DeltaData {
    pub projects: Vec<Project>,
    pub applications: Vec<ApplicationRow>,
    pub sessions: Vec<SessionRow>,
    pub manual_sessions: Vec<ManualSession>,
    pub tombstones: Vec<Tombstone>,
}

#[derive(Serialize)]
pub struct DeltaArchive {
    pub version: String,
    pub exported_at: String,
    pub machine_id: String,
    pub since: String,
    pub is_full: bool,
    pub table_hashes: TableHashes,
    pub data: DeltaData,
}

#[tauri::command]
pub fn build_delta_archive(
    app: tauri::AppHandle,
    since: String,
) -> Result<(DeltaArchive, String), String> {
    let conn = db::get_connection(&app)?;
    let machine_id = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string());
    
    // 1. Calculate deterministic hashes for each table
    // For projects
    let projects_hash: String = conn
        .query_row(
            "SELECT COALESCE(hex(sha256(group_concat(id || '|' || updated_at, ';'))), '') 
             FROM (SELECT id, updated_at FROM projects ORDER BY id)",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "".to_string());

    // For applications
    let apps_hash: String = conn
        .query_row(
            "SELECT COALESCE(hex(sha256(group_concat(id || '|' || updated_at, ';'))), '') 
             FROM (SELECT id, updated_at FROM applications ORDER BY id)",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "".to_string());

    // For sessions
    let sessions_hash: String = conn
        .query_row(
            "SELECT COALESCE(hex(sha256(group_concat(id || '|' || updated_at, ';'))), '') 
             FROM (SELECT id, updated_at FROM sessions ORDER BY id)",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "".to_string());

    // For manual_sessions
    let manual_sessions_hash: String = conn
        .query_row(
            "SELECT COALESCE(hex(sha256(group_concat(id || '|' || updated_at, ';'))), '') 
             FROM (SELECT id, updated_at FROM manual_sessions ORDER BY id)",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "".to_string());

    let table_hashes = TableHashes {
        projects: projects_hash.to_lowercase(),
        applications: apps_hash.to_lowercase(),
        sessions: sessions_hash.to_lowercase(),
        manual_sessions: manual_sessions_hash.to_lowercase(),
    };

    // 2. Fetch delta data (updated_at > since)
    
    // Projects
    let mut stmt = conn
        .prepare("SELECT id, name, color, hourly_rate, created_at, excluded_at, assigned_folder_path, is_imported, frozen_at, updated_at 
                  FROM projects WHERE updated_at > ?1")
        .map_err(|e| e.to_string())?;
    
    let projects: Vec<Project> = stmt
        .query_map([since.as_str()], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                hourly_rate: row.get(3)?,
                created_at: row.get(4)?,
                excluded_at: row.get(5)?,
                assigned_folder_path: row.get(6)?,
                is_imported: row.get(7)?,
                frozen_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Applications
    let mut stmt = conn
        .prepare("SELECT id, executable_name, display_name, project_id, is_imported 
                  FROM applications WHERE updated_at > ?1")
        .map_err(|e| e.to_string())?;
    
    let applications: Vec<ApplicationRow> = stmt
        .query_map([since.as_str()], |row| {
            Ok(ApplicationRow {
                id: row.get(0)?,
                executable_name: row.get(1)?,
                display_name: row.get(2)?,
                project_id: row.get(3)?,
                is_imported: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Sessions
    let mut stmt = conn
        .prepare("SELECT id, app_id, project_id, start_time, end_time, duration_seconds, date
                  , COALESCE(rate_multiplier, 1.0), comment, is_hidden
                  FROM sessions WHERE updated_at > ?1")
        .map_err(|e| e.to_string())?;
    
    let sessions: Vec<SessionRow> = stmt
        .query_map([since.as_str()], |row| {
            Ok(SessionRow {
                id: row.get(0)?,
                app_id: row.get(1)?,
                project_id: row.get(2)?,
                start_time: row.get(3)?,
                end_time: row.get(4)?,
                duration_seconds: row.get(5)?,
                date: row.get(6)?,
                rate_multiplier: row.get(7)?,
                comment: row.get(8)?,
                is_hidden: row.get::<_, i64>(9)? != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Manual Sessions
    let mut stmt = conn
        .prepare("SELECT id, title, session_type, project_id, app_id, start_time, end_time,
                         duration_seconds, date, created_at, updated_at
                  FROM manual_sessions WHERE updated_at > ?1")
        .map_err(|e| e.to_string())?;
    
    let manual_sessions: Vec<ManualSession> = stmt
        .query_map([since.as_str()], |row| {
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
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Tombstones
    let mut stmt = conn
        .prepare("SELECT table_name, record_id, record_uuid, deleted_at, sync_key
                  FROM tombstones WHERE deleted_at > ?1")
        .map_err(|e| e.to_string())?;
    
    let tombstones: Vec<Tombstone> = stmt
        .query_map([since.as_str()], |row| {
            Ok(Tombstone {
                table_name: row.get(0)?,
                record_id: row.get(1)?,
                record_uuid: row.get(2)?,
                deleted_at: row.get(3)?,
                sync_key: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let default_name = format!(
        "timeflow-delta-export-{}.json",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );

    let archive = DeltaArchive {
        version: "2.0-delta".to_string(),
        exported_at: chrono::Local::now().to_rfc3339(),
        machine_id,
        since: since,
        is_full: false,
        table_hashes,
        data: DeltaData {
            projects,
            applications,
            sessions,
            manual_sessions,
            tombstones,
        },
    };

    Ok((archive, default_name))
}
