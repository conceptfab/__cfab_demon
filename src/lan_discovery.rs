// LAN Discovery — UDP broadcast peer discovery for TIMEFLOW LAN Sync.
// Runs in a dedicated thread, controlled by Arc<AtomicBool> stop signal.
// Writes discovered peers to %APPDATA%/TimeFlow/lan_peers.json.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::config;

const DISCOVERY_PORT: u16 = 47892;
const DASHBOARD_PORT_DEFAULT: u16 = 47891;
const BEACON_INTERVAL: Duration = Duration::from_secs(30);
const PEER_EXPIRY: Duration = Duration::from_secs(120);
const RECV_TIMEOUT: Duration = Duration::from_secs(1);
const PROTOCOL_VERSION: u32 = 1;

// ── Beacon / Discovery packets ──

#[derive(Serialize, Deserialize, Debug)]
struct BeaconPacket {
    #[serde(rename = "type")]
    packet_type: String,
    version: u32,
    device_id: String,
    machine_name: String,
    dashboard_port: u16,
    dashboard_running: bool,
    timeflow_version: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct DiscoverPacket {
    #[serde(rename = "type")]
    packet_type: String,
    version: u32,
    device_id: String,
}

// ── Peer info (persisted to lan_peers.json) ──

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PeerInfo {
    pub device_id: String,
    pub machine_name: String,
    pub ip: String,
    pub dashboard_port: u16,
    pub last_seen: String,
    pub dashboard_running: bool,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct PeersFile {
    pub updated_at: String,
    pub peers: Vec<PeerInfo>,
}

// ── Device ID ──

fn get_or_create_device_id() -> String {
    let dir = match config::config_dir() {
        Ok(d) => d,
        Err(_) => return fallback_device_id(),
    };
    let path = dir.join("device_id.txt");
    if let Ok(id) = std::fs::read_to_string(&path) {
        let trimmed = id.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    let id = generate_device_id();
    let _ = std::fs::write(&path, &id);
    id
}

fn generate_device_id() -> String {
    let machine = std::env::var("COMPUTERNAME").unwrap_or_default();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{}-{:x}", machine, ts)
}

fn fallback_device_id() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string())
}

fn get_machine_name() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string())
}

// ── Peers file I/O ──

fn peers_file_path() -> Option<std::path::PathBuf> {
    config::config_dir().ok().map(|d| d.join("lan_peers.json"))
}

fn write_peers_file(peers: &HashMap<String, PeerInfo>) {
    let path = match peers_file_path() {
        Some(p) => p,
        None => return,
    };
    let file = PeersFile {
        updated_at: Utc::now().to_rfc3339(),
        peers: peers.values().cloned().collect(),
    };
    match serde_json::to_string_pretty(&file) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&path, json) {
                log::warn!("LAN discovery: failed to write peers file: {}", e);
            }
        }
        Err(e) => log::warn!("LAN discovery: failed to serialize peers: {}", e),
    }
}

// ── Check if dashboard is running (heartbeat file heuristic) ──

fn is_dashboard_running() -> bool {
    let dir = match config::config_dir() {
        Ok(d) => d,
        Err(_) => return false,
    };
    let heartbeat = dir.join("heartbeat.txt");
    match std::fs::read_to_string(&heartbeat) {
        Ok(content) => {
            if let Ok(ts) = DateTime::parse_from_rfc3339(content.trim()) {
                let age = Utc::now().signed_duration_since(ts.with_timezone(&Utc));
                age.num_seconds() < 60
            } else {
                false
            }
        }
        Err(_) => false,
    }
}

// ── Main discovery loop ──

pub fn start(stop_signal: Arc<AtomicBool>) -> JoinHandle<()> {
    thread::spawn(move || {
        log::info!("LAN discovery thread started");
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_discovery_loop(stop_signal);
        })) {
            Ok(()) => log::info!("LAN discovery thread stopped"),
            Err(_) => log::error!("LAN discovery thread PANICKED (see panic log above)"),
        }
        log::logger().flush();
    })
}

