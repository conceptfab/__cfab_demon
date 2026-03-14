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

fn dedupe_files_preserving_last(files: &[StoredFileEntry]) -> Vec<&StoredFileEntry> {
    let mut seen = BTreeSet::new();
    let mut deduped = Vec::with_capacity(files.len());
    for file in files.iter().rev() {
        if seen.insert((
            file.name.clone(),
            detected_path_key(file.detected_path.as_deref()).to_string(),
        )) {
            deduped.push(file);
        }
    }
    deduped.reverse();
    deduped
}

fn detected_path_key(value: Option<&str>) -> &str {
    value.unwrap_or("")
}

fn decode_detected_path(value: String) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
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
             detected_path TEXT NOT NULL DEFAULT '',
             title_history_json TEXT NOT NULL DEFAULT '[]',
             activity_type TEXT,
             PRIMARY KEY (date, exe_name, file_name, detected_path),
             FOREIGN KEY (date, exe_name) REFERENCES daily_apps(date, exe_name) ON DELETE CASCADE
         );
         DROP INDEX IF EXISTS idx_daily_snapshots_date;
         CREATE INDEX IF NOT EXISTS idx_daily_sessions_date_exe
             ON daily_sessions(date, exe_name, session_index);
         CREATE INDEX IF NOT EXISTS idx_daily_files_date_exe
             ON daily_files(date, exe_name, ordinal);",
    )
    .map_err(|e| format!("Failed to initialize daily store schema: {}", e))?;
    migrate_daily_files_schema(conn)
}

