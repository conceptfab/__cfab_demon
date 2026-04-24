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

#[cfg(windows)]
use timeflow_shared::process_utils::no_console;

use crate::config;
use crate::lan_common;
use crate::lan_server::LanSyncState;
use crate::lan_sync_orchestrator;

/// Cached ipconfig output to avoid spawning the process on every beacon (every 30s).
/// TTL: 120 seconds.
/// TODO: Replace with WinAPI GetAdaptersAddresses for locale-independent results.
#[cfg(windows)]
static IPCONFIG_CACHE: std::sync::Mutex<Option<(Instant, String)>> = std::sync::Mutex::new(None);
#[cfg(windows)]
const IPCONFIG_CACHE_TTL: Duration = Duration::from_secs(120);

#[cfg(windows)]
fn get_ipconfig_output() -> Option<String> {
    if let Ok(guard) = IPCONFIG_CACHE.lock() {
        if let Some((ts, ref cached)) = *guard {
            if ts.elapsed() < IPCONFIG_CACHE_TTL {
                return Some(cached.clone());
            }
        }
    }
    let mut cmd = std::process::Command::new("ipconfig");
    no_console(&mut cmd);
    let output = cmd.output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout).into_owned();
    if let Ok(mut guard) = IPCONFIG_CACHE.lock() {
        *guard = Some((Instant::now(), text.clone()));
    }
    Some(text)
}

#[cfg(not(windows))]
fn get_ipconfig_output() -> Option<String> {
    None
}

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
// Unified: uses lan_common::get_device_id() which creates the file if missing.

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

