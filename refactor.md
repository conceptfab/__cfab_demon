# TIMEFLOW — Analiza kodu i plan refaktoryzacji

> Data analizy: 2026-03-14
> Priorytet: zachowanie dotychczasowych danych i kompatybilności wstecz.
> Cel: identyfikacja problemów, plan prac, wskazówki do `plan_implementacji.md`.

---

## 1. Mapa procesów / podsystemów

| # | Podsystem | Pliki kluczowe | Opis |
|---|-----------|----------------|------|
| 1 | Daemon monitoring | `src/monitor.rs`, `src/tracker.rs` | Co 10s polling aktywnego okna (WinAPI), śledzenie CPU, idle detection, PID cache |
| 2 | Daemon storage | `src/storage.rs`, `shared/daily_store/` | Zapis dziennych snapshotów do SQLite; legacy JSON fallback |
| 3 | WMI path detection | `src/monitor/wmi_detection.rs`, `src/monitor/pid_cache.rs` | Async wykrywanie ścieżki procesu via WMI |
| 4 | Daily store (shared) | `shared/daily_store/{read,write,types,schema}.rs` | Wspólna biblioteka Rust (daemon + dashboard-tauri) |
| 5 | Session rebuild/import | `commands/sessions/rebuild.rs`, `commands/import.rs`, `commands/import_data.rs` | Scalanie sesji, import z JSON |
| 6 | Session query + AI | `commands/sessions/query.rs` | Pobieranie sesji z filtrowaniem, file overlap, sugestie ML |
| 7 | Assignment model (AI) | `commands/assignment_model/{config,training,scoring,context,auto_safe}.rs` | Lokalny model ML: trening, sugestie, auto_safe, rollback |
| 8 | Analysis / Dashboard | `commands/analysis.rs`, `commands/dashboard.rs` | Sweepline bucketing, statystyki, eksport danych do wykresów |
| 9 | Online sync | `lib/sync/`, `components/sync/BackgroundServices.tsx` | Push/pull snapshotów do zewnętrznego serwera |
| 10 | Project management | `commands/projects.rs`, `pages/Projects.tsx` | CRUD projektów, foldery, kandydaci, freeze/exclude |
| 11 | Estimates | `commands/estimates.rs`, `pages/Estimates.tsx` | Stawki godzinowe, wyceny projektów |
| 12 | Reports | `commands/report.rs`, `pages/ReportView.tsx` | Generowanie raportów per projekt |
| 13 | Settings | `commands/settings.rs`, `commands/sessions/split.rs` | Ustawienia sesji, podział sesji |
| 14 | Background services | `components/sync/BackgroundServices.tsx` | Job pool, auto-import, AI assignment, diagnostics |

---

## 2. Duplikaty funkcji i kodu

### 2.1 `local_from_naive` — zduplikowana funkcja Rust
- `dashboard/src-tauri/src/commands/datetime.rs:3`
- `dashboard/src-tauri/src/commands/analysis.rs:142`
- **Naprawa**: Eksportować z `datetime.rs` jako `pub(crate)`, usunąć kopię z `analysis.rs`.

### 2.2 Paleta kolorów — brak wspólnego źródła
- Rust: `dashboard.rs:418-422` — 12-kolorowa paleta dla aplikacji
- TS: `lib/project-colors.ts` — 8-kolorowa paleta dla projektów
- **Naprawa**: Wydzielić wspólną paletę (const w Rust + export w TS), aby obie strony korzystały z tego samego źródła.

### 2.3 `total_time_formatted` — martwe pole
- `src/storage.rs:32` — `AppDailyData.total_time_formatted` wypełniane przez `update_summary`
- Pole nigdy nie trafia do SQLite ani dashboardu (TS formatuje czas sam przez `utils.ts:formatDuration`)
- **Naprawa**: Usunąć pole z `AppDailyData` i logikę `format_duration` w `storage.rs`.

### 2.4 Event listening — powielony wzorzec na stronach
- `Dashboard.tsx`, `Estimates.tsx`, `Applications.tsx`, `ProjectPage.tsx` — ręczne `window.addEventListener` zamiast hooka
- Hook `usePageRefreshListener` istnieje i jest używany w `Sessions.tsx`
- **Naprawa**: Ujednolicić wszystkie strony przez `usePageRefreshListener`.

