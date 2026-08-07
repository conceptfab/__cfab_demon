# Online Sync — Peer-Presence Gate + Overlay Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Online sync must stop parking a "master" session and showing a false "recording paused" overlay when no second device is online — it should skip silently when the device is alone, and only show the freeze notice once the DB is actually frozen.

**Architecture:** Two coupled modules. **Client** (`__cfab_demon`, Rust daemon + Tauri dashboard) reacts to a new `no_peer` server status, shortens the master's wait-for-peer window from ~10 min to ~60 s with a silent skip on no-show, and gates the freeze notice on the real frozen step. **Server** (`__cfab_server`, Next.js/TS) adds a presence gate to `session/create`: if no other device in the license group was seen in the last 5 min (reusing the existing `direct-sync.ts` `fiveMinAgo` pattern), it returns `no_peer` instead of creating a parked session. The client ships first (immediate relief, contract-compatible), the server second (eliminates the wait entirely).

**Tech Stack:** Rust (daemon), React/TypeScript + Tailwind + vitest 4 (dashboard), Next.js + Prisma/Postgres + vitest (server).

---

## Shared contract — the `no_peer` status

New terminal-ish session status: **`no_peer`**.

- **Server** returns it from `POST /api/sync/session/create` when the requesting device is alone (no awaiting session to join **and** no peer seen in the freshness window). Response shape:
  ```json
  { "ok": true, "sessionId": "", "role": "master", "status": "no_peer",
    "peerDeviceId": null, "peerMarkerHash": null, "syncMode": null }
  ```
  No `SyncSession` row is created.
- **Client** treats `no_peer` exactly like the existing `not_needed` path: log it, set progress to step 13 `not_needed`, clear `sync_in_progress`, return `Ok(())`. No overlay error, no freeze.

## Rollout order (must follow)

1. **Client first (Tasks T1–T6).** Until the server sends `no_peer`, the client behaves better anyway (60 s wait + silent skip + honest overlay) and ignores nothing. An **old** client against a **new** server would mis-handle `no_peer` (falls into the slave branch with an empty `sessionId`), so the server gate must not ship first.
2. **Server second (Tasks T7–T10).** Once clients understand `no_peer`, deploy the gate to remove the 60 s wait and the parked session entirely.
3. **T11** verifies both together.

## File Structure

**Client — `__cfab_demon`:**
- Modify `src/online_sync.rs` — add `classify_create_status` decision helper + `no_peer` handling; shorten `wait_for_peer` (new `PEER_WAIT_ATTEMPTS`, `Option` return = silent no-show skip) and its caller.
- Create `dashboard/src/components/sync/sync-overlay-helpers.ts` — pure `shouldShowFrozenNotice(phase, step)`.
- Create `dashboard/src/components/sync/sync-overlay-helpers.test.ts` — vitest.
- Modify `dashboard/src/components/sync/SyncProgressOverlay.tsx` — gate the freeze notice with `shouldShowFrozenNotice`; keep Cancel visible during the wait.
- Modify `dashboard/src/components/help/sections/HelpOnlineSyncSection.tsx` — document the new "skips when alone" behavior (CLAUDE.md mandate).

**Server — `__cfab_server`:**
- Create `src/lib/sync/peer-presence.ts` — pure `isPeerPresent(devices, excludeDeviceId, nowMs, windowMs)`.
- Create `src/lib/sync/peer-presence.test.ts` — vitest.
- Modify `src/lib/sync/session-contracts.ts:17-24` — add `"no_peer"` to `SyncSessionStatus`.
- Modify `src/lib/sync/session-store.ts:183-258` — `findAndJoinOrCreate` takes `peerPresent`, returns a `no_peer` sentinel instead of creating a lone master.
- Modify `src/lib/sync/session-service.ts:107-220` — compute presence, pass it in, map the sentinel to the `no_peer` response.

---

## PART B — CLIENT (`__cfab_demon`) — ships first

### Task T1: `classify_create_status` decision helper (Rust, pure, TDD)

**Files:**
- Modify: `src/online_sync.rs` (add helper near the top, below the consts at `:16-22`; add tests to the existing `#[cfg(test)] mod tests`)

- [ ] **Step 1: Write the failing tests**

