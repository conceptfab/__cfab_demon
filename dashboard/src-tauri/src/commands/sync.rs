use super::export::export_data_archive;
use super::import_data::import_data;
use super::helpers::timeflow_data_dir;
use crate::db;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

#[tauri::command]
pub async fn perform_automatic_sync(app: AppHandle) -> Result<String, String> {
    let sync_dir = db::get_system_setting(&app, "sync_dir")?
        .filter(|s| !s.is_empty());
    
    let sync_dir_path = match sync_dir {
        Some(path) => PathBuf::from(path),
        None => return Ok("No sync directory configured".to_string()),
    };

    if !sync_dir_path.exists() {
        return Err(format!("Sync directory does not exist: {}", sync_dir_path.display()));
    }

    let machine_id = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string());
    let mut log_lines = Vec::new();
    log_lines.push(format!("Starting automatic sync for machine: {}", machine_id));

    // 1. Export local state to sync folder
    let archive = export_data_archive(app.clone(), None, None, None).await?;
    let sync_file_path = sync_dir_path.join(format!("sync_{}.json", machine_id));
    let json = serde_json::to_string_pretty(&archive).map_err(|e| e.to_string())?;
    fs::write(&sync_file_path, json).map_err(|e| format!("Failed to write sync file: {}", e))?;
    log_lines.push(format!("Exported local state to {}", sync_file_path.display()));

    // 2. Sync daily JSON files (archive -> sync_dir/daily)
    let base_dir = timeflow_data_dir()?;
    let demo_mode = db::is_demo_mode_enabled(&app)?;
    let archive_dir = if demo_mode { base_dir.join("archive_demo") } else { base_dir.join("archive") };
    let cloud_daily_dir = sync_dir_path.join("daily");
    
    if !cloud_daily_dir.exists() {
        fs::create_dir_all(&cloud_daily_dir).ok();
    }

    if archive_dir.exists() {
        for entry in fs::read_dir(&archive_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_file() && path.extension().map(|s| s == "json").unwrap_or(false) {
                if let Some(name) = path.file_name() {
                    let dest = cloud_daily_dir.join(name);
                    if !dest.exists() {
                        fs::copy(&path, &dest).ok();
                    }
                }
            }
        }
    }

    // 3. Import from other machines
    for entry in fs::read_dir(&sync_dir_path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let file_name = path.file_name().unwrap_or_default().to_string_lossy();
        
        if path.is_file() && file_name.starts_with("sync_") && file_name.ends_with(".json") {
            if file_name != format!("sync_{}.json", machine_id) {
                log_lines.push(format!("Importing changes from {}", file_name));
                match import_data(app.clone(), path.to_string_lossy().to_string()).await {
                    Ok(summary) => {
                        log_lines.push(format!("  Imported: {} projects, {} apps, {} sessions", 
                            summary.projects_created, summary.apps_created, summary.sessions_imported + summary.sessions_merged));
                    },
                    Err(e) => {
                        log_lines.push(format!("  Error importing {}: {}", file_name, e));
                    }
                }
            }
        }
    }

    // 4. Download daily JSONs from cloud to local import folder
    let import_dir = if demo_mode { base_dir.join("import_demo") } else { base_dir.join("import") };
    if !import_dir.exists() {
        fs::create_dir_all(&import_dir).ok();
    }

    if cloud_daily_dir.exists() {
        for entry in fs::read_dir(&cloud_daily_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_file() && path.extension().map(|s| s == "json").unwrap_or(false) {
                if let Some(name) = path.file_name() {
                    let dest = import_dir.join(name);
                    let local_archive = archive_dir.join(name);
                    // Only copy if it doesn't exist in either import or archive folder
                    if !dest.exists() && !local_archive.exists() {
                        fs::copy(&path, &dest).ok();
                        log_lines.push(format!("Downloaded daily file: {}", name.to_string_lossy()));
                    }
                }
            }
        }
    }

    // Log the sync process
    let _ = super::sync_log::append_sync_log(log_lines).await;

    Ok("Sync completed successfully".to_string())
}
