use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::commands::assignment_model::context::tokenize;
use crate::commands::projects::{collect_project_subfolders, load_project_folders_from_db};

/// Directories to skip during recursive walk.
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    "__pycache__",
    ".next",
    ".svn",
    ".hg",
    ".idea",
    ".vscode",
    "vendor",
    ".cache",
];

const MAX_DEPTH: usize = 4;

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderScanResult {
    pub projects_scanned: i64,
    pub tokens_total: i64,
    pub duration_ms: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderScanStatus {
    pub has_scan_data: bool,
    pub last_scanned_at: Option<String>,
    pub projects_count: i64,
    pub tokens_count: i64,
}

/// Resolves a project name to project_id (active projects only).
fn resolve_project_id_by_name(conn: &Connection, name: &str) -> Option<i64> {
    conn.query_row(
        "SELECT id FROM projects WHERE lower(name) = lower(?1) AND excluded_at IS NULL AND frozen_at IS NULL LIMIT 1",
        rusqlite::params![name],
        |row| row.get(0),
    )
    .ok()
}

/// Recursively walk a directory up to `max_depth` levels, collecting file/dir tokens.
fn walk_and_tokenize(
    path: &std::path::Path,
    depth: usize,
    tokens: &mut HashMap<String, i64>,
) {
    if depth > MAX_DEPTH {
        return;
    }

    let entries = match std::fs::read_dir(path) {
        Ok(v) => v,
        Err(_) => return,
    };

    for entry in entries.filter_map(|e| e.ok()) {
        let entry_path = entry.path();
        let name = match entry_path.file_name().map(|n| n.to_string_lossy().to_string()) {
            Some(v) if !v.trim().is_empty() => v,
            _ => continue,
        };

        if entry_path.is_dir() {
            let lower = name.to_lowercase();
            if SKIP_DIRS.contains(&lower.as_str()) || lower.starts_with('.') {
                continue;
            }
            // Tokenize directory name
            for tok in tokenize(&name) {
                *tokens.entry(tok).or_insert(0) += 1;
            }
            walk_and_tokenize(&entry_path, depth + 1, tokens);
        } else {
            // Tokenize file name without extension
            let stem = entry_path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            if !stem.is_empty() {
                for tok in tokenize(&stem) {
                    *tokens.entry(tok).or_insert(0) += 1;
                }
            }
            // Extension token
            if let Some(ext) = entry_path.extension().and_then(|e| e.to_str()) {
                let ext_token = format!("ext~{}", ext.to_lowercase());
                *tokens.entry(ext_token).or_insert(0) += 1;
            }
        }
    }
}

pub fn scan_project_folders_sync(conn: &mut Connection) -> Result<FolderScanResult, String> {
    let start = std::time::Instant::now();

    let roots = load_project_folders_from_db(conn)?;
    let subfolders = collect_project_subfolders(&roots);

    // (project_id, token) → count
    let mut aggregated: HashMap<(i64, String), i64> = HashMap::new();
    let mut projects_scanned: i64 = 0;

    for (name, folder_path, _root_path) in &subfolders {
        let project_id = match resolve_project_id_by_name(conn, name) {
            Some(pid) => pid,
            None => continue,
        };
        projects_scanned += 1;

        let mut project_tokens: HashMap<String, i64> = HashMap::new();
        let dir = std::path::PathBuf::from(folder_path);
        walk_and_tokenize(&dir, 0, &mut project_tokens);

        for (token, count) in project_tokens {
            *aggregated.entry((project_id, token)).or_insert(0) += count;
        }
    }

    // Write to DB in a transaction
    let now = chrono::Local::now().to_rfc3339();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM project_folder_tokens", [])
        .map_err(|e| e.to_string())?;

    let tokens_total = aggregated.len() as i64;

    // Batch insert
    {
        let mut stmt = tx
            .prepare("INSERT INTO project_folder_tokens (project_id, token, count, scanned_at) VALUES (?1, ?2, ?3, ?4)")
            .map_err(|e| e.to_string())?;
        for ((project_id, token), count) in &aggregated {
            stmt.execute(rusqlite::params![project_id, token, count, &now])
                .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    let duration_ms = start.elapsed().as_millis() as i64;

    Ok(FolderScanResult {
        projects_scanned,
        tokens_total,
        duration_ms,
    })
}

pub fn get_folder_scan_status_sync(conn: &Connection) -> Result<FolderScanStatus, String> {
    let result = conn
        .query_row(
            "SELECT COUNT(DISTINCT project_id), COUNT(*), MAX(scanned_at) FROM project_folder_tokens",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    let (projects_count, tokens_count, last_scanned_at) = result;

    Ok(FolderScanStatus {
        has_scan_data: tokens_count > 0,
        last_scanned_at,
        projects_count,
        tokens_count,
    })
}

pub fn clear_folder_scan_sync(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM project_folder_tokens", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}
