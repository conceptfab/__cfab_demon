# TIMEFLOW — Raport z analizy kodu

> Data: 2026-03-10
> Zakres: cały codebase (daemon Rust + dashboard React/Tauri)
> Analiza: poprawność logiki, wydajność, optymalizacje, nadmiarowy kod, brakujące tłumaczenia, pokrycie Help

---

## Spis treści

1. [Problemy krytyczne](#1-problemy-krytyczne)
2. [Wydajność i optymalizacje](#2-wydajność-i-optymalizacje)
3. [Poprawność logiki](#3-poprawność-logiki)
4. [Nadmiarowy i zduplikowany kod](#4-nadmiarowy-i-zduplikowany-kod)
5. [Brakujące tłumaczenia](#5-brakujące-tłumaczenia)
6. [Pokrycie Help.tsx](#6-pokrycie-helptsx)
7. [Jakość kodu — code smells](#7-jakość-kodu--code-smells)
8. [Build i zależności](#8-build-i-zależności)
9. [Podsumowanie priorytetów](#9-podsumowanie-priorytetów)

---

## Status prac

- [x] `1.2` `unwrap()` na `Mutex` w `src/tray.rs` zastąpiony bezpiecznym odzyskaniem locka; dodane też nazwane okno double-click.
- [x] `1.3` Startup sync respektuje `enabled` już w warstwie UI job pool; doprecyzowany opis w Help/Settings.
- [x] `2.2` Polling `checkFileChange` spowolniony z `5s` do `30s`.
- [x] `2.4` Dashboard nie przeładowuje wszystkich danych tylko dlatego, że zmienił się język UI.
- [x] `3.3` `ReportView` nie trzyma już stale memoizowanej daty wygenerowania.
- [x] `3.4` `DaemonControl` nie wykonuje zbędnego `refresh()` przy wyłączeniu auto-refresh.
- [x] `3.6` `App.tsx` nie subskrybuje już całego `currentPage`, tylko pochodny boolean dla `showChrome`.
- [x] `4.2` Usunięta duplikacja `isSessionAlreadySplit` na rzecz współdzielonego helpera.
- [x] `5.1` Hardkodowane błędy widoczne w UI w `Projects`, `Settings` i `CreateProjectDialog` zostały przepięte na tłumaczenia.
- [x] Weryfikacja techniczna: `cargo check`, `cargo check --manifest-path dashboard/src-tauri/Cargo.toml`, `dashboard/npm run lint`, `dashboard/npm run typecheck`, `dashboard/npm run test`.
- [x] `1.1` Dashboard używa teraz jednego endpointu `get_dashboard_data` dla statystyk, top projektów, listy projektów do wykresu i timeline, więc ciężka agregacja nie leci już 4× przy jednym ładowaniu widoku.
- [x] `8.1` Nieużywana zależność `sysinfo` usunięta z demona.

---

## 1. Problemy krytyczne

### 1.1 `compute_project_activity_unique` wywoływane 4× na tych samych danych
- **Pliki:** `dashboard/src-tauri/src/commands/dashboard.rs` (linie 18, 225, 264, 311)
- **Opis:** `get_dashboard_stats`, `get_top_projects`, `get_dashboard_projects` i `get_timeline` — wszystkie 4 komendy wywołują `compute_project_activity_unique` niezależnie. Dashboard woła je równocześnie (`Promise.allSettled`), więc ta sama ciężka operacja jest wykonywana 4 razy na tych samych danych.
- **Rozwiązanie:** Stworzyć jeden endpoint `get_dashboard_data`, który wykona obliczenia raz i zwróci wszystkie potrzebne dane w jednej odpowiedzi.

### 1.2 `unwrap()` na Mutex lock w tray.rs
- **Plik:** `src/tray.rs`, linia 203
- **Opis:** `last_tray_click_clone.lock().unwrap()` — może spowodować panic jeśli mutex zostanie "poisoned" (np. panic w innym miejscu trzymającym lock).
- **Rozwiązanie:** Użyć `unwrap_or_else(|e| e.into_inner())` jak w loggerze (main.rs:156-158).

### 1.3 Startup sync ignoruje flagę `enabled`
- **Plik:** `dashboard/src/components/sync/BackgroundServices.tsx`, linia 483-486
- **Opis:** `runSync('startup', false)` — `isAuto=false` pomija sprawdzenie `settings.enabled`. Sync startupowy uruchomi się nawet jeśli sync jest wyłączony w ustawieniach.
- **Rozwiązanie:** Sprawdzić `settings.enabled` przed wywołaniem sync startupowego.

---

## 2. Wydajność i optymalizacje

### 2.1 [WYSOKI] 6+ aktywnych setInterval jednocześnie
- Job Pool tick: 5s (`BackgroundServices.tsx`)
- `checkFileChange`: co 5s
- `runRefresh`: co 60s
- Auto-split sessions: co 60s
- Sidebar: co 10s (status demona + unassigned sessions)
- Sessions: auto-refresh co 15s
- AI: refresh co 30s
- DaemonControl: refresh co 5s
- DataHistory: refresh co 60s

**Rozwiązanie:** Scentralizować polling w jednym job pool i udostępniać dane przez store (Zustand), zamiast każdej stronie mieć własny polling.

### 2.2 [WYSOKI] `checkFileChange` co 5s vs daemon zapisuje co 5 minut
- **Plik:** `BackgroundServices.tsx`, linia 393
- **Opis:** `getTodayFileSignature()` jest wywoływane co 5 sekund. Demon zapisuje dane co 300s.
- **Rozwiązanie:** Zwiększyć interwał do 30-60s.

### 2.3 [WYSOKI] Brak cache na `getProjects()`
- **Plik:** `Dashboard.tsx`, linia 321
- **Opis:** Lista projektów zmienia się rzadko, ale ładowana jest przy każdym refresh (co 60s + manual + zmiana danych).
- **Rozwiązanie:** Cache w Zustand store z invalidacją tylko po mutacjach projektów.

### 2.4 [WYSOKI] `t` w tablicy zależności useEffect w Dashboard
- **Plik:** `Dashboard.tsx`, linia 422-429
- **Opis:** Funkcja `t` z `useTranslation()` jest w tablicy zależności głównego useEffect ładującego dane. Zmiana języka powoduje ponowne załadowanie 7 równoczesnych zapytań API.
- **Rozwiązanie:** Usunąć `t` z dependency array — nie wpływa na zapytania API.

### 2.5 [ŚREDNI] Nowe połączenie SQLite per komendę Tauri
- **Plik:** `db.rs`, linia 403 + `helpers.rs`, linia 64
- **Opis:** Każde wywołanie komendy Tauri tworzy nowe połączenie SQLite. Przy 4 równoczesnych komendach z dashboardu = 4 nowe połączenia.
- **Rozwiązanie:** Pula połączeń lub jedno współdzielone połączenie za Mutex.

### 2.6 [ŚREDNI] N+1 pattern w `load_range_snapshots`
- **Plik:** `daily_store.rs`, linie 416-442
- **Opis:** Dla zakresu 30 dni: 1 + 3×30 = 91 zapytań SQL.
- **Rozwiązanie:** 3-4 zapytania z `WHERE date BETWEEN ? AND ?`.

### 2.7 [ŚREDNI] DELETE + INSERT zamiast UPDATE w daily store
- **Plik:** `daily_store.rs`, linia 161
- **Opis:** `DELETE FROM daily_snapshots WHERE date = ?1` kasuje kaskadowo apps/sessions/files, po czym wstawia od nowa.
- **Rozwiązanie:** Chirurgiczny UPDATE zmienonych rekordów.

### 2.8 [ŚREDNI] `build_process_snapshot` — pełny snapshot co 10s
- **Plik:** `tracker.rs:337`, `monitor.rs:653`
- **Opis:** `CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS)` iteruje przez WSZYSTKIE procesy systemu co 10s.
- **Rozwiązanie:** Zwiększyć interwał do 30s dla background apps; foreground tracking nie wymaga pełnego snapshotu.

### 2.9 [NISKI] `ensure_schema()` przy każdej operacji
- **Plik:** `daily_store.rs`, linie 86, 137, 277
- **Opis:** `CREATE TABLE IF NOT EXISTS...` wykonywane przy każdym `load_day_snapshot` i `replace_day_snapshot`.
- **Rozwiązanie:** Wywoływać raz przy otwarciu połączenia.

### 2.10 [NISKI] Zbędny indeks na PRIMARY KEY
- **Plik:** `daily_store.rs`, linia 127
- **Opis:** `CREATE INDEX idx_daily_snapshots_date ON daily_snapshots(date)` — `date` jest już PRIMARY KEY.
- **Rozwiązanie:** Usunąć zbędny indeks.

### 2.11 [NISKI] `classify_activity_type` alokuje String
- **Plik:** `monitor.rs`, linie 504-553
- **Opis:** Zwraca `Option<String>` zamiast `Option<&'static str>`.
- **Rozwiązanie:** Zmienić na `&'static str` — eliminacja alokacji.

---

## 3. Poprawność logiki

### 3.1 Niespójność `duration_seconds` vs `end - start` w sesji
- **Plik:** `src/tracker.rs`, linie 153-154
- **Opis:** Gdy sesja jest kontynuowana, `duration_seconds` zwiększane jest o `poll_interval`, ale `end` ustawiany na `now_str` (czas zegara). Jeśli sleep trwał dłużej niż `poll_interval`, pola `end - start` i `duration_seconds` mogą się różnić.

### 3.2 Ignorowanie okien bez tytułu
- **Plik:** `src/monitor.rs`, linia 155
- **Opis:** `get_foreground_info()` zwraca `None` dla okien bez tytułu. Niektóre aplikacje (np. full-screen games, renderery) mają puste tytuły — czas pracy w nich nie jest zliczany.

### 3.3 `ReportView` — `generatedAt` memoizowane bez deps
- **Plik:** `ReportView.tsx`, linia 34
- **Opis:** `useMemo(() => format(new Date(), 'yyyy-MM-dd HH:mm'), [])` — data jest ustawiana raz na cały cykl życia komponentu. Jeśli użytkownik wróci następnego dnia, data będzie stara.

### 3.4 `DaemonControl` — zbędny `refresh()` przy wyłączeniu auto-refresh
- **Plik:** `DaemonControl.tsx`, linia 86-91
- **Opis:** Gdy `autoRefresh` zmieni się z `true` na `false`, `refresh()` w useEffect nadal zostaje wywołane niepotrzebnie.

### 3.5 Brak ostrzeżenia o niezapisanych zmianach w Settings
- **Plik:** `Settings.tsx`
- **Opis:** Flaga `savedSettings` jest resetowana przy każdej indywidualnej zmianie. Użytkownik może wyjść ze strony bez zapisu, tracąc zmiany — brak dialogu "unsaved changes".

### 3.6 `App.tsx` — podwójne subskrybowanie `currentPage`
- **Plik:** `App.tsx`, linie 62 i 155
- **Opis:** `currentPage` odczytywane zarówno w `PageRouter` jak i w `App`. Powoduje re-render całego `App` przy każdej zmianie strony.
- **Rozwiązanie:** Zmienić selector w App na `useUIStore(s => s.currentPage !== 'report-view')`.

---

## 4. Nadmiarowy i zduplikowany kod

### 4.1 Zduplikowana `renderDuration()` vs `formatDuration()`
- **Pliki:** `Projects.tsx:166` vs `lib/utils.ts:10`
- **Opis:** Identyczna logika obliczenia `Math.floor(seconds / 3600)` i `Math.floor((seconds % 3600) / 60)`. Różnica: JSX vs string.
- **Rozwiązanie:** Wydzielić wspólną logikę obliczeniową.

### 4.2 Zduplikowana `isSessionAlreadySplit`
- **Pliki:** `BackgroundServices.tsx:61-65` vs `session-analysis.ts:10-13`
- **Opis:** Identyczna funkcja w dwóch miejscach.
- **Rozwiązanie:** `BackgroundServices.tsx` powinno importować z `session-analysis.ts`.

### 4.3 Duplikacja process snapshot (Rust)
- **Pliki:** `tray.rs:289-327` vs `monitor.rs:653-687`
- **Opis:** Niemal identyczny kod iterowania procesów przez `CreateToolhelp32Snapshot`.
- **Rozwiązanie:** Wydzielić do `process_utils.rs`.

### 4.4 Nadmiarowy stan `projectCount`
- **Plik:** `Dashboard.tsx`, linie 188, 192, 368-369
- **Opis:** `projectCount` to zawsze `projectsList.length`. Zbędny dodatkowy useState.

### 4.5 `getProjects()` wołany niezależnie w 7 miejscach
- **Pliki:** Dashboard, ProjectPage, Projects, Sessions, useTimeAnalysisData, DataStats, ExportPanel
- **Opis:** Każde miejsce: `getProjects().then(set).catch(console.error)`.
- **Rozwiązanie:** Scentralizować w Zustand store lub shared hook.

### 4.6 40+ powtórzonych `console.error('Failed to ...')`
- **Rozwiązanie:** Scentralizować w helperze `logTauriError(context, error)`.

### 4.7 Powtórzona walidacja boost/multiplier
- **Pliki:** `Sessions.tsx:820,892` vs `ProjectPage.tsx:561`
- **Opis:** Logika walidacji boost comment i rate multiplier niemal identyczna.
- **Rozwiązanie:** Przenieść do `useSessionActions` hook.

### 4.8 Settings — własny toast z `setTimeout` zamiast `useToast`
- **Plik:** `Settings.tsx`, linie 80-83, 261-263
- **Opis:** Niespójność z resztą aplikacji, która używa dedykowanego systemu `useToast`.

---

## 5. Brakujące tłumaczenia

### 5.1 Hardkodowane angielskie stringi widoczne dla użytkownika

| Plik | Linia | Hardkodowany tekst |
|------|-------|--------------------|
| `Projects.tsx` | 430 | `'Failed to load project folders'` |
| `Projects.tsx` | 544 | `'Unknown error'` |
| `Projects.tsx` | 573 | `'Unknown error'` |
| `Projects.tsx` | 605 | `'Failed to add folder'` |
| `Settings.tsx` | 286 | `'Unknown error'` |
| `Settings.tsx` | 304 | `'Unknown error'` |
| `Settings.tsx` | 344 | `'Unknown error'` |
| `Settings.tsx` | 365 | `'Unknown error'` |
| `CreateProjectDialog.tsx` | 77 | `'Failed to create project'` |

Wszystkie te stringi są przekazywane do `showError()` / `setFolderError()` i widoczne w UI. Powinny używać `t('klucz')`.

### 5.2 Niespójność języka w logach Rust daemon
- `config.rs` — komunikaty po polsku: `"Brak zmiennej APPDATA"`, `"Nie mozna otworzyc DB dashboardu"`
- `tracker.rs`, `monitor.rs` — komunikaty po angielsku
- Logi nie są widoczne dla użytkownika, ale niespójność utrudnia debugging.

---

## 6. Pokrycie Help.tsx

### Strony/widoki w aplikacji vs dokumentacja Help

| Strona | Identyfikator | Udokumentowana w Help? |
|--------|---------------|------------------------|
| Dashboard | `dashboard` | Tak — osobny tab |
| Sessions | `sessions` | Tak — osobny tab |
| Projects | `projects` | Tak — osobny tab |
| ProjectPage | `project-card` | Częściowo — wspomniana w "Projects", brak osobnego tabu |
| Estimates | `estimates` | Tak — osobny tab |
| Applications | `applications` | Tak — osobny tab |
| TimeAnalysis | `analysis` | Tak — osobny tab |
| AI | `ai` | Tak — osobny tab |
| Data | `data` | Tak — osobny tab |
| ImportPage | `import` | Częściowo — wspomniana w "Data" |
| Reports | `reports` | Tak — osobny tab |
| ReportView | `report-view` | Częściowo — wspomniana w "Reports" |
| DaemonControl | `daemon` | Tak — osobny tab |
| Settings | `settings` | Tak — osobny tab |
| Help | `help` | N/A |
| QuickStart | `quickstart` | Tak — osobny tab |

### Funkcjonalności z niepełną dokumentacją

1. **ProjectPage** — rozbudowany widok z timeline, komentarzami, sesjami manualnymi, raportami. Wspomniany jedynie jako element sekcji "Projects". Przy obecnej złożoności zasługuje na osobną sekcję.

2. **BugHunter** — wspomniany w Settings (`bughunter_the_bug_icon`), ale brak opisu jak działa formularz zgłaszania błędu.

3. **ManualSessionDialog** — wspólny komponent używany w wielu miejscach. Wspomniany w Sessions i Projects, ale brak spójnego opisu reguł walidacji (daty, cross-midnight sessions).

4. **Online Sync** — długo opisany w Settings, ale brak procedury pierwszej konfiguracji krok po kroku (co wpisać, skąd wziąć token).

---

## 7. Jakość kodu — code smells

### 7.1 Parameter sprawl: `record_app_activity` — 12 parametrów
- **Plik:** `src/tracker.rs`, linia 110-122
- **Rozwiązanie:** Struct `ActivityContext` grupujący powiązane parametry.

### 7.2 Stringly-typed activity types
- **Plik:** `src/monitor.rs`, linia 504-553
- **Opis:** `classify_activity_type` zwraca `Option<String>` z wartościami "coding", "browsing", "design". Te same stringi porównywane w `should_detect_path_for_activity` (linia 228-229).
- **Rozwiązanie:** Enum `ActivityType`.

### 7.3 Zbyt duże komponenty
- `Sessions.tsx` — ~2000+ linii
- `Projects.tsx` — ~2000+ linii
- `ProjectPage.tsx` — ~1800+ linii
- **Rozwiązanie:** Podzielić na mniejsze podkomponenty.

### 7.4 Settings — >20 stanów w jednym komponencie
- **Rozwiązanie:** Wydzielić grupy ustawień (working hours, session, freeze, currency, language, appearance, split, online sync, demo mode) do oddzielnych hooków/komponentów.

### 7.5 `tauri.ts` — 80+ flat exports
- **Rozwiązanie:** Pogrupować w moduły/obiekty (projects, sessions, daemon, data, ai).

### 7.6 `AI.tsx` — `showErrorRef` i `translateRef`
- **Plik:** `AI.tsx`, linie 169-170, 220-226
- **Opis:** `useRef` do przechowywania `showError` i `tr` z synchronizacją przez `useEffect` — nieelegancki wzorzec.

### 7.7 `useJobPool` — 210 linii w jednym hooku
- **Plik:** `BackgroundServices.tsx`, linia 277-487
- **Opis:** Zarządza wieloma timers/refs/intervals. Logika sync, refresh, file-signature-check powinna być rozdzielona.

### 7.8 Magic numbers
- `tray.rs:203` — `500` ms dla double-click bez nazwanej stałej
- `monitor.rs:34` — `WMI_PATH_LOOKUP_BATCH_LIMIT = 16` bez uzasadnienia

### 7.9 Mutex dla `action` w tray (single-threaded context)
- **Plik:** `src/tray.rs`, linie 181, 261, 286
- **Opis:** `Arc<Mutex<TrayExitAction>>` mimo single-threaded NWG event loop.
- **Rozwiązanie:** `Rc<Cell<TrayExitAction>>` byłoby prostsze.

---

## 8. Build i zależności

### 8.1 [WYSOKI] Nieużywana zależność `sysinfo`
- **Plik:** `Cargo.toml`, linia 31
- **Opis:** `sysinfo = "0.13"` — grep `use sysinfo` w `src/` zwraca 0 wyników. Cała detekcja procesów oparta na WinAPI. Ciężka zależność (długa kompilacja).
- **Rozwiązanie:** Usunąć.

### 8.2 [NISKI] `lettre` w dashboard Cargo.toml
- **Plik:** `dashboard/src-tauri/Cargo.toml`, linia 31
- **Opis:** Email client (SMTP) — sprawdzić czy nie można użyć prostszego HTTP endpointu.

### 8.3 [NISKI] `opt-level = "s"` w dashboard
- **Opis:** Dla dashboardu (nie dystrybuowanego jako mały plik) można rozważyć `opt-level = 2` dla lepszej wydajności runtime.

---

## 9. Podsumowanie priorytetów

### Krytyczne (natychmiastowa naprawa)
| # | Problem | Wpływ |
|---|---------|-------|
| 1 | `compute_project_activity_unique` 4× na tych samych danych | Każdy load dashboardu — podwójne/poczwórne obciążenie |
| 2 | `unwrap()` na Mutex w tray.rs | Potencjalny panic w produkcji |
| 3 | Startup sync ignoruje flagę `enabled` | Niechciany sync przy starcie |

### Wysokie (następna iteracja)
| # | Problem | Wpływ |
|---|---------|-------|
| 4 | 6+ aktywnych setInterval jednocześnie | Nadmierny CPU/IPC |
| 5 | `checkFileChange` co 5s (daemon zapisuje co 5min) | Zbędne IPC |
| 6 | Nieużywana zależność `sysinfo` | Czas kompilacji |
| 7 | `t` w dependency array useEffect w Dashboard | Zbędny reload 7 zapytań przy zmianie języka |
| 8 | 9 hardkodowanych angielskich stringów w UI | Użytkownik widzi angielski tekst |
| 9 | Brak cache na `getProjects()` | Zbędne zapytania |

### Średnie (planowana poprawa)
| # | Problem | Wpływ |
|---|---------|-------|
| 10 | Nowe połączenie SQLite per komendę | Overhead per IPC |
| 11 | N+1 w `load_range_snapshots` | Wolne ładowanie zakresu dat |
| 12 | Duplikacja process snapshot (tray/monitor) | Maintainability |
| 13 | Duplikacja `isSessionAlreadySplit` | Maintainability |
| 14 | `renderDuration()` vs `formatDuration()` | Maintainability |
| 15 | Parameter sprawl 12 args w `record_app_activity` | Czytelność |
| 16 | Brak ostrzeżenia "unsaved changes" w Settings | UX |
| 17 | ProjectPage bez dedykowanej sekcji Help | Dokumentacja |

### Niskie (przy okazji)
| # | Problem | Wpływ |
|---|---------|-------|
| 18 | Stringly-typed activity types | Type safety |
| 19 | Zbyt duże komponenty (2000+ linii) | Maintainability |
| 20 | Settings >20 useState | Czytelność |
| 21 | `ensure_schema` przy każdej operacji | Drobne koszty SQL |
| 22 | Zbędny indeks na PK `daily_snapshots(date)` | Marginalne |
| 23 | Niespójność języka logów w Rust | Debugging |
| 24 | `tauri.ts` 80+ flat exports | Organizacja kodu |
