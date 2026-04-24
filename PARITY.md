# TIMEFLOW - Platform Parity Tracker

| Funkcja | Windows | macOS | Status |
|---|---|---|---|
| `window_title` | WinAPI | CGWindowList | OK |
| `detected_path` | WMI | `None` | Task P2 |
| `measure_cpu_for_app` | OK | libproc delta | OK |
| Tray i18n | `TrayText::*` | `TrayText::*` | OK |
| Tray sync status | OK | brak | Task 36 |
| Foreground detection | event | polling 250ms | Task 37 |
| Version mismatch dialog | MessageBox | tylko log | Task 65 |
