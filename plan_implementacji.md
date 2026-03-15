# TIMEFLOW — Plan Implementacji

Źródło: `refactor.md` (analiza z 2026-03-15)

> **ZASADA NADRZĘDNA:** Zachowanie dotychczasowych danych. Żadna zmiana nie może uszkodzić istniejącej bazy SQLite ani formatu daily store. Przed każdą zmianą w warstwie danych — backup + test roundtrip.

---

## Faza 1 — Krytyczne i wydajnościowe (P1 + P2)

### Zadanie 1: Zunifikować typy DailyData demon↔shared

**Cel:** Usunąć ~100 linii konwersji w `src/storage.rs` i wyeliminować ryzyko desynchronizacji pól.

**Pliki do zmiany:**
- `src/storage.rs` — główne zmiany
- `src/tracker.rs` — dostosowanie importów i użycia
- `shared/daily_store/types.rs` — ewentualne dodanie `#[serde(default)]` jeśli brakuje

**Kroki:**
1. W `src/storage.rs` zastąpić lokalne struktury importami z shared:
   ```rust
   // ZAMIAST:
   pub struct DailyData { ... }
   pub struct AppDailyData { ... }
   pub struct Session { ... }
   pub struct FileEntry { ... }

   // UŻYĆ:
   pub use timeflow_shared::daily_store::types::{
       StoredDailyData as DailyData,
       StoredAppDailyData as AppDailyData,
       StoredSession as Session,
       StoredFileEntry as FileEntry,
   };
   ```
2. Usunąć `to_stored_daily()` (linie 149-189) i `from_stored_daily()` (linie 191-240) — nie są już potrzebne.
3. Zaktualizować `save_daily_data()` — zamiast `data.to_stored_daily()`, przekazywać `data` bezpośrednio do `replace_day_snapshot`.
4. Zaktualizować `load_daily_data()` — zamiast `DailyData::from_stored_daily(stored)`, użyć `stored` bezpośrednio.
5. **Problem:** Pole `total_time_formatted` (storage.rs:31) istnieje TYLKO w demon-side `AppDailyData`, nie jest w shared `StoredAppDailyData`. Rozwiązanie: nie dodawać go do shared — jest obliczany w locie przez `update_summary()`. Zamiast tego trzymać go w osobnej HashMap lub strukturze `DailySummary`.
6. Sprawdzić `src/tracker.rs` linie 200-205 — sanityzacja korzysta z `storage::sanitize_*`. Te funkcje zostają — zmieniamy tylko typy danych.
7. Sprawdzić `HashMap` vs `BTreeMap` — demon używa `HashMap<String, AppDailyData>`, shared `BTreeMap<String, StoredAppDailyData>`. Po unifikacji demon będzie używał `BTreeMap` — to OK, kolejność kluczy nie wpływa na logikę.

**Uwagi:**
- `DailySummary` zostaje w `storage.rs` — nie jest częścią shared, jest kalkulowana w runtime.
- `update_summary()` (storage.rs) używa `total_time_formatted` — po usunięciu pola z struktury, przenieść do `DailySummary` lub obliczać inline.
- NIE zmieniaj formatu SQLite — shared types mają te same pola, różnica jest tylko w nazewnictwie Rust.

**Test:**
- `cargo test -p timeflow-demon`
- `cargo test -p timeflow-shared`
- Uruchomić demona, sprawdzić czy sesje się zapisują i odczytują z `data/` poprawnie.
- Sprawdzić czy dashboard nadal widzi dane z demona (import daily files).

---

### Zadanie 2: Dodać indeks `sessions(date)`

**Cel:** Przyspieszyć zapytania dashboard filtrujące po zakresie dat bez `app_id`.

**Pliki do zmiany:**
- `dashboard/src-tauri/src/db_migrations.rs` — dodać na końcu pliku

**Kroki:**
1. Dodać nową migrację na końcu `run_migrations()`:
   ```rust
   // Indeks na sessions.date — poprawia wydajność zapytań dashboard (stats, timeline, heatmap)
   conn.execute_batch(
       "CREATE INDEX IF NOT EXISTS idx_sessions_date_standalone ON sessions(date);"
   ).ok();
   ```
2. Nazwa: `idx_sessions_date_standalone` (nie `idx_sessions_date`, bo może kolidować z istniejącym).

