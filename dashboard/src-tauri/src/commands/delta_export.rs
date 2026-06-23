use super::helpers::build_table_hashes;
use super::types::{ApplicationRow, AssignmentAutoRunRow, AssignmentFeedbackRow, ClientRow, ManualSession, Project, SessionRow, Tombstone};
use crate::db;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct TableHashes {
    #[serde(default)]
    pub projects: String,
    #[serde(default)]
    pub applications: String,
    #[serde(default)]
    pub sessions: String,
    #[serde(default)]
    pub manual_sessions: String,
    #[serde(default)]
    pub assignment_feedback: String,
    #[serde(default)]
    pub assignment_auto_runs: String,
    #[serde(default)]
    pub clients: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DeltaData {
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default)]
    pub clients: Vec<ClientRow>,
    #[serde(default)]
    pub applications: Vec<ApplicationRow>,
    #[serde(default)]
    pub sessions: Vec<SessionRow>,
    #[serde(default)]
    pub manual_sessions: Vec<ManualSession>,
    #[serde(default)]
    pub tombstones: Vec<Tombstone>,
    #[serde(default)]
    pub assignment_feedback: Vec<AssignmentFeedbackRow>,
    #[serde(default)]
    pub assignment_auto_runs: Vec<AssignmentAutoRunRow>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DeltaArchive {
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub exported_at: String,
    #[serde(default, alias = "device_id")]
    pub machine_id: String,
    #[serde(default)]
    pub since: String,
    #[serde(default)]
    pub is_full: bool,
    #[serde(default)]
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
    let table_hashes = build_table_hashes(&conn);

    // 2. Fetch delta data
    // Projects & Applications are ALWAYS exported in full (small reference tables)
    // so the importer can resolve remote IDs → local IDs for sessions.

    // Projects (all — needed as lookup table for project_id resolution)
    // client_name + status (m24) ride along so the client→project assignment and
    // project status converge through online sync, mirroring the LAN export.
    let mut stmt = conn
        .prepare(timeflow_shared::sync::columns::PROJECT_SELECT)
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
                merged_into: row.get(9)?,
                merged_at: row.get(10)?,
                updated_at: row.get(11)?,
                client_name: row.get(12)?,
                status: row.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Clients (m24 entity — always full, tiny reference table). Identified by name.
    let mut stmt = conn
        .prepare("SELECT name, contact, address, tax_id, currency, default_hourly_rate, color, archived_at, created_at, updated_at
                  FROM clients")
        .map_err(|e| e.to_string())?;

    let clients: Vec<ClientRow> = stmt
        .query_map([], |row| {
            Ok(ClientRow {
                name: row.get(0)?,
                contact: row.get(1)?,
                address: row.get(2)?,
                tax_id: row.get(3)?,
                currency: row.get(4)?,
                default_hourly_rate: row.get(5)?,
                color: row.get(6)?,
                archived_at: row.get(7)?,
                created_at: row.get(8)?,
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
                  , COALESCE(rate_multiplier, 1.0), comment, is_hidden, updated_at, project_name
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
                project_name: row.get(11)?,
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
                id: None,
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

    // Assignment Feedback (delta — only rows created after `since`)
    let mut stmt = conn
        .prepare("SELECT id, session_id, app_id, from_project_id, to_project_id, source, COALESCE(weight, 1.0), created_at
                  FROM assignment_feedback WHERE created_at > ?1")
        .map_err(|e| e.to_string())?;

    let assignment_feedback: Vec<AssignmentFeedbackRow> = stmt
        .query_map([since.as_str()], |row| {
            Ok(AssignmentFeedbackRow {
                id: row.get(0)?,
                session_id: row.get(1)?,
                app_id: row.get(2)?,
                from_project_id: row.get(3)?,
                to_project_id: row.get(4)?,
                source: row.get(5)?,
                weight: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Assignment Auto Runs (delta — only rows started after `since`)
    let mut stmt = conn
        .prepare("SELECT id, started_at, finished_at, sessions_scanned, sessions_assigned, sessions_skipped, rolled_back_at
                  FROM assignment_auto_runs WHERE started_at > ?1")
        .map_err(|e| e.to_string())?;

    let assignment_auto_runs: Vec<AssignmentAutoRunRow> = stmt
        .query_map([since.as_str()], |row| {
            Ok(AssignmentAutoRunRow {
                id: row.get(0)?,
                started_at: row.get(1)?,
                finished_at: row.get(2)?,
                sessions_scanned: row.get(3)?,
                sessions_assigned: row.get(4)?,
                sessions_skipped: row.get(5)?,
                rolled_back_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    log::info!(
        "Delta export (since={}): projects={}, clients={}, apps={}, sessions={}, manual={}, tombstones={}, feedback={}, auto_runs={}",
        since, projects.len(), clients.len(), applications.len(), sessions.len(), manual_sessions.len(), tombstones.len(),
        assignment_feedback.len(), assignment_auto_runs.len()
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
            clients,
            applications,
            sessions,
            manual_sessions,
            tombstones,
            assignment_feedback,
            assignment_auto_runs,
        },
    };

    Ok((archive, default_name))
}

/// Convert ISO 8601 timestamps (e.g. "2026-03-29T10:00:00Z" or "2026-03-29T10:00:00+02:00")
/// to SQLite datetime format in UTC ("2026-03-29 08:00:00") for correct lexicographic comparison.
fn normalize_datetime_for_sqlite(s: &str) -> String {
    timeflow_shared::sync::timestamp::normalize_datetime_for_sqlite(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    // ── Helper: minimal in-memory DB for delta-export tests ──

    fn create_sessions_db() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "PRAGMA foreign_keys=OFF;
             CREATE TABLE sessions (
                 id INTEGER PRIMARY KEY,
                 app_id INTEGER,
                 project_id INTEGER NOT NULL DEFAULT 1,
                 start_time TEXT,
                 end_time TEXT,
                 duration_seconds REAL,
                 date TEXT,
                 rate_multiplier REAL DEFAULT 1.0,
                 comment TEXT,
                 is_hidden INTEGER DEFAULT 0,
                 updated_at TEXT NOT NULL,
                 project_name TEXT
             );",
        )
        .expect("create sessions table");
        conn
    }

    // Test 1: normalize_datetime_for_sqlite — ISO 8601 UTC (Z suffix) → SQLite format.
    // Verifies the private fn converts correctly: T→space, strip Z, no subseconds.
    #[test]
    fn normalize_utc_iso_to_sqlite_format() {
        let result = normalize_datetime_for_sqlite("2026-03-29T10:00:00Z");
        assert_eq!(result, "2026-03-29 10:00:00");
    }

    // Test 2: normalize_datetime_for_sqlite — already-SQLite format is a fast-path identity.
    // If the string is exactly 19 chars, has no T and no Z, it returns unchanged.
    #[test]
    fn normalize_sqlite_format_is_identity() {
        let already_sqlite = "2026-03-29 10:00:00";
        let result = normalize_datetime_for_sqlite(already_sqlite);
        assert_eq!(result, already_sqlite);
    }

    // Test 3: delta-export sessions query uses `updated_at > ?` cutoff correctly.
    // Insert two sessions straddling the cutoff, run the same SQL used by build_delta_archive,
    // and assert only the post-cutoff session appears in the result.
    #[test]
    fn sessions_delta_query_filters_by_cutoff() {
        let conn = create_sessions_db();
        let cutoff = "2026-01-15 12:00:00";

        // Session BEFORE cutoff — should NOT appear in delta
        conn.execute(
            "INSERT INTO sessions (id, project_id, start_time, end_time, duration_seconds, date, updated_at)
             VALUES (1, 1, '2026-01-10 09:00:00', '2026-01-10 10:00:00', 3600.0, '2026-01-10', '2026-01-10 10:00:00')",
            [],
        ).expect("insert pre-cutoff session");

        // Session AFTER cutoff — should appear in delta
        conn.execute(
            "INSERT INTO sessions (id, project_id, start_time, end_time, duration_seconds, date, updated_at)
             VALUES (2, 1, '2026-01-20 09:00:00', '2026-01-20 10:00:00', 3600.0, '2026-01-20', '2026-01-20 10:00:00')",
            [],
        ).expect("insert post-cutoff session");

        // Same SQL as build_delta_archive
        let mut stmt = conn
            .prepare(
                "SELECT id, app_id, project_id, start_time, end_time, duration_seconds, date
                 , COALESCE(rate_multiplier, 1.0), comment, is_hidden, updated_at, project_name
                 FROM sessions WHERE updated_at > ?1",
            )
            .expect("prepare");

        let ids: Vec<i64> = stmt
            .query_map([cutoff], |row| row.get::<_, i64>(0))
            .expect("query")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect");

        // Only the post-cutoff session (id=2) should appear
        assert_eq!(ids, vec![2i64], "only post-cutoff session should be in delta");
    }

    // Test 4: normalize_datetime_for_sqlite — offset ±HH:MM is converted to UTC.
    // "2026-03-29T10:00:00+02:00" → UTC "2026-03-29 08:00:00"
    #[test]
    fn normalize_tz_offset_to_utc() {
        let result = normalize_datetime_for_sqlite("2026-03-29T10:00:00+02:00");
        assert_eq!(result, "2026-03-29 08:00:00");
    }
}
