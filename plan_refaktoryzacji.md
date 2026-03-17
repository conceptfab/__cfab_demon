# TIMEFLOW — Plan refaktoryzacji i analiza statyczna

## Status analizy
| Sekcja | Status | Uwagi |
|--------|--------|-------|
| §1 Procesy i logika | ✅ | Pełna analiza daemon + dashboard |
| §2 Wydajność | ✅ | Rust concurrency + React re-renders |
| §3 Błędy i dane | ✅ | unwrap/expect audit + storage format |
| §4 Refaktoryzacja | ✅ | Duplikacja kodu, modularyzacja |
| §5 Tłumaczenia | ✅ | JSON pełne, Help.tsx OK |
| §6 Bugi krytyczne | ✅ | Wszystkie 3 naprawione |
| §7 Bezpieczeństwo | ✅ | Tauri permissions, sieć, szyfrowanie |
| §8 Sugestie | ✅ | Na podstawie znalezionych luk |

---

## §6 Bugi krytyczne 🔴

### ~~BUG #1: Raport PDF drukuje tylko jedną stronę~~ ✅ NAPRAWIONY

---

### BUG #2: Unique Files liczone niepoprawnie

**Przyczyna:** `src/tracker.rs:262-313` — logika deduplikacji plików w `record_app_activity()`

**Mechanizm błędu:**

Cache key budowany jest w `build_file_cache_key()` wg priorytetu:
1. Jeśli `detected_path` niepusty → `"path:{path}"` (stabilny)
2. Jeśli `window_title` niepusty → `"title:{name}\n{title}"` (NIESTABILNY)
3. Fallback → `"name:{name}"`

**Scenariusz duplikacji** (gdy `detected_path` jest pusty):

```
T1: plik "main.rs", title "project - VS Code"
    → cache_key = "title:main.rs\nproject - vs code"
    → files[0] created, file_index["title:main.rs\nproject - vs code"] = 0

T2: ten sam plik, title zmienia się na "main.rs [modified] - VS Code"
    → lookup "title:main.rs\nmain.rs [modified] - vs code" → NIE ZNALEZIONO
    → files[1] created (DUPLIKAT!)
    → file_index["title:main.rs\nmain.rs [modified] - vs code"] = 1
```

**Potem** (linie 287-296): gdy istniejący plik JEST znaleziony i tytuł się zmieni, kod aktualizuje cache key. Ale to zabezpiecza tylko zmianę tytułu w trakcie trwającej sesji, nie zapobiega duplikacji przy nowym tytule od razu.

**Wynik:** `app_data.files.len()` zwraca zawyżoną liczbę. Jeden fizyczny plik może mieć 2-5 wpisów jeśli IDE zmienia tytuł okna (np. "[modified]", "[Git: branch]", "[Diff]").

**Plik:** `src/tracker.rs:21-53` (build_file_cache_key), `src/tracker.rs:262-313` (record_app_activity)

**Naprawa:**
- Dodać deduplikację po `name` jako fallback — jeśli lookup po cache_key nie znajdzie, sprawdzić czy istnieje entry z tym samym `name` (i opcjonalnie zbliżonym `detected_path`)
- Alternatywnie: normalizować `window_title` przed użyciem w cache_key (usunąć dynamiczne sufiksy IDE: `[modified]`, `[Git: ...]`, numery linii)

---

### BUG #3: Sesje poniżej N sekund pojawiają się w raporcie po Rebuild

**Przyczyna:** Brak filtra `min_session_duration` w query raportowym.

**Analiza ścieżki:**

1. **Zapis sesji** (`src/tracker.rs:250-257`): daemon zapisuje WSZYSTKIE sesje, nawet 1-sekundowe. To jest poprawne — filtrowanie powinno być po stronie query.

2. **Filtr `ACTIVE_SESSION_FILTER`** (`dashboard/src-tauri/src/commands/sql_fragments.rs:69-85`):
   ```sql
   (is_hidden IS NULL OR is_hidden = 0)
   ```
   Filtruje TYLKO ukryte sesje. **NIE sprawdza `duration_seconds >= min_session_duration`.**

3. **Query raportu** (`dashboard/src-tauri/src/commands/report.rs:107-137`):
   ```sql
   WHERE {ACTIVE_SESSION_FILTER_S}
     AND (s.project_id = ?1 OR ...)
     AND s.date >= ?2 AND s.date <= ?3
   ```
   **Brak warunku `AND s.duration_seconds >= ?min_duration`.**

