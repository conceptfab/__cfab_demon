# TIMEFLOW — Analiza i Plan Refaktoryzacji

Data analizy: 2026-03-15

---

## 1. Mapa procesów

### 1.1 Monitorowanie aktywności (Demon)
- **Pliki**: `src/main.rs`, `src/tracker.rs`, `src/monitor.rs`, `src/monitor/pid_cache.rs`, `src/monitor/wmi_detection.rs`
- **Przepływ**: Pętla co 10s (`tracker::run_loop`) odpytuje `GetForegroundWindow` + PID cache (`monitor::get_foreground_info`), wykrywa idle (`get_idle_time_ms`), mierzy CPU w tle (`measure_cpu_for_app`), agreguje czas w `DailyData`.
- **Zapis**: Co 5 min do SQLite daily store (`shared/daily_store/`).
- **Dodatkowe**: heartbeat co 30s, reload konfiguracji co 30s, evict PID cache co 10 min, WMI path detection dla IDE/przeglądarek.

### 1.2 Tracking sesji (Dashboard Tauri backend)
- **Pliki**: `dashboard/src-tauri/src/commands/sessions/`, `dashboard/src-tauri/src/commands/import.rs`
- **Przepływ**: `refresh_today` czyta daily store, upsertuje sesje i file_activities do SQLite dashboard DB. `rebuild_sessions` scala sesje z małymi przerwami.

### 1.3 AI assignment (przypisywanie sesji do projektów)
- **Pliki**: `dashboard/src-tauri/src/commands/assignment_model/`
- **Przepływ**: Training na historii przypisań, scoring sesji, auto-safe assignment z rollback. Deterministic assignment na podstawie file_activities → project mapping.
- **Frontend**: `dashboard/src/components/ai/`, `dashboard/src/pages/AI.tsx`

### 1.4 Synchronizacja online
- **Pliki**: `dashboard/src/lib/online-sync.ts`, `dashboard/src/lib/sync/sync-http.ts`, `dashboard/src/lib/sync/sync-storage.ts`
- **Przepływ**: Push/pull danych przez HTTP do zdalnego serwera. Konfiguracja w localStorage i secure token w Rust backend.

### 1.5 Background services (job pool)
- **Pliki**: `dashboard/src/components/sync/BackgroundServices.tsx`, `dashboard/src/components/sync/job-pool-helpers.ts`
- **Przepływ**: Uniwersalna pętla 1s tick: auto-import danych z `data/`, refresh today, file signature check, auto-split sesji, online sync, diagnostyka DB, AI assignment.

### 1.6 Import/Export
- **Pliki**: `dashboard/src-tauri/src/commands/import.rs`, `dashboard/src-tauri/src/commands/import_data.rs`, `dashboard/src-tauri/src/commands/export.rs`
- **Przepływ**: JSON daily files → SQLite, archive export/import z walidacją.

### 1.7 Build pipeline
- **Pliki**: `build_all.py`, `build_demon.py`, `dashboard_build.py`, `build_common.py`, `build_release.py`, `deploy.py`
- **Przepływ**: Wersja z `VERSION` → Cargo.toml + tauri.conf.json + package.json, kompilacja Rust + Tauri.

---

## 2. Problemy krytyczne

### 2.1 Duplikacja struktur danych DailyData (demon vs shared)
- **Plik**: `src/storage.rs` linie 18-63 — demon definiuje własne `DailyData`, `AppDailyData`, `Session`, `FileEntry`
- **Plik**: `shared/daily_store/types.rs` linie 1-78 — shared definiuje `StoredDailyData`, `StoredAppDailyData`, `StoredSession`, `StoredFileEntry`
- **Problem**: `storage.rs` ma ręczne konwersje `to_stored_daily()` (linie 149-189) i `from_stored_daily()` (linie 191-240) — 90 linii boilerplate. Każde dodanie pola wymaga zmian w 3 miejscach.
- **Priorytet**: Wysoki — ryzyko desynchronizacji pól.

