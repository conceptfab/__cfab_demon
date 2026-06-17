use super::helpers::{run_db_primary_blocking, timeflow_data_dir};
use super::types::{MonitoredApp, MonitoredConfig};
use rusqlite::params;
use serde::Serialize;
use std::collections::HashSet;
use tauri::AppHandle;

const MONITORED_APPS_TABLE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS monitored_apps (
    exe_name TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    added_at TEXT NOT NULL
)
"#;
const MONITORED_ERR_EXE_NAME_EMPTY: &str = "monitored.exe_name_empty";
const MONITORED_ERR_DISPLAY_NAME_EMPTY: &str = "monitored.display_name_empty";
const MONITORED_ERR_NOT_FOUND: &str = "monitored.not_found";
const MONITORED_ERR_ALREADY_MONITORED_PREFIX: &str = "monitored.already_monitored:";

fn monitored_already_monitored_error(exe_name: &str) -> String {
    format!("{MONITORED_ERR_ALREADY_MONITORED_PREFIX}{exe_name}")
}

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

fn monitored_apps_columns(
    conn: &rusqlite::Connection,
) -> Result<std::collections::HashSet<String>, String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(monitored_apps)")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

/// Dokłada kolumny bundle_id/app_path (macOS precision matching). Idempotentne.
fn migrate_monitored_apps_schema(conn: &rusqlite::Connection) -> Result<(), String> {
    let cols = monitored_apps_columns(conn)?;
    if !cols.contains("bundle_id") {
        conn.execute("ALTER TABLE monitored_apps ADD COLUMN bundle_id TEXT", [])
            .map_err(|e| e.to_string())?;
    }
    if !cols.contains("app_path") {
        conn.execute("ALTER TABLE monitored_apps ADD COLUMN app_path TEXT", [])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
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
        log::info!(
            "Migrated {} monitored apps from monitored_apps.json to SQLite",
            inserted
        );
    }

    Ok(())
}

fn ensure_monitored_apps_ready(conn: &rusqlite::Connection) -> Result<(), String> {
    ensure_monitored_apps_table(conn)?;
    migrate_monitored_apps_schema(conn)?;
    migrate_legacy_json_to_db_if_needed(conn)?;
    Ok(())
}