**Test:**
- Uruchomić dashboard, sprawdzić logi startu — migracja powinna przejść bez błędu.
- `.explain query plan` na `SELECT ... FROM sessions WHERE date >= ? AND date <= ?` — powinien użyć nowego indeksu.

---

### Zadanie 3: AI suggestions — jeden `run_db_blocking`

**Cel:** Zmniejszyć overhead: 2 × spawn_blocking + 2 × connection acquire → 1 × każde.

**Pliki do zmiany:**
- `dashboard/src-tauri/src/commands/sessions/query.rs` — linie ~437-558

**Kroki:**
1. Znaleźć drugi `run_db_blocking` w `get_sessions` (zaczyna się po pierwszym bloku, ok. linia 440).
2. Przenieść logikę AI suggestions (suggest_projects_for_sessions_with_status + suggest_projects_for_sessions_raw) do PIERWSZEGO bloku `run_db_blocking`, tuż po pobraniu sesji.
3. Zwrócić z jednego bloku: `(sessions, suggestion_map)` zamiast dwóch osobnych wywołań.
4. Upewnić się, że `conn` jest nadal żywe (nie zwolnione) — w jednym bloku `run_db_blocking` połączenie jest trzymane przez cały czas.

**Test:**
- Otworzyć stronę Sessions z włączonymi AI suggestions.
- Sprawdzić czy sugestie projektów pojawiają się poprawnie.
- Logi: powinien być 1 × `run_db_blocking` zamiast 2.

---

### Zadanie 4: Sprawdzić frontend usage `compute_project_activity_unique`

**Cel:** Upewnić się, że frontend nie woła osobnych endpointów (get_dashboard_stats, get_top_projects itp.) gdy `get_dashboard_data` już zwraca te dane.

**Pliki do sprawdzenia:**
- `dashboard/src/pages/Dashboard.tsx` — grep po `getDashboardStats`, `getTopProjects`, `getTimeline`, `getHourlyBreakdown`
- `dashboard/src/lib/tauri.ts` — definicje invoke

**Kroki:**
1. Przeszukać cały frontend (`dashboard/src/`) po wywołaniach: `getDashboardStats`, `getTopProjects`, `getDashboardProjects`, `getTimeline`, `getHourlyBreakdown`.
2. Jeśli są używane osobno (poza `getDashboardData`) — sprawdzić czy to konieczne. Jeśli nie, usunąć osobne endpointy i używać wyłącznie `getDashboardData`.
3. Jeśli są wywoływane z innych stron (np. TimeAnalysis) — zostawić, ale rozważyć cache w backendzie (TTL 2-5s na wynik `compute_project_activity_unique` per date_range).

**Test:**
- Dashboard powinien ładować się tak samo jak przed zmianą.

---

### Zadanie 5: Batch IPC dla diagnostyk

**Cel:** Zastąpić 4 osobne IPC w `refreshDiagnostics` jedną komendą.

**Pliki do zmiany:**
- `dashboard/src-tauri/src/commands/daemon/mod.rs` — nowa komenda `get_background_diagnostics`
- `dashboard/src-tauri/src/commands/types.rs` — nowy typ `BackgroundDiagnostics`
- `dashboard/src-tauri/src/lib.rs` — zarejestrować komendę
- `dashboard/src/lib/tauri.ts` — nowa funkcja invoke
- `dashboard/src/store/background-status-store.ts` — zmienić `refreshDiagnostics`

**Kroki:**
1. Nowy typ w `types.rs`:
   ```rust
   #[derive(Serialize)]
   pub struct BackgroundDiagnostics {
       pub daemon_status: DaemonStatus,
       pub ai_status: AssignmentModelStatus,
       pub today_unassigned: i64,
       pub all_unassigned: i64,
   }
   ```
2. Nowa komenda w `daemon/mod.rs`:
   ```rust
   #[tauri::command]
   pub async fn get_background_diagnostics(app: AppHandle) -> Result<BackgroundDiagnostics, String> {
       run_app_blocking(app, |app| {
           let daemon = build_daemon_status(&app, None, true, false)?;
           let ai = build_assignment_model_status(&app)?;
           let min_duration = ...; // z session settings
           let today = build_today_date();
           let today_count = count_sessions(&app, Some((today, today)), true, min_duration)?;
           let all_count = count_sessions(&app, None, true, min_duration)?;
           Ok(BackgroundDiagnostics { daemon_status: daemon, ai_status: ai, today_unassigned: today_count, all_unassigned: all_count })
       }).await
   }
   ```
