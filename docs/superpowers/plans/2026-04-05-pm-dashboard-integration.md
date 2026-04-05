# PM (Project Manager) — Dashboard Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Przenieść funkcjonalność Python PM (_PM/) do dashboardu Tauri jako osobną sekcję "PM" — zarządzanie projektami klientowskimi z numeracją, klientem, budżetem, terminem i drzewem folderów.

**Architecture:** PM to osobna sekcja w Sidebar (obok Projects), operująca na dedykowanym pliku `pm_projects.json` w katalogu danych TIMEFLOW (nie SQLite). Dashboard odczytuje/zapisuje plik JSON przez Tauri commands. Zapewnia to zgodność danych z istniejącym formatem PM Pythona. Drzewo folderów tworzone jest na dysku przez Rust backend. Szablony drzew folderów przechowywane w osobnym pliku `pm_templates.json` — domyślny szablon odpowiada oryginalnemu drzewu z PM Pythona, użytkownik może tworzyć własne.

**Tech Stack:** React + TypeScript (dashboard), Rust (Tauri commands), JSON (storage), i18n (PL+EN)

---

## Kontekst: Struktura danych PM

Plik `projects_list.json` to tablica obiektów:

```json
[
  {
    "prj_folder": "D:/OneDrive/work",
    "prj_number": "01",
    "prj_year": "26",
    "prj_code": "0126",
    "prj_client": "ACME",
    "prj_name": "Website",
    "prj_desc": "Redesign strony",
    "prj_full_name": "01_26_ACME_Website",
    "prj_budget": "5000",
    "prj_term": "2026-12-31",
    "prj_status": "Aktywny"
  }
]
```

Drzewo folderów projektu (17 podfolderów):
```
00_{code}_Sent_files_
01_{code}__Final_files__
02_{code}_CAD_files
03_{code}_Vector_files
04_{code}_2D_files
05_{code}_3D_scenes
06_{code}_3D_models
07_{code}_3D_sculpt
08_{code}_Materials
09_{code}_Textures
10_{code}_HDR_map
11_{code}_VR_online
12_{code}_{name}_IMG
13_{code}_RenderFarm_files
14_{code}_External_models
15_{code}_External_files
16_{code}___REF___
```

## Szablony drzew folderów

Szablony przechowywane w `pm_templates.json` w `00_PM_NX/`:

```json
[
  {
    "id": "default",
    "name": "CONCEPTFAB (default)",
    "is_default": true,
    "folders": [
      "_Sent_files_",
      "__Final_files__",
      "_CAD_files",
      "_Vector_files",
      "_2D_files",
      "_3D_scenes",
      "_3D_models",
      "_3D_sculpt",
      "_Materials",
      "_Textures",
      "_HDR_map",
      "_VR_online",
      "_{name}_IMG",
      "_RenderFarm_files",
      "_External_models",
      "_External_files",
      "___REF___"
    ]
  }
]
```

Każdy folder w szablonie jest automatycznie prefixowany: `{index:02}_{code}{folder}`.
Placeholder `{name}` zamieniany jest na nazwę projektu.
Przy tworzeniu projektu użytkownik wybiera szablon (domyślnie: ten oznaczony `is_default: true`).

## Mapowanie plików

### Nowe pliki — Rust backend
- `dashboard/src-tauri/src/pm_manager.rs` — odczyt/zapis `pm_projects.json`, tworzenie folderów, backup, walidacja
- `dashboard/src-tauri/src/pm_commands.rs` — Tauri commands wystawione do frontendu

### Nowe pliki — Dashboard frontend
- `dashboard/src/pages/PM.tsx` — strona główna sekcji PM
- `dashboard/src/components/pm/PmProjectsList.tsx` — lista projektów PM (tabela)
- `dashboard/src/components/pm/PmCreateProjectDialog.tsx` — dialog tworzenia projektu
- `dashboard/src/components/pm/PmProjectDetailDialog.tsx` — podgląd/edycja projektu
- `dashboard/src/components/pm/PmTemplateManager.tsx` — zarządzanie szablonami drzew folderów
- `dashboard/src/lib/tauri/pm.ts` — wrapper na Tauri invoke dla PM
- `dashboard/src/lib/pm-types.ts` — typy TypeScript dla PM

