# TIMEFLOW — Plan refaktoryzacji i analiza statyczna

## Status analizy
| Sekcja | Status | Uwagi |
|--------|--------|-------|
| §1 Procesy i logika | ✅ | Pełna analiza daemon + dashboard |
| §2 Wydajność | ✅ | Rust concurrency + React re-renders + SQL |
| §3 Błędy i dane | ✅ | unwrap/expect audit + storage format |
| §4 Refaktoryzacja | ✅ | Duplikacja kodu, modularyzacja |
| §5 Tłumaczenia | ✅ | JSON pełne, kilka błędów PL |
| §6 Bugi krytyczne | ✅ | 2 bugi zbadane szczegółowo |
| §7 Bezpieczeństwo | ✅ | Tauri permissions, sieć, szyfrowanie |
| §8 Sugestie | ✅ | Na podstawie znalezionych luk |

---

## §6 Bugi krytyczne 🔴

### BUG #1: Unique Files liczone niepoprawnie

**Dwie oddzielne metody liczenia — obie wadliwe:**

**Metoda A: Report** (`dashboard/src-tauri/src/commands/report.rs:227-239`)
```sql
SELECT COUNT(DISTINCT LOWER(
    COALESCE(NULLIF(TRIM(fa.file_path), ''), NULLIF(TRIM(fa.file_name), ''))
))
FROM file_activities fa
WHERE fa.project_id = ?1 AND ... <> '(background)'
```
- Filtruje po `fa.project_id` (bezpośrednie przypisanie)
- Większość plików ma `project_id IS NULL` w tabeli `file_activities` → liczy tylko te z bezpośrednim match → **zaniżony wynik**

**Metoda B: ProjectPage** (`dashboard/src-tauri/src/commands/projects.rs:1389-1412`)
```sql
SELECT COUNT(DISTINCT LOWER(...))
FROM session_projects sp
JOIN sessions s ON s.id = sp.id
JOIN file_activities fa ON fa.app_id = s.app_id AND fa.date = s.date
    AND fa.last_seen > s.start_time AND fa.first_seen < s.end_time
WHERE sp.project_id = ?3 AND (fa.project_id = ?3 OR fa.project_id IS NULL)
```
- Bardziej restrykcyjna — wymaga nakładania się czasowego file_activity z sesją projektu
- Daje więcej wyników niż Metoda A (bo akceptuje `project_id IS NULL`), ale nadal za mało

**Dodatkowy problem w daemon** (`src/tracker.rs:21-53`): `build_file_cache_key()` używa `window_title` jako klucza gdy brak `detected_path`. Zmiana tytułu okna IDE (np. `[modified]`, `[Git: branch]`) tworzy duplikaty w runtime, ale paradoksalnie do SQLite trafia zbyt mało (bo file_activities to osobna tabela zapełniana inaczej).

**Rekomendacja: USUNĄĆ "Unique Files" z kluczowych widoków statystyk.** Metryka jest:
- Niskiej wartości biznesowej (użytkownik nie podejmuje decyzji na jej podstawie)
- Nieosiągalnie precyzyjna z obecną architekturą (file_activities nie mapują 1:1 na fizyczne pliki)
- Źródłem frustracji (8 plików w projekcie z setkami plików — podważa zaufanie do całej aplikacji)
- Jeśli chcesz zachować: zamienić na listę ostatnio edytowanych plików w session detail (już istnieje)

---

### BUG #2: Czas pracy różni się między widokami 🔴🔴🔴

**GŁÓWNA PRZYCZYNA: 5 oddzielnych mechanizmów obliczania czasu, każdy liczy inaczej.**

#### Widok 1: Projects list (ProjectCard) — 148h 51m

**Plik:** `dashboard/src-tauri/src/commands/projects.rs:363-493` → `compute_project_activity_unique()`

- Deduplikacja nakładających się sesji (sweep-line algorithm, `analysis.rs:493-494`)
- **BOOST MULTIPLIER wliczony w sweep-line** (`analysis.rs:497`: `weighted_share = share * mult`)
- Manual sessions wliczone (UNION ALL, `analysis.rs:302-313`)
- Przypisanie sesji przez `SESSION_PROJECT_CTE` (file_activities overlap matching)
- `active_only = false`

**Wynik:** czas z deduplikacją + boost + manual sessions

#### Widok 2: ProjectPage/ProjectOverview — 176h 8m

**Plik:** `dashboard/src-tauri/src/commands/projects.rs:495-602`

