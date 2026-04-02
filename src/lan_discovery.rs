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
use crate::lan_common;
use crate::lan_server::LanSyncState;
use crate::lan_sync_orchestrator;

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
    #[serde(default = "default_role")]
    role: String,
    #[serde(default)]
    sync_marker_hash: Option<String>,
    #[serde(default)]
    sync_ready: bool,
    /// Seconds since this daemon started (used for master election — longer uptime wins).
    /// Capped at MAX_UPTIME_SECS to limit spoofing impact.
    #[serde(default)]
    uptime_secs: u64,
}

/// Cap uptime at 30 days — any value beyond is likely spoofed or a bug.
const MAX_UPTIME_SECS: u64 = 30 * 24 * 3600;

fn default_role() -> String {
    "undecided".to_string()
}

#[derive(Serialize, Deserialize, Debug)]
struct DiscoverPacket {
    #[serde(rename = "type")]
    packet_type: String,
    version: u32,
    device_id: String,
}

/// Tagged enum for single-pass JSON parsing of inbound packets
#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
enum InboundPacket {
    #[serde(rename = "timeflow_beacon")]
    Beacon(BeaconPacket),
    #[serde(rename = "timeflow_discover")]
    Discover(DiscoverPacket),
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
    #[serde(default = "default_role")]
    pub role: String,
    #[serde(default)]
    pub uptime_secs: u64,
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
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    // Include process ID to avoid collisions when multiple instances start simultaneously
    let pid = std::process::id();
    format!("{}-{:x}-{:x}", machine, ts, pid)
}

fn fallback_device_id() -> String {
    lan_common::get_machine_name()
}

fn get_machine_name() -> String {
    lan_common::get_machine_name()
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

pub fn start(stop_signal: Arc<AtomicBool>, sync_state: Option<Arc<LanSyncState>>) -> JoinHandle<()> {
    thread::spawn(move || {
        log::info!("LAN discovery thread started");
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_discovery_loop(stop_signal, sync_state);
        })) {
            Ok(()) => log::info!("LAN discovery thread stopped"),
            Err(_) => log::error!("LAN discovery thread PANICKED (see panic log above)"),
        }
        log::logger().flush();
    })
}