### Modyfikowane pliki
- `dashboard/src-tauri/src/main.rs` lub `dashboard/src-tauri/src/lib.rs` — rejestracja nowych commands
- `dashboard/src/App.tsx` — dodanie routingu do strony PM
- `dashboard/src/components/layout/Sidebar.tsx` — dodanie pozycji PM w nawigacji
- `dashboard/src/pages/Help.tsx` — sekcja pomocy dla PM
- `dashboard/src/locales/en/common.json` — tłumaczenia EN
- `dashboard/src/locales/pl/common.json` — tłumaczenia PL

---

## Task 1: Typy TypeScript i warstwa Tauri invoke

**Files:**
- Create: `dashboard/src/lib/pm-types.ts`
- Create: `dashboard/src/lib/tauri/pm.ts`

- [ ] **Step 1: Utwórz plik typów PM**

```typescript
// dashboard/src/lib/pm-types.ts

export interface PmProject {
  prj_folder: string;
  prj_number: string;
  prj_year: string;
  prj_code: string;
  prj_client: string;
  prj_name: string;
  prj_desc: string;
  prj_full_name: string;
  prj_budget: string;
  prj_term: string;
  prj_status: string;
}

export interface PmNewProject {
  prj_client: string;
  prj_name: string;
  prj_desc: string;
  prj_budget: string;
  prj_term: string;
  template_id: string; // id szablonu drzewa folderów
}

export interface PmFolderTemplate {
  id: string;
  name: string;
  is_default: boolean;
  folders: string[]; // np. ["_Sent_files_", "__Final_files__", ...]
}

export interface PmSettings {
  work_folder: string;
  settings_folder: string;
}

export type PmSortField = 'number' | 'year' | 'client' | 'name' | 'status';
```

- [ ] **Step 2: Utwórz plik Tauri invoke wrapper**

```typescript
// dashboard/src/lib/tauri/pm.ts

import { invoke } from './core';
import type { PmProject, PmNewProject, PmSettings, PmFolderTemplate } from '../pm-types';

export const getPmProjects = () =>
  invoke<PmProject[]>('pm_get_projects');

export const createPmProject = (project: PmNewProject) =>
  invoke<PmProject>('pm_create_project', { project });

export const updatePmProject = (index: number, project: PmProject) =>
  invoke<void>('pm_update_project', { index, project });

export const deletePmProject = (index: number) =>
  invoke<void>('pm_delete_project', { index });

export const getPmSettings = () =>
  invoke<PmSettings>('pm_get_settings');

export const setPmWorkFolder = (path: string) =>
  invoke<void>('pm_set_work_folder', { path });

export const getPmFolderSize = (fullName: string) =>
  invoke<number | null>('pm_get_folder_size', { fullName });

// --- Szablony drzew folderów ---

export const getPmTemplates = () =>
  invoke<PmFolderTemplate[]>('pm_get_templates');

export const savePmTemplate = (template: PmFolderTemplate) =>
  invoke<void>('pm_save_template', { template });

export const deletePmTemplate = (id: string) =>
  invoke<void>('pm_delete_template', { id });

export const setDefaultPmTemplate = (id: string) =>
  invoke<void>('pm_set_default_template', { id });

export const pmApi = {
  getPmProjects,
  createPmProject,
  updatePmProject,
  deletePmProject,
  getPmSettings,
  setPmWorkFolder,
  getPmFolderSize,
  getPmTemplates,
  savePmTemplate,
  deletePmTemplate,
  setDefaultPmTemplate,
} as const;
```

- [ ] **Step 3: Zarejestruj eksport w lib/tauri.ts**

W `dashboard/src/lib/tauri.ts` dodaj:
```typescript
export { pmApi } from './tauri/pm';
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/lib/pm-types.ts dashboard/src/lib/tauri/pm.ts dashboard/src/lib/tauri.ts
git commit -m "feat(pm): add TypeScript types and Tauri invoke wrappers for PM"
```

---

## Task 2: Rust backend — pm_manager.rs

**Files:**
- Create: `dashboard/src-tauri/src/pm_manager.rs`

