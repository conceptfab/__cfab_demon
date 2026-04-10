# LAN Device Pairing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement pairing-code-based authentication for LAN sync so devices can securely exchange secrets before syncing.

**Architecture:** Master generates a 6-digit code (TTL 5 min, max 5 attempts). Slave sends code to `POST /lan/pair`, receives master's `lan_secret` + `device_id`. Slave stores paired secrets in `lan_paired_devices.json`. Orchestrator sends the target's secret (not its own) when syncing. On 401 from a previously-paired device, UI shows "pairing expired" with re-pair option.

**Tech Stack:** Rust (daemon), TypeScript/React (dashboard), Tauri commands (bridge)

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/lan_server.rs` | Add `/lan/pair` endpoint, pairing code state, `paired_devices` storage |
| Modify | `src/lan_sync_orchestrator.rs` | Use paired secret instead of local secret in HTTP requests |
| Create | `src/lan_pairing.rs` | Pairing code generation/validation, paired devices JSON I/O |
| Modify | `src/main.rs` | Add `mod lan_pairing;` |
| Modify | `dashboard/src-tauri/src/commands/lan_sync.rs` | Add `generate_pairing_code`, `submit_pairing_code`, `unpair_device`, `get_paired_devices` commands |
| Modify | `dashboard/src-tauri/src/lib.rs` | Register new Tauri commands |
| Modify | `dashboard/src/lib/tauri/lan-sync.ts` | Add TS wrappers for new commands |
| Modify | `dashboard/src/lib/lan-sync-types.ts` | Add `PairedDevice` type |
| Modify | `dashboard/src/components/settings/LanSyncCard.tsx` | Add Pair/Unpair/Re-pair buttons, code display, code input dialog |
| Modify | `dashboard/src/pages/Settings.tsx` | Wire new pairing callbacks |
| Modify | `dashboard/src/locales/en/common.json` | Add pairing i18n strings |
| Modify | `dashboard/src/locales/pl/common.json` | Add pairing i18n strings (Polish) |
| Modify | `dashboard/src/components/help/sections/` | Update Help with pairing docs |

---

### Task 1: Create `lan_pairing.rs` — pairing code and paired devices storage

**Files:**
- Create: `src/lan_pairing.rs`
- Modify: `src/main.rs` — add `mod lan_pairing;`

- [ ] **Step 1: Create `src/lan_pairing.rs` with pairing code generation and validation**

```rust
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

    let mut lock = ACTIVE_PAIRING_CODE.lock().unwrap();
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
    let mut lock = ACTIVE_PAIRING_CODE.lock().unwrap();
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

/// Check if there's an active (non-expired) pairing code.
pub fn has_active_code() -> bool {
    let lock = ACTIVE_PAIRING_CODE.lock().unwrap();
    match lock.as_ref() {
        Some(a) => a.created_at.elapsed().as_secs() <= PAIRING_CODE_TTL_SECS,
        None => false,
    }
}

