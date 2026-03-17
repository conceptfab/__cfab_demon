# TIMEFLOW — Plan implementacji

Na podstawie `refactor.md` z 2026-03-17. Kazdy krok zawiera: numer z refactor.md, plik:linie, kod PRZED/PO, kryteria akceptacji.

**Kolejnosc:** Faza 1 (krytyczne) → Faza 2 (wazne) → Faza 3 (nice-to-have).
**Zasada nadrzedna:** Zachowanie danych uzytkownika. Zadna zmiana nie modyfikuje istniejacych danych bez migracji.

---

## FAZA 1 — Krytyczne bugi i UX

---

### 1.1 PDF: wielostronicowy druk (`print:h-auto` + `@page`)

**Plik:** `dashboard/src/pages/ReportView.tsx:95`

**PRZED:**
```tsx
<div className="flex flex-col h-screen bg-background pt-8 print:pt-0 print:bg-white">
```

**PO:**
```tsx
<div className="flex flex-col h-screen print:h-auto bg-background pt-8 print:pt-0 print:bg-white">
```

**Plik:** `dashboard/src/index.css` — dodac na samym poczatku bloku `@media print` (linia 135):

**PRZED:**
```css
@media print {
  aside,
  header,
  [class*='print:hidden'] {
    display: none !important;
  }
```

**PO:**
```css
@media print {
  @page {
    margin: 15mm;
    size: A4;
  }
  aside,
  header,
  [class*='print:hidden'] {
    display: none !important;
  }
```

**Kryteria akceptacji:**
- Otworz ReportView dla projektu z >50 sesjami
- Kliknij "Drukuj / PDF" — podglad druku pokazuje wiele stron
- Cala zawartosc raportu jest widoczna, nie obcieta

---

### 1.2 PDF: dynamiczny `document.title` dla nazwy pliku

**Plik:** `dashboard/src/pages/ReportView.tsx:108-115`

**PRZED:**
```tsx
<Button
  size="sm"
  onClick={() => window.print()}
  className="bg-sky-600 hover:bg-sky-700 text-white"
>
```

**PO:**
```tsx
<Button
  size="sm"
  onClick={() => {
    const originalTitle = document.title;
    const safeName = report.project.name.replace(/[^a-zA-Z0-9_\-\s]/g, '_');
    document.title = `timeflow_raport_${safeName}`;
    window.print();
    document.title = originalTitle;
  }}
  className="bg-sky-600 hover:bg-sky-700 text-white"
>
```

**Kryteria akceptacji:**
- Kliknij "Drukuj / PDF" dla projektu "Moj Projekt"
- W oknie drukowania nazwa pliku to `timeflow_raport_Moj_Projekt.pdf`
- Po zamknieciu okna drukowania tytul okna wraca do oryginalu

---

### 1.3 Sidebar badge: natychmiastowe odswiezanie po mutacji sesji

**Plik:** `dashboard/src/hooks/useSessionActions.ts`

**PRZED (linie 1-2, importy):**
```typescript
import { useCallback } from 'react';
import {
```

**PO:**
```typescript
import { useCallback } from 'react';
import { useBackgroundStatusStore } from '@/store/background-status-store';
import {
```

**PRZED (linie 26-37, runMutation):**
```typescript
  const runMutation = useCallback(
    async (action: string, fn: () => Promise<void>) => {
      try {
        await fn();
        onAfterMutation?.();
      } catch (error) {
        onError?.(action, error);
        throw error;
      }
    },
    [onAfterMutation, onError],
  );
```

**PO:**
```typescript
  const runMutation = useCallback(
    async (action: string, fn: () => Promise<void>) => {
      try {
        await fn();
        onAfterMutation?.();
        void useBackgroundStatusStore.getState().refreshDiagnostics();
      } catch (error) {
        onError?.(action, error);
        throw error;
      }
    },
    [onAfterMutation, onError],
  );
```

**Kryteria akceptacji:**
- Otworz strone Sessions, sprawdz badge nieprzypisanych w sidebar
- Przypisz sesje do projektu
- Badge w sidebar zmniejsza sie natychmiast (bez czekania 60s)
- Usun przypisanie sesji — badge wraca natychmiast

**Uwaga:** `refreshDiagnostics()` ma wbudowany in-flight guard — bezpieczne do wielokrotnego wywolania. `void` zapobiega unhandled promise warning.

---

### 1.4 Race condition w `loadMore`

**Plik:** `dashboard/src/hooks/useSessionsData.ts:109-123`