Add to the existing `#[cfg(test)] mod tests` block in `src/online_sync.rs`:

```rust
    #[test]
    fn classify_completed_is_not_needed() {
        assert_eq!(classify_create_status("completed", None), CreateOutcome::SkipNotNeeded);
    }

    #[test]
    fn classify_sync_mode_none_is_not_needed() {
        assert_eq!(classify_create_status("awaiting_peer", Some("none")), CreateOutcome::SkipNotNeeded);
    }

    #[test]
    fn classify_no_peer_is_skip_no_peer() {
        assert_eq!(classify_create_status("no_peer", None), CreateOutcome::SkipNoPeer);
    }

    #[test]
    fn classify_awaiting_peer_proceeds() {
        assert_eq!(classify_create_status("awaiting_peer", None), CreateOutcome::Proceed);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --lib classify_ 2>&1 | tail -20`
Expected: FAIL — `cannot find function classify_create_status` / `cannot find type CreateOutcome`.

- [ ] **Step 3: Write the helper**

Add below the constant block (after `src/online_sync.rs:22`):

```rust
/// How the server's `session/create` status should be handled before we touch
/// the DB. Pure so it can be unit-tested without network/DB.
#[derive(Debug, PartialEq, Eq)]
enum CreateOutcome {
    /// Run the full sync flow.
    Proceed,
    /// No second device is online — skip silently (no overlay error, no freeze).
    SkipNoPeer,
    /// Databases already identical — nothing to do.
    SkipNotNeeded,
}

/// Decide what to do with the create response. `completed` / `syncMode == "none"`
/// → already in sync; `no_peer` → device is alone; otherwise proceed.
fn classify_create_status(status: &str, sync_mode: Option<&str>) -> CreateOutcome {
    if status == "completed" || sync_mode == Some("none") {
        return CreateOutcome::SkipNotNeeded;
    }
    if status == "no_peer" {
        return CreateOutcome::SkipNoPeer;
    }
    CreateOutcome::Proceed
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --lib classify_ 2>&1 | tail -20`
Expected: PASS — 4 tests ok.

- [ ] **Step 5: Commit**

```bash
git add src/online_sync.rs
git commit -m "feat(online-sync): add classify_create_status helper for no_peer/not_needed"
```

---

### Task T2: Handle `no_peer` in `execute_online_sync` (Rust)

**Files:**
- Modify: `src/online_sync.rs:903-911` (replace the `completed`/`none` early-return block)

- [ ] **Step 1: Replace the early-return block**

Find this block (currently `src/online_sync.rs:903-911`):

```rust
    // Check if server says sync is not needed (databases already identical)
    if create_resp.status == "completed"
        || create_resp.sync_mode.as_deref() == Some("none")
    {
        sync_log("[1/13] Sync niepotrzebna — bazy identyczne");
        sync_state.set_progress(13, "not_needed", "local");
        sync_state.sync_in_progress.store(false, Ordering::SeqCst);
        return Ok(());
    }
```

Replace it with:

```rust
    // Decide whether to run at all. `no_peer` (alone) and `completed`/`none`
    // (already in sync) both skip silently — no overlay error, no DB freeze.
    match classify_create_status(&create_resp.status, create_resp.sync_mode.as_deref()) {
        CreateOutcome::SkipNotNeeded => {
            sync_log("[1/13] Sync niepotrzebna — bazy identyczne");
            sync_state.set_progress(13, "not_needed", "local");
            sync_state.sync_in_progress.store(false, Ordering::SeqCst);
            return Ok(());
        }
        CreateOutcome::SkipNoPeer => {
            sync_log("[1/13] Pominięto — brak drugiego urządzenia online");
            sync_state.set_progress(13, "not_needed", "local");
            sync_state.sync_in_progress.store(false, Ordering::SeqCst);
            return Ok(());
        }
        CreateOutcome::Proceed => {}
    }
```

> Note: `no_peer` reuses the `not_needed` progress phase deliberately — the overlay already treats `not_needed` as a benign completion (`SyncProgressOverlay.tsx:85,126`), so no new locale key or overlay branch is needed. The server sends `sessionId: ""` for `no_peer`, but we return before reading it, so nothing downstream touches it.

- [ ] **Step 2: Build to verify it compiles**