> **UWAGA:** Przed implementacją tego taska, sprawdź dokładną strukturę `dashboard/src-tauri/src/` — pliki `main.rs`, `lib.rs`, jak są rejestrowane commands. Dostosuj wzorzec do istniejącej konwencji.

- [ ] **Step 1: Zbadaj strukturę Tauri backendu**

Przeczytaj `dashboard/src-tauri/src/main.rs` (lub `lib.rs`) i `dashboard/src-tauri/Cargo.toml`, aby zrozumieć:
- Jak rejestrowane są Tauri commands
- Jakie zależności są dostępne (serde, serde_json, etc.)
- Gdzie leży plik bazy danych / konfiguracji

- [ ] **Step 2: Utwórz pm_manager.rs**

Moduł powinien zawierać:

```rust
// dashboard/src-tauri/src/pm_manager.rs

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

/// Resolves path to pm_projects.json within the work folder
fn projects_file_path(work_folder: &str) -> PathBuf {
    Path::new(work_folder)
        .join(PM_SETTINGS_FOLDER)
        .join(PM_PROJECTS_FILE)
}

/// Read all PM projects from JSON file
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

/// Write PM projects to JSON file (with backup)
pub fn write_projects(work_folder: &str, projects: &[PmProject]) -> Result<(), String> {
    let path = projects_file_path(work_folder);
    
    // Ensure settings dir exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create dir {}: {}", parent.display(), e))?;
        // Ensure backup dir exists
        let backup_dir = parent.join("backup");
        fs::create_dir_all(&backup_dir).ok();
    }
    
    // Backup before write
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
    let backup_path = path.parent().unwrap().join("backup").join(backup_name);
    fs::copy(path, &backup_path)
        .map_err(|e| format!("Backup failed: {}", e))?;
    Ok(())
}

/// Count projects in current year
fn count_projects_this_year(projects: &[PmProject]) -> usize {
    let year = Local::now().format("%y").to_string();
    projects.iter().filter(|p| p.prj_year == year).count()
}

/// Generate next project number
fn next_project_number(projects: &[PmProject]) -> String {
    let count = count_projects_this_year(projects);
    let next = count + 1;
    if next < 10 {
        format!("0{}", next)
    } else {
        next.to_string()
    }
}

/// Default folder template (matching Python PM original)
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

/// Read templates — returns default if file missing
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

/// Write templates to JSON file
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

/// Find template by id, fall back to default
fn find_template(templates: &[PmFolderTemplate], id: &str) -> PmFolderTemplate {
    templates.iter()
        .find(|t| t.id == id)
        .cloned()
        .unwrap_or_else(|| {
            templates.iter().find(|t| t.is_default).cloned()
                .unwrap_or_else(default_template)
        })
}

/// Create a new PM project — generates number, code, full_name, creates folder tree from template
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
    
    // Create directory tree from template
    create_dirs_tree(work_folder, &full_name, &code, &new.prj_name, &template)?;
    
    projects.push(project.clone());
    write_projects(work_folder, &projects)?;
    
    Ok(project)
}

/// Create project directory tree from template
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

/// Get folder size in GB (None if folder doesn't exist)
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
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src-tauri/src/pm_manager.rs
git commit -m "feat(pm): add Rust PM manager — read/write projects JSON, create folder trees"
```

---

## Task 3: Rust backend — Tauri commands

**Files:**
- Create: `dashboard/src-tauri/src/pm_commands.rs`
- Modify: `dashboard/src-tauri/src/main.rs` (lub `lib.rs`)

- [ ] **Step 1: Utwórz pm_commands.rs**

