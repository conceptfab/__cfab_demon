use rusqlite::Connection;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

const STORE_FILE_NAME: &str = "timeflow_daily_store.db";

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
             activity_spans_json TEXT NOT NULL DEFAULT '[]',
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
        // Even when the primary-key migration is not needed, the activity_spans_json column
        // might be absent on databases created before this feature was added.
        let has_activity_spans: bool = conn
            .prepare_cached(
                "SELECT COUNT(*) FROM pragma_table_info('daily_files') WHERE name='activity_spans_json'",
            )
            .map_err(|e| format!("Failed to check activity_spans_json column: {}", e))?
            .query_row([], |row| row.get::<_, i64>(0))
            .map(|c| c > 0)
            .map_err(|e| format!("Failed to query activity_spans_json column: {}", e))?;
        if !has_activity_spans {
            conn.execute_batch(
                "ALTER TABLE daily_files ADD COLUMN activity_spans_json TEXT NOT NULL DEFAULT '[]'",
            )
            .map_err(|e| format!("Failed to add activity_spans_json column: {}", e))?;
        }
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
    let select_activity_spans = if columns.contains_key("activity_spans_json") {
        "COALESCE(activity_spans_json, '[]')"
    } else {
        "'[]'"
    };
    let migration_sql = format!(
        "BEGIN TRANSACTION;
         CREATE TABLE daily_files_new (
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
             activity_spans_json TEXT NOT NULL DEFAULT '[]',
             PRIMARY KEY (date, exe_name, file_name, detected_path),
             FOREIGN KEY (date, exe_name) REFERENCES daily_apps(date, exe_name) ON DELETE CASCADE
         );
         INSERT INTO daily_files_new (
             date, exe_name, file_name, ordinal, total_seconds, first_seen, last_seen,
             window_title, detected_path, title_history_json, activity_type, activity_spans_json
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
             {select_activity_type},
             {select_activity_spans}
         FROM daily_files;
         DROP TABLE daily_files;
         ALTER TABLE daily_files_new RENAME TO daily_files;
         CREATE INDEX IF NOT EXISTS idx_daily_files_date_exe
             ON daily_files(date, exe_name, ordinal);
         COMMIT;"
    );
    conn.execute_batch(&migration_sql)
        .map_err(|e| format!("Failed to migrate daily_files schema: {}", e))?;

    // Check if activity_spans_json column exists (for DBs that passed the needs_migration check
    // but were created before this column was added).
    let has_activity_spans: bool = conn
        .prepare_cached(
            "SELECT COUNT(*) FROM pragma_table_info('daily_files') WHERE name='activity_spans_json'",
        )
        .map_err(|e| format!("Failed to check activity_spans_json column: {}", e))?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .map_err(|e| format!("Failed to query activity_spans_json column: {}", e))?;
    if !has_activity_spans {
        conn.execute_batch(
            "ALTER TABLE daily_files ADD COLUMN activity_spans_json TEXT NOT NULL DEFAULT '[]'",
        )
        .map_err(|e| format!("Failed to add activity_spans_json column: {}", e))?;
    }
    Ok(())
}