Run: `cargo build --lib 2>&1 | tail -20`
Expected: compiles (no `unused` warning for `classify_create_status`/`CreateOutcome`).

- [ ] **Step 3: Run the helper tests again (regression)**

Run: `cargo test --lib classify_ 2>&1 | tail -10`
Expected: PASS — still 4 ok.

- [ ] **Step 4: Commit**

```bash
git add src/online_sync.rs
git commit -m "feat(online-sync): skip silently when server reports no_peer"
```

---

### Task T3: Shorten the master wait-for-peer to ~60 s with silent no-show skip (Rust)

**Files:**
- Modify: `src/online_sync.rs:16-22` (add `PEER_WAIT_ATTEMPTS`)
- Modify: `src/online_sync.rs:275-300` (`wait_for_peer` — return `Option`, loop on the new const)
- Modify: `src/online_sync.rs:926-937` (caller — handle `None` = no-show)

- [ ] **Step 1: Add the constant**

After `src/online_sync.rs:18` (`const MAX_POLL_ATTEMPTS: u32 = 200; ...`) add:

```rust
const PEER_WAIT_ATTEMPTS: u32 = 20; // ~60s at 3s — peer was confirmed present at create time; no point blocking 10 min
```

- [ ] **Step 2: Change `wait_for_peer` to return `Option` and use the short budget**

Replace the body of `wait_for_peer` (`src/online_sync.rs:275-300`) with:

```rust
fn wait_for_peer(
    server_url: &str,
    token: &str,
    session_id: &str,
    device_id: &str,
    _sync_state: &LanSyncState,
    stop_signal: &AtomicBool,
    sync_start: Instant,
) -> Result<Option<(String, Option<StorageCredentialsWrapper>)>, String> {
    for _ in 0..PEER_WAIT_ATTEMPTS {
        check_timeout_and_stop(sync_start, stop_signal)?;
        thread::sleep(POLL_INTERVAL);
        if let Err(e) = send_heartbeat(server_url, token, session_id, device_id) {
            sync_log(&format!("[heartbeat] error: {}", e));
        }

        let status = poll_status(server_url, token, session_id, device_id)?;
        if status.status != "awaiting_peer" {
            let mode = status
                .sync_mode
                .unwrap_or_else(|| "full".to_string());
            return Ok(Some((mode, status.storage_credentials)));
        }
    }
    // Peer never joined within the short window — not an error, just skip.
    Ok(None)
}
```

- [ ] **Step 3: Handle the `None` (no-show) case at the caller**

Replace the master branch (`src/online_sync.rs:926-937`, the `if create_resp.status == "awaiting_peer" { ... }` arm) with:

```rust
    let (sync_mode, storage_creds) = if create_resp.status == "awaiting_peer" {
        // We're master, wait briefly for a slave to join.
        sync_log("[2/13] Oczekiwanie na drugiego klienta...");
        match wait_for_peer(
            server_url,
            token,
            &session_id,
            &device_id,
            sync_state,
            stop_signal,
            sync_start,
        )? {
            Some(v) => v,
            None => {
                // Peer never showed up. Release the parked session and skip silently.
                sync_log("[2/13] Drugie urządzenie nie dołączyło — pomijam (bez błędu)");
                cancel_session(server_url, token, &session_id, &device_id, "peer_no_show").ok();
                sync_state.set_progress(13, "not_needed", "local");
                sync_state.sync_in_progress.store(false, Ordering::SeqCst);
                return Ok(());
            }
        }
    } else {
```

> Note: the `else` arm (slave path) below is unchanged. We `cancel_session` explicitly here because the body returns `Ok(())`, so the `Err`-branch cancel in `run_online_sync` (`:778-780`) won't run. `guard_online_cleanup` (`:854-859`) still runs unconditionally and unfreezes (a no-op here — we never reached the step-5 freeze).

- [ ] **Step 4: Build and run the full online_sync test set**

Run: `cargo test --lib online_sync 2>&1 | tail -25`
Expected: compiles; existing tests (incl. the catch_unwind panic test) still PASS. No reference to the removed `Err("Timeout waiting for peer")`.

- [ ] **Step 5: Commit**

```bash
git add src/online_sync.rs
git commit -m "feat(online-sync): cap master peer-wait at ~60s and skip silently on no-show"
```

