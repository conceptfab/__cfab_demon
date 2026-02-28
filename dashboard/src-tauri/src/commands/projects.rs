use std::collections::HashMap;
use std::sync::atomic::Ordering;
use tauri::AppHandle;

use super::analysis::compute_project_activity_unique;
use super::helpers::{LAST_PRUNE_EPOCH_SECS, PRUNE_CACHE_TTL_SECS};
use super::types::{
    DateRange, FolderProjectCandidate, Project, ProjectDbStats, ProjectExtraInfo, ProjectFolder,
    ProjectWithStats, TopApp,
};
use crate::db;
use rusqlite::OptionalExtension;



pub(crate) fn load_project_folders_from_db(
    conn: &rusqlite::Connection,
) -> Result<Vec<ProjectFolder>, String> {
    let mut stmt = conn
        .prepare_cached("SELECT path, added_at FROM project_folders ORDER BY added_at")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ProjectFolder {
                path: row.get(0)?,
                added_at: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows
        .filter_map(|r| r.map_err(|e| log::warn!("Row error: {}", e)).ok())
        .collect())
}

fn cleanup_missing_project_folders(conn: &rusqlite::Connection) -> Result<usize, String> {
    let folders = load_project_folders_from_db(conn)?;
    let missing: Vec<&str> = folders
        .iter()
        .filter(|f| {
            let p = std::path::PathBuf::from(&f.path);
            !(p.exists() && p.is_dir())
        })
        .map(|f| f.path.as_str())
        .collect();

    if missing.is_empty() {
        return Ok(0);
    }

    let placeholders: Vec<String> = (1..=missing.len())
        .map(|i| format!("lower(?{})", i))
        .collect();
    let sql = format!(
        "DELETE FROM project_folders WHERE lower(path) IN ({})",
        placeholders.join(", ")
    );
    let params: Vec<&dyn rusqlite::types::ToSql> = missing
        .iter()
        .map(|s| s as &dyn rusqlite::types::ToSql)
        .collect();
    let removed = conn
        .execute(&sql, params.as_slice())
        .map_err(|e| e.to_string())?;

    if removed > 0 {
        log::info!(
            "Removed {} missing project folder(s) from database during refresh",
            removed
        );
    }
    Ok(removed)
}

fn prune_projects_missing_on_disk(conn: &rusqlite::Connection) -> Result<usize, String> {
    // Safety: never delete user projects during background refresh.
    // Keep only folder-root cleanup here to avoid stale paths.
    let removed_folders = cleanup_missing_project_folders(conn)?;
    if removed_folders > 0 {
        log::info!(
            "Cleaned {} missing project folder root(s) during refresh",
            removed_folders
        );
    }
    Ok(0)
}

fn prune_if_stale(conn: &rusqlite::Connection) -> Result<usize, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let last = LAST_PRUNE_EPOCH_SECS.load(Ordering::Relaxed);
    if now.saturating_sub(last) < PRUNE_CACHE_TTL_SECS {
        return Ok(0);
    }
    let result = prune_projects_missing_on_disk(conn);
    if result.is_ok() {
        LAST_PRUNE_EPOCH_SECS.store(now, Ordering::Relaxed);
    }
    result
}

fn hsl_to_hex(h: f64, s: f64, l: f64) -> String {
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let hp = (h / 60.0) % 6.0;
    let x = c * (1.0 - ((hp % 2.0) - 1.0).abs());
    let (r1, g1, b1) = if (0.0..1.0).contains(&hp) {
        (c, x, 0.0)
    } else if (1.0..2.0).contains(&hp) {
        (x, c, 0.0)
    } else if (2.0..3.0).contains(&hp) {
        (0.0, c, x)
    } else if (3.0..4.0).contains(&hp) {
        (0.0, x, c)
    } else if (4.0..5.0).contains(&hp) {
        (x, 0.0, c)
    } else {
        (c, 0.0, x)
    };
    let m = l - c / 2.0;
    let r = ((r1 + m) * 255.0).round().clamp(0.0, 255.0) as u8;
    let g = ((g1 + m) * 255.0).round().clamp(0.0, 255.0) as u8;
    let b = ((b1 + m) * 255.0).round().clamp(0.0, 255.0) as u8;
    format!("#{:02x}{:02x}{:02x}", r, g, b)
}

pub(crate) fn project_color_for_name(name: &str) -> String {
    let hash = name
        .bytes()
        .fold(0u32, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u32));
    let hue = (hash % 360) as f64;
    let sat = 0.62 + ((hash >> 9) % 18) as f64 / 100.0; // 0.62..0.79
    let light = 0.52 + ((hash >> 17) % 14) as f64 / 100.0; // 0.52..0.65
    hsl_to_hex(hue, sat.min(0.82), light.min(0.68))
}

fn normalized_project_name_key(name: &str) -> Option<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_lowercase())
}

fn project_row_exists_by_name(conn: &rusqlite::Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) > 0 FROM projects WHERE lower(name) = lower(?1)",
        [name],
        |row| row.get(0),
    )
    .unwrap_or(false)
}