### 2.2 Demon otwiera dashboard DB w read-only bez retry
- **Plik**: `src/config.rs` linie 127-178 — `load_monitored_apps_from_dashboard_db()` otwiera `timeflow_dashboard.db` z `SQLITE_OPEN_READ_ONLY`
- **Plik**: `src/tray.rs` linie 49-89 — `query_unassigned_attention_count()` robi to samo
- **Problem**: Obie funkcje otwierają DB niezależnie, bez connection poolingu. Przy równoczesnym zapisie przez dashboard (WAL mode) mogą wystąpić SQLITE_BUSY mimo busy_timeout=2000ms. Brak retry logiki.
- **Priorytet**: Średni — w praktyce rzadko powoduje widoczne problemy dzięki WAL.

### 2.3 Brak `schema_version` w migracyjach DB
- **Plik**: `dashboard/src-tauri/src/db_migrations.rs`
- **Problem**: Migracje są idempotentne (CHECK IF EXISTS), ale nie ma tabeli `schema_version`. Każda migracja jest uruchamiana przy każdym starcie aplikacji. Przy rosnącej liczbie migracji startup będzie coraz wolniejszy.
- **Priorytet**: Średni — wymaga dodania prostej tabeli wersji schematu.

### 2.4 Brak stanu error w Dashboard.tsx
- **Plik**: `dashboard/src/pages/Dashboard.tsx`
- **Problem**: `stats`, `topProjects`, `allProjects` nie mają dedykowanego stanu error (poza `projectTimelineError`). Użytkownik widzi `N/A` bez informacji o błędzie.
- **Priorytet**: Średni — UX problem.

### 2.5 Hardcoded `title = "Activity Timeline"` w `ProjectDayTimeline`
- **Plik**: `dashboard/src/components/dashboard/ProjectDayTimeline.tsx` linia 58
- **Problem**: Domyślny tytuł jest hardcoded po angielsku. Linia 409 sprawdza go porównaniem stringów aby zdecydować o tłumaczeniu — kruche i łamie się przy zmianie.
- **Priorytet**: Niski — działa, ale jest antypatternem.

---

## 3. Duplikacja kodu

### 3.1 Typy danych demon↔shared (największa duplikacja)
- `src/storage.rs` `DailyData`/`AppDailyData`/`Session`/`FileEntry` duplikują `shared/daily_store/types.rs` `StoredDailyData`/etc.
- `total_time_formatted` (storage.rs:31) istnieje TYLKO w demon-side `AppDailyData` — nigdy nie jest persystowany (generowany w `update_summary`).
- **Sugestia**: Demon powinien bezpośrednio używać `StoredDailyData` z shared, a `total_time_formatted` obliczać w locie (już to robi w `update_summary`). Eliminuje ~100 linii konwersji.

### 3.2 `timeflow_data_dir()` / `config_dir()` / `app_storage_dir()`
- `src/config.rs:80-83` (`config_dir`) — zwraca `%APPDATA%/TimeFlow`
- `dashboard/src-tauri/src/commands/helpers.rs:74-78` (`timeflow_data_dir`) — robi to samo
- `dashboard/src-tauri/src/db.rs:78-101` (`app_storage_dir`) — robi to samo z fallbackami
- **Sugestia**: Zunifikować w `shared/timeflow_paths.rs` jako jedną funkcję.

### 3.3 Dwukrotne otwarcie dashboard DB w demonie
- `src/config.rs:127-178` — `load_monitored_apps_from_dashboard_db()` otwiera DB
- `src/tray.rs:49-89` — `query_unassigned_attention_count()` otwiera DB
- Obie robią to samo: open, busy_timeout, check table exists, query, close.
- **Sugestia**: Wspólny helper `open_dashboard_db_readonly()` w config lub osobnym module.

### 3.4 Sanityzacja pól w trackerze i storage
- `src/tracker.rs` linie 200-205 — normalizuje `file_name`, `window_title`, `detected_path` przy każdym pollu
- `src/storage.rs` linie 114-142 — `prepare_daily_for_storage()` robi to PONOWNIE przed zapisem
- **Sugestia**: Sanityzacja powinna być jednokrotna — albo przy wejściu (tracker), albo przy zapisie (storage), nie w obu miejscach.