- **ZUPEŁNIE INNY MECHANIZM** — `SESSION_PROJECT_CTE_ALL_TIME` + prosty SUM
- **BEZ deduplikacji** nakładających się sesji → jeśli 2 sesje nakładają się czasowo, OBA liczone pełnym czasem
- **BEZ boost multiplier** — sumuje surowy `duration_seconds`
- Manual sessions dodane osobno
- Skanuje CAŁĄ tabelę sessions (brak filtra date range)

**TO JEST GŁÓWNA PRZYCZYNA** że ProjectPage (176h) > Projects list (148h): brak deduplikacji nakładów + inne przypisanie sesji.

#### Widok 3: Report — 172h 25m / 17 467,78 zł

**Plik:** `dashboard/src-tauri/src/commands/report.rs:15-61`

- **TRZECI mechanizm** — bezpośredni SUM bez żadnego CTE
- Przypisanie przez `s.project_id OR a.project_id` (bezpośrednie, bez file_activities overlap)
- **Filtruje** `s.duration_seconds >= min_duration` (minimalny czas sesji)
- **NIE wlicza manual_sessions** do total_seconds!
- **BEZ boost multiplier** w total_seconds
- **BEZ deduplikacji** czasu

Estimate wartości (`report.rs:66-103`): `base_seconds + multiplier_extra` — dolicza boost do wartości pieniężnej ale NIE do wyświetlanego czasu.

#### Widok 4: Estimates — 148,85h / 151,11h / 15 111,26 zł

**Plik:** `dashboard/src-tauri/src/commands/estimates.rs:173-245`

- Używa `compute_project_activity_unique` (jak Projects list) → z deduplikacją sweep-line
- **PODWÓJNE LICZENIE BOOST:** sweep-line już wlicza multiplier (`analysis.rs:497`), a potem `estimates.rs:213` dodaje go PONOWNIE z `query_project_multiplier_extra_seconds`
- `active_only = true` (w przeciwieństwie do Projects list: `false`)

#### Tabela porównawcza

| Aspekt | Projects list | ProjectPage | Report | Estimates |
|--------|:---:|:---:|:---:|:---:|
| Deduplikacja nakładów | ✅ sweep-line | ❌ | ❌ | ✅ sweep-line |
| Boost w czasie | ✅ (w sweep) | ❌ | ❌ (tylko w $) | ✅ **podwójnie!** |
| Manual sessions | ✅ | ✅ | ❌ | ✅ |
| min_duration filter | ❌ | ❌ | ✅ | ❌ |
| Metoda przypisania sesji | CTE overlap | CTE all-time | Direct assignment | CTE overlap |
| active_only | false | N/A | N/A | true |

#### Plan naprawy BUG #2

1. **Ustanowić JEDEN kanoniczny mechanizm** — `compute_project_activity_unique` (sweep-line) jako źródło prawdy
2. **Oddzielić "clock time" od "weighted time":**
   - Sweep-line powinien liczyć CZYSTY czas zegarowy (bez multiplier)
   - Boost powinien być doliczany WYŁĄCZNIE przy obliczaniu wartości pieniężnej
   - To naprawi podwójne liczenie w Estimates
3. **Naprawić `query_active_project_with_stats`** (`projects.rs:561-596`) — użyć `compute_project_activity_unique` zamiast prostego SUM
4. **Naprawić `get_report_project`** (`report.rs:15-61`) — użyć `compute_project_activity_unique` lub tego samego CTE
5. **Manual sessions wliczać konsekwentnie** — wszędzie, z wyraźnym oznaczeniem
6. **min_duration filter stosować konsekwentnie** — albo wszędzie, albo nigdzie (z konfiguracją)

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
│   └── Signal tracker na zmianę okna
└── TRAY ICON THREAD — tray.rs (NWG event loop)
    ├── Menu: Close, Restart, Open Dashboard
    └── Unassigned sessions counter (5s refresh)
```

### Architektura dashboard (Tauri + React)

```
dashboard/src-tauri/src/ (backend Rust — Tauri commands)
├── commands/ — ~137 komend Tauri
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
- **Brak IPC** między daemon a dashboard — komunikacja wyłącznie przez bazę danych
- **Race condition (niskie ryzyko):** daemon pisze co ~5 min, dashboard czyta na żądanie. SQLite WAL mode jest włączony, busy_timeout 2s

### Zdublowane funkcje 🟡