4. **Rebuild** (`dashboard/src-tauri/src/commands/sessions/rebuild.rs:24-61`): odczytuje sesje z `ACTIVE_SESSION_FILTER` (bez min_duration), scala bliskie sesje. Po rebuild krótkie sesje które wcześniej mogły być "ukryte" przez UI filtrowanie, teraz jawnie istnieją.

5. **Tray ikona** (`src/tray.rs:52-62`): jedyne miejsce gdzie `min_session_duration_seconds` jest stosowany w SQL.

**Wynik:** Raport zawiera sesje 1-5 sekundowe, bo `get_report_sessions()` ich nie filtruje.

**Plik:** `dashboard/src-tauri/src/commands/report.rs:133`, `dashboard/src-tauri/src/commands/sql_fragments.rs:69-85`

**Naprawa:**
- Dodać do `get_report_sessions()` warunek: `AND s.duration_seconds >= ?min_duration`
- Odczytać `min_session_duration_seconds` z `session_settings` i przekazać do query
- Rozważyć dodanie filtra do `ACTIVE_SESSION_FILTER` globalnie, lub utworzyć nowy fragment `ACTIVE_SESSION_FILTER_WITH_DURATION`

---

## §1 Procesy i logika

### Architektura daemon (Rust)

```
main.rs (entry point, single-instance mutex)
├── TRACKER THREAD (10s loop) — tracker.rs
│   ├── Foreground window detection (GetForegroundWindow)
│   ├── PID → exe_name cache (180s validation)
│   ├── Activity classification → monitor.rs
│   ├── CPU background tracking (30s snapshot)
│   ├── File deduplication (path > title > name)
│   ├── Idle detection (120s threshold)
│   └── Periodic save (5min) → SQLite via storage.rs
├── FOREGROUND HOOK THREAD — foreground_hook.rs
│   ├── SetWinEventHook (EVENT_SYSTEM_FOREGROUND)
│   └── Signal tracker na zmianę okna (szybsza reakcja niż 10s poll)
└── TRAY ICON THREAD — tray.rs (NWG event loop)
    ├── Menu: Close, Restart, Open Dashboard
    └── Unassigned sessions counter (5s refresh)
```

### Architektura dashboard (Tauri + React)

```
dashboard/src-tauri/src/ (backend Rust — Tauri commands)
├── commands/ — 137 komend Tauri
│   ├── dashboard.rs, analysis.rs, report.rs
│   ├── sessions/ (query, rebuild, split)
│   ├── daemon/ (control, status)
│   └── assignment_model/ (AI scoring, context)
├── db_migrations/ — migracje SQLite
└── lib.rs — rejestracja komend

dashboard/src/ (frontend React)
├── pages/ — 16 stron
├── components/ — shared components
├── lib/tauri.ts — 134 wrapper functions dla invoke()
├── store/ — Zustand stores
└── locales/ — PL/EN tłumaczenia
```

### Sync daemon ↔ dashboard

- **Jednokierunkowy:** daemon pisze do SQLite (`%APPDATA%/TimeFlow/`), dashboard czyta z tego samego pliku
- **SQLite WAL** nie jest jawnie włączony — potencjalne locki przy równoczesnym r/w
- **Brak IPC** między daemon a dashboard — komunikacja wyłącznie przez bazę danych
- **Race condition (niskie ryzyko):** daemon pisze co ~5 min, dashboard czyta na żądanie. Jeśli czytanie trafi w trakcie zapisu, SQLite powinien obsłużyć to via locking, ale `busy_timeout` to tylko 2s (`config.rs:98`)

### Zdublowane funkcje 🟡

| Lokalizacja | Problem |
|-------------|---------|
| `tracker.rs:build_file_cache_key` + `storage.rs:prepare_daily_for_storage` | Obie normalizują nazwy plików ale z różnymi regułami truncation |
| Event listener setup w AI.tsx, Dashboard.tsx, Applications.tsx, Sessions.tsx | Każda strona ręcznie dodaje/usuwa event listenery zamiast użyć istniejącego `usePageRefreshListener` |
| Error handling `.catch(e => { console.error(e); showError(String(e)); })` | Powtórzony 50+ razy w komponentach React |

---

## §2 Wydajność i wielowątkowość

### Rust — wielowątkowość

| Element | Ocena | Uwagi |
|---------|-------|-------|
| `Arc<AtomicBool>` stop_signal | ✅ OK | SeqCst ordering, poprawna synchronizacja |
| `Arc<ForegroundSignal>` z Condvar | ✅ OK | Poprawne budzenie trackera |
| `Mutex<Option<ConfigCache>>` (config.rs:187) | ⚠️ | Niskie ryzyko race condition — config reloaduje co ~30s |
| `AtomicBool WARNING_SHOWN` (tracker.rs:77) | 🟡 | Użycie load + store zamiast `compare_exchange` — możliwe 2 MessageBoxy |
| Tray RefCell state | ✅ OK | Single-threaded NWG event loop |
| SQLite busy_timeout 2s | 🟡 | Może być za krótki przy dużych operacjach dashboardu |