/// Get remaining seconds for active code, or 0 if none.
pub fn active_code_remaining_secs() -> u64 {
    let lock = ACTIVE_PAIRING_CODE.lock().unwrap();
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
pub fn store_paired_device(device_id: &str, secret: &str, machine_name: &str) {
    let mut devices = load_paired_devices();
    devices.insert(device_id.to_string(), PairedDevice {
        secret: secret.to_string(),
        machine_name: machine_name.to_string(),
        paired_at: chrono::Utc::now().to_rfc3339(),
    });
    save_paired_devices(&devices);
    log::info!("LAN pairing: stored secret for device {} ({})", device_id, machine_name);
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
    load_paired_devices().get(device_id).map(|d| d.secret.clone())
}
```

- [ ] **Step 2: Add `mod lan_pairing;` to `src/main.rs`**

Add the line `mod lan_pairing;` next to the other `mod` declarations in `src/main.rs`. Find the existing `mod lan_server;` or `mod lan_common;` line and add `mod lan_pairing;` adjacent to it.

- [ ] **Step 3: Verify it compiles**

Run: `cargo check`
Expected: Compiles with no errors (warnings OK).

- [ ] **Step 4: Commit**

```bash
git add src/lan_pairing.rs src/main.rs
git commit -m "feat: add lan_pairing module — code generation, validation, paired device storage"
```

---

### Task 2: Add `/lan/pair` endpoint to the daemon LAN server

**Files:**
- Modify: `src/lan_server.rs:419` — exempt `/lan/pair` from auth
- Modify: `src/lan_server.rs:457` — add route for `/lan/pair`
- Modify: `src/lan_server.rs` — add `handle_pair` function

- [ ] **Step 1: Exempt `/lan/pair` from auth check**

In `src/lan_server.rs`, line 419, change:
```rust
let requires_auth = !matches!(path, "/lan/ping" | "/lan/sync-progress" | "/online/sync-progress");
```
to:
```rust
let requires_auth = !matches!(path, "/lan/ping" | "/lan/pair" | "/lan/sync-progress" | "/online/sync-progress");
```

- [ ] **Step 2: Add route in the endpoint match block**

In the `match (method, path)` block (around line 457), add before the `_ => (404, ...)` fallback:
```rust
("POST", "/lan/pair") => handle_pair(&body),
```

- [ ] **Step 3: Add `handle_pair` handler function**

Add this function near the other `handle_*` functions in `src/lan_server.rs`:

```rust
fn handle_pair(body: &str) -> (u16, String) {
    #[derive(Deserialize)]
    struct PairReq {
        code: String,
    }
    let req: PairReq = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return (400, json_error(&format!("Invalid request: {}", e))),
    };

    match crate::lan_pairing::validate_code(&req.code) {
        Ok(()) => {
            let device_id = crate::lan_common::get_device_id();
            let secret = get_or_create_lan_secret();
            let machine_name = crate::lan_common::get_machine_name();
            let resp = serde_json::json!({
                "ok": true,
                "device_id": device_id,
                "secret": secret,
                "machine_name": machine_name,
            });
            (200, resp.to_string())
        }
        Err(reason) => {
            log::warn!("LAN pair attempt failed: {}", reason);
            (403, json_error(reason))
        }
    }
}
```

- [ ] **Step 4: Verify `get_machine_name` is public in `lan_common.rs`**

Check that `pub fn get_machine_name()` exists in `src/lan_common.rs`. If it's private (`fn get_machine_name`), make it `pub fn get_machine_name`.

- [ ] **Step 5: Verify it compiles**

Run: `cargo check`
Expected: Compiles with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lan_server.rs src/lan_common.rs
git commit -m "feat: add /lan/pair endpoint for pairing code exchange"
```

---

### Task 3: Modify orchestrator to use paired device secret

**Files:**
- Modify: `src/lan_sync_orchestrator.rs:138` — replace `lan_server::lan_secret()` with paired device lookup

- [ ] **Step 1: Change `http_request_with_timeout` to accept a secret parameter**

In `src/lan_sync_orchestrator.rs`, change the signature of `http_request_with_timeout` (line 123) from:
```rust
fn http_request_with_timeout(
    mut stream: std::net::TcpStream,
    method: &str,
    url: &str,
    body: Option<&str>,
    on_progress: Option<&dyn Fn(u64, u64)>,
    timeout: Duration,
) -> Result<String, String> {
```
to:
```rust
fn http_request_with_timeout(
    mut stream: std::net::TcpStream,
    method: &str,
    url: &str,
    body: Option<&str>,
    on_progress: Option<&dyn Fn(u64, u64)>,
    timeout: Duration,
    secret: &str,
) -> Result<String, String> {
```

And replace line 138 (`let secret = crate::lan_server::lan_secret();`) with removal (the `secret` is now a parameter). Update the format strings to use the parameter — they already reference `secret` in the format!, so just remove the `let secret = ...` line.

- [ ] **Step 2: Update `http_request` to pass secret through**

Change `http_request` (line 113) to also accept and forward `secret`:
```rust
fn http_request(
    stream: std::net::TcpStream,
    method: &str,
    url: &str,
    body: Option<&str>,
    on_progress: Option<&dyn Fn(u64, u64)>,
    secret: &str,
) -> Result<String, String> {
    http_request_with_timeout(stream, method, url, body, on_progress, HTTP_TIMEOUT, secret)
}
```

- [ ] **Step 3: Update `http_post`, `http_post_with_timeout`, `http_post_with_progress`**

All three helper functions (lines 52-82) need to accept and forward `secret`. Update each:

```rust
fn http_post(url: &str, body: &str, secret: &str) -> Result<String, String> {
    let stream = std::net::TcpStream::connect_timeout(
        &url_to_addr(url)?,
        HTTP_TIMEOUT,
    ).map_err(|e| format!("TCP connect to {}: {}", url, e))?;
    http_request(stream, "POST", url, Some(body), None, secret)
}

fn http_post_with_timeout(url: &str, body: &str, timeout: Duration, secret: &str) -> Result<String, String> {
    let stream = std::net::TcpStream::connect_timeout(
        &url_to_addr(url)?,
        timeout,
    ).map_err(|e| format!("TCP connect to {}: {}", url, e))?;
    http_request_with_timeout(stream, "POST", url, Some(body), None, timeout, secret)
}

fn http_post_with_progress(url: &str, body: &str, on_progress: &dyn Fn(u64, u64), secret: &str) -> Result<String, String> {
    let stream = std::net::TcpStream::connect_timeout(
        &url_to_addr(url)?,
        HTTP_TIMEOUT,
    ).map_err(|e| format!("TCP connect to {}: {}", url, e))?;
    http_request(stream, "POST", url, Some(body), Some(on_progress), secret)
}
```

