# TimeFlow — Code Review Report

**Date:** 2026-02-23
**Scope:** Logic correctness, performance, optimizations, redundant code, missing translations (EN)

---

## Table of Contents

1. [Translation Issues (Polish → English)](#1-translation-issues-polish--english)
2. [Logic & Correctness Issues](#2-logic--correctness-issues)
3. [Performance Issues](#3-performance-issues)
4. [Redundant / Dead Code](#4-redundant--dead-code)
5. [Suggested Optimizations](#5-suggested-optimizations)
6. [Summary Table](#6-summary-table)

---

## 1. Translation Issues (Polish → English)

All UI must be in English. The following Polish strings were found:

### 1.1 CRITICAL — User-facing UI strings

| # | File | Line(s) | Polish Text | Suggested English |
|---|------|---------|-------------|-------------------|
| T1 | `dashboard/src/components/layout/Sidebar.tsx` | 46 | `"Pomoc"` (nav label) | `"Help"` |
| T2 | `dashboard/src/components/layout/Sidebar.tsx` | 285 | `"Pomoc (F1)"` (tooltip) | `"Help (F1)"` |
| T3 | `dashboard/src/pages/Settings.tsx` | 554 | `"np. demo-user / email / UUID"` | `"e.g. demo-user / email / UUID"` |
| T4 | `dashboard/src/pages/Settings.tsx` | 570 | `"Wklej sam token (bez 'Bearer'...)"` | `"Paste the raw token (without 'Bearer' prefix and without quotes)"` |
| T5 | `dashboard/src/pages/Settings.tsx` | 582-583 | `"Ukryj token"` / `"Pokaz token"` | `"Hide token"` / `"Show token"` |
| T6 | `dashboard/src/pages/Settings.tsx` | 593 | `"Wpisz sam token, aplikacja sama doda..."` | `"Enter the raw token; the app will add the Bearer header automatically."` |
| T7 | `src/tracker.rs` | 50-52 | `"Niezgodność wersji!\nDemon:..."` (MessageBox) | `"Version mismatch!\nDaemon:..."` |
| T8 | `src/tracker.rs` | 59 | `"TimeFlow - Błąd wersji"` (MessageBox title) | `"TimeFlow - Version Error"` |
| T9 | `src/single_instance.rs` | 50 | `"Inna instancja TimeFlow Demon już działa."` | `"Another instance of TimeFlow Demon is already running."` |

### 1.2 IMPORTANT — Log messages & developer-facing strings

| # | File | Line(s) | Polish Text |
|---|------|---------|-------------|
| T10 | `src/main.rs` | 23 | `"uruchamianie..."` |
| T11 | `src/main.rs` | 27 | `"Nie można utworzyć katalogów aplikacji: {}"` |
| T12 | `src/tracker.rs` | 83 | `"Wątek monitora uruchomiony"` |
| T13 | `src/tracker.rs` | 164 | `"Brak monitorowanych aplikacji..."` |
| T14 | `src/tracker.rs` | 210 | `"Zmiana daty: {}"` |
| T15 | `src/tray.rs` | various | `"Zamykanie demona"`, `"Restart demona z menu tray"`, `"Uruchamianie Dashboard..."`, `"Demon uruchomiony..."`, `"Demon zatrzymany"`, `"Dashboard już działa"` |

### 1.3 LOW — Python build scripts

| # | File | Summary |
|---|------|---------|
| T16 | `build_all.py` | Docstrings, `argparse` help texts, `print()` messages — all in Polish |
| T17 | `build_demon.py` | Docstrings, help texts, print messages — all in Polish |
| T18 | `build_common.py` | Class and method docstrings in Polish |
| T19 | `dashboard_build.py` | Comments and print messages in Polish |
| T20 | `demon_dev.py` | Docstrings, help texts, print messages in Polish |

---

## 2. Logic & Correctness Issues

### 2.1 [CRITICAL] Sleep loop oversleeps ~1s per poll cycle

**File:** `src/tracker.rs:340-352`

The sleep chunk loop calculates `sleep_chunks = remain.as_secs_f32().ceil()` but always sleeps `Duration::from_secs(1)` per iteration — even in the final chunk. For `remain = 9.2s`, it sleeps 10 × 1s = 10s instead of 9.2s.

**Fix:** Recalculate remaining time each iteration:
```rust
for _ in 0..sleep_chunks {
    if stop_signal.load(Ordering::Relaxed) { break; }
    let remaining_now = poll_interval.saturating_sub(last_tracking_tick.elapsed());
    if remaining_now.is_zero() { break; }
    thread::sleep(Duration::from_secs(1).min(remaining_now));
}
```

### 2.2 [CRITICAL] `restore_database_from_file` copies WAL-mode DB without WAL/SHM files

**File:** `dashboard/src-tauri/src/commands/database.rs:135-158`

`fs::copy` on a WAL-mode SQLite database copies only the main `.db` file. Missing `-wal` and `-shm` files mean uncommitted WAL pages are lost, producing a silently corrupt backup.

**Fix:** Use `VACUUM INTO` instead of `fs::copy`, or checkpoint the WAL before copying.

### 2.3 [IMPORTANT] `get_session_count` uses different attribution logic than `get_sessions`

**File:** `dashboard/src-tauri/src/commands/sessions.rs:329-351`

`get_session_count` does a simple SQL `JOIN` with `OR`, while `get_sessions` uses Rust-side inference (`overlap_ms * 2 >= span_ms`). The two produce different counts for the same filters, causing mismatched pagination totals in the UI.

**Fix:** Unify the attribution logic — either move inference into SQL or compute count in Rust after filtering.

### 2.4 [IMPORTANT] `purge_unregistered_apps` runs outside the import transaction

**File:** `dashboard/src-tauri/src/commands/import.rs:283-353`

The purge runs after `tx.commit()`. If it fails midway, some apps lose `file_activities` but keep `sessions`, leaving an inconsistent state.

**Fix:** Run the purge inside the same transaction as the import.

### 2.5 [IMPORTANT] Daily file merge overwrites existing app data

**File:** `dashboard/src-tauri/src/commands/import_data.rs:264-303`

`existing_daily.apps.insert(exe, ...)` replaces the entire app entry. Local sessions added after the export was created are silently lost.

**Fix:** Merge session lists instead of replacing them.

### 2.6 [IMPORTANT] Missing null guard in `ManualSessionDialog`

**File:** `dashboard/src/components/ManualSessionDialog.tsx:93-98`

If `start.split("T")` doesn't produce two parts, `timeStr` is `undefined` and `.split(":")` throws a `TypeError`.

**Fix:**
```ts
const parts = start.split("T");
const dateStr = parts[0] ?? "";
const timeStr = parts[1] ?? "00:00";
```

### 2.7 [IMPORTANT] `DEFAULT_ONLINE_SYNC_SERVER_URL` points to legacy `cfabserver` endpoint

**File:** `dashboard/src/lib/online-sync.ts:11-15`

The exported default URL is the old `cfabserver-production.up.railway.app`. New installations will silently use the old server. If the TimeFlow server is the intended default, this needs updating.

---

## 3. Performance Issues

### 3.1 [IMPORTANT] N+1 DB connections in session suggestion loop

**File:** `dashboard/src-tauri/src/commands/sessions.rs:301-322`

For every session without a project, `suggest_project_for_session` opens a new SQLite connection and runs several queries sequentially. For 50 sessions, this means 50+ sequential DB round-trips.

**Fix:** Batch the suggestions — open one connection and process all sessions, or run in parallel with a connection pool.

### 3.2 [IMPORTANT] `renderProjectCard` recreated every render

**File:** `dashboard/src/pages/Projects.tsx:572`

Declared as a plain function inside the component. Every render creates a new function object and forces all cards to re-render.

**Fix:** Extract as a separate `<ProjectCard>` component outside `Projects`.

### 3.3 [MINOR] `today` recomputed every render

**File:** `dashboard/src/pages/Sessions.tsx:40`

```ts
const today = format(new Date(), "yyyy-MM-dd"); // every render
```

**Fix:** `const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);`

### 3.4 [MINOR] `fetchStatus` missing from `useEffect` deps

**File:** `dashboard/src/pages/AI.tsx:121-127`

The function captures hook state but isn't listed in deps. Wrap in `useCallback` and add to deps.

---

## 4. Redundant / Dead Code

### 4.1 Duplicate `if (result.files_imported > 0)` block

**File:** `dashboard/src/App.tsx:87-94`

The same condition is checked twice in a row. Merge into one block.

### 4.2 `hasTauriRuntime` defined in 3 places

**Files:**
- `dashboard/src/lib/tauri.ts:43-49` (canonical)
- `dashboard/src/components/layout/Sidebar.tsx:296-303` (copy)
- `dashboard/src/components/layout/TopBar.tsx:110-117` (copy)

**Fix:** Export from `lib/tauri.ts` and import in both layout components.

### 4.3 Duplicate comment in `TimeAnalysis.tsx`

**File:** `dashboard/src/pages/TimeAnalysis.tsx:49-50`

```tsx
{/* Pie chart — Project Time Distribution */}
{/* Pie chart — Project Time Distribution */}
```

Remove the duplicate line.

### 4.4 `if let Some(_) = project_id` — dead pattern

**File:** `dashboard/src-tauri/src/commands/export.rs:30`

**Fix:** Replace with `if project_id.is_some()`.

### 4.5 Duplicated `check_version_compatibility` in two crates

**Files:**
- `src/tracker.rs:25-38`
- `dashboard/src-tauri/src/commands/daemon.rs:212-234`

Same logic duplicated. Document or extract to shared module.

### 4.6 Duplicated patch logic in Python scripts

**Files:**
- `dashboard/update_filter.py` (has reusable `update_file()`)
- `dashboard/update_sessions_ts.py` (re-implements inline)

**Fix:** Share the helper.

---

## 5. Suggested Optimizations

### 5.1 Export success — no user feedback

**File:** `dashboard/src/components/data/ExportPanel.tsx:33-34`

After successful export, only `console.log` is called. The user receives no confirmation.

**Fix:** Show a toast notification with the saved file path.

### 5.2 `loadMonitored` in useEffect deps but never called

**File:** `dashboard/src/pages/Applications.tsx:49`

`loadMonitored` is listed as a dependency but is not invoked inside the effect. Remove from deps array.

### 5.3 Array index used as React `key`

**Files:**
- `dashboard/src/pages/ImportPage.tsx:47`
- `dashboard/src/components/data/DataHistory.tsx:74`

Use `f.file_path` as key instead of array index.

### 5.4 `catch (e: any)` — unsafe type annotations

**File:** `dashboard/src/components/data/DatabaseManagement.tsx:103+`

Multiple `catch (e: any)` blocks. Use `catch (e: unknown)` and `String(e)`.

### 5.5 `parseInt` without radix

**File:** `dashboard/src/components/data/DatabaseManagement.tsx:129`

**Fix:** `parseInt(val, 10)`

### 5.6 Python: crash on missing APPDATA

**Files:** `check_db_sizes.py`, `diag_db.py`, `query.py`, `test-query.py`

`os.environ.get('APPDATA')` returns `None` → `os.path.join(None, ...)` throws `TypeError`.

**Fix:** Add a `None` check with graceful error message.

### 5.7 Python: hardcoded user-specific paths

**File:** `get_stats.py:4-5, 32`

Paths hardcoded with `C:\Users\micz\...`. Use `os.environ['APPDATA']` and `Path(__file__).parent`.

### 5.8 Python: module-level `os.chdir()` side effect

**File:** `dashboard_build.py:16`

**Fix:** Pass `cwd=DASHBOARD` to `subprocess.run()` instead.

---

## 6. Summary Table

| # | Severity | Category | File | Description |
|---|----------|----------|------|-------------|
| T1-T9 | Critical | Translation | Various | Polish strings in user-facing UI (sidebar, settings, dialogs) |
| T10-T20 | Low-Med | Translation | Various | Polish strings in logs and build scripts |
| 2.1 | Critical | Logic | `src/tracker.rs` | Sleep loop oversleeps ~1s per cycle |
| 2.2 | Critical | Logic | `commands/database.rs` | WAL-mode DB copy without WAL/SHM files |
| 2.3 | Important | Logic | `commands/sessions.rs` | Mismatched count vs. list attribution logic |
| 2.4 | Important | Logic | `commands/import.rs` | Purge outside transaction — inconsistent state on failure |
| 2.5 | Important | Logic | `commands/import_data.rs` | Merge overwrites existing app data |
| 2.6 | Important | Logic | `ManualSessionDialog.tsx` | Missing null guard on datetime split |
| 2.7 | Important | Logic | `online-sync.ts` | Default sync URL points to legacy server |
| 3.1 | Important | Performance | `commands/sessions.rs` | N+1 DB connections in suggestion loop |
| 3.2 | Important | Performance | `Projects.tsx` | `renderProjectCard` recreated every render |
| 3.3 | Minor | Performance | `Sessions.tsx` | `today` recomputed every render |
| 3.4 | Minor | Performance | `AI.tsx` | `fetchStatus` missing from useEffect deps |
| 4.1 | Minor | Redundant | `App.tsx` | Duplicate `if` block |
| 4.2 | Important | Redundant | Sidebar/TopBar/tauri.ts | `hasTauriRuntime` defined 3 times |
| 4.3 | Minor | Redundant | `TimeAnalysis.tsx` | Duplicate comment |
| 4.4 | Minor | Redundant | `export.rs` | Dead `if let Some(_)` pattern |
| 4.5 | Minor | Redundant | tracker.rs + daemon.rs | Duplicated version check function |
| 5.1 | Important | UX | `ExportPanel.tsx` | No user feedback on export success |
| 5.2 | Minor | Code Quality | `Applications.tsx` | Unused dep in useEffect |
| 5.3 | Minor | Code Quality | ImportPage/DataHistory | Array index as React key |
| 5.4 | Minor | Code Quality | `DatabaseManagement.tsx` | `catch (e: any)` unsafe types |
| 5.5 | Minor | Code Quality | `DatabaseManagement.tsx` | `parseInt` without radix |
| 5.6 | Important | Robustness | Python scripts | Crash on missing APPDATA |
| 5.7 | Minor | Portability | `get_stats.py` | Hardcoded user-specific paths |
| 5.8 | Minor | Code Quality | `dashboard_build.py` | Module-level `os.chdir()` |

---

**Total issues found: 37**
- Critical: 5 (3 translation + 2 logic)
- Important: 15
- Minor: 17
