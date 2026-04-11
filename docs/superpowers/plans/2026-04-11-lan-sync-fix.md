# LAN Sync Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 5 critical bugs in LAN synchronization: deprecated endpoint, permanent full-sync, auth failures, dual-master race, and missing preflight checks.

**Architecture:** Single-master coordination with preflight validation. Master pulls from slave via restored `/lan/pull` endpoint. Markers aligned between devices via shared marker hash stored on both sides. Pre-sync preflight confirms connectivity + auth before committing to the 13-step protocol.

**Tech Stack:** Rust, HTTP (custom TCP), SQLite, serde_json

---

## File Structure

| File | Responsibility | Changes |
|------|---------------|---------|
| `src/lan_server.rs` | HTTP server, endpoint routing, slave-side handlers | Restore `/lan/pull` route, add `/lan/preflight` endpoint |
| `src/lan_sync_orchestrator.rs` | Master-side 13-step sync protocol | Add preflight step, fix marker alignment, master election |
| `src/lan_common.rs` | Shared utilities, marker hash generation | No changes needed |
| `src/sync_common.rs` | Backup, merge, markers | Add shared marker insertion helper |
| `src/lan_pairing.rs` | Pairing storage | Add pairing validity check |

---

### Task 1: Restore `/lan/pull` endpoint (BUG 1 — CRITICAL)

**Files:**
- Modify: `src/lan_server.rs:486-489` (routing table)

The `/lan/pull` endpoint is used by the orchestrator at step 6 to download data from the slave. It was erroneously deprecated while the orchestrator still depends on it. The `handle_pull` function exists at line 920 but is unreachable because the route returns 410.

- [ ] **Step 1: Fix the route in `lan_server.rs`**

In the routing `match` block around line 486-489, change:

```rust
// BEFORE (broken):
("POST", "/lan/pull") => (410, json_error("deprecated: use 13-step sync protocol")),
("POST", "/lan/push") => (410, json_error("deprecated: use 13-step sync protocol")),

// AFTER (fixed):
("POST", "/lan/pull") => handle_pull(&body),
("POST", "/lan/push") => (410, json_error("deprecated: use 13-step sync protocol")),
```

Only `/lan/pull` needs restoring — `/lan/push` is genuinely unused by the orchestrator.

- [ ] **Step 2: Remove `#[allow(dead_code)]` from `handle_pull`**

At line 920, `handle_pull` has no dead_code attribute but `PullRequest` struct inside does. Remove the `#[allow(dead_code)]` from the struct since it's no longer dead code:

```rust
// BEFORE:
#[derive(Deserialize)]
#[allow(dead_code)]
struct PullRequest {

// AFTER:
#[derive(Deserialize)]
struct PullRequest {
```

- [ ] **Step 3: Add `/lan/pull` to auth-required check**

Verify that `/lan/pull` is NOT in the `requires_auth` exemption list (line ~421). It currently is NOT exempt, which is correct — pull requires authentication. No change needed, just verify.

- [ ] **Step 4: Build to verify**

```bash
cargo build 2>&1 | tail -20
```

Expected: Successful compilation, no errors related to handle_pull.

- [ ] **Step 5: Commit**

```bash
git add src/lan_server.rs
git commit -m "fix: restore /lan/pull endpoint used by 13-step sync protocol"
```

---

### Task 2: Fix marker alignment for delta sync (BUG 2)

**Files:**
- Modify: `src/lan_sync_orchestrator.rs:507-514` (master marker insertion)
- Modify: `src/lan_server.rs:845-865` (slave marker insertion in handle_db_ready)

**Root cause:** `generate_marker_hash(tables_hash, timestamp, device_id)` includes `device_id`, so master and slave always generate different markers. The slave never finds the master's marker in its history, so negotiate always returns "full".

**Fix approach:** After sync, both master and slave store BOTH markers — their own AND the peer's. This way, when either side initiates the next sync, the negotiate can find the peer's marker in local history and choose "delta".

- [ ] **Step 1: Master — also store slave's marker from db-ready response**

In `execute_master_sync` around line 590-605, after receiving the db-ready response, the master already verifies `resp.ok`. Add storage of the slave's marker hash. Find the section after `sync_log("[12/13] Peer zakonczyl import — dane scalone");` (approximately line 604):

