# TIMEFLOW — Raport z analizy kodu

**Data:** 2026-03-08
**Wersja:** 0.1.505
**Zakres:** poprawność logiki, wydajność, optymalizacje, redundancje, brakujące tłumaczenia, luki w Help

---

## Spis treści

1. [Podsumowanie wykonawcze](#1-podsumowanie-wykonawcze)
2. [Backend Rust (demon tray)](#2-backend-rust-demon-tray)
3. [Backend Tauri (dashboard commands)](#3-backend-tauri-dashboard-commands)
4. [Frontend React (dashboard UI)](#4-frontend-react-dashboard-ui)
5. [Brakujące tłumaczenia (i18n)](#5-brakujące-tłumaczenia-i18n)
6. [Luki w dokumentacji Help.tsx](#6-luki-w-dokumentacji-helptsx)
7. [Priorytety napraw](#7-priorytety-napraw)

---

## 1. Podsumowanie wykonawcze

Aplikacja TIMEFLOW jest funkcjonalnie kompletna i działa poprawnie w typowych scenariuszach. Analiza ujawniła jednak **54 uwagi** pogrupowane w kategorie:

| Kategoria | Krytyczne | Wysokie | Średnie | Niskie |
|-----------|:---------:|:-------:|:-------:|:------:|
| Poprawność logiki | 3 | 5 | 6 | 4 |
| Wydajność | 2 | 6 | 5 | 2 |
| Redundantny kod | — | — | 4 | 6 |
| Brakujące tłumaczenia | 1 | 1 | — | 1 |
| Luki w Help | — | 5 | 5 | 5 |

**Top 5 problemów do natychmiastowej naprawy:**
1. `ON CONFLICT(session_id)` na nieunikalnej kolumnie → duplikaty w `session_manual_overrides`
2. Brak transakcji w `assign_session_to_project` → niespójne dane przy awarii
3. WMI `COMLibrary::new()` w każdym wywołaniu → opóźnienia monitoringu
4. 9 brakujących kluczy i18n w `MultiSplitSessionModal` → polskie UI w trybie EN
5. SQLite otwierany read-write przez demona → ryzyko blokady z dashboardem

---

## 2. Backend Rust (demon tray)

### 2.1 Poprawność logiki

#### [WYSOKI] config.rs:131 — SQLite otwierany bez trybu read-only

Demon otwiera `timeflow_dashboard.db` w trybie read-write (domyślny), mimo że tylko czyta dane. Gdy dashboard jest aktywny jednocześnie, obie aplikacje rywalizują o write lock.

**Naprawa:**
```rust
let conn = rusqlite::Connection::open_with_flags(
    &db_path,
    rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
)?;
```

#### [ŚREDNI] monitor.rs:233–258 — Niepoprawna obsługa escaped quotes w Windows command line

`split_command_line_tokens` traktuje `"` jako prosty toggle, co daje błędne tokeny dla ścieżek z `\"` (np. argumenty Visual Studio). Windows CLI ma złożone reguły escapowania zgodne z `CommandLineToArgvW`.

**Sugestia:** Użyć `CommandLineToArgvW` z WinAPI lub udokumentować ograniczenie.

#### [ŚREDNI] shared/version_compat.rs:19 — Błędny fallback przy nieparsowalna wersji

Gdy plik `dashboard_version.txt` jest pusty lub uszkodzony, funkcja zwraca `false` (niezgodne), co wyświetla błąd o niezgodności wersji. Lepiej zwracać `true` (compatible by default) lub obsłużyć brak/pusty plik wyżej.

#### [ŚREDNI] shared/timeflow_paths.rs:9–33 — Race condition przy migracji katalogu

`ensure_app_dirs()` jest wywoływane przed `SingleInstanceGuard::try_acquire()` w `main.rs` (linia 45 vs 50). Między sprawdzeniem `!base.exists()` a `fs::rename` druga instancja może stworzyć katalog docelowy.

**Naprawa:** Odwrócić kolejność — najpierw `try_acquire()`, potem `ensure_app_dirs()`.

#### [ŚREDNI] tracker.rs:43–88 — `WARNING_SHOWN: AtomicBool` bez synchronizacji z MessageBox

Flaga `WARNING_SHOWN` jest ustawiana na `true` przed spawnowaniem wątku (linia 53). Jeśli spawn się nie powiedzie, ostrzeżenie nigdy się nie pokaże ponownie. Reset flagi przy zgodnych wersjach (linia 84) może powodować wielokrotne wyświetlanie okna przy przeładowaniu konfiguracji.

#### [NISKI] monitor.rs:118,142 — Podwójne wywołanie `classify_activity_type`

Przy cache miss `classify_activity_type` jest wołany dwa razy — wynik z linii 118 jest nieużywany (nadpisany na linii 142).

#### [NISKI] monitor.rs:295–301 vs 314 — Zduplikowana walidacja rozszerzeń plików

`normalize_path_candidate` filtruje `.exe`/`.dll`/`.lnk`/`.tmp`, a `is_probably_file_path` robi to samo. Jeden filtr wystarczy.

### 2.2 Wydajność

#### [WYSOKI] monitor.rs:223 — WMI COMLibrary::new() w każdym wywołaniu

`get_process_command_line_wmi` wołuje `CoInitializeEx` + `WMIConnection::new()` (dziesiątki ms) przy każdym nowym PID. Dla IDE z częstą zmianą okna powoduje zauważalne opóźnienia.

**Naprawa:** Cache'ować połączenie WMI na wątek lub na czas pętli monitorującej (thread-local `RefCell<Option<WMIConnection>>`).

#### [WYSOKI] tray.rs:268–290 — `tasklist.exe` subprocess do detekcji dashboardu

Uruchamianie `tasklist.exe` (~100ms) zamiast `CreateToolhelp32Snapshot` (już używany w `monitor.rs`) lub named mutex.

**Naprawa:** Użyć `CreateToolhelp32Snapshot` + `Process32First/Next` lub sprawdzić named mutex tworzony przez dashboard.

#### [ŚREDNI] monitor.rs:467 — Przestarzały `GetTickCount` (32-bit)

Wraparound po ~49 dniach. `GetTickCount64()` nie ma tego problemu i jest dostępny od Windows Vista.

#### [NISKI] storage.rs:205 — `serde_json::to_string_pretty` na każdym zapisie

`to_string_pretty` jest ~2x wolniejszy i generuje większy plik. Przy zapisie co 5 minut nie jest krytyczne, ale `to_string` byłoby wystarczające dla plików produkcyjnych.

#### [NISKI] tracker.rs:105,111 — `push_title_history` z O(n) Vec::contains i drain

Przy `MAX_TITLE_HISTORY = 20` nie jest krytyczne, ale `VecDeque` z `HashSet` byłoby optymalniejsze.

### 2.3 Redundancje i jakość kodu

| Problem | Plik | Linie |
|---------|------|-------|
| `no_console` zduplikowana w `tray.rs` i `main.rs` | tray.rs:33, main.rs:25 | Wyekstrahować do wspólnego modułu |
| `show_error_message` ponownie wczytuje język z pliku | tray.rs:354–373 | Przekazać `lang` jako parametr |
| `.to_lowercase()` na już-lowercase `exe_name` | config.rs:202 | Usunąć zbędne wywołanie |
| `save_daily` wewnątrz `load_from_archive_or_empty` (efekt uboczny) | storage.rs:175 | Zwrócić dane bez zapisu |
| Brak auto-flush logów przy `Warn`/`Error` | main.rs:144–161 | Dodać `flush()` w `log()` |
| Race condition przy truncate logu | main.rs:113–118 | Użyć `truncate(true)` zamiast `remove_file` |

---

## 3. Backend Tauri (dashboard commands)

### 3.1 Poprawność logiki

#### [KRYTYCZNY] sessions.rs:109 — `ON CONFLICT(session_id)` na nieunikalnej kolumnie

Tabela `session_manual_overrides` ma `UNIQUE(executable_name, start_time, end_time)`, ale kod używa `ON CONFLICT(session_id)`. Kolumna `session_id` nie jest `UNIQUE` — `ON CONFLICT` nigdy nie zostanie wyzwolony, co powoduje wstawianie duplikatów.

**Naprawa:** Zmienić na `ON CONFLICT(executable_name, start_time, end_time) DO UPDATE SET ...`.

#### [KRYTYCZNY] sessions.rs:704–782 — Brak transakcji w `assign_session_to_project`

6 zapytań modyfikujących (UPDATE sessions, UPDATE file_activities, INSERT override, INSERT feedback, INSERT model_state) bez transakcji. Awaria między zapytaniami powoduje niespójne dane.

**Naprawa:** Opakować całość w `conn.transaction(|tx| { ... })`.

#### [KRYTYCZNY] settings.rs:265–285 — `clear_all_data` nie czyści tombstones/overrides

`execute_batch` z 8 DELETE bez transakcji. Tabele `session_manual_overrides` i `tombstones` nie są czyszczone — stare tombstones mogą usuwać świeżo zaimportowane projekty po resecie.

**Naprawa:** Dodać `DELETE FROM session_manual_overrides; DELETE FROM tombstones;` i opakować w transakcję.

#### [WAŻNY] sessions.rs:155–245 — N+1 queries w `apply_manual_session_overrides`

Dla każdego override: 1 query `projects WHERE lower(name)`, 1 query `sessions`, 2 `UPDATE`. Przy 100 overrides = 400+ zapytań.

**Naprawa:** Załadować mapę `project_name → id` jednym zapytaniem przed pętlą.

#### [WAŻNY] projects.rs:325 — `candidates.contains` na `Vec<String>` (O(n))

Kwadratowa złożoność przy wielu kandydatach nazw projektów z separatorami " | ".

**Naprawa:** Użyć `HashSet<String>`.

### 3.2 Wydajność

#### [KRYTYCZNY] sql_fragments.rs:59–115 — `SESSION_PROJECT_CTE_ALL_TIME` bez granicy daty

CTE `session_project_overlap` w wersji ALL_TIME robi full scan na `sessions JOIN file_activities` bez filtra datowego. Przy 100k+ sesji trwa sekundy.

**Naprawa:** Przekazywać filtr daty do CTE gdy jest znany, lub dodać `LIMIT`.

#### [WAŻNY] Brakujące indeksy złożone w db.rs

Istniejące indeksy `idx_sessions_app_id` i `idx_sessions_date` są oddzielne — SQLite użyje tylko jednego. Brakuje:

```sql
-- Dla wzorca WHERE app_id = ? AND date = ? (używany w CTE, overlap checks)
CREATE INDEX idx_sessions_app_date ON sessions(app_id, date, start_time);

-- Dla wzorca WHERE app_id = ? AND date = ? AND last_seen > ? AND first_seen < ?
CREATE INDEX idx_file_activities_app_date ON file_activities(app_id, date, last_seen, first_seen);
```

#### [WAŻNY] assignment_model.rs:948–1057 — `date(created_at)` blokuje użycie indeksu

Trzy zapytania z `WHERE date(created_at) >= date('now', ?)`. Funkcja `date()` na kolumnie uniemożliwia użycie indeksu `idx_assignment_feedback_created`.

**Naprawa:** Zmienić na `WHERE created_at >= date('now', ?)` — porównanie ISO-8601 tekstowe działa poprawnie.

#### [WAŻNY] projects.rs:390–406 — Podwójne `compute_project_activity_unique`

`query_projects_with_stats` wywołuje `compute_project_activity_unique` dwukrotnie (all-time + okres). `get_dashboard_stats` wywołuje je trzeci raz. Łącznie 3 pełne skany na jeden widok dashboardu.

**Sugestia:** Połączyć w jedno zapytanie z warunkowymi agregatami (`SUM(CASE WHEN date >= ? THEN ... END)`).

#### [WAŻNY] import_data.rs:70–103 — N zapytań w `validate_import`

Osobne `query_row` na każdą sesję z archiwum. Przy 10k sesji = 10k zapytań.

**Naprawa:** Batch-sprawdzenie przez temp table lub `IN (...)`.

#### [ŚREDNI] projects.rs:411–418 — Correlated subquery dla `last_activity`

Dla każdego projektu 2 correlated subquery (`MAX(end_time)` z sessions i manual_sessions). Przy 50 projektach = 100 dodatkowych skanów.

**Naprawa:** `LEFT JOIN ... GROUP BY`.

### 3.3 Redundancje

| Problem | Plik | Uwagi |
|---------|------|-------|
| 3 identyczne implementacje parse datetime | sessions.rs:916, 1008, 1105 + assignment_model.rs:513 + analysis.rs:50 | Wyekstrahować jedną funkcję `parse_datetime_ms()` |
| `SESSION_PROJECT_CTE` vs `_ALL_TIME` — 113 linii duplikacji | sql_fragments.rs:1, 59 | Jedna funkcja `session_project_cte(with_date: bool)` |
| `build_export_archive` — 4x identyczny `query_map` | export.rs:30–114 | Zunifikować z `params_from_iter` |
| `normalize_file_path` — pętla `while contains("//")` | import.rs:34–36 | Jednorazowy regex lub iterator |
| `get_session_count` — 2 bloki `get_connection` | sessions.rs:658–701 | Refaktor do jednej ścieżki |

---

## 4. Frontend React (dashboard UI)

### 4.1 Poprawność logiki

#### [KRYTYCZNY] App.tsx:156 — `report-view` w early return zamiast PageRouter

Strona `report-view` jest renderowana przed `MainLayout`, więc nie dzieli kontekstów (`ErrorBoundary`, `ToastProvider`, `TooltipProvider`). Toasty i dialogi wewnątrz `ReportView` będą nieme.

**Naprawa:** Przenieść `report-view` do `PageRouter` i ukrywać sidebar warunkowo w `MainLayout`.

#### [WYSOKI] Sessions.tsx:374–393 — Brak flagi `cancelled` w useEffect dla `getSessions`

Race condition przy szybkiej zmianie filtrów — odpowiedź ze starszego zapytania może nadpisać nowszą. Inne useEffect w tym samym pliku mają poprawnie zaimplementowany wzorzec z `cancelled`.

**Naprawa:** Dodać `let cancelled = false; return () => { cancelled = true; }` i sprawdzać przed `setState`.

#### [WYSOKI] BackgroundServices.tsx:350–376 — `runRefresh()` startuje przed zakończeniem auto-importu

`runRefresh()` i `checkFileChange()` odpytują backend w sekundę po starcie, mimo że `autoImportDone` może jeszcze być `false`. Race condition z trwającym importem.

**Naprawa:** Warunek `if (autoImportDone)` powinien obejmować też te operacje.

#### [ŚREDNI] ReportView.tsx:30–33 — `fontSettings` niezsynchronizowany z templatem

`useState` inicjalizowany z `template.fontFamily/baseFontSize` nie reaguje na zmianę `reportTemplateId`.

**Naprawa:** Dodać `useEffect` synchronizujący stan przy zmianie template.

#### [NISKI] Sessions.tsx:273–276 — `void refreshKey` jako deps hack w useMemo

```ts
const splitSettings = useMemo(() => {
  void refreshKey;
  return loadSplitSettings();
}, [refreshKey]);
```

Antywzorzec — `useMemo` nie powinno zależeć od zmiennej, której nie używa w obliczeniu.

**Naprawa:** `useEffect` + `useState` zamiast `useMemo`.

#### [NISKI] ManualSessionDialog.tsx:137 — natywny `window.confirm` zamiast `useConfirm`

Niespójne z resztą aplikacji używającą dedykowanego hooka `useConfirm`.

### 4.2 Wydajność

#### [WYSOKI] Dashboard.tsx:287–403 — 5 osobnych useEffect z tym samym refreshKey

Każdy `triggerRefresh()` inicjuje 5 niezależnych round-tripów do backendu. `getProjects` (rzadko się zmienia) mógłby mieć osobny cykl życia.

**Sugestia:** Pogrupować powiązane wywołania w jeden useEffect lub stworzyć endpoint batch.

#### [WYSOKI] Sidebar.tsx:214 — `getDatabaseSettings` w pętli co 10s

Ustawienia bazy są statyczne między sesjami. 6 zbędnych `invoke` na minutę.

**Naprawa:** Ładować raz przy montowaniu + po zdarzeniu `LOCAL_DATA_CHANGED_EVENT`.

#### [ŚREDNI] BackgroundServices.tsx:26 — `JOB_LOOP_TICK_MS = 2000`

Najgęstsze zadanie odpala co 5s, ale tick jest co 2s. Zmiana na 5000ms zmniejszy obciążenie CPU o ~60%.

#### [ŚREDNI] useTimeAnalysisData.ts:99 — `rangeMode` redundantny w deps useEffect

`activeDateRange` już zależy od `rangeMode`, więc dodanie `rangeMode` do deps powoduje potencjalne podwójne wywołanie.

#### [NISKI] SessionRow.tsx:100–101 — `resolveDateFnsLocale` per-row

Wywoływane dla każdego wiersza. Powinna być obliczana raz w rodzicu i przekazywana jako prop/context.

### 4.3 Redundancje i jakość kodu

| Problem | Plik | Uwagi |
|---------|------|-------|
| `useSessionActions.ts:87–92` — zbędny wrapper `updateOneSessionComment` | useSessionActions.ts | Identyczny z `updateSessionComments(id, comment)` |
| `Dashboard.tsx:236–246` — podwójne logowanie błędów | Dashboard.tsx | `onError` + `try/catch` logują to samo |
| `Reports.tsx:291` vs `report-templates.ts:17` — zduplikowany `generateId()` | Oba pliki | Eksportować z jednego miejsca |
| `report-templates.ts:71` — mutacja argumentu w `saveTemplate` | report-templates.ts | Narusza zasadę niezmienności; `{ ...template, updatedAt }` |
| `report-templates.ts:97` — `(copy)` hardkodowane po angielsku | report-templates.ts | Brak i18n |
| `SessionRow.tsx:110` — hardkodowane kolory `#1a1b26`, `#24283b` | SessionRow.tsx | Użyć zmiennych Tailwind |
| `data-store.ts:131–132` — globalne zmienne modułu dla throttlingu | data-store.ts | Enkapsulować w klasie/closurze |
| `useTimeAnalysisData.ts:56` — `shiftDateRange` nie w `useCallback` | useTimeAnalysisData.ts | Nowa referencja przy każdym renderze |
| `inline-i18n.ts:13–31` — custom hash z ryzykiem kolizji | inline-i18n.ts | Znany problem content-addressed i18n |

---

## 5. Brakujące tłumaczenia (i18n)

### [KRYTYCZNY] MultiSplitSessionModal.tsx — 9 brakujących kluczy

Klucze `sessions.split_multi.*` nie istnieją w `locales/en/common.json` ani `locales/pl/common.json`:

| Klucz | Fallback (hardkodowany PL) |
|-------|---------------------------|
| `sessions.split_multi.title` | — |
| `sessions.split_multi.loading` | — |
| `sessions.split_multi.no_candidates` | — |
| `sessions.split_multi.candidates` | `'Kandydaci AI'` |
| `sessions.split_multi.leader` | — |
| `sessions.split_multi.unknown_project` | `'Nieznany projekt'` |
| `sessions.split_multi.unassigned` | `'Nieprzypisane'` |
| `sessions.split_multi.ai_score` | — |
| `sessions.split_multi.custom_part` | — |
| `sessions.split_multi.sum` | — |

**Efekt:** W trybie angielskim użytkownik widzi polskie teksty.

### [WYSOKI] Przestarzały `useInlineT` w wielu komponentach

Pliki `TimeAnalysis.tsx`, `Reports.tsx`, `ReportView.tsx`, `useTimeAnalysisData.ts` używają `useInlineT` — ich teksty nie są w plikach JSON i nie można ich tłumaczyć bez modyfikacji kodu.

### [NISKI] SessionRow.tsx:134,185,197 — Polish defaultValue w `t()`

```ts
title={t('sessions.menu.split_suggestion', 'AI sugeruje podział...')}
```

Klucz istnieje w JSON, ale fallback jest po polsku — przy literówce w kluczu EN użytkownik zobaczy polski tekst.

---

## 6. Luki w dokumentacji Help.tsx

### Funkcje bez dokumentacji w Help

#### Priorytet wysoki

| Funkcja | Strona/Komponent | Opis |
|---------|-----------------|------|
| **Karta projektu (ProjectPage)** | ProjectPage.tsx | Cały ekran: kompaktowanie danych, reset czasu, inline edit nazwy, raport, timeline z komentarzami, dodawanie sesji manualnych per projekt |
| **Training blacklists** | AI.tsx | Wykluczanie aplikacji i folderów z trenowania modelu AI |
| **Metryki AI / wykresy jakości** | AI.tsx | Panel "Postęp i jakość AI" z feedback trend, precision, auto-assigned, coverage |
| **Waluta (Currency)** | Settings.tsx | Wybór waluty PLN/USD/EUR |
| **Język UI (PL/EN)** | Settings.tsx | Główny przełącznik języka interfejsu |

#### Priorytet średni

| Funkcja | Strona/Komponent | Opis |
|---------|-----------------|------|
| **ReportView (podgląd/druk raportu)** | ReportView.tsx | Pełnoekranowy widok, druk do PDF — brak opisu przepływu |
| **Sekcja "files" w szablonie raportu** | Reports.tsx | Sekcja "Pliki/aktywność" pominiętą w liście sekcji Help |
| **Training Horizon** | AI.tsx | Horyzont trenowania 30–730 dni |
| **Auto-safe limit** | AI.tsx | Limit sesji na przebieg auto-safe (500–10000) |
| **Tygodniowy widok w Sessions** | Sessions.tsx | Tryb `daily` vs `weekly` — range mode |
| **Batch assign po projekcie** | Sessions.tsx | Context menu na nagłówku projektu |
| **Auto-rebuild on startup** | Settings.tsx | Automatyczne scalanie sesji przy starcie |
| **Auto-sync interval** | Settings.tsx | Interwał synchronizacji 1–1440 min |

#### Priorytet niski

| Funkcja | Strona/Komponent | Opis |
|---------|-----------------|------|
| Kolor strefy godzin pracy (Highlight Color) | Settings.tsx | — |
| Session Indicators settings | AI.tsx | Konfigurowalne wskaźniki na wierszach sesji |
| Snooze Training Reminder | AI.tsx | Odroczenie przypomnienia o treningu na 24h |
| Filtr "Tylko nieprzypisane" | Sessions.tsx | — |
| Sync on startup toggle | Settings.tsx | — |

---

## 7. Priorytety napraw

### P0 — Natychmiastowe (poprawność danych)

1. **sessions.rs:109** — `ON CONFLICT(session_id)` → zmienić na `ON CONFLICT(executable_name, start_time, end_time)`
2. **sessions.rs:704** — Brak transakcji w `assign_session_to_project` → dodać `conn.transaction()`
3. **settings.rs:265** — `clear_all_data` nie czyści tombstones/overrides → dodać brakujące DELETE + transakcja
4. **config.rs:131** — SQLite read-write przez demona → `open_with_flags(READ_ONLY)`

### P1 — Wysokie (wydajność + UX)

5. **monitor.rs:223** — Cache WMI connection per wątek
6. **db.rs** — Dodać indeksy złożone `sessions(app_id, date)` i `file_activities(app_id, date, last_seen, first_seen)`
7. **assignment_model.rs:967** — `date(created_at)` → `created_at >=` dla użycia indeksu
8. **MultiSplitSessionModal.tsx** — Dodać 9 brakujących kluczy i18n do obu plików locale
9. **Sessions.tsx:374** — Dodać flagę `cancelled` w useEffect
10. **App.tsx:156** — Przenieść `report-view` do PageRouter

### P2 — Średnie (optymalizacja + jakość)

11. **sessions.rs:155** — N+1 queries → mapa `project_name → id`
12. **sql_fragments.rs** — Zunifikować CTE do jednej funkcji
13. **sessions.rs:916+** — Wyekstrahować jedną funkcję `parse_datetime`
14. **tray.rs:268** — `tasklist.exe` → `CreateToolhelp32Snapshot`
15. **Sidebar.tsx:214** — `getDatabaseSettings` raz zamiast co 10s
16. **BackgroundServices.tsx:26** — `JOB_LOOP_TICK_MS` 2000 → 5000
17. **Help.tsx** — Dodać dokumentację ProjectPage, AI metrics, blacklists, waluty, języka

### P3 — Niskie (cleanup)

18. Usunąć zduplikowaną `no_console` (tray.rs/main.rs)
19. Usunąć zbędne `.to_lowercase()` (config.rs:202)
20. Zamienić `GetTickCount` na `GetTickCount64` (monitor.rs:467)
21. Naprawić mutację argumentu w `saveTemplate` (report-templates.ts:71)
22. Dodać i18n dla `(copy)` w `duplicateTemplate` (report-templates.ts:97)
23. Zamienić hardkodowane kolory na zmienne Tailwind (SessionRow.tsx:110)
24. `useCallback` dla `shiftDateRange` (useTimeAnalysisData.ts:56)

---

*Raport wygenerowany automatycznie na podstawie analizy kodu źródłowego projektu TIMEFLOW v0.1.505.*
