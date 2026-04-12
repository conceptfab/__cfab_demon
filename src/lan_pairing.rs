//! LAN device pairing — code generation, validation, and paired device storage.

use crate::config;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

const PAIRING_CODE_TTL_SECS: u64 = 300; // 5 minutes
const MAX_PAIRING_ATTEMPTS: u32 = 5;
const PAIRED_DEVICES_FILE: &str = "lan_paired_devices.json";

// ── In-memory pairing state ──

struct ActiveCode {
    code: String,
    created_at: Instant,
    attempts: u32,
}

static ACTIVE_PAIRING_CODE: Mutex<Option<ActiveCode>> = Mutex::new(None);

/// Generate a new 6-digit pairing code. Replaces any existing active code.
/// Returns the code string (e.g. "482715").
pub fn generate_code() -> String {
    let mut bytes = [0u8; 4];
    let _ = getrandom::getrandom(&mut bytes);
    let num = u32::from_le_bytes(bytes) % 1_000_000;
    let code = format!("{:06}", num);

    let mut lock = ACTIVE_PAIRING_CODE.lock().unwrap_or_else(|e| e.into_inner());
    *lock = Some(ActiveCode {
        code: code.clone(),
        created_at: Instant::now(),
        attempts: 0,
    });
    log::info!("LAN pairing: new code generated (expires in 5 min)");
    code
}

/// Validate a submitted code. Returns Ok(()) on match, Err(reason) on failure.
/// Consumes the code on success. Increments attempt counter on failure.
pub fn validate_code(submitted: &str) -> Result<(), &'static str> {
    let mut lock = ACTIVE_PAIRING_CODE.lock().unwrap_or_else(|e| e.into_inner());
    let active = match lock.as_mut() {
        Some(a) => a,
        None => return Err("no_active_code"),
    };

    // Check TTL
    if active.created_at.elapsed().as_secs() > PAIRING_CODE_TTL_SECS {
        *lock = None;
        return Err("code_expired");
    }

    // Check attempts
    if active.attempts >= MAX_PAIRING_ATTEMPTS {
        *lock = None;
        return Err("too_many_attempts");
    }

    if active.code != submitted {
        active.attempts += 1;
        if active.attempts >= MAX_PAIRING_ATTEMPTS {
            log::warn!("LAN pairing: max attempts reached — code invalidated");
            *lock = None;
        }
        return Err("invalid_code");
    }

    // Success — consume the code
    *lock = None;
    log::info!("LAN pairing: code accepted");
    Ok(())
}

/// Get remaining seconds for active code, or 0 if none.
pub fn active_code_remaining_secs() -> u64 {
    let lock = ACTIVE_PAIRING_CODE.lock().unwrap_or_else(|e| e.into_inner());
    match lock.as_ref() {
        Some(a) => {
            let elapsed = a.created_at.elapsed().as_secs();
            if elapsed >= PAIRING_CODE_TTL_SECS { 0 } else { PAIRING_CODE_TTL_SECS - elapsed }
        }
        None => 0,
    }
}

// ── Paired devices persistent storage ──

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PairedDevice {
    pub secret: String,
    pub machine_name: String,
    pub paired_at: String,
    /// ISO-8601 timestamp of the last HTTP 401 observed when talking to this
    /// peer. `None` = healthy. UI surfaces this as a "needs re-pair" badge.
    /// Cleared on the first successful sync. Never used to auto-remove the
    /// entry — pairing data is expensive to recover and must stay until the
    /// user explicitly re-pairs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_auth_error_at: Option<String>,
}

fn paired_devices_path() -> Result<std::path::PathBuf, String> {
    let dir = config::config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(PAIRED_DEVICES_FILE))
}

pub fn load_paired_devices() -> HashMap<String, PairedDevice> {
    let path = match paired_devices_path() {
        Ok(p) => p,
        Err(_) => return HashMap::new(),
    };
    let data = match std::fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return HashMap::new(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

pub fn save_paired_devices(devices: &HashMap<String, PairedDevice>) {
    if let Ok(path) = paired_devices_path() {
        if let Ok(data) = serde_json::to_string_pretty(devices) {
            let _ = std::fs::write(path, data);
        }
    }
}

/// Store a paired device's secret. Overwrites if device_id already exists.
/// Resets `last_auth_error_at` so a fresh pairing starts clean.
pub fn store_paired_device(device_id: &str, secret: &str, machine_name: &str) {
    let mut devices = load_paired_devices();
    devices.insert(device_id.to_string(), PairedDevice {
        secret: secret.to_string(),
        machine_name: machine_name.to_string(),
        paired_at: chrono::Utc::now().to_rfc3339(),
        last_auth_error_at: None,
    });
    save_paired_devices(&devices);
    log::info!("LAN pairing: stored secret for device {} ({})", device_id, machine_name);
}

/// Mark a paired device as having failed authentication (HTTP 401).
/// Does NOT delete the entry — UI uses this flag to render a "re-pair needed"
/// badge. No-op if the device is not in the paired map.
pub fn mark_auth_error(device_id: &str) {
    let mut devices = load_paired_devices();
    if let Some(dev) = devices.get_mut(device_id) {
        dev.last_auth_error_at = Some(chrono::Utc::now().to_rfc3339());
        save_paired_devices(&devices);
        log::warn!("LAN pairing: marked auth error for device {}", device_id);
    }
}

/// Clear the auth-error flag for a paired device. Called after a successful
/// sync round so the badge disappears automatically once things recover.
pub fn clear_auth_error(device_id: &str) {
    let mut devices = load_paired_devices();
    if let Some(dev) = devices.get_mut(device_id) {
        if dev.last_auth_error_at.is_some() {
            dev.last_auth_error_at = None;
            save_paired_devices(&devices);
            log::info!("LAN pairing: cleared auth error for device {}", device_id);
        }
    }
}

/// Remove a paired device. Returns true if it existed.
pub fn remove_paired_device(device_id: &str) -> bool {
    let mut devices = load_paired_devices();
    let removed = devices.remove(device_id).is_some();
    if removed {
        save_paired_devices(&devices);
        log::info!("LAN pairing: removed device {}", device_id);
    }
    removed
}

/// Get the stored secret for a specific device, if paired.
pub fn get_paired_secret(device_id: &str) -> Option<String> {
    load_paired_devices()
        .get(device_id)
        .map(|d| d.secret.clone())
        .filter(|s| !s.is_empty())
}
