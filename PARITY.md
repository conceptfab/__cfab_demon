# TIMEFLOW - Platform Parity Tracker

| Funkcja | Windows | macOS | Status |
|---|---|---|---|
| `window_title` | WinAPI | CGWindowList | OK |
| `detected_path` | WMI | `None` | Task P2 |
| `measure_cpu_for_app` | OK | zwraca 0 | Task 3 |
| Tray i18n | `TrayText::*` | hardcoded EN | Task 17 |
| Tray sync status | OK | brak | Task 36 |
| Foreground detection | event | polling 250ms | Task 37 |
| Version mismatch dialog | MessageBox | tylko log | Task 65 |
