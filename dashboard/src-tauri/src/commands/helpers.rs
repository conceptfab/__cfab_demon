use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use tauri::AppHandle;
use timeflow_shared::timeflow_paths;

use crate::db;

pub(crate) static LAST_PRUNE_EPOCH_SECS: AtomicU64 = AtomicU64::new(0);
pub(crate) const PRUNE_CACHE_TTL_SECS: u64 = 300; // 5 minutes

#[cfg(windows)]
pub(crate) const DAEMON_EXE_NAME: &str = "timeflow-demon.exe";
#[cfg(not(windows))]
pub(crate) const DAEMON_EXE_NAME: &str = "timeflow-demon";

/// Nazwa skrótu autostartu. Na Windows to plik .lnk w Startup folderze; na
/// macOS autostart realizowany jest przez plist w ~/Library/LaunchAgents
/// (patrz `commands::daemon::control::set_autostart_enabled`).
#[cfg(windows)]
pub(crate) const DAEMON_AUTOSTART_LNK: &str = "TimeFlow Demon.lnk";
#[cfg(not(windows))]
pub(crate) const DAEMON_AUTOSTART_LNK: &str = "com.kleniewski.timeflow-demon.plist";

pub(crate) use timeflow_shared::process_utils::no_console;

/// Validates that a file path is safe (no path traversal components).
/// Returns an error string if the path is unsafe.
pub(crate) fn validate_import_path(path: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);

    // Reject paths containing ".." components
    for component in p.components() {
        if let std::path::Component::ParentDir = component {
            return Err(format!(
                "Path traversal detected in '{}': '..' components are not allowed",
                path
            ));
        }
    }

    // Must be an absolute path (user-selected via dialog) or a simple filename
    if !p.is_absolute() && p.components().count() > 1 {
        // Relative multi-segment paths are suspicious when not from a dialog
        log::warn!("Import path '{}' is relative with multiple segments", path);
    }

    Ok(())
}

pub(crate) fn name_hash(name: &str) -> u32 {
    name.bytes().fold(0u32, |acc, byte| {
        acc.wrapping_mul(31).wrapping_add(byte as u32)
    })
}

pub(crate) fn duplicate_name_counts<'a, I>(names: I) -> HashMap<String, usize>
where
    I: IntoIterator<Item = &'a str>,
{
    let mut counts = HashMap::new();
    for name in names {
        *counts.entry(name.to_lowercase()).or_insert(0) += 1;
    }
    counts
}

pub(crate) fn disambiguate_name(
    name: &str,
    entity_id: i64,
    duplicate_counts: &HashMap<String, usize>,
) -> String {
    if duplicate_counts
        .get(&name.to_lowercase())
        .copied()
        .unwrap_or(0)
        > 1
    {
        format!("{name} · #{entity_id}")
    } else {
        name.to_string()
    }
}

pub(crate) fn compute_table_hash(conn: &rusqlite::Connection, table: &str) -> String {
    // Kanoniczne tabele synchronizowane: SQL żyje w shared (finding #3).
    let sql: String = if let Some(s) = timeflow_shared::sync::checksum::table_hash_sql(table) {
        s.to_string()
    } else {
        // Tabele lokalne (diagnostyczne, NIE synchronizowane) — SQL zostaje tutaj.
        match table {
            "assignment_feedback" => "SELECT COALESCE(group_concat(source || '|' || created_at, ';'), '') \
                 FROM (SELECT source, created_at FROM assignment_feedback ORDER BY created_at)".to_string(),
            "assignment_auto_runs" => "SELECT COALESCE(group_concat(started_at || '|' || COALESCE(finished_at, ''), ';'), '') \
                 FROM (SELECT started_at, finished_at FROM assignment_auto_runs ORDER BY started_at)".to_string(),
            _ => {
                log::warn!("compute_table_hash: unknown table '{}'", table);
                return String::new();
            }
        }
    };
    let concat: String = conn
        .query_row(&sql, [], |row| row.get(0))
        .unwrap_or_else(|_| String::new());
    // Diagnostyka: rzędy istnieją, ale hash pusty → możliwy bug (np. brak kolumny).
    // `table` jest tu jedną z 7 znanych, bezpiecznych nazw (gałąź `_` już zwróciła).
    let row_count = conn
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap_or(0);
    if row_count > 0 && concat.is_empty() {
        log::warn!(
            "compute_table_hash: table '{}' has {} row(s) but produced an empty hash input",
            table,
            row_count
        );
    }
    timeflow_shared::sync::checksum::content_hash(&concat)
}

