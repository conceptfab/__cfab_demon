use std::collections::{HashMap, HashSet};
use std::sync::atomic::Ordering;
use tauri::AppHandle;

use super::analysis::compute_project_activity_unique;
use super::helpers::{name_hash, run_db_blocking, LAST_PRUNE_EPOCH_SECS, PRUNE_CACHE_TTL_SECS};
use super::sql_fragments::SESSION_PROJECT_CTE;
use super::types::{
    DateRange, FolderProjectCandidate, FolderSyncResult, Project, ProjectDbStats, ProjectExtraInfo,
    ProjectFolder, ProjectWithStats, TopApp,
};
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

    let mut all_time_totals: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
    let mut period_totals: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();

    // 1. Always compute All-Time totals
    if let (Some(start), Some(end)) = (min_date.clone(), max_date.clone()) {
        let (_, totals, series_meta_by_key, _, _) =
            compute_project_activity_unique(conn, &DateRange { start, end }, false, false, None)?;
        all_time_totals = totals
            .into_iter()
            .filter_map(|(series_key, seconds)| {
                series_meta_by_key.get(&series_key).and_then(|series| {
                    series
                        .project_id
                        .map(|project_id| (project_id, seconds.round() as i64))
                })
            })
            .collect();
    }

    // 2. Compute Period totals if date_range is provided
    if let Some(range) = date_range {
        let (_, totals, series_meta_by_key, _, _) =
            compute_project_activity_unique(conn, range, false, false, None)?;
        period_totals = totals
            .into_iter()
            .filter_map(|(series_key, seconds)| {
                series_meta_by_key.get(&series_key).and_then(|series| {
                    series
                        .project_id
                        .map(|project_id| (project_id, seconds.round() as i64))
                })
            })
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

fn query_active_project_with_stats(
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
    let total_seconds = {
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

        if let (Some(start), Some(end)) = (min_date, max_date) {
            let (_, totals, _, _, _) = compute_project_activity_unique(
                conn,
                &DateRange { start, end },
                false,
                false,
                None,
            )?;
            let project_key = super::analysis::project_series_key(Some(id));
            totals.get(&project_key).copied().unwrap_or(0.0).round() as i64
        } else {
            0
        }
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
pub async fn freeze_project(app: AppHandle, id: i64) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
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
    })
    .await
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
    run_db_blocking(app, move |conn| {
        let days = threshold_days.unwrap_or(14).max(1);

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

        let frozen = conn
            .execute(
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
            )
            .map_err(|e| e.to_string())? as i64;

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
pub async fn assign_app_to_project(
    app: AppHandle,
    app_id: i64,
    project_id: Option<i64>,
) -> Result<(), String> {
    run_db_blocking(app, move |conn| {
        if let Some(pid) = project_id {
            if !project_id_is_active(conn, pid)? {
                return Err("Cannot assign app to an excluded or missing project".to_string());
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

        let app_names: HashSet<String> = {
            let mut stmt = conn
                .prepare_cached("SELECT LOWER(display_name) FROM applications")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<HashSet<_>, _>>()
                .map_err(|e| format!("Failed to read application display_name row: {}", e))?
        };

        let mut created = 0usize;
        for file_name in rows {
            let file_name =
                file_name.map_err(|e| format!("Failed to read file_activities row: {}", e))?;
            let candidate = file_name.trim();
            if candidate.is_empty()
                || candidate.len() > 200
                || candidate.contains(['/', '\\', '\0'])
            {
                continue;
            }

            let project_name = match infer_project_name_from_file_title(candidate, &[]) {
                Some(name) => name,
                None => continue,
            };

            if project_name.contains('.') && !project_name.contains(['/', '\\']) {
                continue;
            }

            if app_names.contains(&project_name.to_lowercase()) {
                continue;
            }

            if create_project_if_missing(conn, &project_name)? {
                created += 1;
            }
        }
        Ok(created)
    })
    .await
}
#[tauri::command]
pub async fn get_project_extra_info(
    app: AppHandle,
    id: i64,
    date_range: DateRange,
) -> Result<ProjectExtraInfo, String> {
    run_db_blocking(app, move |conn| {
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

        let effective_rate = hourly_rate.unwrap_or(global_rate);

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

        let all_time_bounds = min_date.as_deref().zip(max_date.as_deref());

        let mut current_value = 0.0;
        if let Some((start, end)) = all_time_bounds {
            let (_, totals_raw, series_meta_by_key, _, _) = compute_project_activity_unique(
                conn,
                &DateRange {
                    start: start.to_string(),
                    end: end.to_string(),
                },
                false,
                false,
                None,
            )?;
            let totals: HashMap<i64, f64> = totals_raw
                .into_iter()
                .filter_map(|(series_key, seconds)| {
                    series_meta_by_key
                        .get(&series_key)
                        .and_then(|series| series.project_id.map(|project_id| (project_id, seconds)))
                })
                .collect();
            let clock_seconds = totals.get(&id).copied().unwrap_or(0.0);
            let extra_seconds = get_extra_secs(conn, start, end, id)?;
            current_value = ((clock_seconds + extra_seconds) / 3600.0) * effective_rate;
        }

        let (_, period_totals_raw, period_series_meta_by_key, _, _) =
            compute_project_activity_unique(conn, &date_range, false, false, None)?;
        let period_totals: HashMap<i64, f64> = period_totals_raw
            .into_iter()
            .filter_map(|(series_key, seconds)| {
                period_series_meta_by_key
                    .get(&series_key)
                    .and_then(|series| series.project_id.map(|project_id| (project_id, seconds)))
            })
            .collect();
        let period_clock_seconds = period_totals
            .get(&id)
            .copied()
            .unwrap_or(0.0);
        let period_extra_seconds = get_extra_secs(conn, &date_range.start, &date_range.end, id)?;
        let period_value = ((period_clock_seconds + period_extra_seconds) / 3600.0) * effective_rate;

        let (session_count, file_activity_count, comment_count, boosted_session_count) =
            if let Some((start, end)) = all_time_bounds {
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

                let file_activity_count_sql = format!(
                    "{SESSION_PROJECT_CTE}
                     SELECT COUNT(DISTINCT LOWER(
                         COALESCE(NULLIF(TRIM(fa.file_path), ''), NULLIF(TRIM(fa.file_name), ''))
                     ))
                     FROM session_projects sp
                     JOIN sessions s ON s.id = sp.id
                     JOIN file_activities fa
                       ON fa.app_id = s.app_id
                      AND fa.date = s.date
                      AND fa.last_seen > s.start_time
                      AND fa.first_seen < s.end_time
                     WHERE sp.project_id = ?3
                       AND (fa.project_id = ?3 OR fa.project_id IS NULL)
                       AND COALESCE(NULLIF(TRIM(fa.file_path), ''), NULLIF(TRIM(fa.file_name), '')) IS NOT NULL
                       AND LOWER(COALESCE(NULLIF(TRIM(fa.file_path), ''), NULLIF(TRIM(fa.file_name), ''))) <> '(background)'"
                );
                let file_activity_count: i64 = conn
                    .query_row(
                        &file_activity_count_sql,
                        rusqlite::params![start, end, id],
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