| Lokalizacja | Problem |
|-------------|---------|
| **5 mechanizmów obliczania czasu** | Opisane szczegółowo w BUG #2 powyżej |
| **2 metody liczenia unique files** | Opisane w BUG #1 |
| **3 metody przypisywania sesji do projektów** | CTE overlap / Direct assignment / CTE all-time |
| `tracker.rs:274-299` vs `323-341` | Prawie identyczna logika aktualizacji file_entry — do wyekstrahowania |

---

## §2 Wydajność i wielowątkowość

### Rust — wielowątkowość ✅ Poprawna

| Element | Ocena |
|---------|-------|
| `Arc<AtomicBool>` stop_signal | ✅ SeqCst ordering, poprawne |
| `Arc<ForegroundSignal>` z Condvar | ✅ Poprawne budzenie trackera, handle poisoned mutex |
| `CONFIG_CACHE: Mutex<Option<ConfigCache>>` | ✅ Graceful fallback na lock failure |
| `WARNING_SHOWN: AtomicBool` | ✅ Poprawne `compare_exchange` |
| Tray RefCell state | ✅ Single-threaded NWG event loop |

**Drobne optymalizacje (🟢 nice-to-have):**
- `monitor.rs:347-348` — redundantny `dedup()` po `collect_descendants` z visited HashSet
- `tracker.rs:261,492` — klonowanie `exe_name` w każdym tick (co 10s) — minimalne, ale `Cow<str>` byłby czystszy

### React — wycieki pamięci

| Plik | Problem | Priorytet |
|------|---------|-----------|
| `SplashScreen.tsx:9-10` | `setTimeout` x2 bez cleanup — timer może odpalić po unmount | 🟢 |
| `Projects.tsx:524` | `setTimeout` bez `clearTimeout` — 3s timer bez cleanup | 🟢 |
| `Dashboard.tsx:177-198` | 13 useState'ów → 4 consecutive re-rendery w jednym fetch cycle (setStats, setTopProjects, setAllProjects, setProjectTimeline) | 🟡 |

**Wszystkie useEffect cleanup-y w kluczowych stronach (Dashboard, Sessions, DaemonControl) są poprawne** — event listenery, intervaly, cancelled flags prawidłowo czyszczone.

### SQL — wzorce wydajności

| Problem | Plik | Priorytet |
|---------|------|-----------|
| **N+1:** `load_database_settings` robi 7 oddzielnych queries | `database.rs:37-62` | 🟡 |
| **SESSION_PROJECT_CTE jest kosztowne** i używane w prawie każdym zapytaniu bez cache | `sql_fragments.rs:1-97` | 🟡 |
| **3 skorelowane podzapytania** w `get_report_project` — 3x skan tej samej tabeli | `report.rs:22-58` | 🟡 |
| Wielokrotne wywołanie `compute_project_activity_unique` z różnych stron bez cache | `analysis.rs` | 🟢 |

---

## §3 Obsługa błędów i bezpieczeństwo danych

### unwrap()/expect() — audit

| Plik:linia | Ryzyko | Priorytet |
|------------|--------|-----------|
| `tray.rs:95` — `state.conn.as_ref().unwrap()` | **Średnie** — kruchy pattern, Ok path ustawia conn ale bez gwarancji | 🟡 |
| `tray.rs:297` — `.expect("APP_ICON must exist")` | Niskie — embedowana ikona | 🟢 |
| `storage.rs:319` — `.expect(...)` | Niskie — tylko w testach | — |
| `tracker.rs:647-661` — `.expect()` | Niskie — tylko w testach | — |

### Format danych użytkownika

- **Główny:** SQLite w `%APPDATA%/TimeFlow/`
  - Tabele: `sessions`, `applications`, `projects`, `file_activities`, `session_manual_overrides`, `assignment_feedback`, `assignment_suggestions`, `daily_store` (JSON blob na dzień)
- **Legacy:** pliki JSON (1 plik/dzień) — fallback odczytu w `storage.rs`
- **Migracje:** `db_migrations/` — SQLite migracje zarządzane przez dashboard

### Ryzyko migracji dla sugerowanych zmian