pub(crate) fn build_table_hashes(conn: &rusqlite::Connection) -> super::delta_export::TableHashes {
    super::delta_export::TableHashes {
        projects: compute_table_hash(conn, "projects"),
        clients: compute_table_hash(conn, "clients"),
        applications: compute_table_hash(conn, "applications"),
        sessions: compute_table_hash(conn, "sessions"),
        manual_sessions: compute_table_hash(conn, "manual_sessions"),
        assignment_feedback: compute_table_hash(conn, "assignment_feedback"),
        assignment_auto_runs: compute_table_hash(conn, "assignment_auto_runs"),
    }
}

pub fn get_machine_id() -> String {
    #[cfg(windows)]
    {
        std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string())
    }
    #[cfg(not(windows))]
    {
        // hostname crate już jest w dependencyach (pulled in by tauri stack)
        hostname::get()
            .ok()
            .and_then(|s| s.into_string().ok())
            .unwrap_or_else(|| "unknown".to_string())
    }
}

pub fn timeflow_data_dir() -> Result<std::path::PathBuf, String> {
    timeflow_paths::timeflow_data_dir().map_err(|e| e.to_string())
}

/// Runs a blocking SQLite task against the currently active dashboard database.
///
/// This follows the app's active mode switch, so in demo mode it uses the demo
/// DB and otherwise the primary DB. Use this for regular TIMEFLOW data that the
/// UI should read/write inside the selected mode.
pub(crate) async fn run_db_blocking<T, F>(app: AppHandle, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut rusqlite::Connection) -> Result<T, String> + Send + 'static,
{
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = db::get_connection(&app)?;
        operation(&mut conn)
    })
    .await
    .map_err(|e| format!("Blocking DB task join error: {}", e))?
}

pub(crate) async fn run_app_blocking<T, F>(app: AppHandle, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(AppHandle) -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || operation(app))
        .await
        .map_err(|e| format!("Blocking app task join error: {}", e))?
}

/// Runs a blocking SQLite task against the primary dashboard database only.
///
/// This bypasses demo mode and is reserved for data that must stay shared
/// across modes, for example monitored app configuration persisted in the real
/// primary store.
pub(crate) async fn run_db_primary_blocking<T, F>(app: AppHandle, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut rusqlite::Connection) -> Result<T, String> + Send + 'static,
{
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = db::get_primary_connection(&app)?;
        operation(&mut conn)
    })
    .await
    .map_err(|e| format!("Blocking primary DB task join error: {}", e))?
}