- [ ] **Step 4: Update all call sites to resolve and pass the correct secret**

Find all places in `lan_sync_orchestrator.rs` where `http_post`, `http_post_with_timeout`, or `http_post_with_progress` are called. At each call site, the function needs access to the peer's `device_id` to look up the paired secret.

Add a helper at the top of the sync functions:
```rust
fn resolve_peer_secret(peer_device_id: &str) -> String {
    // First try paired device secret (for remote peers)
    if let Some(secret) = crate::lan_pairing::get_paired_secret(peer_device_id) {
        return secret;
    }
    // Fallback to local secret (for local daemon communication)
    crate::lan_server::lan_secret()
}
```

Then, in each sync function that uses the `PeerTarget`, resolve the secret once at the start:
```rust
let secret = resolve_peer_secret(&peer.device_id);
```

And pass `&secret` to every `http_post*` call that targets the peer.

- [ ] **Step 5: Detect pairing-invalid on 401 responses**

In the orchestrator, wherever HTTP responses are parsed, check for 401-like errors. Add after the existing error handling in `http_request_with_timeout`, right after parsing the status line:

```rust
// In the status line parsing section, after extracting status_code:
if status_code == 401 {
    return Err("pairing_invalid: 401 Unauthorized — device may need re-pairing".to_string());
}
```

- [ ] **Step 6: Verify it compiles**

Run: `cargo check`
Expected: Compiles. Fix any remaining call sites that were missed.

- [ ] **Step 7: Commit**

```bash
git add src/lan_sync_orchestrator.rs
git commit -m "feat: orchestrator uses paired device secret for remote sync requests"
```

---

### Task 4: Add Tauri commands for pairing

**Files:**
- Modify: `dashboard/src-tauri/src/commands/lan_sync.rs` — add 4 new commands
- Modify: `dashboard/src-tauri/src/lib.rs:247-262` — register new commands

- [ ] **Step 1: Add pairing command structs and functions to `lan_sync.rs`**

Add at the end of `dashboard/src-tauri/src/commands/lan_sync.rs`, before `fn build_http_client()`:

```rust
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
    // This command talks to the local daemon to generate a code
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

    Ok(PairingCodeInfo {
        code: body["code"].as_str().unwrap_or("").to_string(),
        expires_in_secs: body["expires_in_secs"].as_u64().unwrap_or(300),
    })
}

#[tauri::command]
pub async fn submit_pairing_code(
    peer_ip: String,
    peer_port: u16,
    code: String,
) -> Result<PairedDeviceInfo, String> {
    let body = serde_json::json!({ "code": code });

    let result = tokio::task::spawn_blocking(move || {
        let client = build_http_client();
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

        // Store in local paired devices
        // We need to call daemon to store this since paired_devices is managed by daemon process
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
            machine_name,
            paired_at: chrono::Utc::now().to_rfc3339(),
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
            })
        }).collect();
        Ok::<Vec<PairedDeviceInfo>, String>(result)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))??;
    Ok(result)
}
```

- [ ] **Step 2: Register commands in `lib.rs`**

In `dashboard/src-tauri/src/lib.rs`, add the new commands to `tauri::generate_handler![]`, after `commands::upsert_lan_peer` (line 261):
```rust
commands::generate_pairing_code,
commands::submit_pairing_code,
commands::unpair_device,
commands::get_paired_devices,
```

- [ ] **Step 3: Add daemon-side endpoints for pairing management**

In `src/lan_server.rs`, add these routes to the match block and exempt them from auth where needed.

Add to the `requires_auth` exemption list:
```rust
let requires_auth = !matches!(path, "/lan/ping" | "/lan/pair" | "/lan/sync-progress" | "/online/sync-progress" | "/lan/paired-devices");
```

Add routes in the match block:
```rust
("POST", "/lan/generate-pairing-code") => handle_generate_pairing_code(),
("POST", "/lan/store-paired-device") => handle_store_paired_device(&body),
("POST", "/lan/remove-paired-device") => handle_remove_paired_device(&body),
("GET", "/lan/paired-devices") => handle_get_paired_devices(),
```

