use super::helpers::timeflow_data_dir;
use super::types::{MonitoredApp, MonitoredConfig};
use crate::db;
use rusqlite::params;
use std::collections::HashSet;
use tauri::AppHandle;

const MONITORED_APPS_TABLE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS monitored_apps (
    exe_name TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    added_at TEXT NOT NULL
)
"#;

fn monitored_apps_path() -> Result<std::path::PathBuf, String> {
    let dir = timeflow_data_dir()?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir.join("monitored_apps.json"))
}

fn load_legacy_monitored_config() -> Result<MonitoredConfig, String> {
    let path = monitored_apps_path()?;
    if !path.exists() {
        return Ok(MonitoredConfig::default());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut cfg: MonitoredConfig = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    // Normalize legacy entries for case-insensitive matching/removal.
    for app in &mut cfg.apps {
        app.exe_name = app.exe_name.trim().to_lowercase();
    }
    Ok(cfg)
}

fn ensure_monitored_apps_table(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(MONITORED_APPS_TABLE_SQL)
        .map_err(|e| e.to_string())
}

fn migrate_legacy_json_to_db_if_needed(conn: &rusqlite::Connection) -> Result<(), String> {
    let existing_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM monitored_apps", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if existing_count > 0 {
        return Ok(());
    }

    let legacy = load_legacy_monitored_config()?;
    if legacy.apps.is_empty() {
        return Ok(());
    }

    let mut inserted = 0usize;
    for app in legacy.apps {
        let exe = app.exe_name.trim().to_lowercase();
        if exe.is_empty() {
            continue;
        }
        let display = if app.display_name.trim().is_empty() {
            exe.clone()
        } else {
            app.display_name.trim().to_string()
        };
        let added_at = if app.added_at.trim().is_empty() {
            chrono::Local::now().to_rfc3339()
        } else {
            app.added_at
        };
        conn.execute(
            "INSERT OR IGNORE INTO monitored_apps (exe_name, display_name, added_at) VALUES (?1, ?2, ?3)",
            params![exe, display, added_at],
        )
        .map_err(|e| e.to_string())?;
        inserted += 1;
    }

    if inserted > 0 {
        log::info!("Migrated {} monitored apps from monitored_apps.json to SQLite", inserted);
    }

    Ok(())
}

fn ensure_monitored_apps_ready(conn: &rusqlite::Connection) -> Result<(), String> {
    ensure_monitored_apps_table(conn)?;
    migrate_legacy_json_to_db_if_needed(conn)?;
    Ok(())
}

fn load_monitored_apps_from_conn(conn: &rusqlite::Connection) -> Result<Vec<MonitoredApp>, String> {
    ensure_monitored_apps_ready(conn)?;
    let mut stmt = conn
        .prepare(
            "SELECT exe_name, display_name, added_at
             FROM monitored_apps
             ORDER BY display_name COLLATE NOCASE, exe_name COLLATE NOCASE",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(MonitoredApp {
                exe_name: row.get(0)?,
                display_name: row.get(1)?,
                added_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut apps = Vec::new();
    for row in rows {
        apps.push(row.map_err(|e| e.to_string())?);
    }
    Ok(apps)
}

pub(crate) fn monitored_exe_name_set(conn: &rusqlite::Connection) -> Result<HashSet<String>, String> {
    Ok(load_monitored_apps_from_conn(conn)?
        .into_iter()
        .map(|a| a.exe_name.trim().to_lowercase())
        .filter(|n| !n.is_empty())
        .collect())
}

#[tauri::command]
pub async fn get_monitored_apps(app: AppHandle) -> Result<Vec<MonitoredApp>, String> {
    let conn = db::get_connection(&app)?;
    load_monitored_apps_from_conn(&conn)
}

#[tauri::command]
pub async fn add_monitored_app(
    app: AppHandle,
    exe_name: String,
    display_name: String,
) -> Result<(), String> {
    let conn = db::get_connection(&app)?;
    ensure_monitored_apps_ready(&conn)?;
    let exe = exe_name.trim().to_lowercase();
    if exe.is_empty() {
        return Err("exe_name cannot be empty".to_string());
    }
    let display = if display_name.trim().is_empty() {
        exe.clone()
    } else {
        display_name.trim().to_string()
    };
    let added_at = chrono::Local::now().to_rfc3339();
    let inserted = conn
        .execute(
            "INSERT OR IGNORE INTO monitored_apps (exe_name, display_name, added_at) VALUES (?1, ?2, ?3)",
            params![exe, display, added_at],
        )
        .map_err(|e| e.to_string())?;
    if inserted == 0 {
        return Err(format!("{} is already monitored", exe_name.trim().to_lowercase()));
    }
    Ok(())
}

#[tauri::command]
pub async fn remove_monitored_app(app: AppHandle, exe_name: String) -> Result<(), String> {
    let conn = db::get_connection(&app)?;
    ensure_monitored_apps_ready(&conn)?;
    let exe = exe_name.trim().to_lowercase();
    if exe.is_empty() {
        return Err("exe_name cannot be empty".to_string());
    }
    conn.execute("DELETE FROM monitored_apps WHERE exe_name = ?1", [exe])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn rename_monitored_app(
    app: AppHandle,
    exe_name: String,
    display_name: String,
) -> Result<(), String> {
    let conn = db::get_connection(&app)?;
    ensure_monitored_apps_ready(&conn)?;
    let exe = exe_name.trim().to_lowercase();
    let new_name = display_name.trim();
    if exe.is_empty() {
        return Err("exe_name cannot be empty".to_string());
    }
    if new_name.is_empty() {
        return Err("display_name cannot be empty".to_string());
    }
    let updated = conn
        .execute(
            "UPDATE monitored_apps SET display_name = ?1 WHERE exe_name = ?2",
            params![new_name, exe],
        )
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        return Err("Monitored app not found".to_string());
    }
    Ok(())
}

