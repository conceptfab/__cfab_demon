# TIMEFLOW — Audyt tooltipów UI

## Legenda

| Symbol | Znaczenie |
|--------|-----------|
| ✅ | Tooltip istnieje, przetłumaczony PL + EN |
| ⚠️ | Tooltip istnieje, ale tylko po angielsku (brak tłumaczenia PL) |
| ❌ | Brak tooltipa — element wymaga dodania |

---

## 1. TopBar (okno aplikacji)

| Element | PL | EN | Status |
|---------|----|----|--------|
| Minimize | `aria-label` → "Minimalizuj okno" | "Minimize window" | ✅ |
| Maximize | `aria-label` → "Maksymalizuj okno" | "Maximize window" | ✅ |
| Restore | `aria-label` → "Przywróć okno" | "Restore window" | ✅ |
| Close | `aria-label` → "Zamknij okno" | "Close window" | ✅ |

> **Uwaga:** Używają tylko `aria-label` (niedostępne wizualnie). Brak natywnego `title` — wizualny tooltip nie pojawia się po najechaniu.

---

## 2. Sidebar — nawigacja

| Element | PL | EN | Status |
|---------|----|----|--------|
| Pozycje menu (Dashboard, Sessions…) | Tekst widoczny w expanded; `title` w collapsed | j.w. | ✅ |
| Badge sesji (unassigned) | "X nieprzypisanych sesji dzisiaj" | "X unassigned sessions today" | ✅ |
| Badge sesji (all dates) | "X nieprzypisanych sesji (cały okres)" | "X unassigned sessions (all dates)" | ✅ |

---

## 3. Sidebar — statusy i akcje dolne

| Element | PL | EN | Status |
|---------|----|----|--------|
| Daemon status | brak tooltip / szczegółu | brak | ❌ |
| Sync status | dynamiczny `title` z `syncIndicator.detail` | j.w. | ✅ |
| AI — nowe przypisania | "X nowych przypisań od ostatniego treningu" | "X new assignments since last training" | ✅ |
| Backup indicator | "Ostatnia kopia: DATA" / "Nigdy" | "Last backup: DATE" / "Never" | ✅ |
| Version incompatibility | "NIEZGODNOŚĆ WERSJI! Demon: vX" | "VERSION INCOMPATIBILITY! Daemon: vX" | ✅ |
| BugHunter | "BugHunter - zgłoś błąd" | "BugHunter - report a bug" | ✅ |
| Quick Start | "Quick Start" | "Quick Start" | ⚠️ PL nie przetłumaczony (zostawiony "Quick Start") |
| Help | "Pomoc (F1)" | "Help (F1)" | ✅ |
| Settings | "Ustawienia" | "Settings" | ✅ |

---

## 4. Dashboard

| Element | PL | EN | Status |
|---------|----|----|--------|
| MetricCard: Total tracked | tytuł widoczny | j.w. | ✅ (tekst, nie tooltip) |
| MetricCard: Applications | j.w. | j.w. | ✅ |
| MetricCard: Projects | j.w. | j.w. | ✅ |
| MetricCard: Avg daily | j.w. | j.w. | ✅ |
| Top Projects — click to view | "Kliknij, aby zobaczyć: X" | "Click to view: X" | ✅ |
| Top Projects — progress bar | dynamiczny title | j.w. | ✅ |
| AllProjectsChart — chart tooltip | "Czas" | "Time" | ✅ |

### ProjectDayTimeline (Dashboard)

| Element | PL | EN | Status |
|---------|----|----|--------|
| Sort by time | "Sortuj po czasie" | "Sort by time" | ✅ |
| Sort alphabetically | "Sortuj alfabetycznie" | "Sort alphabetically" | ✅ |
| Save view toggle | — | "Saved view enabled/disabled" | ⚠️ Tylko EN |
| Project name (truncated) | `title={row.name}` | j.w. | ✅ (natywny overflow) |
| Boosted sessions badge | — | "X boosted session(s)" | ⚠️ Tylko EN |
| Working hours indicator | — | "Working hours: X" | ⚠️ Tylko EN |
| Timeline segment (hover) | — | dynamiczny tytuł (czas, rate, suggestion) | ⚠️ Tylko EN |
| Cluster detail name | `title` (overflow) | j.w. | ✅ |

---

## 5. Sessions

| Element | PL | EN | Status |
|---------|----|----|--------|
| ◀ Prev period button | brak title | brak | ❌ |
| ▶ Next period button | brak title | brak | ❌ |
| View mode: AI Data | tekst widoczny, brak tooltip | j.w. | ✅ (tekst) |
| View mode: Detailed | j.w. | j.w. | ✅ (tekst) |
| View mode: Compact | j.w. | j.w. | ✅ (tekst) |
| Session row — app name | `title={s.app_name}` | j.w. | ✅ (overflow) |

---

## 6. Projects

| Element | PL | EN | Status |
|---------|----|----|--------|
| Project name (truncated) | `title={p.name}` | j.w. | ✅ |
| Frozen badge | "Zamrożony od X — kliknij, aby odmrozić" | "Frozen since X — click to unfreeze" | ✅ |
| Hot project badge | "Gorący projekt" | "Hot project" | ✅ |
| Change color button | "Zmień kolor" | "Change color" | ✅ |
| Choose color swatch | "Wybierz kolor" | "Choose color" | ✅ |
| Reset time button | "Resetuj czas" | "Reset time" | ✅ |
| Toggle archive/unarchive | "Archiwizuj projekt" / "Przywróć projekt" | "Archive project" / "Unarchive project" | ✅ |
| Exclude project | "Wyklucz projekt" | "Exclude project" | ✅ |
| Delete project permanently | "Usuń projekt na stałe" | "Delete project permanently" | ✅ |
| Manual sessions count | — | "Manual sessions: X" | ⚠️ Tylko EN |
| Comments count | "Komentarze X" | "Comments X" | ✅ |
| Save view as default | "Zapisz widok jako domyślny" | "Save view as default" | ✅ |
| Root path (truncated) | `title={path}` | j.w. | ✅ (overflow) |
| Remove folder button | — | "Remove folder" | ⚠️ Tylko EN |
| File name (truncated) | `title={file_name}` | j.w. | ✅ (overflow) |