**PRZED:**
```typescript
  const loadMore = useCallback(() => {
    sessionsApi
      .getSessions(buildFetchParams(sessionsRef.current.length))
      .then((data) => {
        setSessions((prev) => {
          const next = [...prev, ...data];
          sessionsRef.current = next;
          return next;
        });
        const nextHasMore = data.length >= SESSION_PAGE_SIZE;
        hasMoreRef.current = nextHasMore;
        setHasMore(nextHasMore);
      })
      .catch(console.error);
  }, [buildFetchParams, sessionsRef, setSessions]);
```

**PO:**
```typescript
  const loadMore = useCallback(() => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    sessionsApi
      .getSessions(buildFetchParams(sessionsRef.current.length))
      .then((data) => {
        setSessions((prev) => {
          const next = [...prev, ...data];
          sessionsRef.current = next;
          return next;
        });
        const nextHasMore = data.length >= SESSION_PAGE_SIZE;
        hasMoreRef.current = nextHasMore;
        setHasMore(nextHasMore);
      })
      .catch(console.error)
      .finally(() => {
        isLoadingRef.current = false;
      });
  }, [buildFetchParams, sessionsRef, setSessions]);
```

**Kryteria akceptacji:**
- Otworz Sessions z dluga lista, szybko kliknij "Zaladuj wiecej" kilka razy
- Sesje nie sa zduplikowane
- Po bledzie sieci loadMore nie jest permanentnie zablokowany (testuj: odlacz siec -> kliknij -> przylacz siec -> kliknij ponownie)

---

### 1.5 Rust: `expect()` w tracker.rs -> bezpieczny fallback

**Plik:** `src/tracker.rs:464-466`

**PRZED:**
```rust
            let proc_snap = process_snapshot_cache
                .as_ref()
                .expect("process snapshot cache should be populated before background tracking");
```

**PO:**
```rust
            let proc_snap = match process_snapshot_cache.as_ref() {
                Some(snap) => snap,
                None => continue,
            };
```

**Kryteria akceptacji:**
- `cargo build` kompiluje bez bledow
- Daemon dziala normalnie — background tracking aplikacji funkcjonuje
- Brak panic w logu daemona

---

### 1.6 Rust: `expect()` w db.rs -> propagacja bledu

**Plik:** `dashboard/src-tauri/src/db.rs:94-98`

**PRZED:**
```rust
    } else {
        app.path()
            .app_data_dir()
            .expect("Failed to get app data dir")
    };
```

**PO:**
```rust
    } else {
        match app.path().app_data_dir() {
            Ok(dir) => dir,
            Err(e) => {
                log::error!("Failed to get app data dir: {}", e);
                let fallback = std::env::current_dir().unwrap_or_default().join("timeflow_data");
                std::fs::create_dir_all(&fallback).ok();
                fallback
            }
        }
    };
```

**Kryteria akceptacji:**
- `cargo build -p timeflow-dashboard` kompiluje bez bledow
- Dashboard uruchamia sie normalnie
- Brak panic nawet jesli `app_data_dir()` zawiedzie (testuj: mozna sprawdzic logike w kodzie)

---

## FAZA 2 — Wazne (wydajnosc, stabilnosc)

---

### 2.1 Transakcja w migracji daily_files schema

**Plik:** `shared/daily_store/schema.rs:162-202`

**PRZED:**
```rust
    let migration_sql = format!(
        "CREATE TABLE daily_files_new (
             ...
         );
         INSERT INTO daily_files_new (...)
         SELECT ... FROM daily_files;
         DROP TABLE daily_files;
         ALTER TABLE daily_files_new RENAME TO daily_files;
         CREATE INDEX IF NOT EXISTS idx_daily_files_date_exe
             ON daily_files(date, exe_name, ordinal);"
    );
    conn.execute_batch(&migration_sql)
        .map_err(|e| format!("Failed to migrate daily_files schema: {}", e))
```

**PO:**
```rust
    let migration_sql = format!(
        "BEGIN TRANSACTION;
         CREATE TABLE daily_files_new (
             ...
         );
         INSERT INTO daily_files_new (...)
         SELECT ... FROM daily_files;
         DROP TABLE daily_files;
         ALTER TABLE daily_files_new RENAME TO daily_files;
         CREATE INDEX IF NOT EXISTS idx_daily_files_date_exe
             ON daily_files(date, exe_name, ordinal);
         COMMIT;"
    );
    conn.execute_batch(&migration_sql)
        .map_err(|e| format!("Failed to migrate daily_files schema: {}", e))
```