---

### Task T4: `shouldShowFrozenNotice` predicate (TS, pure, TDD)

**Files:**
- Create: `dashboard/src/components/sync/sync-overlay-helpers.ts`
- Create: `dashboard/src/components/sync/sync-overlay-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/components/sync/sync-overlay-helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldShowFrozenNotice } from './sync-overlay-helpers';

describe('shouldShowFrozenNotice', () => {
  it('hidden while creating session (step 1)', () => {
    expect(shouldShowFrozenNotice('creating_session', 1)).toBe(false);
  });
  it('hidden while awaiting peer (step 2)', () => {
    expect(shouldShowFrozenNotice('awaiting_peer', 2)).toBe(false);
  });
  it('hidden while negotiating (step 3)', () => {
    expect(shouldShowFrozenNotice('negotiating', 3)).toBe(false);
  });
  it('shown once the DB is frozen (step 5)', () => {
    expect(shouldShowFrozenNotice('freezing', 5)).toBe(true);
  });
  it('shown during transfer (step 8)', () => {
    expect(shouldShowFrozenNotice('uploading', 8)).toBe(true);
  });
  it('hidden on completion', () => {
    expect(shouldShowFrozenNotice('completed', 13)).toBe(false);
  });
  it('hidden on not_needed', () => {
    expect(shouldShowFrozenNotice('not_needed', 13)).toBe(false);
  });
  it('hidden on error phases', () => {
    expect(shouldShowFrozenNotice('error_merge', 7)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard && npx vitest run src/components/sync/sync-overlay-helpers.test.ts 2>&1 | tail -20`
Expected: FAIL — cannot resolve `./sync-overlay-helpers`.

- [ ] **Step 3: Write the helper**

Create `dashboard/src/components/sync/sync-overlay-helpers.ts`:

```ts
/**
 * The local DB is frozen only from the "freezing" step (step 5) until the
 * session completes/unfreezes. Before that — creating_session / awaiting_peer /
 * negotiating (steps 1–4) — recording is still running, so the "Recording is
 * paused" notice must NOT be shown. Mirrors src/online_sync.rs (freeze at step 5)
 * and the LAN orchestrator (freeze at step 5).
 */
export function shouldShowFrozenNotice(phase: string, step: number): boolean {
  if (phase === 'completed' || phase === 'not_needed') return false;
  if (phase.startsWith('error')) return false;
  return step >= 5;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard && npx vitest run src/components/sync/sync-overlay-helpers.test.ts 2>&1 | tail -20`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/sync/sync-overlay-helpers.ts dashboard/src/components/sync/sync-overlay-helpers.test.ts
git commit -m "feat(sync-overlay): add shouldShowFrozenNotice predicate (frozen only from step 5)"
```

---

### Task T5: Gate the freeze notice in `SyncProgressOverlay.tsx` (TSX)

**Files:**
- Modify: `dashboard/src/components/sync/SyncProgressOverlay.tsx:125-129` (add derived flag) and `:190-206` (gate the notice, keep Cancel)

- [ ] **Step 1: Import the helper**

Add to the imports at the top of `SyncProgressOverlay.tsx`:

```tsx
import { shouldShowFrozenNotice } from './sync-overlay-helpers';
```

- [ ] **Step 2: Derive the flag**

After `const isError = progress.phase.startsWith('error');` (`:127`) add:

```tsx
  const showFrozenNotice = shouldShowFrozenNotice(progress.phase, progress.step);
```

- [ ] **Step 3: Gate only the notice `<p>`, keep Cancel during the wait**

Replace the block at `:190-206`:

```tsx
        {/* Freeze notice + cancel */}
        {!isCompleted && !isError && (
          <>
            <p className="text-[11px] text-amber-400/80 mb-2">
              {t('sync_progress.frozen_notice', 'Recording is paused. Please do not close the application.')}
            </p>
            {onCancel && (
              <button type="button"
                onClick={onCancel}
                className="flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 transition-colors mb-2"
              >
                <XCircle className="size-3.5" />
                {t('sync_progress.cancel', 'Cancel')}
              </button>
            )}
          </>
        )}
