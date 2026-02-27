use serde::{Serialize, Deserialize};
use std::fs;
use std::path::Path;
use tauri::AppHandle;
use crate::db;
use chrono::{DateTime, Local};

#[derive(Serialize)]
pub struct BackupFile {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub modified_at: String,
}

#[derive(Serialize)]
pub struct DbInfo {
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Serialize, Deserialize)]
pub struct DatabaseSettings {
    pub vacuum_on_startup: bool,
    pub backup_enabled: bool,
    pub backup_path: String,
    pub backup_interval_days: i32,
    pub last_backup_at: Option<String>,
    pub auto_optimize_enabled: bool,
    pub auto_optimize_interval_hours: i32,
    pub last_optimize_at: Option<String>,
}

#[tauri::command]
pub async fn get_db_info(app: AppHandle) -> Result<DbInfo, String> {
    let status = db::get_demo_mode_status(&app)?;
    let path = status.active_db_path;
    let meta = fs::metadata(&path).map_err(|e| format!("Failed to read DB metadata: {}", e))?;
    
    Ok(DbInfo {
        path,
        size_bytes: meta.len(),
    })
}

#[tauri::command]
pub async fn vacuum_database(app: AppHandle) -> Result<(), String> {
    let conn = db::get_connection(&app)?;
    conn.execute_batch("VACUUM;")
        .map_err(|e| format!("VACUUM failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn get_database_settings(app: AppHandle) -> Result<DatabaseSettings, String> {
    let vacuum_on_startup = db::get_system_setting(&app, "vacuum_on_startup")?
        .map(|v| v == "true")
        .unwrap_or(false);
    
    let backup_enabled = db::get_system_setting(&app, "backup_enabled")?
        .map(|v| v == "true")
        .unwrap_or(false);
    
    let backup_path = db::get_system_setting(&app, "backup_path")?
        .unwrap_or_default();
    
    let backup_interval_days = db::get_system_setting(&app, "backup_interval_days")?
        .and_then(|v| v.parse().ok())
        .unwrap_or(7);
        
    let last_backup_at = db::get_system_setting(&app, "last_backup_at")?;

    let auto_optimize_enabled = db::get_system_setting(&app, "auto_optimize_enabled")?
        .map(|v| v == "true")
        .unwrap_or(true);

    let auto_optimize_interval_hours = db::get_system_setting(&app, "auto_optimize_interval_hours")?
        .and_then(|v| v.parse().ok())
        .unwrap_or(24);

    let last_optimize_at = db::get_system_setting(&app, "last_optimize_at")?;

    log::info!("Loaded database settings: vacuum={}, backup={}, backup_interval_days={}, auto_optimize={}, auto_optimize_interval_hours={}",
        vacuum_on_startup, backup_enabled, backup_interval_days, auto_optimize_enabled, auto_optimize_interval_hours);
        
    Ok(DatabaseSettings {
        vacuum_on_startup,
        backup_enabled,
        backup_path,
        backup_interval_days,
        last_backup_at,
        auto_optimize_enabled,
        auto_optimize_interval_hours,
        last_optimize_at,
    })
}

#[tauri::command]
pub async fn update_database_settings(
    app: AppHandle,
    vacuum_on_startup: bool,
    backup_enabled: bool,
    backup_path: String,
    backup_interval_days: i32,
    auto_optimize_enabled: bool,
    auto_optimize_interval_hours: i32,
) -> Result<(), String> {
    let normalized_auto_optimize_interval_hours = auto_optimize_interval_hours.clamp(1, 24 * 30);
    log::info!("Updating database settings: vacuum={}, backup={}, backup_interval_days={}, auto_optimize={}, auto_optimize_interval_hours={}",
        vacuum_on_startup, backup_enabled, backup_interval_days, auto_optimize_enabled, normalized_auto_optimize_interval_hours);
    
    db::set_system_setting(&app, "vacuum_on_startup", &vacuum_on_startup.to_string())?;
    db::set_system_setting(&app, "backup_enabled", &backup_enabled.to_string())?;
    db::set_system_setting(&app, "backup_path", &backup_path)?;
    db::set_system_setting(&app, "backup_interval_days", &backup_interval_days.to_string())?;
    db::set_system_setting(&app, "auto_optimize_enabled", &auto_optimize_enabled.to_string())?;
    db::set_system_setting(
        &app,
        "auto_optimize_interval_hours",
        &normalized_auto_optimize_interval_hours.to_string(),
    )?;
    Ok(())
}

#[tauri::command]
pub async fn optimize_database(app: AppHandle) -> Result<(), String> {
    let conn = db::get_connection(&app)?;
    db::optimize_database_internal(&conn)
}

#[tauri::command]
pub async fn perform_manual_backup(app: AppHandle) -> Result<String, String> {
    let settings = get_database_settings(app.clone()).await?;
    if settings.backup_path.is_empty() {
        return Err("Backup path is not configured".to_string());
    }
    
    let conn = db::get_connection(&app)?;
    let result = db::perform_backup_internal(&conn, &settings.backup_path)?;
    
    let now = chrono::Local::now().to_rfc3339();
    db::set_system_setting(&app, "last_backup_at", &now)?;
    
    Ok(result)
}

#[tauri::command]
pub async fn open_db_folder(app: AppHandle) -> Result<(), String> {
    let status = db::get_demo_mode_status(&app)?;
    let path = Path::new(&status.active_db_path);
    let folder = path.parent().ok_or("Invalid DB path")?;
    
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("explorer")
            .arg(folder)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
pub async fn restore_database_from_file(app: AppHandle, path: String) -> Result<(), String> {
    let src = Path::new(&path);
    if !src.exists() {
        return Err("Source file does not exist".to_string());
    }
    
    let status = db::get_demo_mode_status(&app)?;
    let dest = Path::new(&status.active_db_path);
    
    // We can't easily hot-swap the DB because connections are open.
    // The safest way is to copy it over while ensuring no write operations are happening, 
    // but Rusqlite connections in the app might still be active.
    
    // For now, let's copy it and inform the user that a restart is recommended.
    // Actually, in Tauri we can't easily move the file if it's locked by SQLite.
    
    // Alternative: VACUUM INTO is for export. For import, we might need to close all connections.
    // Since this is a local app, we can just overwrite the file if we can.
    
    // Better: Tell the user to close the app, or try to force it.
    // Realistically, we can use `std::fs::copy` and it might fail if locked.
    
    fs::copy(src, dest).map_err(|e| format!("Failed to restore database file. Close the app and try again if it's locked. Error: {}", e))?;
    
    Ok(())
}
#[tauri::command]
pub async fn get_backup_files(app: AppHandle) -> Result<Vec<BackupFile>, String> {
    let backup_path_str = db::get_system_setting(&app, "backup_path")?
        .unwrap_or_default();
    
    if backup_path_str.is_empty() {
        return Ok(vec![]);
    }
    
    let backup_path = Path::new(&backup_path_str);
    if !backup_path.exists() || !backup_path.is_dir() {
        return Ok(vec![]);
    }
    
    let mut files = vec![];
    if let Ok(entries) = fs::read_dir(backup_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("db") {
                if let Ok(meta) = entry.metadata() {
                    if let Ok(modified) = meta.modified() {
                        let dt: DateTime<Local> = modified.into();
                        files.push(BackupFile {
                            name: entry.file_name().to_string_lossy().to_string(),
                            path: path.to_string_lossy().to_string(),
                            size_bytes: meta.len(),
                            modified_at: dt.to_rfc3339(),
                        });
                    }
                }
            }
        }
    }
    
    files.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(files)
}
