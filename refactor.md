# TIMEFLOW — Raport refaktoryzacji

> Wygenerowano: 2026-03-13
> Priorytet: zachowanie dotychczasowych danych i kompatybilności wstecznej.
> Cel: plan prac dla kolejnego modelu, który sporządzi szczegółowy `plan_implementacji.md`.

---

## Status realizacji

### 2026-03-13

- `ZROBIONE`: C-R1, C-R2, C-R3
- `ZROBIONE`: C-F1, C-F2, C-F3
- `ZROBIONE`: C-I1, C-I2
- `ZROBIONE`: H-R1, H-R3, H-R5, H-F5, H-I1, H-I2, H-I3
- `ZROBIONE`: H-R2, H-R4, H-R6, H-F1, H-F3, H-F4
- `ZROBIONE`: M-R1, M-R2, M-R4, M-R6, M-R7
- `ZROBIONE`: M-F1, M-F2, M-F3, M-F5, M-F6, M-F7, M-F8, M-F9
- `ZROBIONE`: M-I1, M-I2, M-I3, M-I4
- `ZROBIONE`: M-R3, M-F4
- `ZROBIONE`: L-R4, L-R5, L-F1, L-F2, L-F3, L-F4, L-F5, L-I2
- `ZROBIONE`: L-R2, L-I1
- `ZROBIONE`: 11.2, 11.5, 11.6
- `ZROBIONE`: 11.1, 11.3, 11.4
- `ZWERYFIKOWANE JAKO JUŻ OK`: M-R5, L-R1, L-R3, L-I3
- `PENDING`: brak
- `WERYFIKACJA OK`: `cargo test -p timeflow-demon`, `cargo check -p timeflow-dashboard`, `npm run typecheck`, `npm run test`, `npm run lint`

---

## Spis treści