### 2.5 Funkcje deep-equality — rozrzucone po plikach
- `background-status-store.ts`: `areStringArraysEqual`, `areDaemonStatusesEqual`, `areAssignmentStatusesEqual`
- `AI.tsx:111-157`: `areMetricsEqual`
- **Naprawa**: Wydzielić do `lib/equality-utils.ts` lub użyć generycznej `shallowEqual` / `JSON.stringify`.

### 2.6 `resolveContextMenuPlacement` — duplikat
- `Sessions.tsx:238-263`
- Komentarz wskazuje na identyczną logikę w `ProjectDayTimeline`
- **Naprawa**: Wynieść do `lib/context-menu-utils.ts`.

### 2.7 In-flight guard — dwa różne wzorce
- `background-status-store.ts`: boolean flags (`diagnosticsInFlight = false`)
- `projects-cache-store.ts`: `Promise | null` (lepsza wersja)
- **Naprawa**: Stworzyć `createSingleFlight<T>()` w `lib/async-utils.ts`, ujednolicić.

---

## 3. Błędy logiczne i edge case'y

### 3.1 `FileActivity.file_path` — ghost field
- `db-types.ts:38` deklaruje `file_path?: string`
- Rust struct `types.rs:88` tego pola nie ma — backend nigdy go nie zwraca
- `session-utils.ts:38` porównuje `file_path` które jest zawsze `undefined`
- **Naprawa**: Usunąć `file_path` z `FileActivity` w TS lub zaimplementować w Rust.

### 3.2 Sweepline multiplier "last wins"
- `analysis.rs:509` — przy nakładających się sesjach tego samego projektu, multiplier ostatniej zastępuje poprzedni
- W normalnych warunkach sesje się nie nakładają, ale po import/rebuild może to wystąpić
- **Naprawa**: Dokumentować jako known limitation lub uśredniać multiplier.

### 3.3 WMI detection — brak retry po przejściowym błędzie
- `src/monitor/wmi_detection.rs` — po timeout/błędzie WMI, `path_detection_attempted = true` i PID nigdy nie będzie miał wykrytej ścieżki
- **Naprawa**: Odróżniać "permanent failure" od "transient timeout", pozwalać retry po cooldown.

### 3.4 Idle threshold hardcoded
- `src/tracker.rs:341` — `IDLE_THRESHOLD_MS = 120_000` (2 min) nie jest konfigurowalne
- **Sugestia**: Dodać do ustawień użytkownika (niski priorytet).

### 3.5 `classify_activity_type` — zbędny `to_lowercase()`
- `src/monitor.rs:158` — `exe_name` jest już lowercase (z `get_exe_name_and_creation_time`)
- Ponowne `to_lowercase()` to zbędna alokacja w gorącej ścieżce
- **Naprawa**: Usunąć dodatkowe `to_lowercase()`.

### 3.6 `inferred_project_by_session` — myląca nazwa
- `sessions/query.rs:338-413` — zmienna sugeruje twarde przypisanie, ale faktycznie to sugestia
- **Naprawa**: Zmienić nazwę na `suggested_project_by_session`.

---

## 4. Wydajność i optymalizacje

### 4.1 [WYSOKI] Daemon: `save_daily` otwiera nowe połączenie SQLite przy każdym zapisie
- `src/storage.rs:272-277` — `open_daily_store()` co 5 min
- **Naprawa**: Przechowywać jedno trwałe połączenie w `run_loop` i przekazywać do `save_daily`.

### 4.2 [WYSOKI] Backend: VACUUM/backup przy starcie blokuje UI
- `dashboard/src-tauri/src/db.rs:174-269` — sekwencyjne VACUUM + backup + optimize przed inicjalizacją UI
- **Naprawa**: Przenieść do `spawn_blocking` po inicjalizacji lub opóźnić do pierwszego tiku BackgroundServices.