### 3.5 `build_all.py` vs `build_release.py` — skopiowana logika
- `build_all.py` linie 48-115 — obsługa wersji (input + walidacja regex) + orkiestracja buildu
- `build_release.py` linie 59-123 — ten sam kod 1:1, plus krok ZIP/send
- **Sugestia**: Wyciągnąć wspólną logikę (wersja + orkiestracja) do `build_common.py`. `build_release.py` powinien rozszerzać `build_all.py`.

### 3.6 `MonitoredApp` — podwójna definicja
- `src/config.rs:14-18` — `MonitoredApp` w demonie
- `dashboard/src-tauri/src/commands/types.rs:318-322` — identyczna definicja
- **Sugestia**: Przenieść do `shared/` crate.

### 3.7 Konwersje `ProcessEntryInfo` powtórzone
- `src/process_utils.rs` definiuje `ProcessEntryInfo` z `collect_process_entries()`
- `src/tray.rs:363-375` — `is_dashboard_running()` woła `collect_process_entries()` i iteruje
- `src/monitor.rs:302-320` — `build_process_snapshot()` woła to samo
- Demon buduje pełny snapshot procesów regularnie — `is_dashboard_running()` mogłoby korzystać z cached snapshot zamiast tworzyć nowy.

---

## 4. Wydajność

### 4.1 `compute_project_activity_unique` jest wywoływane wielokrotnie
- **Plik**: `dashboard/src-tauri/src/commands/dashboard.rs`
- `get_dashboard_data` (linia 188) woła `compute_project_activity_unique` raz, dobrze.
- ALE: `get_dashboard_stats` (linia 219), `get_top_projects` (linia 344), `get_dashboard_projects` (linia 358), `get_timeline` (linia 372), `get_hourly_breakdown` (linia 389) — każda z tych komend woła `compute_project_activity_unique` NIEZALEŻNIE.
- **Problem**: Dashboard Frontend woła `getDashboardData` (który zwraca stats+top+timeline), ale inne strony mogą wołać te endpointy osobno. Każde wywołanie to pełny scan `sessions` + `file_activities` + `manual_sessions`.
- **Sugestia**: Cache wyników na poziomie date_range per request, lub batch endpoint który zwraca wszystko naraz.

### 4.2 Assignment suggestions per-session w `get_sessions`
- **Plik**: `dashboard/src-tauri/src/commands/sessions/query.rs` linie 437-558
- Po pobraniu sesji, jeśli `include_ai_suggestions`, robi DRUGIE `run_db_blocking` z `suggest_projects_for_sessions_with_status` + dodatkowe `suggest_projects_for_sessions_raw` dla sesji przypisanych ale bez sugestii.
- **Problem**: Dwa osobne `run_db_blocking` calls = dwa acquire z poola, dwa `spawn_blocking`.
- **Sugestia**: Przenieść logikę sugestii do tego samego bloku `run_db_blocking`.

### 4.3 PID cache evict interval (10 min) vs cache max age (3 min) — rozsądne
- `src/config.rs` defaults: `cache_evict_secs=600`, `cache_max_age_secs=180`
- Evict co 10 min, ale wpisy max 3 min stare — wpisy żyją dłużej niż max_age jeśli nie ma evictu. W praktyce działa bo `ensure_pid_cache_entry` sprawdza process creation time.

### 4.4 `BackgroundServices` — 1s tick interval
- **Plik**: `dashboard/src/components/sync/BackgroundServices.tsx` linia 452
- `JOB_LOOP_TICK_MS` = prawdopodobnie 1000ms (z `job-pool-helpers.ts`)
- Co sekundę sprawdza timestampy następnych zadań. W praktyce lekki (porównanie liczb), ale mogłoby być wydajniejsze z `setTimeout` na najbliższe zadanie zamiast stałego interwału.

### 4.5 Visibility change — burst IPC bez debounce
- **Plik**: `dashboard/src/components/sync/BackgroundServices.tsx` linie ~401-417
- **Problem**: Powrót do okna (visibility change) natychmiast odpala `runRefresh` + `refreshDiagnostics` (4 IPC calls) + file signature check — burst bez debounce.
- **Sugestia**: Dodać debounce 500ms na visibility change handler.

