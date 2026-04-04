# Deferred Refactors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all deferred code review findings from raport.md — 8 Important refactors and 16 Minor fixes.

**Architecture:** Incremental refactors grouped by subsystem. Each task is independent and can be committed separately. No breaking changes — all refactors preserve existing behavior.

**Tech Stack:** TypeScript/React (dashboard), Rust (daemon), i18next (i18n)

---

## Group A: Dashboard — Quick Fixes (Minor)

### Task 1: Projects.tsx — toggleFolders persist to localStorage

**Files:**
- Modify: `dashboard/src/pages/Projects.tsx:575-578`

- [ ] **Step 1: Fix toggleFolders to save immediately**

```typescript
const toggleFolders = () => {
  const next = !useFolders;
  setUseFolders(next);
  localStorage.setItem(FOLDERS_STORAGE_KEY, String(next));
};
```

Find `FOLDERS_STORAGE_KEY` in the same file — it's already defined and used in `handleSaveDefaults`. This makes behavior consistent with `handleSortChange` which also saves immediately.

- [ ] **Step 2: Verify** — Run `cd dashboard && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/Projects.tsx
git commit -m "fix: persist folder toggle to localStorage immediately"
```

---

### Task 2: ImportPage.tsx — wrap loadImportData in useCallback

**Files:**
- Modify: `dashboard/src/pages/ImportPage.tsx:19-22`

- [ ] **Step 1: Wrap in useCallback**

Change:
```typescript
const loadImportData = () => {
  getImportedFiles().then(setImported).catch(console.error);
  getArchiveFiles().then(setArchive).catch(console.error);
};
```

To:
```typescript
const loadImportData = useCallback(() => {
  getImportedFiles().then(setImported).catch(console.error);
  getArchiveFiles().then(setArchive).catch(console.error);
}, []);
```

Ensure `useCallback` is imported from `react` at the top of the file.

- [ ] **Step 2: Verify** — Run `cd dashboard && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/ImportPage.tsx
git commit -m "fix: wrap loadImportData in useCallback for referential stability"
```

---

### Task 3: AI.tsx — simplify areMetricsEqual with JSON.stringify

**Files:**
- Modify: `dashboard/src/pages/AI.tsx:111-157`

- [ ] **Step 1: Replace manual comparison**

Replace the entire `areMetricsEqual` function:

```typescript
function areMetricsEqual(
  current: AssignmentModelMetrics | null,
  next: AssignmentModelMetrics,
): boolean {
  if (!current) return false;
  return JSON.stringify(current) === JSON.stringify(next);
}
```

This object is small (summary + points array with ~30 daily entries). `JSON.stringify` is fast enough and eliminates maintenance burden when adding new fields.

- [ ] **Step 2: Verify** — Run `cd dashboard && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/AI.tsx
git commit -m "refactor: simplify areMetricsEqual with JSON.stringify"
```

---

## Group B: Dashboard — Important Refactors

### Task 4: Extract shared ManualSession conversion utility (D-R2)

**Files:**
- Create: `dashboard/src/lib/session-utils.ts`
- Modify: `dashboard/src/pages/Sessions.tsx:176-198`
- Modify: `dashboard/src/pages/ProjectPage.tsx:188-201`

- [ ] **Step 1: Create shared utility**

Create `dashboard/src/lib/session-utils.ts`:

```typescript
import type { ManualSessionWithProject } from '@/lib/db-types';

/**
 * Convert a ManualSessionWithProject into a shape compatible with SessionWithApp.
 * Used by Sessions and ProjectPage to merge manual sessions into session lists.
 */
export function manualToSessionRow(
  session: ManualSessionWithProject,
  label: string,
) {
  return {
    id: session.id,
    app_id: session.app_id ?? 0,
    start_time: session.start_time,
    end_time: session.end_time,
    date: session.date,
    duration_seconds: session.duration_seconds,
    app_name: label,
    executable_name: 'manual',
    project_id: session.project_id,
    project_name: session.project_name,
    project_color: session.project_color,
    comment: session.title,
    files: [],
    isManual: true as const,
    session_type: session.session_type,
  };
}
```

