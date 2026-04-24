# CHANGELOG — TIMEFLOW

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions correspond to the single running counter in [`VERSION`](./VERSION).

Every entry is grouped by the priority phase from `plan_implementacji.md`:
P0 = security, P1 = critical bugs, P2 = hardening/perf, P3 = minor,
P4 = cleanup, P5 = docs/tests.

## Unreleased

### P0 — Security

- LAN `/lan/local-identity` no longer returns the pairing `secret`; secret
  is handed out only by `/lan/pair` after the pairing code is accepted.
- LAN `/lan/pair` now throttles per-IP (10 attempts per 60 s) to block
  brute-force pairing attempts.

### P1 — Critical fixes

- **macOS CPU measurement:** replaced `sysinfo` snapshots with direct
  `libproc proc_pidinfo()` deltas so per-app CPU is consistent with the
  Windows FILETIME path and survives tick-to-tick comparisons.
- **macOS window title:** implemented via `CGWindowList` so file-level
  tracking and AI suggestions work on macOS (previously returned `""`).
  Documented in the Help panel.
- **Online-sync shutdown:** the online-sync worker now stores its
  `JoinHandle` and is joined cleanly before respawn/restart instead of
  leaking threads.
- **Idle background attribution:** on idle transitions the background
  CPU path uses the same `effective_elapsed.max(1s)` cap as the
  foreground path to avoid crediting minutes of idle time to background
  apps.
- **DST regression:** tracker now uses `SystemTime::now()` (UTC epoch)
  rather than `Local::now()` to detect sleep gaps, so spring-forward/
  fall-back no longer triggers phantom `save_daily` runs.
- **Sync / tracker ordering:** `MERGE_MUTEX` serialises peer merges and
  the tracker honours `db_frozen` before INSERTs so writes can't race
  with an in-flight merge.
- **Tombstone portability:** tombstone `sync_key` now uses
  `exe_name|start_time` (migrated via `m21`) instead of the
  machine-local `app_id|start_time`, preventing cross-machine deletes.
- **DB cache coherence:** `initialize_database_file_once` re-initialises
  when the cached path no longer exists on disk.
- **AI training safety:** `is_training` is guarded by a RAII
  `IsTrainingGuard`, so a panic or early return can't strand the flag
  at `true`.
- **AI mode validation:** `set_assignment_mode` rejects
  `auto_confidence < suggest_confidence` in both the Tauri command and
  the UI form.
- **AI score breakdown:** new popover in `AiSessionIndicatorsCard`
  exposes the per-layer score breakdown returned by
  `get_session_score_breakdown`. Documented in Help.
- **i18n gaps:** added `sessions.menu.mode_alpha / mode_new_top /
  mode_top_new`, `ai_page.batch.tooltip_requires_auto_safe`,
  `settings.lan_sync.force_sync` (PL) and related keys; removed
  hard-coded strings from `AiBatchActionsCard` and
  `SessionContextMenu`.
- **UI wiring:** `Projects.onSaved` now calls
  `triggerRefresh('projects_manual_session_saved')` with an explicit
  reason.
- **macOS tray i18n:** tray menu uses `TrayText::*` entries with the
  shared i18n layer instead of hard-coded English.

### P2 — Architecture / performance

- **AI auto-safe batching:** `run_auto_safe_sync` now processes
  sessions in chunks of 500 with per-batch transactions and updates
  `assignment_auto_runs` counters after each batch so polling
  progress works.
- **`feedback_weight` inlined:** the value is returned as part of
  `AssignmentModelStatus`; the separate `get_feedback_weight` command
  (and its TS helper `getFeedbackWeight`) were removed.
- **DailyStore:** the tracker now keeps a long-lived
  `rusqlite::Connection` via `storage::DailyStore` across `run_loop`
  ticks, removing the per-save open overhead. The connection is
  reopened after system sleep to reset stale WAL state.
- **Title parsing dedup:** `extract_file_from_title`,
  `classify_activity_type` and `collect_descendants` moved to
  `src/title_parser.rs` and re-exported from both Windows and macOS
  monitors.
- **AI reset split:** the single `reset_assignment_model_knowledge`
  command was replaced by `reset_model_weights` (soft reset —
  preserves `assignment_feedback`) and `reset_model_full` (hard reset
  — wipes weights, feedback, suggestions and auto-safe history). UI
  surfaces both with distinct confirmation prompts; Help explains
  when to use each.
- Other previously landed P2 commits already recorded in git history:
  Zustand selector migration (Task 30), ConfirmDialog component (31),
  session/projects god-component breakups (32.1–32.2), toast memo
  (33), unified `aiStatus` source (34), `setTimeout` cleanup (35),
  `updated_at` indexes (26), `VACUUM INTO` parameter binding (28),
  `build_http_client` returns `Result` (29), auto-unfreeze vs
  sync-timeout alignment (22), dead marker fallback removal (23).

### P3 — Minor

- **Task 64 (`platform.ts`) — deferred.** The current UA-based fallback
  (`userAgentData.platform` → `navigator.platform` → UA string) is
  robust enough; bolting on `@tauri-apps/plugin-os` would require a new
  npm dep, Cargo dep, plugin registration and capability grants that
  outweigh the marginal gain. Keep open as a future nice-to-have.
- Tasks 43–49, 50–53, 54–58, 59–63, 65, 66, 67 already landed in git
  history.

### P4 — Cleanup

- Removed one-off dev artifacts: `dashboard/fix_ai.py`,
  `dashboard/get_logs.py`, `dashboard/temp_bg_services.txt`,
  `dashboard/check.bat`, `dashboard/test_esbuild.mjs`.
- Tasks 68, 69–72, 73, 74/76/77/78, 79–81, 83–87 already landed.
- **Task 75 (remove `CpuSnapshot.total_time`) — intentionally open.**
  The field is still required to compute CPU deltas between measurement
  snapshots on macOS.

### P5 — Docs / tests

- Added this `CHANGELOG.md`.

### Still open from the plan

- P2: Task 19 (idle → session split), Task 24 (merge streaming),
  Task 25 (upload progress callback), Task 27 (`run_db_blocking` in
  manual_sessions / sync_markers / lan_sync), Task 32.3–32.4
  (useSettingsFormState split), Task 36 (macOS tray sync/attention
  status), Task 37 (NSWorkspace foreground notifications), Task 38
  (incremental AI retraining).
- P5: Task 88 (LAN sync round-trip integration test), Task 89
  (fresh-DB schema test), Task 90 (custom ESLint rule for Zustand
  destructuring), Task 91 (PARITY.md finalisation), Task 93
  (`SECURITY_AUDIT.md`).
