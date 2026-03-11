# TIMEFLOW — Raport z analizy kodu

> Data: 2026-03-10
> Status aktualizacji: 2026-03-11
> Zakres: cały codebase (daemon Rust + dashboard React/Tauri)
> Analiza: poprawność logiki, wydajność, optymalizacje, nadmiarowy kod, brakujące tłumaczenia, pokrycie Help

---

## Spis treści

1. `4.3` jako najwiekszy otwarty duplikat po stronie Rust.
2. `4.6` i `4.7` jako kolejne porzadki w dashboardzie bez zmiany architektury.
3. `5.2` oraz punkty z sekcji 7 jako dalsze ujednolicanie jakosci i utrzymania kodu.
4. [Nadmiarowy i zduplikowany kod](#4-nadmiarowy-i-zduplikowany-kod)
5. [Brakujące tłumaczenia](#5-brakujące-tłumaczenia)
6. [Pokrycie Help.tsx](#6-pokrycie-helptsx)
7. [Jakość kodu — code smells](#7-jakość-kodu--code-smells)
8. [Build i zależności](#8-build-i-zależności)
9. [Podsumowanie priorytetów](#9-podsumowanie-priorytetów)

---

## Status prac

- [x] `1.1` Dashboard używa teraz jednego endpointu `get_dashboard_data` dla statystyk, top projektów, listy projektów do wykresu i timeline, więc ciężka agregacja nie leci już 4× przy jednym ładowaniu widoku.
- [x] `1.2` `unwrap()` na `Mutex` w `src/tray.rs` zastąpiony bezpiecznym odzyskaniem locka; dodane też nazwane okno double-click.
- [x] `1.3` Startup sync respektuje `enabled` już w warstwie UI job pool; doprecyzowany opis w Help/Settings.
- [x] `2.1` Polling aplikacyjny został scentralizowany w store + `BackgroundServices`: `Sidebar`, `AI.tsx`, `Sessions.tsx`, `DataHistory.tsx` i auto-split nie mają już własnych interwałów pollingowych poza centralnym job pool. `DaemonControl` zostawia tylko page-scoped refresh logów przy widocznym oknie, a `useTimeAnalysisData` ma wyłącznie lokalny timer odświeżający datę w UI, bez odpytywania API.
- [x] `2.2` Polling `checkFileChange` spowolniony z `5s` do `30s`.
- [x] `2.3` `getProjects()` bez zakresu dat korzysta teraz ze wspólnego cache w Zustand store z invalidacją po mutacjach projektów i danych wpływających na statystyki projektów.
- [x] `2.4` Dashboard nie przeładowuje wszystkich danych tylko dlatego, że zmienił się język UI.
- [x] `2.5` `db::get_connection()` i `get_primary_connection()` korzystają teraz z małego poola ciepłych połączeń SQLite z resetem stanu przy zwrocie i czyszczeniem po zmianie trybu demo/primary.
- [x] `2.6` `load_range_snapshots()` ładuje zakres batchowo (snapshot headers + apps + sessions + files), zamiast wykonywać `load_day_snapshot()` osobno dla każdego dnia.
- [x] `2.7` `replace_day_snapshot()` nie kasuje już całego dnia przez `DELETE FROM daily_snapshots`; zapis używa upsertów nagłówka/app/sesji/plików i usuwa tylko rekordy, które zniknęły z nowego snapshotu.
- [x] `2.8` Pełny `build_process_snapshot()` dla background apps jest cache'owany i odświeżany co `30s`, zamiast przy każdym ticku `poll_interval`; foreground tracking dalej działa niezależnie od tego snapshotu.
- [x] `2.9` `ensure_schema()` nie jest już wywoływane przy każdym `load_day_snapshot()`, `load_range_snapshots()`, `get_day_signature()` i `replace_day_snapshot()`; inicjalizacja schematu zostaje przy `open_store()`.
- [x] `2.10` Zbędny indeks `idx_daily_snapshots_date` na kolumnie `date` (PRIMARY KEY) został usunięty z `ensure_schema()`, a istniejące bazy czyszczą go przez `DROP INDEX IF EXISTS`.
- [x] `2.11` `classify_activity_type()` zwraca teraz `Option<&'static str>`; monitor nie alokuje `String` przy klasyfikacji procesów, a konwersja do `String` zostaje dopiero przy zapisie do storage.
- [x] `3.1` Granice czasowe sesji są teraz spójne: nowa sesja startuje od `now - actual_elapsed`, a przy kontynuacji `duration_seconds` jest liczone z tych samych `start/end`, które trafiają do danych.
- [x] `3.2` Foreground tracking nie odrzuca już monitorowanej aplikacji tylko dlatego, że aktywne okno ma pusty tytuł; w takim przypadku TIMEFLOW zapisuje czas aplikacji bez nazwy dokumentu.
- [x] `3.5` Settings ostrzegają teraz o niezapisanych zmianach przed zmianą ekranu i przy zamknięciu/odświeżeniu okna, więc wyjście bez zapisu nie gubi już zmian bez potwierdzenia.
- [x] `3.3` `ReportView` nie trzyma już stale memoizowanej daty wygenerowania.
- [x] `3.4` `DaemonControl` nie wykonuje zbędnego `refresh()` przy wyłączeniu auto-refresh.
- [x] `3.6` `App.tsx` nie subskrybuje już całego `currentPage`, tylko pochodny boolean dla `showChrome`.
- [x] `4.2` Usunięta duplikacja `isSessionAlreadySplit` na rzecz współdzielonego helpera.
- [x] `4.4` `Dashboard` nie trzyma już osobnego stanu `projectCount`; licznik jest pochodną `projectsList.length`.
- [x] `4.5` Miejsca wcześniej wołające bezpośrednio `getProjects()` korzystają teraz ze współdzielonego loadera/cache `loadProjectsAllTime()`.
- [x] `4.1` `renderDuration()` i `formatDuration()` korzystają teraz ze wspólnego helpera `getDurationParts()`, więc logika rozbicia sekund nie jest już utrzymywana w dwóch miejscach.
- [x] `4.3` Snapshot procesów dla `tray.rs` i `monitor.rs` korzysta teraz ze wspólnego helpera `collect_process_entries()` w `process_utils.rs`, więc iteracja po `CreateToolhelp32Snapshot` nie jest już zdublowana.
- [x] `4.6` Powtarzalne logi `console.error('Failed to ...')` w dashboardzie korzystają teraz ze wspólnego helpera `logTauriError(action, error)`, więc format i kontekst logów są spójne.
- [x] `5.2` Logi daemonu w `config.rs` i `storage.rs` są już po angielsku, więc warstwa Rust nie miesza polskich i angielskich komunikatów diagnostycznych.
- [x] `4.7` Walidacja boost comment i dodatniego rate multiplier korzysta teraz ze współdzielonych helperów przy `useSessionActions`, więc `Sessions` i `ProjectPage` nie utrzymują tej samej logiki osobno.
- [x] `4.8` `Settings` pokazuje zapis przez globalny system `useToast`, bez lokalnego stanu i `setTimeout`.
- [x] `6` Help uzupełniony o praktyczny opis `ProjectPage`, `ManualSessionDialog`, `BugHunter` i pierwszej konfiguracji `Online Sync`.
- [x] `5.1` Hardkodowane błędy widoczne w UI w `Projects`, `Settings` i `CreateProjectDialog` zostały przepięte na tłumaczenia.
- [x] `8.1` Nieużywana zależność `sysinfo` usunięta z demona.
- [x] `7.1` `record_app_activity` przyjmuje teraz `ActivityContext`, więc powiązane dane wejściowe nie są już przekazywane jako długa lista luźnych parametrów.
- [x] `7.9` Stan `action` w tray korzysta teraz z `Rc<Cell<TrayExitAction>>`, więc nie trzyma już `Arc<Mutex<...>>` w single-threaded pętli NWG.
- [x] `7.8` `WMI_PATH_LOOKUP_BATCH_LIMIT` ma teraz opis celu limitu, więc ta liczba nie jest już anonimowym magic number bez kontekstu.
- [x] `7.6` `AI.tsx` używa teraz wspólnego callbacku do komunikatów błędów, więc nie trzyma już `showError` i tłumaczeń w refach synchronizowanych przez `useEffect`.
- [x] Weryfikacja techniczna ostatnich iteracji: `cargo test`, `cargo check`, `cargo check --manifest-path dashboard/src-tauri/Cargo.toml`, `dashboard/npm run lint`, `dashboard/npm run typecheck`, `dashboard/npm run test`.

---

## 1. Problemy krytyczne

### [x] 1.1 `compute_project_activity_unique` wywoływane 4× na tych samych danych
- **Pliki:** `dashboard/src-tauri/src/commands/dashboard.rs` (linie 18, 225, 264, 311)
- **Opis:** `get_dashboard_stats`, `get_top_projects`, `get_dashboard_projects` i `get_timeline` — wszystkie 4 komendy wywołują `compute_project_activity_unique` niezależnie. Dashboard woła je równocześnie (`Promise.allSettled`), więc ta sama ciężka operacja jest wykonywana 4 razy na tych samych danych.
- **Rozwiązanie:** Stworzyć jeden endpoint `get_dashboard_data`, który wykona obliczenia raz i zwróci wszystkie potrzebne dane w jednej odpowiedzi.

### [x] 1.2 `unwrap()` na Mutex lock w tray.rs
- **Plik:** `src/tray.rs`, linia 203
- **Opis:** `last_tray_click_clone.lock().unwrap()` — może spowodować panic jeśli mutex zostanie "poisoned" (np. panic w innym miejscu trzymającym lock).
- **Rozwiązanie:** Użyć `unwrap_or_else(|e| e.into_inner())` jak w loggerze (main.rs:156-158).

### [x] 1.3 Startup sync ignoruje flagę `enabled`
- **Plik:** `dashboard/src/components/sync/BackgroundServices.tsx`, linia 483-486
- **Opis:** `runSync('startup', false)` — `isAuto=false` pomija sprawdzenie `settings.enabled`. Sync startupowy uruchomi się nawet jeśli sync jest wyłączony w ustawieniach.
- **Rozwiązanie:** Sprawdzić `settings.enabled` przed wywołaniem sync startupowego.

---

## 2. Wydajność i optymalizacje

### [x] 2.1 [WYSOKI] 6+ aktywnych setInterval jednocześnie
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

### [x] 2.2 [WYSOKI] `checkFileChange` co 5s vs daemon zapisuje co 5 minut
- **Plik:** `BackgroundServices.tsx`, linia 393
- **Opis:** `getTodayFileSignature()` jest wywoływane co 5 sekund. Demon zapisuje dane co 300s.
- **Rozwiązanie:** Zwiększyć interwał do 30-60s.

### [x] 2.3 [WYSOKI] Brak cache na `getProjects()`
- **Plik:** `Dashboard.tsx`, linia 321
- **Opis:** Lista projektów zmienia się rzadko, ale ładowana jest przy każdym refresh (co 60s + manual + zmiana danych).
- **Rozwiązanie:** Cache w Zustand store z invalidacją tylko po mutacjach projektów.

### [x] 2.4 [WYSOKI] `t` w tablicy zależności useEffect w Dashboard
- **Plik:** `Dashboard.tsx`, linia 422-429
- **Opis:** Funkcja `t` z `useTranslation()` jest w tablicy zależności głównego useEffect ładującego dane. Zmiana języka powoduje ponowne załadowanie 7 równoczesnych zapytań API.
- **Rozwiązanie:** Usunąć `t` z dependency array — nie wpływa na zapytania API.

### [x] 2.5 [ŚREDNI] Nowe połączenie SQLite per komendę Tauri
- **Plik:** `db.rs`, linia 403 + `helpers.rs`, linia 64
- **Opis:** Każde wywołanie komendy Tauri tworzy nowe połączenie SQLite. Przy 4 równoczesnych komendach z dashboardu = 4 nowe połączenia.
- **Rozwiązanie:** Pula połączeń lub jedno współdzielone połączenie za Mutex.

### [x] 2.6 [ŚREDNI] N+1 pattern w `load_range_snapshots`
- **Plik:** `daily_store.rs`, linie 416-442
- **Opis:** Dla zakresu 30 dni: 1 + 3×30 = 91 zapytań SQL.
- **Rozwiązanie:** 3-4 zapytania z `WHERE date BETWEEN ? AND ?`.

### [x] 2.7 [ŚREDNI] DELETE + INSERT zamiast UPDATE w daily store
- **Plik:** `daily_store.rs`, linia 161
- **Opis:** `DELETE FROM daily_snapshots WHERE date = ?1` kasuje kaskadowo apps/sessions/files, po czym wstawia od nowa.
- **Rozwiązanie:** Chirurgiczny UPDATE zmienonych rekordów.

### [x] 2.8 [ŚREDNI] `build_process_snapshot` — pełny snapshot co 10s
- **Plik:** `tracker.rs:337`, `monitor.rs:653`
- **Opis:** `CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS)` iteruje przez WSZYSTKIE procesy systemu co 10s.
- **Rozwiązanie:** Zwiększyć interwał do 30s dla background apps; foreground tracking nie wymaga pełnego snapshotu.

### [x] 2.9 [NISKI] `ensure_schema()` przy każdej operacji
- **Plik:** `daily_store.rs`, linie 86, 137, 277
- **Opis:** `CREATE TABLE IF NOT EXISTS...` wykonywane przy każdym `load_day_snapshot` i `replace_day_snapshot`.
- **Rozwiązanie:** Wywoływać raz przy otwarciu połączenia.

### [x] 2.10 [NISKI] Zbędny indeks na PRIMARY KEY
- **Plik:** `daily_store.rs`, linia 127
- **Opis:** `CREATE INDEX idx_daily_snapshots_date ON daily_snapshots(date)` — `date` jest już PRIMARY KEY.
- **Rozwiązanie:** Usunąć zbędny indeks.

### [x] 2.11 [NISKI] `classify_activity_type` alokuje String
- **Plik:** `monitor.rs`, linie 504-553
- **Opis:** Zwraca `Option<String>` zamiast `Option<&'static str>`.
- **Rozwiązanie:** Zmienić na `&'static str` — eliminacja alokacji.

---

## 3. Poprawność logiki

### [x] 3.1 Niespójność `duration_seconds` vs `end - start` w sesji
- **Plik:** `src/tracker.rs`, linie 153-154
- **Opis:** Gdy sesja jest kontynuowana, `duration_seconds` zwiększane jest o `poll_interval`, ale `end` ustawiany na `now_str` (czas zegara). Jeśli sleep trwał dłużej niż `poll_interval`, pola `end - start` i `duration_seconds` mogą się różnić.

### [x] 3.2 Ignorowanie okien bez tytułu
- **Plik:** `src/monitor.rs`, linia 155
- **Opis:** `get_foreground_info()` zwraca `None` dla okien bez tytułu. Niektóre aplikacje (np. full-screen games, renderery) mają puste tytuły — czas pracy w nich nie jest zliczany.

### [x] 3.3 `ReportView` — `generatedAt` memoizowane bez deps
- **Plik:** `ReportView.tsx`, linia 34
- **Opis:** `useMemo(() => format(new Date(), 'yyyy-MM-dd HH:mm'), [])` — data jest ustawiana raz na cały cykl życia komponentu. Jeśli użytkownik wróci następnego dnia, data będzie stara.

### [x] 3.4 `DaemonControl` — zbędny `refresh()` przy wyłączeniu auto-refresh
- **Plik:** `DaemonControl.tsx`, linia 86-91
- **Opis:** Gdy `autoRefresh` zmieni się z `true` na `false`, `refresh()` w useEffect nadal zostaje wywołane niepotrzebnie.

### [x] 3.5 Brak ostrzeżenia o niezapisanych zmianach w Settings
- **Plik:** `Settings.tsx`
- **Opis:** Flaga `savedSettings` jest resetowana przy każdej indywidualnej zmianie. Użytkownik może wyjść ze strony bez zapisu, tracąc zmiany — brak dialogu "unsaved changes".

### [x] 3.6 `App.tsx` — podwójne subskrybowanie `currentPage`
- **Plik:** `App.tsx`, linie 62 i 155
- **Opis:** `currentPage` odczytywane zarówno w `PageRouter` jak i w `App`. Powoduje re-render całego `App` przy każdej zmianie strony.
- **Rozwiązanie:** Zmienić selector w App na `useUIStore(s => s.currentPage !== 'report-view')`.

---

## 4. Nadmiarowy i zduplikowany kod

### [x] 4.1 Zduplikowana `renderDuration()` vs `formatDuration()`
- **Pliki:** `Projects.tsx:166` vs `lib/utils.ts:10`
- **Opis:** Identyczna logika obliczenia `Math.floor(seconds / 3600)` i `Math.floor((seconds % 3600) / 60)`. Różnica: JSX vs string.
- **Rozwiązanie:** Wydzielić wspólną logikę obliczeniową.

### [x] 4.2 Zduplikowana `isSessionAlreadySplit`
- **Pliki:** `BackgroundServices.tsx:61-65` vs `session-analysis.ts:10-13`
- **Opis:** Identyczna funkcja w dwóch miejscach.
- **Rozwiązanie:** `BackgroundServices.tsx` powinno importować z `session-analysis.ts`.

### [x] 4.3 Duplikacja process snapshot (Rust)
- **Pliki:** `tray.rs:289-327` vs `monitor.rs:653-687`
- **Opis:** Niemal identyczny kod iterowania procesów przez `CreateToolhelp32Snapshot`.
- **Rozwiązanie:** Wydzielić do `process_utils.rs`.

### [x] 4.4 Nadmiarowy stan `projectCount`
- **Plik:** `Dashboard.tsx`, linie 188, 192, 368-369
- **Opis:** `projectCount` to zawsze `projectsList.length`. Zbędny dodatkowy useState.

### [x] 4.5 `getProjects()` wołany niezależnie w 7 miejscach
- **Pliki:** Dashboard, ProjectPage, Projects, Sessions, useTimeAnalysisData, DataStats, ExportPanel
- **Opis:** Każde miejsce: `getProjects().then(set).catch(console.error)`.
- **Rozwiązanie:** Scentralizować w Zustand store lub shared hook.

### [x] 4.6 40+ powtórzonych `console.error('Failed to ...')`
- **Rozwiązanie:** Scentralizować w helperze `logTauriError(context, error)`.

### [x] 4.7 Powtórzona walidacja boost/multiplier
- **Pliki:** `Sessions.tsx:820,892` vs `ProjectPage.tsx:561`
- **Opis:** Logika walidacji boost comment i rate multiplier niemal identyczna.
- **Rozwiązanie:** Przenieść do `useSessionActions` hook.

### 4.8 Settings — własny toast z `setTimeout` zamiast `useToast`
- **Plik:** `Settings.tsx`, linie 80-83, 261-263
- **Opis:** Niespójność z resztą aplikacji, która używa dedykowanego systemu `useToast`.

---

## 5. Brakujące tłumaczenia

### [x] 5.1 Hardkodowane angielskie stringi widoczne dla użytkownika

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

### [x] 5.2 Niespójność języka w logach Rust daemon
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

### [x] 7.1 Parameter sprawl: `record_app_activity` — 12 parametrów
- **Plik:** `src/tracker.rs`, linia 110-122
- **Rozwiązanie:** Struct `ActivityContext` grupujący powiązane parametry.

### 7.2 Stringly-typed activity types
- **Plik:** `src/monitor.rs`, linia 504-553
- **Opis:** Po poprawce `2.11` nie ma już alokacji `String`, ale logika nadal opiera się na literalach `"coding"`, `"browsing"` i `"design"` przekazywanych między funkcjami zamiast na typowanym enumie.
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

### [x] 7.6 `AI.tsx` — `showErrorRef` i `translateRef`
- **Plik:** `AI.tsx`, linie 169-170, 220-226
- **Opis:** `useRef` do przechowywania `showError` i `tr` z synchronizacją przez `useEffect` — nieelegancki wzorzec.

### 7.7 `useJobPool` — 210 linii w jednym hooku
- **Plik:** `BackgroundServices.tsx`, linia 277-487
- **Opis:** Zarządza wieloma timers/refs/intervals. Logika sync, refresh, file-signature-check powinna być rozdzielona.

### [x] 7.8 Magic numbers
- `monitor.rs:34` — `WMI_PATH_LOOKUP_BATCH_LIMIT = 16` bez uzasadnienia

### [x] 7.9 Mutex dla `action` w tray (single-threaded context)
- **Plik:** `src/tray.rs`, linie 181, 261, 286
- **Opis:** `Arc<Mutex<TrayExitAction>>` mimo single-threaded NWG event loop.
- **Rozwiązanie:** `Rc<Cell<TrayExitAction>>` byłoby prostsze.

---

## 8. Build i zależności

### [x] 8.1 [WYSOKI] Nieużywana zależność `sysinfo`
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

### Zamknięte w tej serii prac
- `1.1–1.3` krytyczne problemy dashboard/tray/startup sync
- `2.1–2.11` główne poprawki wydajnościowe dashboardu, store i daily store
- `3.1–3.6` poprawki poprawności logiki i UX
- `4.2`, `4.4`, `4.5` wybrane duplikacje i nadmiarowy stan
- `5.1` brakujące tłumaczenia widoczne w UI
- `8.1` usunięcie nieużywanej zależności `sysinfo`

### Otwarte priorytety
| Priorytet | Punkt | Problem | Wpływ |
|---|---|---|---|
| Średni | `7.3–7.5`, `7.7` | Code smells i zbyt duże moduły | Czytelność i koszt utrzymania |
| Niski | `7.2` | Stringly-typed activity types | Type safety |
| Niski | `8.2` | Weryfikacja sensowności `lettre` w dashboard Cargo | Potencjalne uproszczenie zależności |
| Niski | `8.3` | Ocena `opt-level = "s"` dla dashboardu | Potencjalny zysk runtime |

### Najblizsze sensowne kroki
1. `7.3–7.5` oraz `7.7` jako dalsze ujednolicanie jakosci i utrzymania kodu.
2. `8.2` i `8.3` dopiero po zamknieciu istotniejszych problemow utrzymaniowych.
3. Wieksze rozbicie duzych komponentow (`Sessions`, `Projects`, `ProjectPage`) po zamknieciu prostszych porzadkow.