Check that `ManualSessionWithProject` type has all these fields — read `dashboard/src/lib/db-types.ts` to verify.

- [ ] **Step 2: Update Sessions.tsx**

Replace the inline mapping in `mergedSessions` useMemo (~lines 178-194):

```typescript
import { manualToSessionRow } from '@/lib/session-utils';

// Inside mergedSessions useMemo:
const manualAsSession = manualSessions.map((m) =>
  manualToSessionRow(m, t('project_page.text.manual_session', 'Manual Session'))
);
```

Remove any now-unused type casts like `as SessionWithApp & { isManual: true; session_type: string }`.

- [ ] **Step 3: Update ProjectPage.tsx**

Replace `toManualSessionRow` function (~lines 188-201):

```typescript
import { manualToSessionRow } from '@/lib/session-utils';

// Replace toManualSessionRow usage with:
const row = manualToSessionRow(session, t('project_page.text.manual_session'));
```

Remove the old `toManualSessionRow` function definition.

- [ ] **Step 4: Verify** — Run `cd dashboard && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/session-utils.ts dashboard/src/pages/Sessions.tsx dashboard/src/pages/ProjectPage.tsx
git commit -m "refactor: extract shared ManualSession conversion utility"
```

---

### Task 5: OnlineSyncCard — move useTranslation inside component (D-O2)

**Files:**
- Modify: `dashboard/src/components/settings/OnlineSyncCard.tsx`
- Modify: `dashboard/src/pages/Settings.tsx:541-657`

This is the largest refactor. The goal: remove ~40 translated label props from OnlineSyncCard by having it call `useTranslation()` internally.

- [ ] **Step 1: Add useTranslation to OnlineSyncCard**

In `OnlineSyncCard.tsx`, add:

```typescript
import { useTranslation } from 'react-i18next';
```

Inside the component body, add:

```typescript
const { t } = useTranslation();
```

- [ ] **Step 2: Replace label props with internal t() calls**

For each label prop (e.g., `title`, `description`, `enableSyncTitle`, etc.):

1. Remove the prop from the interface
2. Replace `props.title` with `t('settings_page.online_sync')` in the JSX
3. Do this for ALL label string props (approximately 40 props)

Keep non-label props: `settings`, `state`, `manualSyncResult`, `manualSyncing`, callback `on*` props, `demoModeSyncDisabled`, `showToken`, `defaultServerUrl`, `labelClassName`, computed values like `shortHash`, `localHashShort`, `lastSyncLabel`, license state props, and callback props.

The translation keys are already visible in Settings.tsx (e.g., `t('settings_page.online_sync')` → use the same key).

- [ ] **Step 3: Clean up Settings.tsx**

Remove all ~40 label props from the `<OnlineSyncCard ... />` JSX in Settings.tsx. The component should shrink from ~120 lines to ~30 lines of props.

- [ ] **Step 4: Verify** — Run `cd dashboard && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/settings/OnlineSyncCard.tsx dashboard/src/pages/Settings.tsx
git commit -m "refactor: move translations inside OnlineSyncCard, remove 40+ label props"
```

---

## Group C: Daemon Rust — Important Refactors

### Task 6: lan_discovery.rs — batch http_scan_subnet threads (R-P2)

**Files:**
- Modify: `src/lan_discovery.rs` (http_scan_subnet function, ~line 1190)

- [ ] **Step 1: Replace unbounded thread spawn with batching**

Replace the thread spawning block:

```rust
// OLD:
let handles: Vec<_> = targets
    .into_iter()
    .map(|ip| {
        let my_id = my_id.clone();
        thread::spawn(move || http_ping_one(ip, &my_id))
    })
    .collect();

for handle in handles {
    if let Ok(Some((id, peer))) = handle.join() {
        // ...
    }
}
```

With batched execution:

```rust
const BATCH_SIZE: usize = 48;

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
```

Note: `targets` is currently `Vec<String>` consumed by `into_iter()`. After this change, use `.chunks()` which borrows, so keep `targets` as a `Vec<String>` and use `.clone()` on each ip.

- [ ] **Step 2: Verify** — Run `cargo check`

- [ ] **Step 3: Commit**

