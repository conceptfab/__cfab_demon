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
    pub prj_number: String,
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

/// Skan folderu roboczego: zwraca numery `NN` projektów pasujących do wzorca
/// `NN_RR_...` dla podanego 2-cyfrowego `year`. Wpisy niepasujące, pliki
/// oraz błędy odczytu katalogu są ignorowane.
fn scan_disk_project_numbers(work_folder: &str, year: &str) -> Vec<u32> {
    let mut nums = Vec::new();
    let entries = match fs::read_dir(work_folder) {
        Ok(e) => e,
        Err(_) => return nums,
    };
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let file_name = entry.file_name();
        let name = match file_name.to_str() {
            Some(n) => n,
            None => continue,
        };
        let mut parts = name.splitn(3, '_');
        let num_part = parts.next().unwrap_or("");
        let year_part = parts.next().unwrap_or("");
        let is_num = (2..=3).contains(&num_part.len())
            && num_part.chars().all(|c| c.is_ascii_digit());
        if is_num && year_part == year {
            if let Ok(n) = num_part.parse::<u32>() {
                nums.push(n);
            }
        }
    }
    nums
}

/// Numery zajęte w danym roku — scalone z rejestru JSON i skanu dysku.
fn existing_project_numbers(work_folder: &str, year: &str) -> Result<Vec<u32>, String> {
    let projects = read_projects(work_folder)?;
    let mut nums: Vec<u32> = projects
        .iter()
        .filter(|p| p.prj_year == year)
        .filter_map(|p| p.prj_number.trim().parse::<u32>().ok())
        .collect();
    nums.extend(scan_disk_project_numbers(work_folder, year));
    Ok(nums)
}

/// Sugerowany kolejny numer projektu dla bieżącego roku: `max(zajęte) + 1`,
/// z zerem wiodącym (`{:02}`).
pub fn next_project_number(work_folder: &str) -> Result<String, String> {
    let year = Local::now().format("%y").to_string();
    let existing = existing_project_numbers(work_folder, &year)?;
    let next = existing.into_iter().max().unwrap_or(0) + 1;
    Ok(format!("{:02}", next))
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

    let number_val: u32 = new
        .prj_number
        .trim()
        .parse()
        .map_err(|_| format!("Invalid project number: '{}'", new.prj_number.trim()))?;
    if number_val == 0 {
        return Err("Project number must be greater than 0".to_string());
    }
    let existing = existing_project_numbers(work_folder, &year)?;
    if existing.contains(&number_val) {
        return Err(format!("PM_NUMBER_TAKEN:{}", number_val));
    }
    let number = format!("{:02}", number_val);

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_work_folder(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("tf_pm_{}_{}", tag, nanos));
        fs::create_dir_all(&dir).expect("create temp work folder");
        dir
    }

    fn mkdir(work: &Path, name: &str) {
        fs::create_dir_all(work.join(name)).expect("create project dir");
    }

    #[test]
    fn scan_disk_picks_matching_year_only() {
        let work = unique_work_folder("scan");
        let year = Local::now().format("%y").to_string();
        let other_year = if year == "00" { "99".to_string() } else { "00".to_string() };
        mkdir(&work, &format!("01_{}_ACME_Site", year));
        mkdir(&work, &format!("04_{}_ACME_Shop", year));
        mkdir(&work, &format!("07_{}_OLD_Thing", other_year)); // inny rok - pomijany
        mkdir(&work, "00_PM_NX"); // folder ustawień - pomijany
        mkdir(&work, "notes"); // bez wzorca - pomijany

        let mut nums = scan_disk_project_numbers(work.to_str().unwrap(), &year);
        nums.sort();
        assert_eq!(nums, vec![1, 4]);

        fs::remove_dir_all(&work).ok();
    }

    #[test]
    fn existing_numbers_merge_json_and_disk() {
        let work = unique_work_folder("merge");
        let year = Local::now().format("%y").to_string();
        mkdir(&work, &format!("04_{}_ACME_Shop", year)); // numer 04 tylko na dysku
        let json_project = PmProject {
            prj_folder: work.to_str().unwrap().to_string(),
            prj_number: "02".into(),
            prj_year: year.clone(),
            prj_code: format!("02{}", year),
            prj_client: "ACME".into(),
            prj_name: "Site".into(),
            prj_desc: String::new(),
            prj_full_name: format!("02_{}_ACME_Site", year),
            prj_budget: String::new(),
            prj_term: String::new(),
            prj_status: "Aktywny".into(),
        };
        write_projects(work.to_str().unwrap(), &[json_project]).expect("write json");

        let mut nums = existing_project_numbers(work.to_str().unwrap(), &year).expect("existing");
        nums.sort();
        assert_eq!(nums, vec![2, 4]);

        fs::remove_dir_all(&work).ok();
    }

    #[test]
    fn next_number_is_max_plus_one_with_gaps() {
        let work = unique_work_folder("next");
        let year = Local::now().format("%y").to_string();
        mkdir(&work, &format!("01_{}_A_X", year));
        mkdir(&work, &format!("02_{}_A_Y", year));
        mkdir(&work, &format!("04_{}_A_Z", year)); // luka przy 03 NIE jest wypełniana
        assert_eq!(next_project_number(work.to_str().unwrap()).unwrap(), "05");
        fs::remove_dir_all(&work).ok();
    }

    #[test]
    fn next_number_starts_at_01_when_empty() {
        let work = unique_work_folder("empty");
        assert_eq!(next_project_number(work.to_str().unwrap()).unwrap(), "01");
        fs::remove_dir_all(&work).ok();
    }

    #[test]
    fn create_project_rejects_taken_number() {
        let work = unique_work_folder("collision");
        let year = Local::now().format("%y").to_string();
        mkdir(&work, &format!("03_{}_ACME_Existing", year));

        let new = PmNewProject {
            prj_client: "ACME".into(),
            prj_name: "Dup".into(),
            prj_desc: String::new(),
            prj_budget: String::new(),
            prj_term: String::new(),
            template_id: "default".into(),
            prj_number: "3".into(),
        };
        let result = create_project(work.to_str().unwrap(), new);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("PM_NUMBER_TAKEN"));

        fs::remove_dir_all(&work).ok();
    }

    #[test]
    fn create_project_rejects_invalid_number() {
        let work = unique_work_folder("invalid");
        let new = PmNewProject {
            prj_client: "ACME".into(),
            prj_name: "Bad".into(),
            prj_desc: String::new(),
            prj_budget: String::new(),
            prj_term: String::new(),
            template_id: "default".into(),
            prj_number: "abc".into(),
        };
        assert!(create_project(work.to_str().unwrap(), new).is_err());
        fs::remove_dir_all(&work).ok();
    }

    #[test]
    fn create_project_accepts_free_number() {
        let work = unique_work_folder("ok");
        let year = Local::now().format("%y").to_string();
        let new = PmNewProject {
            prj_client: "ACME".into(),
            prj_name: "Fresh".into(),
            prj_desc: String::new(),
            prj_budget: String::new(),
            prj_term: String::new(),
            template_id: "default".into(),
            prj_number: "7".into(),
        };
        let project = create_project(work.to_str().unwrap(), new).expect("create");
        assert_eq!(project.prj_number, "07");
        assert_eq!(project.prj_year, year);
        assert_eq!(project.prj_code, format!("07{}", year));
        assert_eq!(project.prj_full_name, format!("07_{}_ACME_Fresh", year));
        assert!(work.join(format!("07_{}_ACME_Fresh", year)).is_dir());
        fs::remove_dir_all(&work).ok();
    }
}