1. [KRYTYCZNE — Rust Backend](#1-krytyczne--rust-backend)
2. [KRYTYCZNE — React Frontend](#2-krytyczne--react-frontend)
3. [KRYTYCZNE — i18n / Tłumaczenia](#3-krytyczne--i18n--tłumaczenia)
4. [WYSOKIE — Rust Backend](#4-wysokie--rust-backend)
5. [WYSOKIE — React Frontend](#5-wysokie--react-frontend)
6. [WYSOKIE — i18n / Terminologia](#6-wysokie--i18n--terminologia)
7. [ŚREDNIE — Rust Backend](#7-średnie--rust-backend)
8. [ŚREDNIE — React Frontend](#8-średnie--react-frontend)
9. [ŚREDNIE — i18n](#9-średnie--i18n)
10. [NISKIE](#10-niskie)
11. [Modularyzacja i architektura](#11-modularyzacja-i-architektura)
12. [Wskazówki dla modelu implementującego](#12-wskazówki-dla-modelu-implementującego)

---

## 1. KRYTYCZNE — Rust Backend

### C-R1: `db.rs` — migracje uruchamiane przy każdym wywołaniu `get_primary_connection`

**Plik:** `dashboard/src-tauri/src/db.rs` ~linia 536
**Problem:** `initialize_database_file` (pełny łańcuch migracji + `pragma_table_info`) jest wywoływany przy KAŻDYM `get_primary_connection`. To niepotrzebne I/O na gorącej ścieżce.
**Naprawa:** Dodać flagę `OnceLock<()>` lub `AtomicBool` — migracje uruchamiać tylko raz na proces. Sprawdzić, czy `initialize_database_file` jest idempotentne (jest, ale kosztowne).

### C-R2: `tracker.rs` — martwy guard `continue` po ustawieniu `process_snapshot_cache`

**Plik:** `src/tracker.rs` ~linia 447–452
**Problem:** `let Some(proc_snap) = process_snapshot_cache.as_ref() else { continue; }` — ten `else` nigdy nie jest osiągalny, bo 4 linie wcześniej `process_snapshot_cache = Some(...)`. Kod jest martwy, ale gdyby `build_process_snapshot` kiedykolwiek zwrócił `None`, pętla weszłaby w spin-loop bez `sleep`.
**Naprawa:** Usunąć martwy guard lub zamienić na `unwrap()` z komentarzem. Rozważyć defensywny `sleep` w gałęzi `None`.

### C-R3: `daily_store.rs` — potencjalna kolizja PRIMARY KEY przy duplikatach plików w pamięci

**Plik:** `shared/daily_store.rs` ~linia 249–362
**Problem:** Jeśli daemon wyprodukuje zduplikowane nazwy plików w wektorze (teoretycznie możliwe), drugi `DELETE` usunie wiersz wstawiony przez pierwszy `UPSERT`.
**Naprawa:** Deduplikacja wektora plików przed zapisem (`BTreeSet` lub `HashMap` po `file_cache_key`).

---

## 2. KRYTYCZNE — React Frontend

### C-F1: `ui-store.ts` — race condition w async `setCurrentPage`

**Plik:** `dashboard/src/store/ui-store.ts` ~linia 86–98
**Problem:** Odczyt `currentPage` przed `await`, porównanie po `await` — typowy wzorzec wyścigu. Jeśli dwie nawigacje odpalą się blisko siebie, jedna może zostać fałszywie anulowana.
**Naprawa:** Wzorzec `requestId` (inkrementowany counter) — ignorować wynik guardu jeśli `requestId` się zmienił.

### C-F2: `chart-animation.ts` — odczyt Zustand store poza hookiem React

**Plik:** `dashboard/src/lib/chart-animation.ts` ~linia 36
**Problem:** `useSettingsStore.getState().chartAnimations` wywołany w zwykłej funkcji (nie hooku). Zmiana ustawień animacji nie spowoduje re-renderu wykresów.
**Naprawa:** Zamienić na hook `useChartAnimationConfig()` lub przekazywać wartość jako parametr.

### C-F3: `data-store.ts` — mutable state na poziomie modułu (throttle timery)

**Plik:** `dashboard/src/store/data-store.ts` ~linia 38–42
**Problem:** `lastRefreshAtMs`, `scheduledRefreshTimer` itd. żyją na poziomie modułu, przeżywają reset store'a, brak cleanup.
**Naprawa:** Przenieść do wnętrza store'a lub dodać `resetThrottleState()` wywoływany przy reset.

---

## 3. KRYTYCZNE — i18n / Tłumaczenia

### C-I1: Mojibake — 4 klucze z `?` zamiast polskich znaków

**Plik:** `dashboard/src/locales/pl/common.json`
| Linia | Klucz | Obecna wartość | Poprawna |
|-------|-------|---------------|----------|
| 386 | `ai_page.errors.status_load_failed` | `"Nie uda?o si? wczyta? statusu..."` | `"Nie udało się wczytać statusu..."` |
| 495 | `ai_page.text.you_have_corrections...` | `"...od ostatniego treningu (pr?g: ...)"` | `"...(próg: ...)"` |
| 496 | `ai_page.text.over_h_passed...` | `"Min??o ponad..."` | `"Minęło ponad..."` |
| 497 | `ai_page.text.the_model_has...` | `"...nigdy nie by? trenowany."` | `"...nigdy nie był trenowany."` |

### C-I2: Literówki krytyczne w PL

| Linia | Klucz | Obecna | Poprawna |
|-------|-------|--------|----------|
| 411 | `ai_page.text.reminder_snoozed_for_h` | `"odrożone"` | `"odroczone"` |
| 446 | `ai_page.text.training_reminder_snoozed_until` | `"odrożone do:"` | `"odroczone do:"` |
| 1426 | `help_page.raw_mathematical...` | `"Służą gównie..."` | `"Służą głównie..."` |

---

## 4. WYSOKIE — Rust Backend

### H-R1: Duplikacja logiki migracji katalogów

**Pliki:** `dashboard/src-tauri/src/db.rs` linie 172–212 vs `shared/timeflow_paths.rs`
**Problem:** `app_storage_dir` w `db.rs` zawiera kopię logiki z `ensure_timeflow_base_dir`. Zmiana w jednym miejscu wymaga zmiany w drugim.
**Naprawa:** `db.rs` powinien wywołać `ensure_timeflow_base_dir` z `shared/timeflow_paths.rs`.

### H-R2: Duplikacja `no_console`

**Pliki:** `src/process_utils.rs` vs `dashboard/src-tauri/src/commands/helpers.rs`
**Problem:** Identyczna funkcja `no_console` w dwóch miejscach.
**Naprawa:** Przenieść do `shared/` i inkludować via `#[path]`.

### H-R3: `daemon.rs` — podwójne wywołanie `find_daemon_exe`

**Plik:** `dashboard/src-tauri/src/commands/daemon.rs` linie 281–297
**Problem:** `find_daemon_exe()` (filesystem I/O) wywoływane dwukrotnie w `build_daemon_status`.
**Naprawa:** Jeden `let exe = find_daemon_exe().ok();` i reuse.

### H-R4: `query.rs` — podwójna ścieżka rozwiązywania nazw projektów

**Plik:** `dashboard/src-tauri/src/commands/sessions/query.rs` linie 430–516
**Problem:** Nazwy projektów rozwiązywane dwa razy: raz przez JOIN w głównym zapytaniu, raz przez osobny batch query dla sugestii AI.
**Naprawa:** Zunifikować do jednej ścieżki.

### H-R5: `daily_store.rs` — N zapytań SELECT per app w `replace_day_snapshot`

**Plik:** `shared/daily_store.rs` linie 249–362
**Problem:** Dla każdej app osobne `SELECT file_name FROM daily_files WHERE date=? AND exe_name=?`. Przy 20 appach = 20 zapytań.
**Naprawa:** Jedno zapytanie `SELECT exe_name, file_name FROM daily_files WHERE date=?` + grupowanie w pamięci.

### H-R6: `rebuild.rs` — `gap_duration` może być ujemne przy overlapping sessions

**Plik:** `dashboard/src-tauri/src/commands/sessions/rebuild.rs` linie 78–81
**Problem:** Brak komentarza/guardu na negatywne `gap_duration`. Matematycznie poprawne, ale nieudokumentowane.
**Naprawa:** Dodać `max(0, gap_duration)` lub komentarz wyjaśniający.

---

## 5. WYSOKIE — React Frontend

### H-F1: `Sessions.tsx` — `minDuration` czytany z localStorage przy każdym renderze

**Plik:** `dashboard/src/pages/Sessions.tsx` linie 306–307
**Problem:** `readMinSessionDuration()` deserializuje z `localStorage` przy każdym renderze. Nie aktualizuje się po zmianie settings.
**Naprawa:** `useMemo` z zależnością od settings store lub `useRef` z aktualizacją w `reloadDisplaySettings`.

### H-F2: `Sessions.tsx` — ręczna deep equality (70 linii) niezwiązana z typem

**Plik:** `dashboard/src/pages/Sessions.tsx` linie 126–195
**Problem:** `areSessionsEqual` ręcznie porównuje każde pole — dodanie nowego pola do `SessionWithApp` nie spowoduje błędu kompilacji.
**Naprawa:** Użyć `fast-deep-equal` lub wynieść do `lib/session-utils.ts` z testami.

### H-F3: `BackgroundServices.tsx` — brak koordynacji między AI assignment a project sync

**Plik:** `dashboard/src/components/sync/BackgroundServices.tsx` linie 182–257
**Problem:** `useAutoProjectSync` (tworzy nowe projekty z folderów) i `useAutoAiAssignment` uruchamiają się jednocześnie po `autoImportDone`. AI może operować na nieaktualnych danych projektów.
**Naprawa:** Sekwencyjna kolejność: sync projektów → AI assignment. Użyć wspólnego locka lub `await`.

### H-F4: `report-templates.ts` — `i18n.t()` przy ładowaniu modułu

**Plik:** `dashboard/src/lib/report-templates.ts` linie 21–29
**Problem:** `createDefaultTemplate()` woła `i18n.t()` synchronicznie. Jeśli i18n nie załadował jeszcze plików językowych, klucz surowy trafia do `localStorage` na stałe.
**Naprawa:** Lazy initialization — wywoływać `i18n.t()` przy odczycie, nie przy tworzeniu.

### H-F5: `tauri.ts` — `importDataArchive` nie emituje `LOCAL_DATA_CHANGED_EVENT`

**Plik:** `dashboard/src/lib/tauri.ts` linie 532–534
**Problem:** Używa `invoke` zamiast `invokeMutation`. Po imporcie archiwum (sync pull) UI nie odświeża się automatycznie.
**Naprawa:** Zamienić na `invokeMutation`.

---

## 6. WYSOKIE — i18n / Terminologia

### H-I1: "Demon" vs "Daemon" — niespójność PL/EN

**Pliki:** `pl/common.json`, `en/common.json`, `src/i18n.rs`
**Problem:**
- PL nawigacja: "Demon", PL Help: "Daemon" — niespójne
- EN tray (`src/i18n.rs`): "Demon" zamiast "Daemon"
- EN QuickStart: "Starting the Demon" zamiast "Starting the Daemon"
**Naprawa:** Ujednolicić:
- PL: wszędzie "Demon"
- EN: wszędzie "Daemon"

### H-I2: 14 angielskich kluczy w PL (etykiety wykresów AI)

**Plik:** `pl/common.json` linie 454–466
**Problem:** `Accept`, `Reject`, `Manual`, `Assigned`, `Runs`, `Rollbacks` itd. — angielskie wartości w polskim pliku.
**Naprawa:** Przetłumaczyć: Akceptuj, Odrzuć, Ręcznie, Przypisane, Uruchomienia, Wycofania.

### H-I3: Sprzeczność w Help: monitor-all fallback

**Plik:** `pl/common.json` (i EN) linie ~1185 vs ~1574
**Problem:** QuickStart mówi "daemon falls back to monitor-all", a sekcja Daemon w Help mówi "empty list pauses tracking". Sprzeczne informacje.
**Naprawa:** Zweryfikować w kodzie daemon (src/tracker.rs) jakie jest faktyczne zachowanie i ujednolicić oba opisy.

---

## 7. ŚREDNIE — Rust Backend

### M-R1: `monitor.rs` — WMI COM bez jawnego ustawienia apartment modelu
- **Plik:** `src/monitor.rs` linie 15–18
- Komentarz wystarczy, jeśli nie ma planu zmiany wątku.

### M-R2: `config.rs` — `monitored_exe_names` nie robi `.to_lowercase()`
- **Plik:** `src/config.rs` linie 205–210
- Latentny bug: jeśli `MonitoredApp` zostanie skonstruowany bez lowercasingu, matching zawiedzie.

### M-R3: `split.rs` — `strip_split_markers` ręcznie parsuje zamiast regex
- **Plik:** `dashboard/src-tauri/src/commands/sessions/split.rs` linie 240–281
- Trzy przebiegi do stabilizacji. Regex byłby single-pass.

### M-R4: `version_compat.rs` — `(rel1 - rel2).abs()` fragile na overflow
- **Plik:** `shared/version_compat.rs` linia 19
- Zamienić na `rel1.abs_diff(rel2) <= 3`.

### M-R5: `db.rs` — VACUUM przed ustawieniem connection pool
- **Plik:** `dashboard/src-tauri/src/db.rs` linie 299–392
- Tymczasowe połączenie jest dropowane; WAL może nie być sfluszhowany.

### M-R6: `query.rs` — temp table `_fa_keys` nie jest dropowana po użyciu
- **Plik:** `dashboard/src-tauri/src/commands/sessions/query.rs` linie 275–330

### M-R7: `mutations.rs` — martwy kod: warunek `updated_session == 0` nigdy nieosiągalny
- **Plik:** `dashboard/src-tauri/src/commands/sessions/mutations.rs` linie 96–98

---

## 8. ŚREDNIE — React Frontend

### M-F1: Duplikacja `isNewProject` w Projects.tsx vs Sessions.tsx
- Wynieść do `lib/project-utils.ts`.

### M-F2: `data-store.ts` — `canShiftForward` jako funkcja w store powoduje zbędne re-rendery
- Zamienić na selector lub getter.

### M-F3: `BackgroundServices.tsx` — okno czasowe utraty eventu `LOCAL_DATA_CHANGED_EVENT`
- Między cleanup a re-attach event listenera.

### M-F4: `projects-cache-store.ts` — `invalidateProjectsAllTime` zostawia stale data bez loading indicator

### M-F5: `SessionRow.tsx` — score breakdown IIFE zduplikowane (compact vs detailed)
- Wynieść do wspólnego komponentu.

### M-F6: `Sessions.tsx` — `customScrollParent` DOM query może zwrócić null przy pierwszym renderze
- Zamienić na `useRef` + callback ref na `<main>`.

### M-F7: Duplikacja `buildTodayDate` — `background-status-store.ts` vs `data-store.ts`
- Użyć jednej implementacji z `date-fns`.

### M-F8: `online-sync.ts` — hardcoded production URL
- Przenieść do zmiennej środowiskowej / konfiguracji build.

### M-F9: `'__unassigned__'` sentinel zduplikowany w 3 plikach
- Jeden export z `lib/project-labels.ts`.

---

## 9. ŚREDNIE — i18n

### M-I1: "boost" / "wzmocniona" / "z mnożnikiem" / "podbita" — 4 synonimy w PL
- Ujednolicić do jednego terminu (sugestia: "z mnożnikiem" jako najbardziej opisowe).

### M-I2: "Dziś" vs "Dzisiaj" — niespójne w PL
- Ujednolicić do jednego (sugestia: "Dziś" — krótsze, lepsze w UI).

### M-I3: "Wyceny" vs "Estymacje" — niespójne w PL
- Ujednolicić do jednego (sugestia: "Wyceny" — już używane w nawigacji).

### M-I4: Forma liczebnikowa `wzmocniona(-ych)` — brzydki kompromis
- Rozważyć i18next plural forms (`_one`, `_few`, `_many`, `_other`).

---

## 10. NISKIE

### Rust
- L-R1: `storage.rs` — podwójne wywołanie `update_summary`
- L-R2: `daily_store.rs` — `load_range_snapshots` ma 4 osobne zapytania zamiast JOIN
- L-R3: `tray.rs` — `query_unassigned_attention_count` wywoływane 2x na starcie
- L-R4: `monitor.rs` — PIDs sortowane numerycznie zamiast wg recency
- L-R5: `assignment_model/mod.rs` — `suggest_project_for_session` oznaczone `#[allow(dead_code)]` i `#[command]` ale niezarejestrowane

### Frontend
- L-F1: Rate/multiplier parsing rozrzucone po 3 plikach — konsolidacja w `lib/rate-utils.ts`
- L-F2: `SessionRow.tsx` — buttony delete bez `type="button"`
- L-F3: `App.tsx` — ErrorBoundary "try again" może zapętlić się na persistent error
- L-F4: `data-store.ts` — `setTimePreset('custom')` resetuje zakres do dzisiaj
- L-F5: `Sessions.tsx` — `PAGE_SIZE` wewnątrz komponentu zamiast na poziomie modułu

### i18n
- L-I1: `help.sections` — tylko 2 klucze z 12 sekcji (fragmentaryczny duplikat)
- L-I2: `help_page` — brak dedykowanej sekcji dla ImportPage
- L-I3: Klucz ZIP Export w help_page opisuje funkcję — zweryfikować czy istnieje w kodzie

---

## 11. Modularyzacja i architektura

### 11.1 Rust — workspace crate `timeflow-shared`

**Obecny stan:** `shared/*.rs` jest inkludowany via `#[path = "../shared/..."]` — kompilowany osobno w daemon i Tauri binary.
**Propozycja:** Cargo workspace z cratem `timeflow-shared`. Korzyści:
- Jedna kompilacja
- Wspólny logging
- Właściwe zależności i wersjonowanie

**Pliki do przeniesienia:** `shared/daily_store.rs`, `shared/session_settings.rs`, `shared/timeflow_paths.rs`, `shared/version_compat.rs`, nowy `shared/process_utils.rs` (po konsolidacji H-R2).

### 11.2 Rust — split `commands/daemon.rs`

Podzielić 465-liniowy plik na:
- `commands/daemon/status.rs` — wykrywanie procesu, wersja, cache
- `commands/daemon/control.rs` — start/stop/restart/autostart

### 11.3 Rust — wydzielenie `db/pool.rs`

`ConnectionPool` (~110 linii) wydzielić z `db.rs` do `db/pool.rs`.

### 11.4 Frontend — rozbicie `Sessions.tsx` (~1100+ linii)

Wydzielić hooki:
- `useSplitAnalysis` — logika batch split (linie ~587–677)
- `useScoreBreakdown` — zarządzanie score breakdown (linie ~679–714)
- `useSessionContextMenu` — context menu (linie ~733–993)

### 11.5 Frontend — konsolidacja utilities

| Nowy plik | Co przenieść |
|-----------|-------------|
| `lib/project-utils.ts` | `isNewProject` z Projects.tsx, `isNewProjectForAssignList` z Sessions.tsx |
| `lib/rate-utils.ts` | `parseRateInput`, `formatRateInput` z form-validation.ts, `formatMultiplierLabel` z utils.ts, `parsePositiveRateMultiplierInput` z useSessionActions.ts |
| `lib/date-helpers.ts` | `buildTodayDate` z background-status-store.ts |
| `lib/project-labels.ts` | Jedyny source of truth dla `'__unassigned__'` sentinel |

### 11.6 Frontend — `Sessions.tsx` equality functions

Wynieść `areSessionsEqual`, `areFileActivitiesEqual`, `areSessionListsEqual` do `lib/session-utils.ts` z testami jednostkowymi.

---

## 12. Wskazówki dla modelu implementującego

### Jak sporządzić `plan_implementacji.md`

1. **Pogrupuj zmiany w fale** — każda fala = zmiany które można bezpiecznie wdrożyć razem bez ryzyka regresji:
   - **Fala 0 (trivial, zero-risk):** Literówki i18n (C-I1, C-I2), terminologia (H-I1, M-I1–M-I3)
   - **Fala 1 (low-risk refactor):** Duplikaty kodu (H-R1, H-R2, H-R3), konsolidacja utilities frontend (M-F1, M-F7, M-F9)
   - **Fala 2 (medium-risk logic fixes):** C-R1 (migracje), C-F1 (race condition), H-F3 (koordynacja sync), H-F5 (importDataArchive)
   - **Fala 3 (architecture):** Workspace crate, split Sessions.tsx, split daemon.rs

2. **Dla każdej zmiany w planie podaj:**
   - Dokładne pliki i linie do modyfikacji
   - Oczekiwany diff (stary kod → nowy kod) lub opis transformacji
   - Test manualny lub automatyczny do weryfikacji
   - Potencjalne efekty uboczne

3. **Zasady bezpieczeństwa danych:**
   - NIGDY nie zmieniaj schematu bazy bez migracji
   - NIGDY nie usuwaj kolumn — tylko dodawaj nowe
   - Przy zmianie logiki `daily_store.rs` lub `sessions/*.rs` — najpierw backup bazy
   - Przy zmianie `replace_day_snapshot` — test na istniejących danych (min. 30 dni)

4. **Kolejność czytania plików:**
   - Zacznij od `dashboard/src-tauri/src/db.rs` i `shared/daily_store.rs` — krytyczna ścieżka danych
   - Potem `src/tracker.rs` i `src/monitor.rs` — pętla główna daemon
   - Potem `dashboard/src/store/data-store.ts` i `dashboard/src/store/ui-store.ts` — stan frontend
   - Na końcu strony i komponenty

5. **Weryfikacja po każdej fali:**
   - `cd dashboard && npx tsc --noEmit` — brak błędów TS
   - `cd dashboard/src-tauri && cargo check` — brak błędów Rust
   - Manualne testy: nawigacja po stronach, zmiana języka, import/export danych

6. **Czego NIE robić:**
   - Nie zmieniaj nazw tabel/kolumn w SQLite
   - Nie przenoś plików bez aktualizacji wszystkich importów
   - Nie usuwaj `#[allow(dead_code)]` bez weryfikacji czy kod jest faktycznie nieużywany
   - Nie zmieniaj API Tauri commands (nazwy komend) — frontend od nich zależy
   - Nie zmieniaj struktury `localStorage` keys — użytkownicy mają zapisane dane

---

## Podsumowanie ilościowe

| Priorytet | Rust Backend | React Frontend | i18n | Razem |
|-----------|:---:|:---:|:---:|:---:|
| KRYTYCZNE | 3 | 3 | 2 | **8** |
| WYSOKIE | 6 | 5 | 3 | **14** |
| ŚREDNIE | 7 | 9 | 4 | **20** |
| NISKIE | 5 | 5 | 3 | **13** |
| **Razem** | **21** | **22** | **12** | **55** |

Sugerowana kolejność prac: i18n (fala 0) → duplikaty Rust (fala 1) → logika frontend (fala 2) → architektura (fala 3).