fn load_monitored_apps_from_conn(conn: &rusqlite::Connection) -> Result<Vec<MonitoredApp>, String> {
    ensure_monitored_apps_ready(conn)?;
    let mut stmt = conn
        .prepare(
            "SELECT exe_name, display_name, added_at, bundle_id, app_path
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
                bundle_id: row.get(3)?,
                app_path: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut apps = Vec::new();
    for row in rows {
        apps.push(row.map_err(|e| e.to_string())?);
    }
    Ok(apps)
}

pub(crate) fn monitored_exe_name_set(
    conn: &rusqlite::Connection,
) -> Result<HashSet<String>, String> {
    Ok(load_monitored_apps_from_conn(conn)?
        .into_iter()
        .map(|a| a.exe_name.trim().to_lowercase())
        .filter(|n| !n.is_empty())
        .collect())
}

#[derive(Serialize)]
pub struct MonitoredAppsSyncResult {
    pub scanned: usize,
    pub added: usize,
    pub already_monitored: usize,
}

#[tauri::command]
pub async fn get_monitored_apps(app: AppHandle) -> Result<Vec<MonitoredApp>, String> {
    run_db_primary_blocking(app, move |conn| load_monitored_apps_from_conn(conn)).await
}

#[tauri::command]
pub async fn add_monitored_app(
    app: AppHandle,
    exe_name: String,
    display_name: String,
    bundle_id: Option<String>,
    app_path: Option<String>,
) -> Result<(), String> {
    run_db_primary_blocking(app, move |conn| {
        ensure_monitored_apps_ready(conn)?;
        let exe = exe_name.trim().to_lowercase();
        if exe.is_empty() {
            return Err(MONITORED_ERR_EXE_NAME_EMPTY.to_string());
        }
        let display = if display_name.trim().is_empty() {
            exe.clone()
        } else {
            display_name.trim().to_string()
        };
        let bundle = bundle_id
            .map(|b| b.trim().to_lowercase())
            .filter(|b| !b.is_empty());
        let path = app_path
            .map(|p| p.trim().to_lowercase())
            .filter(|p| !p.is_empty());
        let added_at = chrono::Local::now().to_rfc3339();
        let inserted = conn
            .execute(
                "INSERT OR IGNORE INTO monitored_apps (exe_name, display_name, added_at, bundle_id, app_path)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![exe, display, added_at, bundle, path],
            )
            .map_err(|e| e.to_string())?;
        if inserted == 0 {
            // Wpis istnieje: jeśli drop niesie metadane precyzyjne — uzupełnij je (upgrade legacy).
            if bundle.is_some() || path.is_some() {
                conn.execute(
                    "UPDATE monitored_apps SET bundle_id = COALESCE(?1, bundle_id),
                                               app_path = COALESCE(?2, app_path)
                     WHERE exe_name = ?3",
                    params![bundle, path, exe],
                )
                .map_err(|e| e.to_string())?;
                return Ok(());
            }
            return Err(monitored_already_monitored_error(&exe));
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn remove_monitored_app(app: AppHandle, exe_name: String) -> Result<(), String> {
    run_db_primary_blocking(app, move |conn| {
        ensure_monitored_apps_ready(conn)?;
        let exe = exe_name.trim().to_lowercase();
        if exe.is_empty() {
            return Err(MONITORED_ERR_EXE_NAME_EMPTY.to_string());
        }
        conn.execute("DELETE FROM monitored_apps WHERE exe_name = ?1", [exe])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn rename_monitored_app(
    app: AppHandle,
    exe_name: String,
    display_name: String,
) -> Result<(), String> {
    run_db_primary_blocking(app, move |conn| {
        ensure_monitored_apps_ready(conn)?;
        let exe = exe_name.trim().to_lowercase();
        let new_name = display_name.trim();
        if exe.is_empty() {
            return Err(MONITORED_ERR_EXE_NAME_EMPTY.to_string());
        }
        if new_name.is_empty() {
            return Err(MONITORED_ERR_DISPLAY_NAME_EMPTY.to_string());
        }
        let updated = conn
            .execute(
                "UPDATE monitored_apps SET display_name = ?1 WHERE exe_name = ?2",
                params![new_name, exe],
            )
            .map_err(|e| e.to_string())?;
        if updated == 0 {
            return Err(MONITORED_ERR_NOT_FOUND.to_string());
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn sync_monitored_apps_from_applications(
    app: AppHandle,
) -> Result<MonitoredAppsSyncResult, String> {
    run_db_primary_blocking(app, move |conn| {
        ensure_monitored_apps_ready(conn)?;

        let app_rows: Vec<(String, String)> = {
            let mut stmt = conn
                .prepare(
                    "SELECT executable_name, display_name
                     FROM applications
                     WHERE trim(COALESCE(executable_name, '')) <> ''
                     ORDER BY display_name COLLATE NOCASE, executable_name COLLATE NOCASE",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Failed to read applications for monitored sync: {}", e))?
        };

        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let added_at = chrono::Local::now().to_rfc3339();
        let mut added = 0usize;

        for (exe_name, display_name) in &app_rows {
            let exe = exe_name.trim().to_lowercase();
            if exe.is_empty() {
                continue;
            }
            let display = if display_name.trim().is_empty() {
                exe.clone()
            } else {
                display_name.trim().to_string()
            };
            let inserted = tx
                .execute(
                    "INSERT OR IGNORE INTO monitored_apps (exe_name, display_name, added_at) VALUES (?1, ?2, ?3)",
                    params![exe, display, added_at],
                )
                .map_err(|e| e.to_string())?;
            if inserted > 0 {
                added += 1;
            }
        }

        tx.commit().map_err(|e| e.to_string())?;

        Ok(MonitoredAppsSyncResult {
            scanned: app_rows.len(),
            added,
            already_monitored: app_rows.len().saturating_sub(added),
        })
    })
    .await
}

// ── Drag & drop: inspekcja upuszczonego pliku aplikacji ──────────────────

const MONITORED_ERR_DROP_NOT_AN_APP: &str = "monitored.drop_not_an_app";
const MONITORED_ERR_DROP_SHORTCUT: &str = "monitored.drop_shortcut_unsupported";
const MONITORED_ERR_DROP_INVALID_BUNDLE_PREFIX: &str = "monitored.drop_invalid_bundle:";

#[derive(Debug, Serialize)]
pub struct DroppedAppInfo {
    pub exe_name: String,
    pub display_name: String,
    pub bundle_id: Option<String>,
    pub app_path: Option<String>,
}

#[tauri::command]
pub async fn inspect_dropped_app(path: String) -> Result<DroppedAppInfo, String> {
    inspect_dropped_app_path(std::path::Path::new(&path))
}

fn inspect_dropped_app_path(path: &std::path::Path) -> Result<DroppedAppInfo, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase)
        .unwrap_or_default();
    match ext.as_str() {
        "app" => inspect_app_bundle(path),
        "exe" => inspect_windows_exe(path),
        "lnk" => Err(MONITORED_ERR_DROP_SHORTCUT.to_string()),
        _ => Err(MONITORED_ERR_DROP_NOT_AN_APP.to_string()),
    }
}

/// macOS .app: exe_name = display name lowercase (zgodnie z localizedName w demonie),
/// bundle_id + app_path dają precyzyjne dopasowanie niezależne od nazwy.
fn inspect_app_bundle(path: &std::path::Path) -> Result<DroppedAppInfo, String> {
    let info_plist = path.join("Contents").join("Info.plist");
    if !info_plist.exists() {
        return Err(MONITORED_ERR_DROP_NOT_AN_APP.to_string());
    }
    let value = plist::Value::from_file(&info_plist)
        .map_err(|e| format!("{MONITORED_ERR_DROP_INVALID_BUNDLE_PREFIX}{e}"))?;
    let dict = value
        .as_dictionary()
        .ok_or_else(|| MONITORED_ERR_DROP_NOT_AN_APP.to_string())?;
    let get_str = |key: &str| {
        dict.get(key)
            .and_then(|v| v.as_string())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };

    let fallback_name = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let display_name = get_str("CFBundleDisplayName")
        .or_else(|| get_str("CFBundleName"))
        .unwrap_or(fallback_name);
    if display_name.is_empty() {
        return Err(MONITORED_ERR_DROP_NOT_AN_APP.to_string());
    }
    let bundle_id = get_str("CFBundleIdentifier").map(|s| s.to_lowercase());

    Ok(DroppedAppInfo {
        exe_name: display_name.to_lowercase(),
        display_name,
        bundle_id,
        app_path: Some(path.to_string_lossy().to_lowercase()),
    })
}

/// Windows .exe: klucz = basename lowercase (dokładnie to, co widzi demon).
/// Tnie po '\\' i '/' ręcznie — ścieżki windowsowe muszą parsować się też w testach na Unix.
fn inspect_windows_exe(path: &std::path::Path) -> Result<DroppedAppInfo, String> {
    let raw = path.to_string_lossy();
    let file_name = raw
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or_default()
        .trim()
        .to_string();
    if file_name.is_empty() {
        return Err(MONITORED_ERR_DROP_NOT_AN_APP.to_string());
    }
    let display = file_name
        .strip_suffix(".exe")
        .or_else(|| file_name.strip_suffix(".EXE"))
        .unwrap_or(&file_name)
        .to_string();
    Ok(DroppedAppInfo {
        exe_name: file_name.to_lowercase(),
        display_name: display,
        bundle_id: None,
        app_path: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn legacy_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE monitored_apps (
                exe_name TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                added_at TEXT NOT NULL
            );
            INSERT INTO monitored_apps VALUES ('antigravity ide', 'Antigravity', '2026-01-01');",
        )
        .unwrap();
        conn
    }

    #[test]
    fn migrate_adds_columns_and_preserves_rows() {
        let conn = legacy_conn();
        ensure_monitored_apps_table(&conn).unwrap();
        migrate_monitored_apps_schema(&conn).unwrap();
        // idempotencja
        migrate_monitored_apps_schema(&conn).unwrap();

        let apps = load_monitored_apps_from_conn(&conn).unwrap();
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].exe_name, "antigravity ide");
        assert_eq!(apps[0].bundle_id, None);
        assert_eq!(apps[0].app_path, None);
    }

    #[test]
    fn inspect_app_bundle_reads_plist_metadata() {
        let dir = std::env::temp_dir().join(format!(
            "tf_drop_test_{}",
            std::process::id()
        ));
        let app_dir = dir.join("Antigravity IDE.app");
        let contents = app_dir.join("Contents");
        std::fs::create_dir_all(&contents).unwrap();
        std::fs::write(
            contents.join("Info.plist"),
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleDisplayName</key><string>Antigravity IDE</string>
<key>CFBundleIdentifier</key><string>com.google.Antigravity-IDE</string>
<key>CFBundleExecutable</key><string>Electron</string>
</dict></plist>"#,
        )
        .unwrap();

        let info = inspect_dropped_app_path(&app_dir).unwrap();
        assert_eq!(info.exe_name, "antigravity ide");
        assert_eq!(info.display_name, "Antigravity IDE");
        assert_eq!(info.bundle_id.as_deref(), Some("com.google.antigravity-ide"));
        assert_eq!(
            info.app_path.as_deref(),
            Some(app_dir.to_string_lossy().to_lowercase().as_str())
        );

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn inspect_windows_exe_uses_basename() {
        let info =
            inspect_dropped_app_path(std::path::Path::new(r"C:\Tools\Antigravity\Antigravity.exe"))
                .unwrap();
        assert_eq!(info.exe_name, "antigravity.exe");
        assert_eq!(info.display_name, "Antigravity");
        assert_eq!(info.bundle_id, None);
        assert_eq!(info.app_path, None);
    }

    #[test]
    fn inspect_rejects_lnk_and_unknown() {
        let lnk = inspect_dropped_app_path(std::path::Path::new(r"C:\u\app.lnk"));
        assert_eq!(lnk.unwrap_err(), "monitored.drop_shortcut_unsupported");
        let txt = inspect_dropped_app_path(std::path::Path::new("/tmp/readme.txt"));
        assert_eq!(txt.unwrap_err(), "monitored.drop_not_an_app");
    }
}
