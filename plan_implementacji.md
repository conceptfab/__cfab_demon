# TIMEFLOW — Szczegółowy plan implementacji

> Źródło: `refactor.md` (analiza z 2026-03-14)
> Priorytet: zachowanie danych użytkownika, kompatybilność wstecz.
> Każda pozycja = osobny commit. Po każdej zmianie: `cargo build` (Rust) / `npx tsc --noEmit` (TS z `dashboard/`).

---

## Zasady ogólne

1. **Nie kasuj danych** — migracje SQLite wyłącznie addytywne (`CREATE INDEX IF NOT EXISTS`, `ALTER TABLE ADD COLUMN`).
2. **Nie zmieniaj sygnatur `#[tauri::command]`** bez jednoczesnej aktualizacji wywołań TS (`invoke()`).
3. **Testuj kompilację** po każdej zmianie:
   - Rust daemon: `cargo build` z katalogu głównego
   - Tauri backend: `cd dashboard/src-tauri && cargo build`
   - Frontend: `cd dashboard && npx tsc --noEmit`
4. **Help.tsx**: Każdy tekst w parze PL+EN: `t('tekst PL', 'text EN')`. Format: komponent `SectionHelp` z `icon, title, description, features[], footer`.

---

## FAZA 1: Wydajność i bezpieczeństwo danych

### 1.1 Dodanie brakujących indeksów SQLite

**Cel**: Przyspieszenie zapytań `WHERE date >= ? AND date <= ?` bez `app_id` oraz `JOIN` na `assignment_suggestions.session_id`.

**Plik**: `dashboard/src-tauri/src/db_migrations.rs`
**Lokalizacja**: Funkcja `ensure_post_migration_indexes()` — po linii 760 (ostatni istniejący `CREATE INDEX`)

**Dodaj:**
```rust
// Po linii 760 (idx_assignment_feedback_session):
conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date)").ok();
conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_assignment_suggestions_session_id ON assignment_suggestions(session_id, id)").ok();
```

**Wzorzec**: Identyczny jak istniejące indeksy w liniach 752-760 (`.ok()` ignoruje błąd gdy indeks istnieje).

**Weryfikacja**: Po uruchomieniu aplikacji sprawdź `EXPLAIN QUERY PLAN SELECT MIN(date) FROM sessions` — powinien używać `idx_sessions_date`.

---

### 1.2 VACUUM/backup asynchroniczny przy starcie

**Cel**: Nie blokować UI podczas VACUUM/backup/optimize.

**Plik**: `dashboard/src-tauri/src/db.rs`
**Lokalizacja**: Funkcja `initialize()` — linie 187-268 (inline vacuum/backup/optimize)

**Zmiana**:
1. Wydziel linie 187-268 do osobnej funkcji:
```rust
fn run_maintenance_tasks(path_str: String) {
    // Przenieś tutaj logikę vacuum (linie 188-197), backup (200-239), optimize (242-268)
    // Otwórz własne połączenie: let conn = rusqlite::Connection::open(&path_str)...
}
```

2. W `initialize()`, zamiast inline kodu, wywołaj:
```rust
let maintenance_path = path_str.clone();
std::thread::spawn(move || {
    if let Err(e) = run_maintenance_tasks(maintenance_path) {
        log::error!("Maintenance tasks failed: {}", e);
    }
});
```

**UWAGA**: `initialize()` jest synchroniczna i wywoływana w `setup()` Tauri. Pool musi być gotowy PRZED maintenance. Maintenance otwiera własne połączenie (nie z poola), więc nie koliduje.

**Weryfikacja**: Aplikacja powinna startować szybciej (brak kilkusekundowego blokowania na VACUUM). Sprawdź logi — maintenance powinien raportować wyniki asynchronicznie.

---

### 1.3 Persistent SQLite connection w daemon

**Cel**: Unikanie otwierania nowego połączenia SQLite przy każdym `save_daily`.

**Pliki**:
- `src/storage.rs` — zmiana sygnatury `save_daily`
- `src/tracker.rs` — otwarcie połączenia raz w `run_loop`

**Krok 1** — `src/storage.rs`:

Zmień prywatną funkcję `open_daily_store()` (linie 144-147) na publiczną:
```rust
pub fn open_daily_store() -> Result<rusqlite::Connection> {  // zmiana: pub zamiast bez modyfikatora
    let base_dir = config::config_dir()?;
    crate::daily_store::open_store(&base_dir).map_err(anyhow::Error::msg)
}
```

Zmień `save_daily` (linie 268-277) — dodaj parametr `conn`:
```rust
pub fn save_daily(data: &mut DailyData, conn: &mut rusqlite::Connection) -> Result<()> {
    data.generated_at = Local::now().to_rfc3339();
    prepare_daily_for_storage(data);
    update_summary(data);
    crate::daily_store::replace_day_snapshot(conn, &to_stored_daily(data))
        .map(|_| ())
        .map_err(anyhow::Error::msg)
}
```

**Krok 2** — `src/tracker.rs`:

W `run_loop()` (linia 302), na początku funkcji po inicjalizacji zmiennych, dodaj:
```rust
let mut db_conn = storage::open_daily_store()?;
```

Zmień wszystkie 3 wywołania `storage::save_daily(&mut daily_data)`:
- Linia 347: `storage::save_daily(&mut daily_data, &mut db_conn)`
- Linia 355: `storage::save_daily(&mut daily_data, &mut db_conn)` + po zmianie daty ponownie otwórz: `db_conn = storage::open_daily_store()?;` (nowy dzień = potencjalnie nowy plik)
- Linia 506: `storage::save_daily(&mut daily_data, &mut db_conn)`

**Weryfikacja**: `cargo build` powinien przejść bez błędów. Daemon powinien zapisywać dane jak wcześniej, ale bez overhead otwarcia połączenia.

---

### 1.4 Usunięcie ghost field `file_path` z FileActivity

**Cel**: Usunięcie martwego pola które nigdy nie jest zwracane z backendu.

**Plik 1**: `dashboard/src/lib/db-types.ts`
**Linia 38**: Usuń `file_path?: string;` z interfejsu `FileActivity` (linie 34-45)

**Plik 2**: `dashboard/src/lib/session-utils.ts`
**Linia 38**: Usuń porównanie `(left.file_path ?? null) === (right.file_path ?? null) &&` z `areFileActivitiesEqual` (linie 30-46)

**Weryfikacja**: `npx tsc --noEmit` — jeśli jakikolwiek plik odwołuje się do `file_path` na `FileActivity`, TypeScript zgłosi błąd. Popraw te odwołania.

---

## FAZA 2: Duplikaty i czystość kodu

### 2.1 Eksport `local_from_naive` z datetime.rs

**Cel**: Eliminacja zduplikowanej funkcji.

**Plik 1**: `dashboard/src-tauri/src/commands/datetime.rs`
**Linia 3**: Zmień `fn local_from_naive` na `pub(crate) fn local_from_naive`

**Plik 2**: `dashboard/src-tauri/src/commands/analysis.rs`
**Linia 1** (imports): Dodaj `use super::datetime::local_from_naive;`
**Linie 142-148**: Usuń całą zduplikowaną funkcję `fn local_from_naive`

**Weryfikacja**: `cd dashboard/src-tauri && cargo build` — `analysis.rs` musi kompilować się z importowaną wersją.

---

### 2.2 Usunięcie martwego pola `total_time_formatted`

**Cel**: Usunięcie kodu który generuje dane nigdy nie odczytywane.

**Plik**: `src/storage.rs`

**Krok 1**: Znajdź struct `AppDailyData` (okolice linii 30) — usuń pole `total_time_formatted: String`

**Krok 2**: Znajdź `update_summary()` (okolice linii 295-307) — usuń linię przypisującą `total_time_formatted = format_duration(...)`

**Krok 3**: Znajdź `format_duration()` (linie 309-314) — usuń całą funkcję (jeśli nie jest używana gdzie indziej). Sprawdź `grep -r "format_duration" src/` — jeśli jedyne użycie to `update_summary`, bezpiecznie usunąć.