| Zmiana | Ryzyko | Mitigacja |
|--------|--------|-----------|
| Ujednolicenie obliczania czasu (BUG #2) | Brak — zmiana logiki query, nie struktury danych | — |
| Usunięcie unique files z widoków (BUG #1) | Brak — zmiana UI, nie danych | — |
| Dodanie filtra min_duration do raportów | Brak — nie zmienia struktury danych | — |
| Batch `load_database_settings` | Brak — optymalizacja query | — |

---

## §4 Refaktoryzacja i modularyzacja

### Nadmiarowy kod 🟡

| Co | Gdzie | Dlaczego |
|----|-------|----------|
| **5 mechanizmów obliczania czasu** | analysis.rs, projects.rs, report.rs, estimates.rs | Fundamentalny dług techniczny — źródło BUG #2 |
| **Duplikacja update file_entry** | `tracker.rs:274-299` vs `323-341` | Niemal identyczne bloki — wyekstrahować wspólną funkcję |
| **Różne identyfikatory "unassigned"** | `Dashboard.tsx:58` (`'unassigned'`) vs `analysis.rs:14` (`'__unassigned__'`) | Dwa różne stringi dla tego samego konceptu |

### Duże pliki — kandydaci do podziału

| Plik | Linie | Rekomendacja |
|------|-------|-------------|
| `online-sync.ts` | 1173 | Wydzielić `sync-reconciler.ts` i `sync-state-machine.ts` |
| `ProjectPage.tsx` | 1254 | Wydzielić `RateMultiplierPanel`, logikę context menu do hooków |
| `Projects.tsx` | 1054 | `sortProjectList`, `filterProjectList`, `renderDuration` → `lib/project-utils.ts` |
| `tauri.ts` | 814 | Podzielić na `lib/tauri/projects.ts`, `sessions.ts`, `ai.ts`, `daemon.ts`, `data.ts` |
| `projects.rs` | >1500 | Podmoduły: CRUD, folders, detection, sync |

### Nieużywane Tauri commands 🟢

3 komendy zdefiniowane w Rust ale bez wrapper'a w `tauri.ts`:
- `get_heatmap` (analysis.rs)
- `get_stacked_timeline` (analysis.rs)
- `send_bug_report` (bughunter.rs — wywoływany bezpośrednio przez `invoke()`)

---

## §5 Tłumaczenia i Help

### Błędy w tłumaczeniach 🟡

| Klucz | Wartość PL (błędna) | Poprawna PL |
|-------|---------------------|-------------|
| `help_page.quick_start` | `"Quick Start"` | `"Szybki start"` |
| `daemon_page.restart` | `"Restart"` | `"Uruchom ponownie"` |
| `reports_page.template.default_template` | `"Standard"` | `"Standardowy"` |
| `help_page.margin` | `"Margin"` | `"Margines"` |
| `quickstart.heading.start` | `"Start"` | `"Rozpocznij"` |
| `help_page.score_and_base_log_prob` | `"Score & Base Log Prob:"` | `"Punkty i bazowy log. prawdop.:"` |
| `help_page.matched_tokens_and_context_matches` | `"Matched Tokens & Context Matches:"` | `"Dopasowane tokeny i trafienia kontekstowe:"` |

### Help.tsx — kompletność ✅

12 sekcji pokrywających wszystkie strony. Drobne luki:
- **BugHunter** — wzmianka w Settings, ale brak dedykowanej pozycji w menu bocznym Help
- **Online Sync** — opisana w Settings, ale złożoność (reseed, ACK, pruned scenario) uzasadnia osobną podsekcję

### Hardcoded strings — 1 znaleziony

`Sessions.tsx:185` — fallback `'Sesja ręczna'` (po polsku) zamiast po angielsku

---

## §7 Bezpieczeństwo i prywatność

### Transmisja sieciowa

| Komponent | Sieć? |
|-----------|-------|
| Daemon (src/) | ❌ Zero wywołań HTTP, czysto lokalne |
| Dashboard | ⚠️ Tylko Online Sync (`connect-src` → `cfabserver-production.up.railway.app`) |
| Token sync | ✅ Chroniony Windows DPAPI (`CryptProtectData` w `secure_store.rs`) |

### Tauri permissions ✅ Minimalistyczne

```
core:default, core:window:allow-*
dialog:default, dialog:allow-open, dialog:allow-save
fs:default, fs:allow-read-text-file, fs:allow-exists
```

- **Brak** `shell`, `http`, `clipboard`, `notification` — dobrze
- **Brak** hardcoded secrets w kodzie
- **CSP:** `style-src 'unsafe-inline'` — typowe dla Tailwind, trudne do uniknięcia

**Sugestia 🟢:** `fs:allow-read-text-file` nie ma ograniczeń ścieżek — rozważyć scope do `$APPDATA/TimeFlow/**`

---

## §8 Sugestie funkcjonalne

### Brakujące stany UI 🟡

| Strona | Problem |
|--------|---------|
| `Applications.tsx:152` | Brak loading state przy ładowaniu listy aplikacji |
| `Applications.tsx:378+` | Brak empty state ("brak danych") |
| `TimeAnalysis.tsx:28-31` | Brak explicit loading state |

### Brakujące potwierdzenia przed destrukcyjnymi operacjami 🟡

| Operacja | Plik | Ma confirm? |
|----------|------|:-----------:|
| Delete app | Applications.tsx:346 | ✅ |
| Reset app time | Applications.tsx:296 | ❌ |
| Remove monitored app | Applications.tsx:201 | ❌ |
| Delete archive file | ImportPage.tsx:26 | ❌ |

### Dostępność (a11y) 🟢

- Tylko **19 aria- atrybutów** w całym dashboard/src
- Tylko **3 role= atrybuty**
- Tylko **2 komponenty** obsługują klawiaturę
- Brak skip-navigation, brak aria-live, brak focus management po nawigacji
- `Applications.tsx:412-426` — pola input bez `<label>` / `aria-label`

---

## Plan prac — kolejność realizacji

### Faza 1 — Bugi krytyczne 🔴

| # | Zadanie | Pliki | Zależność |
|---|---------|-------|-----------|
| 1.1 | **Ujednolicić obliczanie czasu** — jeden kanoniczny mechanizm (sweep-line) | `analysis.rs`, `projects.rs:495-602`, `report.rs:15-61`, `estimates.rs:173-245` | — |
| 1.2 | **Oddzielić clock time od weighted time** — sweep-line bez multiplier, boost tylko przy kalkulacji $ | `analysis.rs:497`, `estimates.rs:213` | Zależy od 1.1 |
| 1.3 | **Usunąć/ukryć Unique Files** z kluczowych widoków statystyk | `projects.rs:1389-1412`, `report.rs:227-239`, komponenty React | Niezależne |

### Faza 2 — Ważne 🟡

| # | Zadanie | Pliki | Zależność |
|---|---------|-------|-----------|
| 2.1 | Dodać loading/empty state do Applications | `Applications.tsx` | Niezależne |
| 2.2 | Dodać confirm do destructive ops (resetAppTime, removeApp) | `Applications.tsx`, `ImportPage.tsx` | Niezależne |
| 2.3 | Naprawić tłumaczenia PL (7 kluczy) | `locales/pl/common.json` | Niezależne |
| 2.4 | Batch `load_database_settings` (N+1 fix) | `database.rs:37-62` | Niezależne |
| 2.5 | Reducer/batch setState w Dashboard (4 re-rendery) | `Dashboard.tsx:177-198` | Niezależne |
| 2.6 | Fix `tray.rs:95` — zamienić `unwrap()` na safe pattern | `tray.rs:95` | Niezależne |

### Faza 3 — Nice-to-have 🟢

| # | Zadanie | Pliki | Zależność |
|---|---------|-------|-----------|
| 3.1 | Podzielić `tauri.ts` na moduły per-domain | `lib/tauri/*.ts` | Duży refaktor |
| 3.2 | Podzielić `online-sync.ts` (1173 linii) | `lib/sync/*.ts` | Duży refaktor |
| 3.3 | Wyekstrahować wspólną `update_file_entry()` w tracker.rs | `tracker.rs:274-341` | Niezależne |
| 3.4 | Ograniczyć `fs` permissions do ścieżek | `capabilities/default.json` | Wymaga analizy |
| 3.5 | Cleanup `setTimeout` w SplashScreen i Projects | `SplashScreen.tsx:9-10`, `Projects.tsx:524` | Niezależne |
| 3.6 | Cache SESSION_PROJECT_CTE per dzień | `sql_fragments.rs`, nowa tabela cache | Wymaga testów |
| 3.7 | Poprawić a11y (aria-labels, keyboard nav) | Wiele komponentów | Niezależne |
| 3.8 | Dodać BugHunter i Online Sync do Help sidebar | `Help.tsx` | Niezależne |

### Równoległość

```
Faza 1: [1.1 + 1.2 SEKWENCYJNIE] ║ [1.3 NIEZALEŻNE]
         ↓
Faza 2: [2.1] [2.2] [2.3] [2.4] [2.5] [2.6]  ← wszystkie niezależne, równoległe
         ↓
Faza 3: [3.1-3.8]  ← wszystkie niezależne, równoległe
```