```rust
// AFTER the existing line:
// sync_log("[12/13] Peer zakonczyl import — dane scalone");

// ADD: Store slave's marker in our history so next negotiate can find it for delta
if let Ok(resp_val) = serde_json::from_str::<serde_json::Value>(&db_ready_resp) {
    if let Some(slave_marker) = resp_val.get("marker_hash").and_then(|v| v.as_str()) {
        let slave_now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let _ = sync_common::insert_sync_marker_db(
            &conn, slave_marker, &slave_now, &peer.device_id,
            Some(&device_id), &new_tables_hash, transfer_mode == "full",
        );
        sync_log(&format!("[12/13] Stored slave marker: {}", &slave_marker[..16.min(slave_marker.len())]));
    }
}
```

- [ ] **Step 2: Slave — also store master's marker from db-ready request**

In `handle_db_ready` around line 855 (after the slave generates its own marker and inserts it), add storage of the master's marker:

```rust
// AFTER the existing slave marker insertion block, ADD:
// Store master's marker in our history so next negotiate can find it for delta
if !req.marker_hash.is_empty() {
    let _ = crate::sync_common::insert_sync_marker_db(
        &conn, &req.marker_hash, &now, &req.master_device_id,
        Some(&device_id), &tables_hash, req.transfer_mode == "full",
    );
    sync_log(&format!("[SLAVE] Stored master marker: {}", &req.marker_hash[..16.min(req.marker_hash.len())]));
}
```

- [ ] **Step 3: Build to verify**

```bash
cargo build 2>&1 | tail -20
```

Expected: Successful compilation.

- [ ] **Step 4: Commit**

```bash
git add src/lan_sync_orchestrator.rs src/lan_server.rs
git commit -m "fix: store peer markers on both sides to enable delta sync"
```

---

### Task 3: Add preflight check before sync (BUG 3 + BUG 5)

**Files:**
- Modify: `src/lan_server.rs` — add `/lan/preflight` endpoint
- Modify: `src/lan_sync_orchestrator.rs` — call preflight before step 3

**Purpose:** Before starting the 13-step protocol, verify:
1. Peer is reachable
2. Authentication works (paired secret is valid)
3. Peer is not already syncing
4. Versions match

This prevents wasting 30+ seconds on retries when auth is broken.

- [ ] **Step 1: Add preflight endpoint to `lan_server.rs`**

Add a new handler function after `handle_ping` (around line 647):

```rust
fn handle_preflight(state: &LanSyncState) -> (u16, String) {
    let in_sync = state.sync_in_progress.load(Ordering::SeqCst);
    let frozen = state.db_frozen.load(Ordering::SeqCst);
    let device_id = lan_common::get_device_id();
    let version = env!("CARGO_PKG_VERSION");

    let resp = serde_json::json!({
        "ok": true,
        "auth": "valid",
        "device_id": device_id,
        "version": version,
        "sync_in_progress": in_sync,
        "db_frozen": frozen,
    });
    (200, resp.to_string())
}
```

- [ ] **Step 2: Register the route**

In the routing match block (around line 479), add the preflight route. It MUST require auth (do NOT add it to the exempt list):

```rust
("POST", "/lan/preflight") => handle_preflight(&state),
```

Add it right after the `("GET", "/lan/ping")` line.

- [ ] **Step 3: Call preflight in orchestrator before step 3**

In `execute_master_sync` (around line 375, before the "Step 3: Negotiate" section), add:

```rust
    // Step 2: Preflight check — verify connectivity + auth before committing
    sync_state.set_progress(2, "preflight", "local");
    sync_log(&format!("[2/13] Preflight check z peerem {}:{} ...", peer.ip, peer.port));
    let preflight_resp = http_post(
        &format!("{}/lan/preflight", base_url),
        "{}",
        &secret,
    );
    match preflight_resp {
        Ok(resp_str) => {
            if let Ok(resp) = serde_json::from_str::<serde_json::Value>(&resp_str) {
                if resp.get("sync_in_progress").and_then(|v| v.as_bool()) == Some(true) {
                    sync_log("[2/13] Peer juz synchronizuje — przerywam");
                    return Err("Peer already syncing".to_string());
                }
                if resp.get("db_frozen").and_then(|v| v.as_bool()) == Some(true) {
                    sync_log("[2/13] Peer ma zamrozona baze — przerywam");
                    return Err("Peer database frozen".to_string());
                }
                sync_log("[2/13] Preflight OK — peer gotowy");
            }
        }
        Err(e) => {
            if e.contains("401") || e.contains("unauthorized") || e.contains("Unauthorized") {
                sync_log(&format!("[2/13] PREFLIGHT FAILED — auth error: {}", e));
                return Err(format!("pairing_invalid: {}", e));
            }
            sync_log(&format!("[2/13] PREFLIGHT FAILED: {}", e));
            return Err(format!("Preflight failed: {}", e));
        }
    }
```

