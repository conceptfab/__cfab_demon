# Code Review Report — cfab-demon

**Date:** 2025-02-21
**Scope:** Full codebase — Rust daemon (`src/`), Tauri backend (`dashboard/src-tauri/`), React frontend (`dashboard/src/`), Python scripts, configuration files
**Focus:** Logic correctness, performance, optimizations, redundant code, missing English translations

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Rust Daemon (src/)](#2-rust-daemon)
3. [Tauri Backend (dashboard/src-tauri/)](#3-tauri-backend)
4. [React Frontend (dashboard/src/)](#4-react-frontend)
5. [Python Scripts & Configuration](#5-python-scripts--configuration)
6. [Missing Translations Summary](#6-missing-translations-summary)

---

## 1. Executive Summary

| Severity | Daemon | Tauri Backend | Frontend | Scripts/Config | **Total** |
|----------|--------|---------------|----------|----------------|-----------|
| Critical | 2 | 5 | 10 | 3 | **20** |
| Important | 6 | 9 | 7 | 5 | **27** |
| Low | 4 | 5 | 4 | 4 | **17** |
| **Total** | **12** | **19** | **21** | **12** | **64** |

**Top priorities:**
1. **Missing translations** — ~30 instances of Polish text in UI (pages, dialogs, tooltips, menus, error dialogs)
2. **Data integrity** — missing transactions in reset/delete operations, `clear_all_data` doesn't clear ML model tables
3. **Performance** — N+1 query patterns in import/session code, `get_session_count` fetching all sessions just to count
4. **Logic bugs** — PID reuse not detected in daemon, division-by-zero risk in dashboard stats, state mutation in React

---

## 2. Rust Daemon

### 2.1 CRITICAL

#### D-1: [ZROBIONE] `file_index_cache` not rebuilt after `load_daily` — duplicate file entries
**File:** `src/tracker.rs:155-157`

After midnight rollover or daemon restart, `load_daily()` loads existing data from disk but `file_index_cache` starts empty. Every file already present in `app_data.files` gets a duplicate entry appended instead of being updated.

**Fix:** Rebuild the cache from loaded data:
```rust
fn rebuild_file_index_cache(daily_data: &DailyData) -> HashMap<String, HashMap<String, usize>> {
    let mut cache = HashMap::new();
    for (exe_name, app_data) in &daily_data.apps {
        let file_map = cache.entry(exe_name.clone()).or_insert_with(HashMap::new);
        for (idx, file_entry) in app_data.files.iter().enumerate() {
            file_map.insert(file_entry.name.clone(), idx);
        }
    }
    cache
}
```

#### D-2: PID reuse not actually detected in `process_still_alive`
**File:** `src/monitor.rs:28-41, 80-99`

The function checks if *any* process occupies a PID, not if it's the *same* process. After PID reuse, the cached exe name is returned for the wrong process. Within the 60-second alive-check window, no validation occurs at all.

**Fix:** Store the process creation time (via `GetProcessTimes`) in the cache tuple and compare on re-validation.

---

### 2.2 IMPORTANT

#### D-3: `collect_descendants` has no cycle detection — stack overflow possible
**File:** `src/monitor.rs:257-264`

Recursive tree walk without a visited set. If PID reuse creates a cycle in the parent→child map during `CreateToolhelp32Snapshot`, the daemon thread crashes with a stack overflow.

**Fix:** Add a `HashSet<u32>` visited guard.

#### D-4: `System::new_all()` in `is_dashboard_running` — loads all system info just to check one process
**File:** `src/tray.rs:197-206`

Refreshes CPU, memory, disks, networks — everything. Causes a visible UI freeze on systems with many processes.

**Fix:** Use `System::new_with_specifics(RefreshKind::new().with_processes(...))`.

#### D-5: `total_tracked_seconds` overcounts when multiple apps are active simultaneously
**File:** `src/storage.rs:203-215`

The summary field sums all apps' `total_seconds`. With two apps active in the same tick, 10 seconds of wall time counts as 20 seconds. The dashboard may display this misleadingly.

**Fix:** Rename to `total_app_seconds` or add a `total_wall_seconds` field computed from merged intervals.

#### D-6: Duplicated tip-building logic
**File:** `src/tray.rs:37-44` and `src/tray.rs:144-149`

The `OnTimerTick` handler duplicates `build_tray_tip()` logic verbatim.

**Fix:** Call `build_tray_tip()` from the timer handler.

#### D-7: [ZROBIONE] Polish strings in tray menu and error dialogs (see [Section 6](#6-missing-translations-summary))

#### D-8: [ZROBIONE] Polish strings in `.expect()` panic messages (see [Section 6](#6-missing-translations-summary))

---

### 2.3 LOW

#### D-9: Shadowed `iv` variable in tracker loop — confusing but correct
**File:** `src/tracker.rs:165`

#### D-10: `apps_active_count` may include archive-loaded apps with zero new activity
**File:** `src/storage.rs:214`

#### D-11: Sub-second poll intervals silently rounded up to 1 second
**File:** `src/tracker.rs:267-273`

#### D-12: Two separate clock calls (`Local::now()` + `Instant::now()`) per tick — minor drift
**File:** `src/tracker.rs:48, 65`

---

## 3. Tauri Backend

### 3.1 CRITICAL

#### T-1: [ZROBIONE] `clear_all_data` omits assignment model tables
**File:** `dashboard/src-tauri/src/commands/settings.rs:119-132`
**Confidence:** 95%

After "clear all data", the ML assignment model retains training data from deleted sessions. Users get project suggestions based on ghost evidence.

**Fix:** Add these tables to the DELETE batch:
```sql
DELETE FROM assignment_auto_run_items;
DELETE FROM assignment_auto_runs;
DELETE FROM assignment_feedback;
DELETE FROM assignment_suggestions;
DELETE FROM assignment_model_app;
DELETE FROM assignment_model_token;
DELETE FROM assignment_model_time;
DELETE FROM assignment_model_state;
```

#### T-2: [ZROBIONE] `reset_app_time` / `reset_project_time` — no transaction wrapping
**File:** `dashboard/src-tauri/src/commands/settings.rs:93-116`
**Confidence:** 90%

Two dependent DELETEs (file_activities + sessions) run without a transaction. If the second fails, the database is left in an inconsistent state.

**Fix:** Wrap in `conn.transaction()`.

#### T-3: `get_session_count` fetches ALL sessions to count them
**File:** `dashboard/src-tauri/src/commands/sessions.rs:315-329`
**Confidence:** 88%

When `project_id` filter is active, `get_session_count` calls `get_sessions(limit: None)` — loading thousands of full session objects including file activities and ML suggestions — just to call `.len()`.

**Fix:** Implement a proper `SELECT COUNT(*)` SQL query for the project-filter path.

#### T-4: [ZROBIONE] Division by zero risk in `get_dashboard_stats`
**File:** `dashboard/src-tauri/src/commands/dashboard.rs:21`
**Confidence:** 85%

```rust
let avg_daily = total_seconds / day_count;
```

Despite a SQL guard, NULL propagation scenarios can produce `day_count = 0`.

**Fix:** `let avg_daily = if day_count == 0 { 0 } else { total_seconds / day_count };`

#### T-5: SQL injection surface in `VACUUM INTO`
**File:** `dashboard/src-tauri/src/commands/settings.rs:149-151`
**Confidence:** 82%

`VACUUM INTO` doesn't support bound parameters. Manual single-quote escape is used, but control characters (null bytes, newlines) are not validated.

**Fix:** Add control character validation before the path is interpolated into SQL.

---

### 3.2 IMPORTANT

#### T-6: `run_auto_safe_assignment` — thousands of writes without a transaction
**File:** `dashboard/src-tauri/src/commands/assignment_model.rs:703-843`

500 sessions × ~6 SQL statements each = ~3000 individual WAL commits. Crash mid-loop leaves run record permanently inconsistent.

**Fix:** Wrap the item-processing loop in a transaction.

#### T-7: [ZROBIONE] `purge_unregistered_apps` — three DELETEs without a transaction
**File:** `dashboard/src-tauri/src/commands/import.rs:269-327`

#### T-8: `rebuild_sessions` deletes sessions referenced by `assignment_auto_run_items` — breaks rollback
**File:** `dashboard/src-tauri/src/commands/sessions.rs:575-580`

No `ON DELETE CASCADE` or `SET NULL`. After rebuild, auto-run rollback silently does nothing.

#### T-9: N+1 queries in `ensure_app_project_from_file_hint` during import
**File:** `dashboard/src-tauri/src/commands/projects.rs:214-236`

One `SELECT id FROM projects WHERE lower(name)=...` per file entry per app. With 50 apps × 20 files × 3 candidates = 3000 queries per import.

**Fix:** Load the projects table as a `HashMap<String, i64>` once before the import loop.

#### T-10: N+1 overlap checks in `validate_import`
**File:** `dashboard/src-tauri/src/commands/import_data.rs:51-89`

One overlap query per archive session. 10,000 sessions = 10,000 queries.

#### T-11: Blocking `rfd::FileDialog` on async Tokio thread
**File:** `dashboard/src-tauri/src/commands/export.rs:293-296`

`save_file()` is synchronous and blocks the Tokio executor. Other async tasks starve while the dialog is open.

**Fix:** Use `rfd::AsyncFileDialog` or `tauri-plugin-dialog`.

#### T-12: Destructive startup cleanup deletes user projects matching app names
**File:** `dashboard/src-tauri/src/db.rs:444-468`

On every startup:
```sql
DELETE FROM projects WHERE LOWER(name) IN (SELECT LOWER(display_name) FROM applications)
```
A project deliberately named "Firefox" gets silently deleted.

**Fix:** Run once via migration tracking, or remove and handle in UI.

#### T-13: Silent `Ok(())` when `assign_session_to_project` updates zero rows
**File:** `dashboard/src-tauri/src/commands/sessions.rs:400-402`

#### T-14: Polish comments throughout backend code (see [Section 6](#6-missing-translations-summary))

---

### 3.3 LOW

#### T-15: Dead `DELETE FROM _fa_keys` on fresh connection
**File:** `dashboard/src-tauri/src/commands/sessions.rs:126-129`

#### T-16: Inconsistent `?` vs `?1` parameter style in `manual_sessions.rs`
**File:** `dashboard/src-tauri/src/commands/manual_sessions.rs:85-93`

#### T-17: `prepare()` called inside loop in `merge_or_insert_session`
**File:** `dashboard/src-tauri/src/commands/import_data.rs:279-313`

#### T-18: 50 individual UPDATE statements for auto-generated colors without transaction
**File:** `dashboard/src-tauri/src/commands/dashboard.rs:443-458`

#### T-19: `suggest_project_for_session` has dead `#[command]` attribute (never registered in invoke_handler)
**File:** `dashboard/src-tauri/src/commands/assignment_model.rs:629`

---

## 4. React Frontend

### 4.1 CRITICAL — Missing Translations (Polish UI)

These pages/components contain Polish text visible to users:

| # | File | What's in Polish |
|---|------|-----------------|
| F-1 | `pages/AI.tsx` | [ZROBIONE] **Entire page** — title, descriptions, all labels |
| F-2 | `pages/Data.tsx` | [ZROBIONE] **Entire page** — tab labels, section titles |
| F-3 | `components/data/ExportPanel.tsx` | [ZROBIONE] **Entire component** — all buttons, labels, descriptions |
| F-4 | `components/data/ImportPanel.tsx` | [ZROBIONE] **Entire component** — all labels, status messages |
| F-5 | `components/ManualSessionDialog.tsx` | [ZROBIONE] **Entire dialog** — all form labels, buttons, validation messages |
| F-6 | `pages/Sessions.tsx:391-416` | [ZROBIONE] AI suggestion buttons/tooltips — "Zaakceptuj", "Odrzuć", "Sugestia AI" |
| F-7 | `pages/Projects.tsx:513/519` | [ZROBIONE] View mode buttons — "Widok listy", "Widok siatki" |
| F-8 | `pages/Settings.tsx:91` | [ZROBIONE] Alert message — Polish text in `alert()` call |
| F-9 | `components/dashboard/HourlyBreakdown.tsx:53` | Recharts tooltip label — `"Czas"` instead of `"Time"` |
| F-10 | `components/dashboard/AllProjectsChart.tsx:75` | Recharts tooltip label — `"Czas"` instead of `"Time"` |

**All of these need full English translation.**

---

### 4.2 IMPORTANT — Logic & Performance

#### F-11: [ZROBIONE] `handleRejectSuggestion` doesn't call `triggerRefresh` after rejecting
**File:** `pages/Sessions.tsx`

After rejecting an AI suggestion, the session list doesn't refresh. The user sees stale data until they manually navigate away and back.

**Fix:** Add `triggerRefresh()` after the reject API call succeeds.

#### F-12: [ZROBIONE] Direct mutation of Zustand state array via `.sort()`
**File:** `pages/Applications.tsx` — `filtered` useMemo

```tsx
const filtered = useMemo(() => {
    let result = apps.filter(...);
    result.sort(...);  // mutates the filtered array — if apps is state, .filter() creates a new array so this is safe
    return result;
}, [...]);
```

Actually `.filter()` creates a new array, so `.sort()` mutates only the copy. **Revised: this is safe but the pattern is fragile.** If `.filter()` is ever removed (e.g., when showing all apps), `.sort()` would mutate state directly.

**Fix:** Use `[...result].sort(...)` or `result.toSorted(...)` for safety.

#### F-13: [ZROBIONE] `AutoImporter` in `App.tsx` — missing cleanup for `warnTimer` on unmount
**File:** `App.tsx`

`setTimeout` reference `warnTimer` is not cleared in the effect cleanup function. If the component unmounts during the 3-second window, the timer fires on an unmounted component.

**Fix:** Return a cleanup function that calls `clearTimeout(warnTimer)`.

#### F-14: `React` used but not imported in `chart-styles.ts`
**File:** `lib/chart-styles.ts:1`

TypeScript type reference to `React.CSSProperties` without an import. Works with `jsx: react-jsx` but will break if the tsconfig changes.

#### F-15: Redundant dead branch in `ProjectDayTimeline.tsx` ternary
**File:** `components/dashboard/ProjectDayTimeline.tsx:406-410`

A ternary expression where both branches produce the same output.

#### F-16: `loadMonitored` listed as effect dependency but never used in the effect body
**File:** `pages/Applications.tsx:49`

Causes unnecessary re-runs of the effect when the function reference changes.

#### F-17: Context menus missing ARIA roles
**Files:** `pages/Sessions.tsx`, `components/dashboard/ProjectDayTimeline.tsx`

Custom context menus have no `role="menu"` / `role="menuitem"` attributes.

---

### 4.3 LOW

#### F-18: Unused component — `HourlyBreakdown.tsx` is dead code
**File:** `components/dashboard/HourlyBreakdown.tsx`

Never imported by any page. Corresponding `getHourlyBreakdown` in `tauri.ts` is also unused.

#### F-19: Array index used as React `key` in `ImportPage.tsx` and `TimeAnalysis.tsx`
**Files:** `pages/ImportPage.tsx:47`, `pages/TimeAnalysis.tsx:194,212`

#### F-20: Commented-out import with Polish explanation
**File:** `pages/Projects.tsx:6`
```tsx
// import { FolderPlus, Trash2 } from "lucide-react"; // Nie używane po usunięciu przycisku edycji
```
Delete the entire line.

#### F-21: `assignSessionToProject` missing `<void>` generic in invoke call
**File:** `lib/tauri.ts:83`

---

## 5. Python Scripts & Configuration

### 5.1 CRITICAL

#### P-1: [ZROBIONE] `shell=True` with list argument breaks npm commands on Windows
**Files:** `dashboard_dev.py:7`, `dashboard_build.py:17`

```python
subprocess.run(["npm", "run", "tauri", "dev"], shell=True)
```

On Windows, `shell=True` + list → only the first element is passed as the command string to `cmd.exe`. The `run tauri dev` arguments are lost.

**Fix:** Either drop `shell=True` or use a single string:
```python
subprocess.run(["npm", "run", "tauri", "dev"], check=True)
```

#### P-2: [ZROBIONE] `dashboard_build.py` doesn't exit with error when exe copy fails
**File:** `dashboard_build.py:44-46`

When no built executable is found, the script prints a warning in Polish but returns exit code 0. `build_all.py` reports success.

**Fix:** Add `sys.exit(1)` when `copied = False`.

#### P-3: [ZROBIONE] `debug_check_db.py` — hardcoded personal path + wrong DB filename
**File:** `debug_check_db.py:3`

```python
db_path = r"C:\Users\micz\AppData\Roaming\conceptfab\cfab_demon.db"
```

Uses personal username and legacy DB name. Should use `%APPDATA%` and `cfab_dashboard.db`.

---

### 5.2 IMPORTANT

#### P-4: `db_fix.py` and `query.py` use stale DB name `cfab_tracker.db`
**Files:** `db_fix.py:4`, `query.py:4`

The actual DB is `cfab_dashboard.db`. SQLite silently creates an empty file.

#### P-5: `db_fix.py` and `query.py` — missing `conn.close()`

#### P-6: `build_demon.py` — interactive `input()` prompt in `--run` flow blocks automation
**File:** `build_demon.py:386`

#### P-7: `fix-dashboard.py` — relative paths break when cwd is not project root
**File:** `fix-dashboard.py:3,6`

#### P-8: `build_demon.py` — `stderr` never printed on successful commands; warnings lost
**File:** `build_demon.py:192-196`

---

### 5.3 LOW

#### P-9: Six debug/one-off scripts polluting project root
**Files:** `db_fix.py`, `debug_check_db.py`, `query.py`, `test-query.py`, `_diag.py`, `fix-dashboard.py`

Should be moved to `scripts/debug/` or removed.

#### P-10: Hardcoded past dates in `_diag.py` and `test-query.py`

#### P-11: Duplicate dialog dependency — both `rfd` and `tauri-plugin-dialog` in Cargo.toml
**File:** `dashboard/src-tauri/Cargo.toml:25,29`

#### P-12: `tauri.conf.json` — `"csp": null` disables Content Security Policy
**File:** `dashboard/src-tauri/tauri.conf.json:26`

---

## 6. Missing Translations Summary

The requirement is: **entire UI must be in English**. Below is a consolidated list of all Polish text found across the codebase.

### 6.1 Frontend — User-Facing (CRITICAL)

| Location | Polish Text | English Translation |
|----------|------------|-------------------|
| `pages/AI.tsx` | [ZROBIONE] Entire page content | Full translation needed |
| `pages/Data.tsx` | [ZROBIONE] Tab labels, section titles | Full translation needed |
| `components/data/ExportPanel.tsx` | [ZROBIONE] All buttons, labels, descriptions | Full translation needed |
| `components/data/ImportPanel.tsx` | [ZROBIONE] All labels, status messages | Full translation needed |
| `components/ManualSessionDialog.tsx` | [ZROBIONE] All form labels, buttons, validation | Full translation needed |
| `pages/Sessions.tsx:391-416` | [ZROBIONE] "Zaakceptuj", "Odrzuć", "Sugestia AI" | "Accept", "Reject", "AI Suggestion" |
| `pages/Projects.tsx:513/519` | [ZROBIONE] "Widok listy", "Widok siatki" | "List view", "Grid view" |
| `pages/Settings.tsx:91` | [ZROBIONE] Alert text | English alert text |
| `dashboard/HourlyBreakdown.tsx:53` | "Czas" (tooltip label) | "Time" |
| `dashboard/AllProjectsChart.tsx:75` | "Czas" (tooltip label) | "Time" |

### 6.2 Daemon — User-Facing (IMPORTANT)

| Location | Polish Text | English Translation |
|----------|------------|-------------------|
| `src/single_instance.rs:50` | "Inna instancja Cfab Demon już działa." | "Another instance of Cfab Demon is already running." |
| `src/tray.rs:98` | "Wyjście" (menu item) | "Exit" |
| `src/tray.rs:111` | "Uruchom Dashboard" (menu item) | "Launch Dashboard" |
| `src/tray.rs:264` | "Nie znaleziono Dashboardu..." (error dialog) | "Dashboard not found (cfab-dashboard.exe)..." |
| `src/tray.rs:50-115` | All `.expect()` messages | Translate panic messages |

### 6.3 Backend — Code Comments (IMPORTANT)

| Location | Description |
|----------|------------|
| `commands/projects.rs` | ~20 inline Polish comments |
| `commands/helpers.rs:13` | Doc comment in Polish |
| `commands/import_data.rs:215` | Inline comment in Polish |
| `pages/Projects.tsx:6` | Commented-out import with Polish explanation |

### 6.4 Python Scripts — Console Output (LOW)

| Location | Description |
|----------|------------|
| `build_all.py` | All print statements in Polish |
| `build_demon.py` | All print/argparse text in Polish |
| `build_common.py` | Error messages in Polish |
| `dashboard_build.py` | Status messages in Polish |

### 6.5 Daemon — Log Messages (LOW)

| Location | Description |
|----------|------------|
| `src/main.rs` | All `log::info/warn/error` messages |
| `src/tracker.rs` | All log messages |
| `src/monitor.rs` | All log messages |
| `src/storage.rs` | All log messages |
| `src/tray.rs` | Most log messages (some English) |

---

## 7. Recommended Action Plan

### Phase 1 — Critical Fixes (High Impact, Low Effort)

1. **[ZROBIONE] Translate all Polish UI text to English** (F-1 through F-10, D-7, D-8)
2. **Add transactions** to `reset_app_time`, `reset_project_time`, `purge_unregistered_apps` (T-2, T-7)
3. **Add missing tables** to `clear_all_data` (T-1)
4. **Add division-by-zero guard** in `get_dashboard_stats` (T-4)
5. **Rebuild `file_index_cache`** after `load_daily` in daemon (D-1)

### Phase 2 — Performance (High Impact, Medium Effort)

6. **Replace `get_session_count` full-fetch** with SQL COUNT query (T-3)
7. **Cache projects table** in import loop instead of N+1 queries (T-9)
8. **Use `System::new_with_specifics`** instead of `new_all()` (D-4)
9. **Use `AsyncFileDialog`** instead of blocking `FileDialog` (T-11)

### Phase 3 — Robustness (Medium Impact)

10. **Add cycle detection** to `collect_descendants` (D-3)
11. **Add visited set / creation-time check** for PID reuse (D-2)
12. **Remove destructive startup cleanup** or make it a one-time migration (T-12)
13. **Fix Python build scripts** — `shell=True` issue, missing exit codes (P-1, P-2)

### Phase 4 — Cleanup (Low Impact)

14. **Remove dead code** — `HourlyBreakdown.tsx`, `getHourlyBreakdown`, unused `#[command]` (F-18, T-19)
15. **Clean up debug scripts** — move to `scripts/` or remove (P-9)
16. **Remove duplicate `rfd` dependency** (P-11)
17. **Translate code comments** to English (T-14, 6.3)
18. **Translate log messages** to English (6.5)

---

*End of report.*
