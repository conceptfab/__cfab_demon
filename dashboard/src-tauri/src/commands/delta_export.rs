use super::helpers::compute_table_hash;
use super::types::{ApplicationRow, ManualSession, Project, SessionRow, Tombstone};
use crate::db;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TableHashes {
    pub projects: String,
    pub applications: String,
    pub sessions: String,
    pub manual_sessions: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DeltaData {
    pub projects: Vec<Project>,
    pub applications: Vec<ApplicationRow>,
    pub sessions: Vec<SessionRow>,
    pub manual_sessions: Vec<ManualSession>,
    pub tombstones: Vec<Tombstone>,
}

#[derive(Serialize, Deserialize, Clone)]
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
    let machine_id = super::helpers::get_machine_id();

    // Normalize ISO 8601 (with 'T' separator) to SQLite datetime format (with space)
    // so that lexicographic comparison in WHERE clauses works correctly.
    let since_normalized = normalize_datetime_for_sqlite(&since);
    let since = since_normalized;

    // 1. Calculate deterministic hashes for each table
    let table_hashes = TableHashes {
        projects: compute_table_hash(&conn, "projects"),
        applications: compute_table_hash(&conn, "applications"),
        sessions: compute_table_hash(&conn, "sessions"),
        manual_sessions: compute_table_hash(&conn, "manual_sessions"),
    };

    // 2. Fetch delta data
    // Projects & Applications are ALWAYS exported in full (small reference tables)
    // so the importer can resolve remote IDs → local IDs for sessions.

    // Projects (all — needed as lookup table for project_id resolution)
    let mut stmt = conn
        .prepare("SELECT id, name, color, hourly_rate, created_at, excluded_at, assigned_folder_path, is_imported, frozen_at, updated_at
                  FROM projects")
        .map_err(|e| e.to_string())?;

    let projects: Vec<Project> = stmt
        .query_map([], |row| {
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

    // Applications (all — needed as lookup table for app_id resolution)
    let mut stmt = conn
        .prepare("SELECT id, executable_name, display_name, project_id, is_imported, updated_at
                  FROM applications")
        .map_err(|e| e.to_string())?;

    let applications: Vec<ApplicationRow> = stmt
        .query_map([], |row| {
            Ok(ApplicationRow {
                id: row.get(0)?,
                executable_name: row.get(1)?,
                display_name: row.get(2)?,
                project_id: row.get(3)?,
                is_imported: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Sessions
    let mut stmt = conn
        .prepare("SELECT id, app_id, project_id, start_time, end_time, duration_seconds, date
                  , COALESCE(rate_multiplier, 1.0), comment, is_hidden, updated_at
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
                updated_at: row.get(10)?,
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

    log::info!(
        "Delta export (since={}): projects={}, apps={}, sessions={}, manual={}, tombstones={}",
        since, projects.len(), applications.len(), sessions.len(), manual_sessions.len(), tombstones.len()
    );

    let default_name = format!(
        "timeflow-delta-export-{}.json",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );

    let archive = DeltaArchive {
        version: "2.0-delta".to_string(),
        exported_at: chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
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

/// Convert ISO 8601 timestamps (e.g. "2026-03-29T10:00:00Z" or "2026-03-29T10:00:00+02:00")
/// to SQLite datetime format in UTC ("2026-03-29 08:00:00") for correct lexicographic comparison.
fn normalize_datetime_for_sqlite(s: &str) -> String {
    // Fast path: already in "YYYY-MM-DD HH:MM:SS" format (19 chars, no T, no Z)
    if s.len() == 19 && !s.contains('T') && !s.ends_with('Z') {
        return s.to_string();
    }
    // Try to parse as full ISO 8601 with timezone and convert to UTC
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return dt
            .with_timezone(&chrono::Utc)
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
    }
    // Fallback: simple formatting for already-plain timestamps
    let s = s.replace('T', " ");
    let s = s.trim_end_matches('Z');
    if let Some(dot_pos) = s.find('.') {
        s[..dot_pos].to_string()
    } else if s.len() > 19 {
        s[..19].to_string()
    } else {
        s.to_string()
    }
}