Dodaj `BEGIN TRANSACTION;` na poczatku stringa i `COMMIT;` na koncu (przed zamknieciem `"`). Reszta migration_sql pozostaje bez zmian.

**Kryteria akceptacji:**
- `cargo build` kompiluje bez bledow
- Stary daily store (bez nowego schematu) migruje poprawnie
- Jesli proces zostanie zabity w trakcie migracji, stary schemat pozostaje nienaruszony

---

### 2.2 `busy_timeout` w daemon storage

**Plik:** `src/storage.rs` — znajdz funkcje `save_daily` i `load_daily` (lub ich odpowiedniki w `shared/daily_store/write.rs` i `shared/daily_store/read.rs`). Po kazdym `Connection::open(...)` dodaj:

```rust
conn.busy_timeout(std::time::Duration::from_millis(2000))?;
```

**Kryteria akceptacji:**
- Daemon nie blokuje sie na zapis gdy dashboard rownoczesnie czyta daily store
- Brak bledow "database is locked" w logu

---

### 2.3 Cache polaczenia DB w tray

**Plik:** `src/tray.rs:49-88`

Zamiast otwierac `open_dashboard_db_readonly()` przy kazdym wywolaniu `query_unassigned_attention_count()`, utrzymuj polaczenie w `RefCell<Option<Connection>>` obok `AttentionState`. Otwieraj polaczenie raz, reuzywaj, odnow przy bledzie.

**Pseudokod:**
```rust
struct AttentionState {
    count: i64,
    last_refresh: Instant,
    conn: Option<Connection>,  // <-- DODAC
}

fn query_unassigned_attention_count(state: &RefCell<AttentionState>) -> Result<i64, String> {
    let mut s = state.borrow_mut();
    let conn = match s.conn.as_ref() {
        Some(c) => c,
        None => {
            s.conn = Some(open_dashboard_db_readonly().map_err(|e| e.to_string())?);
            s.conn.as_ref().unwrap()
        }
    };
    // ... reszta query jak dotychczas, ale z reuzyciem conn
    // Jesli query sie nie uda, ustaw s.conn = None i zwroc blad
}
```

**Kryteria akceptacji:**
- Tray badge nadal sie aktualizuje
- W logu brak powtarzanych "opening connection" co 30s

---

### 2.4 Cache mtime dla `load_language()`

**Plik:** `src/i18n.rs:77`

Dodaj statyczny/globalny cache na `(last_mtime, Lang)`. Sprawdzaj mtime pliku przed pelnym odczytem.

**Pseudokod:**
```rust
use std::sync::Mutex;
use std::time::SystemTime;

static LANG_CACHE: Mutex<Option<(SystemTime, Lang)>> = Mutex::new(None);

pub fn load_language() -> Lang {
    let path = match language_file_path() {
        Some(p) => p,
        None => return Lang::Pl,
    };
    let mtime = match std::fs::metadata(&path).and_then(|m| m.modified()) {
        Ok(t) => t,
        Err(_) => return Lang::Pl,
    };
    if let Ok(guard) = LANG_CACHE.lock() {
        if let Some((cached_mtime, cached_lang)) = guard.as_ref() {
            if *cached_mtime == mtime {
                return *cached_lang;
            }
        }
    }
    // ... dotychczasowe parsowanie ...
    let lang = /* wynik parsowania */;
    if let Ok(mut guard) = LANG_CACHE.lock() {
        *guard = Some((mtime, lang));
    }
    lang
}
```

**Kryteria akceptacji:**
- Zmiana jezyka w dashboardzie nadal zmienia jezyk w tray (po maks 5s)
- Brak niepotrzebnego I/O co 5s gdy plik sie nie zmienil

---

### 2.5 Cache mtime dla config reload

**Plik:** `src/config.rs:180` (funkcja `load()`)

Analogicznie jak 2.4 — cachuj wynik `load()` na podstawie mtime pliku JSON + dodatkowy flag `db_version` (np. rowcount monitored_apps). Pomijaj pelny reload jesli nic sie nie zmienilo.

**Kryteria akceptacji:**
- Config reload co 30s nie otwiera DB/JSON gdy nic sie nie zmienilo
- Zmiana monitored_apps w dashboardzie jest widoczna po maks 30s

---

### 2.6 Bounded cache w `scoreBreakdownCacheRef`

**Plik:** `dashboard/src/hooks/useSessionScoreBreakdown.ts:51-66`

