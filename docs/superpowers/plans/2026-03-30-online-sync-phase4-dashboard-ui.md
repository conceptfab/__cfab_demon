# Phase 4: Dashboard — Online Sync UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OnlineSyncCard to Settings page, extend SyncProgressOverlay for online sync, add Tauri IPC wrappers, and update Help.tsx.

**Architecture:** OnlineSyncCard mirrors LanSyncCard pattern — settings form + status display + sync trigger. Progress overlay is shared (same component, different phase labels). Tauri commands wrap daemon HTTP calls.

**Tech Stack:** React, TypeScript, Tauri IPC, existing i18n (`createInlineTranslator`)

---

## File Structure

| File | Responsibility |
|------|----------------|
| Create: `dashboard/src/lib/online-sync-types.ts` | TypeScript interfaces for online sync |
| Create: `dashboard/src/lib/online-sync.ts` | Settings load/save to localStorage |
| Create: `dashboard/src/lib/tauri/online-sync.ts` | Tauri invoke wrappers |
| Create: `dashboard/src/components/settings/OnlineSyncCard.tsx` | Settings UI for online sync |
| Modify: `dashboard/src/components/sync/SyncProgressOverlay.tsx` | Support online sync phases |
| Modify: `dashboard/src/pages/Settings.tsx` | Add OnlineSyncCard |
| Modify: `dashboard/src/pages/Help.tsx` | Document online sync feature |
| Modify: `dashboard/src/locales/en/common.json` | English translations |
| Modify: `dashboard/src/locales/pl/common.json` | Polish translations |

---

### Task 1: Online Sync Types

- [ ] Create `online-sync-types.ts`:
  ```typescript
  export interface OnlineSyncSettings {
    enabled: boolean;
    serverUrl: string;
    authToken: string;
    syncIntervalHours: number;   // 0=manual
    autoSyncOnStartup: boolean;
  }

  export interface OnlineSyncState {
    lastSyncAt: string | null;
    lastSessionId: string | null;
    lastSyncSuccess: boolean;
    lastError: string | null;
  }
  ```
- [ ] Commit

### Task 2: Tauri IPC Wrappers

- [ ] Create `tauri/online-sync.ts`:
  - `runOnlineSync()` — trigger sync via daemon
  - `getOnlineSyncProgress()` — poll daemon progress
  - `getOnlineSyncSettings()` / `saveOnlineSyncSettings()`
  - `cancelOnlineSync()`
- [ ] Commit

### Task 3: OnlineSyncCard Component

- [ ] Create `OnlineSyncCard.tsx`:
  - Toggle: enable/disable
  - Input: server URL
  - Input: auth token (password field)
  - Select: sync interval (Manual, 4h, 8h, 12h, 24h)
  - Checkbox: auto sync on startup
  - Button: "Synchronizuj teraz" / "Sync now"
  - Status: last sync time, result, error
  - All text via `t('PL', 'EN')` pattern
- [ ] Add to Settings.tsx (below LanSyncCard)
- [ ] Commit

### Task 4: Extend SyncProgressOverlay

- [ ] Add online sync phase labels:
  ```typescript
  creating_session, awaiting_peer, negotiating,
  freezing, uploading_to_storage, downloading_from_storage,
  backing_up, merging, verifying,
  uploading_merged, downloading_merged, unfreezing, completed
  ```
- [ ] Add `syncType: "lan" | "online"` prop to distinguish source
- [ ] Commit

### Task 5: Translations (i18n)

- [ ] Add to `pl/common.json` and `en/common.json`:
  - `online_sync_title`, `online_sync_description`
  - `online_sync_server_url`, `online_sync_auth_token`
  - `online_sync_interval`, `online_sync_auto_startup`
  - `online_sync_trigger`, `online_sync_cancel`
  - Phase labels for progress overlay
- [ ] Commit

### Task 6: Help.tsx — Online Sync Documentation

- [ ] Add section to Help.tsx describing online sync:
  - What it does (sync through server + SFTP)
  - How to configure (server URL, token)
  - Difference from LAN sync
  - Security model (encrypted transfer, server sees only metadata)
  - Both PL and EN via `t()` pattern
- [ ] Commit

### Task 7: Integration Test

- [ ] Verify OnlineSyncCard renders in Settings
- [ ] Verify progress overlay works during online sync
- [ ] Verify settings persist across page reloads
- [ ] TypeScript check: `cd dashboard && npx tsc --noEmit`