### 4.6 `refreshDiagnostics` — 4 osobne IPC zamiast batched
- **Plik**: `dashboard/src/store/background-status-store.ts` linie 127-140
- **Problem**: 4 osobne Tauri IPC roundtripy (getDaemonRuntimeStatus, getAssignmentModelStatus, 2x getSessionCount). Każdy = osobny `spawn_blocking` + connection z puli.
- **Sugestia**: Jedna komenda `get_background_diagnostics_batch` zwracająca wszystko naraz.

### 4.7 Brakujący indeks na `sessions.date` (sam)
- Indeksy w `db_migrations.rs:758`: `idx_sessions_app_date ON sessions(app_id, date, start_time)` — dobry dla zapytań per-app+date.
- ALE: `ACTIVE_SESSION_FILTER` sprawdza `is_hidden = 0`, a wiele zapytań filtruje po `date` BEZ `app_id`. Composite index `(app_id, date, ...)` nie pomoże przy samym `WHERE date >= ? AND date <= ?`.
- **Sugestia**: Dodać `CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date)` — poprawi dashboard stats, timeline, heatmap.

---

## 5. Jakość kodu

### 5.1 Error handling — `String` zamiast typów błędów
- Prawie CAŁY Tauri backend używa `Result<T, String>`. Np. `dashboard/src-tauri/src/commands/helpers.rs:85-97`.
- Demon używa `anyhow::Result` w storage, ale `String` w config.
- **Sugestia**: Nie wymaga natychmiastowej zmiany, ale nowe moduły powinny używać `thiserror` lub przynajmniej `anyhow`.

### 5.2 `pub use *` w commands/mod.rs
- **Plik**: `dashboard/src-tauri/src/commands/mod.rs` linie 27-44
- Wszystkie moduły re-exportowane globbing `pub use module::*` — ryzyko kolizji nazw, trudność w znalezieniu źródła funkcji.
- **Sugestia**: Explicit re-exports lub przynajmniej komentarze grupujące.

### 5.3 `DailyData` w Tauri backend to alias na `StoredDailyData`
- **Plik**: `dashboard/src-tauri/src/commands/types.rs` prawdopodobnie definiuje `DailyData` jako alias shared type.
- Ale `daily_store_bridge.rs` linia 7 importuje `super::types::DailyData` i przekazuje go bezpośrednio do `replace_day_snapshot` (linia 33) — to działa bo Tauri backend używa bezpośrednio `StoredDailyData`.
- W demonie natomiast jest osobna konwersja (`storage.rs`). Niespójność.

### 5.4 Tray timer odświeża co 5s
- **Plik**: `src/tray.rs` linia 175 — `AnimationTimer` z `interval: Duration::from_secs(5)`
- Co 5s: sprawdza zmianę języka (`load_language` = czyta plik z dysku), odświeża attention count (baza danych co 30s, ale check co 5s).
- Czytanie pliku co 5s to trochę za często — 10-15s byłoby wystarczające.

### 5.5 `classify_activity_type` — duplikacja z dashboard
- **Plik**: `src/monitor.rs` linie 160-209 — hardcoded lista exe → ActivityType
- Dashboard nie ma odpowiednika bo używa tego co demon zapisze, ale dodanie nowego IDE/przeglądarki wymaga update demona i ponownej kompilacji.
- **Sugestia**: Przenieść listę do konfiguracji lub shared crate.

---

## 6. Modularyzacja

### 6.1 `dashboard/src/pages/ProjectPage.tsx` — 1531 linii
- Największy komponent w dashboardzie. Łączy wyświetlanie projektu, sesje, manual sessions, timeline, komentarze, context menu, dialog edycji, estymacje.
- **Sugestia**: Wydzielić sekcje: `ProjectOverview`, `ProjectSessionsList`, `ProjectTimelineSection`, `ProjectEstimatesSection`.

### 6.2 `dashboard/src/pages/Projects.tsx` — 1445 linii
- Folder sync, project detection, lista projektów, excluded projects, context menu, create dialog.
- **Sugestia**: Wydzielić `ProjectsList`, `ExcludedProjectsList`, `ProjectDiscoveryPanel`.

### 6.3 `dashboard/src/pages/Sessions.tsx` — 1167 linii
- Hooksy wydzielone do `hooks/useSessionActions.ts`, `hooks/useSessionsData.ts`, `hooks/useSessionsFilters.ts` — dobra praktyka.
- Ale główny komponent nadal duży — toolbar + wirtualna lista + context menu + modal split + prompt modal.
- **Sugestia**: OK na teraz, hooks extraction zmniejszył złożoność.