Dodaj limit rozmiaru mapy. Po przekroczeniu limitu usun najstarsze wpisy.

**PRZED (getCachedBreakdown callback, linia 55-66):**
```typescript
  const getCachedBreakdown = useCallback(
    (sessionId: number): ScoreBreakdown | null => {
      const cached = scoreBreakdownCacheRef.current.get(sessionId);
      if (!cached) return null;
      if (Date.now() - cached.fetchedAtMs > SCORE_BREAKDOWN_CACHE_TTL_MS) {
        scoreBreakdownCacheRef.current.delete(sessionId);
        return null;
      }
      return cached.data;
    },
    [],
  );
```

**PO:**
```typescript
  const getCachedBreakdown = useCallback(
    (sessionId: number): ScoreBreakdown | null => {
      const cache = scoreBreakdownCacheRef.current;
      const cached = cache.get(sessionId);
      if (!cached) return null;
      if (Date.now() - cached.fetchedAtMs > SCORE_BREAKDOWN_CACHE_TTL_MS) {
        cache.delete(sessionId);
        return null;
      }
      return cached.data;
    },
    [],
  );
```

Dodatkowo, w miejscu gdzie nowy wpis jest dodawany do cache (znajdz `scoreBreakdownCacheRef.current.set(...)`), dodaj po nim:
```typescript
// Evict oldest entries if cache exceeds limit
const MAX_SCORE_CACHE_SIZE = 200;
const cache = scoreBreakdownCacheRef.current;
if (cache.size > MAX_SCORE_CACHE_SIZE) {
  const entriesToRemove = cache.size - MAX_SCORE_CACHE_SIZE;
  const iter = cache.keys();
  for (let i = 0; i < entriesToRemove; i++) {
    const key = iter.next().value;
    if (key !== undefined) cache.delete(key);
  }
}
```

**Kryteria akceptacji:**
- Cache nie rosnie ponad 200 wpisow
- Score breakdown nadal dziala poprawnie (wyswietla sie przy hover)

---

### 2.7 Bounded cache w `splitEligibilityCacheRef`

**Plik:** `dashboard/src/hooks/useSessionSplitAnalysis.ts:36`

Analogicznie jak 2.6 — dodaj limit 200 wpisow do `splitEligibilityCacheRef`. Implementacja identyczna.

**Kryteria akceptacji:**
- Cache nie rosnie nieograniczenie
- Split eligibility nadal dziala poprawnie

---

### 2.8 `loadFreezeSettings()` — wyniesc z useMemo do stanu

**Plik:** `dashboard/src/pages/Sessions.tsx:464`

**PRZED:**
```typescript
  const assignProjectSections = useMemo(() => {
    const activeProjects = projects.filter((p) => !p.frozen_at);
    const activeAlpha = [...activeProjects].sort(compareProjectsByName);
    const { thresholdDays } = loadFreezeSettings();
```

**PO:**
Dodaj stan `freezeThresholdDays` na poziomie komponentu (poza useMemo):
```typescript
const [freezeThresholdDays, setFreezeThresholdDays] = useState(
  () => loadFreezeSettings().thresholdDays
);

// Odswiezaj po zapisaniu ustawien
useEffect(() => {
  const handler = () => setFreezeThresholdDays(loadFreezeSettings().thresholdDays);
  window.addEventListener('timeflow:settings-saved', handler);
  return () => window.removeEventListener('timeflow:settings-saved', handler);
}, []);
```

Nastepnie w useMemo zamienic:
```typescript
  const assignProjectSections = useMemo(() => {
    const activeProjects = projects.filter((p) => !p.frozen_at);
    const activeAlpha = [...activeProjects].sort(compareProjectsByName);
    const newProjectMaxAgeMs = Math.max(1, freezeThresholdDays) * 24 * 60 * 60 * 1000;
```

**Uwaga:** Sprawdz jaki event jest emitowany po zapisaniu ustawien. Moze to byc inny event niz `timeflow:settings-saved` — dostosuj nazwe do istniejacego.

**Kryteria akceptacji:**
- Brak synchronicznego odczytu localStorage w kazdym renderze useMemo
- Zmiana freeze settings nadal odswierza liste projektow w sesji

---

### 2.9 PDF: usunac/zwiekszyc limit sesji

**Plik:** `dashboard/src/pages/ReportView.tsx:335`

**Zaleznosc:** Wymaga ukonczonego 1.1 (wielostronicowy PDF).

**PRZED:**
```tsx
{report.sessions.slice(0, 50).map((s) => (
```