- [ ] **Step 4: Build to verify**

```bash
cargo build 2>&1 | tail -20
```

Expected: Successful compilation.

- [ ] **Step 5: Commit**

```bash
git add src/lan_server.rs src/lan_sync_orchestrator.rs
git commit -m "feat: add preflight check before LAN sync to validate auth and peer state"
```

---

### Task 4: Single-master coordination (BUG 4)

**Files:**
- Modify: `src/lan_server.rs:673-706` (handle_negotiate)
- Modify: `src/lan_sync_orchestrator.rs:359-380` (execute_master_sync, after preflight)

**Problem:** Both machines independently trigger sync and try to be master. We need a tiebreaker.

**Fix approach:** During negotiate, if the slave is ALSO trying to sync as master, reject with a specific code. The machine with the lexicographically lower device_id wins the master role (deterministic tiebreaker).

- [ ] **Step 1: Add master-election logic to `handle_negotiate`**

In `handle_negotiate` (line 673), before accepting the slave role, check if this machine is already syncing. If so, use device_id tiebreaker:

```rust
fn handle_negotiate(state: &LanSyncState, body: &str) -> (u16, String) {
    let req: NegotiateRequest = match serde_json::from_str(body) {
        Ok(r) => r,
        Err(e) => return (400, json_error(&format!("Invalid request: {}", e))),
    };

    // If we're already syncing as master, use device_id tiebreaker
    if state.sync_in_progress.load(Ordering::SeqCst) {
        let local_device_id = lan_common::get_device_id();
        let role = state.get_role();
        if role == "master" {
            // Lower device_id wins master role
            if req.master_device_id < local_device_id {
                // Remote wins — abort our sync and become slave
                sync_log(&format!("[NEGOTIATE] Conflict: remote {} wins master role (lower device_id)", req.master_device_id));
                // We can't cleanly abort here, but we can reject and let our sync fail naturally
                // The remote master will retry
            } else {
                // We win — reject remote's negotiate
                sync_log(&format!("[NEGOTIATE] Conflict: we win master role (lower device_id than {})", req.master_device_id));
                return (409, json_error("Master conflict: this device has priority"));
            }
        }
    }

    let db = open_dashboard_db_readonly().ok();
    let local_marker = db.as_ref().and_then(|conn| get_latest_marker_hash(conn));

    let mode = match (&local_marker, &req.master_marker_hash) {
        (Some(local), Some(remote)) if local == remote => "delta",
        (_, Some(remote)) => {
            if db.as_ref().and_then(|conn| find_marker_timestamp(conn, remote)).is_some() {
                "delta"
            } else {
                "full"
            }
        }
        _ => "full",
    };

    // Accept slave role when master negotiates
    state.set_role("slave");
    state.set_progress(3, "negotiating", "local");
    sync_log(&format!("[SLAVE] Master {} rozpoczyna sync — tryb: {}", req.master_device_id, mode));

    let resp = NegotiateResponse {
        ok: true,
        mode: mode.to_string(),
        slave_marker_hash: local_marker,
    };
    (200, serde_json::to_string(&resp).unwrap_or_default())
}
```

- [ ] **Step 2: Handle negotiate 409 in orchestrator**

In `execute_master_sync`, after the negotiate call (~line 395), add handling for the 409 conflict:

```rust
    let negotiate_resp = http_post(
        &format!("{}/lan/negotiate", base_url),
        &negotiate_body.to_string(),
        &secret,
    ).map_err(|e| {
        sync_log(&format!("[3/13] BLAD negocjacji: {}", e));
        // If peer rejected because they have master priority, give up immediately (no retry)
        if e.contains("409") || e.contains("Master conflict") {
            sync_log("[3/13] Peer ma priorytet mastera — ustepuje");
        }
        e
    })?;
```

- [ ] **Step 3: Build to verify**

```bash
cargo build 2>&1 | tail -20
```

Expected: Successful compilation.

- [ ] **Step 4: Commit**

```bash
git add src/lan_server.rs src/lan_sync_orchestrator.rs
git commit -m "fix: add master-election tiebreaker to prevent dual-master race"
```

---

### Task 5: Backup on both clients BEFORE merge (verification)

**Files:**
- Verify: `src/lan_sync_orchestrator.rs:462-464` (master backup at step 8)
- Verify: `src/lan_server.rs:808-812` (slave backup in handle_db_ready)

The backup already exists on both sides. Verify it uses `backup_database_typed` for proper directory separation.

- [ ] **Step 1: Verify master backup uses typed backup**

In `execute_master_sync` around line 462:

```rust
// Current:
sync_common::backup_database(&conn)

// Change to:
sync_common::backup_database_typed(&conn, "lan")
```

- [ ] **Step 2: Verify slave backup uses typed backup**

In `handle_db_ready` around line 810:

```rust
// Current:
crate::sync_common::backup_database(&conn)

// Change to:
crate::sync_common::backup_database_typed(&conn, "lan")
```

- [ ] **Step 3: Verify slave restore uses typed restore**

In `handle_db_ready`, two places call `restore_database_backup`. Change both to:

```rust
// Change from:
crate::sync_common::restore_database_backup(&mut conn)

// Change to:
crate::sync_common::restore_database_backup_typed(&mut conn, "lan")
```

- [ ] **Step 4: Verify master restore uses typed restore**

In `execute_master_sync`, three places call `restore_database_backup`. Change all to:

```rust
// Change from:
sync_common::restore_database_backup(&mut conn)

// Change to:
sync_common::restore_database_backup_typed(&mut conn, "lan")
```

- [ ] **Step 5: Build to verify**

```bash
cargo build 2>&1 | tail -20
```

- [ ] **Step 6: Commit**

```bash
git add src/lan_sync_orchestrator.rs src/lan_server.rs
git commit -m "fix: use typed backup/restore for LAN sync to prevent cross-contamination"
```

---

### Task 6: Integration test — manual verification

After all fixes are deployed to both machines:

- [ ] **Step 1: Clear stale pairing data on both machines**

Delete `paired_devices.json` from both `%APPDATA%/TimeFlow/` directories and re-pair fresh.

- [ ] **Step 2: Re-pair devices**

On machine A: generate pairing code. On machine B: enter code. Verify both machines store each other's secrets.

- [ ] **Step 3: Trigger first sync (should be FULL)**

Click sync on ONE machine only. Verify in logs:
- Preflight check passes
- Negotiate returns "full" (first sync)
- Both sides backup before merge
- Sync completes successfully
- Both sides store both markers

- [ ] **Step 4: Trigger second sync (should be DELTA)**

Click sync on ONE machine only. Verify in logs:
- `[4/13] Tryb: delta` (NOT full!)
- `since=` shows a real timestamp (NOT 1970-01-01)
- Data transferred is much smaller than full sync

- [ ] **Step 5: Trigger simultaneous sync from both machines**

Click sync on BOTH machines at the same time. Verify:
- One machine wins master role
- Other machine yields (gets 409 or defers)
- Sync still completes successfully

---

## Summary of changes

| Bug | Root cause | Fix | Files |
|-----|-----------|-----|-------|
| `/lan/pull` 410 | Route deprecated, orchestrator still uses it | Restore route | `lan_server.rs` |
| Always full sync | Markers include device_id → never match | Store peer's marker on both sides | `lan_sync_orchestrator.rs`, `lan_server.rs` |
| 401 after re-pair | No pre-sync auth check | Add `/lan/preflight` endpoint + call | Both |
| Dual master race | No coordination protocol | Device_id tiebreaker in negotiate | Both |
| Backup isolation | Uses generic backup dir | Use `backup_database_typed("lan")` | Both |