```rust
// dashboard/src-tauri/src/pm_commands.rs

use crate::pm_manager;

/// Persistent work folder path — stored in app config dir
fn load_work_folder(app: &tauri::AppHandle) -> Result<String, String> {
    let config_dir = app.path().app_config_dir()
        .map_err(|e| format!("No config dir: {}", e))?;
    let pm_config = config_dir.join("pm_work_folder.txt");
    if pm_config.exists() {
        std::fs::read_to_string(&pm_config)
            .map(|s| s.trim().to_string())
            .map_err(|e| e.to_string())
    } else {
        Err("PM work folder not configured".to_string())
    }
}

fn save_work_folder(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    let config_dir = app.path().app_config_dir()
        .map_err(|e| format!("No config dir: {}", e))?;
    std::fs::create_dir_all(&config_dir).ok();
    let pm_config = config_dir.join("pm_work_folder.txt");
    std::fs::write(&pm_config, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pm_get_projects(app: tauri::AppHandle) -> Result<Vec<pm_manager::PmProject>, String> {
    let folder = load_work_folder(&app)?;
    pm_manager::read_projects(&folder)
}

#[tauri::command]
pub fn pm_create_project(
    app: tauri::AppHandle,
    project: pm_manager::PmNewProject,
) -> Result<pm_manager::PmProject, String> {
    let folder = load_work_folder(&app)?;
    pm_manager::create_project(&folder, project)
}

#[tauri::command]
pub fn pm_update_project(
    app: tauri::AppHandle,
    index: usize,
    project: pm_manager::PmProject,
) -> Result<(), String> {
    let folder = load_work_folder(&app)?;
    let mut projects = pm_manager::read_projects(&folder)?;
    if index >= projects.len() {
        return Err("Index out of range".to_string());
    }
    projects[index] = project;
    pm_manager::write_projects(&folder, &projects)
}

#[tauri::command]
pub fn pm_delete_project(app: tauri::AppHandle, index: usize) -> Result<(), String> {
    let folder = load_work_folder(&app)?;
    let mut projects = pm_manager::read_projects(&folder)?;
    if index >= projects.len() {
        return Err("Index out of range".to_string());
    }
    projects.remove(index);
    pm_manager::write_projects(&folder, &projects)
}

#[tauri::command]
pub fn pm_get_settings(app: tauri::AppHandle) -> Result<pm_manager::PmSettings, String> {
    let folder = load_work_folder(&app).unwrap_or_default();
    Ok(pm_manager::PmSettings {
        work_folder: folder,
        settings_folder: "00_PM_NX".to_string(),
    })
}

#[tauri::command]
pub fn pm_set_work_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).is_dir() {
        return Err("Folder does not exist".to_string());
    }
    save_work_folder(&app, &path)
}

#[tauri::command]
pub fn pm_get_folder_size(
    app: tauri::AppHandle,
    full_name: String,
) -> Result<Option<f64>, String> {
    let folder = load_work_folder(&app)?;
    Ok(pm_manager::get_folder_size(&folder, &full_name))
}

// --- Template commands ---

#[tauri::command]
pub fn pm_get_templates(app: tauri::AppHandle) -> Result<Vec<pm_manager::PmFolderTemplate>, String> {
    let folder = load_work_folder(&app)?;
    pm_manager::read_templates(&folder)
}

#[tauri::command]
pub fn pm_save_template(
    app: tauri::AppHandle,
    template: pm_manager::PmFolderTemplate,
) -> Result<(), String> {
    let folder = load_work_folder(&app)?;
    let mut templates = pm_manager::read_templates(&folder)?;
    if let Some(existing) = templates.iter_mut().find(|t| t.id == template.id) {
        *existing = template;
    } else {
        templates.push(template);
    }
    pm_manager::write_templates(&folder, &templates)
}

#[tauri::command]
pub fn pm_delete_template(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if id == "default" {
        return Err("Cannot delete default template".to_string());
    }
    let folder = load_work_folder(&app)?;
    let mut templates = pm_manager::read_templates(&folder)?;
    templates.retain(|t| t.id != id);
    pm_manager::write_templates(&folder, &templates)
}

#[tauri::command]
pub fn pm_set_default_template(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let folder = load_work_folder(&app)?;
    let mut templates = pm_manager::read_templates(&folder)?;
    for t in templates.iter_mut() {
        t.is_default = t.id == id;
    }
    pm_manager::write_templates(&folder, &templates)
}
```

- [ ] **Step 2: Zarejestruj moduły i commands w main.rs/lib.rs**

Dodaj do pliku `main.rs` lub `lib.rs`:
```rust
mod pm_manager;
mod pm_commands;
```