```

with:

```tsx
        {/* Freeze notice (only while the DB is actually frozen) + cancel (always while active) */}
        {!isCompleted && !isError && (
          <>
            {showFrozenNotice && (
              <p className="text-[11px] text-amber-400/80 mb-2">
                {t('sync_progress.frozen_notice', 'Recording is paused. Please do not close the application.')}
              </p>
            )}
            {onCancel && (
              <button type="button"
                onClick={onCancel}
                className="flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 transition-colors mb-2"
              >
                <XCircle className="size-3.5" />
                {t('sync_progress.cancel', 'Cancel')}
              </button>
            )}
          </>
        )}
```

- [ ] **Step 4: Verify build + lint**

Run: `cd dashboard && npm run lint 2>&1 | tail -20 && npx tsc --noEmit 2>&1 | tail -20`
Expected: no new lint/type errors involving `SyncProgressOverlay.tsx`.

- [ ] **Step 5: Manual render check (per project feedback: build green ≠ render correct)**

Trigger an online sync solo (or watch the master path). Expected: at "2/13 Waiting for second device" the overlay shows the title, phase label, and a **Cancel** button, but **no** "recording is paused" line. The notice appears only from "5/13 freezing" onward.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/components/sync/SyncProgressOverlay.tsx
git commit -m "fix(sync-overlay): show 'recording paused' only when DB is actually frozen (step 5+)"
```

---

### Task T6: Document the behavior in Help (TSX, CLAUDE.md mandate)

**Files:**
- Modify: `dashboard/src/components/help/sections/HelpOnlineSyncSection.tsx`

- [ ] **Step 1: Read the section to match its format**

Run: `sed -n '1,200p' dashboard/src/components/help/sections/HelpOnlineSyncSection.tsx`
Identify the list/paragraph describing online-sync behavior or limitations and how it renders text (plain JSX vs `t('...')`).

- [ ] **Step 2: Add one bullet/sentence, matching the surrounding markup exactly**

Copy an adjacent list item / sentence and swap the text to (Polish UI is primary; keep the product name `TIMEFLOW`):

> „Synchronizacja online uruchamia się tylko wtedy, gdy drugie urządzenie jest aktywne (widziane w ciągu ostatnich 5 minut). Jeśli żadne inne urządzenie nie jest online, TIMEFLOW pomija synchronizację — nie wstrzymuje nagrywania i nie czeka na drugie urządzenie."

If the file uses an EN mirror / `t()` key, add the English equivalent too:

> "Online sync only runs when a second device is active (seen within the last 5 minutes). If no other device is online, TIMEFLOW skips the sync — it does not pause recording or wait for a second device."

- [ ] **Step 3: Verify build**

Run: `cd dashboard && npx tsc --noEmit 2>&1 | tail -10`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/help/sections/HelpOnlineSyncSection.tsx
git commit -m "docs(help): online sync skips when no peer is online (no false pause)"
```

---

## PART A — SERVER (`__cfab_server`) — ships second

> All server commands run from the `__cfab_server` repo root.

### Task T7: Add `no_peer` to `SyncSessionStatus` (TS)

**Files:**
- Modify: `src/lib/sync/session-contracts.ts:17-24`

- [ ] **Step 1: Extend the union**

Replace (`src/lib/sync/session-contracts.ts:17-24`):

```ts
export type SyncSessionStatus =
  | "awaiting_peer"
  | "negotiating"
  | "in_progress"
  | "completed"
  | "failed"
  | "expired"
  | "cancelled";
```

with:

```ts
export type SyncSessionStatus =
  | "awaiting_peer"
  | "no_peer"
  | "negotiating"
  | "in_progress"
  | "completed"
  | "failed"
  | "expired"
  | "cancelled";
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | tail -20`
Expected: no errors. (`no_peer` is only produced where we add it; existing `switch`/`if` chains have no exhaustiveness assertion that breaks — confirm none surfaces; if one does, handle it in the task that introduces it.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/sync/session-contracts.ts
git commit -m "feat(sync): add no_peer to SyncSessionStatus"
```

---

### Task T8: `isPeerPresent` presence helper (TS, pure, TDD)