fn migrate_daily_files_schema(conn: &Connection) -> Result<(), String> {
    let table_exists = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'daily_files'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .map_err(|e| format!("Failed to inspect daily_files presence: {}", e))?;
    if !table_exists {
        return Ok(());
    }

    let mut table_info_stmt = conn
        .prepare_cached(
            "SELECT name, pk, [notnull], COALESCE(dflt_value, '')
             FROM pragma_table_info('daily_files')",
        )
        .map_err(|e| format!("Failed to inspect daily_files schema: {}", e))?;
    let table_info_rows = table_info_stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)? != 0,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| format!("Failed to query daily_files schema info: {}", e))?;

    let mut columns = BTreeMap::<String, (i64, bool, String)>::new();
    for row in table_info_rows {
        let (name, pk, not_null, default_value) =
            row.map_err(|e| format!("Failed to map daily_files schema row: {}", e))?;
        columns.insert(name, (pk, not_null, default_value));
    }

    let detected_path_pk = columns
        .get("detected_path")
        .map(|(pk, _, _)| *pk)
        .unwrap_or(0);
    let detected_path_not_null = columns
        .get("detected_path")
        .map(|(_, not_null, _)| *not_null)
        .unwrap_or(false);
    let detected_path_default = columns
        .get("detected_path")
        .map(|(_, _, default_value)| default_value.as_str())
        .unwrap_or("");
    let needs_migration =
        detected_path_pk != 4 || !detected_path_not_null || detected_path_default != "''";
    if !needs_migration {
        return Ok(());
    }

    let select_window_title = if columns.contains_key("window_title") {
        "COALESCE(window_title, '')"
    } else {
        "''"
    };
    let select_detected_path = if columns.contains_key("detected_path") {
        "COALESCE(detected_path, '')"
    } else {
        "''"
    };
    let select_title_history = if columns.contains_key("title_history_json") {
        "COALESCE(title_history_json, '[]')"
    } else {
        "'[]'"
    };
    let select_activity_type = if columns.contains_key("activity_type") {
        "activity_type"
    } else {
        "NULL"
    };
    let migration_sql = format!(
        "CREATE TABLE daily_files_new (
             date TEXT NOT NULL,
             exe_name TEXT NOT NULL,
             file_name TEXT NOT NULL,
             ordinal INTEGER NOT NULL,
             total_seconds INTEGER NOT NULL DEFAULT 0,
             first_seen TEXT NOT NULL,
             last_seen TEXT NOT NULL,
             window_title TEXT NOT NULL DEFAULT '',
             detected_path TEXT NOT NULL DEFAULT '',
             title_history_json TEXT NOT NULL DEFAULT '[]',
             activity_type TEXT,
             PRIMARY KEY (date, exe_name, file_name, detected_path),
             FOREIGN KEY (date, exe_name) REFERENCES daily_apps(date, exe_name) ON DELETE CASCADE
         );
         INSERT INTO daily_files_new (
             date, exe_name, file_name, ordinal, total_seconds, first_seen, last_seen,
             window_title, detected_path, title_history_json, activity_type
         )
         SELECT
             date,
             exe_name,
             file_name,
             ordinal,
             total_seconds,
             first_seen,
             last_seen,
             {select_window_title},
             {select_detected_path},
             {select_title_history},
             {select_activity_type}
         FROM daily_files;
         DROP TABLE daily_files;
         ALTER TABLE daily_files_new RENAME TO daily_files;
         CREATE INDEX IF NOT EXISTS idx_daily_files_date_exe
             ON daily_files(date, exe_name, ordinal);"
    );
    conn.execute_batch(&migration_sql)
        .map_err(|e| format!("Failed to migrate daily_files schema: {}", e))
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
             ON CONFLICT(date, exe_name, file_name, detected_path) DO UPDATE SET
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
    let mut delete_file_stmt = tx
        .prepare_cached(
            "DELETE FROM daily_files
             WHERE date = ?1 AND exe_name = ?2 AND file_name = ?3 AND detected_path = ?4",
        )
        .map_err(|e| format!("Failed to prepare daily file delete: {}", e))?;
    let mut existing_files_by_app = BTreeMap::<String, BTreeSet<(String, String)>>::new();
    {
        let mut existing_files_stmt = tx
            .prepare_cached(
                "SELECT exe_name, file_name, detected_path
                 FROM daily_files
                 WHERE date = ?1",
            )
            .map_err(|e| format!("Failed to prepare daily file cleanup select: {}", e))?;
        let existing_file_rows = existing_files_stmt
            .query_map([snapshot.date.as_str()], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| format!("Failed to query existing daily files for cleanup: {}", e))?;
        for row in existing_file_rows {
            let (exe_name, file_name, detected_path) =
                row.map_err(|e| format!("Failed to map existing daily file row: {}", e))?;
            existing_files_by_app
                .entry(exe_name)
                .or_default()
                .insert((file_name, detected_path));
        }
    }

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

        let mut removed_file_names = existing_files_by_app.remove(exe_name).unwrap_or_default();

        for (ordinal, file) in dedupe_files_preserving_last(&app.files)
            .into_iter()
            .enumerate()
        {
            let detected_path = detected_path_key(file.detected_path.as_deref()).to_string();
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
                    detected_path.as_str(),
                    title_history_json,
                    file.activity_type
                ])
                .map_err(|e| {
                    format!(
                        "Failed to persist file '{}' for app '{}' on {}: {}",
                        file.name, exe_name, snapshot.date, e
                    )
                })?;
            removed_file_names.remove(&(file.name.clone(), detected_path));
        }

        for (file_name, detected_path) in removed_file_names {
            delete_file_stmt
                .execute(params![snapshot.date, exe_name, file_name, detected_path])
                .map_err(|e| {
                    format!(
                        "Failed to delete removed file for app '{}' on {}: {}",
                        exe_name, snapshot.date, e
                    )
                })?;
        }
    }

    drop(delete_file_stmt);
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
                row.get::<_, String>(6)?,
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
                detected_path: decode_detected_path(detected_path),
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
    let mut snapshots_stmt = conn
        .prepare_cached(
            "SELECT snapshots.date,
                    snapshots.generated_at,
                    apps.exe_name,
                    apps.display_name,
                    apps.total_seconds
             FROM daily_snapshots AS snapshots
             LEFT JOIN daily_apps AS apps
               ON apps.date = snapshots.date
             WHERE snapshots.date >= ?1 AND snapshots.date <= ?2
             ORDER BY snapshots.date ASC, apps.exe_name COLLATE NOCASE",
        )
        .map_err(|e| format!("Failed to prepare daily snapshot/app range query: {}", e))?;
    let snapshot_rows = snapshots_stmt
        .query_map(params![start, end], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<u64>>(4)?,
            ))
        })
        .map_err(|e| format!("Failed to query daily snapshot/app range: {}", e))?;

    let mut snapshots = BTreeMap::new();
    for row in snapshot_rows {
        let (date, generated_at, exe_name, display_name, total_seconds) =
            row.map_err(|e| format!("Failed to map daily snapshot/app range row: {}", e))?;
        let snapshot = snapshots
            .entry(date.clone())
            .or_insert_with(|| StoredDailyData {
                date,
                generated_at,
                apps: BTreeMap::new(),
            });
        if let Some(exe_name) = exe_name {
            snapshot.apps.insert(
                exe_name,
                StoredAppDailyData {
                    display_name: display_name.unwrap_or_default(),
                    total_seconds: total_seconds.unwrap_or(0),
                    sessions: Vec::new(),
                    files: Vec::new(),
                },
            );
        }
    }

    if snapshots.is_empty() {
        return Ok(snapshots);
    }

    drop(snapshots_stmt);

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
                row.get::<_, String>(7)?,
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
                    detected_path: decode_detected_path(detected_path),
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

