use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use chrono::Local;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PmProject {
    pub prj_folder: String,
    pub prj_number: String,
    pub prj_year: String,
    pub prj_code: String,
    pub prj_client: String,
    pub prj_name: String,
    pub prj_desc: String,
    pub prj_full_name: String,
    pub prj_budget: String,
    pub prj_term: String,
    pub prj_status: String,
}

#[derive(Debug, Deserialize)]
pub struct PmNewProject {
    pub prj_client: String,
    pub prj_name: String,
    pub prj_desc: String,
    pub prj_budget: String,
    pub prj_term: String,
    pub template_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PmFolderTemplate {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub folders: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PmSettings {
    pub work_folder: String,
    pub settings_folder: String,
}

const PM_SETTINGS_FOLDER: &str = "00_PM_NX";
const PM_PROJECTS_FILE: &str = "projects_list.json";
const PM_TEMPLATES_FILE: &str = "pm_templates.json";
const PM_CLIENTS_FILE: &str = "pm_clients.json";

fn projects_file_path(work_folder: &str) -> PathBuf {
    Path::new(work_folder)
        .join(PM_SETTINGS_FOLDER)
        .join(PM_PROJECTS_FILE)
}

pub fn read_projects(work_folder: &str) -> Result<Vec<PmProject>, String> {
    let path = projects_file_path(work_folder);
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read {}: {}", path.display(), e))?;
    if content.trim().is_empty() {
        return Ok(vec![]);
    }
    serde_json::from_str(&content)
        .map_err(|e| format!("Invalid JSON in {}: {}", path.display(), e))
}

pub fn write_projects(work_folder: &str, projects: &[PmProject]) -> Result<(), String> {
    let path = projects_file_path(work_folder);

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create dir {}: {}", parent.display(), e))?;
        let backup_dir = parent.join("backup");
        fs::create_dir_all(&backup_dir).ok();
    }

    if path.exists() {
        backup_projects_file(&path)?;
    }

    let json = serde_json::to_string_pretty(projects)
        .map_err(|e| format!("JSON serialize error: {}", e))?;
    fs::write(&path, json)
        .map_err(|e| format!("Cannot write {}: {}", path.display(), e))
}

fn backup_projects_file(path: &Path) -> Result<(), String> {
    let timestamp = Local::now().format("_%H%M%S_%d%m%Y").to_string();
    let backup_name = format!("backup_projects_list{}.json", timestamp);
    let parent = path
        .parent()
        .ok_or_else(|| format!("Cannot create backup for path without parent: {}", path.display()))?;
    let backup_path = parent.join("backup").join(backup_name);
    fs::copy(path, &backup_path)
        .map_err(|e| format!("Backup failed: {}", e))?;
    Ok(())
}

fn count_projects_this_year(projects: &[PmProject]) -> usize {
    let year = Local::now().format("%y").to_string();
    projects.iter().filter(|p| p.prj_year == year).count()
}

fn next_project_number(projects: &[PmProject]) -> String {
    let count = count_projects_this_year(projects);
    let next = count + 1;
    if next < 10 {
        format!("0{}", next)
    } else {
        next.to_string()
    }
}

fn default_template() -> PmFolderTemplate {
    PmFolderTemplate {
        id: "default".to_string(),
        name: "CONCEPTFAB (default)".to_string(),
        is_default: true,
        folders: vec![
            "_Sent_files_".into(),
            "__Final_files__".into(),
            "_CAD_files".into(),
            "_Vector_files".into(),
            "_2D_files".into(),
            "_3D_scenes".into(),
            "_3D_models".into(),
            "_3D_sculpt".into(),
            "_Materials".into(),
            "_Textures".into(),
            "_HDR_map".into(),
            "_VR_online".into(),
            "_{name}_IMG".into(),
            "_RenderFarm_files".into(),
            "_External_models".into(),
            "_External_files".into(),
            "___REF___".into(),
        ],
    }
}

fn templates_file_path(work_folder: &str) -> PathBuf {
    Path::new(work_folder)
        .join(PM_SETTINGS_FOLDER)
        .join(PM_TEMPLATES_FILE)
}

pub fn read_templates(work_folder: &str) -> Result<Vec<PmFolderTemplate>, String> {
    let path = templates_file_path(work_folder);
    if !path.exists() {
        return Ok(vec![default_template()]);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read {}: {}", path.display(), e))?;
    let templates: Vec<PmFolderTemplate> = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid JSON in {}: {}", path.display(), e))?;
    if templates.is_empty() {
        return Ok(vec![default_template()]);
    }
    Ok(templates)
}

pub fn write_templates(work_folder: &str, templates: &[PmFolderTemplate]) -> Result<(), String> {
    let path = templates_file_path(work_folder);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    let json = serde_json::to_string_pretty(templates)
        .map_err(|e| format!("JSON serialize error: {}", e))?;
    fs::write(&path, json)
        .map_err(|e| format!("Cannot write {}: {}", path.display(), e))
}

fn find_template(templates: &[PmFolderTemplate], id: &str) -> PmFolderTemplate {
    templates.iter()
        .find(|t| t.id == id)
        .cloned()
        .unwrap_or_else(|| {
            templates.iter().find(|t| t.is_default).cloned()
                .unwrap_or_else(default_template)
        })
}

pub fn create_project(work_folder: &str, new: PmNewProject) -> Result<PmProject, String> {
    let mut projects = read_projects(work_folder)?;
    let templates = read_templates(work_folder)?;
    let template = find_template(&templates, &new.template_id);

    let year = Local::now().format("%y").to_string();
    let number = next_project_number(&projects);
    let code = format!("{}{}", number, year);
    let full_name = format!("{}_{}_{}_{}", number, year, new.prj_client, new.prj_name);

    let project = PmProject {
        prj_folder: work_folder.to_string(),
        prj_number: number,
        prj_year: year,
        prj_code: code.clone(),
        prj_client: new.prj_client,
        prj_name: new.prj_name.clone(),
        prj_desc: new.prj_desc,
        prj_full_name: full_name.clone(),
        prj_budget: new.prj_budget,
        prj_term: new.prj_term,
        prj_status: "Aktywny".to_string(),
    };

    create_dirs_tree(work_folder, &full_name, &code, &new.prj_name, &template)?;

    projects.push(project.clone());
    write_projects(work_folder, &projects)?;

    Ok(project)
}

fn create_dirs_tree(
    work_folder: &str,
    full_name: &str,
    code: &str,
    project_name: &str,
    template: &PmFolderTemplate,
) -> Result<(), String> {
    let project_dir = Path::new(work_folder).join(full_name);
    fs::create_dir_all(&project_dir)
        .map_err(|e| format!("Cannot create project dir: {}", e))?;

    for (i, folder_suffix) in template.folders.iter().enumerate() {
        let resolved = folder_suffix.replace("{name}", project_name);
        let folder_name = format!("{:02}_{}{}", i, code, resolved);
        let dir = project_dir.join(&folder_name);
        fs::create_dir_all(&dir).ok();
    }

    Ok(())
}

pub fn get_folder_size(work_folder: &str, full_name: &str) -> Option<f64> {
    let path = Path::new(work_folder).join(full_name);
    if !path.is_dir() {
        return None;
    }
    let mut total: u64 = 0;
    if let Ok(entries) = fs::read_dir(&path) {
        for entry in entries.flatten() {
            total += dir_size_recursive(&entry.path());
        }
    }
    Some(total as f64 / (1024.0 * 1024.0 * 1024.0))
}

fn dir_size_recursive(path: &Path) -> u64 {
    if path.is_file() {
        return path.metadata().map(|m| m.len()).unwrap_or(0);
    }
    let mut total = 0u64;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            total += dir_size_recursive(&entry.path());
        }
    }
    total
}