fn run_discovery_loop(stop_signal: Arc<AtomicBool>) {
    let device_id = get_or_create_device_id();
    let machine_name = get_machine_name();
    let version_str = crate::VERSION.trim().to_string();

    log::info!(
        "LAN discovery: device_id={}, machine={}, binding UDP port {}",
        device_id, machine_name, DISCOVERY_PORT
    );

    let socket = match UdpSocket::bind(format!("0.0.0.0:{}", DISCOVERY_PORT)) {
        Ok(s) => {
            log::info!("LAN discovery: UDP socket bound to port {}", DISCOVERY_PORT);
            s
        }
        Err(e) => {
            log::error!("LAN discovery: failed to bind UDP port {}: {}", DISCOVERY_PORT, e);
            return;
        }
    };
    if let Err(e) = socket.set_broadcast(true) {
        log::error!("LAN discovery: failed to set broadcast: {}", e);
        return;
    }
    if let Err(e) = socket.set_read_timeout(Some(RECV_TIMEOUT)) {
        log::error!("LAN discovery: failed to set read timeout: {}", e);
        return;
    }

    let mut peers: HashMap<String, PeerInfo> = HashMap::new();
    let mut last_beacon = Instant::now() - BEACON_INTERVAL; // send immediately
    let mut peers_dirty = false;
    let mut last_peers_write = Instant::now();
    let mut last_status_log = Instant::now();

    // Send initial discover packet
    log::info!("LAN discovery: sending initial discover broadcast");
    send_discover(&socket, &device_id);

    let mut buf = [0u8; 2048];

    loop {
        if stop_signal.load(Ordering::Relaxed) {
            break;
        }

        // Send beacon periodically
        if last_beacon.elapsed() >= BEACON_INTERVAL {
            let dashboard_up = is_dashboard_running();
            send_beacon(
                &socket,
                &device_id,
                &machine_name,
                dashboard_up,
                &version_str,
            );
            last_beacon = Instant::now();
        }

        // Periodic status log (every 60s) so user sees discovery is alive
        if last_status_log.elapsed() >= Duration::from_secs(60) {
            log::info!(
                "LAN discovery: alive, {} peer(s) known",
                peers.len()
            );
            last_status_log = Instant::now();
        }

        // Receive packets (non-blocking with 1s timeout)
        match socket.recv_from(&mut buf) {
            Ok((len, src_addr)) => {
                if let Ok(text) = std::str::from_utf8(&buf[..len]) {
                    handle_packet(
                        text,
                        &src_addr.ip().to_string(),
                        &device_id,
                        &machine_name,
                        &version_str,
                        &socket,
                        &mut peers,
                        &mut peers_dirty,
                    );
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock
                || e.kind() == std::io::ErrorKind::TimedOut => {
                // Normal timeout — continue loop
            }
            Err(e) => {
                log::warn!("LAN discovery: recv error: {}", e);
            }
        }

        // Expire old peers (check every 30s, not every tick)
        if last_beacon.elapsed() < Duration::from_secs(1) {
            let now_utc = Utc::now();
            let before_count = peers.len();
            peers.retain(|_, peer| {
                if let Ok(ts) = DateTime::parse_from_rfc3339(&peer.last_seen) {
                    let age = now_utc.signed_duration_since(ts.with_timezone(&Utc));
                    age.num_seconds() < PEER_EXPIRY.as_secs() as i64
                } else {
                    false
                }
            });
            if peers.len() != before_count {
                log::info!(
                    "LAN discovery: expired {} peer(s), {} remaining",
                    before_count - peers.len(),
                    peers.len()
                );
                peers_dirty = true;
            }
        }

        // Batch-write peers file (max once per 5s)
        if peers_dirty && last_peers_write.elapsed() >= Duration::from_secs(5) {
            write_peers_file(&peers);
            peers_dirty = false;
            last_peers_write = Instant::now();
        }
    }

    // Clear peers file on shutdown
    peers.clear();
    write_peers_file(&peers);
}

fn send_beacon(
    socket: &UdpSocket,
    device_id: &str,
    machine_name: &str,
    dashboard_running: bool,
    version: &str,
) {
    let packet = BeaconPacket {
        packet_type: "timeflow_beacon".to_string(),
        version: PROTOCOL_VERSION,
        device_id: device_id.to_string(),
        machine_name: machine_name.to_string(),
        dashboard_port: DASHBOARD_PORT_DEFAULT,
        dashboard_running,
        timeflow_version: version.to_string(),
    };
    if let Ok(json) = serde_json::to_string(&packet) {
        let target = format!("255.255.255.255:{}", DISCOVERY_PORT);
        if let Err(e) = socket.send_to(json.as_bytes(), &target) {
            log::warn!("LAN discovery: failed to send beacon: {}", e);
        }
    }
}

fn send_discover(socket: &UdpSocket, device_id: &str) {
    let packet = DiscoverPacket {
        packet_type: "timeflow_discover".to_string(),
        version: PROTOCOL_VERSION,
        device_id: device_id.to_string(),
    };
    if let Ok(json) = serde_json::to_string(&packet) {
        let target = format!("255.255.255.255:{}", DISCOVERY_PORT);
        if let Err(e) = socket.send_to(json.as_bytes(), &target) {
            log::warn!("LAN discovery: failed to send discover: {}", e);
        }
    }
}

fn handle_packet(
    text: &str,
    src_ip: &str,
    my_device_id: &str,
    my_machine_name: &str,
    my_version: &str,
    socket: &UdpSocket,
    peers: &mut HashMap<String, PeerInfo>,
    dirty: &mut bool,
) {
    // Try to parse as a generic JSON with "type" field
    let parsed: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return,
    };

    let packet_type = match parsed.get("type").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => return,
    };

    let sender_device_id = parsed
        .get("device_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // Ignore own packets
    if sender_device_id == my_device_id {
        return;
    }

    match packet_type {
        "timeflow_beacon" => {
            if let Ok(beacon) = serde_json::from_str::<BeaconPacket>(text) {
                let peer = PeerInfo {
                    device_id: beacon.device_id.clone(),
                    machine_name: beacon.machine_name,
                    ip: src_ip.to_string(),
                    dashboard_port: beacon.dashboard_port,
                    last_seen: Utc::now().to_rfc3339(),
                    dashboard_running: beacon.dashboard_running,
                };
                let is_new = !peers.contains_key(&beacon.device_id);
                peers.insert(beacon.device_id, peer);
                *dirty = true;
                if is_new {
                    log::info!("LAN discovery: new peer found at {}", src_ip);
                    // Write immediately for new peers so dashboard picks them up fast
                    write_peers_file(peers);
                    *dirty = false;
                }
            }
        }
        "timeflow_discover" => {
            // Respond with our beacon immediately
            send_beacon(
                socket,
                my_device_id,
                my_machine_name,
                is_dashboard_running(),
                my_version,
            );
        }
        _ => {}
    }
}