#[allow(dead_code)]
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

// Used by the dashboard Tauri crate via the shared module include.
#[allow(dead_code)]
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
            replace_day_snapshot(&mut conn, &snapshot).expect("save");
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

    #[test]
    fn replace_day_snapshot_keeps_only_last_duplicate_file_entry() {
        let mut conn = Connection::open_in_memory().expect("in-memory sqlite");
        ensure_schema(&conn).expect("schema");

        let snapshot = StoredDailyData {
            date: "2026-03-10".to_string(),
            generated_at: "2026-03-10T12:00:00+00:00".to_string(),
            apps: BTreeMap::from([(
                "code.exe".to_string(),
                StoredAppDailyData {
                    display_name: "VS Code".to_string(),
                    total_seconds: 300,
                    sessions: vec![],
                    files: vec![
                        StoredFileEntry {
                            name: "client".to_string(),
                            total_seconds: 120,
                            first_seen: "2026-03-10T10:00:00+00:00".to_string(),
                            last_seen: "2026-03-10T10:02:00+00:00".to_string(),
                            window_title: "Client old".to_string(),
                            detected_path: Some("C:/repo/client".to_string()),
                            title_history: vec!["Client old".to_string()],
                            activity_type: Some("coding".to_string()),
                        },
                        StoredFileEntry {
                            name: "client".to_string(),
                            total_seconds: 180,
                            first_seen: "2026-03-10T10:03:00+00:00".to_string(),
                            last_seen: "2026-03-10T10:06:00+00:00".to_string(),
                            window_title: "Client new".to_string(),
                            detected_path: Some("C:/repo/client".to_string()),
                            title_history: vec!["Client new".to_string()],
                            activity_type: Some("coding".to_string()),
                        },
                    ],
                },
            )]),
        };

        replace_day_snapshot(&mut conn, &snapshot).expect("save");

        let loaded = load_day_snapshot(&conn, "2026-03-10")
            .expect("load")
            .expect("snapshot should exist");
        let files = &loaded.apps.get("code.exe").expect("app should exist").files;
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "client");
        assert_eq!(files[0].window_title, "Client new");
        assert_eq!(files[0].detected_path.as_deref(), Some("C:/repo/client"));

        let file_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM daily_files WHERE date = '2026-03-10' AND exe_name = 'code.exe'",
                [],
                |row| row.get(0),
            )
            .expect("file count");
        assert_eq!(file_count, 1);
    }

    #[test]
    fn replace_day_snapshot_keeps_same_name_files_with_different_detected_paths() {
        let mut conn = Connection::open_in_memory().expect("in-memory sqlite");
        ensure_schema(&conn).expect("schema");

        let snapshot = StoredDailyData {
            date: "2026-03-11".to_string(),
            generated_at: "2026-03-11T12:00:00+00:00".to_string(),
            apps: BTreeMap::from([(
                "code.exe".to_string(),
                StoredAppDailyData {
                    display_name: "VS Code".to_string(),
                    total_seconds: 300,
                    sessions: vec![],
                    files: vec![
                        StoredFileEntry {
                            name: "index.ts".to_string(),
                            total_seconds: 120,
                            first_seen: "2026-03-11T10:00:00+00:00".to_string(),
                            last_seen: "2026-03-11T10:02:00+00:00".to_string(),
                            window_title: "Repo A".to_string(),
                            detected_path: Some("C:/repo-a/src/index.ts".to_string()),
                            title_history: vec!["Repo A".to_string()],
                            activity_type: Some("coding".to_string()),
                        },
                        StoredFileEntry {
                            name: "index.ts".to_string(),
                            total_seconds: 180,
                            first_seen: "2026-03-11T10:03:00+00:00".to_string(),
                            last_seen: "2026-03-11T10:06:00+00:00".to_string(),
                            window_title: "Repo B".to_string(),
                            detected_path: Some("C:/repo-b/src/index.ts".to_string()),
                            title_history: vec!["Repo B".to_string()],
                            activity_type: Some("coding".to_string()),
                        },
                    ],
                },
            )]),
        };

        replace_day_snapshot(&mut conn, &snapshot).expect("save");

        let loaded = load_day_snapshot(&conn, "2026-03-11")
            .expect("load")
            .expect("snapshot should exist");
        let files = &loaded.apps.get("code.exe").expect("app should exist").files;
        assert_eq!(files.len(), 2);
        assert_eq!(
            files
                .iter()
                .filter_map(|file| file.detected_path.as_deref())
                .collect::<BTreeSet<_>>(),
            BTreeSet::from(["C:/repo-a/src/index.ts", "C:/repo-b/src/index.ts"])
        );

        let file_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM daily_files WHERE date = '2026-03-11' AND exe_name = 'code.exe'",
                [],
                |row| row.get(0),
            )
            .expect("file count");
        assert_eq!(file_count, 2);
    }

    #[test]
    fn ensure_schema_migrates_legacy_daily_files_primary_key_to_detected_path() {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        conn.execute_batch(
            "CREATE TABLE daily_snapshots (
                 date TEXT PRIMARY KEY,
                 generated_at TEXT NOT NULL DEFAULT '',
                 updated_unix_ms INTEGER NOT NULL DEFAULT 0,
                 revision INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE daily_apps (
                 date TEXT NOT NULL,
                 exe_name TEXT NOT NULL,
                 display_name TEXT NOT NULL,
                 total_seconds INTEGER NOT NULL DEFAULT 0,
                 PRIMARY KEY (date, exe_name),
                 FOREIGN KEY (date) REFERENCES daily_snapshots(date) ON DELETE CASCADE
             );
             CREATE TABLE daily_files (
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
             );",
        )
        .expect("legacy schema");
        conn.execute(
            "INSERT INTO daily_snapshots (date, generated_at, updated_unix_ms, revision)
             VALUES (?1, ?2, ?3, ?4)",
            params!["2026-03-12", "2026-03-12T12:00:00+00:00", 1u64, 1u64],
        )
        .expect("snapshot row");
        conn.execute(
            "INSERT INTO daily_apps (date, exe_name, display_name, total_seconds)
             VALUES (?1, ?2, ?3, ?4)",
            params!["2026-03-12", "code.exe", "VS Code", 60u64],
        )
        .expect("app row");
        conn.execute(
            "INSERT INTO daily_files (
                 date, exe_name, file_name, ordinal, total_seconds, first_seen, last_seen,
                 window_title, detected_path, title_history_json, activity_type
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10)",
            params![
                "2026-03-12",
                "code.exe",
                "index.ts",
                0i64,
                60u64,
                "2026-03-12T10:00:00+00:00",
                "2026-03-12T10:01:00+00:00",
                "Client",
                "[]",
                "coding"
            ],
        )
        .expect("file row");

        ensure_schema(&conn).expect("migrated schema");

        let detected_path_column: (i64, i64, String) = conn
            .query_row(
                "SELECT pk, [notnull], COALESCE(dflt_value, '')
                 FROM pragma_table_info('daily_files')
                 WHERE name = 'detected_path'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("detected_path column");
        assert_eq!(detected_path_column.0, 4);
        assert_eq!(detected_path_column.1, 1);
        assert_eq!(detected_path_column.2, "''");

        let stored_path: String = conn
            .query_row(
                "SELECT detected_path FROM daily_files
                 WHERE date = '2026-03-12' AND exe_name = 'code.exe' AND file_name = 'index.ts'",
                [],
                |row| row.get(0),
            )
            .expect("stored detected_path");
        assert_eq!(stored_path, "");

        let loaded = load_day_snapshot(&conn, "2026-03-12")
            .expect("load")
            .expect("snapshot should exist");
        let files = &loaded.apps.get("code.exe").expect("app should exist").files;
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].detected_path, None);
    }
}