pub(crate) fn project_name_is_blacklisted(conn: &rusqlite::Connection, name: &str) -> bool {
    let Some(name_key) = normalized_project_name_key(name) else {
        return false;
    };
    conn.query_row(
        "SELECT COUNT(*) > 0 FROM project_name_blacklist WHERE name_key = ?1",
        [name_key],
        |row| row.get(0),
    )
    .unwrap_or(false)
}

pub(crate) fn project_id_is_active(
    conn: &rusqlite::Connection,
    project_id: i64,
) -> Result<bool, String> {
    conn.query_row(
        "SELECT COUNT(*) > 0 FROM projects WHERE id = ?1 AND excluded_at IS NULL",
        [project_id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

pub(crate) fn project_exists_by_name(conn: &rusqlite::Connection, name: &str) -> bool {
    project_row_exists_by_name(conn, name) || project_name_is_blacklisted(conn, name)
}

pub(crate) fn create_project_if_missing(
    conn: &rusqlite::Connection,
    name: &str,
) -> Result<bool, String> {
    let name = name.trim();
    if name.is_empty() {
        return Ok(false);
    }
    if project_name_is_blacklisted(conn, name) {
        log::info!("Skipping blacklisted project name '{}'", name);
        return Ok(false);
    }
    if project_row_exists_by_name(conn, name) {
        return Ok(false);
    }
    conn.execute(
        "INSERT INTO projects (name, color) VALUES (?1, ?2)",
        rusqlite::params![name, project_color_for_name(name)],
    )
    .map_err(|e| e.to_string())?;
    Ok(true)
}

/// Checks if the file path suggests it belongs to a project
fn infer_project_from_path(file_path: &str, project_roots: &[ProjectFolder]) -> Option<String> {
    let path = std::path::Path::new(file_path);

    // Check each project folder
    for root in project_roots {
        let root_path = std::path::Path::new(&root.path);
        match path.strip_prefix(&root_path) {
            Ok(relative_path) => {
                // The file is inside a project folder
                // Extract the project name from the path
                if let Some(first_component) = relative_path.components().next() {
                    let project_name = first_component.as_os_str().to_string_lossy().into_owned();
                    return Some(project_name);
                }
            }
            Err(_) => {}
        }
    }
    None
}

/// Attempts to extract the project name from the file title.
fn infer_project_name_from_file_title(
    title: &str,
    project_roots: &[ProjectFolder],
) -> Option<String> {
    // First check the file path
    if let Some(project_from_path) = infer_project_from_path(title, project_roots) {
        return Some(project_from_path);
    }

    // If the title has the format "file - folder", extract the folder as the project name
    if let Some(pos) = title.rfind(" - ") {
        let candidate = title[pos + 3..].trim();
        if !candidate.is_empty() {
            return Some(candidate.to_string());
        }
    }

    // If no other method worked, pass the full text as fallback
    // ensure_app_project_from_file_hint will check the extracted text first,
    // and if not, it will try the original.
    Some(title.trim().to_string())
}

/// If the project name from the file matches an existing project,
/// returns the project_id for the file.
pub(crate) fn ensure_app_project_from_file_hint(
    conn: &rusqlite::Connection,
    file_name: &str,
    project_roots: &[ProjectFolder],
) -> Option<i64> {
    if file_name.trim() == "(background)" {
        return None;
    }

    let mut candidates = Vec::new();

    // First the full string and path heuristics.
    candidates.push(file_name.trim().to_string());
    if let Some(inferred) = infer_project_name_from_file_title(file_name, project_roots) {
        candidates.push(inferred);
    }

    // Next, add EACH part after splitting by hyphen as a potential project name.
    // If the window is e.g. "__timeflow_demon - Antigravity", we check both "__timeflow_demon" and "Antigravity".
    for part in file_name.split(" - ") {
        let trimmed = part.trim();
        if !trimmed.is_empty() {
            candidates.push(trimmed.to_string());
        }
    }

    // Also check alternative separators that the demon sometimes leaves
    for part in file_name.split(" | ") {
        let trimmed = part.trim();
        if !trimmed.is_empty() && !candidates.contains(&trimmed.to_string()) {
            candidates.push(trimmed.to_string());
        }
    }

    for candidate_name in candidates {
        let proj_id: Option<i64> = match conn.query_row(
            "SELECT id
             FROM projects
             WHERE lower(name) = lower(?1)
               AND excluded_at IS NULL",
            [candidate_name.as_str()],
            |row| row.get(0),
        ) {
            Ok(id) => Some(id),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => {
                log::warn!(
                    "Failed to resolve project '{}' from file hint '{}': {}",
                    candidate_name,
                    file_name,
                    e
                );
                None
            }
        };

        if proj_id.is_some() {
            return proj_id;
        }
    }

    None
}

fn query_projects_with_stats(
    conn: &rusqlite::Connection,
    excluded: bool,
    date_range: Option<&DateRange>,
) -> Result<Vec<ProjectWithStats>, String> {
    let filter = if excluded {
        "p.excluded_at IS NOT NULL"
    } else {
        "p.excluded_at IS NULL"
    };

    let (min_date, max_date): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT MIN(d), MAX(d)
             FROM (
                 SELECT date as d FROM sessions
                 UNION ALL
                 SELECT date as d FROM manual_sessions
             )",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let mut all_time_totals: std::collections::HashMap<String, i64> =
        std::collections::HashMap::new();
    let mut period_totals: std::collections::HashMap<String, i64> =
        std::collections::HashMap::new();

    // 1. Always compute All-Time totals
    if let (Some(start), Some(end)) = (min_date.clone(), max_date.clone()) {
        let (_, totals, _, _) =
            compute_project_activity_unique(conn, &DateRange { start, end }, false, false, None)?;
        all_time_totals = totals
            .into_iter()
            .map(|(name, seconds)| (name.to_lowercase(), seconds.round() as i64))
            .collect();
    }

    // 2. Compute Period totals if date_range is provided
    if let Some(range) = date_range {
        let (_, totals, _, _) = compute_project_activity_unique(conn, range, false, false, None)?;
        period_totals = totals
            .into_iter()
            .map(|(name, seconds)| (name.to_lowercase(), seconds.round() as i64))
            .collect();
    }

    let sql = format!(
        "SELECT p.id, p.name, p.color, p.created_at, p.excluded_at,
                COUNT(DISTINCT a.id) as app_count,
                (SELECT MAX(s.end_time)
                 FROM sessions s
                 JOIN applications a2 ON a2.id = s.app_id
                 WHERE a2.project_id = p.id) as last_session_activity,
                (SELECT MAX(ms.end_time)
                 FROM manual_sessions ms
                 WHERE ms.project_id = p.id) as last_manual_activity,
                p.assigned_folder_path,
                p.frozen_at
         FROM projects p
         LEFT JOIN applications a ON a.project_id = p.id
         WHERE {}
         GROUP BY p.id
         ORDER BY p.id",
        filter
    );
    let mut stmt = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let name: String = row.get(1)?;
            let key = name.to_lowercase();
            let last_session: Option<String> = row.get(6)?;
            let last_manual: Option<String> = row.get(7)?;
            let last_activity = match (last_session, last_manual) {
                (Some(a), Some(b)) => Some(if a >= b { a } else { b }),
                (Some(a), None) => Some(a),
                (None, Some(b)) => Some(b),
                (None, None) => None,
            };
            Ok(ProjectWithStats {
                id: row.get(0)?,
                name,
                color: row.get(2)?,
                created_at: row.get::<_, String>(3).unwrap_or_default(),
                excluded_at: row.get(4)?,
                total_seconds: *all_time_totals.get(&key).unwrap_or(&0),
                period_seconds: if date_range.is_some() {
                    Some(*period_totals.get(&key).unwrap_or(&0))
                } else {
                    None
                },
                app_count: row.get(5)?,
                last_activity,
                assigned_folder_path: row.get(8)?,
                frozen_at: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out: Vec<ProjectWithStats> = rows
        .filter_map(|r| r.map_err(|e| log::warn!("Row error: {}", e)).ok())
        .collect();

    if excluded {
        out.sort_by(|a, b| {
            b.excluded_at
                .as_deref()
                .unwrap_or("")
                .cmp(a.excluded_at.as_deref().unwrap_or(""))
        });
    } else {
        out.sort_by(|a, b| {
            b.total_seconds
                .cmp(&a.total_seconds)
                .then_with(|| a.name.cmp(&b.name))
        });
    }

    Ok(out)
}

pub(crate) fn collect_project_subfolders(roots: &[ProjectFolder]) -> Vec<(String, String, String)> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for root in roots {
        let root_path = std::path::PathBuf::from(&root.path);
        if !root_path.exists() || !root_path.is_dir() {
            continue;
        }
        let entries = match std::fs::read_dir(&root_path) {
            Ok(v) => v,
            Err(_) => continue,
        };
        for entry in entries.filter_map(|e| e.ok()) {
            let p = entry.path();
            if !p.is_dir() {
                continue;
            }
            let name = match p.file_name().map(|n| n.to_string_lossy().to_string()) {
                Some(v) if !v.trim().is_empty() => v,
                _ => continue,
            };
            let folder_path = p.to_string_lossy().to_string();
            if !seen.insert(folder_path.clone()) {
                continue;
            }
            out.push((name, folder_path, root.path.clone()));
        }
    }
    out
}

// ==================== Tauri Commands ====================

#[tauri::command]
pub async fn freeze_project(app: AppHandle, id: i64) -> Result<(), String> {
    let conn = db::get_connection(&app)?;
    conn.execute(
        "UPDATE projects
         SET frozen_at = datetime('now'),
             unfreeze_reason = NULL
         WHERE id = ?1
           AND excluded_at IS NULL",
        [id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn unfreeze_project(app: AppHandle, id: i64) -> Result<(), String> {
    let conn = db::get_connection(&app)?;
    conn.execute(
        "UPDATE projects
         SET frozen_at = NULL,
             unfreeze_reason = datetime('now')
         WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct AutoFreezeResult {
    pub frozen_count: i64,
    pub unfrozen_count: i64,
}

#[tauri::command]
pub async fn auto_freeze_projects(
    app: AppHandle,
    threshold_days: Option<i64>,
) -> Result<AutoFreezeResult, String> {
    let days = threshold_days.unwrap_or(14).max(1);
    let conn = db::get_connection(&app)?;

    // Clear stale unfreeze_reason timestamps (older than threshold) for cleanliness
    let _clear_old = conn
        .execute(
            "UPDATE projects
             SET unfreeze_reason = NULL
             WHERE excluded_at IS NULL
               AND unfreeze_reason IS NOT NULL
               AND julianday(unfreeze_reason) < julianday('now', '-' || ?1 || ' days')",
            [days],
        )
        .map_err(|e| e.to_string())?;

    // Freeze projects inactive longer than threshold.
    // Activity sources: sessions, manual_sessions, file_activities, recent manual unfreeze.
    let frozen = conn
        .execute(
            "UPDATE projects
             SET frozen_at = datetime('now'),
                 unfreeze_reason = NULL
             WHERE excluded_at IS NULL
               AND frozen_at IS NULL
               AND id NOT IN (
                   SELECT DISTINCT s.project_id FROM sessions s
                   WHERE s.project_id IS NOT NULL
                     AND julianday(s.end_time) >= julianday('now', '-' || ?1 || ' days')
                   UNION
                   SELECT DISTINCT p.id FROM projects p
                   JOIN applications a ON a.project_id = p.id
                   JOIN sessions s ON s.app_id = a.id
                   WHERE julianday(s.end_time) >= julianday('now', '-' || ?1 || ' days')
                   UNION
                   SELECT DISTINCT project_id FROM manual_sessions
                   WHERE julianday(end_time) >= julianday('now', '-' || ?1 || ' days')
                   UNION
                   SELECT DISTINCT project_id FROM file_activities
                   WHERE project_id IS NOT NULL
                     AND julianday(last_seen) >= julianday('now', '-' || ?1 || ' days')
                   UNION
                   SELECT id FROM projects
                   WHERE unfreeze_reason IS NOT NULL
                     AND julianday(unfreeze_reason) >= julianday('now', '-' || ?1 || ' days')
               )",
            [days],
        )
        .map_err(|e| e.to_string())? as i64;

    // Unfreeze projects that regained activity within the threshold
    let unfrozen = conn
        .execute(
            "UPDATE projects
             SET frozen_at = NULL
             WHERE frozen_at IS NOT NULL
               AND excluded_at IS NULL
               AND id IN (
                   SELECT DISTINCT s.project_id FROM sessions s
                   WHERE s.project_id IS NOT NULL
                     AND julianday(s.end_time) >= julianday('now', '-' || ?1 || ' days')
                   UNION
                   SELECT DISTINCT p.id FROM projects p
                   JOIN applications a ON a.project_id = p.id
                   JOIN sessions s ON s.app_id = a.id
                   WHERE julianday(s.end_time) >= julianday('now', '-' || ?1 || ' days')
                   UNION
                   SELECT DISTINCT project_id FROM manual_sessions
                   WHERE julianday(end_time) >= julianday('now', '-' || ?1 || ' days')
                   UNION
                   SELECT DISTINCT project_id FROM file_activities
                   WHERE project_id IS NOT NULL
                     AND julianday(last_seen) >= julianday('now', '-' || ?1 || ' days')
               )",
            [days],
        )
        .map_err(|e| e.to_string())? as i64;

    Ok(AutoFreezeResult {
        frozen_count: frozen,
        unfrozen_count: unfrozen,
    })
}

#[tauri::command]
pub async fn get_projects(
    app: AppHandle,
    date_range: Option<DateRange>,
) -> Result<Vec<ProjectWithStats>, String> {
    let conn = db::get_connection(&app)?;
    prune_if_stale(&conn)?;
    query_projects_with_stats(&conn, false, date_range.as_ref())
}

#[tauri::command]
pub async fn get_excluded_projects(
    app: AppHandle,
    date_range: Option<DateRange>,
) -> Result<Vec<ProjectWithStats>, String> {
    let conn = db::get_connection(&app)?;
    prune_if_stale(&conn)?;
    query_projects_with_stats(&conn, true, date_range.as_ref())
}

#[tauri::command]
pub async fn create_project(
    app: AppHandle,
    name: String,
    color: String,
    assigned_folder_path: Option<String>,
) -> Result<Project, String> {
    let conn = db::get_connection(&app)?;
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Project name is required".to_string());
    }
    if project_name_is_blacklisted(&conn, &name) {
        return Err("Project name is on the excluded blacklist".to_string());
    }
    if project_row_exists_by_name(&conn, &name) {
        return Err("Project already exists".to_string());
    }

    let mut normalized_folder = None;
    if let Some(path) = assigned_folder_path {
        let raw = path.trim();
        if !raw.is_empty() {
            if let Ok(canonical) = std::fs::canonicalize(raw) {
                if canonical.is_dir() {
                    let norm = canonical.to_string_lossy().to_string();
                    let added_at = chrono::Local::now().to_rfc3339();
                    conn.execute(
                        "INSERT OR IGNORE INTO project_folders (path, added_at) VALUES (?1, ?2)",
                        rusqlite::params![norm, added_at],
                    )
                    .map_err(|e| e.to_string())?;
                    normalized_folder = Some(norm);
                }
            }
        }
    }

    conn.execute(
        "INSERT INTO projects (name, color, assigned_folder_path) VALUES (?1, ?2, ?3)",
        rusqlite::params![name, color, normalized_folder],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    Ok(Project {
        id,
        name,
        color,
        hourly_rate: None,
        created_at: chrono::Local::now().to_rfc3339(),
        excluded_at: None,
        frozen_at: None,
        assigned_folder_path: normalized_folder,
        is_imported: 0,
        updated_at: chrono::Local::now().to_rfc3339(),
    })
}

#[tauri::command]
pub async fn update_project(app: AppHandle, id: i64, color: String) -> Result<(), String> {
    let conn = db::get_connection(&app)?;
    let updated = conn
        .execute(
            "UPDATE projects SET color = ?2 WHERE id = ?1",
            rusqlite::params![id, color],
        )
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        return Err("Project not found".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn exclude_project(app: AppHandle, id: i64) -> Result<(), String> {
    let conn = db::get_connection(&app)?;
    if let Err(e) = conn.execute(
        "UPDATE applications SET project_id = NULL WHERE project_id = ?1",
        [id],
    ) {
        log::warn!(
            "Failed to clear project references for project {}: {}",
            id,
            e
        );
    }
    conn.execute(
        "UPDATE projects
         SET excluded_at = COALESCE(excluded_at, datetime('now'))
         WHERE id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn restore_project(app: AppHandle, id: i64) -> Result<(), String> {
    let conn = db::get_connection(&app)?;
    let project_name: Option<String> = conn
        .query_row("SELECT name FROM projects WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(name) = project_name {
        if let Some(name_key) = normalized_project_name_key(&name) {
            conn.execute(
                "DELETE FROM project_name_blacklist WHERE name_key = ?1",
                [name_key],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    conn.execute("UPDATE projects SET excluded_at = NULL WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_project(app: AppHandle, id: i64) -> Result<(), String> {
    let conn = db::get_connection(&app)?;
    if let Err(e) = conn.execute(
        "UPDATE applications SET project_id = NULL WHERE project_id = ?1",
        [id],
    ) {
        log::warn!(
            "Failed to clear project references for project {}: {}",
            id,
            e
        );
    }
    conn.execute("DELETE FROM projects WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn assign_app_to_project(
    app: AppHandle,
    app_id: i64,
    project_id: Option<i64>,
) -> Result<(), String> {
    let mut conn = db::get_connection(&app)?;
    if let Some(pid) = project_id {
        if !project_id_is_active(&conn, pid)? {
            return Err("Cannot assign app to an excluded or missing project".to_string());
        }
    }

    // Fetch old project id for feedback loop
    let old_project_id: Option<i64> = conn
        .query_row(
            "SELECT project_id FROM applications WHERE id = ?1",
            [app_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e: rusqlite::Error| e.to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE applications SET project_id = ?2 WHERE id = ?1",
        rusqlite::params![app_id, project_id],
    )
    .map_err(|e| e.to_string())?;

    match project_id {
        Some(pid) => {
            tx.execute(
                "UPDATE file_activities
                 SET project_id = ?2
                 WHERE app_id = ?1 AND (project_id IS NULL OR project_id = ?2)",
                rusqlite::params![app_id, pid],
            )
            .map_err(|e| e.to_string())?;
        }
        None => {
            tx.execute(
                "UPDATE file_activities SET project_id = NULL WHERE app_id = ?1",
                [app_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    // Insert feedback
    tx.execute(
        "INSERT INTO assignment_feedback (app_id, from_project_id, to_project_id, source, created_at)
         VALUES (?1, ?2, ?3, 'manual_app_assign', datetime('now'))",
        rusqlite::params![app_id, old_project_id, project_id],
    )
    .map_err(|e| e.to_string())?;

    // Increment feedback counter
    tx.execute(
        "INSERT INTO assignment_model_state (key, value, updated_at)
         VALUES ('feedback_since_train', '1', datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
           value = CAST(COALESCE(NULLIF(assignment_model_state.value, ''), '0') AS INTEGER) + 1,
           updated_at = datetime('now')",
        [],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_project_folders(app: AppHandle) -> Result<Vec<ProjectFolder>, String> {
    let conn = db::get_connection(&app)?;
    cleanup_missing_project_folders(&conn)?;
    load_project_folders_from_db(&conn)
}

#[tauri::command]
pub async fn add_project_folder(app: AppHandle, path: String) -> Result<(), String> {
    let raw = path.trim();
    if raw.is_empty() {
        return Err("Path cannot be empty".to_string());
    }
    log::info!("add_project_folder called with path='{}'", raw);
    let canonical = std::fs::canonicalize(raw).map_err(|e| e.to_string())?;
    if !canonical.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let normalized = canonical.to_string_lossy().to_string();
    let conn = db::get_connection(&app)?;
    let added_at = chrono::Local::now().to_rfc3339();
    conn.execute(
        "INSERT OR IGNORE INTO project_folders (path, added_at) VALUES (?1, ?2)",
        rusqlite::params![normalized, added_at],
    )
    .map_err(|e| e.to_string())?;

    let mut created = 0usize;
    let entries = std::fs::read_dir(&canonical).map_err(|e| e.to_string())?;
    for entry in entries.filter_map(|e| e.ok()) {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let name = match p.file_name().map(|n| n.to_string_lossy().to_string()) {
            Some(v) if !v.trim().is_empty() => v,
            _ => continue,
        };
        if create_project_if_missing(&conn, &name)? {
            created += 1;
        }
    }
    log::info!(
        "Added project root '{}' and auto-created {} project(s)",
        normalized,
        created
    );
    Ok(())
}

#[tauri::command]
pub async fn remove_project_folder(app: AppHandle, path: String) -> Result<(), String> {
    let normalized = path.trim().to_string();
    let conn = db::get_connection(&app)?;
    conn.execute(
        "DELETE FROM project_folders WHERE lower(path) = lower(?1)",
        [normalized],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_folder_project_candidates(
    app: AppHandle,
) -> Result<Vec<FolderProjectCandidate>, String> {
    let conn = db::get_connection(&app)?;
    let roots = load_project_folders_from_db(&conn)?;
    let mut out = Vec::new();
    for (name, folder_path, root_path) in collect_project_subfolders(&roots) {
        out.push(FolderProjectCandidate {
            already_exists: project_exists_by_name(&conn, &name),
            name,
            folder_path,
            root_path,
        });
    }

    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

#[tauri::command]
pub async fn create_project_from_folder(
    app: AppHandle,
    folder_path: String,
) -> Result<Project, String> {
    let canonical = std::fs::canonicalize(folder_path.trim()).map_err(|e| e.to_string())?;
    if !canonical.is_dir() {
        return Err("Folder does not exist".to_string());
    }
    let name = canonical
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| "Cannot infer project name from folder".to_string())?;
    let conn = db::get_connection(&app)?;
    if project_name_is_blacklisted(&conn, &name) {
        return Err("Project name is on the excluded blacklist".to_string());
    }
    if !create_project_if_missing(&conn, &name)? {
        return Err("Project already exists".to_string());
    }

    let id: i64 = conn
        .query_row(
            "SELECT id FROM projects WHERE lower(name)=lower(?1)",
            [&name],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(Project {
        id,
        name: name.clone(),
        color: project_color_for_name(&name),
        hourly_rate: None,
        created_at: chrono::Local::now().to_rfc3339(),
        excluded_at: None,
        frozen_at: None,
        assigned_folder_path: Some(folder_path),
        is_imported: 0,
        updated_at: chrono::Local::now().to_rfc3339(),
    })
}

#[tauri::command]
pub async fn sync_projects_from_folders(app: AppHandle) -> Result<usize, String> {
    let conn = db::get_connection(&app)?;
    let roots = load_project_folders_from_db(&conn)?;
    let mut created = 0usize;

    for (name, _, _) in collect_project_subfolders(&roots) {
        if create_project_if_missing(&conn, &name)? {
            created += 1;
        }
    }

    Ok(created)
}

#[tauri::command]
pub async fn auto_create_projects_from_detection(
    app: AppHandle,
    date_range: DateRange,
    min_occurrences: i64,
) -> Result<usize, String> {
    let conn = db::get_connection(&app)?;
    let threshold = min_occurrences.max(2);
    let mut stmt = conn
        .prepare_cached(
            "SELECT fa.file_name
             FROM file_activities fa
             WHERE fa.date >= ?1 AND fa.date <= ?2
             GROUP BY fa.file_name
             HAVING COUNT(DISTINCT fa.date) >= ?3",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(
            rusqlite::params![date_range.start, date_range.end, threshold],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?;

    // Load app display names to avoid creating projects from app names
    let app_names: Vec<String> = conn
        .prepare_cached("SELECT LOWER(display_name) FROM applications")
        .and_then(|mut s| {
            s.query_map([], |row| row.get::<_, String>(0))
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
        })
        .unwrap_or_default();

    let mut created = 0usize;
    for file_name in rows.filter_map(|r| r.ok()) {
        let candidate = file_name.trim();
        if candidate.is_empty() || candidate.len() > 200 || candidate.contains(['/', '\\', '\0']) {
            continue;
        }

        // Extract project name from file name
        // If the name cannot be extracted (e.g. single file without context), skip
        let project_name = match infer_project_name_from_file_title(candidate, &[]) {
            Some(name) => name,
            None => continue,
        };

        // Skip if the name is a single file (contains extension, e.g. "TODO.md")
        if project_name.contains('.') && !project_name.contains(['/', '\\']) {
            continue;
        }

        // Skip if the name matches an application name (e.g. "Antigravity" = antigravity.exe)
        if app_names.contains(&project_name.to_lowercase()) {
            continue;
        }

        if create_project_if_missing(&conn, &project_name)? {
            created += 1;
        }
    }
    Ok(created)
}
#[tauri::command]
pub async fn get_project_extra_info(
    app: AppHandle,
    id: i64,
    date_range: DateRange,
) -> Result<ProjectExtraInfo, String> {
    let conn = db::get_connection(&app)?;

    // 1. Get project info (name, hourly_rate)
    let (name, hourly_rate): (String, Option<f64>) = conn
        .query_row(
            "SELECT name, hourly_rate FROM projects WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("Project not found: {}", e))?;

    // 2. Get global hourly rate
    let global_rate_str: Option<String> = conn
        .query_row(
            "SELECT value FROM estimate_settings WHERE key = 'global_hourly_rate' LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let global_rate = global_rate_str
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(100.0);

    let effective_rate = hourly_rate.unwrap_or(global_rate);

    // 3. Compute values
    // To match estimates.rs exactly, we need use the same logic for determining which sessions belong to a project.

    let (min_date, max_date): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT MIN(d), MAX(d)
             FROM (
                 SELECT date as d FROM sessions
                 UNION ALL
                 SELECT date as d FROM manual_sessions
             )",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    // Helper to get weighted extra seconds for a date range and SPECIFIC project ID
    let get_extra_secs =
        |conn: &rusqlite::Connection, start: &str, end: &str, p_id: i64| -> Result<f64, String> {
            conn.query_row(
                "WITH session_project_overlap AS (
                SELECT s.id as session_id,
                       fa.project_id as project_id,
                       SUM(
                           MAX(
                               0,
                               MIN(strftime('%s', s.end_time), strftime('%s', fa.last_seen)) -
                               MAX(strftime('%s', s.start_time), strftime('%s', fa.first_seen))
                           )
                       ) as overlap_seconds,
                       (strftime('%s', s.end_time) - strftime('%s', s.start_time)) as span_seconds
                FROM sessions s
                JOIN file_activities fa
                  ON fa.app_id = s.app_id
                 AND fa.date = s.date
                 AND fa.project_id IS NOT NULL
                 AND fa.last_seen > s.start_time
                 AND fa.first_seen < s.end_time
                WHERE s.date >= ?1 AND s.date <= ?2 AND (s.is_hidden IS NULL OR s.is_hidden = 0)
                GROUP BY s.id, fa.project_id
            ),
            ranked_overlap AS (
                SELECT session_id, project_id, overlap_seconds, span_seconds,
                       ROW_NUMBER() OVER (
                           PARTITION BY session_id
                           ORDER BY overlap_seconds DESC, project_id ASC
                       ) as rn,
                       COUNT(*) OVER (PARTITION BY session_id) as project_count
                FROM session_project_overlap
            ),
            session_projects AS (
                SELECT s.id,
                       CASE
                           WHEN s.project_id IS NOT NULL THEN s.project_id
                           WHEN ro.project_count = 1
                            AND ro.overlap_seconds * 2 >= ro.span_seconds
                           THEN ro.project_id
                           ELSE NULL
                       END as project_id,
                       CAST(s.duration_seconds AS REAL) as duration_seconds,
                       CASE
                           WHEN s.rate_multiplier IS NULL OR s.rate_multiplier <= 0 THEN 1.0
                           ELSE s.rate_multiplier
                       END as rate_multiplier
                FROM sessions s
                LEFT JOIN ranked_overlap ro
                  ON ro.session_id = s.id
                 AND ro.rn = 1
                WHERE s.date >= ?1 AND s.date <= ?2 AND (s.is_hidden IS NULL OR s.is_hidden = 0)
            )
            SELECT SUM(CASE 
                        WHEN sp.rate_multiplier <= 1.0 THEN 0.0 
                        ELSE (sp.duration_seconds * (sp.rate_multiplier - 1.0)) 
                       END)
            FROM session_projects sp
            WHERE sp.project_id = ?3",
                rusqlite::params![start, end, p_id],
                |row| Ok(row.get::<_, Option<f64>>(0)?.unwrap_or(0.0)),
            )
            .map_err(|e| e.to_string())
        };

    // Calculate All-Time (Global) Value
    let mut current_value = 0.0;
    if let (Some(start), Some(end)) = (min_date, max_date) {
        let (_, totals_raw, _, _) = compute_project_activity_unique(
            &conn,
            &DateRange {
                start: start.clone(),
                end: end.clone(),
            },
            false,
            false,
            None,
        )?;
        let totals: HashMap<String, f64> = totals_raw
            .into_iter()
            .map(|(k, v)| (k.to_lowercase(), v))
            .collect();
        let clock_seconds = totals.get(&name.to_lowercase()).cloned().unwrap_or(0.0);
        let extra_seconds = get_extra_secs(&conn, &start, &end, id)?;
        current_value = ((clock_seconds + extra_seconds) / 3600.0) * effective_rate;
    }

    // Calculate Period Value (for the selected range)
    let (_, period_totals_raw, _, _) =
        compute_project_activity_unique(&conn, &date_range, false, false, None)?;
    let period_totals: HashMap<String, f64> = period_totals_raw
        .into_iter()
        .map(|(k, v)| (k.to_lowercase(), v))
        .collect();
    let period_clock_seconds = period_totals
        .get(&name.to_lowercase())
        .cloned()
        .unwrap_or(0.0);
    let period_extra_seconds = get_extra_secs(&conn, &date_range.start, &date_range.end, id)?;
    let period_value = ((period_clock_seconds + period_extra_seconds) / 3600.0) * effective_rate;

    // 4. DB Stats
    let session_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sessions s LEFT JOIN applications a ON a.id = s.app_id WHERE a.project_id = ?1 OR s.project_id = ?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let file_activity_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM file_activities WHERE project_id = ?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let manual_session_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM manual_sessions WHERE project_id = ?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let comment_count: i64 = conn
        .query_row(
            "WITH session_project_overlap AS (
                SELECT s.id as session_id,
                       fa.project_id as project_id,
                       MAX(
                           0,
                           MIN(strftime('%s', s.end_time), strftime('%s', fa.last_seen)) -
                           MAX(strftime('%s', s.start_time), strftime('%s', fa.first_seen))
                       ) as overlap_seconds,
                       (strftime('%s', s.end_time) - strftime('%s', s.start_time)) as span_seconds
                FROM sessions s
                JOIN file_activities fa
                  ON fa.app_id = s.app_id
                 AND fa.date = s.date
                 AND fa.project_id IS NOT NULL
                 AND fa.last_seen > s.start_time
                 AND fa.first_seen < s.end_time
                WHERE (s.is_hidden IS NULL OR s.is_hidden = 0)
                GROUP BY s.id, fa.project_id
            ),
            ranked_overlap AS (
                SELECT session_id, project_id, overlap_seconds, span_seconds,
                       ROW_NUMBER() OVER (
                           PARTITION BY session_id
                           ORDER BY overlap_seconds DESC, project_id ASC
                       ) as rn,
                       COUNT(*) OVER (PARTITION BY session_id) as project_count
                FROM session_project_overlap
            ),
            session_projects AS (
                SELECT s.id, s.comment,
                       CASE
                           WHEN s.project_id IS NOT NULL THEN s.project_id
                           WHEN ro.project_count = 1
                            AND ro.overlap_seconds * 2 >= ro.span_seconds
                           THEN ro.project_id
                           ELSE NULL
                       END as project_id
                FROM sessions s
                LEFT JOIN ranked_overlap ro
                  ON ro.session_id = s.id
                 AND ro.rn = 1
                WHERE (s.is_hidden IS NULL OR s.is_hidden = 0)
            )
            SELECT COUNT(*) FROM session_projects sp WHERE sp.project_id = ?1 AND comment IS NOT NULL AND comment <> ''",
            [id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    // Estimating size: sessions ~150b, file_activities ~150b, manual ~150b, comments +100b
    let estimated_size_bytes = (session_count * 150)
        + (file_activity_count * 150)
        + (manual_session_count * 150)
        + (comment_count * 100);

    // 5. Top 3 apps
    let mut stmt = conn
        .prepare(
            "SELECT a.display_name, SUM(s.duration_seconds) as total, a.color
         FROM sessions s
         LEFT JOIN applications a ON a.id = s.app_id
         WHERE a.project_id = ?1 OR s.project_id = ?1
         GROUP BY COALESCE(a.display_name, 'Unknown App')
         ORDER BY total DESC
         LIMIT 3",
        )
        .map_err(|e| e.to_string())?;

    let top_apps = stmt
        .query_map([id], |row| {
            Ok(TopApp {
                name: row.get(0)?,
                seconds: row.get(1)?,
                color: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(ProjectExtraInfo {
        current_value,
        period_value,
        db_stats: ProjectDbStats {
            session_count,
            file_activity_count,
            manual_session_count,
            comment_count,
            estimated_size_bytes,
        },
        top_apps,
    })
}

#[tauri::command]
pub async fn compact_project_data(app: AppHandle, id: i64) -> Result<(), String> {
    let conn = db::get_connection(&app)?;

    // Delete file activities for this project
    conn.execute("DELETE FROM file_activities WHERE project_id = ?1", [id])
        .map_err(|e| e.to_string())?;

    // Retrain the AI model so it stays in sync with remaining data
    if let Err(e) = super::assignment_model::retrain_model_sync(&conn) {
        log::warn!("Auto-retrain after compact failed: {}", e);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::prune_projects_missing_on_disk;

    fn setup_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            );
            CREATE TABLE project_folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                added_at TEXT NOT NULL
            );",
        )
        .expect("schema");
        conn
    }

    #[test]
    fn prune_does_not_delete_manual_projects() {
        let conn = setup_conn();
        conn.execute(
            "INSERT INTO projects (name) VALUES (?1)",
            ["Manual Project"],
        )
        .expect("insert project");
        conn.execute(
            "INSERT INTO project_folders (path, added_at) VALUES (?1, ?2)",
            rusqlite::params![
                "Z:\\this_path_should_not_exist_123456",
                "2026-02-18T00:00:00Z"
            ],
        )
        .expect("insert missing folder");

        let removed = prune_projects_missing_on_disk(&conn).expect("prune");
        assert_eq!(removed, 0);

        let project_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
            .expect("project count");
        assert_eq!(project_count, 1);

        let folder_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM project_folders", [], |row| row.get(0))
            .expect("folder count");
        assert_eq!(folder_count, 0);
    }
}