3. Zarejestrować w `lib.rs` w `invoke_handler`.
4. W frontendzie: `background-status-store.ts` — zamienić `Promise.allSettled([...4 calls...])` na jeden `invoke('get_background_diagnostics')`.

**Test:**
- Sidebar powinien pokazywać poprawnie: wersję demona, badge nieprzypisanych sesji, status AI.
- Mniejszy burst IPC w DevTools Network po przełączeniu okna.

---

### Zadanie 6: Debounce na visibility change

**Cel:** Uniknąć burst IPC przy szybkim przełączaniu okien.

**Pliki do zmiany:**
- `dashboard/src/components/sync/BackgroundServices.tsx` — handler visibility change (~linia 401-417)

**Kroki:**
1. Dodać `useRef` na timeout:
   ```typescript
   const visibilityDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
   ```
2. W `handleVisibilityChange` — opakować w debounce:
   ```typescript
   const handleVisibilityChange = useEffectEvent(() => {
       if (visibilityDebounceRef.current) clearTimeout(visibilityDebounceRef.current);
       if (!isDocumentVisible()) return;
       visibilityDebounceRef.current = setTimeout(() => {
           refreshSyncSettingsCache();
           nextDiagnosticsRef.current = 0;
           handleDiagnosticsRefresh();
           // ... reszta
       }, 500);
   });
   ```
3. Cleanup w useEffect return.

**Test:**
- Szybko przełączać się między oknami — dashboard nie powinien robić burst IPC po każdym przełączeniu.

---

## Faza 2 — Jakość kodu (P3)

### Zadanie 7: Tabela `schema_version` w migracyjach

**Cel:** Uniknąć uruchamiania wszystkich migracji przy każdym starcie.

**Pliki do zmiany:**
- `dashboard/src-tauri/src/db_migrations.rs`

**Kroki:**
1. Na początku `run_migrations()` dodać:
   ```rust
   conn.execute_batch(
       "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL DEFAULT 0);"
   ).map_err(|e| e.to_string())?;

   let current_version: i64 = conn.query_row(
       "SELECT COALESCE(MAX(version), 0) FROM schema_version", [], |r| r.get(0)
   ).unwrap_or(0);
   ```
2. Opatrzyć każdą migrację numerem wersji. Uruchamiać tylko te z `version > current_version`.
3. Po wykonaniu wszystkich nowych migracji:
   ```rust
   conn.execute("INSERT OR REPLACE INTO schema_version (rowid, version) VALUES (1, ?1)", [LATEST_VERSION]).ok();
   ```
4. `LATEST_VERSION` = const na początku pliku, inkrementowany przy każdej nowej migracji.

**UWAGA:** Istniejące migracje są idempotentne (CHECK IF EXISTS). Przy pierwszym uruchomieniu z nowym systemem: `current_version = 0`, wszystkie migracje przebiegną jak dotąd, a potem zapisze się najnowsza wersja. Następne starty pomijają wszystko.

**Test:**
- Pierwsze uruchomienie: pełna migracja, zapis wersji.
- Drugie uruchomienie: startup widocznie szybszy (logi migracji pominięte).

---

### Zadanie 8: Helper `open_dashboard_db_readonly` w demonie

**Cel:** Zunifikować otwarcie dashboard DB w demonie (config.rs + tray.rs).

**Pliki do zmiany:**
- `src/config.rs` — wydzielić helper
- `src/tray.rs` — użyć helpera

**Kroki:**
1. W `src/config.rs` dodać publiczną funkcję:
   ```rust
   pub fn open_dashboard_db_readonly() -> Result<rusqlite::Connection> {
       let db_path = config_dir()?.join("timeflow_dashboard.db");
       if !db_path.exists() { return Err(anyhow!("Dashboard DB not found")); }
       let conn = rusqlite::Connection::open_with_flags(&db_path,
           rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
       conn.busy_timeout(std::time::Duration::from_millis(2000))?;
       Ok(conn)
   }
   ```
2. `load_monitored_apps_from_dashboard_db()` (config.rs:127) — zamienić linie 130-145 na `let conn = open_dashboard_db_readonly()?;`.
3. `query_unassigned_attention_count()` (tray.rs:49) — zamienić otwarcie na `config::open_dashboard_db_readonly()`.