**Krok 4**: Znajdź `new()` lub inicjalizator `AppDailyData` — usuń inicjalizację pola `total_time_formatted`.

**Weryfikacja**: `cargo build` z katalogu głównego. Brak wpływu na dane — pole nigdy nie trafiało do SQLite.

---

### 2.3 Usunięcie zbędnego `to_lowercase()` w monitor.rs

**Plik**: `src/monitor.rs`
**Linia 158**: Zmień `let exe = exe_name.to_lowercase();` na `let exe = exe_name;` (lub użyj `exe_name` bezpośrednio w match'ach poniżej)

**Kontekst**: `exe_name` trafia do `classify_activity_type` z `get_exe_name_and_creation_time`, które już zwraca lowercase. Duplikowanie `to_lowercase()` to zbędna alokacja String w gorącej ścieżce (wywoływanej co 10s per aplikacja).

**UWAGA**: Upewnij się, że WSZYSTKIE ścieżki wywołania `classify_activity_type` przekazują lowercase. Sprawdź `grep -n "classify_activity_type" src/` — jeśli istnieją wywołania z nie-lowercase argumentem, zachowaj `to_lowercase()`.

**Weryfikacja**: `cargo build` + sprawdź czy demon poprawnie klasyfikuje aktywność (coding/browsing/design).

---

### 2.4 Zmiana nazwy `inferred_project_by_session`

**Plik**: `dashboard/src-tauri/src/commands/sessions/query.rs`
**Linia 338**: Zmień `let mut inferred_project_by_session` na `let mut suggested_project_by_session`
**Wszystkie użycia**: Znajdź `grep -n "inferred_project_by_session" dashboard/src-tauri/src/commands/sessions/query.rs` i zmień każde wystąpienie.

**Weryfikacja**: `cd dashboard/src-tauri && cargo build`

---

### 2.5 Ujednolicenie event-listening na stronach

**Cel**: Zastąpienie ręcznych `window.addEventListener` hookiem `usePageRefreshListener`.

**Wzorzec** (z `dashboard/src/hooks/usePageRefreshListener.ts`, linie 1-47):
```typescript
usePageRefreshListener((reasons, source) => {
  if (reasons.some(r => shouldRefreshXxxPage(r))) {
    // reload data
  }
});
```

**Plik 1**: `dashboard/src/pages/Dashboard.tsx`
- **Linie 323-358**: useEffect z ręcznymi listenerami
- Zastąp cały useEffect wywołaniem `usePageRefreshListener`
- Import: `import { usePageRefreshListener } from '../hooks/usePageRefreshListener';`
- Callback: sprawdź `shouldRefreshDashboardPage(reason)` dla każdego `reason` z tablicy `reasons`

**Plik 2**: `dashboard/src/pages/Estimates.tsx`
- **Linie 89-124**: useEffect z ręcznymi listenerami
- Analogiczna zmiana z `shouldRefreshEstimatesPage`

**Plik 3**: `dashboard/src/pages/Applications.tsx`
- **Linie 115-150**: useEffect z ręcznymi listenerami
- Analogiczna zmiana z `shouldRefreshApplicationsPage`

**Plik 4**: `dashboard/src/pages/ProjectPage.tsx`
- Znajdź ręczne listenery (szukaj `addEventListener.*LOCAL_DATA_CHANGED`) i zastąp analogicznie

**UWAGA**: Hook `usePageRefreshListener` przekazuje tablicę `reasons` i `source` ('app' | 'local'). Istniejący kod sprawdza `event.detail?.reason` (string). Upewnij się że callback prawidłowo iteruje po tablicy.

**Weryfikacja**: `npx tsc --noEmit` + manualne testy: zmiana zakresu dat na Dashboard, Estimates, Applications powinna nadal triggerować odświeżenie.

---

### 2.6 Wydzielenie equality helpers

**Cel**: Centralizacja funkcji porównujących w jednym pliku.

**Nowy plik**: `dashboard/src/lib/equality-utils.ts`

```typescript
// Przenieś z background-status-store.ts (linie 21-97):
export function areStringArraysEqual(a: string[], b: string[]): boolean { ... }
export function areDaemonStatusesEqual(a: DaemonStatus, b: DaemonStatus): boolean { ... }
export function areAssignmentStatusesEqual(a: AssignmentModelStatus, b: AssignmentModelStatus): boolean { ... }
export function areDatabaseSettingsEqual(a: DatabaseSettings, b: DatabaseSettings): boolean { ... }

// Przenieś z AI.tsx (linie 111-157):
export function areMetricsEqual(a: AssignmentModelMetrics | null, b: AssignmentModelMetrics | null): boolean { ... }
```

**Pliki do aktualizacji**:
- `dashboard/src/store/background-status-store.ts` (linie 21-97) — zastąp definicje importami
- `dashboard/src/pages/AI.tsx` (linie 111-157) — zastąp definicję importem

**Weryfikacja**: `npx tsc --noEmit`

---

### 2.7 Wydzielenie `resolveContextMenuPlacement`

**Cel**: Jedna implementacja pozycjonowania menu kontekstowego.

**Stan obecny**:
- `dashboard/src/pages/Sessions.tsx` (linie 238-264) — inline wersja
- `dashboard/src/components/dashboard/project-day-timeline/timeline-calculations.ts` (linie 106-139) — osobna eksportowana wersja z interfejsem `ContextMenuPlacement` (linie 53-57)

**Strategia**: Wersja z `timeline-calculations.ts` jest już eksportowana i ma lepszą sygnaturę. Użyj jej w `Sessions.tsx`.

**Plik**: `dashboard/src/pages/Sessions.tsx`
- **Linia ~1 (imports)**: Dodaj `import { resolveContextMenuPlacement } from '../components/dashboard/project-day-timeline/timeline-calculations';`
- **Linie 238-264**: Usuń lokalną funkcję `resolveContextMenuPlacement`
- Dostosuj wywołania (jeśli sygnatura się różni — porównaj parametry obu wersji)

**Alternatywa**: Jeśli sygnatury są zbyt różne, przenieś obie wersje do `dashboard/src/lib/context-menu-utils.ts` jako osobne eksporty i zaimportuj z obu miejsc.

**Weryfikacja**: `npx tsc --noEmit` + przetestuj otwarcie context menu w Sessions i ProjectDayTimeline.

---

## FAZA 3: Modularyzacja

### 3.1 Wydzielenie SessionContextMenu z Sessions.tsx

**Cel**: Zmniejszenie Sessions.tsx z 1167 do ~750 linii.

**Nowy plik**: `dashboard/src/components/sessions/SessionContextMenu.tsx`

**Co przenieść z `Sessions.tsx`**:
- Interfejs `ContextMenu` (linie 70-74)
- JSX context menu (linie 890-1112) — renderowanie menu przypisania projektu
- Powiązane useEffect'y: pozycjonowanie (linie 267-293), zamykanie (linie 296-316)
- State: `contextMenu`, `contextMenuPlacement` i powiązane handlery

**Props komponentu**:
```typescript
interface SessionContextMenuProps {
  menu: ContextMenu | null;
  sessions: SessionWithApp[];
  projects: ProjectWithStats[];
  assignProjectListMode: AssignProjectListMode;
  onAssign: (sessionIds: number[], projectId: number | null, source?: string) => void;
  onBoost: (sessionIds: number[], multiplier: number) => void;
  onComment: (sessionId: number, comment: string) => void;
  onSplit: (sessionId: number) => void;
  onClose: () => void;
}
```

**UWAGA**: To jest pure extraction — nie zmieniaj logiki, nie refaktoruj. Przenieś kod 1:1 i dodaj potrzebne props.

**Weryfikacja**: `npx tsc --noEmit` + manualne testy context menu w Sessions (prawy klik → assign, boost, comment, split).

---

### 3.2 Wydzielenie hooków grupowania sesji

**Nowy plik**: `dashboard/src/hooks/useGroupedSessions.ts`

**Co przenieść z `Sessions.tsx`**:
- `groupedByProject` useMemo (linie 682-728) → `useGroupedSessions(sessions, projects)`
- `flattenedItems` useMemo (linie 742-760) → rozszerzenie tego samego hooka lub osobny `useFlattenedSessions`
- Typ `FlatItem` (linie 730-740)

**Sygnatura**:
```typescript
export function useGroupedSessions(
  sessions: SessionWithApp[],
  projects: ProjectWithStats[],
): { grouped: GroupedProject[]; flattened: FlatItem[] }
```

**Weryfikacja**: `npx tsc --noEmit` + Sessions page powinna wyświetlać identycznie.

---

### 3.3 Stworzenie `createSingleFlight<T>()`

**Cel**: Ujednolicenie wzorca deduplikacji concurrent fetch.

**Plik**: `dashboard/src/lib/async-utils.ts` (istniejący, linie 1-47)

**Dodaj na końcu pliku**:
```typescript
/**
 * Creates a single-flight wrapper: concurrent calls to the same async function
 * are deduplicated — only one execution runs, others await the same Promise.
 */
export function createSingleFlight<T>() {
  let inFlight: Promise<T> | null = null;

  return async (fn: () => Promise<T>): Promise<T> => {
    if (inFlight) return inFlight;
    inFlight = fn().finally(() => { inFlight = null; });
    return inFlight;
  };
}
```

**Zastosowanie w `projects-cache-store.ts`**:
- Linia 14: Zamień `let projectsAllTimeInFlight: Promise<...> | null = null;` na:
  ```typescript
  import { createSingleFlight } from '../lib/async-utils';
  const singleFlightProjects = createSingleFlight<ProjectWithStats[]>();
  ```
- W `loadProjectsAllTime`: zamień ręczną logikę in-flight na `return singleFlightProjects(() => api.call())`.

**Zastosowanie w `background-status-store.ts`**:
- Linie 17-19: Zamień 3 boolean flags na 3 instancje `createSingleFlight`.

**Weryfikacja**: `npx tsc --noEmit` + sprawdź że concurrent refresh nie powoduje duplikatów requestów.

---

### 3.4 WMI detection w osobnym wątku

**Cel**: Unikanie blokowania głównej pętli monitorowania przez WMI (100-500ms).

**Plik**: `src/monitor/wmi_detection.rs`

**Zmiana architektury**:

1. Stwórz nową strukturę:
```rust
pub struct WmiDetectionThread {
    sender: mpsc::Sender<Vec<u32>>,        // PIDs do sprawdzenia
    receiver: mpsc::Receiver<HashMap<u32, String>>,  // wyniki: pid → path
}
```

2. Przy starcie `run_loop` w `tracker.rs`, zainicjuj:
```rust
let (pid_sender, pid_receiver_wmi) = mpsc::channel();
let (result_sender, result_receiver) = mpsc::channel();
std::thread::Builder::new()
    .name("wmi-detection".into())
    .spawn(move || wmi_detection_loop(pid_receiver_wmi, result_sender))
    .expect("Failed to spawn WMI thread");
```

3. W `wmi_detection_loop`:
- Odczytuj `Vec<u32>` z kanału (blocking `recv`)
- Dla każdego PID wykonuj dotychczasową logikę WMI
- Wyślij `HashMap<u32, String>` z wynikami
- `WMI_CONN_CACHE` (thread_local) zostaje w tym wątku — bez zmian

4. W głównej pętli (`tracker.rs`), zamiast synchronicznego `hydrate_detected_paths_for_pending_pids`:
- Wyślij pending PIDs: `pid_sender.send(pending_pids)`
- Sprawdź wyniki: `if let Ok(results) = result_receiver.try_recv() { ... }`

**UWAGA**: Zmiana dotyczy 2 plików (`wmi_detection.rs`, `tracker.rs`). Nie zmieniaj `pid_cache.rs` — cache nadal żyje w main thread.

**Dodatkowe ulepszenie**: Dodaj `retry_count: u8` do `PidCacheEntry` (plik `pid_cache.rs`, linia 21). Przy WMI timeout, inkrementuj licznik zamiast ustawiać `path_detection_attempted = true`. Pozwalaj retry do 3 razy z cooldownem 60s.

**Weryfikacja**: `cargo build` + daemon powinien poprawnie wykrywać ścieżki exe (sprawdź logi WMI).

---

### 3.5 Optymalizacja `SessionsVirtualList` — `useCallback` na `itemContent`

**Plik**: `dashboard/src/components/sessions/SessionsVirtualList.tsx`
**Linia 124**: Inline callback `itemContent={(_index, item) => { ... }}`

**Zmiana**: Wydziel do `useCallback` z odpowiednimi zależnościami:
```typescript
const renderItem = useCallback((_index: number, item: FlatItem) => {
  // ... cała logika z linii 124-295
}, [/* zależności: sessions, projects, handlers, itp. */]);

// W JSX:
<Virtuoso itemContent={renderItem} ... />
```

**UWAGA**: Lista zależności `useCallback` musi zawierać wszystkie wartości używane w renderItem. Sprawdź dokładnie jakie props/state są referenced.

**Weryfikacja**: `npx tsc --noEmit` + scrollowanie listy sesji powinno być płynne.

---

## FAZA 4: Help i tłumaczenia

### 4.1 Uzupełnienie Help.tsx

**Plik**: `dashboard/src/pages/Help.tsx`

**4.1.1 — Sekcja ReportView**

Dodaj w sekcji Reports (po opisie edytora szablonów) nowy `HelpDetailsBlock`:
```typescript
<HelpDetailsBlock title={t('Podgląd raportu (ReportView)', 'Report Preview (ReportView)')}>
  {t(
    'Pełnoekranowy podgląd raportu dostępny z karty projektu (przycisk "Raport"). Umożliwia drukowanie i eksport do PDF. Zawiera dane o czasie pracy, sesjach i plikach dla wybranego projektu w zadanym zakresie dat.',
    'Full-screen report preview accessible from the project card ("Report" button). Supports printing and PDF export. Shows work time, sessions, and files for the selected project within a given date range.'
  )}
</HelpDetailsBlock>
```

**4.1.2 — Ikony trybów listy projektów**

W sekcji Sessions, dodaj opis do istniejących features lub nowy `HelpDetailsBlock`:
```typescript
<HelpDetailsBlock title={t('Tryby sortowania listy projektów', 'Project List Sort Modes')}>
  {t(
    'W menu przypisania projektu dostępne są 3 tryby sortowania:\n• A-Z (ikona Type) — alfabetycznie\n• Nowe → Top → Reszta (ikona Sparkles) — ostatnio używane na górze\n• Top → Nowe → Reszta (ikona Flame) — najczęściej używane na górze',
    'The project assignment menu offers 3 sort modes:\n• A-Z (Type icon) — alphabetical\n• New → Top → Rest (Sparkles icon) — recently used first\n• Top → New → Rest (Flame icon) — most frequently used first'
  )}
</HelpDetailsBlock>
```

**4.1.3 — Relacja Demo Mode ↔ Sync**

W sekcji Settings (demo mode), dodaj do features:
```typescript
t('W trybie demo synchronizacja online jest wyłączona. Przycisk "Sync Now" jest zablokowany do momentu wyłączenia trybu demo.',
  'In demo mode, online sync is disabled. The "Sync Now" button is locked until demo mode is turned off.')
```

**4.1.4 — Applications: "Sync from apps"**

W sekcji Applications, dodaj/uzupełnij opis:
```typescript
t('Przycisk "Sync from apps" kopiuje aplikacje wykryte automatycznie (detected) na listę monitorowanych (monitored). Tylko monitorowane aplikacje są aktywnie śledzone przez daemon.',
  '"Sync from apps" button copies automatically detected apps into the monitored list. Only monitored apps are actively tracked by the daemon.')
```

**4.1.5 — QuickStart**

Rozbuduj sekcję QuickStart (linie 256-283) — dodaj features z opisem kroków:
```typescript
features={[
  t('Krok 1: Wybierz folder z projektami do monitorowania', 'Step 1: Choose a folder with projects to monitor'),
  t('Krok 2: Skonfiguruj aplikacje do śledzenia', 'Step 2: Configure apps to track'),
  t('Krok 3: Uruchom daemon i zacznij śledzenie', 'Step 3: Start the daemon and begin tracking'),
  t('Do QuickStart możesz wrócić w dowolnym momencie z menu pomocy.', 'You can return to QuickStart anytime from the help menu.'),
]}
```

**Weryfikacja**: `npx tsc --noEmit` + sprawdź wizualnie Help w obu językach (PL/EN).

---

### 4.2 Poprawki niespójności w tłumaczeniach

**Plik 1**: `dashboard/src/locales/pl/common.json`
**Plik 2**: `dashboard/src/locales/en/common.json`

**Zmiana 1** — `layout.tooltips.boosted_sessions`:
- PL: `"Sesje z mnożnikiem: {{count}}"` → OK (zachowaj)
- EN: `"{{count}} boosted session(s)"` → zmień na `"Boosted sessions: {{count}}"` (spójny format z PL)

**Zmiana 2** — `online_sync_indicator.labels.disabled`:
- PL: `"Wył."` → zmień na `"Sync wył."` (bardziej opisowy, spójny z EN)
- EN: `"Sync Off"` → OK (zachowaj)

**Weryfikacja**: Sprawdź wizualnie oba tooltips w UI w obu językach.

---

## FAZA 5: Architektura (opcjonalne, niski priorytet)

### 5.1 Dashboard.tsx — węższy selektor store

**Plik**: `dashboard/src/pages/Dashboard.tsx`
**Linia 211**: Zmień:
```typescript
// PRZED:
const projectsList = useProjectsCacheStore((s) => s.projectsAllTime);
// PO:
const projectsCount = useProjectsCacheStore((s) => s.projectsAllTime.length);
```
Dostosuj użycia — jeśli potrzebna jest pełna lista (nie tylko `.length`), zachowaj pełny selektor.

---

### 5.2 BackgroundServices — równoległe startup tasks

**Plik**: `dashboard/src/components/sync/BackgroundServices.tsx`
**Linie 248-259**: Sekwencyjne `await`:

```typescript
// PRZED (linie 248-259):
await runAutoProjectSyncStartup(...)
await runAutoAiAssignmentCycle()

// PO:
await Promise.all([
  runAutoProjectSyncStartup(...),
  runAutoAiAssignmentCycle(),
]);
```

**UWAGA**: Sprawdź czy `runAutoAiAssignmentCycle` nie zależy od wyników `runAutoProjectSyncStartup`. Jeśli folder sync tworzy projekty, których AI potrzebuje — zachowaj sekwencję. W przeciwnym razie zrównolegol.

---

### 5.3 Podział `ui-store.ts` (opcjonalne)

**Obecne pola** (11 stanów w jednym store):
- `currentPage`, `pageChangeRequestId`, `pageChangeGuard` → **navigation**
- `helpTab` → **navigation** (powiązane ze stronami)
- `sessionsFocusDate`, `sessionsFocusRange`, `sessionsFocusProject` → **sessions-focus**
- `projectPageId`, `reportTemplateId` → **page-params**
- `firstRun`, `assignProjectListMode` → **preferences**

**Strategia**: Wydziel `useSessionsFocusStore` (3 pola) jako osobny store. Resztę zachowaj w `ui-store`. To minimalna zmiana z największym efektem (Sessions.tsx nie triggeruje re-renderów na zmianę `currentPage`).

**Pliki do aktualizacji**: Wszystkie które importują `useUIStore` z selektorem `sessionsFocus*` — zamień na nowy import.

---

## Checklist końcowy

Po zakończeniu wszystkich zmian:

- [ ] `cargo build` (daemon) — bez błędów
- [ ] `cd dashboard/src-tauri && cargo build` (Tauri backend) — bez błędów
- [ ] `cd dashboard && npx tsc --noEmit` (frontend) — bez błędów
- [ ] Manualne testy: Dashboard, Sessions (context menu, assign, boost), Help (PL+EN), Applications, Estimates
- [ ] Sprawdź logi daemon (WMI detection, save_daily)
- [ ] Sprawdź że istniejące dane są zachowane (otwórz bazę, porównaj counts sesji)
- [ ] Help.tsx — każdy nowy tekst ma parę PL+EN