```bash
git add src/lan_discovery.rs
git commit -m "perf: batch http_scan_subnet to max 48 concurrent threads"
```

---

### Task 7: lan_server.rs — handle_verify_ack should unfreeze DB (R-L4)

**Files:**
- Modify: `src/lan_server.rs:766-776`

- [ ] **Step 1: Replace sync_in_progress.store with unfreeze()**

Change:

```rust
state.sync_in_progress.store(false, Ordering::SeqCst);
```

To:

```rust
state.unfreeze();
```

`unfreeze()` sets both `db_frozen = false` and `sync_in_progress = false`, which is the correct behavior. The current code only resets `sync_in_progress`, leaving `db_frozen` potentially stuck.

- [ ] **Step 2: Verify** — Run `cargo check`

- [ ] **Step 3: Commit**

```bash
git add src/lan_server.rs
git commit -m "fix: handle_verify_ack should unfreeze DB, not just reset sync flag"
```

---

### Task 8: lan_common.rs — cache LogSettings in sync_log (R-P3)

**Files:**
- Modify: `src/lan_common.rs:69` (sync_log function)

- [ ] **Step 1: Add static cache for log settings**

Near the top of `lan_common.rs`, add:

```rust
use std::sync::Mutex;
use std::time::Instant;

static LOG_SETTINGS_CACHE: Mutex<Option<(Instant, u64)>> = Mutex::new(None);
const LOG_SETTINGS_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(30);
```

- [ ] **Step 2: Replace direct load with cached lookup**

In `sync_log`, replace:

```rust
let log_settings = config::load_log_settings();
let max_bytes = (log_settings.max_log_size_kb as u64) * 1024;
```

With:

```rust
let max_bytes = {
    let cached = LOG_SETTINGS_CACHE.lock().ok().and_then(|g| {
        g.as_ref().and_then(|(ts, val)| {
            if ts.elapsed() < LOG_SETTINGS_CACHE_TTL { Some(*val) } else { None }
        })
    });
    match cached {
        Some(v) => v,
        None => {
            let settings = config::load_log_settings();
            let v = (settings.max_log_size_kb as u64) * 1024;
            if let Ok(mut g) = LOG_SETTINGS_CACHE.lock() {
                *g = Some((Instant::now(), v));
            }
            v
        }
    }
};
```

- [ ] **Step 3: Verify** — Run `cargo check`

- [ ] **Step 4: Commit**

```bash
git add src/lan_common.rs
git commit -m "perf: cache LogSettings in sync_log to avoid disk reads on every call"
```

---

### Task 9: lan_sync_orchestrator.rs — fix Host header (R-S0b)

**Files:**
- Modify: `src/lan_sync_orchestrator.rs:104-112`

- [ ] **Step 1: Extract host from URL and use in Host header**

The function `http_post_with_progress` receives a full URL. Find where `host` and `port` are parsed (look for the TCP connect section above line 104). Use those values.

Replace:

```rust
"Host: localhost"
```

With the actual host. Look at how the function parses the URL — it likely already has `host` and `port` variables from the `TcpStream::connect` call. Use:

```rust
format!("Host: {}:{}", host, port)
```

Do this for both format strings (the one with body and the one without).

- [ ] **Step 2: Verify** — Run `cargo check`

- [ ] **Step 3: Commit**

```bash
git add src/lan_sync_orchestrator.rs
git commit -m "fix: use actual host in HTTP Host header instead of hardcoded localhost"
```

---

## Group D: Daemon Rust — Minor Fixes

### Task 10: online_sync.rs — clean up #[allow(dead_code)] on response structs (R-R2)

**Files:**
- Modify: `src/online_sync.rs:25-79, 348-394`

- [ ] **Step 1: Remove unused fields from response structs**

For each struct with `#[allow(dead_code)]` fields:

1. Check if the field is actually read anywhere in the code (grep for field name)
2. If not read, remove the field and its `#[allow(dead_code)]`
3. Add `#[serde(deny_unknown_fields)]` is NOT recommended (server may add fields) — instead just remove the Rust fields that are never read

Example — if `HeartbeatResponse.ok` is never read:

```rust
#[derive(Deserialize)]
struct HeartbeatResponse {
    // ok field removed — never read, response checked by HTTP status
}
```

For each struct, grep: `resp.field_name` or `response.field_name` to verify usage.

- [ ] **Step 2: Verify** — Run `cargo check`

- [ ] **Step 3: Commit**

```bash
git add src/online_sync.rs
git commit -m "cleanup: remove unused fields from sync response structs"
```

---

### Task 11: sync_common.rs — remove thin wrappers (R-R3)

**Files:**
- Modify: `src/sync_common.rs:9-19`
- Modify: all callers of `sync_common::open_dashboard_db` and `sync_common::get_device_id`

- [ ] **Step 1: Find all callers**

```bash
grep -rn "sync_common::open_dashboard_db\|sync_common::get_device_id" src/
```

- [ ] **Step 2: Replace calls with direct lan_common calls**

For each caller, replace:
- `sync_common::open_dashboard_db()` → `lan_common::open_dashboard_db()`
- `sync_common::get_device_id()` → `lan_common::get_device_id()`

Add `use crate::lan_common;` where needed.

- [ ] **Step 3: Remove the wrapper functions from sync_common.rs**

Delete:
```rust
pub fn open_dashboard_db() -> Result<rusqlite::Connection, String> {
    lan_common::open_dashboard_db()
}

pub fn get_device_id() -> String {
    lan_common::get_device_id()
}
```

- [ ] **Step 4: Verify** — Run `cargo check`

- [ ] **Step 5: Commit**

```bash
git add src/sync_common.rs src/online_sync.rs src/lan_sync_orchestrator.rs
git commit -m "refactor: remove thin wrappers in sync_common, use lan_common directly"
```

---

### Task 12: sync_common.rs — use chrono for normalize_ts (R-O2)

**Files:**
- Modify: `src/sync_common.rs:151-160`

- [ ] **Step 1: Replace manual parsing with chrono**

Replace:

```rust
fn normalize_ts(ts: &str) -> String {
    // ... manual parsing logic ...
}
```

With:

```rust
fn normalize_ts(ts: &str) -> String {
    chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%d %H:%M:%S"))
        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_else(|_| ts.to_string())
}
```

Chrono is already in `Cargo.toml` dependencies.

- [ ] **Step 2: Verify** — Run `cargo check` and `cargo test`

- [ ] **Step 3: Commit**

```bash
git add src/sync_common.rs
git commit -m "refactor: use chrono for timestamp normalization in sync_common"
```

---

### Task 13: lan_discovery.rs — iter_hosts as iterator (R-O3)

**Files:**
- Modify: `src/lan_discovery.rs` (LocalInterface::iter_hosts, ~line 746)

- [ ] **Step 1: Return iterator instead of Vec**

Replace:

```rust
fn iter_hosts(&self) -> Vec<[u8; 4]> {
    let ip_u32 = u32::from_be_bytes(self.ip);
    let mask_u32 = u32::from_be_bytes(self.mask);
    let network = ip_u32 & mask_u32;
    let broadcast = network | !mask_u32;
    let mut hosts = Vec::new();
    let start = network.wrapping_add(1);
    let end = broadcast;
    if start >= end {
        return hosts;
    }
    for addr in start..end {
        hosts.push(addr.to_be_bytes());
    }
    hosts
}
```

With:

```rust
fn iter_hosts(&self) -> impl Iterator<Item = [u8; 4]> {
    let ip_u32 = u32::from_be_bytes(self.ip);
    let mask_u32 = u32::from_be_bytes(self.mask);
    let network = ip_u32 & mask_u32;
    let broadcast = network | !mask_u32;
    let start = network.wrapping_add(1);
    let end = broadcast;
    (start..end).map(|addr| addr.to_be_bytes())
}
```

Check callers — the only caller is `http_scan_subnet` which iterates over the result. No API change needed since both `Vec` and `impl Iterator` support `for .. in`.

- [ ] **Step 2: Verify** — Run `cargo check`

- [ ] **Step 3: Commit**

```bash
git add src/lan_discovery.rs
git commit -m "perf: return iterator from iter_hosts instead of allocating Vec"
```

---

## Group E: i18n Minor Fixes