**Test:**
- Demon powinien nadal czytać monitored apps i attention count.
- Demon bez zainstalowanego dashboardu: powinien logować brak DB i kontynuować.

---

### Zadanie 9: Usunąć podwójną sanityzację

**Cel:** Sanityzacja jednokrotna — tylko przy zapisie (storage), nie przy każdym pollu (tracker).

**Pliki do zmiany:**
- `src/tracker.rs` linie 200-205

**Kroki:**
1. Usunąć sanityzację w trackerze (linie 200-205):
   ```rust
   // USUNĄĆ te linie:
   // let normalized_detected_path = detected_path.map(storage::sanitize_detected_path)...;
   // let normalized_window_title = storage::sanitize_window_title(window_title);
   // let normalized_file_name = storage::sanitize_file_entry_name(file_name);
   ```
2. Użyć surowych wartości z monitora: `file_name`, `window_title`, `detected_path` bezpośrednio.
3. `prepare_daily_for_storage()` (storage.rs:114-142) już sanityzuje WSZYSTKO przed zapisem — to wystarczy.

**UWAGA:** Upewnić się, że `update_summary()` i logika w `tracker.rs` (matching file entries) nie polega na sanityzowanych wartościach. Jeśli tak — zostawić sanityzację w trackerze i usunąć z storage. Ważne: wybrać JEDNO miejsce.

**Test:**
- Uruchomić demona, monitorować kilka aplikacji z polskimi znakami w tytule okna.
- Sprawdzić daily JSON w `data/` — pola powinny być poprawnie zsanityzowane.

---

### Zadanie 10: Stany error w Dashboard.tsx

**Cel:** Wyświetlać komunikat błędu zamiast pustego UI.

**Pliki do zmiany:**
- `dashboard/src/pages/Dashboard.tsx`

**Kroki:**
1. Dodać state:
   ```typescript
   const [loadError, setLoadError] = useState<string | null>(null);
   ```
2. W catch bloku ładowania danych (tam gdzie teraz jest `projectTimelineError`):
   ```typescript
   .catch((err) => {
       setLoadError(String(err));
       setProjectTimelineError(String(err));
   });
   ```
3. W JSX, na początku main content:
   ```tsx
   {loadError && (
       <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md mb-4">
           <AlertTriangle className="h-4 w-4" />
           <span className="text-sm">{t('dashboard_page.error_loading_data')}: {loadError}</span>
       </div>
   )}
   ```
4. Dodać klucze i18n w obu plikach (`en/common.json`, `pl/common.json`):
   - `dashboard_page.error_loading_data` → EN: "Error loading data" / PL: "Błąd ładowania danych"

**Test:**
- Zatrzymać demona, usunąć tymczasowo plik DB — dashboard powinien wyświetlić komunikat błędu.

---

### Zadanie 11: Rozbić `ProjectPage.tsx` (1531 linii)

**Cel:** Podział na mniejsze, zarządzalne komponenty.

**Pliki do utworzenia:**
- `dashboard/src/components/project-page/ProjectOverview.tsx`
- `dashboard/src/components/project-page/ProjectSessionsList.tsx`
- `dashboard/src/components/project-page/ProjectTimelineSection.tsx`
- `dashboard/src/components/project-page/ProjectEstimatesSection.tsx`

**Kroki:**
1. Zidentyfikować sekcje JSX w `ProjectPage.tsx` — każda sekcja to osobny komponent.
2. Przenieść JSX + lokalne handlery do nowych komponentów.
3. Props: przekazywać dane i callbacki, unikać prop drilling >2 poziomy (użyć context lub hooksa jeśli potrzeba).
4. `ProjectPage.tsx` staje się orkiestratorem: ładuje dane, trzyma state, renderuje sub-komponenty.

**Test:**
- `cd dashboard && npx tsc --noEmit`
- Otworzyć stronę projektu — powinna wyglądać i działać identycznie.

---

### Zadanie 12: Rozbić `Projects.tsx` (1445 linii)

**Cel:** Podział na logiczne sekcje.

**Pliki do utworzenia:**
- `dashboard/src/components/projects/ProjectsList.tsx`
- `dashboard/src/components/projects/ExcludedProjectsList.tsx`
- `dashboard/src/components/projects/ProjectDiscoveryPanel.tsx`