### 6.4 `src/tray.rs` — 456 linii, monolityczny handler
- Event handler `nwg::full_bind_event_handler` (linie 255-347) to jeden duży closure z wieloma Rc/RefCell.
- **Sugestia**: Wydzielić state do struktury `TrayState` i metody handle_context_menu, handle_mouse_press, handle_timer_tick, handle_menu_item.

### 6.5 `dashboard/src-tauri/src/db_migrations.rs` — 800 linii, jeden plik
- Wszystkie migracje w jednym pliku. Każda nowa migracja zwiększa plik.
- **Sugestia**: Podzielić na folder `db_migrations/` z osobnymi plikami per epoch (v1, v2, v3...).

### 6.6 `dashboard/src-tauri/src/commands/analysis.rs` — 734 linie
- Główna logika `compute_project_activity_unique` + stacked bar output.
- **Sugestia**: Wydzielić `stacked_bar.rs` od core `project_activity.rs`.

### 6.7 Sessions.tsx — inline context menu (~220 linii JSX)
- **Plik**: `dashboard/src/pages/Sessions.tsx` linie 890-1113
- Context menu z logiką przypisywania projektów renderowane inline.
- **Sugestia**: Wydzielić do `<SessionContextMenu>`.

### 6.8 `StackedBarData` — indeks-signatura zamiast typowanej mapy
- **Plik**: `dashboard/src/lib/db-types.ts` linie 324-337
- `[appName: string]: string | number | ...` — pozwala na dowolne klucze. Lepiej osobny `Record<string, number>` na dane serii.

### 6.9 `db.rs:initialize()` — ~110 linii w jednej funkcji
- **Plik**: `dashboard/src-tauri/src/db.rs` linie 174-283
- Vacuum + backup + optimize w jednym bloku. Rozbić na `run_vacuum()`, `run_backup()`, `run_optimize()`.

---

## 7. Tłumaczenia i Help

### 7.1 Klucze EN/PL — pełna paritet
- **Wynik porównania**: EN: 1389 kluczy, PL: 1389 kluczy, brak braków w żadnym kierunku.
- Stan: doskonały.

### 7.2 Help.tsx — pokrycie stron
- Help.tsx (922 linie) zawiera sekcje/taby mapujące strony. Używa `normalizeHelpTab` z `lib/help-navigation.ts`.
- Strony pokryte: Dashboard, Sessions, Projects, Estimates, Applications, TimeAnalysis, AI, Data, Reports, DaemonControl, Settings, QuickStart, Import.
- **Brak**: Sekcja „Reports/ReportView" nie ma dedykowanej zakładki Help (raportowanie jest stosunkowo nowe).
- **Sugestia**: Dodać opis funkcji generowania raportów (szablony, eksport PDF, filtry dat) w Help.

### 7.3 Hardcoded stringi
- `dashboard/src/components/dashboard/ProjectDayTimeline.tsx:58` — `title = "Activity Timeline"` jako default prop. Używany w porównaniu (linia 409) do wyboru tłumaczenia. Powinien być kluczem i18n.
- `dashboard/src/components/dashboard/ProjectDayTimeline.tsx:318` — `title: "Session comment"` — hardcoded w context menu config.
- W pozostałych komponentach nie znaleziono istotnych hardcoded stringów — dobra konsekwencja użycia `useTranslation()`.

---

## 8. Sugestie funkcjonalne

### 8.1 Brak feedback wizualnego przy auto-assignment
- Kiedy AI przypisuje sesje w tle (`BackgroundServices.tsx`), użytkownik nie widzi co się dzieje. Jedyny feedback to zmiana liczby nieprzypisanych sesji.
- **Sugestia**: Delikatny toast/badge: "AI przypisał 5 sesji" po zakończeniu cyklu.

### 8.2 Brak stanu empty na Dashboard gdy brak danych
- `Dashboard.tsx` — kiedy nie ma żadnych sesji (pierwszy dzień), wyświetla puste karty z zerami.
- **Sugestia**: Wyświetlić onboarding CTA: "Uruchom demona i zacznij monitorować pierwsze aplikacje" z linkiem do DaemonControl/QuickStart.