### React — wycieki pamięci i re-renders

| Plik | Problem | Priorytet |
|------|---------|-----------|
| `AI.tsx:321-329` | Event listeners zależą od `refreshModelData` ale ref może być stały — zamknięcie (closure) może być stale | 🟡 |
| `Dashboard.tsx:330-346` | Puste `[]` w dependency array ale wewnątrz callback referuje do zmiennych stanu | 🟡 |
| `TimeAnalysis.tsx:31-40` | Nowy obiekt tablicy tworzony na każdy render (bez useMemo) | 🟢 |
| `Applications.tsx:266-294` | Zagnieżdżony useMemo — filtr + sort + slice — nieefektywne ale funkcjonalne | 🟢 |
| `Estimates.tsx:156-163` | `setDrafts(nextDrafts)` tworzy nowy obiekt na każdy load — OK, bo to wejście usera | 🟢 |

### Optymalizacje wydajności 🟡

1. **SQLite WAL mode** — włączenie `PRAGMA journal_mode=WAL` w shared module pozwoli na współbieżny odczyt daemon + dashboard bez locków
2. **Throttle event listeners** — zamiast natychmiastowego reagowania na `LOCAL_DATA_CHANGED_EVENT`, debounce 500ms
3. **Virtualizacja tabel** — strony Sessions i Applications mogą mieć tysiące wierszy — rozważyć react-window/virtuoso dla list >500 elementów

---

## §3 Obsługa błędów i bezpieczeństwo danych

### Rust — niebezpieczne unwrap/expect

| Plik:linia | Kod | Ryzyko | Priorytet |
|------------|-----|--------|-----------|
| `tray.rs:250` | `nwg::init().expect("Failed to init NWG")` | PANIC jeśli GUI niedostępny (serwer, headless) | 🔴 |
| `tray.rs:257-350` | 12x `.expect(...)` przy budowie tray/menu | PANIC przy braku zasobów GUI | 🔴 |
| `config.rs:72` | `.unwrap_or(0)` na query SQLite | ✅ bezpieczny fallback | — |
| `storage.rs:319` | `.expect("detected_path...")` | ✅ tylko w testach | — |
| `tracker.rs:601-674` | Wiele `.expect(...)` | ✅ tylko w testach | — |

**Naprawa tray.rs:** Zamienić `expect()` na `match` z graceful fallback — jeśli GUI nie da się zainicjalizować, daemon powinien działać bez tray (logować warning).

### Format danych użytkownika

- **Główny:** SQLite w `%APPDATA%/TimeFlow/`
  - Tabele: `sessions`, `applications`, `projects`, `file_activities`, `session_manual_overrides`, `assignment_feedback`, `assignment_suggestions`, `daily_store` (JSON blob na dzień)
- **Legacy:** pliki JSON (1 plik/dzień) — fallback odczytu w `storage.rs`
- **Backup/Export:** `ExportPanel.tsx` eksportuje dane — brak jawnego try/catch (🟡 brak obsługi błędów zapisu)

### Ryzyko migracji

| Sugerowana zmiana | Ryzyko | Mitigacja |
|-------------------|--------|-----------|
| Dodanie filtra min_duration do SQL | Brak — nie zmienia struktury danych | — |
| Zmiana logiki cache_key plików | Niskie — zmienia tylko runtime cache, nie dane na dysku | Dane w SQLite pozostają bez zmian |
| Włączenie WAL mode | Niskie — SQLite obsługuje automatycznie | Jednorazowe PRAGMA, bez migracji |
| Zmiana tray.rs na graceful init | Brak — nie dotyka danych | — |

---

## §4 Refaktoryzacja i modularyzacja

### Nadmiarowy kod 🟡

| Co | Gdzie | Dlaczego zmienić |
|----|-------|-----------------|
| **Event listener boilerplate** | AI.tsx, Dashboard.tsx, Applications.tsx, Sessions.tsx, Estimates.tsx | 5 stron ma identyczny wzorzec setup/cleanup. Hook `usePageRefreshListener` już istnieje ale nie jest używany wszędzie. |
| **Tauri error handling** | 50+ miejsc w pages/ | Powtarzany pattern `.catch(e => { console.error(e); showError(String(e)) })`. Wyekstrahować do `handleTauriError(e)` lub wrapper `safeTauriInvoke(fn)`. |
| **Loading state** | Każda strona | Własny `[loading, setLoading]` + identyczna logika. Można użyć custom hooka `useTauriQuery(fn)` który zarządza loading/error/data. |
| **Normalizacja tekstu** | tracker.rs + storage.rs | Dwie różne logiki truncation — ujednolicić w jednym module `normalize`. |