### 4.3 [WYSOKI] Brakujący indeks `sessions(date)`
- `db_migrations.rs:758` — istniejący indeks `idx_sessions_app_date(app_id, date, start_time)` nie pomaga przy zapytaniach `WHERE date >= ? AND date <= ?` bez `app_id`
- `SESSION_PROJECT_CTE_ALL_TIME` w `sql_fragments.rs:87-91` — `MIN(date)` i `MAX(date)` bez indeksu to full scan
- **Naprawa**: `CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date)` + analogicznie dla `assignment_suggestions(session_id)`.

### 4.4 [ŚREDNI] SESSION_PROJECT_CTE — kosztowny inline CTE
- `sql_fragments.rs:1-93` — materializowany ponownie przy każdym zapytaniu (dashboard, sessions, timeline, top_projects)
- **Rozważyć**: Cache/materializację wyniku CTE w temp table przy starcie dnia.

### 4.5 [ŚREDNI] Dashboard: wielokrotne wywołania `compute_project_activity_unique`
- `dashboard.rs` — ta sama funkcja analityczna wywoływana 3-4 razy przez różne komendy
- **Naprawa**: Cache wyników per date range w backend (invalidacja przy zmianach danych).

### 4.6 [ŚREDNI] WMI detection blokuje główną pętlę
- `src/monitor/wmi_detection.rs` — WMI query synchronicznie w głównym wątku, może blokować 100-500ms
- **Naprawa**: Przenieść do dedykowanego wątku z `mpsc::channel`.

### 4.7 [NISKI] DbPath lock per query
- `db.rs:439-448` — `Mutex<String>` lockowany przy każdym `get_connection`
- **Naprawa**: Cache w `Arc<str>` lub `OnceLock` po inicjalizacji.

### 4.8 [NISKI] React: brak `memo`/`useCallback` w SessionsVirtualList
- `SessionsVirtualList.tsx:124` — `itemContent` jako inline function, re-created per render
- **Naprawa**: `useCallback` na `itemContent`.

### 4.9 [NISKI] Dashboard.tsx — zbyt szerokie subskrypcje store
- `projectsList = useProjectsCacheStore((s) => s.projectsAllTime)` — cały array, choć potrzebne `.length`
- **Naprawa**: `useProjectsCacheStore((s) => s.projectsAllTime.length)`.

---

## 5. Architektura i modularyzacja

### 5.1 [WYSOKI] Sessions.tsx (1167 linii) — wymaga podziału
**Wydzielić:**
- `SessionContextMenu.tsx` (~400 linii inline context menu)
- `useAssignProjectSections` hook (logika grupowania projektów)
- `useGroupedSessions` hook (logika flattenedItems)
- `lib/context-menu-utils.ts` (resolveContextMenuPlacement)

### 5.2 [ŚREDNI] `ui-store.ts` — za szeroki zakres
9 różnych odpowiedzialności. Rozważyć podział:
- `navigation-store` (page, guards, helpTab)
- `sessions-focus-store` (focusDate/Range/Project)
- `preferences-store` (assignProjectListMode, firstRun)

### 5.3 [ŚREDNI] Event bus vs Store — niespójna propagacja danych
Aplikacja używa zarówno Zustand stores jak i `CustomEvent` przez `window`. Ujednolicić:
- Albo przenieść eventy do store (pub/sub wewnątrz Zustand)
- Albo konsekwentnie izolować za `usePageRefreshListener`

### 5.4 [ŚREDNI] `useSettingsFormState.ts` — liniowy wzrost
Każda karta Settings dodaje stan + handler. Rozważyć wzorzec registry lub per-card hooki.

### 5.5 [NISKI] `background-status-store.ts` — 3 niezależne serwisy w jednym pliku
Wydzielić: `diagnostics-service.ts`, `ai-status-service.ts`, `db-settings-service.ts`.

---

## 6. Tłumaczenia — luki i problemy

### 6.1 Struktura kluczy PL/EN — kompletna
Oba pliki `common.json` mają identyczne ścieżki kluczy. Brak brakujących kluczy.

### 6.2 Niespójności stylistyczne
- `layout.tooltips.boosted_sessions`: PL format z dwukropkiem (`Sesje z mnożnikiem: {{count}}`), EN zmienną na początku (`{{count}} boosted session(s)`)
- `online_sync_indicator.labels.disabled`: PL `"Wył."` vs EN `"Sync Off"` (różny poziom szczegółowości)

