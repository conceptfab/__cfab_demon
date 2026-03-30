# Online Sync — Master Plan (Overview)

> **This is an umbrella document.** Each phase has its own detailed implementation plan.

## Goal

Implement online synchronization for TIMEFLOW — session-based sync protocol where the server acts as coordinator (not data processor), and file transfer happens via SFTP storage backend. MVP: 2 devices, single SFTP backend, no licensing system.

## Phases

| Phase | Plan | Scope | Dependencies |
|-------|------|-------|--------------|
| 1 | [Server: Session Sync](2026-03-30-online-sync-phase1-server-sessions.md) | New session endpoints, role resolution, step logging | None |
| 2 | [Server: SFTP Storage](2026-03-30-online-sync-phase2-server-sftp.md) | SFTP manager, credential encryption, cleanup job | Phase 1 |
| 3 | [Client: Rust Orchestrator](2026-03-30-online-sync-phase3-client-rust.md) | Online sync state machine, SFTP transport, encryption | Phase 1+2 |
| 4 | [Dashboard: UI](2026-03-30-online-sync-phase4-dashboard-ui.md) | OnlineSyncCard, shared overlay, Tauri commands | Phase 3 |

## Architecture

Server (Next.js) is a **coordinator only** — it creates sessions, assigns MASTER/SLAVE roles, distributes encrypted SFTP credentials, tracks step progress, and cleans up after sync. It never sees client databases.

Client (Rust daemon) runs the same 13-step protocol as LAN sync, but uses SFTP for file transfer and server HTTP polling for coordination. Merge, backup, freeze/unfreeze, FK check — all reused from `lan_sync_orchestrator.rs`.

Dashboard (React/Tauri) adds OnlineSyncCard to Settings, reuses SyncProgressOverlay for progress display.

## MVP Constraints

- **2 devices only** (no queue/aggregator)
- **SFTP only** (no S3/GCS/Azure)
- **No licensing** (existing Bearer token auth)
- **No fixed master** (dynamic role assignment like LAN)
- Existing push/pull/delta endpoints **stay** (no breaking changes)

## Post-MVP (not in scope)

- Licensing system (plans, groups, device limits)
- Multiple storage backends (S3, Azure, GCS)
- MASTER aggregator + queue (3+ devices)
- Fixed master per license
