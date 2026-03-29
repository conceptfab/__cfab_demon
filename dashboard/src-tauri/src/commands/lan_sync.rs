// LAN Sync — Tauri commands for peer-to-peer synchronization over local network.
// Reads lan_peers.json (written by demon discovery), runs sync with a peer via HTTP.

use super::delta_export::{DeltaArchive, TableHashes};
use super::helpers::{compute_table_hash, run_app_blocking, run_db_blocking, timeflow_data_dir};
use super::types::Project;
use crate::db;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

// ── Types ──

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LanPeer {
    pub device_id: String,
    pub machine_name: String,
    pub ip: String,
    pub dashboard_port: u16,
    pub last_seen: String,
    pub dashboard_running: bool,
}

#[derive(Serialize, Deserialize, Debug)]
struct LanPeersFile {
    updated_at: String,
    peers: Vec<LanPeer>,
}

#[derive(Serialize, Debug)]
pub struct LanSyncResult {
    pub ok: bool,
    pub action: String,
    pub pulled: bool,
    pub pushed: bool,
    pub import_summary: Option<LanImportSummary>,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct LanImportSummary {
    pub projects_merged: usize,
    pub apps_merged: usize,
    pub sessions_merged: usize,
    pub manual_sessions_merged: usize,
    pub tombstones_applied: usize,
}

#[derive(Serialize, Deserialize, Debug)]
struct LanStatusRequest {
    device_id: String,
    table_hashes: TableHashes,
}

#[derive(Serialize, Deserialize, Debug)]
struct LanStatusResponse {
    needs_push: bool,
    needs_pull: bool,
    their_hashes: TableHashes,
}

#[derive(Serialize, Deserialize, Debug)]
struct LanPullRequest {
    device_id: String,
    since: String,
}

#[derive(Serialize)]
pub struct LanServerStatus {
    pub running: bool,
    pub port: Option<u16>,
}

// ── Commands ──

#[tauri::command]
pub async fn get_lan_peers() -> Result<Vec<LanPeer>, String> {
    let path = timeflow_data_dir()?.join("lan_peers.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let file: LanPeersFile = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(file.peers)
}

#[tauri::command]
pub fn build_table_hashes_only(app: AppHandle) -> Result<TableHashes, String> {
    let conn = db::get_connection(&app)?;
    Ok(TableHashes {
        projects: compute_table_hash(&conn, "projects"),
        applications: compute_table_hash(&conn, "applications"),
        sessions: compute_table_hash(&conn, "sessions"),
        manual_sessions: compute_table_hash(&conn, "manual_sessions"),
    })
}

#[tauri::command]
pub async fn run_lan_sync(
    app: AppHandle,
    peer_ip: String,
    peer_port: u16,
    since: String,
) -> Result<LanSyncResult, String> {
    log::info!("LAN sync: starting with peer {}:{} (since={})", peer_ip, peer_port, since);
    let base_url = format!("http://{}:{}", peer_ip, peer_port);
    let client = build_http_client();

    // 1. Ping peer
    let ping_url = format!("{}/lan/ping", base_url);
    let ping_resp = client
        .get(&ping_url)
        .send()
        .map_err(|e| {
            log::warn!("LAN sync: ping failed for {}:{}: {}", peer_ip, peer_port, e);
            format!("Ping failed: {}", e)
        })?;
    if !ping_resp.status().is_success() {
        return Err(format!("Ping failed with status {}", ping_resp.status()));
    }

    // 2. Get local hashes and send status request
    let local_hashes = run_app_blocking(app.clone(), |app| {
        let conn = db::get_connection(&app)?;
        Ok(TableHashes {
            projects: compute_table_hash(&conn, "projects"),
            applications: compute_table_hash(&conn, "applications"),
            sessions: compute_table_hash(&conn, "sessions"),
            manual_sessions: compute_table_hash(&conn, "manual_sessions"),
        })
    })
    .await?;

    let machine_id = super::helpers::get_machine_id();
    let status_req = LanStatusRequest {
        device_id: machine_id.clone(),
        table_hashes: local_hashes.clone(),
    };

    let status_url = format!("{}/lan/status", base_url);
    let status_resp: LanStatusResponse = client
        .post(&status_url)
        .json(&status_req)
        .send()
        .map_err(|e| format!("Status request failed: {}", e))?
        .json()
        .map_err(|e| format!("Status response parse failed: {}", e))?;

    log::info!(
        "LAN sync: status response — needs_pull={}, needs_push={}",
        status_resp.needs_pull, status_resp.needs_push
    );

    let mut pulled = false;
    let mut pushed = false;
    let mut import_summary = None;

    // 3. Pull if needed (import peer's data first)
    if status_resp.needs_pull {
        let pull_req = LanPullRequest {
            device_id: machine_id.clone(),
            since: since.clone(),
        };
        let pull_url = format!("{}/lan/pull", base_url);
        let peer_delta: DeltaArchive = client
            .post(&pull_url)
            .json(&pull_req)
            .send()
            .map_err(|e| format!("Pull failed: {}", e))?
            .json()
            .map_err(|e| format!("Pull response parse failed: {}", e))?;

        let summary = run_db_blocking(app.clone(), move |conn| {
            import_delta_into_db(conn, &peer_delta)
        })
        .await?;

        log::info!(
            "LAN sync: pull complete — projects={}, apps={}, sessions={}, manual={}",
            summary.projects_merged, summary.apps_merged, summary.sessions_merged, summary.manual_sessions_merged
        );
        import_summary = Some(summary);
        pulled = true;
    }

    // 4. Push if needed (send our data)
    if status_resp.needs_push {
        let since_clone = since.clone();
        let (delta, _) = run_app_blocking(app.clone(), move |app| {
            super::delta_export::build_delta_archive(app, since_clone)
        })
        .await?;

        let push_url = format!("{}/lan/push", base_url);
        let push_resp = client
            .post(&push_url)
            .json(&delta)
            .send()
            .map_err(|e| format!("Push failed: {}", e))?;
        if !push_resp.status().is_success() {
            return Err(format!("Push failed with status {}", push_resp.status()));
        }
        log::info!("LAN sync: push complete");
        pushed = true;
    }

    let action = match (pulled, pushed) {
        (true, true) => "pull+push",
        (true, false) => "pull",
        (false, true) => "push",
        (false, false) => "noop",
    };

    log::info!("LAN sync: done — action={}", action);

    Ok(LanSyncResult {
        ok: true,
        action: action.to_string(),
        pulled,
        pushed,
        import_summary,
        error: None,
    })
}

// ── Delta import (merge peer data into local DB) ──

pub(crate) fn import_delta_into_db(
    conn: &mut rusqlite::Connection,
    delta: &DeltaArchive,
) -> Result<LanImportSummary, String> {
    log::info!(
        "import_delta_into_db: incoming projects={}, apps={}, sessions={}, manual={}, tombstones={}",
        delta.data.projects.len(), delta.data.applications.len(),
        delta.data.sessions.len(), delta.data.manual_sessions.len(),
        delta.data.tombstones.len()
    );
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut summary = LanImportSummary {
        projects_merged: 0,
        apps_merged: 0,
        sessions_merged: 0,
        manual_sessions_merged: 0,
        tombstones_applied: 0,
    };

    // Merge projects (upsert: if exists with same name, update if remote is newer)
    for project in &delta.data.projects {
        let existing: Option<String> = tx
            .query_row(
                "SELECT updated_at FROM projects WHERE name = ?1",
                [&project.name],
                |row| row.get(0),
            )
            .ok();

        match existing {
            Some(local_updated) if local_updated >= project.updated_at => {
                // Local is newer or equal — skip
            }
            Some(_) => {
                // Remote is newer — update
                tx.execute(
                    "UPDATE projects SET color = ?1, hourly_rate = ?2, excluded_at = ?3, \
                     frozen_at = ?4, assigned_folder_path = ?5, updated_at = ?6 \
                     WHERE name = ?7",
                    rusqlite::params![
                        project.color,
                        project.hourly_rate,
                        project.excluded_at,
                        project.frozen_at,
                        project.assigned_folder_path,
                        project.updated_at,
                        project.name,
                    ],
                )
                .map_err(|e| e.to_string())?;
                summary.projects_merged += 1;
            }
            None => {
                // New project — insert
                tx.execute(
                    "INSERT INTO projects (name, color, hourly_rate, created_at, excluded_at, \
                     frozen_at, assigned_folder_path, is_imported, updated_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8)",
                    rusqlite::params![
                        project.name,
                        project.color,
                        project.hourly_rate,
                        project.created_at,
                        project.excluded_at,
                        project.frozen_at,
                        project.assigned_folder_path,
                        project.updated_at,
                    ],
                )
                .map_err(|e| e.to_string())?;
                summary.projects_merged += 1;
            }
        }
    }

    // Build project name → local id cache once (avoids N+1 in resolve_project_id)
    let project_name_map = build_project_name_map(&tx)?;

    // Merge applications (upsert by executable_name, last-writer-wins by updated_at)
    // Also collect app_id mapping inline (avoids a second N+1 query loop)
    let mut app_id_map = std::collections::HashMap::new();
    for app_row in &delta.data.applications {
        let existing: Option<(i64, Option<String>)> = tx
            .query_row(
                "SELECT id, updated_at FROM applications WHERE executable_name = ?1",
                [&app_row.executable_name],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        match existing {
            Some((existing_id, local_updated)) => {
                app_id_map.insert(app_row.id, existing_id);
                let remote_updated = app_row.updated_at.as_deref().unwrap_or("");
                let local_ts = local_updated.as_deref().unwrap_or("");
                if remote_updated > local_ts {
                    let resolved_project = resolve_project_id_cached(app_row.project_id, &delta.data.projects, &project_name_map);
                    tx.execute(
                        "UPDATE applications SET display_name = ?1, project_id = ?2, \
                         updated_at = ?3 WHERE id = ?4",
                        rusqlite::params![
                            app_row.display_name,
                            resolved_project,
                            remote_updated,
                            existing_id,
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                    summary.apps_merged += 1;
                }
            }
            None => {
                tx.execute(
                    "INSERT INTO applications (executable_name, display_name, project_id, is_imported) \
                     VALUES (?1, ?2, ?3, 1)",
                    rusqlite::params![
                        app_row.executable_name,
                        app_row.display_name,
                        app_row.project_id,
                    ],
                )
                .map_err(|e| e.to_string())?;
                // Get the newly inserted id for the mapping
                let new_id: i64 = tx
                    .query_row(
                        "SELECT id FROM applications WHERE executable_name = ?1",
                        [&app_row.executable_name],
                        |row| row.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                app_id_map.insert(app_row.id, new_id);
                summary.apps_merged += 1;
            }
        }
    }

    log::info!(
        "import_delta_into_db: app_id_map has {} entries, processing {} sessions",
        app_id_map.len(), delta.data.sessions.len()
    );

    // Merge sessions (upsert: last-writer-wins by updated_at)
    for session in &delta.data.sessions {
        let local_app_id = match app_id_map.get(&session.app_id) {
            Some(id) => *id,
            None => continue, // app not found locally
        };

        // Resolve project_id via name if different DB
        let local_project_id = resolve_project_id_cached(session.project_id, &delta.data.projects, &project_name_map);
        let remote_updated = session.updated_at.as_deref().unwrap_or("");
        let utc_fallback;
        let effective_updated = if remote_updated.is_empty() {
            utc_fallback = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
            utc_fallback.as_str()
        } else {
            remote_updated
        };

        let existing: Option<(i64, Option<String>)> = tx
            .query_row(
                "SELECT id, updated_at FROM sessions WHERE app_id = ?1 AND start_time = ?2",
                rusqlite::params![local_app_id, session.start_time],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        match existing {
            Some((existing_id, local_updated)) => {
                let local_ts = local_updated.as_deref().unwrap_or("");
                if effective_updated > local_ts {
                    tx.execute(
                        "UPDATE sessions SET project_id = ?1, end_time = ?2, \
                         duration_seconds = ?3, rate_multiplier = ?4, comment = ?5, \
                         is_hidden = ?6, updated_at = ?7 WHERE id = ?8",
                        rusqlite::params![
                            local_project_id,
                            session.end_time,
                            session.duration_seconds,
                            session.rate_multiplier,
                            session.comment,
                            session.is_hidden as i64,
                            effective_updated,
                            existing_id,
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                    summary.sessions_merged += 1;
                }
            }
            None => {
                tx.execute(
                    "INSERT OR IGNORE INTO sessions (app_id, project_id, start_time, end_time, \
                     duration_seconds, date, rate_multiplier, comment, is_hidden, updated_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    rusqlite::params![
                        local_app_id,
                        local_project_id,
                        session.start_time,
                        session.end_time,
                        session.duration_seconds,
                        session.date,
                        session.rate_multiplier,
                        session.comment,
                        session.is_hidden as i64,
                        effective_updated,
                    ],
                )
                .map_err(|e| e.to_string())?;
                summary.sessions_merged += 1;
            }
        }
    }

    // Merge manual sessions (upsert by project_id + start_time + title — matches UNIQUE constraint)
    for ms in &delta.data.manual_sessions {
        let local_project_id = resolve_project_id_cached(Some(ms.project_id), &delta.data.projects, &project_name_map);

        let existing: Option<(i64, Option<String>)> = tx
            .query_row(
                "SELECT id, updated_at FROM manual_sessions \
                 WHERE project_id = ?1 AND start_time = ?2 AND title = ?3",
                rusqlite::params![local_project_id, ms.start_time, ms.title],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        match existing {
            Some((existing_id, local_updated)) => {
                let local_ts = local_updated.as_deref().unwrap_or("");
                if ms.updated_at.as_str() > local_ts {
                    tx.execute(
                        "UPDATE manual_sessions SET session_type = ?1, app_id = ?2, \
                         end_time = ?3, duration_seconds = ?4, date = ?5, \
                         updated_at = ?6 WHERE id = ?7",
                        rusqlite::params![
                            ms.session_type,
                            ms.app_id,
                            ms.end_time,
                            ms.duration_seconds,
                            ms.date,
                            ms.updated_at,
                            existing_id,
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                    summary.manual_sessions_merged += 1;
                }
            }
            None => {
                tx.execute(
                    "INSERT INTO manual_sessions (title, session_type, project_id, app_id, \
                     start_time, end_time, duration_seconds, date, created_at, updated_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    rusqlite::params![
                        ms.title,
                        ms.session_type,
                        local_project_id,
                        ms.app_id,
                        ms.start_time,
                        ms.end_time,
                        ms.duration_seconds,
                        ms.date,
                        ms.created_at,
                        ms.updated_at,
                    ],
                )
                .map_err(|e| e.to_string())?;
                summary.manual_sessions_merged += 1;
            }
        }
    }

    // Apply tombstones — delete by sync_key (not record_id, which differs between machines)
    for ts in &delta.data.tombstones {
        let sync_key = match ts.table_name.as_str() {
            "projects" | "applications" | "sessions" | "manual_sessions" => {
                ts.sync_key.as_deref().unwrap_or("")
            }
            _ => continue,
        };

        // Check if tombstone already applied (by sync_key for cross-machine dedup)
        let exists: Option<i64> = tx
            .query_row(
                "SELECT 1 FROM tombstones WHERE table_name = ?1 AND sync_key = ?2",
                rusqlite::params![ts.table_name, ts.sync_key],
                |row| row.get(0),
            )
            .ok();
        if exists.is_some() {
            continue;
        }

        // Delete actual record by sync_key (natural key), not by record_id
        match ts.table_name.as_str() {
            "projects" => {
                let _ = tx.execute("DELETE FROM projects WHERE name = ?1", [sync_key]);
            }
            "manual_sessions" => {
                let parts: Vec<&str> = sync_key.splitn(3, '|').collect();
                if parts.len() == 3 {
                    let _ = tx.execute(
                        "DELETE FROM manual_sessions WHERE start_time = ?1 AND title = ?2",
                        rusqlite::params![parts[1], parts[2]],
                    );
                }
            }
            "applications" => {
                let _ = tx.execute(
                    "DELETE FROM applications WHERE executable_name = ?1",
                    [sync_key],
                );
            }
            "sessions" => {
                let parts: Vec<&str> = sync_key.splitn(2, '|').collect();
                if parts.len() == 2 {
                    let _ = tx.execute(
                        "DELETE FROM sessions WHERE app_id IN \
                         (SELECT id FROM applications WHERE executable_name = ?1) \
                         AND start_time = ?2",
                        rusqlite::params![parts[0], parts[1]],
                    );
                }
            }
            _ => {}
        }

        // Insert tombstone record
        tx.execute(
            "INSERT OR IGNORE INTO tombstones (table_name, record_id, record_uuid, deleted_at, sync_key) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                ts.table_name,
                ts.record_id,
                ts.record_uuid,
                ts.deleted_at,
                ts.sync_key,
            ],
        )
        .map_err(|e| e.to_string())?;
        summary.tombstones_applied += 1;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(summary)
}

// ── Helpers ──

/// Build a cache of LOWER(TRIM(name)) → local project id for all projects.
/// Called once per import to avoid N+1 queries in resolve_project_id.
fn build_project_name_map(
    tx: &rusqlite::Transaction,
) -> Result<std::collections::HashMap<String, i64>, String> {
    let mut stmt = tx
        .prepare("SELECT id, name FROM projects")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let id: i64 = row.get(0)?;
            let name: String = row.get(1)?;
            Ok((name.trim().to_lowercase(), id))
        })
        .map_err(|e| e.to_string())?;
    let mut map = std::collections::HashMap::new();
    for row in rows {
        let (key, id) = row.map_err(|e| e.to_string())?;
        map.insert(key, id);
    }
    Ok(map)
}

/// Resolve remote project_id to local project_id using pre-built name cache.
fn resolve_project_id_cached(
    remote_project_id: Option<i64>,
    remote_projects: &[Project],
    project_name_map: &std::collections::HashMap<String, i64>,
) -> Option<i64> {
    let remote_id = remote_project_id?;
    let remote_project = remote_projects.iter().find(|p| p.id == remote_id)?;
    let key = remote_project.name.trim().to_lowercase();
    project_name_map.get(&key).copied()
}

fn build_http_client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::blocking::Client::new())
}