/// Waliduje plik źródłowy restore: musi istnieć, być absolutny, bez '..',
/// z rozszerzeniem bazy danych. Zwraca skanonizowaną ścieżkę.
pub(crate) fn validate_restore_source(path: &str) -> Result<std::path::PathBuf, String> {
    let p = std::path::Path::new(path);
    if !p.is_absolute() {
        return Err("Restore path must be absolute".into());
    }
    for c in p.components() {
        if matches!(c, std::path::Component::ParentDir) {
            return Err("Restore path must not contain '..'".into());
        }
    }
    let ext_ok = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            matches!(
                e.to_ascii_lowercase().as_str(),
                "db" | "sqlite" | "sqlite3" | "bak"
            )
        })
        .unwrap_or(false);
    if !ext_ok {
        return Err("Restore file must be a .db/.sqlite/.bak database".into());
    }
    let canon = std::fs::canonicalize(p).map_err(|e| format!("Cannot resolve path: {e}"))?;
    Ok(canon)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restore_source_rejects_relative_and_traversal_and_nondb() {
        assert!(validate_restore_source("relative/x.db").is_err());
        assert!(validate_restore_source("/tmp/../etc/passwd").is_err());
        assert!(validate_restore_source("/etc/passwd").is_err()); // brak rozszerzenia db
    }

    #[test]
    fn projects_hash_matches_shared_algorithm() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, color TEXT, hourly_rate REAL,
                excluded_at TEXT, frozen_at TEXT, merged_into TEXT, client_name TEXT, status TEXT, updated_at TEXT);
             INSERT INTO projects (name,color,updated_at,status) VALUES ('Acme','#fff','2026-01-01 00:00:00','active');",
        ).unwrap();
        let h = compute_table_hash(&conn, "projects");
        assert_eq!(
            h.len(),
            32,
            "checksum musi być 32-znakowym hexem (shared content_hash)"
        );
    }

    #[test]
    fn clients_hash_detects_field_divergence_at_equal_updated_at() {
        let mk = |contact: &str| {
            let conn = rusqlite::Connection::open_in_memory().unwrap();
            conn.execute_batch(
                "CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT, contact TEXT, address TEXT,
                    tax_id TEXT, currency TEXT, default_hourly_rate REAL, color TEXT, archived_at TEXT,
                    created_at TEXT, updated_at TEXT);").unwrap();
            conn.execute(
                "INSERT INTO clients (name,contact,color,updated_at) VALUES ('Acme',?1,'#fff','2026-01-01 00:00:00')",
                [contact]).unwrap();
            compute_table_hash(&conn, "clients")
        };
        assert_ne!(
            mk("a@x.pl"),
            mk("b@x.pl"),
            "rozjazd pola contact przy równym updated_at MUSI zmienić hash (finding #3)"
        );
    }

    #[test]
    fn applications_hash_detects_display_name_divergence() {
        let mk = |display: &str| {
            let conn = rusqlite::Connection::open_in_memory().unwrap();
            conn.execute_batch(
                "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, updated_at TEXT);
                 CREATE TABLE applications (id INTEGER PRIMARY KEY, executable_name TEXT, display_name TEXT,
                    project_id INTEGER, color TEXT, is_imported INTEGER, updated_at TEXT);").unwrap();
            conn.execute(
                "INSERT INTO applications (executable_name,display_name,updated_at) VALUES ('foo.exe',?1,'2026-01-01 00:00:00')",
                [display]).unwrap();
            compute_table_hash(&conn, "applications")
        };
        assert_ne!(
            mk("Foo"),
            mk("Foobar"),
            "rozjazd display_name przy równym updated_at MUSI zmienić hash"
        );
    }

    #[test]
    fn sessions_hash_detects_comment_divergence() {
        let mk = |comment: &str| {
            let conn = rusqlite::Connection::open_in_memory().unwrap();
            conn.execute_batch(
                "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, updated_at TEXT);
                 CREATE TABLE applications (id INTEGER PRIMARY KEY, executable_name TEXT, display_name TEXT, project_id INTEGER, updated_at TEXT);
                 CREATE TABLE sessions (id INTEGER PRIMARY KEY, app_id INTEGER, start_time TEXT, end_time TEXT,
                    duration_seconds INTEGER, date TEXT, rate_multiplier REAL, split_source_session_id INTEGER,
                    project_id INTEGER, project_name TEXT, comment TEXT, is_hidden INTEGER, updated_at TEXT);").unwrap();
            conn.execute("INSERT INTO applications (id,executable_name,display_name,updated_at) VALUES (1,'foo.exe','Foo','2026-01-01 00:00:00')", []).unwrap();
            conn.execute(
                "INSERT INTO sessions (app_id,start_time,end_time,duration_seconds,date,rate_multiplier,comment,is_hidden,updated_at)
                 VALUES (1,'2026-01-01 09:00:00','2026-01-01 10:00:00',3600,'2026-01-01',1.0,?1,0,'2026-01-01 00:00:00')",
                [comment]).unwrap();
            compute_table_hash(&conn, "sessions")
        };
        assert_ne!(
            mk("first"),
            mk("second"),
            "rozjazd comment przy równym updated_at MUSI zmienić hash"
        );
    }

    #[test]
    fn manual_sessions_hash_detects_duration_divergence() {
        let mk = |dur: i64| {
            let conn = rusqlite::Connection::open_in_memory().unwrap();
            conn.execute_batch(
                "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, updated_at TEXT);
                 CREATE TABLE applications (id INTEGER PRIMARY KEY, executable_name TEXT, display_name TEXT, project_id INTEGER, updated_at TEXT);
                 CREATE TABLE manual_sessions (id INTEGER PRIMARY KEY, title TEXT, session_type TEXT, project_id INTEGER,
                    project_name TEXT, app_id INTEGER, start_time TEXT, end_time TEXT, duration_seconds INTEGER,
                    date TEXT, created_at TEXT, updated_at TEXT);").unwrap();
            conn.execute(
                "INSERT INTO manual_sessions (title,session_type,project_id,start_time,end_time,duration_seconds,date,updated_at)
                 VALUES ('Task','manual',0,'2026-01-01 09:00:00','2026-01-01 10:00:00',?1,'2026-01-01','2026-01-01 00:00:00')",
                [dur]).unwrap();
            compute_table_hash(&conn, "manual_sessions")
        };
        assert_ne!(
            mk(3600),
            mk(7200),
            "rozjazd duration_seconds przy równym updated_at MUSI zmienić hash"
        );
    }

    #[test]
    fn sessions_hash_stable_across_local_id_remap() {
        // Same logical session (same app exe-name + same project name + same data),
        // but different LOCAL ids on each "peer" → hash MUST match.
        let build = |base: i64| {
            let conn = rusqlite::Connection::open_in_memory().unwrap();
            conn.execute_batch(
                "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, updated_at TEXT);
                 CREATE TABLE applications (id INTEGER PRIMARY KEY, executable_name TEXT, display_name TEXT, project_id INTEGER, updated_at TEXT);
                 CREATE TABLE sessions (id INTEGER PRIMARY KEY, app_id INTEGER, start_time TEXT, end_time TEXT,
                    duration_seconds INTEGER, date TEXT, rate_multiplier REAL, project_id INTEGER, project_name TEXT,
                    comment TEXT, is_hidden INTEGER, updated_at TEXT);").unwrap();
            // explicit ids offset by `base` to simulate per-machine remap
            conn.execute("INSERT INTO projects (id,name,updated_at) VALUES (?1,'Acme','2026-01-01 00:00:00')", [base+1]).unwrap();
            conn.execute("INSERT INTO applications (id,executable_name,display_name,project_id,updated_at) VALUES (?1,'foo.exe','Foo',?2,'2026-01-01 00:00:00')", [base+5, base+1]).unwrap();
            conn.execute(
                "INSERT INTO sessions (id,app_id,start_time,end_time,duration_seconds,date,rate_multiplier,project_id,comment,is_hidden,updated_at)
                 VALUES (?1,?2,'2026-01-01 09:00:00','2026-01-01 10:00:00',3600,'2026-01-01',1.0,?3,'note',0,'2026-01-01 00:00:00')",
                [base+9, base+5, base+1]).unwrap();
            compute_table_hash(&conn, "sessions")
        };
        assert_eq!(
            build(100),
            build(200),
            "hash MUSI być niezależny od lokalnych autoincrement id (FK rozwiązywane przez nazwę)"
        );
    }

    #[test]
    fn manual_sessions_hash_stable_across_local_id_remap() {
        let build = |base: i64| {
            let conn = rusqlite::Connection::open_in_memory().unwrap();
            conn.execute_batch(
                "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, updated_at TEXT);
                 CREATE TABLE applications (id INTEGER PRIMARY KEY, executable_name TEXT, display_name TEXT, project_id INTEGER, updated_at TEXT);
                 CREATE TABLE manual_sessions (id INTEGER PRIMARY KEY, title TEXT, session_type TEXT, project_id INTEGER,
                    project_name TEXT, app_id INTEGER, start_time TEXT, end_time TEXT, duration_seconds INTEGER, date TEXT, created_at TEXT, updated_at TEXT);").unwrap();
            conn.execute("INSERT INTO projects (id,name,updated_at) VALUES (?1,'Acme','2026-01-01 00:00:00')", [base+1]).unwrap();
            conn.execute("INSERT INTO applications (id,executable_name,display_name,updated_at) VALUES (?1,'foo.exe','Foo','2026-01-01 00:00:00')", [base+5]).unwrap();
            conn.execute(
                "INSERT INTO manual_sessions (id,title,session_type,project_id,app_id,start_time,end_time,duration_seconds,date,updated_at)
                 VALUES (?1,'Task','manual',?2,?3,'2026-01-01 09:00:00','2026-01-01 10:00:00',3600,'2026-01-01','2026-01-01 00:00:00')",
                [base+9, base+1, base+5]).unwrap();
            compute_table_hash(&conn, "manual_sessions")
        };
        assert_eq!(build(100), build(200),
            "hash MUSI być niezależny od lokalnych autoincrement id (project/app rozwiązywane przez nazwę)");
    }
}