/// Load IP addresses from the previous peers file (before clearing it).
/// Used to immediately probe known peers on daemon restart.
fn load_previous_peer_ips() -> Vec<String> {
    let path = match peers_file_path() {
        Some(p) => p,
        None => return Vec::new(),
    };
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let file: PeersFile = match serde_json::from_str(&content) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };
    file.peers.iter().map(|p| p.ip.clone()).collect()
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
    let device_id = lan_common::get_device_id();
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

    // Log broadcast addresses and unicast scan ranges at startup
    let bcast_addrs = get_subnet_broadcast_addresses();
    let local_ifaces = get_local_interfaces();
    if bcast_addrs.is_empty() {
        log::warn!("LAN discovery: NO subnet broadcast addresses found — only 255.255.255.255 will be used");
    } else {
        log::info!("LAN discovery: broadcast targets: [255.255.255.255, {}]", bcast_addrs.join(", "));
    }
    for iface in &local_ifaces {
        log::info!(
            "LAN discovery: unicast scan: {}.{}.{}.{}/{}.{}.{}.{} ({} hosts)",
            iface.ip[0], iface.ip[1], iface.ip[2], iface.ip[3],
            iface.mask[0], iface.mask[1], iface.mask[2], iface.mask[3],
            iface.host_count(),
        );
    }
    if local_ifaces.is_empty() {
        log::warn!("LAN discovery: NO real LAN interfaces found for unicast scan");
    }

    let mut peers: HashMap<String, PeerInfo> = HashMap::new();
    let mut peers_dirty = false;
    let mut last_peers_write = Instant::now();
    let mut last_status_log = Instant::now();
    let mut last_expiry_check = Instant::now();

    // Load previous peers and probe their known IPs immediately (unicast).
    // This dramatically speeds up re-discovery after daemon restart because
    // peers usually keep the same LAN IP.
    let previous_ips = load_previous_peer_ips();
    if !previous_ips.is_empty() {
        log::info!("LAN discovery: probing {} known IP(s) from previous session: {:?}", previous_ips.len(), previous_ips);
        let probe_packet = serde_json::to_string(&DiscoverPacket {
            packet_type: "timeflow_discover".to_string(),
            version: PROTOCOL_VERSION,
            device_id: device_id.clone(),
        }).unwrap_or_default();
        for ip in &previous_ips {
            let target = format!("{}:{}", ip, DISCOVERY_PORT);
            let _ = socket.send_to(probe_packet.as_bytes(), &target);
        }
    }
    // Clear file after reading — will be repopulated as peers respond
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
    let mut last_http_scan = Instant::now();
    let mut last_full_scan = Instant::now();

    let mut buf = [0u8; 2048];
    let mut sync_handle: Option<JoinHandle<()>> = None;
    let mut last_sync_attempt = Instant::now();
    let mut last_settings_reload = Instant::now();
    // Force immediate execution of all scans on first loop iteration.
    let mut first_run = true;
    let mut lan_settings = config::load_lan_sync_settings();
    let mut discovery_active = true;
    let mut role_is_forced = forced;

    loop {
        if stop_signal.load(Ordering::Relaxed) {
            break;
        }

        // Reload LAN sync settings frequently for responsive UI (every 5s)
        if last_settings_reload.elapsed() >= Duration::from_secs(5) {
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

        // Discovery stays active as long as LAN sync is enabled.
        // Beacons must be sent continuously so peers can always find each other.
        // The sync_interval_hours controls how often SYNC is triggered, not discovery.
        if lan_settings.enabled {
            if !discovery_active {
                log::info!("LAN discovery: re-enabled by settings");
                discovery_active = true;
                // Force immediate beacon when re-activated
                last_beacon = Instant::now().checked_sub(BEACON_INTERVAL).unwrap_or(Instant::now());
            }
        } else if discovery_active {
            // Already logged "disabled by settings" above
        }

        // Check if we should trigger sync as master.
        // Respects user settings: sync_interval_hours=0 means MANUAL ONLY (no auto-sync).
        // auto_sync_on_peer_found must be true for daemon to auto-trigger.
        if let Some(ref state) = sync_state {
            let role = state.get_role();
            let in_progress = state.sync_in_progress.load(Ordering::Relaxed);
            let handle_done = sync_handle.as_ref().map_or(true, |h| h.is_finished());

            // Only auto-sync if: interval > 0 AND auto_sync_on_peer_found is enabled
            let should_auto_sync = lan_settings.auto_sync_on_peer_found
                && lan_settings.sync_interval_hours > 0;

            if should_auto_sync {
                let sync_cooldown = Duration::from_secs(lan_settings.sync_interval_hours as u64 * 3600);
                let completed_cooldown_ok =
                    state.secs_since_last_sync() >= crate::lan_server::SYNC_COOLDOWN_SECS;
                if role == "master" && !in_progress && handle_done && completed_cooldown_ok && last_sync_attempt.elapsed() >= sync_cooldown {
                    // Find a slave peer to sync with
                    if let Some(slave) = peers.values().find(|p| p.role == "slave" || p.role == "undecided") {
                        log::info!("LAN discovery: auto-triggering sync as MASTER with peer {} ({})", slave.device_id, slave.ip);
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

        // HTTP-based peer scan: health-check known peers (30s) or full subnet scan (300s).
        // When peers are known, most scans only ping them (1-2 probes instead of 253).
        let use_health_check = !peers.is_empty() && last_full_scan.elapsed() < Duration::from_secs(300);
        let http_scan_interval = if peers.is_empty() {
            Duration::from_secs(30)
        } else if use_health_check {
            Duration::from_secs(30)  // health checks are cheap
        } else {
            Duration::from_secs(120)
        };
        if discovery_active && (first_run || last_http_scan.elapsed() >= http_scan_interval) {
            last_http_scan = Instant::now();

            let found = if use_health_check {
                // Health check: only ping known peer IPs
                let known_ips: Vec<String> = peers.values().map(|p| p.ip.clone()).collect();
                log::debug!("LAN discovery: health-check {} known peer(s)", known_ips.len());
                http_ping_known_peers(&device_id, &known_ips)
            } else {
                // Full subnet scan
                last_full_scan = Instant::now();
                http_scan_subnet(&device_id)
            };

            for (peer_device_id, peer_info) in found {
                if !peers.contains_key(&peer_device_id) {
                    log::info!(
                        "LAN discovery: HTTP scan found NEW peer {} ({}) at {}",
                        peer_info.machine_name, peer_device_id, peer_info.ip
                    );
                }
                peers.insert(peer_device_id, peer_info);
                peers_dirty = true;
            }
        }

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
                || e.kind() == std::io::ErrorKind::TimedOut
                || e.kind() == std::io::ErrorKind::ConnectionReset => {
                // WouldBlock/TimedOut = normal timeout
                // ConnectionReset (10054) = ICMP port-unreachable from unicast scan targets
                //   that don't have TIMEFLOW running — expected and harmless
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

        first_run = false;
    }

    // Join any outstanding sync handle before exiting
    if let Some(handle) = sync_handle.take() {
        let _ = handle.join();
    }

    // Clear peers file on shutdown
    peers.clear();
    write_peers_file(&peers);
}

/// Compute subnet broadcast addresses from local network interfaces.
/// Uses `ipconfig` on Windows to get real IP + subnet mask, then calculates
/// the correct broadcast address (IP | ~mask). Falls back to /24 heuristic.
fn get_subnet_broadcast_addresses() -> Vec<String> {
    let mut addrs = Vec::new();

    // Try parsing ipconfig output for accurate subnet masks (cached)
    if let Some(text) = get_ipconfig_output() {
        let mut current_ip: Option<[u8; 4]> = None;

        for line in text.lines() {
            let trimmed = line.trim();
            // Match IPv4 address lines (works for both EN and PL Windows)
            if (trimmed.contains("IPv4") || trimmed.contains("IP Address"))
                && trimmed.contains(':')
            {
                if let Some(ip_str) = trimmed.split(':').last().map(|s| s.trim()) {
                    current_ip = parse_ipv4(ip_str);
                }
            }
            // Match subnet mask line — use ASCII-safe prefix "Mask" to handle OEM codepage
            // garbling of non-ASCII chars (e.g. Polish "Maska podsieci" → "Maska podsie�i")
            if (trimmed.contains("Subnet Mask") || trimmed.contains("Maska podsieci") || trimmed.contains("Mask"))
                && trimmed.contains(':')
                && !trimmed.contains("IPv4")
            {
                if let (Some(ip), Some(mask_str)) =
                    (current_ip.take(), trimmed.split(':').last().map(|s| s.trim()))
                {
                    if let Some(mask) = parse_ipv4(mask_str) {
                        // broadcast = ip | ~mask
                        let bcast = format!(
                            "{}.{}.{}.{}",
                            ip[0] | !mask[0],
                            ip[1] | !mask[1],
                            ip[2] | !mask[2],
                            ip[3] | !mask[3],
                        );
                        // Skip loopback, link-local, virtual adapters, and 255.255.255.255
                        let is_virtual = (ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31 && mask == [255, 255, 240, 0])
                            || (ip[0] == 172 && ip[1] == 17 && mask == [255, 255, 0, 0]);
                        if ip[0] != 127 && ip[0] != 169 && !is_virtual && bcast != "255.255.255.255" {
                            if !addrs.contains(&bcast) {
                                log::info!("LAN discovery: interface {}.{}.{}.{}/{}.{}.{}.{} → broadcast {}",
                                    ip[0], ip[1], ip[2], ip[3],
                                    mask[0], mask[1], mask[2], mask[3],
                                    bcast);
                                addrs.push(bcast);
                            }
                        }
                    }
                }
            }
        }
    }

    // Fallback: UDP connect trick (needs internet but gets the default route IP)
    if addrs.is_empty() {
        if let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") {
            if sock.connect("8.8.8.8:80").is_ok() {
                if let Ok(local) = sock.local_addr() {
                    if let std::net::IpAddr::V4(ipv4) = local.ip() {
                        let o = ipv4.octets();
                        let bcast = format!("{}.{}.{}.255", o[0], o[1], o[2]);
                        log::info!("LAN discovery: fallback broadcast {} (from default route, assuming /24)", bcast);
                        addrs.push(bcast);
                    }
                }
            }
        }
    }

    if addrs.is_empty() {
        log::warn!("LAN discovery: could not determine any subnet broadcast address");
    }
    addrs
}

fn parse_ipv4(s: &str) -> Option<[u8; 4]> {
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() != 4 {
        return None;
    }
    Some([
        parts[0].parse().ok()?,
        parts[1].parse().ok()?,
        parts[2].parse().ok()?,
        parts[3].parse().ok()?,
    ])
}

/// Represents a local network interface with IP and mask.
struct LocalInterface {
    ip: [u8; 4],
    mask: [u8; 4],
}

impl LocalInterface {
    /// Number of host addresses in the subnet (excluding network and broadcast).
    fn host_count(&self) -> u32 {
        let mask_bits = u32::from_be_bytes(self.mask);
        let host_bits = !mask_bits;
        if host_bits < 2 { 0 } else { host_bits - 1 }
    }

    /// Iterate all host IPs in the subnet (excludes network and broadcast address).
    fn iter_hosts(&self) -> impl Iterator<Item = [u8; 4]> {
        let ip_u32 = u32::from_be_bytes(self.ip);
        let mask_u32 = u32::from_be_bytes(self.mask);
        let network = ip_u32 & mask_u32;
        let broadcast = network | !mask_u32;
        // network+1 .. broadcast-1
        let start = network.wrapping_add(1);
        let end = broadcast; // exclusive
        // if start >= end the range is empty — no allocation needed
        (start..end).map(|addr| addr.to_be_bytes())
    }

    /// Is this a "real" LAN interface? Filters out loopback, link-local, and virtual adapters.
    fn is_real_lan(&self) -> bool {
        let o = self.ip;
        // Skip loopback
        if o[0] == 127 { return false; }
        // Skip link-local (169.254.x.x)
        if o[0] == 169 && o[1] == 254 { return false; }
        // Skip Hyper-V/WSL default ranges (172.16-31.x.x with /20 mask = virtual adapters)
        // Real 172.16.x.x LANs typically use /16 or /24, not /20
        if o[0] == 172 && o[1] >= 16 && o[1] <= 31 && self.mask == [255, 255, 240, 0] {
            return false;
        }
        // Skip Docker default bridge (172.17.0.x/16)
        if o[0] == 172 && o[1] == 17 && self.mask == [255, 255, 0, 0] {
            return false;
        }
        true
    }
}

/// Parse local interfaces from `ipconfig` output. Returns only real LAN interfaces.
fn get_local_interfaces() -> Vec<LocalInterface> {
    let mut interfaces = Vec::new();

    let text = match get_ipconfig_output() {
        Some(t) => t,
        None => return interfaces,
    };
    let mut current_ip: Option<[u8; 4]> = None;

    for line in text.lines() {
        let trimmed = line.trim();
        if (trimmed.contains("IPv4") || trimmed.contains("IP Address")) && trimmed.contains(':') {
            if let Some(ip_str) = trimmed.split(':').last().map(|s| s.trim()) {
                current_ip = parse_ipv4(ip_str);
            }
        }
        if (trimmed.contains("Subnet Mask") || trimmed.contains("Maska podsieci") || trimmed.contains("Mask"))
            && trimmed.contains(':')
            && !trimmed.contains("IPv4")
        {
            if let (Some(ip), Some(mask_str)) =
                (current_ip.take(), trimmed.split(':').last().map(|s| s.trim()))
            {
                if let Some(mask) = parse_ipv4(mask_str) {
                    let iface = LocalInterface { ip, mask };
                    if iface.is_real_lan() {
                        interfaces.push(iface);
                    }
                }
            }
        }
    }

    interfaces
}

/// Send data to broadcast addresses + unicast scan of local subnets.
/// Unicast scan is the primary mechanism — broadcast is unreliable on Windows
/// with multiple network interfaces (Hyper-V, WSL, VPN adapters).
/// Track when the last unicast scan was done (scan is expensive, do it less often).
static LAST_UNICAST_SCAN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
const UNICAST_SCAN_INTERVAL_SECS: u64 = 30; // scan every 30s (aligned with beacon interval)

fn broadcast_to_all(socket: &UdpSocket, data: &[u8]) {
    // 1. Global broadcast (often blocked but try anyway)
    let global = format!("255.255.255.255:{}", DISCOVERY_PORT);
    if let Err(e) = socket.send_to(data, &global) {
        log::warn!("LAN discovery: failed to send to global broadcast: {}", e);
    }
    // 2. Subnet-specific broadcast
    for addr in get_subnet_broadcast_addresses() {
        let target = format!("{}:{}", addr, DISCOVERY_PORT);
        if let Err(e) = socket.send_to(data, &target) {
            log::warn!("LAN discovery: failed to send to subnet {}: {}", target, e);
        }
    }
    // 3. Unicast scan of real LAN subnets (most reliable on Windows)
    //    Done every 30s (UNICAST_SCAN_INTERVAL_SECS), aligned with beacon interval
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let last_scan = LAST_UNICAST_SCAN.load(std::sync::atomic::Ordering::Relaxed);
    if now_secs.saturating_sub(last_scan) >= UNICAST_SCAN_INTERVAL_SECS {
        LAST_UNICAST_SCAN.store(now_secs, std::sync::atomic::Ordering::Relaxed);
        let mut total_sent = 0u32;
        for iface in get_local_interfaces() {
            let host_count = iface.host_count();
            if host_count > 254 {
                continue; // skip /16 etc.
            }
            for ip in iface.iter_hosts() {
                if ip == iface.ip {
                    continue; // skip self
                }
                let target = format!("{}.{}.{}.{}:{}", ip[0], ip[1], ip[2], ip[3], DISCOVERY_PORT);
                let _ = socket.send_to(data, &target);
                total_sent += 1;
            }
        }
        if total_sent > 0 {
            log::info!("LAN discovery: unicast scan sent {} probes", total_sent);
        }
    }
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
        broadcast_to_all(socket, json.as_bytes());
    }
}

/// Send beacon directly to a specific IP (unicast) — used for discover responses.
fn send_beacon_to(
    socket: &UdpSocket,
    device_id: &str,
    machine_name: &str,
    dashboard_running: bool,
    version: &str,
    role: &str,
    uptime_secs: u64,
    target_ip: &str,
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
        let target = format!("{}:{}", target_ip, DISCOVERY_PORT);
        if let Err(e) = socket.send_to(json.as_bytes(), &target) {
            log::warn!("LAN discovery: failed to send beacon to {}: {}", target, e);
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
        broadcast_to_all(socket, json.as_bytes());
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
            // Respond directly to the requester's IP (unicast) — broadcast may be blocked
            send_beacon_to(
                socket,
                my_device_id,
                my_machine_name,
                is_dashboard_running(),
                my_version,
                &current_role,
                my_uptime_secs,
                src_ip,
            );
        }
    }
}

/// Ping a single IP on the LAN server port. Returns (device_id, PeerInfo) if a peer responds.
fn http_ping_one(ip: String, my_device_id: &str) -> Option<(String, PeerInfo)> {
    let addr = format!("{}:{}", ip, DASHBOARD_PORT_DEFAULT);
    let stream = std::net::TcpStream::connect_timeout(
        &addr.parse().ok()?,
        Duration::from_millis(800),
    ).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(800)));
    let mut stream = std::io::BufWriter::new(stream);
    use std::io::Write;
    let req = format!("GET /lan/ping HTTP/1.0\r\nHost: {}\r\n\r\n", addr);
    stream.write_all(req.as_bytes()).ok()?;
    stream.flush().ok()?;

    let mut reader = std::io::BufReader::new(stream.into_inner().ok()?);
    let mut response = String::new();
    use std::io::Read;
    reader.read_to_string(&mut response).ok()?;

    let body = response.split("\r\n\r\n").nth(1)?;
    let parsed: serde_json::Value = serde_json::from_str(body).ok()?;
    let device_id = parsed.get("device_id")?.as_str()?.to_string();
    if device_id == my_device_id {
        return None;
    }
    let machine_name = parsed.get("machine_name")?.as_str()?.to_string();
    let role = parsed.get("role").and_then(|v| v.as_str()).unwrap_or("undecided").to_string();

    Some((
        device_id.clone(),
        PeerInfo {
            device_id,
            machine_name,
            ip,
            dashboard_port: DASHBOARD_PORT_DEFAULT,
            last_seen: Utc::now().to_rfc3339(),
            dashboard_running: true,
            role,
            uptime_secs: 0,
        },
    ))
}