W rejestracji Tauri (`.invoke_handler(tauri::generate_handler![...])`) dodaj:
```rust
pm_commands::pm_get_projects,
pm_commands::pm_create_project,
pm_commands::pm_update_project,
pm_commands::pm_delete_project,
pm_commands::pm_get_settings,
pm_commands::pm_set_work_folder,
pm_commands::pm_get_folder_size,
pm_commands::pm_get_templates,
pm_commands::pm_save_template,
pm_commands::pm_delete_template,
pm_commands::pm_set_default_template,
```

- [ ] **Step 3: Sprawdź kompilację**

Run: `cd dashboard/src-tauri && cargo check`
Expected: kompilacja bez błędów

- [ ] **Step 4: Commit**

```bash
git add dashboard/src-tauri/src/pm_commands.rs dashboard/src-tauri/src/main.rs
git commit -m "feat(pm): add Tauri commands for PM project CRUD"
```

---

## Task 4: Nawigacja — Sidebar + App.tsx routing

**Files:**
- Modify: `dashboard/src/components/layout/Sidebar.tsx`
- Modify: `dashboard/src/App.tsx`

- [ ] **Step 1: Dodaj PM do nawigacji w Sidebar.tsx**

W tablicy `navItems` (linia ~56), dodaj pozycję PM. Użyj ikony `Briefcase` z lucide-react:

```typescript
import { Briefcase } from 'lucide-react';

// W navItems, po 'reports':
{ id: 'pm', labelKey: 'layout.nav.pm', icon: Briefcase },
```

- [ ] **Step 2: Dodaj routing w App.tsx**

Dodaj lazy import:
```typescript
const PM = lazy(() =>
  import('@/pages/PM').then((m) => ({ default: m.PM })),
);
```

Dodaj case w switch `PageRouter`:
```typescript
case 'pm':
  return <PM />;
```

- [ ] **Step 3: Dodaj tłumaczenia nawigacji**

W `dashboard/src/locales/pl/common.json`, w sekcji `layout.nav`:
```json
"pm": "PM"
```

W `dashboard/src/locales/en/common.json`, w sekcji `layout.nav`:
```json
"pm": "PM"
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/layout/Sidebar.tsx dashboard/src/App.tsx dashboard/src/locales/pl/common.json dashboard/src/locales/en/common.json
git commit -m "feat(pm): add PM section to sidebar navigation and app routing"
```

---

## Task 5: Strona PM — lista projektów

**Files:**
- Create: `dashboard/src/pages/PM.tsx`
- Create: `dashboard/src/components/pm/PmProjectsList.tsx`

- [ ] **Step 1: Utwórz komponent PmProjectsList**

Komponent wyświetla tabelę projektów PM z kolumnami: Nr, Rok, Klient, Nazwa, Status, Budżet, Termin, Rozmiar.

```typescript
// dashboard/src/components/pm/PmProjectsList.tsx

import { useEffect, useState } from 'react';
import type { PmProject } from '@/lib/pm-types';
import { pmApi } from '@/lib/tauri/pm';
import { Badge } from '@/components/ui/badge';

interface PmProjectsListProps {
  projects: PmProject[];
  onSelect: (index: number) => void;
  onRefresh: () => void;
}

export function PmProjectsList({ projects, onSelect, onRefresh }: PmProjectsListProps) {
  // Implementacja: tabela z wierszami projektów
  // Kolumny: Nr | Rok | Klient | Nazwa | Status | Budżet | Termin
  // Status: badge zielony (Aktywny) / niebieski (Archiwalny)
  // Kliknięcie wiersza -> onSelect(index)
  // ... (pełna implementacja w trakcie kodowania)
}
```

- [ ] **Step 2: Utwórz stronę PM.tsx**

