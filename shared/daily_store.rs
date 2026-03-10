use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const STORE_FILE_NAME: &str = "timeflow_daily_store.db";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredDailyData {
    pub date: String,
    #[serde(default)]
    pub generated_at: String,
    #[serde(default)]
    pub apps: BTreeMap<String, StoredAppDailyData>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredAppDailyData {
    pub display_name: String,
    pub total_seconds: u64,
    #[serde(default)]
    pub sessions: Vec<StoredSession>,
    #[serde(default)]
    pub files: Vec<StoredFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredSession {
    pub start: String,
    pub end: String,
    pub duration_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredFileEntry {
    pub name: String,
    pub total_seconds: u64,
    pub first_seen: String,
    pub last_seen: String,
    #[serde(default)]
    pub window_title: String,
    #[serde(default)]
    pub detected_path: Option<String>,
    #[serde(default)]
    pub title_history: Vec<String>,
    #[serde(default)]
    pub activity_type: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DaySignature {
    pub updated_unix_ms: u64,
    pub revision: u64,
}

pub fn store_db_path(base_dir: &Path) -> PathBuf {
    base_dir.join(STORE_FILE_NAME)
}

pub fn open_store(base_dir: &Path) -> Result<Connection, String> {
    fs::create_dir_all(base_dir).map_err(|e| {
        format!(
            "Failed to create TimeFlow base directory '{}': {}",
            base_dir.display(),
            e
        )
    })?;

    let path = store_db_path(base_dir);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open daily store '{}': {}", path.display(), e))?;
    conn.busy_timeout(std::time::Duration::from_millis(2000))
        .map_err(|e| format!("Failed to configure daily store busy_timeout: {}", e))?;
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;",
    )
    .map_err(|e| format!("Failed to configure daily store pragmas: {}", e))?;
    ensure_schema(&conn)?;
    Ok(conn)
}

pub fn ensure_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS daily_snapshots (
             date TEXT PRIMARY KEY,
             generated_at TEXT NOT NULL DEFAULT '',
             updated_unix_ms INTEGER NOT NULL DEFAULT 0,
             revision INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS daily_apps (
             date TEXT NOT NULL,
             exe_name TEXT NOT NULL,
             display_name TEXT NOT NULL,
             total_seconds INTEGER NOT NULL DEFAULT 0,
             PRIMARY KEY (date, exe_name),
             FOREIGN KEY (date) REFERENCES daily_snapshots(date) ON DELETE CASCADE
         );
         CREATE TABLE IF NOT EXISTS daily_sessions (
             date TEXT NOT NULL,
             exe_name TEXT NOT NULL,
             session_index INTEGER NOT NULL,
             start_time TEXT NOT NULL,
             end_time TEXT NOT NULL,
             duration_seconds INTEGER NOT NULL DEFAULT 0,
             PRIMARY KEY (date, exe_name, session_index),
             FOREIGN KEY (date, exe_name) REFERENCES daily_apps(date, exe_name) ON DELETE CASCADE
         );
         CREATE TABLE IF NOT EXISTS daily_files (
             date TEXT NOT NULL,
             exe_name TEXT NOT NULL,
             file_name TEXT NOT NULL,
             ordinal INTEGER NOT NULL,
             total_seconds INTEGER NOT NULL DEFAULT 0,
             first_seen TEXT NOT NULL,
             last_seen TEXT NOT NULL,
             window_title TEXT NOT NULL DEFAULT '',
             detected_path TEXT,
             title_history_json TEXT NOT NULL DEFAULT '[]',
             activity_type TEXT,
             PRIMARY KEY (date, exe_name, file_name),
             FOREIGN KEY (date, exe_name) REFERENCES daily_apps(date, exe_name) ON DELETE CASCADE
         );
         DROP INDEX IF EXISTS idx_daily_snapshots_date;
         CREATE INDEX IF NOT EXISTS idx_daily_sessions_date_exe
             ON daily_sessions(date, exe_name, session_index);
         CREATE INDEX IF NOT EXISTS idx_daily_files_date_exe
             ON daily_files(date, exe_name, ordinal);",
    )
    .map_err(|e| format!("Failed to initialize daily store schema: {}", e))
}

pub fn replace_day_snapshot(
    conn: &mut Connection,
    snapshot: &StoredDailyData,
) -> Result<DaySignature, String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start daily store transaction: {}", e))?;
    let previous_revision = tx
        .query_row(
            "SELECT revision FROM daily_snapshots WHERE date = ?1",
            [snapshot.date.as_str()],
            |row| row.get::<_, u64>(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read previous daily store revision: {}", e))?
        .unwrap_or(0);
    let revision = previous_revision.saturating_add(1);
    let updated_unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Failed to get current time for daily store: {}", e))?
        .as_millis() as u64;

    tx.execute(
        "INSERT INTO daily_snapshots (date, generated_at, updated_unix_ms, revision)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(date) DO UPDATE SET
             generated_at = excluded.generated_at,
             updated_unix_ms = excluded.updated_unix_ms,
             revision = excluded.revision",
        params![
            snapshot.date,
            snapshot.generated_at,
            updated_unix_ms,
            revision
        ],
    )
    .map_err(|e| format!("Failed to persist daily snapshot header: {}", e))?;

    let incoming_app_names: BTreeSet<String> = snapshot.apps.keys().cloned().collect();
    let mut existing_apps_stmt = tx
        .prepare_cached(
            "SELECT exe_name
             FROM daily_apps
             WHERE date = ?1",
        )
        .map_err(|e| format!("Failed to prepare daily app cleanup select: {}", e))?;
    let existing_app_rows = existing_apps_stmt
        .query_map([snapshot.date.as_str()], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Failed to query existing daily apps for cleanup: {}", e))?;
    let mut removed_apps = Vec::new();
    for row in existing_app_rows {
        let exe_name = row.map_err(|e| format!("Failed to map existing daily app row: {}", e))?;
        if !incoming_app_names.contains(&exe_name) {
            removed_apps.push(exe_name);
        }
    }
    drop(existing_apps_stmt);

    let mut delete_app_stmt = tx
        .prepare_cached(
            "DELETE FROM daily_apps
             WHERE date = ?1 AND exe_name = ?2",
        )
        .map_err(|e| format!("Failed to prepare daily app delete: {}", e))?;
    for exe_name in removed_apps {
        delete_app_stmt
            .execute(params![snapshot.date, exe_name])
            .map_err(|e| format!("Failed to delete removed daily app: {}", e))?;
    }

    let mut app_stmt = tx
        .prepare_cached(
            "INSERT INTO daily_apps (date, exe_name, display_name, total_seconds)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(date, exe_name) DO UPDATE SET
                 display_name = excluded.display_name,
                 total_seconds = excluded.total_seconds",
        )
        .map_err(|e| format!("Failed to prepare daily app insert: {}", e))?;
    let mut session_stmt = tx
        .prepare_cached(
            "INSERT INTO daily_sessions (
                 date, exe_name, session_index, start_time, end_time, duration_seconds
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(date, exe_name, session_index) DO UPDATE SET
                 start_time = excluded.start_time,
                 end_time = excluded.end_time,
                 duration_seconds = excluded.duration_seconds",
        )
        .map_err(|e| format!("Failed to prepare daily session insert: {}", e))?;
    let mut delete_extra_sessions_stmt = tx
        .prepare_cached(
            "DELETE FROM daily_sessions
             WHERE date = ?1 AND exe_name = ?2 AND session_index >= ?3",
        )
        .map_err(|e| format!("Failed to prepare daily session trim: {}", e))?;
    let mut file_stmt = tx
        .prepare_cached(
            "INSERT INTO daily_files (
                 date, exe_name, file_name, ordinal, total_seconds, first_seen, last_seen,
                 window_title, detected_path, title_history_json, activity_type
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(date, exe_name, file_name) DO UPDATE SET
                 ordinal = excluded.ordinal,
                 total_seconds = excluded.total_seconds,
                 first_seen = excluded.first_seen,
                 last_seen = excluded.last_seen,
                 window_title = excluded.window_title,
                 detected_path = excluded.detected_path,
                 title_history_json = excluded.title_history_json,
                 activity_type = excluded.activity_type",
        )
        .map_err(|e| format!("Failed to prepare daily file insert: {}", e))?;
    let mut existing_files_stmt = tx
        .prepare_cached(
            "SELECT file_name
             FROM daily_files
             WHERE date = ?1 AND exe_name = ?2",
        )
        .map_err(|e| format!("Failed to prepare daily file cleanup select: {}", e))?;
    let mut delete_file_stmt = tx
        .prepare_cached(
            "DELETE FROM daily_files
             WHERE date = ?1 AND exe_name = ?2 AND file_name = ?3",
        )
        .map_err(|e| format!("Failed to prepare daily file delete: {}", e))?;

    for (exe_name, app) in &snapshot.apps {
        app_stmt
            .execute(params![
                snapshot.date,
                exe_name,
                app.display_name,
                app.total_seconds
            ])
            .map_err(|e| {
                format!(
                    "Failed to persist daily app '{}' for date {}: {}",
                    exe_name, snapshot.date, e
                )
            })?;

        for (index, session) in app.sessions.iter().enumerate() {
            session_stmt
                .execute(params![
                    snapshot.date,
                    exe_name,
                    index as i64,
                    session.start,
                    session.end,
                    session.duration_seconds
                ])
                .map_err(|e| {
                    format!(
                        "Failed to persist session {} for app '{}' on {}: {}",
                        index, exe_name, snapshot.date, e
                    )
                })?;
        }

        delete_extra_sessions_stmt
            .execute(params![snapshot.date, exe_name, app.sessions.len() as i64])
            .map_err(|e| {
                format!(
                    "Failed to trim stale sessions for app '{}' on {}: {}",
                    exe_name, snapshot.date, e
                )
            })?;

        let existing_file_rows = existing_files_stmt
            .query_map(params![snapshot.date, exe_name], |row| row.get::<_, String>(0))
            .map_err(|e| {
                format!(
                    "Failed to query existing files for app '{}' on {}: {}",
                    exe_name, snapshot.date, e
                )
            })?;
        let mut removed_file_names = BTreeSet::new();
        for row in existing_file_rows {
            let file_name = row.map_err(|e| {
                format!(
                    "Failed to map existing file row for app '{}' on {}: {}",
                    exe_name, snapshot.date, e
                )
            })?;
            removed_file_names.insert(file_name);
        }

        for (ordinal, file) in app.files.iter().enumerate() {
            let title_history_json = serde_json::to_string(&file.title_history).map_err(|e| {
                format!(
                    "Failed to serialize title history for '{}' on {}: {}",
                    file.name, snapshot.date, e
                )
            })?;
            file_stmt
                .execute(params![
                    snapshot.date,
                    exe_name,
                    file.name,
                    ordinal as i64,
                    file.total_seconds,
                    file.first_seen,
                    file.last_seen,
                    file.window_title,
                    file.detected_path,
                    title_history_json,
                    file.activity_type
                ])
                .map_err(|e| {
                    format!(
                        "Failed to persist file '{}' for app '{}' on {}: {}",
                        file.name, exe_name, snapshot.date, e
                    )
                })?;
            removed_file_names.remove(&file.name);
        }

        for file_name in removed_file_names {
            delete_file_stmt
                .execute(params![snapshot.date, exe_name, file_name])
                .map_err(|e| {
                    format!(
                        "Failed to delete removed file for app '{}' on {}: {}",
                        exe_name, snapshot.date, e
                    )
                })?;
        }
    }

    drop(delete_file_stmt);
    drop(existing_files_stmt);
    drop(file_stmt);
    drop(delete_extra_sessions_stmt);
    drop(session_stmt);
    drop(app_stmt);
    drop(delete_app_stmt);
    tx.commit()
        .map_err(|e| format!("Failed to commit daily store transaction: {}", e))?;

    Ok(DaySignature {
        updated_unix_ms,
        revision,
    })
}

fn parse_title_history_json(title_history_json: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(title_history_json).unwrap_or_default()
}

pub fn load_day_snapshot(conn: &Connection, date: &str) -> Result<Option<StoredDailyData>, String> {
    let generated_at = conn
        .query_row(
            "SELECT generated_at FROM daily_snapshots WHERE date = ?1",
            [date],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read daily snapshot header for {}: {}", date, e))?;

    let Some(generated_at) = generated_at else {
        return Ok(None);
    };

    let mut apps = BTreeMap::new();
    let mut app_stmt = conn
        .prepare_cached(
            "SELECT exe_name, display_name, total_seconds
             FROM daily_apps
             WHERE date = ?1
             ORDER BY exe_name COLLATE NOCASE",
        )
        .map_err(|e| format!("Failed to prepare daily app select for {}: {}", date, e))?;
    let app_rows = app_stmt
        .query_map([date], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u64>(2)?,
            ))
        })
        .map_err(|e| format!("Failed to query daily apps for {}: {}", date, e))?;
    for row in app_rows {
        let (exe_name, display_name, total_seconds) =
            row.map_err(|e| format!("Failed to map daily app row for {}: {}", date, e))?;
        apps.insert(
            exe_name,
            StoredAppDailyData {
                display_name,
                total_seconds,
                sessions: Vec::new(),
                files: Vec::new(),
            },
        );
    }
    drop(app_stmt);

    let mut session_stmt = conn
        .prepare_cached(
            "SELECT exe_name, start_time, end_time, duration_seconds
             FROM daily_sessions
             WHERE date = ?1
             ORDER BY exe_name COLLATE NOCASE, session_index ASC",
        )
        .map_err(|e| format!("Failed to prepare daily session select for {}: {}", date, e))?;
    let session_rows = session_stmt
        .query_map([date], |row| {
            Ok((
                row.get::<_, String>(0)?,
                StoredSession {
                    start: row.get(1)?,
                    end: row.get(2)?,
                    duration_seconds: row.get(3)?,
                },
            ))
        })
        .map_err(|e| format!("Failed to query daily sessions for {}: {}", date, e))?;
    for row in session_rows {
        let (exe_name, session) =
            row.map_err(|e| format!("Failed to map daily session row for {}: {}", date, e))?;
        if let Some(app) = apps.get_mut(&exe_name) {
            app.sessions.push(session);
        }
    }
    drop(session_stmt);

    let mut file_stmt = conn
        .prepare_cached(
            "SELECT exe_name, file_name, total_seconds, first_seen, last_seen,
                    window_title, detected_path, title_history_json, activity_type
             FROM daily_files
             WHERE date = ?1
             ORDER BY exe_name COLLATE NOCASE, ordinal ASC",
        )
        .map_err(|e| format!("Failed to prepare daily file select for {}: {}", date, e))?;
    let file_rows = file_stmt
        .query_map([date], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<String>>(8)?,
            ))
        })
        .map_err(|e| format!("Failed to query daily files for {}: {}", date, e))?;
    for row in file_rows {
        let (
            exe_name,
            name,
            total_seconds,
            first_seen,
            last_seen,
            window_title,
            detected_path,
            title_history_json,
            activity_type,
        ) = row.map_err(|e| format!("Failed to map daily file row for {}: {}", date, e))?;
        let title_history = parse_title_history_json(&title_history_json);
        if let Some(app) = apps.get_mut(&exe_name) {
            app.files.push(StoredFileEntry {
                name,
                total_seconds,
                first_seen,
                last_seen,
                window_title,
                detected_path,
                title_history,
                activity_type,
            });
        }
    }

    Ok(Some(StoredDailyData {
        date: date.to_string(),
        generated_at,
        apps,
    }))
}

