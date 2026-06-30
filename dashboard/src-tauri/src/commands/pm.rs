use super::pm_manager;
use crate::commands::error::CommandError;
use super::helpers::{timeflow_data_dir, run_db_blocking};
use super::projects::load_project_folders_from_db;
use tauri::AppHandle;

fn pm_config_path() -> Result<std::path::PathBuf, String> {
    let data_dir = timeflow_data_dir()?;
    Ok(data_dir.join("pm_work_folder.txt"))
}

fn load_work_folder() -> Result<String, String> {
    let path = pm_config_path()?;
    if path.exists() {
        std::fs::read_to_string(&path)
            .map(|s| s.trim().to_string())
            .map_err(|e| e.to_string())
    } else {
        Err("PM work folder not configured".to_string())
    }
}

/// Scan project_folders from DB, find ones containing 00_PM_NX/projects_list.json
fn detect_pm_folders_from_db(conn: &rusqlite::Connection) -> Result<Vec<String>, String> {
    let folders = load_project_folders_from_db(conn)?;
    let mut results = Vec::new();
    for f in &folders {
        let pm_file = std::path::Path::new(&f.path)
            .join("00_PM_NX")
            .join("projects_list.json");
        if pm_file.exists() {
            results.push(f.path.clone());
        }
    }
    Ok(results)
}

/// Resolves the PM work folder: the configured one if present, otherwise the
/// first folder detected from the DB that contains `00_PM_NX/projects_list.json`.
/// Returns None when PM is not set up. Used to source clients from PM.
pub(crate) fn resolve_work_folder(conn: &rusqlite::Connection) -> Option<String> {
    if let Ok(folder) = load_work_folder() {
        if !folder.trim().is_empty() {
            return Some(folder);
        }
    }
    detect_pm_folders_from_db(conn)
        .ok()
        .and_then(|mut v| v.drain(..).next())
}

fn save_work_folder(path: &str) -> Result<(), String> {
    let config_path = pm_config_path()?;
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&config_path, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pm_get_projects() -> Result<Vec<pm_manager::PmProject>, CommandError> {
    let folder = load_work_folder()?;
    pm_manager::read_projects(&folder).map_err(CommandError::Other)
}

#[tauri::command]
pub fn pm_create_project(
    project: pm_manager::PmNewProject,
) -> Result<pm_manager::PmProject, CommandError> {
    let folder = load_work_folder()?;
    pm_manager::create_project(&folder, project).map_err(CommandError::Other)
}

#[tauri::command]
pub fn pm_suggest_project_number() -> Result<String, CommandError> {
    let folder = load_work_folder()?;
    pm_manager::next_project_number(&folder).map_err(CommandError::Other)
}

#[tauri::command]
pub fn pm_update_project(
    index: usize,
    project: pm_manager::PmProject,
) -> Result<(), CommandError> {
    let folder = load_work_folder()?;
    let mut projects = pm_manager::read_projects(&folder)?;
    if index >= projects.len() {
        return Err(CommandError::Validation("Index out of range".into()));
    }
    projects[index] = project;
    pm_manager::write_projects(&folder, &projects).map_err(CommandError::Other)
}

#[tauri::command]
pub fn pm_delete_project(index: usize) -> Result<(), CommandError> {
    let folder = load_work_folder()?;
    let mut projects = pm_manager::read_projects(&folder)?;
    if index >= projects.len() {
        return Err(CommandError::Validation("Index out of range".into()));
    }
    projects.remove(index);
    pm_manager::write_projects(&folder, &projects).map_err(CommandError::Other)
}

#[tauri::command]
pub async fn pm_get_settings(app: AppHandle) -> Result<pm_manager::PmSettings, CommandError> {
    // Try saved config first
    let folder = load_work_folder().unwrap_or_default();
    if !folder.is_empty() {
        return Ok(pm_manager::PmSettings {
            work_folder: folder,
            settings_folder: "00_PM_NX".to_string(),
        });
    }
    // Auto-detect from project_folders
    let detected = run_db_blocking(app, move |conn| {
        detect_pm_folders_from_db(conn)
    }).await?;
    if let Some(first) = detected.first() {
        // Auto-save detected folder
        let _ = save_work_folder(first);
        return Ok(pm_manager::PmSettings {
            work_folder: first.clone(),
            settings_folder: "00_PM_NX".to_string(),
        });
    }
    Ok(pm_manager::PmSettings {
        work_folder: String::new(),
        settings_folder: "00_PM_NX".to_string(),
    })
}

/// Detect PM work folders from existing TIMEFLOW project_folders
#[tauri::command]
pub async fn pm_detect_work_folder(app: AppHandle) -> Result<Vec<String>, CommandError> {
    run_db_blocking(app, move |conn| {
        detect_pm_folders_from_db(conn)
    }).await.map_err(CommandError::Other)
}

#[tauri::command]
pub fn pm_set_work_folder(path: String) -> Result<(), CommandError> {
    if !std::path::Path::new(&path).is_dir() {
        return Err(CommandError::Validation("Folder does not exist".into()));
    }
    save_work_folder(&path).map_err(CommandError::Other)
}

#[tauri::command]
pub fn pm_get_folder_size(full_name: String) -> Result<Option<f64>, CommandError> {
    let folder = load_work_folder()?;
    Ok(pm_manager::get_folder_size(&folder, &full_name))
}

#[tauri::command]
pub fn pm_get_templates() -> Result<Vec<pm_manager::PmFolderTemplate>, CommandError> {
    let folder = load_work_folder()?;
    pm_manager::read_templates(&folder).map_err(CommandError::Other)
}

#[tauri::command]
pub fn pm_save_template(
    template: pm_manager::PmFolderTemplate,
) -> Result<(), CommandError> {
    let folder = load_work_folder()?;
    let mut templates = pm_manager::read_templates(&folder)?;
    if let Some(existing) = templates.iter_mut().find(|t| t.id == template.id) {
        *existing = template;
    } else {
        templates.push(template);
    }
    pm_manager::write_templates(&folder, &templates).map_err(CommandError::Other)
}

#[tauri::command]
pub fn pm_delete_template(id: String) -> Result<(), CommandError> {
    if id == "default" {
        return Err(CommandError::Validation("Cannot delete default template".into()));
    }
    let folder = load_work_folder()?;
    let mut templates = pm_manager::read_templates(&folder)?;
    templates.retain(|t| t.id != id);
    pm_manager::write_templates(&folder, &templates).map_err(CommandError::Other)
}

#[tauri::command]
pub fn pm_set_default_template(id: String) -> Result<(), CommandError> {
    let folder = load_work_folder()?;
    let mut templates = pm_manager::read_templates(&folder)?;
    for t in templates.iter_mut() {
        t.is_default = t.id == id;
    }
    pm_manager::write_templates(&folder, &templates).map_err(CommandError::Other)
}

// --- Client colors ---

#[tauri::command]
pub fn pm_get_client_colors() -> Result<std::collections::HashMap<String, pm_manager::ClientInfo>, CommandError> {
    let folder = load_work_folder()?;
    pm_manager::read_client_colors(&folder).map_err(CommandError::Other)
}

#[tauri::command]
pub fn pm_save_client_colors(colors: std::collections::HashMap<String, pm_manager::ClientInfo>) -> Result<(), CommandError> {
    let folder = load_work_folder()?;
    pm_manager::write_client_colors(&folder, &colors).map_err(CommandError::Other)
}