**Kroki:** Analogiczne do Zadania 11.

---

### Zadanie 13: Wydzielić `<SessionContextMenu>`

**Cel:** Wyciągnąć ~220 linii inline context menu z `Sessions.tsx`.

**Pliki do utworzenia:**
- `dashboard/src/components/sessions/SessionContextMenu.tsx`

**Kroki:**
1. Wyciąć JSX z `Sessions.tsx` linie 890-1113.
2. Przenieść do nowego komponentu z propsami:
   ```typescript
   interface SessionContextMenuProps {
       session: SessionRow;
       position: { x: number; y: number };
       projects: Project[];
       onAssign: (sessionId: string, projectId: string) => void;
       onClose: () => void;
       // ... inne handlery
   }
   ```
3. W `Sessions.tsx` zastąpić wycięty JSX na `<SessionContextMenu ... />`.

**Test:**
- `cd dashboard && npx tsc --noEmit`
- Right-click na sesji — context menu powinno działać identycznie.

---

## Faza 3 — Modularyzacja (P4)

### Zadanie 14: `classify_activity_type` → konfiguracja

**Pliki do zmiany:**
- `shared/` — nowy plik `activity_classification.rs` z domyślną mapą exe→type
- `src/monitor.rs` — użyć shared + override z konfiguracji
- Opcjonalnie: `src/config.rs` — nowe pole `activity_type_overrides: HashMap<String, String>`

**Kroki:**
1. Przenieść domyślną mapę (monitor.rs:160-209) do `shared/activity_classification.rs`.
2. Demon: łączy domyślną mapę z overrides z konfiguracji (`config.json` lub `monitored_apps`).
3. Format konfiguracji:
   ```json
   { "activity_type_overrides": { "myapp.exe": "Development", "slack.exe": "Communication" } }
   ```

---

### Zadanie 15: `MonitoredApp` → shared crate

**Pliki do zmiany:**
- `shared/src/lib.rs` — dodać moduł
- `shared/src/monitored_app.rs` — przenieść definicję
- `src/config.rs` — zmienić import
- `dashboard/src-tauri/src/commands/types.rs` — zmienić import

**Kroki:**
1. Przenieść struct `MonitoredApp` (3 pola: exe_name, display_name, added_at) do `shared/src/monitored_app.rs`.
2. Dodać `pub mod monitored_app;` w `shared/src/lib.rs`.
3. W demonie i dashboardzie: `use timeflow_shared::monitored_app::MonitoredApp;`.

---

### Zadanie 16: Podzielić `db_migrations.rs` na folder

**Pliki do utworzenia:**
- `dashboard/src-tauri/src/db_migrations/mod.rs` — główna funkcja `run_migrations()`
- `dashboard/src-tauri/src/db_migrations/v1_initial.rs`
- `dashboard/src-tauri/src/db_migrations/v2_extensions.rs`
- itd.

**Kroki:**
1. Podzielić istniejące migracje na logiczne grupy.
2. Każda grupa to osobna funkcja wywoływana z `run_migrations()`.
3. Z zadaniem 7 (schema_version) — każda grupa ma przypisany numer wersji.

---

### Zadanie 17: Rozbić `db.rs:initialize()`

**Pliki do zmiany:**
- `dashboard/src-tauri/src/db.rs`

**Kroki:**
1. Wydzielić z `initialize()` (linie 174-283):
   - `fn maybe_vacuum(conn: &Connection, settings: &HashMap) -> Result<()>`
   - `fn maybe_backup(conn: &Connection, settings: &HashMap) -> Result<()>`
   - `fn maybe_optimize(conn: &Connection, settings: &HashMap) -> Result<()>`
2. `initialize()` staje się orkiestratorem: open → migrate → vacuum → backup → optimize → create pools.

---

### Zadanie 18: Refaktor `tray.rs`

**Pliki do zmiany:**
- `src/tray.rs`

**Kroki:**
1. Stworzyć `struct TrayState` zawierający wszystkie `Rc<RefCell<...>>` pola.
2. Dodać metody: `handle_timer_tick()`, `handle_context_menu()`, `handle_menu_item()`.
3. Event handler closure deleguje do metod `TrayState`.

---

### Zadanie 19: Zunifikować build scripts