---

## 7. ProjectPage (szczegóły projektu)

| Element | PL | EN | Status |
|---------|----|----|--------|
| Change color | "Zmień kolor" | "Change color" | ✅ |
| Choose color swatch | "Wybierz kolor" | "Choose color" | ✅ |
| Assigned folder path | `title={path}` | j.w. | ✅ (overflow) |
| File name (truncated) | `title={file_name}` | j.w. | ✅ (overflow) |

---

## 8. Applications

| Element | PL | EN | Status |
|---------|----|----|--------|
| Rename monitored app | "Zmień nazwę monitorowanej aplikacji" | "Rename monitored application" | ✅ |
| Remove monitored app | "Usuń monitorowaną aplikację" | "Remove monitored application" | ✅ |
| Change color (swatch) | "Zmień kolor" / "Wybierz kolor" | "Change color" / "Choose color" | ✅ |
| Rename application | "Zmień nazwę aplikacji" | "Rename application" | ✅ |
| Reset time | "Resetuj czas" | "Reset time" | ✅ |
| Delete app and sessions | "Usuń aplikację i sesje" | "Delete app and sessions" | ✅ |

---

## 9. Estimates

| Element | PL | EN | Status |
|---------|----|----|--------|
| MetricCard: Total Hours | "Łączne godziny" | "Total Hours" | ✅ |
| MetricCard: Estimated Value | "Wartość estymowana" | "Estimated Value" | ✅ |
| MetricCard: Active Projects | "Aktywne projekty" | "Active Projects" | ✅ |
| MetricCard: Rate Overrides | "Nadpisane stawki" | "Rate Overrides" | ✅ |
| Project name (truncated) | `title={row.project_name}` | j.w. | ✅ (overflow) |
| Rate override tooltip | dynamiczny title | j.w. | ✅ |

---

## 10. Time Analysis

| Element | PL | EN | Status |
|---------|----|----|--------|
| ◀ Previous period | "Poprzedni okres" | "Previous period" | ✅ |
| ▶ Next period | "Następny okres" | "Next period" | ✅ |
| DailyView — bar segment | dynamiczny title (projekt: czas) | j.w. | ✅ |
| Chart tooltips (Recharts) | formatowane wartości | j.w. | ✅ |

---

## 11. DateRangeToolbar (współdzielony komponent)

| Element | PL | EN | Status |
|---------|----|----|--------|
| ◀ Previous period | przetłumaczony klucz `date_range_toolbar.previous_period` | j.w. | ✅ |
| ▶ Next period | przetłumaczony klucz `date_range_toolbar.next_period` | j.w. | ✅ |

---

## 12. Settings

| Element | PL | EN | Status |
|---------|----|----|--------|
| Merge gap input | `aria-label` "Przerwa scalania w minutach" | "Merge gap in minutes" | ✅ (aria-label) |
| Min session duration input | `aria-label` "Minimalna długość sesji w sekundach" | "Minimum session duration in seconds" | ✅ (aria-label) |
| Token visibility toggle | "Ukryj token" / "Pokaż token" | "Hide token" / "Show token" | ✅ |
| Freeze threshold input | `aria-label` "Próg zamrożenia w dniach" | "Freeze threshold in days" | ✅ (aria-label) |

---

## 13. Data — DatabaseManagement

| Element | PL | EN | Status |
|---------|----|----|--------|
| Save optimize interval (💾) | brak title | brak | ❌ |
| Save backup interval (💾) | brak title | brak | ❌ |

---

## 14. Data — DataHistory

| Element | PL | EN | Status |
|---------|----|----|--------|
| File path (truncated) | `title={file_path}` | j.w. | ✅ (overflow) |
| Delete archive button (🗑) | brak title | brak | ❌ |

---

## 15. Data — ImportPage

| Element | PL | EN | Status |
|---------|----|----|--------|
| Delete from archive | "Usuń z archiwum" | "Delete from archive" | ✅ |

---

## 16. DaemonControl

| Element | PL | EN | Status |
|---------|----|----|--------|
| Daemon version badge | dynamiczny (title) | j.w. | ✅ |
| Exe path (truncated) | `title={exe_path}` | j.w. | ✅ (overflow) |

---

## Podsumowanie

### Zrealizowane zmiany

**Migracja na Radix Tooltip (AppTooltip)**
- Utworzono wrapper `AppTooltip` (`components/ui/app-tooltip.tsx`)
- Zmigrowano ~40 elementów z natywnego `title` na `AppTooltip` w 15 plikach
- Dodano brakujące tooltips (Sessions nav, DatabaseManagement save buttons, DataHistory delete)
- Przetłumaczono hardcoded EN stringi na i18n PL/EN (ProjectDayTimeline, Projects)
- Dodano wizualne tooltips do TopBar (minimize/maximize/close)
- Build: OK

### Elementy pozostawione z natywnym `title`
- Truncated text (overflow): `title={p.name}`, `title={file_path}` — informacyjne, nie akcyjne
- Working hours indicator na `pointer-events-none` div — Radix tooltip nie zadziałałby
- Timeline segment tooltips — złożone dynamiczne stringi, natywny title jest tu wystarczający
- Chart tooltips (Recharts) — osobny system