```typescript
// dashboard/src/pages/PM.tsx

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Briefcase, Plus, FolderOpen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { open } from '@tauri-apps/plugin-dialog';
import { pmApi } from '@/lib/tauri/pm';
import type { PmProject, PmSettings } from '@/lib/pm-types';
import { PmProjectsList } from '@/components/pm/PmProjectsList';
import { PmCreateProjectDialog } from '@/components/pm/PmCreateProjectDialog';
import { PmProjectDetailDialog } from '@/components/pm/PmProjectDetailDialog';
import { getErrorMessage, logTauriError } from '@/lib/utils';

export function PM() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<PmProject[]>([]);
  const [settings, setSettings] = useState<PmSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prj, sett] = await Promise.all([
        pmApi.getPmProjects(),
        pmApi.getPmSettings(),
      ]);
      setProjects(prj);
      setSettings(sett);
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to load PM data'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Stan: brak skonfigurowanego folderu -> pokaż setup
  // Stan: folder OK -> pokaż listę projektów z toolbar (New, Refresh)
  // Stan: loading/error -> odpowiednie komunikaty

  const handleSetWorkFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === 'string') {
        await pmApi.setPmWorkFolder(selected);
        await loadData();
      }
    } catch (e) {
      logTauriError('pm set work folder', e);
    }
  };

  // ... Render: header, toolbar, lista, dialogi
}
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/PM.tsx dashboard/src/components/pm/PmProjectsList.tsx
git commit -m "feat(pm): add PM page with project list component"
```

---

## Task 6: Dialog tworzenia projektu PM

**Files:**
- Create: `dashboard/src/components/pm/PmCreateProjectDialog.tsx`

- [ ] **Step 1: Utwórz dialog**

Dialog z polami: Klient, Nazwa projektu, Opis, Budżet, Termin, **Szablon drzewa folderów**.
Numer projektu i rok generowane automatycznie (wyświetlone jako readonly preview).

Pola:
- `prj_client` — input text, wymagane
- `prj_name` — input text, wymagane
- `prj_desc` — textarea
- `prj_budget` — input text
- `prj_term` — input date
- `template_id` — select dropdown z dostępnych szablonów (domyślnie: ten z `is_default: true`)

Preview wygenerowanej nazwy folderu: `{nr}_{year}_{client}_{name}`
Preview drzewa folderów: lista folderów z wybranego szablonu (z podglądem resolved nazw).

Przycisk "Utwórz" → wywołuje `pmApi.createPmProject(...)` → zamyka dialog → odświeża listę.

Dialog przy otwarciu ładuje szablony via `pmApi.getPmTemplates()`.

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/components/pm/PmCreateProjectDialog.tsx
git commit -m "feat(pm): add create PM project dialog with auto-numbering"
```

---

## Task 7: Dialog szczegółów / edycji projektu PM

**Files:**
- Create: `dashboard/src/components/pm/PmProjectDetailDialog.tsx`

- [ ] **Step 1: Utwórz dialog**

Wyświetla szczegóły projektu (tryb readonly) z przyciskiem Edit.
W trybie edycji: klient, nazwa, opis, budżet, termin, status (dropdown: Aktywny/Nieaktywny/Archiwalny).

Wyświetla też: rozmiar folderu (jeśli istnieje), pełną ścieżkę.

Akcja "Zapisz" → `pmApi.updatePmProject(index, project)` → zamknięcie → odświeżenie listy.

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/components/pm/PmProjectDetailDialog.tsx
git commit -m "feat(pm): add PM project detail/edit dialog"
```

---

## Task 8: Zarządzanie szablonami drzew folderów

**Files:**
- Create: `dashboard/src/components/pm/PmTemplateManager.tsx`

- [ ] **Step 1: Utwórz komponent PmTemplateManager**

Komponent dostępny ze strony PM (np. przycisk "Szablony" w toolbarze). Wyświetla:

1. **Lista szablonów** — tabela z kolumnami: Nazwa, Liczba folderów, Domyślny (badge), Akcje (edytuj/usuń)
2. **Tworzenie nowego szablonu** — dialog z polami:
   - `name` — nazwa szablonu (input text, wymagane)
   - `folders` — lista folderów (textarea, jeden folder na linię, lub dynamiczna lista z przyciskami +/-)
   - Placeholder `{name}` w nazwie folderu zamieniany na nazwę projektu
   - Preview wynikowych nazw folderów (z przykładowym kodem i nazwą)
3. **Edycja szablonu** — ten sam formularz co tworzenie, wypełniony danymi
4. **Ustawienie domyślnego** — przycisk "Ustaw domyślny"
5. **Usuwanie** — z potwierdzeniem, blokada usuwania szablonu "default"

