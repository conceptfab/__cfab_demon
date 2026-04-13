// LAN Sync — Tauri commands for peer-to-peer synchronization over local network.
// Reads lan_peers.json (written by demon discovery), runs sync with a peer via HTTP.

use super::delta_export::TableHashes;
use super::helpers::{build_table_hashes, timeflow_data_dir};
use crate::db;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// Write a line to logs/lan_sync.log in the TimeFlow data dir (visible to user).
fn sync_log(msg: &str) {
    log::info!("{}", msg);
    if let Ok(dir) = timeflow_data_dir() {
        let logs_dir = dir.join("logs");
        let _ = std::fs::create_dir_all(&logs_dir);
        let path = logs_dir.join("lan_sync.log");
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
    #[serde(default)]
    pub timeflow_version: String,
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
    #[serde(default)]
    pub sync_type: String,
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

/// Read the last N lines from logs/lan_sync.log.
#[tauri::command]
pub fn get_lan_sync_log(lines: Option<usize>) -> Result<String, String> {
    let dir = timeflow_data_dir()?;
    // Try new location first, fall back to legacy
    let path = {
        let new_path = dir.join("logs").join("lan_sync.log");
        if new_path.exists() {
            new_path
        } else {
            dir.join("lan_sync.log")
        }
    };
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
                timeflow_version: peer.version.clone(),
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

// ── Pairing types ──

#[derive(Serialize, Debug)]
pub struct PairingCodeInfo {
    pub code: String,
    pub expires_in_secs: u64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct PairedDeviceInfo {
    pub device_id: String,
    pub machine_name: String,
    pub paired_at: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub last_auth_error_at: Option<String>,
}

#[derive(Deserialize, Debug)]
struct PairResponse {
    ok: bool,
    device_id: Option<String>,
    secret: Option<String>,
    machine_name: Option<String>,
    error: Option<String>,
}

// ── Pairing commands ──

#[tauri::command]
pub async fn generate_pairing_code() -> Result<PairingCodeInfo, String> {
    let result = tokio::task::spawn_blocking(move || {
        let client = build_http_client();
        let url = "http://127.0.0.1:47891/lan/generate-pairing-code";
        let resp = client.post(url)
            .send()
            .map_err(|e| format!("Daemon unreachable: {}", e))?;
        let body: serde_json::Value = resp.json()
            .map_err(|e| format!("Invalid response: {}", e))?;

        if body.get("ok").and_then(|v| v.as_bool()) != Some(true) {
            return Err(body.get("error").and_then(|v| v.as_str()).unwrap_or("unknown error").to_string());
        }

        Ok::<PairingCodeInfo, String>(PairingCodeInfo {
            code: body["code"].as_str().unwrap_or("").to_string(),
            expires_in_secs: body["expires_in_secs"].as_u64().unwrap_or(300),
        })
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;
    Ok(result)
}

#[tauri::command]
pub async fn submit_pairing_code(
    peer_ip: String,
    peer_port: u16,
    code: String,
) -> Result<PairedDeviceInfo, String> {
    let result = tokio::task::spawn_blocking(move || {
        let client = build_http_client();

        // Get local identity + secret so master can store it (mutual pairing)
        let local_info: serde_json::Value = client.get("http://127.0.0.1:47891/lan/local-identity")
            .send()
            .and_then(|r| r.json())
            .unwrap_or_default();
        let local_device_id = local_info.get("device_id").and_then(|v| v.as_str()).unwrap_or("");
        let local_secret = local_info.get("secret").and_then(|v| v.as_str()).unwrap_or("");
        let local_machine_name = local_info.get("machine_name").and_then(|v| v.as_str()).unwrap_or("");

        let body = serde_json::json!({
            "code": code,
            "slave_device_id": local_device_id,
            "slave_secret": local_secret,
            "slave_machine_name": local_machine_name,
        });
        let url = format!("http://{}:{}/lan/pair", peer_ip, peer_port);
        let resp = client.post(&url)
            .json(&body)
            .send()
            .map_err(|e| format!("Peer unreachable: {}", e))?;
        let status = resp.status();
        let pair_resp: PairResponse = resp.json()
            .map_err(|e| format!("Invalid response: {}", e))?;

        if !status.is_success() || !pair_resp.ok {
            return Err(pair_resp.error.unwrap_or_else(|| format!("Pairing failed ({})", status)));
        }

        let device_id = pair_resp.device_id.ok_or("Missing device_id in response")?;
        let secret = pair_resp.secret.ok_or("Missing secret in response")?;
        let machine_name = pair_resp.machine_name.unwrap_or_default();

        // Store in local paired devices via daemon
        let store_body = serde_json::json!({
            "device_id": device_id,
            "secret": secret,
            "machine_name": machine_name,
        });
        let store_url = "http://127.0.0.1:47891/lan/store-paired-device";
        let store_resp = client.post(store_url)
            .json(&store_body)
            .send()
            .map_err(|e| format!("Failed to store pairing: {}", e))?;
        if !store_resp.status().is_success() {
            return Err("Failed to store paired device in daemon".to_string());
        }

        Ok::<PairedDeviceInfo, String>(PairedDeviceInfo {
            device_id,
            machine_name: machine_name.clone(),
            paired_at: chrono::Utc::now().to_rfc3339(),
            last_auth_error_at: None,
        })
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;

    sync_log(&format!("LAN pairing: successfully paired with {}", result.machine_name));
    Ok(result)
}

#[tauri::command]
pub async fn unpair_device(device_id: String) -> Result<bool, String> {
    let result = tokio::task::spawn_blocking(move || {
        let client = build_http_client();
        let body = serde_json::json!({ "device_id": device_id });
        let url = "http://127.0.0.1:47891/lan/remove-paired-device";
        let resp = client.post(url)
            .json(&body)
            .send()
            .map_err(|e| format!("Daemon unreachable: {}", e))?;
        Ok::<bool, String>(resp.status().is_success())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;
    Ok(result)
}

#[tauri::command]
pub async fn get_paired_devices() -> Result<Vec<PairedDeviceInfo>, String> {
    let result = tokio::task::spawn_blocking(move || {
        let client = build_http_client();
        let url = "http://127.0.0.1:47891/lan/paired-devices";
        let resp = client.get(url)
            .send()
            .map_err(|e| format!("Daemon unreachable: {}", e))?;
        let body: serde_json::Value = resp.json()
            .map_err(|e| format!("Invalid response: {}", e))?;
        let devices = body.get("devices")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let result: Vec<PairedDeviceInfo> = devices.iter().filter_map(|d| {
            Some(PairedDeviceInfo {
                device_id: d.get("device_id")?.as_str()?.to_string(),
                machine_name: d.get("machine_name")?.as_str()?.to_string(),
                paired_at: d.get("paired_at")?.as_str()?.to_string(),
                last_auth_error_at: d.get("last_auth_error_at")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
            })
        }).collect();
        Ok::<Vec<PairedDeviceInfo>, String>(result)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;
    Ok(result)
}

// ── Helpers ──

fn build_http_client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .unwrap_or_else(|_| reqwest::blocking::Client::new())
}
