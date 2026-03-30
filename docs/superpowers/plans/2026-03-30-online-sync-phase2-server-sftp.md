# Phase 2: Server — SFTP Storage Management

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SFTP storage backend to the server so clients can transfer encrypted databases via SFTP, with server managing session directories and credential distribution.

**Architecture:** Server creates per-session directories on SFTP, generates encrypted credentials for clients, distributes them via session status endpoint, and cleans up after sync completes. Uses `ssh2-sftp-client` npm package.

**Tech Stack:** Node.js, `ssh2-sftp-client`, AES-256-GCM (Node crypto), existing session-store

---

## File Structure

| File | Responsibility |
|------|----------------|
| Create: `src/lib/sync/sftp-manager.ts` | SFTP connection, directory CRUD, health check |
| Create: `src/lib/sync/storage-encryption.ts` | AES-256-GCM encryption of credentials for clients |
| Modify: `src/lib/sync/session-service.ts` | Integrate SFTP creds into session create/status flow |
| Modify: `src/lib/sync/session-contracts.ts` | Add StorageCredentials types |
| Modify: `src/lib/sync/session-cleanup.ts` | Add SFTP directory cleanup on session expire/complete |
| Modify: `src/lib/config/env.ts` | Add SFTP_* and SYNC_ENCRYPTION_KEY env vars |
| Create: `src/app/api/sync/health/route.ts` | GET /api/sync/health — server + SFTP status |

---

### Task 1: Add SFTP Dependencies & Env Config

- [ ] `npm install ssh2-sftp-client` + `@types/ssh2-sftp-client`
- [ ] Add to `env.ts`: `SFTP_HOST`, `SFTP_PORT`, `SFTP_USER`, `SFTP_PASSWORD`, `SFTP_BASE_PATH`, `SFTP_MAX_FILE_SIZE_MB`, `SYNC_ENCRYPTION_KEY`
- [ ] Commit

### Task 2: SFTP Manager

- [ ] Implement `sftp-manager.ts`:
  - `createSessionDir(sessionId)` — creates `/timeflow-sync/{sessionId}/slave-upload/` + `/master-merged/`
  - `deleteSessionDir(sessionId)` — removes entire session directory
  - `healthCheck()` — connect, check disk, count dirs
  - `listOrphanedDirs(knownSessionIds)` — find dirs without active session
- [ ] Commit

### Task 3: Storage Encryption

- [ ] Implement `storage-encryption.ts`:
  - `encryptCredentials(payload, sessionId)` — AES-256-GCM encrypt SFTP creds
  - `deriveSessionKey(masterKey, sessionId)` — HKDF key derivation
  - Payload: `{ host, port, protocol, username, password, uploadPath, downloadPath }`
- [ ] Commit

### Task 4: Integrate Storage into Session Flow

- [ ] Add `StorageCredentials` type to `session-contracts.ts`
- [ ] Modify `session-service.ts`:
  - On session join (step 2): create SFTP session dir, generate encrypted creds
  - On status poll: include `storageCredentials` field (encrypted)
  - On session complete/fail/expire: trigger SFTP cleanup
- [ ] Commit

### Task 5: Health Endpoint

- [ ] Create `GET /api/sync/health` route:
  - Returns `{ server: "ok", sftp: { status, lastCheck, activeSessions, error } }`
  - Clients check this before starting sync
- [ ] Commit

### Task 6: SFTP Cleanup in Session Cleanup Job

- [ ] Modify `session-cleanup.ts`:
  - On expired/completed session: call `deleteSessionDir(sessionId)`
  - Run orphan detection periodically
- [ ] Commit

### Task 7: Smoke Test

- [ ] Test with real SFTP server (local or remote)
- [ ] Verify dir creation, credential encryption, cleanup