### 6.3 Klucze z obciętymi nazwami
Klucze w `help_page` mają nazwy obcięte do ~60 znaków. Trudne do utrzymania i podatne na kolizje. Rozważyć krótsze, semantyczne klucze.

---

## 7. Help.tsx — luki w dokumentacji

### 7.1 [WYSOKI] Brak opisu ReportView
`Reports.tsx` opisuje edytor szablonów, ale `ReportView.tsx` (pełnoekranowy podgląd, druk, PDF) nie jest udokumentowany. Brak info jak otworzyć (z karty projektu).

### 7.2 [WYSOKI] Brak opisu ikon trybów listy projektów
Ikony Type/Sparkles/Flame w Sessions — brak wyjaśnienia w Help co oznaczają (alpha/new_top_rest/top_new_rest).

### 7.3 [ŚREDNI] Relacja Demo Mode ↔ Sync
Brak jasnego wyjaśnienia że sync jest wyłączony w demo mode i dlaczego "Sync Now" jest zablokowany.

### 7.4 [ŚREDNI] Applications: "Sync from apps" / "monitored list"
Klucz istnieje, ale różnica "detected" vs "monitored" nie jest wyjaśniona przystępnie.

### 7.5 [ŚREDNI] QuickStart — minimalna dokumentacja
Help ma tylko przycisk prowadzący do QuickStart. Brak opisu kroków ani info że można wrócić w dowolnym momencie.

### 7.6 [NISKI] BugHunter
Udokumentowany tylko w sekcji Settings, ale ikona jest w sidebarze — warto dodać wzmiankę.

### 7.7 [NISKI] Daily/weekly range mode w Sessions
Wspomniany hasłowo, ale brak wyjaśnienia jak wpływa na filtrowanie.

### 7.8 [NISKI] Discovered Projects Banner
Klucz istnieje, brak info gdzie się pojawia i jak go zamknąć.

---

## 8. Sugestie funkcjonalne

| # | Sugestia | Opis | Priorytet |
|---|----------|------|-----------|
| 1 | Batch assign z toolbar | Przycisk "Assign selected (N)" gdy multiselect aktywny | Średni |
| 2 | Export filtrowanego widoku | Export sesji z aktualnego zakresu dat + projekt | Średni |
| 3 | Keyboard shortcuts | Nawigacja stronami, assign sesji, ESC menu | Niski |
| 4 | Quick assign z Dashboard | Przypisanie 1-2 sesji bez opuszczania Dashboard | Niski |
| 5 | AI confidence trend | Wykres % sesji z confidence >threshold w czasie | Niski |
| 6 | Raport zbiorczy | ReportView dla wszystkich projektów w zakresie dat | Niski |
| 7 | Session filter persistence | Zapamiętywanie filtrów Sessions między wizytami | Niski |

---

## 9. Plan prac — priorytety

### Faza 1: Krytyczne (bezpieczeństwo danych, wydajność)
1. Dodać indeks `idx_sessions_date ON sessions(date)` + `idx_assignment_suggestions_session ON assignment_suggestions(session_id)`
2. Przenieść VACUUM/backup do `spawn_blocking` (db.rs)
3. Persistent SQLite connection w daemon `run_loop`
4. Usunąć ghost field `file_path` z `FileActivity` (TS)

### Faza 2: Duplikaty i czystość kodu
5. Eksportować `local_from_naive` z `datetime.rs`, usunąć kopię z `analysis.rs`
6. Usunąć martwe pole `total_time_formatted`
7. Ujednolicić event-listening przez `usePageRefreshListener` na wszystkich stronach
8. Wynieść `areMetricsEqual` i inne equality helpers do `lib/equality-utils.ts`
9. Wynieść `resolveContextMenuPlacement` do `lib/context-menu-utils.ts`
10. Usunąć zbędny `to_lowercase()` w `classify_activity_type`

### Faza 3: Modularyzacja
11. Wydzielić `SessionContextMenu` z `Sessions.tsx`
12. Stworzyć hooki `useAssignProjectSections`, `useGroupedSessions`
13. Stworzyć `createSingleFlight<T>()` w `lib/async-utils.ts`
14. WMI detection — przenieść do osobnego wątku

