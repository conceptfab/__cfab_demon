# TIMEFLOW — Raport audytu kodu

Data: 2026-03-03

---

## Spis treści

1. [Podsumowanie](#1-podsumowanie)
2. [Bugi i błędy logiczne](#2-bugi-i-błędy-logiczne)
3. [Problemy wydajnościowe](#3-problemy-wydajnościowe)
4. [Nadmiarowy / martwy kod](#4-nadmiarowy--martwy-kod)
5. [Brakujące tłumaczenia (i18n)](#5-brakujące-tłumaczenia-i18n)
6. [Niespójności architektoniczne](#6-niespójności-architektoniczne)
7. [Bezpieczeństwo](#7-bezpieczeństwo)
8. [Sugerowane optymalizacje](#8-sugerowane-optymalizacje)

---

## 1. Podsumowanie

Aplikacja jest funkcjonalna i ogólnie dobrze napisana. Audyt objął ~110 plików (32 Rust, 79 TS/TSX, pliki konfiguracyjne i tłumaczenia). Zidentyfikowano:

| Kategoria | Krytyczne | Wysokie | Średnie | Niskie |
|-----------|:---------:|:-------:|:-------:|:------:|
| Bugi logiczne | 3 | 4 | 3 | 2 |
| Wydajność | — | 3 | 5 | 4 |
| Nadmiarowy kod | — | — | 4 | 5 |
| Tłumaczenia (i18n) | — | 1 (systemowy) | — | 50+ stringów |
| Bezpieczeństwo | — | 1 | 2 | 1 |

---

## 2. Bugi i błędy logiczne

### 2.1 [KRYTYCZNY] `ManualSessionDialog.tsx:101` — getHours() zamiast getMinutes()

```ts
const endStr = `...T${String(startDate.getHours()).padStart(2,"0")}:${String(startDate.getHours()).padStart(2,"0")}`;
//                                                                          ^^^^^^^^^^^^^^^^^^
//                                                                          powinno być getMinutes()
```

**Skutek:** Domyślna godzina zakończenia manualnej sesji ma minuty ustawione na wartość godziny (np. 14:14 zamiast 14:00).

**Fix:** Zamienić drugie `getHours()` na `getMinutes()`.

---

### 2.2 [KRYTYCZNY] `import.rs:237-239` — Odwrócona logika filtra importu

```rust
if filter_enabled && !monitored_exes.contains(&exe_lower) && app_project_id.is_some() {
    continue; // pomija niezmonitorowane aplikacje Z przypisanym projektem
}
```

**Skutek:** Import pomija dane z aplikacji, które użytkownik celowo przypisał do projektu, ale nie dodał do listy monitorowanych. Powinno być `is_none()` — pomijaj niezmonitorowane BEZ przypisanego projektu.

---

### 2.3 [KRYTYCZNY] `import_data.rs:106` — validate_import zawsze zwraca valid: true

```rust
Ok(ImportValidation { valid: true, ... }) // niezależnie od błędów
```

**Skutek:** UI nie ma informacji, że walidacja wykryła problemy (brakujące projekty, nakładające się sesje). Pole `valid` jest bezużyteczne.

---

### 2.4 [WYSOKI] `tracker.rs:242-244` — Brak clampu na actual_elapsed po hibernacji

Jeśli system wraca z hibernacji/sleep, `actual_elapsed` może wynosić godziny. Ten czas jest w całości dodawany do `total_seconds` aplikacji, zawyżając dane.

**Fix:** `actual_elapsed = actual_elapsed.min(poll_interval * 3)` lub podobny clamp.

---

### 2.5 [WYSOKI] `monitor.rs:341-346` — Duplikacja PID-ów zawyża pomiar CPU

`root_pids` są dodawane do `all_pids`, ale nie do `visited`. Gdy `collect_descendants` napotka root PID jako czyjeś dziecko, doda go ponownie. `sum_cpu_times` odczytuje ten sam proces dwukrotnie.

**Fix:** Przed pętlą dodać root_pids do `visited`.

---

### 2.6 [WYSOKI] `main.rs:18` — VERSION z trailing newline

```rust
pub const VERSION: &str = include_str!("../VERSION");
```

Plik VERSION może zawierać `\n`. Porównania wersji (`check_version_compatibility`) operują na surowym stringu — `parse::<i32>()` ostatniego segmentu zwróci `None`, powodując fałszywy alarm niekompatybilności.

**Fix:** `include_str!("../VERSION").trim()` lub `.trim()` w każdym miejscu porównania.

---

### 2.7 [WYSOKI] `tracker.rs:68-78` — MessageBoxW blokuje wątek monitoringu

`check_dashboard_compatibility()` wywołuje blokujący `MessageBoxW` w wątku monitoringu. Cały tracking jest wstrzymany do kliknięcia OK.

**Fix:** Pokazać message box w osobnym wątku (`std::thread::spawn`).

---

### 2.8 [ŚREDNI] `types.ts:27` + `useTimeAnalysisData.ts:180` — Klucze metadanych traktowane jako projekty

`parseHourlyProjects` filtruje jedynie `key !== "date"`, ale nie wyklucza `"has_boost"`, `"has_manual"`, `"comments"`. Te klucze trafiają jako nazwy projektów do danych wykresów.

**Fix:** Filtrować: `!["date", "has_boost", "has_manual", "comments"].includes(key)`.

---

### 2.9 [ŚREDNI] `Sessions.tsx:636` — 'Unassigned' jako klucz logiczny

```ts
const groupKey = session.project_name || 'Unassigned';
```

Jeśli projekt nazywa się "Unassigned", jego sesje zostaną złączone z nieprzypisanymi. Dodatkowo string nie przechodzi przez i18n.

---

### 2.10 [ŚREDNI] `useTimeAnalysisData.ts:27` — `today` nigdy się nie aktualizuje

```ts
const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
```

Pusta tablica zależności = wartość ustawiona raz na czas życia komponentu. Jeśli aplikacja jest otwarta przez północ, "dzisiaj" nie zaktualizuje się.

---

### 2.11 [NISKI] `dashboard.rs:453-458` — N+1 zapis kolorów aplikacji

W pętli po wszystkich aplikacjach; 100 aplikacji bez koloru = 100 osobnych UPDATE-ów.

---

### 2.12 [NISKI] `sessions.rs:46-62, 137-153` — CREATE TABLE IF NOT EXISTS przy każdym wywołaniu

Tabela `session_manual_overrides` jest już tworzona w schemacie `db.rs`, a mimo to każde wywołanie `upsert_manual_session_override` i `apply_manual_session_overrides` ponawia CREATE TABLE.

---

## 3. Problemy wydajnościowe

### 3.1 [WYSOKI] `Dashboard.tsx:249-341` + `Projects.tsx:298-371` — Monolityczne useEffect

Jeden efekt ładuje 7-8 niezależnych zbiorów danych. Zmiana jednego parametru (np. `timelineGranularity`) powoduje ponowne załadowanie WSZYSTKIEGO, w tym danych niezależnych od tego parametru (np. `getProjects()`).

**Sugestia:** Rozbić na osobne useEffect z właściwymi zależnościami.

---

### 3.2 [WYSOKI] `dashboard.rs:61,95` — compute_project_activity_unique wywoływane 2x

`get_dashboard_stats` wywołuje to ciężkie zapytanie raz bezpośrednio i raz pośrednio przez `query_dashboard_counters`. Podwaja koszt.

**Fix:** Obliczyć raz i przekazać wynik.

---

### 3.3 [WYSOKI] Brak indeksów SQL

Brakujące indeksy:
- `sessions.project_id` — często w WHERE/JOIN
- `file_activities.project_id` — używane w `compute_project_activity_unique`
- `file_activities.date` — filtrowane w analysis.rs

**Fix:** `CREATE INDEX idx_sessions_project_id ON sessions(project_id);` itd.

---

### 3.4 [ŚREDNI] `Sessions.tsx:240-294` — Pre-fetch AI breakdowns dla każdej sesji

Gdy `showScoreBreakdown` jest włączone, pętla odpala potencjalnie setki równoczesnych zapytań API — jedno na każdą sesję.

**Sugestia:** Batch API lub lazy loading (fetchuj przy rozwinięciu wiersza).

---

### 3.5 [ŚREDNI] `Sidebar.tsx:147-195` — Polling 5 endpointów co 10 sekund

`getDaemonStatus`, `getAssignmentModelStatus`, `getDatabaseSettings`, 2x `getSessionCount` — odpala się nawet gdy sidebar nie jest widoczny. `getDatabaseSettings` zmienia się rzadko.

**Sugestia:** Zmniejszyć częstotliwość lub uzależnić od widoczności.

---

### 3.6 [ŚREDNI] `tray.rs:207-220` — is_dashboard_running() tworzy nowy System za każdym kliknięciem

Tworzy kompletny snapshot procesów systemowych za każdym razem, gdy użytkownik klika "Launch Dashboard" w trayu.

**Fix:** Cache'ować `System` lub użyć lżejszego mechanizmu (np. `tasklist`).

---

### 3.7 [ŚREDNI] `DaemonControl.tsx:301` — Parsowanie logów co 5 sekund

`logs.split("\n").map((line, i) => ...)` — indeks jako `key` powoduje pełny re-render listy. Przy dużych logach kosztowne.

**Fix:** Użyć stabilnych kluczy (np. hash linii) lub wirtualizować listę.

---

### 3.8 [ŚREDNI] `TimelineChart.tsx:187-208` — Brak memoizacji formatterów

`xTickFormatter`, `xLabelFormatter`, `renderCustomAxisTick` tworzone na nowo przy każdym renderze. Przy dużych zbiorach danych powoduje niepotrzebne re-rendery Recharts.

---

### 3.9 [NISKI] `ProjectDayTimeline.tsx:514-689` — Ogromny useMemo (~175 linii)

Cała logika `model` w jednym useMemo. Każda zmiana dowolnej zależności powoduje pełne przeliczenie.

**Sugestia:** Rozbić na mniejsze, niezależne useMemo.

---

### 3.10 [NISKI] `DataStats.tsx:18` — Zapytanie za cały zakres czasu

Hardcoded `{ start: "2000-01-01", end: "2100-01-01" }` — potencjalnie kosztowne zapytanie.

---

### 3.11 [NISKI] Duże pliki komponentów

| Plik | Rozmiar | Sugestia |
|------|---------|----------|
| `ProjectPage.tsx` | ~79 KB | Rozbić na pod-komponenty |
| `Projects.tsx` | ~85 KB | Wyodrębnić FolderManager, ProjectList, ProjectCard |
| `Settings.tsx` | ~62 KB | Wyodrębnić sekcje (WorkingHours, Currency, Sync) |
| `Help.tsx` | ~61 KB | Rozbić na HelpSection komponent + dane |

---

## 4. Nadmiarowy / martwy kod

### 4.1 [ŚREDNI] 4x duplikacja CTE session_project_overlap (~50 linii SQL)

Skopiowane w:
- `analysis.rs:131`
- `dashboard.rs:153`
- `estimates.rs:84`
- `estimates.rs:168`

**Fix:** Wydzielić jako stałą `const SESSION_PROJECT_CTE: &str = ...` lub CREATE VIEW.

---

### 4.2 [ŚREDNI] Duplikacja `formatSize` w dwóch komponentach

Identyczna logika w `DatabaseManagement.tsx:231` i `DataHistory.tsx:53`.

**Fix:** Wyodrębnić do `@/lib/utils.ts`.

---

### 4.3 [ŚREDNI] Duplikacja `check_version_compatibility`

Identyczna implementacja w `daemon.rs:219-241` (Tauri) i `tracker.rs:36-48` (daemon).

**Fix:** Wydzielić do współdzielonego modułu.

---

### 4.4 [ŚREDNI] Duplikacja migracji legacy katalogów

Zarówno daemon (`config.rs:60-88`) jak i dashboard (`helpers.rs:49-74`) migrują te same katalogi. Race condition możliwy przy jednoczesnym starcie.

---

### 4.5 [NISKI] Lokalna `t(pl, en)` zdefiniowana identycznie w 3 plikach

`Data.tsx:12`, `Help.tsx:53`, `QuickStart.tsx:37` — ta sama jednolinijkowa funkcja.

---

### 4.6 [NISKI] Hardcoded daty '2020-01-01' / '2100-01-01'

Powtarzane w `Projects.tsx` (linie 305, 307, 379, 480). Powinny być stałymi.

---

### 4.7 [NISKI] `LEGACY_ONLINE_SYNC_SETTINGS_CHANGED_EVENT` emitowany, ale nigdzie nie nasłuchiwany

`online-sync.ts:300-302` — martwy event.

---

### 4.8 [NISKI] Zbyt szerokie interfejsy props w heatmapach

`DailyView`, `WeeklyView`, `MonthlyView` — heatmapy przyjmują pełny `*ViewProps`, ale używają tylko jednego pola (`*HourlyGrid` / `monthCalendar`).

---

### 4.9 [NISKI] `buildInlineI18nKey` eksportowany, ale używany tylko wewnętrznie

`inline-i18n.ts` — eksport jest zbędny.

---

## 5. Brakujące tłumaczenia (i18n)

### 5.1 [PROBLEM SYSTEMOWY] Trzy różne systemy tłumaczeń w projekcie

| System | Użycie | Pliki |
|--------|--------|-------|
| `useTranslation()` z kluczami i18n | **Prawidłowy** | Dashboard, Sessions, częściowo Projects/Settings |
| `useInlineT()` (deprecated) | 17 plików | Applications, TimeAnalysis, Estimates, DaemonControl, AI, ImportPage, częściowo Projects/Settings |
| Lokalna `const t = (pl, en) => ...` | 3 pliki | Data, Help, QuickStart |

Sekcja `"inline"` w plikach tłumaczeń stanowi ~460 z 694 kluczy (~66%) — hashowane, nieczytelne identyfikatory.

**Sugestia:** Plan migracji: lokalna `t()` → `useInlineT()` → klucze i18n (docelowo).

---

### 5.2 Pliki tłumaczeń EN/PL — klucze zsynchronizowane (694/694)

Brak brakujących kluczy w żadnym języku. Drobne problemy jakościowe:
- Klucz `"qqv1i717go2bo"`: EN = `"s"`, PL = `"e"` — powinno być `"s"` lub `"sek"` (skrót od sekund)
- Klucz `"1rtovin9rp4l5"`: EN = `"Confirm"`, PL = `"Potwierdzenie"` — w kontekście przycisku powinno być `"Potwierdź"`

---

### 5.3 Hardcoded stringi w komponentach (50+)

**Projects.tsx** (~20 stringów):
- Linia 443: `"Permanently delete project..."` (confirm dialog)
- Linia 457: `"Failed to delete project..."`
- Linia 337: `"Failed to load project folders"`
- Linia 728: `"View settings saved as default"`
- Linie 1270-2021: `"Top 3 Applications"`, `"Loading..."`, `"No data"`, `"Expand all"`, `"Collapse all"`, `"Excluded Projects"`, `"Project Folders"`, `"Add"`, `"Create"`, `"Hidden: "`, etc.

**ProjectDayTimeline.tsx** (~15 stringów):
- `"Activity Timeline"`, `"Set session rate multiplier"`, `"Session comment"`, `"No data"`, `"No project activity in selected day."`, `"AI Suggests:"`, `"Boost x2"`, etc.

**Time Analysis (DailyView, WeeklyView, MonthlyView):**
- `"Hourly Activity — Xh total"`, `"Daily Activity — Xh total"`, `"No activity"`
- `MonthlyView.tsx:21`: Hardcoded `['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']`

**useTimeAnalysisData.ts:**
- 5 fallback messages: `"Loading chart data..."`, `"Unable to load chart data..."`, `"No tracked activity..."`, etc.

**DataStats.tsx** — cały komponent bez i18n:
- `"Total Sessions"`, `"Projects"`, `"Applications"`, `"Total Time"`

**online-sync.ts:**
- Wszystkie etykiety wskaźników: `"Sync Off"`, `"Sync Ready"`, `"ACK Pending"`, `"Reseed Required"`, `"Sync Error"`, `"Sync Pushed"`, etc.

---

## 6. Niespójności architektoniczne

### 6.1 Niespójna obsługa błędów

| Wzorzec | Pliki |
|---------|-------|
| `showError()` toast | DatabaseManagement, Projects |
| `console.error` (użytkownik nie widzi) | DataHistory, ImportPanel |
| Natywny `alert()` | BugHunter |
| Natywny `confirm()` | DatabaseManagement, ManualSessionDialog, DataHistory |

**Sugestia:** Ustandaryzować — toast dla błędów użytkownika, ConfirmDialog zamiast natywnego `confirm()`.

---

### 6.2 Niespójne użycie `invoke` vs `invokeMutation` w tauri.ts

Mutacyjne operacje używające zwykłego `invoke` (nie emitują `LOCAL_DATA_CHANGED_EVENT`):
- `importJsonFiles` (linia 73-74)
- `deleteArchiveFile` (linia 81-82)
- `addMonitoredApp`, `removeMonitoredApp`, `renameMonitoredApp` (linie 288-293)
- `updateDatabaseSettings` (linia 386-394)

**Skutek:** Inne komponenty nasłuchujące na zdarzenie zmiany danych nie zostaną powiadomione po tych operacjach.

---

### 6.3 Niespójne dependency arrays w useEffect

- `Estimates.tsx:168`: Rozbija `dateRange` na `.start` / `.end`
- `Dashboard.tsx`: Używa `[dateRange, ...]` (cały obiekt)

Może powodować nieprzewidziane zachowanie zależnie od referencji obiektu.

---

### 6.4 Duplikacja drag handler w Sidebar i TopBar

`Sidebar.tsx:225-236` i `TopBar.tsx:62-65` — ten sam wzorzec `startDragging`.

---

### 6.5 `PromptConfig` w `db-types.ts`

Interfejs UI dialogu (`PromptConfig`) zdefiniowany w pliku typów bazy danych — nie pasuje kontekstowo.

---

## 7. Bezpieczeństwo

### 7.1 [WYSOKI] `database.rs:188` — Restore bazy na otwarty plik

```rust
fs::copy(src, dest)
```

Na Windows SQLite trzyma otwarte handle. `fs::copy` może nadpisać zawartość, ale SQLite będzie miał uszkodzony stan w pamięci. Brak zamknięcia połączenia przed operacją.

**Fix:** Zamknąć połączenie SQLite (lub użyć `VACUUM INTO` jako mechanizmu backup/restore).

---

### 7.2 [ŚREDNI] `secure_store.rs:31` — Token sync jako plaintext

```rust
std::fs::write(&path, token.trim())
```

Na współdzielonym komputerze inni użytkownicy mogą odczytać token.

**Sugestia:** Użyć Windows Credential Manager (DPAPI) lub szyfrować plik.

---

### 7.3 [ŚREDNI] `bughunter.rs:27-33` — SMTP credentials w binarce

Wbudowane w czas kompilacji przez `option_env!()`. Można je wyciągnąć za pomocą `strings`.

---

### 7.4 [NISKI] `ui-store.ts:38` — localStorage bez try-catch

```ts
localStorage.getItem('timeflow_first_run') // w inicjalizatorze store
```

Jeśli localStorage jest niedostępny, rzuci wyjątek.

---

## 8. Sugerowane optymalizacje

### 8.1 Refaktoryzacja systemu i18n (duże zadanie)

1. Najpierw zamienić lokalne `t(pl, en)` na `useInlineT()` (3 pliki)
2. Stopniowo migrować `useInlineT()` na klucze i18n (17 plików)
3. Usunąć sekcję `"inline"` z plików tłumaczeń
4. Usunąć `inline-i18n.ts`

---

### 8.2 Wydzielenie współdzielonego CTE jako stałej Rust

```rust
pub const SESSION_PROJECT_CTE: &str = "
    WITH session_project_overlap AS (...),
    ranked_overlap AS (...),
    session_projects AS (...)
";
```

Używane w 4 miejscach — jedna zmiana zamiast czterech.

---

### 8.3 Dodanie brakujących indeksów SQL

```sql
CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_file_activities_project_id ON file_activities(project_id);
CREATE INDEX IF NOT EXISTS idx_file_activities_date ON file_activities(date);
```

---

### 8.4 Rozbicie monolitycznych useEffect

`Dashboard.tsx` i `Projects.tsx` — wyodrębnić niezależne ładowania danych do osobnych efektów z precyzyjnymi zależnościami.

---

### 8.5 Wyodrębnienie wspólnych komponentów

- `<ColorPicker>` — duplikacja w `Projects.tsx` i `Applications.tsx`
- `formatSize()` — duplikacja w `DatabaseManagement.tsx` i `DataHistory.tsx`
- Drag handler — duplikacja w `Sidebar.tsx` i `TopBar.tsx`

---

### 8.6 Rozbicie dużych plików

| Plik | Sugestia |
|------|----------|
| `ProjectPage.tsx` (~79 KB) | ProjectHeader, ProjectSessions, ProjectStats, ProjectSettings |
| `Projects.tsx` (~85 KB) | ProjectList, FolderManager, ProjectCard, ExcludedProjects |
| `Settings.tsx` (~62 KB) | GeneralSettings, WorkingHours, SyncSettings, SessionSettings |

---

### 8.7 Connection pooling w Tauri backend

Aktualnie `Mutex<Connection>` serializuje wszystkie requesty. Rozważyć `r2d2-sqlite` lub przynajmniej `prepare_cached` wszędzie.

---

### 8.8 Clamp na actual_elapsed w tracker.rs

```rust
let actual_elapsed = actual_elapsed.min(Duration::from_secs(poll_secs * 3));
```

Zapobiegnie zawyżaniu danych po hibernacji/sleep.

---

*Raport wygenerowany automatycznie na podstawie analizy ~110 plików źródłowych.*