// --- Client data (colors, comments, contacts) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientInfo {
    pub color: String,
    #[serde(default)]
    pub comment: String,
    #[serde(default)]
    pub contact: String,
}

fn clients_file_path(work_folder: &str) -> PathBuf {
    Path::new(work_folder)
        .join(PM_SETTINGS_FOLDER)
        .join(PM_CLIENTS_FILE)
}

/// Read client data. Handles backward compat with old format { "CLIENT": "#hex" }
pub fn read_client_colors(work_folder: &str) -> Result<std::collections::HashMap<String, ClientInfo>, String> {
    let path = clients_file_path(work_folder);
    if !path.exists() {
        return Ok(std::collections::HashMap::new());
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read {}: {}", path.display(), e))?;
    if content.trim().is_empty() {
        return Ok(std::collections::HashMap::new());
    }
    // Try new format first: { "CLIENT": { color, comment, contact } }
    if let Ok(data) = serde_json::from_str::<std::collections::HashMap<String, ClientInfo>>(&content) {
        return Ok(data);
    }
    // Fallback: old format { "CLIENT": "#hex" }
    if let Ok(old) = serde_json::from_str::<std::collections::HashMap<String, String>>(&content) {
        let migrated: std::collections::HashMap<String, ClientInfo> = old.into_iter()
            .map(|(k, v)| (k, ClientInfo { color: v, comment: String::new(), contact: String::new() }))
            .collect();
        return Ok(migrated);
    }
    Err(format!("Invalid JSON in {}", path.display()))
}

pub fn write_client_colors(work_folder: &str, colors: &std::collections::HashMap<String, ClientInfo>) -> Result<(), String> {
    let path = clients_file_path(work_folder);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    let json = serde_json::to_string_pretty(colors)
        .map_err(|e| format!("JSON serialize error: {}", e))?;
    fs::write(&path, json)
        .map_err(|e| format!("Cannot write {}: {}", path.display(), e))
}
