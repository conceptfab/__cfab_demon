use std::collections::{HashMap, HashSet};
use std::sync::atomic::Ordering;
use tauri::AppHandle;

use super::analysis::{compute_project_clock_totals_by_id, query_activity_date_range};
use super::helpers::{name_hash, run_db_blocking, LAST_PRUNE_EPOCH_SECS, PRUNE_CACHE_TTL_SECS};
use super::sql_fragments::{ensure_session_project_cache, SESSION_PROJECT_CTE};
use super::types::{
    DateRange, FolderProjectCandidate, FolderSyncResult, Project, ProjectDbStats, ProjectExtraInfo,
    ProjectFolder, ProjectWithStats, TopApp,
};
use rusqlite::OptionalExtension;

pub(crate) fn load_project_folders_from_db(
    conn: &rusqlite::Connection,
) -> Result<Vec<ProjectFolder>, String> {
    let mut stmt = conn
        .prepare_cached("SELECT path, added_at, color, category, badge FROM project_folders ORDER BY added_at")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ProjectFolder {
                path: row.get(0)?,
                added_at: row.get(1)?,
                color: row.get::<_, String>(2).unwrap_or_default(),
                category: row.get::<_, String>(3).unwrap_or_default(),
                badge: row.get::<_, String>(4).unwrap_or_default(),
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read project_folders row: {}", e))
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
    let hash = name_hash(name);
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
        "SELECT COUNT(*) > 0 FROM projects
         WHERE id = ?1 AND excluded_at IS NULL AND frozen_at IS NULL",
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

/// Creates a project if it doesn't exist, with an assigned folder path.
/// Returns the project name if created, None if already existed or skipped.
fn create_project_if_missing_with_folder(
    conn: &rusqlite::Connection,
    name: &str,
    folder_path: &str,
) -> Result<Option<String>, String> {
    let name = name.trim();
    if name.is_empty() {
        return Ok(None);
    }
    if project_name_is_blacklisted(conn, name) {
        log::info!("Skipping blacklisted project name '{}'", name);
        return Ok(None);
    }
    if project_row_exists_by_name(conn, name) {
        return Ok(None);
    }
    conn.execute(
        "INSERT INTO projects (name, color, assigned_folder_path) VALUES (?1, ?2, ?3)",
        rusqlite::params![name, project_color_for_name(name), folder_path],
    )
    .map_err(|e| e.to_string())?;
    Ok(Some(name.to_string()))
}

/// Checks if the file path suggests it belongs to a project
fn infer_project_from_path(file_path: &str, project_roots: &[ProjectFolder]) -> Option<String> {
    let path = std::path::Path::new(file_path);
    let normalized_path = path.to_string_lossy().replace('\\', "/").to_lowercase();

    // Check each project folder
    for root in project_roots {
        let root_path = std::path::Path::new(&root.path);
        if let Ok(relative_path) = path.strip_prefix(root_path) {
            // The file is inside a project folder
            // Extract the project name from the path
            if let Some(first_component) = relative_path.components().next() {
                let project_name = first_component.as_os_str().to_string_lossy().into_owned();
                return Some(project_name);
            }
        }

        // Windows filesystems are commonly case-insensitive, but strip_prefix is not.
        // Fallback to a normalized lowercase comparison to avoid missed matches.
        if cfg!(windows) {
            let normalized_root = root_path
                .to_string_lossy()
                .replace('\\', "/")
                .to_lowercase();
            let prefix = if normalized_root.ends_with('/') {
                normalized_root.clone()
            } else {
                format!("{}/", normalized_root)
            };
            if let Some(relative_path) = normalized_path.strip_prefix(&prefix) {
                if let Some(first_component) =
                    relative_path.split('/').find(|segment| !segment.is_empty())
                {
                    return Some(first_component.to_string());
                }
            }
        }
    }
    None
}

/// Public wrapper for `infer_project_from_path` (used by import.rs).
pub(crate) fn infer_project_from_path_pub(
    file_path: &str,
    project_roots: &[ProjectFolder],
) -> Option<String> {
    infer_project_from_path(file_path, project_roots)
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
    let mut seen_candidates: HashSet<String> = HashSet::new();

    let mut push_candidate = |raw: &str| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return;
        }
        let key = trimmed.to_lowercase();
        if seen_candidates.insert(key) {
            candidates.push(trimmed.to_string());
        }
    };

    // First the full string and path heuristics.
    push_candidate(file_name);
    if let Some(inferred) = infer_project_name_from_file_title(file_name, project_roots) {
        push_candidate(&inferred);
    }

    // Next, add EACH part after splitting by hyphen as a potential project name.
    // If the window is e.g. "__timeflow_demon - Antigravity", we check both "__timeflow_demon" and "Antigravity".
    for part in file_name.split(" - ") {
        push_candidate(part);
    }

    // Also check alternative separators that the demon sometimes leaves
    for part in file_name.split(" | ") {
        push_candidate(part);
    }

    for candidate_name in candidates {
        let proj_id: Option<i64> = match conn.query_row(
            "SELECT id
             FROM projects
             WHERE lower(name) = lower(?1)
               AND excluded_at IS NULL
               AND frozen_at IS NULL",
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

    let mut all_time_totals: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
    let mut period_totals: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();

    // 1. Always compute All-Time totals
    if let Some(all_time_range) = query_activity_date_range(conn)? {
        all_time_totals = compute_project_clock_totals_by_id(conn, &all_time_range, false)?
            .into_iter()
            .map(|(project_id, seconds)| (project_id, seconds.round() as i64))
            .collect();
    }

    // 2. Compute Period totals if date_range is provided
    if let Some(range) = date_range {
        period_totals = compute_project_clock_totals_by_id(conn, range, false)?
            .into_iter()
            .map(|(project_id, seconds)| (project_id, seconds.round() as i64))
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
            let project_id: i64 = row.get(0)?;
            let last_session: Option<String> = row.get(6)?;
            let last_manual: Option<String> = row.get(7)?;
            let last_activity = match (last_session, last_manual) {
                (Some(a), Some(b)) => Some(if a >= b { a } else { b }),
                (Some(a), None) => Some(a),
                (None, Some(b)) => Some(b),
                (None, None) => None,
            };
            Ok(ProjectWithStats {
                id: project_id,
                name,
                color: row.get(2)?,
                created_at: row.get::<_, String>(3).unwrap_or_default(),
                excluded_at: row.get(4)?,
                total_seconds: *all_time_totals.get(&project_id).unwrap_or(&0),
                period_seconds: if date_range.is_some() {
                    Some(*period_totals.get(&project_id).unwrap_or(&0))
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
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read project stats row: {}", e))?;

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

pub(crate) fn query_active_project_with_stats(
    conn: &rusqlite::Connection,
    id: i64,
) -> Result<ProjectWithStats, String> {
    let (
        project_id,
        name,
        color,
        created_at,
        excluded_at,
        frozen_at,
        assigned_folder_path,
        app_count,
        last_session_activity,
        last_manual_activity,
    ): (
        i64,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        i64,
        Option<String>,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT p.id,
                    p.name,
                    p.color,
                    p.created_at,
                    p.excluded_at,
                    p.frozen_at,
                    p.assigned_folder_path,
                    COUNT(DISTINCT a.id) as app_count,
                    (SELECT MAX(s.end_time)
                     FROM sessions s
                     JOIN applications a2 ON a2.id = s.app_id
                     WHERE a2.project_id = p.id) as last_session_activity,
                    (SELECT MAX(ms.end_time)
                     FROM manual_sessions ms
                     WHERE ms.project_id = p.id) as last_manual_activity
             FROM projects p
             LEFT JOIN applications a ON a.project_id = p.id
             WHERE p.id = ?1
               AND p.excluded_at IS NULL
             GROUP BY p.id",
            [id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get::<_, String>(3).unwrap_or_default(),
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                    row.get(9)?,
                ))
            },
        )
        .map_err(|e| format!("Project not found: {}", e))?;

    // Use the same deduplicating algorithm as the projects list and estimates,
    // so overlapping sessions (e.g. Cursor + Claude running simultaneously)
    // are counted only once (wall-clock time, not raw sum).
    // IMPORTANT: must compute ALL projects (project_id_filter: None) so that
    // cross-project time splitting works correctly, then pick this project's total.
    let total_seconds = if let Some(all_time_range) = query_activity_date_range(conn)? {
        compute_project_clock_totals_by_id(conn, &all_time_range, false)?
            .get(&id)
            .copied()
            .unwrap_or(0.0)
            .round() as i64
    } else {
        0
    };

    let last_activity = match (last_session_activity, last_manual_activity) {
        (Some(a), Some(b)) => Some(if a >= b { a } else { b }),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    };

    Ok(ProjectWithStats {
        id: project_id,
        name,
        color,
        created_at,
        excluded_at,
        frozen_at,
        total_seconds,
        period_seconds: None,
        app_count,
        last_activity,
        assigned_folder_path,
    })
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
/// Freezes a project and detaches every application→project mapping that
/// points at it, so future sessions cannot inherit the frozen project via
/// Layer 1 app-project inheritance during daemon log import.
pub(crate) fn freeze_project_in_conn(
    conn: &mut rusqlite::Connection,
    id: i64,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE projects
         SET frozen_at = datetime('now'),
             unfreeze_reason = NULL
         WHERE id = ?1
           AND excluded_at IS NULL",
        [id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE applications SET project_id = NULL WHERE project_id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn freeze_project(app: AppHandle, id: i64) -> Result<(), String> {
    run_db_blocking(app, move |conn| freeze_project_in_conn(conn, id)).await
}

#[tauri::command]
pub async fn unfreeze_project(app: AppHandle, id: i64) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
        conn.execute(
            "UPDATE projects
             SET frozen_at = NULL,
                 unfreeze_reason = datetime('now')
             WHERE id = ?1",
            [id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

/// Core logic for `auto_freeze_projects`, exposed for unit tests.
///
/// Freezes stale projects (no session/manual_session/file_activity in the
/// last `days` days and older than `days` since creation). Does **not**
/// unfreeze anything — unfreeze is a manual-only operation. Callers must
/// pass `days >= 1`.
fn auto_freeze_stale_projects(
    conn: &rusqlite::Connection,
    days: i64,
) -> rusqlite::Result<i64> {
    conn.execute(
        "UPDATE projects
         SET unfreeze_reason = NULL
         WHERE excluded_at IS NULL
           AND unfreeze_reason IS NOT NULL
           AND julianday(unfreeze_reason) < julianday('now', '-' || ?1 || ' days')",
        [days],
    )?;

    let frozen = conn.execute(
        "UPDATE projects
         SET frozen_at = datetime('now'),
             unfreeze_reason = NULL
         WHERE excluded_at IS NULL
           AND frozen_at IS NULL
           AND julianday('now') - julianday(created_at) >= ?1
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
    )? as i64;

    Ok(frozen)
}

#[derive(serde::Serialize)]
pub struct AutoFreezeResult {
    pub frozen_count: i64,
}

#[tauri::command]
pub async fn auto_freeze_projects(
    app: AppHandle,
    threshold_days: Option<i64>,
) -> Result<AutoFreezeResult, String> {
    run_db_blocking(app, move |conn| {
        let days = threshold_days.unwrap_or(14).max(1);
        let frozen_count = auto_freeze_stale_projects(conn, days)
            .map_err(|e| e.to_string())?;
        Ok(AutoFreezeResult { frozen_count })
    })
    .await
}

#[tauri::command]
pub async fn get_projects(
    app: AppHandle,
    date_range: Option<DateRange>,
) -> Result<Vec<ProjectWithStats>, String> {
    run_db_blocking(app, move |conn| {
        prune_if_stale(conn)?;
        query_projects_with_stats(conn, false, date_range.as_ref())
    })
    .await
}

#[tauri::command]
pub async fn get_project(app: AppHandle, id: i64) -> Result<ProjectWithStats, String> {
    run_db_blocking(app, move |conn| {
        prune_if_stale(conn)?;
        query_active_project_with_stats(conn, id)
    })
    .await
}

#[tauri::command]
pub async fn get_excluded_projects(
    app: AppHandle,
    date_range: Option<DateRange>,
) -> Result<Vec<ProjectWithStats>, String> {
    run_db_blocking(app, move |conn| {
        prune_if_stale(conn)?;
        query_projects_with_stats(conn, true, date_range.as_ref())
    })
    .await
}

#[tauri::command]
pub async fn create_project(
    app: AppHandle,
    name: String,
    color: String,
    assigned_folder_path: Option<String>,
) -> Result<Project, String> {
    run_db_blocking(app, move |conn| {
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err("Project name is required".to_string());
        }
        if project_name_is_blacklisted(conn, &name) {
            return Err("Project name is on the excluded blacklist".to_string());
        }
        if project_row_exists_by_name(conn, &name) {
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
    })
    .await
}

#[tauri::command]
pub async fn update_project(app: AppHandle, id: i64, color: String) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
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
    })
    .await
}

#[tauri::command]
pub async fn exclude_project(app: AppHandle, id: i64) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE applications SET project_id = NULL WHERE project_id = ?1",
            [id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE projects
             SET excluded_at = COALESCE(excluded_at, datetime('now'))
             WHERE id = ?1",
            [id],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn restore_project(app: AppHandle, id: i64) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
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
    })
    .await
}

#[tauri::command]
pub async fn delete_project(app: AppHandle, id: i64) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE applications SET project_id = NULL WHERE project_id = ?1",
            [id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM projects WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn blacklist_project_names(app: AppHandle, names: Vec<String>) -> Result<usize, String> {
    run_db_blocking(app, move |conn| {
        let mut count = 0usize;
        for name in &names {
            if let Some(name_key) = normalized_project_name_key(name) {
                let inserted = conn
                    .execute(
                        "INSERT OR IGNORE INTO project_name_blacklist (name_key) VALUES (?1)",
                        [&name_key],
                    )
                    .map_err(|e| e.to_string())?;
                if inserted > 0 {
                    count += 1;
                }
            }
        }
        Ok(count)
    })
    .await
}

#[tauri::command]
pub async fn delete_all_excluded_projects(app: AppHandle) -> Result<usize, String> {
    run_db_blocking(app, move |conn| {
        let ids: Vec<i64> = {
            let mut stmt = conn
                .prepare_cached("SELECT id FROM projects WHERE excluded_at IS NOT NULL")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, i64>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        if ids.is_empty() {
            return Ok(0);
        }
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for id in &ids {
            tx.execute(
                "UPDATE applications SET project_id = NULL WHERE project_id = ?1",
                [id],
            )
            .map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM projects WHERE id = ?1", [id])
                .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(ids.len())
    })
    .await
}

#[tauri::command]
pub async fn assign_app_to_project(
    app: AppHandle,
    app_id: i64,
    project_id: Option<i64>,
) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
        if let Some(pid) = project_id {
            if !project_id_is_active(conn, pid)? {
                return Err(
                    "Cannot assign app to an excluded, frozen, or missing project".to_string(),
                );
            }
        }

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

        tx.execute(
            "INSERT INTO assignment_feedback (app_id, from_project_id, to_project_id, source, created_at)
             VALUES (?1, ?2, ?3, 'manual_app_assign', datetime('now'))",
            rusqlite::params![app_id, old_project_id, project_id],
        )
        .map_err(|e| e.to_string())?;

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
    })
    .await
}

#[tauri::command]
pub async fn get_project_folders(app: AppHandle) -> Result<Vec<ProjectFolder>, String> {
    run_db_blocking(app, move |conn| {
        cleanup_missing_project_folders(conn)?;
        load_project_folders_from_db(conn)
    })
    .await
}

#[tauri::command]
pub async fn add_project_folder(app: AppHandle, path: String) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
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
            if create_project_if_missing(conn, &name)? {
                created += 1;
            }
        }
        log::info!(
            "Added project root '{}' and auto-created {} project(s)",
            normalized,
            created
        );
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn remove_project_folder(app: AppHandle, path: String) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
        let normalized = path.trim().to_string();
        conn.execute(
            "DELETE FROM project_folders WHERE lower(path) = lower(?1)",
            [normalized],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn update_project_folder_meta(
    app: AppHandle,
    path: String,
    color: String,
    category: String,
    badge: String,
) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
        conn.execute(
            "UPDATE project_folders SET color = ?1, category = ?2, badge = ?3 WHERE lower(path) = lower(?4)",
            rusqlite::params![color, category, badge, path.trim()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn get_folder_project_candidates(
    app: AppHandle,
) -> Result<Vec<FolderProjectCandidate>, String> {
    run_db_blocking(app, move |conn| {
        let roots = load_project_folders_from_db(conn)?;
        let mut out = Vec::new();
        for (name, folder_path, root_path) in collect_project_subfolders(&roots) {
            out.push(FolderProjectCandidate {
                already_exists: project_exists_by_name(conn, &name),
                name,
                folder_path,
                root_path,
            });
        }

        out.sort_by_key(|a| a.name.to_lowercase());
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn create_project_from_folder(
    app: AppHandle,
    folder_path: String,
) -> Result<Project, String> {
    run_db_blocking(app, move |conn| {
        let canonical = std::fs::canonicalize(folder_path.trim()).map_err(|e| e.to_string())?;
        if !canonical.is_dir() {
            return Err("Folder does not exist".to_string());
        }
        let name = canonical
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .ok_or_else(|| "Cannot infer project name from folder".to_string())?;
        if project_name_is_blacklisted(conn, &name) {
            return Err("Project name is on the excluded blacklist".to_string());
        }
        if !create_project_if_missing(conn, &name)? {
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
    })
    .await
}

#[tauri::command]
pub async fn sync_projects_from_folders(app: AppHandle) -> Result<FolderSyncResult, String> {
    run_db_blocking(app, move |conn| {
        let roots = load_project_folders_from_db(conn)?;
        let mut created_projects: Vec<String> = Vec::new();
        let mut scanned = 0usize;

        for (name, folder_path, _root) in collect_project_subfolders(&roots) {
            scanned += 1;
            if let Some(project_name) =
                create_project_if_missing_with_folder(conn, &name, &folder_path)?
            {
                created_projects.push(project_name);
            }
        }

        for root in &roots {
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
                let git_dir = p.join(".git");
                if git_dir.exists() {
                    let name = match p.file_name().map(|n| n.to_string_lossy().to_string()) {
                        Some(v) if !v.trim().is_empty() => v,
                        _ => continue,
                    };
                    let folder_path = p.to_string_lossy().to_string();
                    if let Some(project_name) =
                        create_project_if_missing_with_folder(conn, &name, &folder_path)?
                    {
                        if !created_projects.contains(&project_name) {
                            created_projects.push(project_name);
                        }
                    }
                }
            }
        }

        Ok(FolderSyncResult {
            created_projects,
            scanned_folders: scanned,
        })
    })
    .await
}

#[tauri::command]
pub async fn auto_create_projects_from_detection(
    app: AppHandle,
    date_range: DateRange,
    min_occurrences: i64,
) -> Result<usize, String> {
    run_db_blocking(app, move |conn| {
        let project_roots = load_project_folders_from_db(conn)?;
        if project_roots.is_empty() {
            // No project folders configured — nothing to auto-detect from.
            return Ok(0);
        }

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

        let mut created = 0usize;
        for file_name in rows {
            let file_name =
                file_name.map_err(|e| format!("Failed to read file_activities row: {}", e))?;
            let candidate = file_name.trim();
            if candidate.is_empty() || candidate.len() > 200 {
                continue;
            }

            // Only accept candidates that resolve to an actual project folder.
            // This prevents window titles like "Copy Settings", "Fill" etc. from
            // being created as projects.
            let project_name =
                match infer_project_from_path(candidate, &project_roots) {
                    Some(name) => name,
                    None => continue,
                };

            if create_project_if_missing(conn, &project_name)? {
                created += 1;
            }
        }
        Ok(created)
    })
    .await
}
pub(crate) fn query_project_extra_info(
    conn: &rusqlite::Connection,
    id: i64,
    date_range: &DateRange,
) -> Result<ProjectExtraInfo, String> {
    let (_name, hourly_rate): (String, Option<f64>) = conn
        .query_row(
            "SELECT name, hourly_rate FROM projects WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("Project not found: {}", e))?;

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

    let effective_rate = hourly_rate
        .filter(|r| r.is_finite() && *r > 0.0)
        .unwrap_or(global_rate);

    let get_extra_secs =
        |conn: &rusqlite::Connection, start: &str, end: &str, p_id: i64| -> Result<f64, String> {
            let sql = format!(
                "{SESSION_PROJECT_CTE}
                 SELECT SUM(
                     CASE
                         WHEN sp.safe_rate_multiplier <= 1.0 THEN 0.0
                         ELSE (sp.duration_seconds * (sp.safe_rate_multiplier - 1.0))
                     END
                 )
                 FROM session_projects sp
                 WHERE sp.project_id = ?3"
            );
            conn.query_row(&sql, rusqlite::params![start, end, p_id], |row| {
                Ok(row.get::<_, Option<f64>>(0)?.unwrap_or(0.0))
            })
            .map_err(|e| e.to_string())
        };

    let all_time_range = query_activity_date_range(conn)?;
    let all_time_bounds = all_time_range
        .as_ref()
        .map(|range| (range.start.as_str(), range.end.as_str()));

    if let Some((start, end)) = all_time_bounds {
        ensure_session_project_cache(conn, start, end)?;
    }

    let all_time_totals = if let Some(range) = all_time_range.as_ref() {
        compute_project_clock_totals_by_id(conn, range, false)?
    } else {
        HashMap::new()
    };

    let period_totals = if all_time_range
        .as_ref()
        .is_some_and(|range| range.start == date_range.start && range.end == date_range.end)
    {
        all_time_totals.clone()
    } else {
        compute_project_clock_totals_by_id(conn, date_range, false)?
    };

    let current_value = if let Some((start, end)) = all_time_bounds {
        let clock_seconds = all_time_totals.get(&id).copied().unwrap_or(0.0);
        let extra_seconds = get_extra_secs(conn, start, end, id)?;
        ((clock_seconds + extra_seconds) / 3600.0) * effective_rate
    } else {
        0.0
    };

    let period_clock_seconds = period_totals.get(&id).copied().unwrap_or(0.0);
    let period_extra_seconds = get_extra_secs(conn, &date_range.start, &date_range.end, id)?;
    let period_value = ((period_clock_seconds + period_extra_seconds) / 3600.0) * effective_rate;

    let (session_count, file_activity_count, comment_count, boosted_session_count) = if let Some(
        (start, end),
    ) =
        all_time_bounds
    {
        let session_count_sql = format!(
            "{SESSION_PROJECT_CTE}
                 SELECT COUNT(*) FROM session_projects sp WHERE sp.project_id = ?3"
        );
        let session_count: i64 = conn
            .query_row(
                &session_count_sql,
                rusqlite::params![start, end, id],
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

        let comment_and_boost_sql = format!(
                "{SESSION_PROJECT_CTE}
                 SELECT
                     COUNT(*) FILTER (WHERE sp.project_id = ?3 AND sp.comment IS NOT NULL AND sp.comment <> ''),
                     COUNT(*) FILTER (WHERE sp.project_id = ?3 AND sp.safe_rate_multiplier > 1.000001)
                 FROM session_projects sp"
            );
        let (comment_count, boosted_session_count): (i64, i64) = conn
            .query_row(
                &comment_and_boost_sql,
                rusqlite::params![start, end, id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        (
            session_count,
            file_activity_count,
            comment_count,
            boosted_session_count,
        )
    } else {
        (0, 0, 0, 0)
    };

    let manual_session_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM manual_sessions WHERE project_id = ?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let estimated_size_bytes = (session_count * 150)
        + (file_activity_count * 150)
        + (manual_session_count * 150)
        + (comment_count * 100);

    let top_apps = if let Some((start, end)) = all_time_bounds {
        let top_apps_sql = format!(
            "{SESSION_PROJECT_CTE}
             SELECT COALESCE(a.display_name, 'Unknown App') as display_name,
                    SUM(CAST(sp.duration_seconds AS INTEGER)) as total,
                    MAX(a.color) as color
             FROM session_projects sp
             LEFT JOIN applications a ON a.id = sp.app_id
             WHERE sp.project_id = ?3
             GROUP BY COALESCE(a.display_name, 'Unknown App')
             ORDER BY total DESC
             LIMIT 15"
        );
        let mut stmt = conn.prepare(&top_apps_sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![start, end, id], |row| {
                Ok(TopApp {
                    name: row.get(0)?,
                    seconds: row.get(1)?,
                    color: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read top app row: {}", e))?
    } else {
        Vec::new()
    };

    Ok(ProjectExtraInfo {
        current_value,
        period_value,
        db_stats: ProjectDbStats {
            session_count,
            file_activity_count,
            manual_session_count,
            comment_count,
            boosted_session_count,
            estimated_size_bytes,
        },
        top_apps,
    })
}

#[tauri::command]
pub async fn get_project_extra_info(
    app: AppHandle,
    id: i64,
    date_range: DateRange,
) -> Result<ProjectExtraInfo, String> {
    run_db_blocking(app, move |conn| {
        query_project_extra_info(conn, id, &date_range)
    })
    .await
}

#[tauri::command]
pub async fn compact_project_data(app: AppHandle, id: i64) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
        conn.execute("DELETE FROM file_activities WHERE project_id = ?1", [id])
            .map_err(|e| e.to_string())?;

        if let Err(e) = super::assignment_model::retrain_model_sync(conn) {
            log::warn!("Auto-retrain after compact failed: {}", e);
        }

        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::{
        auto_freeze_stale_projects, ensure_app_project_from_file_hint, freeze_project_in_conn,
        project_id_is_active, prune_projects_missing_on_disk,
    };

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
                added_at TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT '',
                badge TEXT NOT NULL DEFAULT ''
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

    fn setup_auto_freeze_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE projects (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                excluded_at TEXT,
                frozen_at TEXT,
                unfreeze_reason TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE applications (
                id INTEGER PRIMARY KEY,
                project_id INTEGER
            );
            CREATE TABLE sessions (
                id INTEGER PRIMARY KEY,
                project_id INTEGER,
                app_id INTEGER,
                end_time TEXT NOT NULL
            );
            CREATE TABLE manual_sessions (
                id INTEGER PRIMARY KEY,
                project_id INTEGER,
                end_time TEXT NOT NULL
            );
            CREATE TABLE file_activities (
                id INTEGER PRIMARY KEY,
                project_id INTEGER,
                last_seen TEXT NOT NULL
            );",
        )
        .expect("schema");
        conn
    }

    #[test]
    fn auto_freeze_never_unfreezes_manual_freeze() {
        let conn = setup_auto_freeze_conn();

        conn.execute(
            "INSERT INTO projects (id, name, excluded_at, frozen_at, unfreeze_reason, created_at)
             VALUES (10, 'ManualFrozen', NULL, datetime('now', '-1 days'), NULL,
                     datetime('now', '-30 days'))",
            [],
        )
        .expect("insert frozen project");

        // Historyczna sesja z ostatnich 14 dni wciąż wskazująca na zamrożony projekt
        // (c0bbed0 celowo nie czyści historycznego sessions.project_id po freeze).
        conn.execute(
            "INSERT INTO sessions (id, project_id, app_id, end_time)
             VALUES (1, 10, NULL, datetime('now', '-2 days'))",
            [],
        )
        .expect("insert historic session");

        let frozen_count = auto_freeze_stale_projects(&conn, 14).expect("auto-freeze");

        assert_eq!(
            frozen_count, 0,
            "nothing new to freeze — project already frozen"
        );

        let frozen_at: Option<String> = conn
            .query_row(
                "SELECT frozen_at FROM projects WHERE id = 10",
                [],
                |row| row.get(0),
            )
            .expect("select frozen_at");

        assert!(
            frozen_at.is_some(),
            "manual freeze must NOT be cleared by auto_freeze_stale_projects, got {:?}",
            frozen_at
        );
    }

    #[test]
    fn auto_freeze_freezes_stale_project_without_activity() {
        let conn = setup_auto_freeze_conn();

        conn.execute(
            "INSERT INTO projects (id, name, excluded_at, frozen_at, unfreeze_reason, created_at)
             VALUES (20, 'StaleAlive', NULL, NULL, NULL, datetime('now', '-60 days'))",
            [],
        )
        .expect("insert stale project");

        let frozen_count = auto_freeze_stale_projects(&conn, 14).expect("auto-freeze");

        assert_eq!(frozen_count, 1, "stale project without activity must be frozen");

        let frozen_at: Option<String> = conn
            .query_row(
                "SELECT frozen_at FROM projects WHERE id = 20",
                [],
                |row| row.get(0),
            )
            .expect("select frozen_at");

        assert!(frozen_at.is_some(), "StaleAlive should now be frozen");
    }

    #[test]
    fn auto_freeze_skips_project_with_recent_session() {
        let conn = setup_auto_freeze_conn();

        conn.execute(
            "INSERT INTO projects (id, name, excluded_at, frozen_at, unfreeze_reason, created_at)
             VALUES (30, 'Active', NULL, NULL, NULL, datetime('now', '-60 days'))",
            [],
        )
        .expect("insert active project");

        conn.execute(
            "INSERT INTO sessions (id, project_id, app_id, end_time)
             VALUES (5, 30, NULL, datetime('now', '-3 days'))",
            [],
        )
        .expect("insert recent session");

        let frozen_count = auto_freeze_stale_projects(&conn, 14).expect("auto-freeze");

        assert_eq!(frozen_count, 0, "project with recent activity must stay active");

        let frozen_at: Option<String> = conn
            .query_row(
                "SELECT frozen_at FROM projects WHERE id = 30",
                [],
                |row| row.get(0),
            )
            .expect("select frozen_at");

        assert!(frozen_at.is_none(), "active project must not be frozen");
    }

    #[test]
    fn project_id_is_active_rejects_frozen_project() {
        let conn = setup_auto_freeze_conn();
        conn.execute(
            "INSERT INTO projects (id, name, excluded_at, frozen_at, unfreeze_reason, created_at)
             VALUES (40, 'Frozen', NULL, datetime('now'), NULL, datetime('now', '-10 days'))",
            [],
        )
        .expect("insert frozen project");
        conn.execute(
            "INSERT INTO projects (id, name, excluded_at, frozen_at, unfreeze_reason, created_at)
             VALUES (41, 'Active', NULL, NULL, NULL, datetime('now', '-10 days'))",
            [],
        )
        .expect("insert active project");

        assert!(
            !project_id_is_active(&conn, 40).expect("query frozen"),
            "frozen project must NOT be treated as active"
        );
        assert!(
            project_id_is_active(&conn, 41).expect("query active"),
            "active project must be treated as active"
        );
    }

    #[test]
    fn freeze_project_detaches_application_assignments() {
        let mut conn = setup_auto_freeze_conn();
        conn.execute(
            "INSERT INTO projects (id, name, excluded_at, frozen_at, unfreeze_reason, created_at)
             VALUES (50, 'FreezeMe', NULL, NULL, NULL, datetime('now', '-30 days'))",
            [],
        )
        .expect("insert project");
        conn.execute(
            "INSERT INTO applications (id, project_id) VALUES (100, 50), (101, 50), (102, NULL)",
            [],
        )
        .expect("insert applications");

        freeze_project_in_conn(&mut conn, 50).expect("freeze");

        let frozen_at: Option<String> = conn
            .query_row(
                "SELECT frozen_at FROM projects WHERE id = 50",
                [],
                |row| row.get(0),
            )
            .expect("select frozen_at");
        assert!(frozen_at.is_some(), "project must be frozen");

        let app_with_project: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM applications WHERE project_id = 50",
                [],
                |row| row.get(0),
            )
            .expect("count apps");
        assert_eq!(
            app_with_project, 0,
            "all applications pointing at the frozen project must be detached"
        );
    }

    #[test]
    fn ensure_app_project_from_file_hint_skips_frozen_project() {
        let conn = setup_auto_freeze_conn();
        conn.execute(
            "INSERT INTO projects (id, name, excluded_at, frozen_at, unfreeze_reason, created_at)
             VALUES (70, '01_26_RM_Jutrzenki', NULL, datetime('now'), NULL,
                     datetime('now', '-30 days')),
                    (71, '16_26_Profil_Korea_HAIR', NULL, NULL, NULL,
                     datetime('now', '-30 days'))",
            [],
        )
        .expect("insert projects");

        let frozen_hint =
            ensure_app_project_from_file_hint(&conn, "01_26_RM_Jutrzenki - brief.psd", &[]);
        assert_eq!(
            frozen_hint, None,
            "file hint matching a frozen project name must not resolve to that project"
        );

        let active_hint =
            ensure_app_project_from_file_hint(&conn, "16_26_Profil_Korea_HAIR - set.psd", &[]);
        assert_eq!(
            active_hint,
            Some(71),
            "file hint matching an active project name must resolve normally"
        );
    }

    #[test]
    fn import_app_project_query_skips_frozen_project() {
        // Mirrors the SQL used in import.rs to resolve the Layer 1 app→project
        // inheritance when sessions land from the daemon. Must return no row
        // when the target project is frozen, so the incoming session stays
        // unassigned and is routed to the assignment model instead.
        let conn = setup_auto_freeze_conn();
        conn.execute(
            "INSERT INTO projects (id, name, excluded_at, frozen_at, unfreeze_reason, created_at)
             VALUES (60, 'Frozen', NULL, datetime('now'), NULL, datetime('now', '-10 days')),
                    (61, 'Active', NULL, NULL, NULL, datetime('now', '-10 days'))",
            [],
        )
        .expect("insert projects");
        conn.execute(
            "INSERT INTO applications (id, project_id) VALUES (200, 60), (201, 61)",
            [],
        )
        .expect("insert applications");

        let sql = "SELECT a.project_id
             FROM applications a
             JOIN projects p ON p.id = a.project_id
             WHERE a.id = ?1
               AND p.excluded_at IS NULL
               AND p.frozen_at IS NULL";

        let frozen_lookup: Option<i64> = conn
            .query_row(sql, [200_i64], |row| row.get(0))
            .ok()
            .flatten();
        assert_eq!(
            frozen_lookup, None,
            "app mapped to frozen project must not return an inheritable project_id"
        );

        let active_lookup: Option<i64> = conn
            .query_row(sql, [201_i64], |row| row.get(0))
            .ok()
            .flatten();
        assert_eq!(
            active_lookup,
            Some(61),
            "app mapped to active project must inherit normally"
        );
    }
}