### 8.3 Session comment bulk edit
- `updateSessionCommentsBatch` istnieje w API (`lib/tauri.ts:210`), ale UI nie eksponuje masowej edycji komentarzy (tylko per-sesja z context menu).
- **Sugestia**: Dodać do multi-select toolbar w Sessions opcję „Dodaj komentarz do zaznaczonych".

### 8.4 Brak auto-freeze feedback
- `autoFreezeProjects` jest wywoływane ale wynik nie jest komunikowany użytkownikowi.
- **Sugestia**: Po zamrożeniu/odmrożeniu — toast z informacją ile projektów zostało zamrożonych.

### 8.5 Ulepszone śledzenie przeglądarek
- `classify_activity_type` w `monitor.rs:181-189` klasyfikuje przeglądarki jako `Browsing`, ale demon nie wykrywa aktywnego URL/tytułu zakładki.
- Window title zawiera URL/tytuł strony — jest już zapisywany w `window_title` i `title_history`.
- **Sugestia**: Parsowanie URL z window title przeglądarek do automatycznego przypisywania do projektów (np. GitHub repo → projekt).

### 8.6 Export raportów do PDF
- `ReportView.tsx` istnieje — sprawdzić czy ma eksport PDF. Jeśli nie, jest to oczywista funkcja do dodania.

---

## 9. Plan prac (priorytetyzowany)

### P1 — Krytyczne (bezpieczeństwo danych, poprawność)
1. **Zunifikować typy DailyData demon↔shared** — demon powinien używać `StoredDailyData` bezpośrednio, usunąć `storage.rs` `to_stored_daily`/`from_stored_daily`. Zakres: `src/storage.rs`, `src/tracker.rs`. ~100 linii mniej.

2. **Dodać indeks `idx_sessions_date ON sessions(date)`** — poprawi wydajność dashboard queries. Zakres: `dashboard/src-tauri/src/db_migrations.rs` (1 linia). Minimalny.

### P2 — Wydajność
3. **Przenieść AI suggestions do jednego `run_db_blocking`** w `sessions/query.rs` — zmniejszy liczbę connection acquire. Zakres: `dashboard/src-tauri/src/commands/sessions/query.rs`, ~50 linii refaktoru.

4. **Cache `compute_project_activity_unique` per request** lub zunifikować endpointy dashboard — jeśli frontend woła `get_dashboard_data` (który już ma stats+projects+timeline), nie powinien osobno wołać `get_dashboard_stats`/`get_timeline`. Sprawdzić usage w frontendzie.

5. **Batch IPC: `get_background_diagnostics_batch`** — zastąpić 4 osobne IPC w `refreshDiagnostics` jedną komendą Tauri. Zakres: nowa komenda Rust + zmiana w `background-status-store.ts`.

6. **Debounce na visibility change** — dodać 500ms debounce w `BackgroundServices.tsx` przy powrocie do okna, żeby uniknąć burst IPC.

### P3 — Jakość kodu
7. **Dodać tabelę `schema_version`** do migracji DB — uniknie ponownego uruchamiania wszystkich migracji przy każdym starcie. Zakres: `db_migrations.rs` + nowa migracja.

8. **Wydzielić `open_dashboard_db_readonly()` w demonie** — zunifikować `config.rs:127-178` i `tray.rs:49-89`. Zakres: nowy helper + refaktor 2 plików.

9. **Usunąć podwójną sanityzację** (tracker + storage) — zostawić tylko w `prepare_daily_for_storage`. Zakres: `src/tracker.rs` ~6 linii.

10. **Dodać stany error w Dashboard.tsx** — obsługa błędów dla stats/topProjects/allProjects.

11. **Rozbić `ProjectPage.tsx` (1531 linii)** na 3-4 sub-komponenty. Zakres: dashboard/src/pages/ + nowy folder components/project-page/.

12. **Rozbić `Projects.tsx` (1445 linii)** na 2-3 sub-komponenty. Zakres: dashboard/src/pages/ + components/projects/.