### Task 14: Verify and fix t() fallback keys (T-3)

**Files:**
- Modify: `dashboard/src/locales/en/common.json`
- Modify: `dashboard/src/locales/pl/common.json`

- [ ] **Step 1: Verify keys exist in locale files**

Check each key mentioned in raport:
- `sessions.menu.top_projects_az` — grep in both common.json files
- `project_page.text.manual_session`

For any key that is MISSING from `en/common.json` or `pl/common.json`, add it with the appropriate translation.

```bash
cd dashboard && grep -c "sessions.menu.top_projects_az\|project_page.text.manual_session" src/locales/en/common.json src/locales/pl/common.json
```

- [ ] **Step 2: Commit** (if changes made)

```bash
git add dashboard/src/locales/
git commit -m "fix: add missing i18n keys for session/project fallbacks"
```

---

### Task 15: Remove duplicate language_hint key (T-4)

**Files:**
- Modify: `dashboard/src/locales/en/common.json`
- Modify: `dashboard/src/locales/pl/common.json`

- [ ] **Step 1: Find duplicates**

```bash
grep -n "language_hint" dashboard/src/locales/en/common.json
```

- [ ] **Step 2: Remove the duplicate entry** — keep the one in the correct section, remove the other.

- [ ] **Step 3: Verify** — Ensure JSON is still valid: `node -e "require('./dashboard/src/locales/en/common.json')"`

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/locales/
git commit -m "fix: remove duplicate language_hint key in locale files"
```

---

## Group F: Deferred / Needs Architecture Decision

The following items are documented but **NOT included** as tasks because they require architectural decisions beyond refactoring:

### NOT PLANNED: R-P2c — is_dashboard_running() wrong semantics

**Why deferred:** The current `heartbeat.txt` is written by the daemon's tracker.rs, not by the dashboard. Fixing this requires either:
- Dashboard writing its own heartbeat file (needs Tauri command)
- Daemon detecting the dashboard process (needs process scanning)

Both approaches need design discussion. The current behavior (beacon says "dashboard running" when daemon is active) has no practical negative impact — LAN peers don't use this flag for sync decisions.

### NOT PLANNED: R-O1 — merge_incoming_data on dynamic JSON

**Why deferred:** This is a ~350-line rewrite of the core merge logic. Requires:
- Defining typed Rust structs for the sync archive format
- Matching these types with the JSON format produced by `/lan/pull` and online sync
- Extensive testing (merge conflicts, tombstones, partial data)

This should be a separate project with its own test suite, not a refactor task.

### NOT PLANNED: R-S1 — Tokens in plaintext / R-S2 — zeroize crate

**Why deferred:** Tokens in `%APPDATA%` plaintext is standard for desktop apps (VS Code, Slack, etc.). Adding `zeroize` or platform keychain adds a dependency and complexity. If security requirements change, this becomes a feature, not a refactor.

### NOT PLANNED: D-P3 — Sessions.tsx too large / D-P4 — fetchAllSessions no limit

**Why deferred:** Sessions.tsx has already been partially decomposed into hooks. Further splits need UI/UX context. fetchAllSessions pagination needs backend support.

### NOT PLANNED: R-S3, R-S4, R-S5 — LAN security hardening

**Why deferred:** LAN sync operates in a trusted network model. Adding cryptographic hashes, device_id validation, and parameterized VACUUM INTO adds complexity without matching the threat model. Document as known limitations.

---

## Execution Order

Recommended order (least risk first):

1. **Tasks 1-3** (Minor dashboard fixes) — isolated, zero risk
2. **Tasks 14-15** (i18n fixes) — locale file only
3. **Task 4** (ManualSession util) — new file + 2 edits
4. **Tasks 7-8** (Rust minor fixes) — isolated functions
5. **Tasks 10-13** (Rust cleanup) — dead code, wrappers, parsing
6. **Task 9** (Host header) — affects LAN HTTP communication
7. **Task 6** (Thread batching) — affects LAN discovery timing
8. **Task 5** (OnlineSyncCard refactor) — largest change, ~40 props

**Total: 15 tasks, ~45 steps, estimated ~2-3 hours for agentic execution.**