### Proponowany podział modułów 🟢

**Rust daemon** — obecna struktura jest dobra (6 plików, jasna separacja). Jedyna sugestia:
- Wyekstrahować `build_file_cache_key` + logikę deduplikacji do osobnego modułu `dedup.rs` — ułatwi testowanie

**Dashboard** — główne pole do poprawy:
- `lib/tauri.ts` (134 funkcje) → podzielić na `lib/tauri/sessions.ts`, `lib/tauri/projects.ts`, `lib/tauri/daemon.ts` etc. (już jest częściowo pogrupowane w obiekty API, ale plik jest za duży)
- Wyekstrahować wspólne hooki: `useTauriQuery`, `usePageRefreshEvents`
- Wyekstrahować `handleTauriError` utility

### Nieużywane Tauri commands 🟢

3 komendy zdefiniowane w Rust ale nie wyeksportowane w `tauri.ts`:
- `get_heatmap` (analysis.rs)
- `get_stacked_timeline` (analysis.rs)
- `send_bug_report` (bughunter.rs — wywoływany bezpośrednio przez `invoke()` w BugHunter.tsx)

**Akcja:** Dodać do tauri.ts lub usunąć z Rust jeśli nieużywane.

---

## §5 Tłumaczenia i Help

### Pliki JSON (common.json) ✅

- **PL i EN:** pełna synchronizacja — identyczna struktura kluczy
- **Brak pustych wartości** w obu językach
- **291 kluczy** w sekcji help_page — kompletne
- **Brak brakujących kluczy** — każdy klucz w PL ma odpowiednik w EN

### Help.tsx ✅

- **12 zakładek** pokrywających wszystkie strony aplikacji
- Każda sekcja ma: ikonę, tytuł, opis, listę funkcji, footer
- Zaawansowane funkcje (AI Model, Session Splitting, Online Sync, Bug Hunter) mają szczegółowe opisy
- Dialogi opisane (Project Page, Manual Sessions, Import, Report View)

**Uwaga:** Help.tsx używa `t18n()` (react-i18next) zamiast inline `t('PL', 'EN')`. To jest OK — tłumaczenia żyją w plikach JSON, a `t18n()` je rozwiązuje wg aktywnego języka. Format `t('PL', 'EN')` z `createInlineTranslator` jest alternatywą dla krótkich tekstów. Oba podejścia współistnieją poprawnie.

---

## §7 Bezpieczeństwo i prywatność

### Transmisja sieciowa

| Komponent | Sieć? | Opis |
|-----------|-------|------|
| Daemon (src/) | ❌ Brak | Zero wywołań HTTP, zero socketów. Czysto lokalne. |
| Dashboard (src-tauri/) | ⚠️ Ograniczone | CSP pozwala na `connect-src 'self' https://cfabserver-production.up.railway.app` — to jest Online Sync. |
| Dashboard frontend | ❌ Brak | Poza Online Sync, żadne dane nie opuszczają maszyny. |

### Tauri permissions ✅

```json
// capabilities/default.json
- core:default, core:window:* — zarządzanie oknem ✅
- dialog:default, dialog:allow-open, dialog:allow-save — dialogi plików ✅
- fs:allow-read-text-file, fs:allow-exists — dostęp do plików ✅
```

**Ocena:** Minimalistyczne. Brak `shell`, brak `http` (poza CSP), brak `clipboard`, brak `notification`.

**Sugestia 🟢:** `fs:allow-read-text-file` i `fs:allow-exists` nie mają ograniczeń ścieżek — teoretycznie mogą czytać dowolny plik. Rozważyć ograniczenie do `$APPDATA/TimeFlow/**`.

### Przechowywanie danych

- SQLite w `%APPDATA%/TimeFlow/` — dostęp zależy od uprawnień Windows
- **Brak szyfrowania** — pliki czytelne dla każdego procesu z uprawnieniami użytkownika
- **Logi debug** (`tracker.rs:406-411`) zawierają window_title i file paths — wrażliwe ale konieczne do diagnostyki
- **Ryzyko:** niskie (lokalna aplikacja, dane nie opuszczają maszyny poza opcjonalnym Online Sync)

---

## §8 Sugestie funkcjonalne

Wynikające z analizy kodu:

| # | Sugestia | Podstawa | Priorytet |
|---|---------|----------|-----------|
| 1 | **Timeout dla `isFetchingMetricsRef`** w AI.tsx | Ref ustawiany na `true` bez timeout — jeśli fetch się zawiesi, blokuje kolejne fetche na zawsze (AI.tsx:277) | 🟡 |
| 2 | **Graceful degradation dla tray** | 12x `expect()` w tray.rs — na serwerze/headless demon crashuje zamiast działać bez tray | 🟡 |
| 3 | **Potwierdzenie przed Rebuild** | `rebuild_sessions` usuwa i scala sesje nieodwracalnie — brak potwierdzenia UI (bezpośredni invoke) | 🟡 |
| 4 | **Backup przed destrukcyjnymi operacjami** | Rebuild, Import, Delete — brak automatycznego backupu przed operacjami modyfikującymi dane | 🟡 |
| 5 | **Wskaźnik ładowania na eksporcie** | `ExportPanel.tsx:31-54` — brak loading state i error handling przy eksporcie danych | 🟢 |
| 6 | **Konsolidacja duplikatów plików** | Po naprawie BUG #2 — dodać jednorazową migrację konsolidującą istniejące duplikaty w `daily_store` | 🟢 |

---

## Plan prac — kolejność realizacji

### Faza 1 — Bugi krytyczne 🔴 (niezależne, mogą być równoległe)

| # | Zadanie | Pliki | Zależność |
|---|---------|-------|-----------|
| ~~1.1~~ | ~~Fix PDF page breaks~~ | ~~`ReportView.tsx`, globalny CSS print~~ | ✅ Naprawiony |
| ~~1.2~~ | ~~Fix unique files deduplikacja~~ | ~~`src/tracker.rs`~~ | ✅ Zrobione |
| ~~1.3~~ | ~~Fix min_session_duration w raporcie~~ | ~~`dashboard/src-tauri/src/commands/report.rs`~~ | ✅ Zrobione |

### Faza 2 — Ważne 🟡 (częściowo zależne)

| # | Zadanie | Pliki | Zależność |
|---|---------|-------|-----------|
| ~~2.1~~ | ~~Graceful tray init (zamienić expect na match)~~ | ~~`src/tray.rs`~~ | ✅ Zrobione |
| ~~2.2~~ | ~~Fix WARNING_SHOWN race (compare_exchange)~~ | ~~`src/tracker.rs:77-119`~~ | ✅ Zrobione |
| 2.3 | Wyekstrahować handleTauriError utility | `dashboard/src/lib/tauri-error.ts`, strony | Odroczone — wzorce nie tak repetytywne jak oceniono |
| 2.4 | Użyć usePageRefreshListener wszędzie | AI.tsx, Dashboard.tsx, Applications.tsx, Sessions.tsx | Odroczone — zależy od 2.3 |
| ~~2.5~~ | ~~SQLite WAL mode~~ | ~~shared crate / config.rs~~ | ✅ Już zaimplementowane (daily_store + pool.rs) |
| ~~2.6~~ | ~~Timeout dla isFetchingMetricsRef~~ | ~~`AI.tsx`~~ | ✅ Zrobione |

### Faza 3 — Nice-to-have 🟢 (niezależne)

| # | Zadanie | Pliki | Zależność |
|---|---------|-------|-----------|
| 3.1 | Podzielić tauri.ts na moduły | `dashboard/src/lib/tauri/*.ts` | Odroczone — duży refaktor |
| ~~3.2~~ | ~~Dodać brakujące commands do tauri.ts~~ | ~~`dashboard/src/lib/tauri.ts`~~ | ✅ Zrobione (getHeatmap, getStackedTimeline, sendBugReport) |
| 3.3 | Ograniczyć fs permissions do ścieżek | `capabilities/default.json` | Odroczone — wymaga analizy użycia fs |
| 3.4 | Loading state na ExportPanel | `ExportPanel.tsx` | Odroczone |
| 3.5 | Konsolidacja duplikatów plików (migracja) | `db_migrations/` | Odroczone — wymaga testów z danymi |
| 3.6 | Potwierdzenie przed Rebuild | UI + Sessions strona | Odroczone |

### Równoległość

```
Faza 1: [1.1 ✅] [1.2 ✅] [1.3 ✅]  ← UKOŃCZONA
Faza 2: [2.1 ✅] [2.2 ✅] [2.5 ✅] [2.6 ✅]  ← UKOŃCZONA (2.3/2.4 odroczone)
Faza 3: [3.2 ✅]  ← reszta odroczona
         ↓
Faza 3: [3.1-3.6]          ← wszystkie niezależne
```