Add handler functions:
```rust
fn handle_generate_pairing_code() -> (u16, String) {
    let code = crate::lan_pairing::generate_code();
    let remaining = crate::lan_pairing::active_code_remaining_secs();
    let resp = serde_json::json!({
        "ok": true,
        "code": code,
        "expires_in_secs": remaining,
    });
    (200, resp.to_string())
}

fn handle_store_paired_device(body: &str) -> (u16, String) {
    #[derive(Deserialize)]
    struct Req { device_id: String, secret: String, machine_name: String }
    let req: Req = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return (400, json_error(&format!("Invalid request: {}", e))),
    };
    crate::lan_pairing::store_paired_device(&req.device_id, &req.secret, &req.machine_name);
    (200, json_ok())
}

fn handle_remove_paired_device(body: &str) -> (u16, String) {
    #[derive(Deserialize)]
    struct Req { device_id: String }
    let req: Req = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return (400, json_error(&format!("Invalid request: {}", e))),
    };
    crate::lan_pairing::remove_paired_device(&req.device_id);
    (200, json_ok())
}

fn handle_get_paired_devices() -> (u16, String) {
    let devices = crate::lan_pairing::load_paired_devices();
    let list: Vec<serde_json::Value> = devices.iter().map(|(id, d)| {
        serde_json::json!({
            "device_id": id,
            "machine_name": d.machine_name,
            "paired_at": d.paired_at,
        })
    }).collect();
    let resp = serde_json::json!({ "ok": true, "devices": list });
    (200, resp.to_string())
}
```

- [ ] **Step 4: Verify it compiles**

Run: `cargo check` (in both root and `dashboard/src-tauri/`)
Expected: Compiles with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lan_server.rs dashboard/src-tauri/src/commands/lan_sync.rs dashboard/src-tauri/src/lib.rs
git commit -m "feat: add Tauri commands and daemon endpoints for device pairing"
```

---

### Task 5: Add TypeScript API wrappers and types

**Files:**
- Modify: `dashboard/src/lib/lan-sync-types.ts` — add `PairedDevice` type
- Modify: `dashboard/src/lib/tauri/lan-sync.ts` — add pairing API functions

- [ ] **Step 1: Add types to `lan-sync-types.ts`**

Add at the end, before the `DEFAULT_LAN_SYNC_SETTINGS` constant:

```typescript
export interface PairingCodeInfo {
  code: string;
  expires_in_secs: number;
}

export interface PairedDeviceInfo {
  device_id: string;
  machine_name: string;
  paired_at: string;
}
```

- [ ] **Step 2: Add API functions to `lan-sync.ts`**

Add before the `lanSyncApi` export:

```typescript
export const generatePairingCode = () =>
  invokeMutation<{ code: string; expires_in_secs: number }>('generate_pairing_code');

export const submitPairingCode = (peerIp: string, peerPort: number, code: string) =>
  invokeMutation<{ device_id: string; machine_name: string; paired_at: string }>('submit_pairing_code', { peerIp, peerPort, code });

export const unpairDevice = (deviceId: string) =>
  invokeMutation<boolean>('unpair_device', { deviceId });

export const getPairedDevices = () =>
  invoke<{ device_id: string; machine_name: string; paired_at: string }[]>('get_paired_devices');