**Files:**
- Create: `src/lib/sync/peer-presence.ts`
- Create: `src/lib/sync/peer-presence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/sync/peer-presence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isPeerPresent, PEER_PRESENCE_WINDOW_MS } from "./peer-presence";

const NOW = 1_700_000_000_000; // fixed epoch ms — no Date.now() in tests
const W = PEER_PRESENCE_WINDOW_MS;

describe("isPeerPresent", () => {
  it("false when only the requesting device exists", () => {
    const devices = [{ deviceId: "A", lastSeenAt: new Date(NOW).toISOString() }];
    expect(isPeerPresent(devices, "A", NOW)).toBe(false);
  });

  it("ignores the requesting device's own freshness", () => {
    const devices = [{ deviceId: "A", lastSeenAt: new Date(NOW).toISOString() }];
    expect(isPeerPresent(devices, "A", NOW)).toBe(false);
  });

  it("false when the other device is stale", () => {
    const devices = [
      { deviceId: "A", lastSeenAt: new Date(NOW).toISOString() },
      { deviceId: "B", lastSeenAt: new Date(NOW - W - 1).toISOString() },
    ];
    expect(isPeerPresent(devices, "A", NOW)).toBe(false);
  });

  it("true when another device is fresh", () => {
    const devices = [{ deviceId: "B", lastSeenAt: new Date(NOW - 1000).toISOString() }];
    expect(isPeerPresent(devices, "A", NOW)).toBe(true);
  });

  it("false when the other device has null lastSeenAt", () => {
    const devices = [{ deviceId: "B", lastSeenAt: null }];
    expect(isPeerPresent(devices, "A", NOW)).toBe(false);
  });

  it("exactly at the window boundary counts as stale", () => {
    const devices = [{ deviceId: "B", lastSeenAt: new Date(NOW - W).toISOString() }];
    expect(isPeerPresent(devices, "A", NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/sync/peer-presence.test.ts 2>&1 | tail -20`
Expected: FAIL — cannot resolve `./peer-presence`.

- [ ] **Step 3: Write the helper**

Create `src/lib/sync/peer-presence.ts`:

```ts
/** Freshness window for "online" — mirrors the existing check in direct-sync.ts. */
export const PEER_PRESENCE_WINDOW_MS = 5 * 60 * 1000;

export interface PresenceDevice {
  deviceId: string;
  lastSeenAt: string | null;
}

/**
 * True when at least one device OTHER than `excludeDeviceId` was seen within
 * `windowMs` before `nowMs`. Gates online-sync session creation so a solo device
 * never parks a master session waiting for a peer that is offline.
 * Boundary is exclusive (lastSeenAt must be strictly newer than now - window).
 */
export function isPeerPresent(
  devices: PresenceDevice[],
  excludeDeviceId: string,
  nowMs: number,
  windowMs: number = PEER_PRESENCE_WINDOW_MS,
): boolean {
  const threshold = nowMs - windowMs;
  return devices.some(
    (d) =>
      d.deviceId !== excludeDeviceId &&
      d.lastSeenAt != null &&
      new Date(d.lastSeenAt).getTime() > threshold,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/sync/peer-presence.test.ts 2>&1 | tail -20`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sync/peer-presence.ts src/lib/sync/peer-presence.test.ts