ID nowego szablonu generowane jako `template_{timestamp}`.

API:
- `pmApi.getPmTemplates()` — lista
- `pmApi.savePmTemplate(template)` — tworzenie/edycja (upsert po id)
- `pmApi.deletePmTemplate(id)` — usuwanie
- `pmApi.setDefaultPmTemplate(id)` — ustawienie domyślnego

- [ ] **Step 2: Podłącz do strony PM.tsx**

Dodaj przycisk "Szablony" (ikona `LayoutTemplate` z lucide-react) w toolbarze strony PM.
Stan `templatesOpen` kontroluje widoczność PmTemplateManager.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/pm/PmTemplateManager.tsx dashboard/src/pages/PM.tsx
git commit -m "feat(pm): add folder tree template manager with CRUD and default selection"
```

---

## Task 9: Tłumaczenia i18n (PL + EN)

**Files:**
- Modify: `dashboard/src/locales/pl/common.json`
- Modify: `dashboard/src/locales/en/common.json`

- [ ] **Step 1: Dodaj klucze tłumaczeń PM**

Sekcja `pm` w obu plikach (format: EN / PL):

```json
{
  "pm": {
    "title": "PM — Project Manager" / "PM — Menedżer Projektów",
    "no_work_folder": "Work folder not configured" / "Folder roboczy nie skonfigurowany",
    "set_work_folder": "Set work folder" / "Ustaw folder roboczy",
    "new_project": "New project" / "Nowy projekt",
    "refresh": "Refresh" / "Odśwież",
    "templates": "Templates" / "Szablony",
    "columns": {
      "number": "No." / "Nr",
      "year": "Year" / "Rok",
      "client": "Client" / "Klient",
      "name": "Name" / "Nazwa",
      "status": "Status" / "Status",
      "budget": "Budget" / "Budżet",
      "term": "Deadline" / "Termin",
      "size": "Size" / "Rozmiar"
    },
    "status": {
      "active": "Active" / "Aktywny",
      "inactive": "Inactive" / "Nieaktywny",
      "archived": "Archived" / "Archiwalny"
    },
    "create": {
      "title": "New PM Project" / "Nowy Projekt PM",
      "client": "Client name" / "Nazwa klienta",
      "name": "Project name" / "Nazwa projektu",
      "desc": "Description" / "Opis",
      "budget": "Budget" / "Budżet",
      "term": "Deadline" / "Termin",
      "template": "Folder template" / "Szablon folderów",
      "preview": "Folder name" / "Nazwa folderu",
      "folder_preview": "Folder tree preview" / "Podgląd drzewa folderów",
      "submit": "Create" / "Utwórz"
    },
    "detail": {
      "title": "Project details" / "Szczegóły projektu",
      "edit": "Edit" / "Edytuj",
      "save": "Save" / "Zapisz",
      "cancel": "Cancel" / "Anuluj",
      "folder_path": "Folder path" / "Ścieżka folderu",
      "folder_size": "Folder size" / "Rozmiar folderu",
      "folder_not_found": "Folder not found" / "Folder nie istnieje"
    },
    "template_manager": {
      "title": "Folder tree templates" / "Szablony drzew folderów",
      "new_template": "New template" / "Nowy szablon",
      "template_name": "Template name" / "Nazwa szablonu",
      "folders_list": "Folders (one per line)" / "Foldery (jeden na linię)",
      "folders_count": "Folders" / "Foldery",
      "default_badge": "Default" / "Domyślny",
      "set_default": "Set as default" / "Ustaw jako domyślny",
      "delete_confirm": "Delete this template?" / "Usunąć ten szablon?",
      "cannot_delete_default": "Cannot delete default template" / "Nie można usunąć domyślnego szablonu",
      "placeholder_hint": "Use {name} for project name" / "Użyj {name} dla nazwy projektu",
      "preview": "Preview" / "Podgląd"
    },
    "errors": {
      "client_required": "Client name is required" / "Nazwa klienta jest wymagana",
      "name_required": "Project name is required" / "Nazwa projektu jest wymagana",
      "create_failed": "Failed to create project" / "Nie udało się utworzyć projektu",
      "load_failed": "Failed to load PM data" / "Nie udało się wczytać danych PM"
    },
    "empty": "No projects yet" / "Brak projektów",
    "total_projects": "Total projects" / "Łącznie projektów",
    "this_year": "This year" / "W tym roku"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/locales/pl/common.json dashboard/src/locales/en/common.json
git commit -m "feat(pm): add PL and EN translations for PM section"
```

---

## Task 10: Help.tsx — sekcja PM

**Files:**
- Modify: `dashboard/src/pages/Help.tsx`

- [ ] **Step 1: Dodaj sekcję PM do Help**

Zgodnie z konwencją Help.tsx (SectionHelp + createInlineTranslator), dodaj sekcję opisującą PM:

Zawartość:
- **Co to robi:** Zarządzanie projektami klienckimi — tworzenie, edycja, przeglądanie. Automatyczne numerowanie, struktura folderów. Konfigurowalne szablony drzew folderów.
- **Kiedy użyć:** Do organizacji pracy projektowej — tworzenie nowego projektu tworzy folder z podfolderami wg wybranego szablonu (domyślnie: CAD, 3D, materiały, etc.).
- **Szablony:** Domyślny szablon odpowiada oryginalnemu PM. Można tworzyć własne szablony z dowolną strukturą folderów. Placeholder `{name}` w nazwie folderu zamieniany na nazwę projektu.
- **Ograniczenia:** Wymaga skonfigurowanego folderu roboczego. Dane przechowywane w pliku JSON (kompatybilne z PM Python).

Dodaj też wpis do nawigacji pomocy w `dashboard/src/lib/help-navigation.ts`.

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/Help.tsx dashboard/src/lib/help-navigation.ts
git commit -m "docs(pm): add PM section to Help page"
```

---

## Task 11: Integracja i weryfikacja

- [ ] **Step 1: TypeScript check**

Run: `cd dashboard && npx tsc --noEmit`
Expected: brak błędów

- [ ] **Step 2: Sprawdź Rust compilation**

Run: `cd dashboard/src-tauri && cargo check`
Expected: brak błędów

- [ ] **Step 3: Testy manualne**

Scenariusze do przetestowania:
1. Otwórz dashboard → sekcja PM widoczna w sidebarze
2. Kliknij PM → komunikat o konfiguracji folderu (jeśli nie ustawiony)
3. Ustaw folder roboczy → pojawi się pusta lista
4. Utwórz nowy projekt (domyślny szablon) → pojawi się na liście, folder z 17 podfolderami na dysku
5. Kliknij projekt → dialog szczegółów
6. Edytuj projekt → zmiany zapisane
7. Otwórz menedżer szablonów → widoczny szablon "CONCEPTFAB (default)"
8. Utwórz nowy szablon (np. "Minimal" z 3 folderami) → pojawia się na liście
9. Ustaw nowy szablon jako domyślny → badge "Domyślny" przenosi się
10. Utwórz projekt z nowym szablonem → folder z 3 podfolderami na dysku
11. Usuń szablon niestandardowy → znika z listy, szablon "default" nie daje się usunąć
12. Pomoc → sekcja PM widoczna z opisem szablonów

- [ ] **Step 4: Final commit**

```bash
git commit -m "feat(pm): PM section integration complete"
```

---

## Uwagi

1. **Zgodność danych:** Format JSON jest identyczny z Pythonem — ten sam plik `projects_list.json` w `00_PM_NX/`.
2. **Bezpieczeństwo:** NIE przenosimy `settings.txt` z hasłami. PM w dashboardzie potrzebuje tylko `work_folder`.
3. **Backup:** Przed każdym zapisem tworzony jest backup `projects_list.json` (jak w Pythonie).
4. **Szablony:** Plik `pm_templates.json` to nowy plik (nie istnieje w PM Python). Domyślny szablon jest hardcoded w Rust i tworzony automatycznie jeśli plik nie istnieje.
5. **Folder 16:** W oryginale Python ma bug (pusty string w formatowaniu) — domyślny szablon zawiera `___REF___` co daje `16_{code}___REF___` (kompatybilne).