**PO:**
```tsx
{report.sessions.map((s) => (
```

Analogicznie linia 372 (komentarze, limit 25):
```tsx
// PRZED:
{sessionsWithComments.slice(0, 25).map((s) => (
// PO:
{sessionsWithComments.map((s) => (
```

I linia 356-361, 490-495 — usun bloki "+N more sessions...":
```tsx
// USUN:
{report.sessions.length > 50 && (
  <p className="text-[10px] text-muted-foreground/30 mt-1 print:text-gray-400">
    +{report.sessions.length - 50}{' '}
    {t('report_view.more_sessions')}...
  </p>
)}
```

Analogicznie dla manual_sessions (linia 469, 490-495) i boosted sessions (linia 414, 435-440).

**Kryteria akceptacji:**
- Raport PDF zawiera WSZYSTKIE sesje, komentarze i manual sessions
- Podglad druku jest wielostronicowy i czytelny

---

### 2.10 PDF: `print:break-inside-avoid` na sekcjach

**Plik:** `dashboard/src/pages/ReportView.tsx`

Dodaj `print:break-inside-avoid` do sekcji raportu, zeby tabele nie byly ciete w srodku wiersza.

Na sekcji stats (linia 163):
```tsx
// PRZED:
<div className="grid grid-cols-4 gap-4">
// PO:
<div className="grid grid-cols-4 gap-4 print:break-inside-avoid">
```

Na sekcji financials (linia 204):
```tsx
// PRZED:
<div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 print:border-green-200 print:bg-green-50">
// PO:
<div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 print:border-green-200 print:bg-green-50 print:break-inside-avoid">
```

Na sekcji AI (linia 286):
```tsx
// PRZED:
<div className="rounded-lg border border-border/20 p-4 print:border-gray-200">
// PO:
<div className="rounded-lg border border-border/20 p-4 print:border-gray-200 print:break-inside-avoid">
```

**Uwaga:** Regula CSS `[class*='print:break-inside-avoid'] { break-inside: avoid; }` juz istnieje w `index.css:177-179`.

**Kryteria akceptacji:**
- W podgladzie druku sekcje stats/financials/AI nie sa ciete miedzy stronami

---

## FAZA 3 — Nice-to-have (czystosc kodu)

---

### 3.1 Helper `normalize_exe()`

**Plik:** `src/config.rs`

Dodaj na poczatku pliku (po importach):
```rust
fn normalize_exe(name: &str) -> String {
    name.trim().to_lowercase()
}
```

Zamien 3 wystapienia:
- Linia 130: `app.exe_name = normalize_exe(&app.exe_name);`
- Linia 172: `app.exe_name = normalize_exe(&app.exe_name);`
- Linia 205: `.map(|a| normalize_exe(&a.exe_name))`

**Kryteria akceptacji:**
- `cargo build` kompiluje
- Monitorowane aplikacje sa nadal rozpoznawane (case-insensitive)

---

### 3.2 Helper `table_exists()`

**Pliki:** `src/tray.rs`, `src/config.rs`

Dodaj w `src/config.rs` (lub w nowym `src/db_helpers.rs`):
```rust
pub fn table_exists(conn: &rusqlite::Connection, table_name: &str) -> Result<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1 LIMIT 1",
            [table_name],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .is_some())
}
```

Zamien w `tray.rs:65-73` i `config.rs:139-147`.

**Kryteria akceptacji:**
- `cargo build` kompiluje
- Zachowanie bez zmian

---

### 3.3 Generyczna `query_all_or_filtered` w export

**Plik:** `dashboard/src-tauri/src/commands/export.rs`

Wyekstrahuj powtarzajacy sie wzorzec dwoch query (z/bez `project_id`). Niskopriortetowe — realizuj tylko jesli jest czas.

---

### 3.4 Preallocate buffers w `monitor.rs`

**Plik:** `src/monitor.rs:256-371`

Zamiast `HashMap::new()` w petli, reuzywaj buffery:
```rust
let mut pid_set = HashSet::new();
let mut all_pids = Vec::new();
// ... w petli:
pid_set.clear();
all_pids.clear();
// uzyj pid_set i all_pids zamiast tworzenia nowych
```

**Kryteria akceptacji:**
- `cargo build` kompiluje
- CPU measurement dziala bez zmian
- Mniejsza alokacja pamieci (mierzalna profilowaniem, ale tez akceptowalne manualnie)

---

### 3.5 `Communication` jako ActivityType