fn run_discovery_loop(stop_signal: Arc<AtomicBool>, sync_state: Option<Arc<LanSyncState>>) {
    let device_id = get_or_create_device_id();
    let machine_name = get_machine_name();
    let version_str = crate::VERSION.trim().to_string();
    let started_at = Instant::now();

    log::info!(
        "LAN discovery: device_id={}, machine={}, binding UDP port {}",
        device_id, machine_name, DISCOVERY_PORT
    );

    let socket = {
        let mut attempts = 0;
        loop {
            match UdpSocket::bind(format!("0.0.0.0:{}", DISCOVERY_PORT)) {
                Ok(s) => {
                    log::info!("LAN discovery: UDP socket bound to port {}", DISCOVERY_PORT);
                    break s;
                }
                Err(e) => {
                    attempts += 1;
                    if attempts >= 3 {
                        log::error!("LAN discovery: failed to bind UDP port {} after {} attempts: {}", DISCOVERY_PORT, attempts, e);
                        return;
                    }
                    log::warn!("LAN discovery: bind attempt {}/3 failed: {}, retrying in 2s...", attempts, e);
                    thread::sleep(Duration::from_secs(2));
                }
            }
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
    let mut peers_dirty = false;
    let mut last_peers_write = Instant::now();
    let mut last_status_log = Instant::now();
    let mut last_expiry_check = Instant::now();

    // Clear stale peers file from previous daemon session on startup
    write_peers_file(&peers);

    // ── Role assignment: forced or elected ──
    let lan_settings = config::load_lan_sync_settings();
    let forced = match lan_settings.forced_role.as_str() {
        "master" | "slave" => {
            if let Some(ref state) = sync_state {
                state.set_role(&lan_settings.forced_role);
                log::info!("LAN discovery: role FORCED to {} by settings", lan_settings.forced_role);
                log::logger().flush();
            }
            true
        }
        _ => false,
    };

    // Startup election: discover existing master in ≤5s (skipped if forced)
    if !forced {
        log::info!("LAN discovery: starting election — searching for existing master...");
        log::logger().flush();
        let election_start = Instant::now();
        let election_timeout = Duration::from_secs(5);
        let burst_interval = Duration::from_secs(1);
        let mut bursts_sent = 0u32;
        let mut found_master = false;
        let mut election_buf = [0u8; 2048];

        while election_start.elapsed() < election_timeout {
            if stop_signal.load(Ordering::Relaxed) {
                return;
            }
            // Send discover bursts at 0s, 1s, 2s
            if bursts_sent < 3 && election_start.elapsed() >= burst_interval.saturating_mul(bursts_sent) {
                send_discover(&socket, &device_id);
                // Also send beacon as undecided so existing master sees us
                send_beacon(&socket, &device_id, &machine_name, is_dashboard_running(),
                    &version_str, "undecided", 0);
                bursts_sent += 1;
                log::info!("LAN discovery: election burst {}/3 sent", bursts_sent);
            }
            // Listen for responses
            match socket.recv_from(&mut election_buf) {
                Ok((len, src_addr)) => {
                    if let Ok(text) = std::str::from_utf8(&election_buf[..len]) {
                        if let Ok(InboundPacket::Beacon(beacon)) = serde_json::from_str::<InboundPacket>(text) {
                            if beacon.device_id != device_id {
                                let peer = PeerInfo {
                                    device_id: beacon.device_id.clone(),
                                    machine_name: beacon.machine_name,
                                    ip: src_addr.ip().to_string(),
                                    dashboard_port: beacon.dashboard_port,
                                    last_seen: Utc::now().to_rfc3339(),
                                    dashboard_running: beacon.dashboard_running,
                                    role: beacon.role.clone(),
                                    uptime_secs: beacon.uptime_secs,
                                };
                                peers.insert(beacon.device_id.clone(), peer);
                                peers_dirty = true;

                                if beacon.role == "master" {
                                    found_master = true;
                                    log::info!(
                                        "LAN discovery: found existing MASTER {} at {} (uptime {}s) — becoming SLAVE",
                                        beacon.device_id, src_addr.ip(), beacon.uptime_secs
                                    );
                                    if let Some(ref state) = sync_state {
                                        state.set_role("slave");
                                    }
                                    break;
                                } else {
                                    log::info!(
                                        "LAN discovery: found peer {} at {} (role={}, uptime {}s)",
                                        beacon.device_id, src_addr.ip(), beacon.role, beacon.uptime_secs
                                    );
                                }
                            }
                        }
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut => {}
                Err(_) => {}
            }
        }

        if !found_master {
            // No master in the network — elect one
            if let Some(ref state) = sync_state {
                let my_uptime = started_at.elapsed().as_secs();
                // Check if any peer has been running longer than us
                let older_peer = peers.values().any(|p| {
                    p.uptime_secs > my_uptime
                        || (p.uptime_secs == my_uptime && p.device_id.as_str() < device_id.as_str())
                });

                if peers.is_empty() {
                    state.set_role("master");
                    log::info!("LAN discovery: no peers found in {}s — becoming MASTER",
                        election_start.elapsed().as_secs());
                } else if older_peer {
                    state.set_role("slave");
                    log::info!("LAN discovery: found older peer(s) among {} — becoming SLAVE (my uptime {}s)",
                        peers.len(), my_uptime);
                } else {
                    state.set_role("master");
                    log::info!("LAN discovery: longest uptime ({}s) among {} peer(s) — becoming MASTER",
                        my_uptime, peers.len());
                }
            }
        }

        if peers_dirty {
            write_peers_file(&peers);
            peers_dirty = false;
        }

        // Announce our role immediately after election
        if let Some(ref state) = sync_state {
            let role = state.get_role();
            send_beacon(&socket, &device_id, &machine_name, is_dashboard_running(),
                &version_str, &role, started_at.elapsed().as_secs());
            log::info!("LAN discovery: election complete — role={}, peers={}", role, peers.len());
            log::logger().flush();
        }
    } // end if !forced

    // Announce role immediately (forced or elected)
    if let Some(ref state) = sync_state {
        let role = state.get_role();
        send_beacon(&socket, &device_id, &machine_name, is_dashboard_running(),
            &version_str, &role, started_at.elapsed().as_secs());
    }

    let mut last_beacon = Instant::now();

    let mut buf = [0u8; 2048];
    let mut sync_handle: Option<JoinHandle<()>> = None;
    let mut last_sync_attempt = Instant::now().checked_sub(Duration::from_secs(3600)).unwrap_or(Instant::now()); // allow immediate first sync
    let mut last_settings_reload = Instant::now().checked_sub(Duration::from_secs(300)).unwrap_or(Instant::now());
    let mut lan_settings = config::load_lan_sync_settings();
    // Track when the next sync window should open
    let mut next_sync_window = Instant::now(); // first window starts immediately
    let mut discovery_active = true;
    let mut role_is_forced = forced;

    loop {
        if stop_signal.load(Ordering::Relaxed) {
            break;
        }

        // Reload LAN sync settings periodically (every 60s)
        if last_settings_reload.elapsed() >= Duration::from_secs(60) {
            lan_settings = config::load_lan_sync_settings();
            last_settings_reload = Instant::now();

            // Apply forced role changes from settings (user toggled in UI)
            match lan_settings.forced_role.as_str() {
                "master" | "slave" => {
                    if let Some(ref state) = sync_state {
                        let current = state.get_role();
                        if current != lan_settings.forced_role {
                            state.set_role(&lan_settings.forced_role);
                            log::info!("LAN discovery: role changed to {} by settings", lan_settings.forced_role);
                        }
                    }
                    role_is_forced = true;
                }
                _ => {
                    role_is_forced = false;
                }
            }

            if !lan_settings.enabled {
                if discovery_active {
                    log::info!("LAN discovery: disabled by settings");
                    discovery_active = false;
                }
            }
        }

        // Scheduled discovery: check if we're in the active window
        if lan_settings.enabled && lan_settings.sync_interval_hours > 0 {
            let now = Instant::now();
            if now >= next_sync_window {
                if !discovery_active {
                    log::info!("LAN discovery: sync window opened");
                    discovery_active = true;
                }
                // Discovery window duration
                let window_duration = Duration::from_secs(lan_settings.discovery_duration_minutes as u64 * 60);
                if now > next_sync_window + window_duration {
                    // Window closed, schedule next
                    let interval = Duration::from_secs(lan_settings.sync_interval_hours as u64 * 3600);
                    next_sync_window = now + interval;
                    if peers.is_empty() {
                        discovery_active = false;
                        log::info!("LAN discovery: window closed, next in {}h", lan_settings.sync_interval_hours);
                    }
                    // If sync was successful, also deactivate
                    if let Some(ref state) = sync_state {
                        if !state.sync_in_progress.load(Ordering::Relaxed) {
                            let role = state.get_role();
                            if role != "undecided" {
                                discovery_active = false;
                                state.set_role("undecided");
                            }
                        }
                    }
                }
            }
        } else if lan_settings.sync_interval_hours == 0 && lan_settings.enabled {
            // Manual only — still listen for beacons but don't send proactively
            discovery_active = true;
        }

        // Check if we should trigger sync as master
        if let Some(ref state) = sync_state {
            let role = state.get_role();
            let in_progress = state.sync_in_progress.load(Ordering::Relaxed);
            let handle_done = sync_handle.as_ref().map_or(true, |h| h.is_finished());

            if role == "master" && !in_progress && handle_done && last_sync_attempt.elapsed() >= Duration::from_secs(60) {
                // Find a slave peer to sync with
                if let Some(slave) = peers.values().find(|p| p.role == "slave" || p.role == "undecided") {
                    log::info!("LAN discovery: triggering sync as MASTER with peer {} ({})", slave.device_id, slave.ip);
                    last_sync_attempt = Instant::now();
                    let target = lan_sync_orchestrator::PeerTarget {
                        ip: slave.ip.clone(),
                        port: slave.dashboard_port,
                        device_id: slave.device_id.clone(),
                    };
                    sync_handle = Some(lan_sync_orchestrator::run_sync_as_master(
                        target,
                        Arc::clone(state),
                        stop_signal.clone(),
                    ));
                }
            }
        }

        // Send beacon periodically (only when discovery is active)
        if discovery_active && last_beacon.elapsed() >= BEACON_INTERVAL {
            let dashboard_up = is_dashboard_running();
            let current_role = sync_state.as_ref()
                .map(|s| s.get_role())
                .unwrap_or_else(|| "undecided".to_string());
            send_beacon(
                &socket,
                &device_id,
                &machine_name,
                dashboard_up,
                &version_str,
                &current_role,
                started_at.elapsed().as_secs(),
            );
            last_beacon = Instant::now();
        }

        // Role is decided during startup election — no delayed assignment needed

        // Periodic status log (every 60s) so user sees discovery is alive
        if last_status_log.elapsed() >= Duration::from_secs(60) {
            let current_role = sync_state.as_ref()
                .map(|s| s.get_role())
                .unwrap_or_else(|| "undecided".to_string());
            log::info!(
                "LAN discovery: alive, {} peer(s) known, role={}",
                peers.len(),
                current_role
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
                        &sync_state,
                        started_at.elapsed().as_secs(),
                        role_is_forced,
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

        // Expire old peers (check every 30s, independent of beacon sending)
        if last_expiry_check.elapsed() >= Duration::from_secs(30) {
            last_expiry_check = Instant::now();
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

    // Join any outstanding sync handle before exiting
    if let Some(handle) = sync_handle.take() {
        let _ = handle.join();
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
    role: &str,
    uptime_secs: u64,
) {
    let packet = BeaconPacket {
        packet_type: "timeflow_beacon".to_string(),
        version: PROTOCOL_VERSION,
        device_id: device_id.to_string(),
        machine_name: machine_name.to_string(),
        dashboard_port: DASHBOARD_PORT_DEFAULT,
        dashboard_running,
        timeflow_version: version.to_string(),
        role: role.to_string(),
        sync_marker_hash: None,
        sync_ready: true,
        uptime_secs,
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
    sync_state: &Option<Arc<LanSyncState>>,
    my_uptime_secs: u64,
    role_is_forced: bool,
) {
    let packet: InboundPacket = match serde_json::from_str(text) {
        Ok(p) => p,
        Err(_) => return,
    };

    match packet {
        InboundPacket::Beacon(beacon) => {
            if beacon.device_id == my_device_id {
                return;
            }
            let is_new = !peers.contains_key(&beacon.device_id);
            let peer = PeerInfo {
                device_id: beacon.device_id.clone(),
                machine_name: beacon.machine_name,
                ip: src_ip.to_string(),
                dashboard_port: beacon.dashboard_port,
                last_seen: Utc::now().to_rfc3339(),
                dashboard_running: beacon.dashboard_running,
                role: beacon.role.clone(),
                uptime_secs: beacon.uptime_secs,
            };
            peers.insert(beacon.device_id.clone(), peer);
            *dirty = true;

            // Role assignment logic (including master-master conflict resolution)
            // Skipped when role is forced by user in settings.
            if role_is_forced {
                // Forced role — no automatic changes
            } else if let Some(ref state) = sync_state {
                let my_role = state.get_role();
                // Cap both uptimes to prevent spoofing from dominating election
                let my_up = my_uptime_secs.min(MAX_UPTIME_SECS);
                let peer_up = beacon.uptime_secs.min(MAX_UPTIME_SECS);
                let i_win_election = my_up > peer_up
                    || (my_up == peer_up && my_device_id < beacon.device_id.as_str());

                match (my_role.as_str(), beacon.role.as_str()) {
                    ("undecided", "master") => {
                        state.set_role("slave");
                        log::info!(
                            "LAN discovery: peer {} is MASTER (uptime {}s) — assuming SLAVE role",
                            beacon.device_id, beacon.uptime_secs
                        );
                    }
                    ("undecided", "undecided") | ("undecided", "slave") => {
                        if i_win_election {
                            state.set_role("master");
                            log::info!(
                                "LAN discovery: election with {} — assuming MASTER (my uptime {}s > peer {}s)",
                                beacon.device_id, my_uptime_secs, beacon.uptime_secs
                            );
                        } else {
                            state.set_role("slave");
                            log::info!(
                                "LAN discovery: election with {} — assuming SLAVE (my uptime {}s <= peer {}s)",
                                beacon.device_id, my_uptime_secs, beacon.uptime_secs
                            );
                        }
                    }
                    ("master", "master") => {
                        // Conflict! Two masters — longer uptime keeps master
                        if i_win_election {
                            log::info!(
                                "LAN discovery: MASTER-MASTER conflict with {} — keeping MASTER (my uptime {}s > peer {}s)",
                                beacon.device_id, my_uptime_secs, beacon.uptime_secs
                            );
                        } else {
                            state.set_role("slave");
                            log::info!(
                                "LAN discovery: MASTER-MASTER conflict with {} — yielding to SLAVE (my uptime {}s <= peer {}s)",
                                beacon.device_id, my_uptime_secs, beacon.uptime_secs
                            );
                        }
                    }
                    _ => {}
                }
            }

            if is_new {
                log::info!("LAN discovery: new peer found at {} (role={})", src_ip, beacon.role);
                write_peers_file(peers);
                *dirty = false;
            }
        }
        InboundPacket::Discover(discover) => {
            if discover.device_id == my_device_id {
                return;
            }
            let current_role = sync_state.as_ref()
                .map(|s| s.get_role())
                .unwrap_or_else(|| "undecided".to_string());
            send_beacon(
                socket,
                my_device_id,
                my_machine_name,
                is_dashboard_running(),
                my_version,
                &current_role,
                my_uptime_secs,
            );
        }
    }
}