```

Add to the `lanSyncApi` object:
```typescript
generatePairingCode,
submitPairingCode,
unpairDevice,
getPairedDevices,
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/lib/lan-sync-types.ts dashboard/src/lib/tauri/lan-sync.ts
git commit -m "feat: add TypeScript API wrappers for LAN pairing commands"
```

---

### Task 6: Add i18n strings for pairing UI

**Files:**
- Modify: `dashboard/src/locales/en/common.json` — add English strings
- Modify: `dashboard/src/locales/pl/common.json` — add Polish strings

- [ ] **Step 1: Add English pairing strings**

In `dashboard/src/locales/en/common.json`, inside the `"lan_sync"` object (after line ~1270), add:

```json
"pairing_generate_code": "Generate pairing code",
"pairing_code_label": "Pairing code",
"pairing_code_expires": "Expires in {{seconds}}s",
"pairing_code_expired": "Code expired",
"pairing_enter_code": "Enter pairing code",
"pairing_enter_code_description": "Enter the 6-digit code displayed on the other device.",
"pairing_submit": "Pair",
"pairing_success": "Successfully paired with {{name}}",
"pairing_error_invalid_code": "Invalid code — check and try again",
"pairing_error_expired": "Code expired — generate a new one on the other device",
"pairing_error_too_many_attempts": "Too many attempts — generate a new code",
"pairing_error_no_active_code": "No active code — generate one on the other device first",
"pairing_badge_paired": "paired",
"pairing_badge_expired": "pairing expired",
"pairing_unpair": "Unpair",
"pairing_unpair_confirm": "Remove pairing with {{name}}? You will need to re-enter a code to sync again.",
"pairing_repair": "Re-pair",
"pairing_pair_button": "Pair",
"pairing_not_paired": "Not paired — pair this device before syncing"
```

- [ ] **Step 2: Add Polish pairing strings**

In `dashboard/src/locales/pl/common.json`, inside the `"lan_sync"` object, add:

```json
"pairing_generate_code": "Generuj kod parowania",
"pairing_code_label": "Kod parowania",
"pairing_code_expires": "Wygasa za {{seconds}}s",
"pairing_code_expired": "Kod wygasł",
"pairing_enter_code": "Wprowadź kod parowania",
"pairing_enter_code_description": "Wpisz 6-cyfrowy kod wyświetlony na drugim urządzeniu.",
"pairing_submit": "Sparuj",
"pairing_success": "Pomyślnie sparowano z {{name}}",
"pairing_error_invalid_code": "Nieprawidłowy kod — sprawdź i spróbuj ponownie",
"pairing_error_expired": "Kod wygasł — wygeneruj nowy na drugim urządzeniu",
"pairing_error_too_many_attempts": "Zbyt wiele prób — wygeneruj nowy kod",
"pairing_error_no_active_code": "Brak aktywnego kodu — najpierw wygeneruj go na drugim urządzeniu",
"pairing_badge_paired": "sparowane",
"pairing_badge_expired": "parowanie wygasło",
"pairing_unpair": "Odparuj",
"pairing_unpair_confirm": "Usunąć parowanie z {{name}}? Aby ponownie synchronizować, trzeba będzie wpisać nowy kod.",
"pairing_repair": "Sparuj ponownie",
"pairing_pair_button": "Sparuj",
"pairing_not_paired": "Nie sparowane — sparuj urządzenie przed synchronizacją"
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/locales/en/common.json dashboard/src/locales/pl/common.json
git commit -m "feat: add i18n strings for LAN device pairing (EN + PL)"
```

---

### Task 7: Update LanSyncCard UI — pairing code display, pair/unpair buttons, code input dialog

**Files:**
- Modify: `dashboard/src/components/settings/LanSyncCard.tsx`

- [ ] **Step 1: Add new props to `LanSyncCardProps` interface**

In `LanSyncCard.tsx`, extend the props interface (lines 17-67) with:

```typescript
// Pairing props
pairedDeviceIds?: Set<string>;
pairingExpiredDeviceIds?: Set<string>;
pairingCode?: string | null;
pairingCodeRemaining?: number;
onGeneratePairingCode?: () => void;
onPairWithPeer?: (peer: LanPeer, code: string) => Promise<void>;
onUnpairDevice?: (peer: LanPeer) => void;
// Pairing i18n
pairingGenerateCodeLabel?: string;
pairingCodeLabel?: string;
pairingCodeExpiresLabel?: string;
pairingCodeExpiredLabel?: string;
pairingEnterCodeLabel?: string;
pairingEnterCodeDescriptionLabel?: string;
pairingSubmitLabel?: string;
pairingBadgePairedLabel?: string;
pairingBadgeExpiredLabel?: string;
pairingUnpairLabel?: string;
pairingUnpairConfirmLabel?: string;
pairingRepairLabel?: string;
pairingPairButtonLabel?: string;
pairingNotPairedLabel?: string;
```

- [ ] **Step 2: Add pairing code display section**

After the "Discovered devices" section header (near the Scan LAN button), add a section for generating and displaying the pairing code:

```tsx
{/* Pairing code generation — master side */}
{onGeneratePairingCode && (
  <div className="flex items-center gap-3 rounded-md border border-border/50 bg-background/20 p-3 mb-3">
    {pairingCode ? (
      <div className="flex items-center gap-4 w-full">
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">{pairingCodeLabel ?? 'Pairing code'}</span>
          <span className="text-2xl font-mono font-bold tracking-[0.3em]">{pairingCode}</span>
        </div>
        <span className="text-xs text-muted-foreground ml-auto">
          {pairingCodeRemaining && pairingCodeRemaining > 0
            ? (pairingCodeExpiresLabel ?? 'Expires in {{seconds}}s').replace('{{seconds}}', String(pairingCodeRemaining))
            : pairingCodeExpiredLabel ?? 'Code expired'}
        </span>
      </div>
    ) : (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onGeneratePairingCode}
      >
        <Shield className="h-3 w-3 mr-1.5" />
        {pairingGenerateCodeLabel ?? 'Generate pairing code'}
      </Button>
    )}
  </div>
)}
```

- [ ] **Step 3: Add pairing state to peer list rendering**

In the peer rendering loop (line 419 `{peers.map((peer) => (`), modify the badge and buttons section:

Replace the existing badge (lines 434-444) to include pairing status:

```tsx
{/* Connection status badge */}
<span
  className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full ${
    peer.dashboard_running
      ? 'bg-emerald-500/15 text-emerald-400'
      : 'bg-zinc-500/15 text-zinc-400'
  }`}
>
  {peer.dashboard_running ? dashboardRunningLabel : dashboardOfflineLabel}
</span>
{/* Pairing status badge */}
{pairedDeviceIds?.has(peer.device_id) && !pairingExpiredDeviceIds?.has(peer.device_id) && (
  <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400">
    {pairingBadgePairedLabel ?? 'paired'}
  </span>
)}
{pairingExpiredDeviceIds?.has(peer.device_id) && (
  <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
    {pairingBadgeExpiredLabel ?? 'pairing expired'}
  </span>
)}
```

- [ ] **Step 4: Replace sync buttons with pair/re-pair for unpaired/expired devices**

In the buttons section (lines 446-495), wrap the sync buttons in a conditional and add pair/re-pair/unpair:

```tsx
<div className="flex gap-1.5 shrink-0">
  {isSlave ? null : (
    <>
      {/* Show Pair button for unpaired devices */}
      {!pairedDeviceIds?.has(peer.device_id) && onPairWithPeer ? (
        <PairCodeDialog
          peer={peer}
          onSubmit={onPairWithPeer}
          buttonLabel={pairingPairButtonLabel ?? 'Pair'}
          dialogTitle={pairingEnterCodeLabel ?? 'Enter pairing code'}
          dialogDescription={pairingEnterCodeDescriptionLabel ?? 'Enter the 6-digit code displayed on the other device.'}
          submitLabel={pairingSubmitLabel ?? 'Pair'}
        />
      ) : pairingExpiredDeviceIds?.has(peer.device_id) && onPairWithPeer ? (
        /* Show Re-pair button for expired pairings */
        <PairCodeDialog
          peer={peer}
          onSubmit={onPairWithPeer}
          buttonLabel={pairingRepairLabel ?? 'Re-pair'}
          buttonVariant="outline"
          buttonClassName="text-amber-400 hover:text-amber-300"
          dialogTitle={pairingEnterCodeLabel ?? 'Enter pairing code'}
          dialogDescription={pairingEnterCodeDescriptionLabel ?? 'Enter the 6-digit code displayed on the other device.'}
          submitLabel={pairingSubmitLabel ?? 'Pair'}
        />
      ) : (
        /* Normal sync buttons for paired devices */
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs"
            disabled={isBusy || !peer.dashboard_running}
            onClick={() => onSyncWithPeer(peer)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, peer });
            }}
          >
            {isBusy ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-1" />
            )}
            {isBusy ? syncingLabel : syncButtonLabel}
          </Button>
          {onFullSyncWithPeer && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              disabled={isBusy || !peer.dashboard_running}
              onClick={() => onFullSyncWithPeer(peer)}
            >
              {fullSyncButtonLabel}
            </Button>
          )}
          {onForceSyncWithPeer && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-amber-400 hover:text-amber-300"
              disabled={isBusy || !peer.dashboard_running}
              onClick={() => onForceSyncWithPeer(peer)}
              title={forceMergeTooltip ?? 'Force merge — ignores hash comparison'}
            >
              <Zap className="h-3 w-3 mr-1" />
              {forceSyncButtonLabel ?? 'Force'}
            </Button>
          )}
        </>
      )}
      {/* Unpair button for paired devices */}
      {pairedDeviceIds?.has(peer.device_id) && onUnpairDevice && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-red-400 hover:text-red-300"
          onClick={() => {
            const msg = (pairingUnpairConfirmLabel ?? 'Remove pairing with {{name}}?').replace('{{name}}', peer.machine_name);
            if (window.confirm(msg)) onUnpairDevice(peer);
          }}
        >
          {pairingUnpairLabel ?? 'Unpair'}
        </Button>
      )}
    </>
  )}
</div>
```

- [ ] **Step 5: Create `PairCodeDialog` inline component**

Add at the top of `LanSyncCard.tsx` (after imports, before the main component):

```tsx
function PairCodeDialog({
  peer,
  onSubmit,
  buttonLabel,
  buttonVariant = 'outline',
  buttonClassName = '',
  dialogTitle,
  dialogDescription,
  submitLabel,
}: {
  peer: LanPeer;
  onSubmit: (peer: LanPeer, code: string) => Promise<void>;
  buttonLabel: string;
  buttonVariant?: 'outline' | 'ghost' | 'default';
  buttonClassName?: string;
  dialogTitle: string;
  dialogDescription: string;
  submitLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleDigitChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newDigits = [...digits];
    newDigits[index] = value.slice(-1);
    setDigits(newDigits);
    setError(null);
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setDigits(pasted.split(''));
      inputRefs.current[5]?.focus();
    }
  };

  const handleSubmit = async () => {
    const code = digits.join('');
    if (code.length !== 6) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(peer, code);
      setOpen(false);
      setDigits(['', '', '', '', '', '']);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={buttonVariant}
        size="sm"
        className={`h-7 px-2.5 text-xs ${buttonClassName}`}
        disabled={!peer.dashboard_running}
        onClick={() => {
          setOpen(true);
          setDigits(['', '', '', '', '', '']);
          setError(null);
          setTimeout(() => inputRefs.current[0]?.focus(), 100);
        }}
      >
        <Shield className="h-3 w-3 mr-1" />
        {buttonLabel}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold mb-1">{dialogTitle}</h3>
            <p className="text-sm text-muted-foreground mb-4">{dialogDescription}</p>
            <div className="flex justify-center gap-2 mb-4" onPaste={handlePaste}>
              {digits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { inputRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleDigitChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  className="w-10 h-12 text-center text-xl font-mono font-bold bg-background border border-border rounded-md focus:border-primary focus:outline-none"
                />
              ))}
            </div>
            {error && <p className="text-sm text-destructive mb-3">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void handleSubmit()}
                disabled={submitting || digits.some(d => !d)}
              >
                {submitting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                {submitLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/components/settings/LanSyncCard.tsx
git commit -m "feat: add pairing UI to LanSyncCard — code display, pair dialog, badges"
```

---

### Task 8: Wire pairing logic in Settings.tsx

**Files:**
- Modify: `dashboard/src/pages/Settings.tsx`

- [ ] **Step 1: Add pairing state variables**

In `Settings.tsx`, near the existing LAN sync state (around line 148-150), add:

```typescript
const [pairedDeviceIds, setPairedDeviceIds] = useState<Set<string>>(new Set());
const [pairingExpiredDeviceIds, setPairingExpiredDeviceIds] = useState<Set<string>>(new Set());
const [pairingCode, setPairingCode] = useState<string | null>(null);
const [pairingCodeRemaining, setPairingCodeRemaining] = useState(0);
```

- [ ] **Step 2: Add pairing code countdown timer**

Add a useEffect for the countdown:

```typescript
useEffect(() => {
  if (!pairingCode || pairingCodeRemaining <= 0) return;
  const timer = setInterval(() => {
    setPairingCodeRemaining(prev => {
      if (prev <= 1) {
        setPairingCode(null);
        return 0;
      }
      return prev - 1;
    });
  }, 1000);
  return () => clearInterval(timer);
}, [pairingCode, pairingCodeRemaining]);
```

- [ ] **Step 3: Load paired devices on mount and after sync**

Add a function to refresh paired devices and call it on mount:

```typescript
const refreshPairedDevices = useCallback(async () => {
  try {
    const devices = await lanSyncApi.getPairedDevices();
    setPairedDeviceIds(new Set(devices.map(d => d.device_id)));
  } catch {
    // Daemon might not be running
  }
}, []);

useEffect(() => { void refreshPairedDevices(); }, [refreshPairedDevices]);
```

- [ ] **Step 4: Add pairing callback handlers**

```typescript
const handleGeneratePairingCode = useCallback(async () => {
  try {
    const result = await lanSyncApi.generatePairingCode();
    setPairingCode(result.code);
    setPairingCodeRemaining(result.expires_in_secs);
  } catch (e) {
    setLanSyncResult({ text: e instanceof Error ? e.message : String(e), success: false });
  }
}, []);

const handlePairWithPeer = useCallback(async (peer: LanPeer, code: string) => {
  const result = await lanSyncApi.submitPairingCode(peer.ip, peer.dashboard_port, code);
  setPairedDeviceIds(prev => new Set([...prev, result.device_id]));
  setPairingExpiredDeviceIds(prev => {
    const next = new Set(prev);
    next.delete(result.device_id);
    return next;
  });
}, []);

const handleUnpairDevice = useCallback(async (peer: LanPeer) => {
  try {
    await lanSyncApi.unpairDevice(peer.device_id);
    setPairedDeviceIds(prev => {
      const next = new Set(prev);
      next.delete(peer.device_id);
      return next;
    });
  } catch (e) {
    setLanSyncResult({ text: e instanceof Error ? e.message : String(e), success: false });
  }
}, []);
```

- [ ] **Step 5: Update handleLanSync to detect pairing_invalid**

Modify the existing `handleLanSync` catch block (line ~271) to detect pairing errors:

```typescript
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('pairing_invalid') || msg.includes('401')) {
    setPairingExpiredDeviceIds(prev => new Set([...prev, peer.device_id]));
    setLanSyncResult({ text: t('settings.lan_sync.pairing_badge_expired'), success: false });
  } else {
    setLanSyncResult({ text: msg, success: false });
  }
}
```

- [ ] **Step 6: Pass new props to LanSyncCard**

In the JSX where `<LanSyncCard>` is rendered (around line 609), add the new props:

```tsx
pairedDeviceIds={pairedDeviceIds}
pairingExpiredDeviceIds={pairingExpiredDeviceIds}
pairingCode={pairingCode}
pairingCodeRemaining={pairingCodeRemaining}
onGeneratePairingCode={() => void handleGeneratePairingCode()}
onPairWithPeer={handlePairWithPeer}
onUnpairDevice={(peer) => void handleUnpairDevice(peer)}
pairingGenerateCodeLabel={t('settings.lan_sync.pairing_generate_code')}
pairingCodeLabel={t('settings.lan_sync.pairing_code_label')}
pairingCodeExpiresLabel={t('settings.lan_sync.pairing_code_expires')}
pairingCodeExpiredLabel={t('settings.lan_sync.pairing_code_expired')}
pairingEnterCodeLabel={t('settings.lan_sync.pairing_enter_code')}
pairingEnterCodeDescriptionLabel={t('settings.lan_sync.pairing_enter_code_description')}
pairingSubmitLabel={t('settings.lan_sync.pairing_submit')}
pairingBadgePairedLabel={t('settings.lan_sync.pairing_badge_paired')}
pairingBadgeExpiredLabel={t('settings.lan_sync.pairing_badge_expired')}
pairingUnpairLabel={t('settings.lan_sync.pairing_unpair')}
pairingUnpairConfirmLabel={t('settings.lan_sync.pairing_unpair_confirm')}
pairingRepairLabel={t('settings.lan_sync.pairing_repair')}
pairingPairButtonLabel={t('settings.lan_sync.pairing_pair_button')}
pairingNotPairedLabel={t('settings.lan_sync.pairing_not_paired')}
```

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/pages/Settings.tsx
git commit -m "feat: wire pairing state and callbacks in Settings page"
```

---

### Task 9: Update Help documentation

**Files:**
- Modify: relevant Help section file (check `dashboard/src/components/help/sections/` for LAN sync help)

- [ ] **Step 1: Find and update the LAN sync help section**

Search for the LAN sync help section in `dashboard/src/components/help/sections/`. Add a pairing subsection explaining:
- What pairing is and why it's needed
- How to generate a code on the master
- How to enter the code on the slave
- What "pairing expired" means and how to re-pair
- How to unpair a device

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/components/help/sections/
git commit -m "docs: add LAN device pairing section to Help"
```

---

### Task 10: End-to-end verification

- [ ] **Step 1: Build the full project**

Run: `cargo build` in the project root.
Expected: Compiles with no errors.

- [ ] **Step 2: Build the dashboard**

Run: `cd dashboard && npm run build` (or the project's build command).
Expected: No TypeScript or build errors.

- [ ] **Step 3: Manual test plan**

1. Start TIMEFLOW daemon on Machine A (master)
2. In Settings → LAN Sync, click "Generate pairing code" → verify 6-digit code appears with countdown
3. On Machine B (slave), discover Machine A → verify "Pair" button shows (not "Sync")
4. Click "Pair" → enter the code → verify success, badge changes to "paired"
5. Click "Sync" → verify sync works (no 401)
6. Restart Machine A's daemon → verify sync still works (secret persisted)
7. Delete `lan_secret.txt` on Machine A and restart → verify "pairing expired" badge on Machine B
8. Click "Re-pair" on Machine B → enter new code → verify sync works again
9. Click "Unpair" → verify device goes back to "Pair" button state

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -u
git commit -m "fix: address issues found during end-to-end testing"
```
