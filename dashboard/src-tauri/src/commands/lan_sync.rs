// LAN Sync — Tauri commands for peer-to-peer synchronization over local network.
// Reads lan_peers.json (written by demon discovery), runs sync with a peer via HTTP.

use super::delta_export::{DeltaArchive, TableHashes};
use super::helpers::{build_table_hashes, timeflow_data_dir};
use super::types::Project;
use crate::db;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// Write a line to lan_sync.log in the TimeFlow data dir (visible to user).
fn sync_log(msg: &str) {
    log::info!("{}", msg);
    if let Ok(dir) = timeflow_data_dir() {
        let path = dir.join("lan_sync.log");
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
            let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
            let _ = writeln!(f, "[{}] {}", ts, msg);
        }
    }
}

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

#[allow(dead_code)]
#[derive(Serialize, Deserialize, Debug)]
struct LanStatusRequest {
    device_id: String,
    table_hashes: TableHashes,
}

#[allow(dead_code)]
#[derive(Serialize, Deserialize, Debug)]
struct LanStatusResponse {
    needs_push: bool,
    needs_pull: bool,
    their_hashes: TableHashes,
}

#[allow(dead_code)]
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

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SyncProgress {
    pub step: u32,
    pub total_steps: u32,
    pub phase: String,
    pub direction: String,
    pub bytes_transferred: u64,
    pub bytes_total: u64,
    pub started_at: u64,
    #[serde(default)]
    pub role: String,
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

/// Insert or update a peer in lan_peers.json (used after manual ping).
#[tauri::command]
pub fn upsert_lan_peer(peer: LanPeer) -> Result<(), String> {
    let path = timeflow_data_dir()?.join("lan_peers.json");
    let mut file = if path.exists() {
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str::<LanPeersFile>(&content).unwrap_or(LanPeersFile {
            updated_at: String::new(),
            peers: Vec::new(),
        })
    } else {
        LanPeersFile {
            updated_at: String::new(),
            peers: Vec::new(),
        }
    };
    file.updated_at = chrono::Utc::now().to_rfc3339();
    if let Some(existing) = file.peers.iter_mut().find(|p| p.device_id == peer.device_id) {
        *existing = peer;
    } else {
        file.peers.push(peer);
    }
    let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

/// Read the last N lines from lan_sync.log.
#[tauri::command]
pub fn get_lan_sync_log(lines: Option<usize>) -> Result<String, String> {
    let path = timeflow_data_dir()?.join("lan_sync.log");
    if !path.exists() {
        return Ok(String::new());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let max = lines.unwrap_or(50);
    let all: Vec<&str> = content.lines().collect();
    let start = if all.len() > max { all.len() - max } else { 0 };
    Ok(all[start..].join("\n"))
}

#[derive(Serialize, Deserialize, Debug)]
pub struct PingLanPeerResult {
    pub device_id: String,
    pub machine_name: String,
    pub ip: String,
    pub dashboard_port: u16,
    pub role: String,
    pub version: String,
}

#[tauri::command]
pub async fn ping_lan_peer(ip: String, port: u16) -> Result<PingLanPeerResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("http://{}:{}/lan/ping", ip, port);
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Cannot reach {}:{} — {}", ip, port, e))?;

    if !resp.status().is_success() {
        return Err(format!("Peer responded with status {}", resp.status()));
    }

    #[derive(Deserialize)]
    struct PingResp {
        device_id: String,
        machine_name: String,
        role: String,
        version: String,
    }
    let ping: PingResp = resp.json().await.map_err(|e| format!("Invalid response: {}", e))?;

    Ok(PingLanPeerResult {
        device_id: ping.device_id,
        machine_name: ping.machine_name,
        ip,
        dashboard_port: port,
        role: ping.role,
        version: ping.version,
    })
}

/// Scan the local /24 subnet for TIMEFLOW peers by pinging port 47891 on each IP.
/// Returns all peers that responded. Runs up to 254 requests in parallel with a short timeout.
#[tauri::command]
pub async fn scan_lan_subnet() -> Result<Vec<PingLanPeerResult>, String> {
    // 1. Determine our own IP (default route)
    let my_ip = {
        let socket = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
        socket.connect("8.8.8.8:80").map_err(|e| e.to_string())?;
        socket.local_addr().map_err(|e| e.to_string())?.ip().to_string()
    };

    let octets: Vec<&str> = my_ip.split('.').collect();
    if octets.len() != 4 {
        return Err(format!("Cannot parse local IP: {}", my_ip));
    }
    let prefix = format!("{}.{}.{}", octets[0], octets[1], octets[2]);

    sync_log(&format!("LAN scan: scanning {}.1-254 on port 47891 (my IP: {})", prefix, my_ip));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(800))
        .build()
        .map_err(|e| e.to_string())?;

    // 2. Ping all 254 hosts in parallel
    let mut handles = Vec::with_capacity(254);
    for i in 1..=254u8 {
        let ip = format!("{}.{}", prefix, i);
        if ip == my_ip {
            continue;
        }
        let client = client.clone();
        handles.push(tokio::spawn(async move {
            let url = format!("http://{}:47891/lan/ping", ip);
            let resp = match client.get(&url).send().await {
                Ok(r) if r.status().is_success() => r,
                _ => return None,
            };
            #[derive(Deserialize)]
            struct PingResp {
                device_id: String,
                machine_name: String,
                role: String,
                version: String,
            }
            let ping: PingResp = resp.json().await.ok()?;
            Some(PingLanPeerResult {
                device_id: ping.device_id,
                machine_name: ping.machine_name,
                ip,
                dashboard_port: 47891,
                role: ping.role,
                version: ping.version,
            })
        }));
    }

    let mut found = Vec::new();
    for handle in handles {
        if let Ok(Some(peer)) = handle.await {
            sync_log(&format!("LAN scan: found peer {} ({}) at {}", peer.machine_name, peer.device_id, peer.ip));
            // Also persist to lan_peers.json so the UI picks it up immediately
            let _ = upsert_lan_peer(LanPeer {
                device_id: peer.device_id.clone(),
                machine_name: peer.machine_name.clone(),
                ip: peer.ip.clone(),
                dashboard_port: peer.dashboard_port,
                last_seen: chrono::Utc::now().to_rfc3339(),
                dashboard_running: true,
            });
            found.push(peer);
        }
    }

    sync_log(&format!("LAN scan: complete — {} peer(s) found", found.len()));
    Ok(found)
}

#[tauri::command]
pub async fn get_lan_sync_progress() -> Result<SyncProgress, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get("http://127.0.0.1:47891/lan/sync-progress")
        .send()
        .await
        .map_err(|e| format!("Daemon not reachable: {}", e))?;

    let progress: SyncProgress = resp.json().await.map_err(|e| e.to_string())?;
    Ok(progress)
}