13. **Wydzielić `<SessionContextMenu>`** z Sessions.tsx (~220 linii inline JSX). Zakres: nowy komponent.

### P4 — Modularyzacja
14. **Przenieść `classify_activity_type` do konfiguracji** lub shared crate — umożliwi dodawanie nowych IDE/przeglądarek bez rekompilacji demona.

15. **Przenieść `MonitoredApp` do shared crate** — zunifikować definicję z `config.rs:14-18` i `commands/types.rs:318-322`.

16. **Podzielić `db_migrations.rs` na folder** — łatwiejsze zarządzanie. Zakres: nowy folder, 0 zmian logicznych.

17. **Rozbić `db.rs:initialize()`** na mniejsze funkcje (`run_vacuum`, `run_backup`, `run_optimize`).

18. **Refaktor `tray.rs`** — wydzielić TrayState struct z metodami. Zakres: ~100 linii refaktoru, 0 zmian behawioralnych.

19. **Zunifikować build scripts** — wspólna logika wersji z `build_all.py` / `build_release.py` do `build_common.py`.

### P5 — UX i funkcje
20. **Dodać sekcję Reports do Help.tsx** — opis szablonów raportów.

21. **Naprawić hardcoded strings w ProjectDayTimeline** — zamienić na klucze i18n.

22. **Dodać toast po AI auto-assignment** — informacja ile sesji przypisano.

23. **Empty state na Dashboard** — onboarding CTA dla nowych użytkowników.

24. **Bulk comment edit w Sessions** — dodać do multi-select toolbar opcję „Dodaj komentarz do zaznaczonych".

---

## 10. Wskazówki dla implementującego

### Zachowanie danych — PRIORYTET #1
- Przed KAŻDĄ zmianą w storage/daily_store: backup testowej bazy, test roundtrip (write→read→verify).
- Migracja typów DailyData (P1.1): NIE zmieniaj formatu SQLite, tylko wewnętrzne typy Rust.
- NIE usuwaj pola `total_time_formatted` z demon DailyData — jest read-only i nieszkodliwe. Zamiast tego, po zunifikowaniu typów, dodaj je jako computed field lub osobne pole tylko w demonie (nie w shared).

### Jak sporządzić plan_implementacji.md
- Każde zadanie jako osobna sekcja z: cel, pliki do zmiany, kroki, test manualny.
- Zacząć od P1 i P2 — dają największy zwrot.
- P3-P5 można robić równolegle, niezależnie od siebie.

### Czego NIE ruszać
- **Build scripts** (`build_all.py`, itp.) — działają, nie refaktorować bez powodu.
- **Shared crate API** (`daily_store::replace_day_snapshot`, `load_day_snapshot`) — stabilne, dobrze przetestowane.
- **Migracje DB** — NIE modyfikować istniejących migracji. Nowe dodawać na końcu.
- **Tłumaczenia** — pełny parytet EN/PL, nie ruszać istniejących kluczy. Nowe klucze dodawać w obu plikach jednocześnie.
- **`BackgroundServices.tsx`** — złożony ale poprawny, job pool jest dobrze zaprojektowany. Zmiany tylko jeśli dodajesz nowy job.

### Testy
- Demon: `cargo test -p timeflow-demon` — uruchomić po zmianach w `storage.rs`, `tracker.rs`, `monitor.rs`.
- Shared: `cargo test -p timeflow-shared` — uruchomić po zmianach w `daily_store/`.
- Dashboard Tauri: `cargo test -p timeflow-dashboard` — uruchomić po zmianach w `commands/`.
- Dashboard TS: `cd dashboard && npx tsc --noEmit` — sprawdzić typy po zmianach w `.tsx`/`.ts`.
- Frontend testy: `cd dashboard && npm test` (jeśli skonfigurowane).

### Konwencje
- Rust: `snake_case` dla zmiennych/funkcji, `CamelCase` dla typów.
- TypeScript: `camelCase` dla zmiennych/funkcji, `PascalCase` dla komponentów/typów.
- UI: nazwa produktu zawsze `TIMEFLOW` (wielkie litery).
- Tłumaczenia: `t('PL text', 'EN text')` w Help.tsx (inline), `t('key')` z plików JSON w reszcie UI.
- Commity: opisowy message, bez emoji.