git commit -m "feat(sync): add isPeerPresent freshness helper"
```

---

### Task T9: `findAndJoinOrCreate` returns a `no_peer` sentinel (TS)

**Files:**
- Modify: `src/lib/sync/session-store.ts:183-258`

- [ ] **Step 1: Change the signature and guard the create branch**

Replace the function header (`:183-188`):

```ts
export async function findAndJoinOrCreate(
  userId: string,
  deviceId: string,
  markerHash: string | null,
  tableHashes: TableHashes | null,
): Promise<{ session: SyncSession; role: "master" | "slave" }> {
```

with:

```ts
export async function findAndJoinOrCreate(
  userId: string,
  deviceId: string,
  markerHash: string | null,
  tableHashes: TableHashes | null,
  peerPresent: boolean,
): Promise<{ session: SyncSession; role: "master" | "slave" } | { session: null; role: "no_peer" }> {
```

Then, inside the transaction, right before the `// Create new session as master` comment (`:232`), insert:

```ts
    // No awaiting session to join. Only create a master session if a peer is
    // actually online — otherwise a solo device would park here for the whole TTL.
    if (!peerPresent) {
      return { session: null, role: "no_peer" as const };
    }

```

(The `if (existing) { ... return { session, role: "slave" } }` join branch above is unchanged — a literally-awaiting peer always proves presence, so joining is never gated.)

- [ ] **Step 2: Verify build surfaces the caller mismatch**

Run: `npx tsc --noEmit 2>&1 | tail -20`
Expected: ERROR at `session-service.ts` — `findAndJoinOrCreate` now expects 5 args / the result union changed. This is the expected red; T10 fixes it.

- [ ] **Step 3: Confirm there is exactly one caller**

Run: `grep -rn "findAndJoinOrCreate" src/ | grep -v "session-store.ts"`
Expected: only `src/lib/sync/session-service.ts`. (If others appear, each must be updated the same way in T10.)

- [ ] **Step 4: Commit (compiles after T10; commit together if your workflow requires green builds per commit — otherwise commit now)**

```bash
git add src/lib/sync/session-store.ts
git commit -m "feat(sync): findAndJoinOrCreate gates lone-master creation on peerPresent"
```

---

### Task T10: Wire presence into `handleSessionCreate` (TS)

**Files:**
- Modify: `src/lib/sync/session-service.ts` (imports; `:131-137` call site; add `no_peer` early return)

- [ ] **Step 1: Add imports**

Add near the other `@/lib/sync/*` imports at the top of `session-service.ts` (merge into the existing `license-store` import if one is already present; mirror the import path style used in `direct-sync.ts`):

```ts
import { touchDeviceLastSeen, getDevice, getDevicesForLicense, getDevicesForUser } from "@/lib/sync/license-store";
import { isPeerPresent } from "@/lib/sync/peer-presence";
```

- [ ] **Step 2: Compute presence and pass it in; handle `no_peer`**

Replace the call block (`:131-137`):

```ts
  // C1: Atomic find-and-join-or-create to prevent race condition in session pairing
  const { session, role } = await findAndJoinOrCreate(
    userId,
    body.deviceId,
    body.markerHash,
    body.tableHashes,
  );
```

with:

```ts
  // Peer-presence gate: register this device as seen, then check whether any
  // OTHER device in the license group is online (last 5 min). Mirrors the
  // presence pattern in direct-sync.ts. Prevents a solo device from parking a
  // master session that waits the full TTL for a peer that will never join.
  await touchDeviceLastSeen(body.deviceId).catch(() => {});
  const requestingDevice = await getDevice(body.deviceId);
  const peerDevices = requestingDevice
    ? await getDevicesForLicense(requestingDevice.licenseId)
    : await getDevicesForUser(userId);
  const peerPresent = isPeerPresent(peerDevices, body.deviceId, Date.now());

  // C1: Atomic find-and-join-or-create to prevent race condition in session pairing
  const result = await findAndJoinOrCreate(
    userId,
    body.deviceId,
    body.markerHash,
    body.tableHashes,
    peerPresent,
  );

  if (result.role === "no_peer") {
    log("info", "session-service.no-peer", { deviceId: body.deviceId });
    return {
      ok: true,
      sessionId: "",
      role: "master",
      status: "no_peer",
      peerDeviceId: null,
      peerMarkerHash: null,
      syncMode: null,
    };
  }

  const { session, role } = result;
```

(Everything after — `forceFullSync` override at `:140`, the slave storage-provisioning block, and both `return` statements — is unchanged and now operates on the narrowed `session`/`role`.)

- [ ] **Step 3: Verify build is green again**

Run: `npx tsc --noEmit 2>&1 | tail -20`
Expected: no errors (the union is narrowed by the `no_peer` early return).

- [ ] **Step 4: Run the full server test suite**

Run: `npx vitest run 2>&1 | tail -25`
Expected: PASS, including the new `peer-presence` tests.

- [ ] **Step 5: Manual endpoint check (two devices' worth of state)**

Start the server (`npm run dev`) against a dev DB. With a valid sync token:

```bash
# A) Alone: no other device seen recently → expect status "no_peer", empty sessionId
curl -s -X POST localhost:3000/api/sync/session/create \
  -H "Authorization: Bearer $SYNC_TOKEN" -H "Content-Type: application/json" \
  -d '{"deviceId":"devA","markerHash":null,"tableHashes":null}' | jq '{status,sessionId,role}'
# Expected: { "status": "no_peer", "sessionId": "", "role": "master" }
```

Then simulate a present peer (a second device that just hit any authed sync endpoint within 5 min, so its `lastSeenAt` is fresh) and repeat the create for `devA`:

```bash
# B) Peer present → expect a real session parked as awaiting_peer (or slave-join if devB created first)
curl -s -X POST localhost:3000/api/sync/session/create \
  -H "Authorization: Bearer $SYNC_TOKEN" -H "Content-Type: application/json" \
  -d '{"deviceId":"devA","markerHash":null,"tableHashes":null}' | jq '{status,sessionId,role}'
# Expected: status "awaiting_peer" with a non-empty sessionId (master) OR "negotiating"/"slave"
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/sync/session-service.ts
git commit -m "feat(sync): return no_peer from session/create when device is alone"
```

---

### Task T11: End-to-end verification + rollout

- [ ] **Step 1: Client-only (server still old) — regression-safe relief**

With the new client against the **current** server (still sends `awaiting_peer`):
- Solo trigger → overlay shows "2/13 Waiting for second device" **without** the false "recording paused" line, a **Cancel** is available, and after ~60 s it silently ends as `not_needed` (no red error), with the parked session cancelled on the server.

- [ ] **Step 2: Both deployed — full fix**

Deploy server (T7–T10). Solo trigger → server returns `no_peer`; client logs "Pominięto — brak drugiego urządzenia online" and ends immediately. **No overlay wait at all.**

- [ ] **Step 3: Two real devices still pair**

Both devices online with sync enabled → one becomes master (`awaiting_peer`), the other joins as slave, full 13-step sync completes and converges. Confirm in `sync_log` on both sides.

- [ ] **Step 4: Document the known cold-start limitation**

In `PARITY.md` (or the online-sync section of the relevant doc), note: *"If two devices both perform their very first sync within the same 5-minute window with no prior `lastSeenAt`, the first cycle may be skipped as `no_peer`; they pair on the next interval once each has registered presence. Bounded to one skipped cycle — never a 10-minute freeze."*

```bash
git add PARITY.md
git commit -m "docs(parity): note no_peer cold-start one-cycle skip"
```

---

## Self-Review

**Spec coverage** (against the diagnosed defects P-1…P-4 + the user's "why does it start without a peer"):
- P-1 *(no presence gate before create)* → **T7–T10** (server `no_peer`) + **T1–T3** (client honors it / short-waits).
- P-2 *(false "recording paused" during awaiting_peer)* → **T4–T5**.
- P-3 *(multiple schedulers hammering)* → out of scope here; already handled by the committed "respect 30 min" / interval-gate + cooldown work (memories `project_online_sync_dual_scheduler`). This plan makes each triggered cycle cheap/silent, which also defuses the symptom.
- P-4 *(10-min block)* → **T3** (60 s cap + silent skip).
- Help/CLAUDE.md mandate → **T6**.

**Placeholder scan:** every code step contains real code; the only "match the surrounding markup" instruction is T6 (docs), where the exact bilingual sentence is given and the file is read first.

**Type consistency:** `classify_create_status`/`CreateOutcome` (T1) used verbatim in T2. `wait_for_peer` return type `Result<Option<(String, Option<StorageCredentialsWrapper>)>, String>` (T3) matches its caller's `match … { Some(v) => v, None => … }`. `shouldShowFrozenNotice(phase, step)` (T4) matches the call in T5. Server: `isPeerPresent(devices, excludeDeviceId, nowMs, windowMs?)` (T8) matches the call in T10; `findAndJoinOrCreate(..., peerPresent)` returning the `{session: null, role: "no_peer"}` union (T9) matches the `result.role === "no_peer"` narrowing in T10; `no_peer` added to `SyncSessionStatus` (T7) makes the T10 response type-check.

**Scope note:** Client and server are separate subsystems but share one contract (`no_peer`) and only fix the symptom end-to-end together; kept in one plan with explicit rollout order. Could be split into two plans if you prefer separate PRs per repo — say the word.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-24-online-sync-peer-presence-gate.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?** (Or: ship **Part B / T1–T6 only** first for immediate relief, then Part A after.)