/// Health-check: ping only known peer IPs sequentially (fast for 1-2 peers).
fn http_ping_known_peers(my_device_id: &str, known_ips: &[String]) -> HashMap<String, PeerInfo> {
    let mut found = HashMap::new();
    for ip in known_ips {
        if let Some((id, peer)) = http_ping_one(ip.clone(), my_device_id) {
            found.insert(id, peer);
        }
    }
    found
}

/// HTTP-based subnet scan — pings each host on TCP 47891 (LAN server).
/// Far more reliable than UDP on Windows. Uses threads for parallel probing.
fn http_scan_subnet(my_device_id: &str) -> HashMap<String, PeerInfo> {
    let mut found = HashMap::new();

    let my_ip = match std::net::UdpSocket::bind("0.0.0.0:0") {
        Ok(sock) => {
            if sock.connect("8.8.8.8:80").is_ok() {
                if let Ok(addr) = sock.local_addr() {
                    addr.ip().to_string()
                } else {
                    return found;
                }
            } else {
                return found;
            }
        }
        Err(_) => return found,
    };

    let interfaces = get_local_interfaces();
    let mut targets: Vec<String> = Vec::new();
    if interfaces.is_empty() {
        if let Some(prefix) = my_ip.rsplitn(2, '.').nth(1) {
            for i in 1..=254u8 {
                let ip = format!("{}.{}", prefix, i);
                if ip != my_ip {
                    targets.push(ip);
                }
            }
        }
    } else {
        for iface in &interfaces {
            if iface.host_count() > 254 {
                continue;
            }
            for ip_bytes in iface.iter_hosts() {
                if ip_bytes == iface.ip {
                    continue;
                }
                let ip = format!("{}.{}.{}.{}", ip_bytes[0], ip_bytes[1], ip_bytes[2], ip_bytes[3]);
                if ip != my_ip && !targets.contains(&ip) {
                    targets.push(ip);
                }
            }
        }
    }

    if targets.is_empty() {
        return found;
    }

    log::info!("LAN discovery: HTTP scan starting — {} targets", targets.len());

    const BATCH_SIZE: usize = 48;
    let my_id = my_device_id.to_string();

    for batch in targets.chunks(BATCH_SIZE) {
        let handles: Vec<_> = batch
            .iter()
            .map(|ip| {
                let my_id = my_id.clone();
                let ip = ip.clone();
                thread::spawn(move || http_ping_one(ip, &my_id))
            })
            .collect();

        for handle in handles {
            if let Ok(Some((id, peer))) = handle.join() {
                log::info!(
                    "LAN discovery: HTTP scan found {} ({}) at {}",
                    peer.machine_name, id, peer.ip
                );
                found.insert(id, peer);
            }
        }
    }

    log::info!("LAN discovery: HTTP scan complete — {} peer(s)", found.len());
    found
}

/// Read lan_peers.json and return the first active peer with dashboard running.
pub fn find_first_peer() -> Option<lan_sync_orchestrator::PeerTarget> {
    let path = peers_file_path()?;
    let content = std::fs::read_to_string(&path).ok()?;
    let file: PeersFile = serde_json::from_str(&content).ok()?;

    for p in file.peers {
        if !p.dashboard_running {
            continue;
        }
        return Some(lan_sync_orchestrator::PeerTarget {
            ip: p.ip,
            port: p.dashboard_port,
            device_id: p.device_id,
        });
    }
    None
}