**Plik:** `shared/activity_classification.rs`

Dodaj nowy wariant `Communication` do `ActivityType` enum. Dodaj mapowanie exe_name: Slack, Teams, Discord, Zoom, etc.

**UWAGA MIGRACYJNA:** Istniejace dane w daily stores maja `activity_type TEXT` — nowa wartosc "communication" jest kompatybilna (text column). Brak potrzeby migracji schematu.

**Kryteria akceptacji:**
- Sesje ze Slack/Teams/Discord klasyfikowane jako Communication
- Istniejace dane nie sa naruszone

---

### 3.6 Konfigurowalny idle_threshold_ms

**Plik:** `src/tracker.rs:356`

Przeniesl `IDLE_THRESHOLD_MS` z const do `ResolvedIntervals` w `config.rs`. Dodaj pole `idle_threshold_ms` do JSON config z domyslna wartoscia 120000.

**Kryteria akceptacji:**
- Domyslne zachowanie bez zmian (120s)
- Uzytkownik moze zmienic wartosc w JSON config

---

### 3.7 Rotacja logow zamiast truncation

**Plik:** `src/main.rs:114-122`

Zamiast `truncate(0)`:
```rust
// PRZED: file.set_len(0)?; file.seek(...)?;
// PO:
let old_path = log_path.with_extension("log.old");
std::fs::rename(&log_path, &old_path).ok();
// ... otworz nowy plik logu
```

**Kryteria akceptacji:**
- Po przekroczeniu 1MB stary log jest w `.log.old`, nowy log jest pusty
- Brak utraty kontekstu diagnostycznego

---

### 3.8 Activity overrides z pliku config

**Plik:** `shared/activity_classification.rs`

Wczytuj overrides z `%APPDATA%/TimeFlow/activity_overrides.json` i przekazuj do `classify_activity_type()`.

**Kryteria akceptacji:**
- Uzytkownik moze dodac wlasne mapowania exe -> ActivityType
- Brak overrides pliku = zachowanie domyslne

---

## Kolejnosc realizacji i zaleznosci

```
1.1 PDF h-auto          ──┐
1.2 PDF document.title   │  (niezalezne, moga byc rownoczesne)
1.3 Sidebar badge        │
1.4 loadMore guard       │
1.5 tracker expect       │
1.6 db.rs expect         │
                          │
2.9 PDF usun limity ─────┘  (wymaga 1.1)
2.10 PDF break-inside ───┘  (wymaga 1.1)

2.1 Transakcja migracji     (niezalezne od reszty)
2.2 busy_timeout            (niezalezne)
2.3 Cache conn tray         (niezalezne)
2.4 Cache mtime i18n        (niezalezne)
2.5 Cache mtime config      (niezalezne)
2.6 Bounded score cache     (niezalezne)
2.7 Bounded split cache     (niezalezne)
2.8 loadFreezeSettings      (niezalezne)

3.1-3.8                     (niezalezne, dowolna kolejnosc)
```

---

## Testy do uruchomienia po zmianach

Po kazdej fazie uruchom:

```bash
# Rust (daemon + shared)
cargo build
cargo test

# Tauri backend
cd dashboard && cargo build -p timeflow-dashboard
cd dashboard/src-tauri && cargo test

# React frontend
cd dashboard && npm run build
cd dashboard && npm test
```

Istniejace pliki testow:
- `dashboard/src/hooks/useSessionActions.test.ts`
- `dashboard/src/lib/session-utils.test.ts`
- `dashboard/src/lib/page-refresh-reasons.test.ts`
- `dashboard/src/lib/projects-all-time.test.ts`
- `dashboard/src-tauri/src/commands/sessions/tests.rs`

---

## Ostrzezenia koncowe

1. **Nigdy nie modyfikuj struktury tabel SQLite** bez dodania migracji w `dashboard/src-tauri/src/db_migrations/`.
2. **Daily stores w `%APPDATA%/TimeFlow/data/`** — to dane uzytkownika. Kazda zmiana schematu musi byc wstecznie kompatybilna lub miec migracje.
3. **`BackgroundServices.tsx`** jest centralnym job pool — zmiany tam wplywaja na caly dashboard. Testuj dokladnie.
4. **`useBackgroundStatusStore.getState().refreshDiagnostics()`** — uzycie `.getState()` poza komponentem jest poprawne w zustand (wzorzec store actions).
5. **Po zmianie 2.8** (`loadFreezeSettings`) upewnij sie ze event name jest zgodny z tym co emituje strona Settings.
