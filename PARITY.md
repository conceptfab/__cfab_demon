# TIMEFLOW — Platform Parity Tracker

Tracker for features that behave differently on Windows and macOS.
Linked from [`CLAUDE.md`](./CLAUDE.md). Keep this table in sync with
the codebase — if a row here is stale, the task is not done.

| Funkcja | Windows | macOS | Status |
|---|---|---|---|
| `window_title` | WinAPI `GetWindowTextW` | `CGWindowListCopyWindowInfo` | ✅ parity |
| `measure_cpu_for_app` | `GetProcessTimes` FILETIME delta | `libproc proc_pidinfo()` delta | ✅ parity |
| Tray i18n | `TrayText::*` | `TrayText::*` | ✅ parity |
| Version mismatch dialog | WinAPI `MessageBox` | `osascript` `display dialog` | ✅ parity |
| `detected_path` | WMI | `None` (stub) | ❌ macOS stub — Task (P2) |
| Tray sync status + attention counter | `update_tray_appearance`, `was_syncing`, `menu_sync_status`, tooltip from `query_unassigned_attention_count` | ❌ stub | ❌ macOS stub — Task 36 |
| Foreground detection | `SetWinEventHook` (event-driven) | 250 ms polling loop | ⚠️ macOS degraded — Task 37 (target: `NSWorkspace.didActivateApplicationNotification`) |

Legend: ✅ both platforms on par · ⚠️ works but degraded · ❌ missing
implementation on one side.