### Faza 4: Help i tłumaczenia
15. Uzupełnić Help.tsx: ReportView, ikony trybów, demo/sync, QuickStart
16. Poprawić niespójności stylistyczne w tłumaczeniach
17. Rozważyć krótsze klucze w `help_page`

### Faza 5: Architektura (opcjonalne)
18. Rozważyć podział `ui-store` na mniejsze store
19. Ujednolicić event bus vs store
20. Cache `compute_project_activity_unique` per date range
21. Wydzielić serwisy z `background-status-store.ts`

---

## 10. Wskazówki dla modelu implementującego (`plan_implementacji.md`)

### Zasady ogólne
- **Priorytet #1**: Zachowanie danych. Żadna zmiana nie może powodować utraty danych użytkownika. Migracje SQLite muszą być addytywne (ALTER TABLE ADD, CREATE INDEX IF NOT EXISTS).
- **Testowanie**: Przed każdą zmianą w Rust uruchom `cargo build` i `cargo clippy`. Przed zmianą TS: `npx tsc --noEmit` z `dashboard/`.
- **Atomowość**: Każda pozycja z planu to osobny commit. Nie łącz niezwiązanych zmian.
- **Kompatybilność**: Nie zmieniaj sygnatur komend Tauri (`#[tauri::command]`) bez aktualizacji wywołań TS.

### Pliki kluczowe do przeczytania przed rozpoczęciem
1. `dashboard/src-tauri/src/db_migrations.rs` — zrozumieć wzorzec migracji (pragma_table_info check)
2. `dashboard/src-tauri/src/commands/helpers.rs` — `run_db_blocking`, `run_db_primary_blocking`
3. `dashboard/src-tauri/src/commands/sql_fragments.rs` — SESSION_PROJECT_CTE (najcięższy SQL)
4. `dashboard/src/lib/sync-events.ts` — event bus
5. `dashboard/src/hooks/usePageRefreshListener.ts` — wzorzec do naśladowania
6. `dashboard/src/pages/Sessions.tsx` — największy plik, cel refaktoryzacji
7. `dashboard/src/pages/Help.tsx` — cel uzupełnień

### Szczegóły per pozycja

**Poz. 1 (indeksy)**: Dodaj migrację w `ensure_indexes()` w `db_migrations.rs`. Wzorzec: `conn.execute_batch("CREATE INDEX IF NOT EXISTS ...")`. Nie usuwaj istniejących indeksów.

**Poz. 2 (VACUUM)**: W `db.rs:initialize()`, zamiast sekwencyjnych `vacuum_if_needed`/`backup_if_needed`/`auto_optimize`, opakuj w `tokio::task::spawn_blocking` i pozwól Tauri kontynuować setup. Upewnij się że pool jest gotowy PRZED vacuum (vacuum nie musi blokować startu).

**Poz. 3 (persistent conn)**: W `src/tracker.rs:run_loop`, otwórz połączenie raz: `let mut conn = storage::open_daily_store()?;` i przekaż `&mut conn` do `save_daily`. Zmień sygnaturę `save_daily` na `fn save_daily(data: &mut DailyData, conn: &mut Connection)`.

**Poz. 4 (ghost field)**: Usuń `file_path?: string` z `db-types.ts:FileActivity`. Usuń porównanie w `session-utils.ts:areFileActivitiesEqual`.

**Poz. 11 (SessionContextMenu)**: Wydziel z `Sessions.tsx` linie odpowiedzialne za context menu do `components/sessions/SessionContextMenu.tsx`. Props: `sessions, projects, position, onClose, onAction`. Zachowaj identyczną logikę — to pure extraction, nie refaktor.

**Poz. 14 (WMI thread)**: Stwórz `std::thread::spawn` z `mpsc::channel<Vec<u32>>` (sender: main loop, receiver: WMI thread). WMI thread odpowiada `HashMap<u32, String>` (pid → path). Main loop sprawdza `try_recv()` co tick.

**Poz. 15 (Help)**: Używaj wzorca `SectionHelp` z `icon, title, description, features[], footer`. Każdy tekst musi mieć parę PL+EN: `t('tekst PL', 'text EN')`. Sprawdź istniejące sekcje w Help.tsx dla formatu.