**Pliki do zmiany:**
- `build_common.py` — dodać logikę wersji
- `build_all.py` — użyć z build_common
- `build_release.py` — dziedziczyć z build_all + dodać ZIP

**Kroki:**
1. W `build_common.py` dodać:
   ```python
   def handle_version(root: Path) -> str:
       """Obsługa wersji: odczyt, input, walidacja, zapis."""
       ...
   ```
2. `build_all.py` i `build_release.py` — zamienić duplikat na `from build_common import handle_version`.

---

## Faza 4 — UX i funkcje (P5)

### Zadanie 20: Sekcja Reports w Help.tsx

**UWAGA:** Agent analityczny wskazał, że Reports JUŻ JEST w Help.tsx (linie 710-733). Sprawdzić kompletność opisów. Jeśli brak — uzupełnić o: eksport PDF, filtry dat, customowe pola.

---

### Zadanie 21: Naprawić hardcoded strings w ProjectDayTimeline

**Pliki do zmiany:**
- `dashboard/src/components/dashboard/ProjectDayTimeline.tsx` — linie 58, 318, 409

**Kroki:**
1. Linia 58: zamienić `title = "Activity Timeline"` na `title?: string`.
2. Linia 409: zamienić porównanie stringów na:
   ```tsx
   <span>{title ?? t('project_day_timeline.text.activity_timeline')}</span>
   ```
3. Linia 318: `title: "Session comment"` → `title: t('...')`.
4. Dodać brakujące klucze i18n.

---

### Zadanie 22: Toast po AI auto-assignment

**Pliki do zmiany:**
- `dashboard/src/components/sync/BackgroundServices.tsx` — po wywołaniu AI assignment
- Użyć istniejącego mechanizmu toastów (sprawdzić czy jest Sonner/toast w projekcie)

---

### Zadanie 23: Empty state na Dashboard

**Pliki do zmiany:**
- `dashboard/src/pages/Dashboard.tsx`

**Kroki:**
1. Po załadowaniu danych sprawdzić: jeśli `stats.totalTime === 0` i brak sesji → wyświetlić CTA:
   ```tsx
   <div className="flex flex-col items-center gap-4 py-12">
       <Rocket className="h-12 w-12 text-muted-foreground/40" />
       <p>{t('dashboard_page.empty_state_title')}</p>
       <Button onClick={() => setCurrentPage('daemon')}>{t('dashboard_page.go_to_daemon')}</Button>
   </div>
   ```
2. Dodać klucze i18n PL+EN.

---

### Zadanie 24: Bulk comment edit w Sessions

**Pliki do zmiany:**
- `dashboard/src/pages/Sessions.tsx` — multi-select toolbar
- Backend `updateSessionCommentsBatch` już istnieje (`lib/tauri.ts:210`)

**Kroki:**
1. Do multi-select toolbar dodać przycisk „Komentarz" (ikona MessageSquare).
2. Po kliknięciu: prompt/dialog z textarea.
3. Po zatwierdzeniu: `updateSessionCommentsBatch(selectedIds, comment)`.

---

## Kolejność realizacji

```
Faza 1 (P1+P2):  Zadania 1→2→3→4→5→6    (najpierw dane i wydajność)
Faza 2 (P3):     Zadania 7→8→9→10         (jakość — niezależne od siebie)
                  Zadania 11→12→13         (refaktor komponentów — mogą iść równolegle)
Faza 3 (P4):     Zadania 14→15→16→17→18→19 (modularyzacja — niezależne)
Faza 4 (P5):     Zadania 20→21→22→23→24    (UX — niezależne)
```

Zadania w ramach jednej fazy mogą być realizowane równolegle (chyba że zaznaczono inaczej). Fazy powinny być realizowane sekwencyjnie — każda kolejna buduje na poprzedniej.

---

## Checklist przed każdym zadaniem

- [ ] Przeczytać aktualny kod plików do zmiany (nie zakładać, że numery linii z tego dokumentu są nadal aktualne)
- [ ] Backup bazy danych (przy zmianach P1/P2)
- [ ] Po zmianach: `cargo test`, `npx tsc --noEmit`
- [ ] Tłumaczenia: nowe klucze w OBIE pliki (en + pl)
- [ ] Help.tsx: jeśli zmiana dotyka UX — zaktualizować Help