// Used by the dashboard Tauri crate via the shared module include.
#[allow(dead_code)]
pub fn load_range_snapshots(
    conn: &Connection,
    start: &str,
    end: &str,
) -> Result<BTreeMap<String, StoredDailyData>, String> {
    let mut headers_stmt = conn
        .prepare_cached(
            "SELECT date, generated_at
             FROM daily_snapshots
             WHERE date >= ?1 AND date <= ?2
             ORDER BY date ASC",
        )
        .map_err(|e| format!("Failed to prepare daily snapshot range query: {}", e))?;
    let header_rows = headers_stmt
        .query_map(params![start, end], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("Failed to query daily snapshot range: {}", e))?;

    let mut snapshots = BTreeMap::new();
    for row in header_rows {
        let (date, generated_at) =
            row.map_err(|e| format!("Failed to map daily snapshot header row: {}", e))?;
        snapshots.insert(
            date.clone(),
            StoredDailyData {
                date,
                generated_at,
                apps: BTreeMap::new(),
            },
        );
    }
    drop(headers_stmt);

    if snapshots.is_empty() {
        return Ok(snapshots);
    }

    let mut app_stmt = conn
        .prepare_cached(
            "SELECT date, exe_name, display_name, total_seconds
             FROM daily_apps
             WHERE date >= ?1 AND date <= ?2
             ORDER BY date ASC, exe_name COLLATE NOCASE",
        )
        .map_err(|e| format!("Failed to prepare daily app range select: {}", e))?;
    let app_rows = app_stmt
        .query_map(params![start, end], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, u64>(3)?,
            ))
        })
        .map_err(|e| format!("Failed to query daily app range: {}", e))?;
    for row in app_rows {
        let (date, exe_name, display_name, total_seconds) =
            row.map_err(|e| format!("Failed to map daily app range row: {}", e))?;
        if let Some(snapshot) = snapshots.get_mut(&date) {
            snapshot.apps.insert(
                exe_name,
                StoredAppDailyData {
                    display_name,
                    total_seconds,
                    sessions: Vec::new(),
                    files: Vec::new(),
                },
            );
        }
    }
    drop(app_stmt);

    let mut session_stmt = conn
        .prepare_cached(
            "SELECT date, exe_name, start_time, end_time, duration_seconds
             FROM daily_sessions
             WHERE date >= ?1 AND date <= ?2
             ORDER BY date ASC, exe_name COLLATE NOCASE, session_index ASC",
        )
        .map_err(|e| format!("Failed to prepare daily session range select: {}", e))?;
    let session_rows = session_stmt
        .query_map(params![start, end], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                StoredSession {
                    start: row.get(2)?,
                    end: row.get(3)?,
                    duration_seconds: row.get(4)?,
                },
            ))
        })
        .map_err(|e| format!("Failed to query daily session range: {}", e))?;
    for row in session_rows {
        let (date, exe_name, session) =
            row.map_err(|e| format!("Failed to map daily session range row: {}", e))?;
        if let Some(snapshot) = snapshots.get_mut(&date) {
            if let Some(app) = snapshot.apps.get_mut(&exe_name) {
                app.sessions.push(session);
            }
        }
    }
    drop(session_stmt);

    let mut file_stmt = conn
        .prepare_cached(
            "SELECT date, exe_name, file_name, total_seconds, first_seen, last_seen,
                    window_title, detected_path, title_history_json, activity_type
             FROM daily_files
             WHERE date >= ?1 AND date <= ?2
             ORDER BY date ASC, exe_name COLLATE NOCASE, ordinal ASC",
        )
        .map_err(|e| format!("Failed to prepare daily file range select: {}", e))?;
    let file_rows = file_stmt
        .query_map(params![start, end], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, u64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, Option<String>>(9)?,
            ))
        })
        .map_err(|e| format!("Failed to query daily file range: {}", e))?;
    for row in file_rows {
        let (
            date,
            exe_name,
            name,
            total_seconds,
            first_seen,
            last_seen,
            window_title,
            detected_path,
            title_history_json,
            activity_type,
        ) = row.map_err(|e| format!("Failed to map daily file range row: {}", e))?;
        if let Some(snapshot) = snapshots.get_mut(&date) {
            if let Some(app) = snapshot.apps.get_mut(&exe_name) {
                app.files.push(StoredFileEntry {
                    name,
                    total_seconds,
                    first_seen,
                    last_seen,
                    window_title,
                    detected_path,
                    title_history: parse_title_history_json(&title_history_json),
                    activity_type,
                });
            }
        }
    }
    Ok(snapshots)
}