#[tauri::command]
pub fn build_table_hashes_only(app: AppHandle) -> Result<TableHashes, String> {
    let conn = db::get_connection(&app)?;
    Ok(build_table_hashes(&conn))
}

#[tauri::command]
pub async fn run_lan_sync(
    _app: AppHandle,
    peer_ip: String,
    peer_port: u16,
    _since: String,
    force: Option<bool>,
) -> Result<LanSyncResult, String> {
    let force = force.unwrap_or(false);
    sync_log(&format!("LAN sync: delegating to daemon for peer {}:{}{}", peer_ip, peer_port, if force { " [FORCE]" } else { "" }));

    // 1. Ping peer first to get device_id and verify version
    let ip_c = peer_ip.clone();
    let port_c = peer_port;
    let ping_result = tokio::task::spawn_blocking(move || {
        let client = build_http_client();
        let url = format!("http://{}:{}/lan/ping", ip_c, port_c);
        let resp = client.get(&url).send().map_err(|e| format!("Peer unreachable: {}", e))?;
        let body = resp.text().map_err(|e| format!("Ping read failed: {}", e))?;
        let ping: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| format!("Ping parse failed: {}", e))?;
        Ok::<serde_json::Value, String>(ping)
    })
    .await
    .map_err(|e| format!("Ping task failed: {}", e))??;

    let peer_version = ping_result.get("version").and_then(|v| v.as_str()).unwrap_or("unknown");
    let peer_device_id = ping_result.get("device_id").and_then(|v| v.as_str()).unwrap_or("unknown");
    let local_version = crate::VERSION.trim();

    sync_log(&format!(
        "LAN sync: peer {} v{} (device={}), local v{}",
        peer_ip, peer_version, peer_device_id, local_version
    ));

    if peer_version != local_version {
        let msg = format!(
            "Version mismatch! Local: v{}, Peer: v{}. Update both machines first.",
            local_version, peer_version
        );
        sync_log(&format!("LAN sync: ABORTED — {}", msg));
        return Err(msg);
    }

    sync_log("LAN sync: versions match — triggering daemon sync...");

    // 2. Tell local daemon to run the 13-step sync with the peer
    let trigger_body = serde_json::json!({
        "peer_ip": peer_ip,
        "peer_port": peer_port,
        "peer_device_id": peer_device_id,
        "force": force,
    });

    let _trigger_result = tokio::task::spawn_blocking(move || {
        let client = build_http_client();
        let url = "http://127.0.0.1:47891/lan/trigger-sync";
        let resp = client.post(url)
            .json(&trigger_body)
            .send()
            .map_err(|e| format!("Daemon unreachable: {}", e))?;
        let status = resp.status();
        let body = resp.text().map_err(|e| format!("Read response failed: {}", e))?;
        if !status.is_success() {
            return Err(format!("Daemon refused: {} — {}", status, body));
        }
        sync_log(&format!("LAN sync: daemon accepted — {}", body));
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Trigger task failed: {}", e))??;

    sync_log("LAN sync: sync delegated to daemon — check daemon logs for progress");

    Ok(LanSyncResult {
        ok: true,
        action: "daemon_sync_started".to_string(),
        pulled: false,
        pushed: false,
        import_summary: None,
        error: None,
    })
}

// ── Delta import (merge peer data into local DB) ──
// Kept for potential fallback use; currently daemon handles sync directly.

#[allow(dead_code)]
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
                // Remote is newer — update metadata but keep local assigned_folder_path
                // (each machine has its own folder layout)
                tx.execute(
                    "UPDATE projects SET color = ?1, hourly_rate = ?2, excluded_at = ?3, \
                     frozen_at = ?4, updated_at = ?5 \
                     WHERE name = ?6",
                    rusqlite::params![
                        project.color,
                        project.hourly_rate,
                        project.excluded_at,
                        project.frozen_at,
                        project.updated_at,
                        project.name,
                    ],
                )
                .map_err(|e| e.to_string())?;
                summary.projects_merged += 1;
            }
            None => {
                // New project from remote — insert without assigned_folder_path
                // (folder paths are machine-specific, not transferable)
                tx.execute(
                    "INSERT INTO projects (name, color, hourly_rate, created_at, excluded_at, \
                     frozen_at, is_imported, updated_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)",
                    rusqlite::params![
                        project.name,
                        project.color,
                        project.hourly_rate,
                        project.created_at,
                        project.excluded_at,
                        project.frozen_at,
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

    // Build remote project id → project cache for O(1) lookups
    let remote_project_by_id: std::collections::HashMap<i64, &Project> =
        delta.data.projects.iter().map(|p| (p.id, p)).collect();

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
                    let resolved_project = resolve_project_id_cached(app_row.project_id, &remote_project_by_id, &project_name_map);
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
                let new_id = tx.last_insert_rowid();
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
        let local_project_id = resolve_project_id_cached(session.project_id, &remote_project_by_id, &project_name_map);
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
        let local_project_id = resolve_project_id_cached(Some(ms.project_id), &remote_project_by_id, &project_name_map);

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

    // Post-merge FK integrity check + orphan cleanup
    verify_and_cleanup_after_merge(conn)?;

    Ok(summary)
}

/// Verify foreign key integrity after merge and clean up orphaned records.
#[allow(dead_code)]
fn verify_and_cleanup_after_merge(conn: &rusqlite::Connection) -> Result<(), String> {
    // Delete orphaned sessions (app_id not in applications)
    let orphaned_sessions = conn
        .execute(
            "DELETE FROM sessions WHERE app_id NOT IN (SELECT id FROM applications)",
            [],
        )
        .map_err(|e| e.to_string())?;
    if orphaned_sessions > 0 {
        log::warn!("LAN sync: cleaned up {} orphaned sessions after merge", orphaned_sessions);
    }

    // Delete orphaned manual_sessions (project_id not in projects)
    let orphaned_manual = conn
        .execute(
            "DELETE FROM manual_sessions WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects)",
            [],
        )
        .map_err(|e| e.to_string())?;
    if orphaned_manual > 0 {
        log::warn!("LAN sync: cleaned up {} orphaned manual sessions after merge", orphaned_manual);
    }

    // Run PRAGMA integrity_check (quick validation)
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if integrity != "ok" {
        log::error!("LAN sync: integrity check failed after merge: {}", integrity);
        return Err(format!("Integrity check failed: {}", integrity));
    }

    Ok(())
}

// ── Helpers ──

/// Build a cache of LOWER(TRIM(name)) → local project id for all projects.
/// Called once per import to avoid N+1 queries in resolve_project_id.
#[allow(dead_code)]
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

/// Resolve remote project_id to local project_id using pre-built caches (O(1) lookups).
#[allow(dead_code)]
fn resolve_project_id_cached(
    remote_project_id: Option<i64>,
    remote_project_by_id: &std::collections::HashMap<i64, &Project>,
    project_name_map: &std::collections::HashMap<String, i64>,
) -> Option<i64> {
    let remote_id = remote_project_id?;
    let remote_project = remote_project_by_id.get(&remote_id)?;
    let key = remote_project.name.trim().to_lowercase();
    project_name_map.get(&key).copied()
}

fn build_http_client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .unwrap_or_else(|_| reqwest::blocking::Client::new())
}
