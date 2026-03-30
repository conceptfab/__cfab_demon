# Phase 3: Client — Rust Online Sync Orchestrator

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the online sync state machine in the Rust daemon, reusing merge/backup/freeze from LAN sync, but with HTTP polling for coordination and SFTP for file transfer.

**Architecture:** New `online_sync.rs` module implements 13-step protocol. Uses `reqwest` (or raw TcpStream like LAN) for server HTTP calls and `ssh2` crate for SFTP. Shares merge, backup, freeze/unfreeze, FK check functions with LAN sync via extraction to shared module.

**Tech Stack:** Rust, `ssh2` (SFTP), `aes-gcm` (encryption), `flate2` (gzip), existing SQLite/rusqlite

---

## File Structure

| File | Responsibility |
|------|----------------|
| Create: `src/online_sync.rs` | Online sync orchestrator (13-step state machine) |
| Create: `src/sftp_client.rs` | SFTP upload/download with progress callback |
| Create: `src/sync_encryption.rs` | AES-256-GCM encrypt/decrypt + credential decryption |
| Create: `src/sync_common.rs` | Shared merge, backup, freeze, FK check (extracted from LAN) |
| Modify: `src/lan_sync_orchestrator.rs` | Refactor to use `sync_common.rs` functions |
| Modify: `src/config.rs` | Add `OnlineSyncSettings` struct |
| Modify: `src/main.rs` | Start online sync thread, integrate with daemon lifecycle |
| Modify: `Cargo.toml` | Add `ssh2`, `aes-gcm`, `flate2`, `hkdf`, `sha2` dependencies |

---

### Task 1: Add Dependencies

- [ ] Add to `Cargo.toml`:
  ```toml
  ssh2 = "0.9"
  aes-gcm = "0.10"
  flate2 = "1.0"
  hkdf = "0.12"
  sha2 = "0.10"
  ```
- [ ] `cargo check`
- [ ] Commit

### Task 2: Extract Shared Sync Functions

- [ ] Create `src/sync_common.rs` with functions extracted from `lan_sync_orchestrator.rs`:
  - `merge_incoming_data(conn, data_json) -> Result<(), String>`
  - `backup_database() -> Result<String, String>`
  - `verify_merge_integrity(conn) -> Result<(), String>`
  - `build_full_export(conn) -> Result<String, String>`
  - `build_delta_export(conn, since) -> Result<String, String>`
  - `compute_table_hashes(conn) -> Result<TableHashes, String>`
  - `insert_sync_marker(conn, hashes, device_id, peer_id, full) -> Result<SyncMarker, String>`
- [ ] Modify `lan_sync_orchestrator.rs` to call `sync_common::*` instead of inline implementations
- [ ] Test: LAN sync still works after refactor
- [ ] Commit

### Task 3: Config — OnlineSyncSettings

- [ ] Add to `config.rs`:
  ```rust
  pub struct OnlineSyncSettings {
      pub enabled: bool,
      pub server_url: String,
      pub auth_token: String,
      pub device_id: String,
      pub sync_interval_hours: u32,
      pub auto_sync_on_startup: bool,
  }
  ```
- [ ] Load from `%APPDATA%/TimeFlow/online_sync_settings.json`
- [ ] Commit

### Task 4: Sync Encryption Module

- [ ] Implement `src/sync_encryption.rs`:
  - `decrypt_credentials(encrypted_payload, iv, tag, session_id, device_token) -> FtpCredentials`
  - `encrypt_file(input_path, session_key) -> Vec<u8>` (gzip + AES-256-GCM)
  - `decrypt_file(encrypted_bytes, session_key) -> Vec<u8>`
  - `derive_session_key(master_key, session_id, purpose) -> [u8; 32]` (HKDF)
- [ ] Commit

### Task 5: SFTP Client

- [ ] Implement `src/sftp_client.rs`:
  ```rust
  pub struct SftpClient { host, port, username, password }
  impl SftpClient {
      pub fn upload_with_progress(&self, local: &Path, remote: &str, cb: impl Fn(u64, u64)) -> Result<()>;
      pub fn download_with_progress(&self, remote: &str, local: &Path, cb: impl Fn(u64, u64)) -> Result<()>;
  }
  ```
- [ ] 64KB chunk size, progress callback per chunk
- [ ] Commit

### Task 6: Online Sync Orchestrator — State Machine

- [ ] Implement `src/online_sync.rs`:
  ```rust
  enum OnlineSyncPhase {
      Idle, CreatingSession, AwaitingPeer, Negotiating,
      Freezing, SlaveUploading, MasterDownloading,
      BackingUp, Merging, Verifying,
      MasterUploading, SlaveDownloading, Unfreezing,
      Completed, Error(String),
  }
  ```
- [ ] HTTP client functions:
  - `create_session(server_url, token, device_id, marker_hash) -> SessionCreateResponse`
  - `poll_status(server_url, token, session_id, device_id) -> SessionStatusResponse`
  - `report_step(server_url, token, session_id, step, action, device_id, details) -> ()`
  - `send_heartbeat(server_url, token, session_id, device_id) -> ()`
  - `cancel_session(server_url, token, session_id, device_id) -> ()`
- [ ] Main orchestration: `run_online_sync(config, conn) -> Result<(), String>`
  - Step 1-2: POST /session/create, poll for peer
  - Step 3-4: Read syncMode from status, receive SFTP creds
  - Step 5: Freeze local DB, report step 5
  - Step 6 (SLAVE): encrypt + SFTP upload DB, report step 6
  - Step 7 (MASTER): SFTP download slave DB, decrypt, report step 7
  - Step 8 (MASTER): backup_database(), report step 8
  - Step 9 (MASTER): merge_incoming_data(), report step 9
  - Step 10 (MASTER): verify_merge_integrity(), report step 10
  - Step 11 (MASTER): encrypt + SFTP upload merged DB, report step 11
  - Step 12 (SLAVE): SFTP download merged DB, decrypt, import, report step 12
  - Step 13: unfreeze, report step 13
- [ ] Progress reporting: emit `SyncProgress` via same mechanism as LAN (HTTP endpoint or shared state)
- [ ] Error handling: auto-unfreeze after 5 min, report error to server, cancel session
- [ ] Commit

### Task 7: Integration with main.rs

- [ ] Add online sync thread to daemon startup
- [ ] Trigger sync: on interval (`sync_interval_hours`) or manual (via new HTTP endpoint)
- [ ] Add `/online/trigger-sync` endpoint to lan_server.rs for dashboard to trigger
- [ ] Add `/online/sync-progress` endpoint (or reuse existing progress mechanism)
- [ ] Commit

### Task 8: Tauri Commands

- [ ] Add to `dashboard/src-tauri/src/commands/`:
  - `run_online_sync()` — trigger online sync via daemon HTTP
  - `get_online_sync_progress()` — poll progress
  - `get_online_sync_settings()` / `save_online_sync_settings()`
- [ ] Commit

### Task 9: End-to-End Test

- [ ] Start server + SFTP + 2 daemon instances
- [ ] Trigger sync from one daemon
- [ ] Verify: session created, peer joined, all 13 steps complete, databases match
- [ ] Verify: progress reported correctly at each step