// Used by the dashboard Tauri crate via the shared module include.
#[allow(dead_code)]
pub fn get_day_signature(conn: &Connection, date: &str) -> Result<Option<DaySignature>, String> {
    let signature = conn
        .query_row(
            "SELECT updated_unix_ms, revision
         FROM daily_snapshots
         WHERE date = ?1",
            [date],
            |row| {
                let updated_unix_ms: u64 = row.get(0)?;
                let revision: u64 = row.get(1)?;
                Ok((updated_unix_ms, revision))
            },
        )
        .optional()
        .map_err(|e| format!("Failed to read daily signature for {}: {}", date, e))?
        .map(|(updated_unix_ms, revision)| DaySignature {
            updated_unix_ms,
            revision,
        });
    Ok(signature)
}

pub fn load_legacy_json_file(path: &Path) -> Result<StoredDailyData, String> {
    let content = fs::read_to_string(path).map_err(|e| {
        format!(
            "Failed to read legacy daily JSON '{}': {}",
            path.display(),
            e
        )
    })?;
    serde_json::from_str::<StoredDailyData>(&content).map_err(|e| {
        format!(
            "Failed to parse legacy daily JSON '{}': {}",
            path.display(),
            e
        )
    })
}

pub fn migrate_legacy_json_files(base_dir: &Path) -> Result<usize, String> {
    let mut conn = open_store(base_dir)?;
    let mut migrated = 0usize;

    for dir_name in ["data", "archive"] {
        let dir_path = base_dir.join(dir_name);
        if !dir_path.exists() {
            continue;
        }

        let mut entries: Vec<PathBuf> = fs::read_dir(&dir_path)
            .map_err(|e| {
                format!(
                    "Failed to read legacy daily directory '{}': {}",
                    dir_path.display(),
                    e
                )
            })?
            .filter_map(|entry| entry.ok().map(|value| value.path()))
            .filter(|path| {
                path.is_file()
                    && path.extension().map(|ext| ext == "json").unwrap_or(false)
                    && !path
                        .file_name()
                        .map(|name| name.to_string_lossy().starts_with('.'))
                        .unwrap_or(false)
            })
            .collect();
        entries.sort();

        for path in entries {
            let snapshot = match load_legacy_json_file(&path) {
                Ok(snapshot) => snapshot,
                Err(err) => {
                    log::warn!("{}", err);
                    continue;
                }
            };

            let already_exists = conn
                .query_row(
                    "SELECT 1 FROM daily_snapshots WHERE date = ?1 LIMIT 1",
                    [snapshot.date.as_str()],
                    |row| row.get::<_, i64>(0),
                )
                .optional()
                .map_err(|e| {
                    format!(
                        "Failed to check daily snapshot existence for {}: {}",
                        snapshot.date, e
                    )
                })?
                .is_some();
            if already_exists {
                continue;
            }

            replace_day_snapshot(&mut conn, &snapshot)?;
            migrated += 1;
        }
    }

    Ok(migrated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replace_and_load_day_snapshot_roundtrip() {
        let mut conn = Connection::open_in_memory().expect("in-memory sqlite");
        ensure_schema(&conn).expect("schema");

        let snapshot = StoredDailyData {
            date: "2026-03-08".to_string(),
            generated_at: "2026-03-08T12:00:00+00:00".to_string(),
            apps: BTreeMap::from([(
                "code.exe".to_string(),
                StoredAppDailyData {
                    display_name: "VS Code".to_string(),
                    total_seconds: 123,
                    sessions: vec![StoredSession {
                        start: "2026-03-08T10:00:00+00:00".to_string(),
                        end: "2026-03-08T10:02:03+00:00".to_string(),
                        duration_seconds: 123,
                    }],
                    files: vec![StoredFileEntry {
                        name: "project-a".to_string(),
                        total_seconds: 123,
                        first_seen: "2026-03-08T10:00:00+00:00".to_string(),
                        last_seen: "2026-03-08T10:02:03+00:00".to_string(),
                        window_title: "project-a".to_string(),
                        detected_path: Some("C:/repo/project-a".to_string()),
                        title_history: vec!["project-a".to_string()],
                        activity_type: Some("coding".to_string()),
                    }],
                },
            )]),
        };

        let signature = replace_day_snapshot(&mut conn, &snapshot).expect("save");
        assert_eq!(signature.revision, 1);

        let loaded = load_day_snapshot(&conn, "2026-03-08")
            .expect("load")
            .expect("snapshot should exist");
        assert_eq!(loaded, snapshot);

        let signature_again = get_day_signature(&conn, "2026-03-08")
            .expect("signature")
            .expect("signature should exist");
        assert_eq!(signature_again.revision, 1);
        assert!(signature_again.updated_unix_ms > 0);
    }

    #[test]
    fn range_query_returns_snapshots_in_date_order() {
        let mut conn = Connection::open_in_memory().expect("in-memory sqlite");
        ensure_schema(&conn).expect("schema");

        let day_one = StoredDailyData {
            date: "2026-03-07".to_string(),
            generated_at: "2026-03-07T08:00:00+00:00".to_string(),
            apps: BTreeMap::from([(
                "code.exe".to_string(),
                StoredAppDailyData {
                    display_name: "VS Code".to_string(),
                    total_seconds: 120,
                    sessions: vec![StoredSession {
                        start: "2026-03-07T08:00:00+00:00".to_string(),
                        end: "2026-03-07T08:02:00+00:00".to_string(),
                        duration_seconds: 120,
                    }],
                    files: vec![StoredFileEntry {
                        name: "client".to_string(),
                        total_seconds: 120,
                        first_seen: "2026-03-07T08:00:00+00:00".to_string(),
                        last_seen: "2026-03-07T08:02:00+00:00".to_string(),
                        window_title: "TIMEFLOW".to_string(),
                        detected_path: Some("C:/repo/client".to_string()),
                        title_history: vec!["TIMEFLOW".to_string()],
                        activity_type: Some("coding".to_string()),
                    }],
                },
            )]),
        };
        let day_two = StoredDailyData {
            date: "2026-03-08".to_string(),
            generated_at: "2026-03-08T09:00:00+00:00".to_string(),
            apps: BTreeMap::from([(
                "figma.exe".to_string(),
                StoredAppDailyData {
                    display_name: "Figma".to_string(),
                    total_seconds: 300,
                    sessions: vec![StoredSession {
                        start: "2026-03-08T09:00:00+00:00".to_string(),
                        end: "2026-03-08T09:05:00+00:00".to_string(),
                        duration_seconds: 300,
                    }],
                    files: vec![StoredFileEntry {
                        name: "design.fig".to_string(),
                        total_seconds: 300,
                        first_seen: "2026-03-08T09:00:00+00:00".to_string(),
                        last_seen: "2026-03-08T09:05:00+00:00".to_string(),
                        window_title: "Design".to_string(),
                        detected_path: Some("C:/repo/design.fig".to_string()),
                        title_history: vec!["Design".to_string()],
                        activity_type: Some("design".to_string()),
                    }],
                },
            )]),
        };

        for snapshot in [day_one.clone(), day_two.clone()] {
            replace_day_snapshot(
                &mut conn,
                &snapshot,
            )
            .expect("save");
        }

        let snapshots =
            load_range_snapshots(&conn, "2026-03-07", "2026-03-08").expect("range load");
        assert_eq!(
            snapshots.keys().cloned().collect::<Vec<_>>(),
            vec!["2026-03-07".to_string(), "2026-03-08".to_string()]
        );
        assert_eq!(snapshots.get("2026-03-07"), Some(&day_one));
        assert_eq!(snapshots.get("2026-03-08"), Some(&day_two));
    }

    #[test]
    fn replace_day_snapshot_updates_existing_rows_without_recreating_whole_day() {
        let mut conn = Connection::open_in_memory().expect("in-memory sqlite");
        ensure_schema(&conn).expect("schema");

        let initial = StoredDailyData {
            date: "2026-03-09".to_string(),
            generated_at: "2026-03-09T10:00:00+00:00".to_string(),
            apps: BTreeMap::from([
                (
                    "code.exe".to_string(),
                    StoredAppDailyData {
                        display_name: "VS Code".to_string(),
                        total_seconds: 300,
                        sessions: vec![
                            StoredSession {
                                start: "2026-03-09T10:00:00+00:00".to_string(),
                                end: "2026-03-09T10:03:00+00:00".to_string(),
                                duration_seconds: 180,
                            },
                            StoredSession {
                                start: "2026-03-09T10:05:00+00:00".to_string(),
                                end: "2026-03-09T10:07:00+00:00".to_string(),
                                duration_seconds: 120,
                            },
                        ],
                        files: vec![
                            StoredFileEntry {
                                name: "client".to_string(),
                                total_seconds: 180,
                                first_seen: "2026-03-09T10:00:00+00:00".to_string(),
                                last_seen: "2026-03-09T10:03:00+00:00".to_string(),
                                window_title: "Client".to_string(),
                                detected_path: Some("C:/repo/client".to_string()),
                                title_history: vec!["Client".to_string()],
                                activity_type: Some("coding".to_string()),
                            },
                            StoredFileEntry {
                                name: "server".to_string(),
                                total_seconds: 120,
                                first_seen: "2026-03-09T10:05:00+00:00".to_string(),
                                last_seen: "2026-03-09T10:07:00+00:00".to_string(),
                                window_title: "Server".to_string(),
                                detected_path: Some("C:/repo/server".to_string()),
                                title_history: vec!["Server".to_string()],
                                activity_type: Some("coding".to_string()),
                            },
                        ],
                    },
                ),
                (
                    "slack.exe".to_string(),
                    StoredAppDailyData {
                        display_name: "Slack".to_string(),
                        total_seconds: 60,
                        sessions: vec![StoredSession {
                            start: "2026-03-09T11:00:00+00:00".to_string(),
                            end: "2026-03-09T11:01:00+00:00".to_string(),
                            duration_seconds: 60,
                        }],
                        files: vec![StoredFileEntry {
                            name: "general".to_string(),
                            total_seconds: 60,
                            first_seen: "2026-03-09T11:00:00+00:00".to_string(),
                            last_seen: "2026-03-09T11:01:00+00:00".to_string(),
                            window_title: "general".to_string(),
                            detected_path: None,
                            title_history: vec!["general".to_string()],
                            activity_type: Some("communication".to_string()),
                        }],
                    },
                ),
            ]),
        };

        let updated = StoredDailyData {
            date: "2026-03-09".to_string(),
            generated_at: "2026-03-09T12:00:00+00:00".to_string(),
            apps: BTreeMap::from([(
                "code.exe".to_string(),
                StoredAppDailyData {
                    display_name: "VS Code Insiders".to_string(),
                    total_seconds: 240,
                    sessions: vec![StoredSession {
                        start: "2026-03-09T12:00:00+00:00".to_string(),
                        end: "2026-03-09T12:04:00+00:00".to_string(),
                        duration_seconds: 240,
                    }],
                    files: vec![StoredFileEntry {
                        name: "client".to_string(),
                        total_seconds: 240,
                        first_seen: "2026-03-09T12:00:00+00:00".to_string(),
                        last_seen: "2026-03-09T12:04:00+00:00".to_string(),
                        window_title: "Client Updated".to_string(),
                        detected_path: Some("C:/repo/client-new".to_string()),
                        title_history: vec!["Client Updated".to_string()],
                        activity_type: Some("coding".to_string()),
                    }],
                },
            )]),
        };

        let initial_signature = replace_day_snapshot(&mut conn, &initial).expect("initial save");
        let updated_signature = replace_day_snapshot(&mut conn, &updated).expect("updated save");

        assert_eq!(updated_signature.revision, initial_signature.revision + 1);

        let loaded = load_day_snapshot(&conn, "2026-03-09")
            .expect("load")
            .expect("snapshot should exist");
        assert_eq!(loaded, updated);

        let app_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM daily_apps WHERE date = '2026-03-09'",
                [],
                |row| row.get(0),
            )
            .expect("app count");
        let session_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM daily_sessions WHERE date = '2026-03-09'",
                [],
                |row| row.get(0),
            )
            .expect("session count");
        let file_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM daily_files WHERE date = '2026-03-09'",
                [],
                |row| row.get(0),
            )
            .expect("file count");

        assert_eq!(app_count, 1);
        assert_eq!(session_count, 1);
        assert_eq!(file_count, 1);
    }
}
