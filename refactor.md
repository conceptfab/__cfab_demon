# TIMEFLOW — Raport refaktoryzacji i plan prac

> Wygenerowano: 2026-03-14
> Projekt: ~51 000 linii kodu (Rust daemon + Tauri backend + React/TS frontend)
> Priorytet: zachowanie dotychczasowych danych

---

## Status weryfikacji 2026-03-14

- `[1.1]` ZAMKNIĘTE: `daily_files` używa już klucza `(date, exe_name, file_name, detected_path)`, a `dedupe_files_preserving_last` rozróżnia pliki po `name + detected_path`.
- `[1.2]` ZAMKNIĘTE WCZEŚNIEJ: timeline projektów już przenosi `has_boost`, `has_manual` i `comments`; raport w tej części był nieaktualny.
- `[2.1]` ZAMKNIĘTE: `compute_score_breakdowns` używa teraz batch-fetch nazw projektów zamiast N+1 query.
- `[2.2]` ZAMKNIĘTE: hot-path w `assignment_model/scoring.rs` i `assignment_model/context.rs` używa `prepare_cached(...)`.
- `[2.3]` ZAMKNIĘTE: hydration ścieżek w `src/monitor.rs` uruchamia się tylko dla foreground PID wymagającego pierwszej próby detekcji.
- `[3.1]` ZAMKNIĘTE: wspólne budowanie danych stacked bar zostało wydzielone do `analysis.rs` i użyte w dwóch call-site.
- `[3.2]` ZAMKNIĘTE: parsowanie dat zostało scentralizowane w `datetime.rs`; duplikaty w `analysis.rs` i `sessions/query.rs` zostały usunięte.
- `[3.5]` ZAMKNIĘTE: wspólna funkcja rozróżniania nazw projektów obsługuje już `analysis.rs` i `dashboard.rs`.
- `[3.8]` ZAMKNIĘTE: wspólny `name_hash(...)` obsługuje już oba generatory kolorów.
- `[3.10]` ZAMKNIĘTE: `dashboard/src/lib/db-types.ts` ma już `updated_at` w `Project`.
- `[4.1]` ZAMKNIĘTE: dodano brakujące klucze `sessions.menu.*_az` do PL i EN.
- `[4.2]` ZAMKNIĘTE: fallback `split_session` w `Sessions.tsx` został zmieniony na EN.

---

## Spis treści

1. [Krytyczne błędy (utrata danych / błędy logiczne)](#1-krytyczne-bledy)
2. [Wydajność i wielowątkowość](#2-wydajnosc)
3. [Duplikacje kodu i refaktoryzacja](#3-duplikacje)
4. [Tłumaczenia i Help](#4-tlumaczenia)
5. [Architektura i modularyzacja](#5-architektura)
6. [Sugestie funkcjonalne](#6-sugestie)
7. [Plan prac (kolejność implementacji)](#7-plan-prac)
8. [Wskazówki dla modelu implementującego](#8-wskazowki)

---

## 1. Krytyczne błędy (utrata danych / błędy logiczne) {#1-krytyczne-bledy}

### 1.1 KRYTYCZNY: `dedupe_files_preserving_last` ignoruje `detected_path` — ciche łączenie różnych plików

- **Status 2026-03-14:** zamknięte. Deduplikacja uwzględnia już `detected_path`, store migruje stary schemat `daily_files`, a testy pokrywają zarówno migrację, jak i dwa pliki o tej samej nazwie z różnych ścieżek.

- **Plik:** `shared/daily_store.rs:58-67`
- **Problem:** Deduplikacja plików używa tylko `file.name` jako klucza. Dwa pliki o tej samej nazwie ale z różnych repozytoriów (`index.ts` z repo A i `index.ts` z repo B) są traktowane jako duplikaty — jeden jest usuwany. Dane tracone permanentnie przy zapisie do DB.
- **Dodatkowy problem:** Schemat `daily_files` ma `PRIMARY KEY (date, exe_name, file_name)` — nie może reprezentować dwóch plików o tej samej nazwie z różnych ścieżek.
- **Naprawa:**
  1. Zmienić klucz deduplikacji na `format!("{}|{}", file.name, file.detected_path.as_deref().unwrap_or(""))`
  2. Zmienić PRIMARY KEY na `(date, exe_name, file_name, detected_path)` — wymaga migracji DB
  3. **UWAGA:** Migracja musi zachować istniejące dane — dodać kolumnę `detected_path` do klucza, nie usuwać tabeli
- **Ryzyko:** WYSOKIE — utrata danych produkcyjnych

### 1.2 KRYTYCZNY: Bug — dashboard timeline traci informację `has_boost`/`has_manual`

- **Status 2026-03-14:** zamknięte wcześniej w aktualnym kodzie. `dashboard.rs` i `analysis.rs` już przekazują `bucket_flags` oraz `bucket_comments`.

- **Plik:** `dashboard/src-tauri/src/commands/dashboard.rs:180-256`
- **Problem:** `build_project_timeline_rows` jest duplikatem logiki z `analysis.rs:595-673`, ale NIE obsługuje `bucket_flags` i `bucket_comments`. Efekt: dashboard timeline nie pokazuje informacji o boost/manual w sesji.
- **Naprawa:** Wydzielić wspólną funkcję (patrz sekcja 3.1) i upewnić się, że oba wywołania przekazują flagi.

---

## 2. Wydajność i wielowątkowość {#2-wydajnosc}

### 2.1 WYSOKI: N+1 query w `compute_score_breakdowns`

- **Status 2026-03-14:** zamknięte. Nazwy projektów są pobierane batchowo do `HashMap<i64, String>` przed budową kandydatów.

- **Plik:** `dashboard/src-tauri/src/commands/assignment_model/scoring.rs:213-219`
- **Problem:** Osobne `SELECT name FROM projects WHERE id = ?1` dla KAŻDEGO kandydującego projektu. Przy wielu projektach = N+1 pattern blokujący Tauri async runtime.
- **Naprawa:** Batch-fetch: `SELECT id, name FROM projects WHERE id IN (...)` → `HashMap<i64, String>` przed pętlą.

### 2.2 WYSOKI: `prepare()` zamiast `prepare_cached()` na hot-path

- **Status 2026-03-14:** zamknięte dla wskazanych miejsc w `scoring.rs` i `context.rs`.

- **Pliki:** `scoring.rs:121,139` + `context.rs:92,154`
- **Problem:** W pętli po sesjach (batch AI scoring), `conn.prepare(...)` re-parsuje SQL przy KAŻDYM wywołaniu. 50 sesji = 100+ kompilacji SQL.
- **Naprawa:** Zamienić `conn.prepare(` na `conn.prepare_cached(` w scoring i context.

### 2.3 WYSOKI: `hydrate_detected_paths_for_pending_pids` wywoływana co 10 s bezwarunkowo

- **Status 2026-03-14:** zamknięte. Wywołanie jest teraz guardowane stanem foreground PID.

- **Plik:** `src/monitor.rs:164`
- **Problem:** `get_foreground_info` bezwarunkowo wywołuje hydration, która skanuje cały `pid_cache` + sortuje + potencjalnie odpala WMI, nawet gdy nie ma nowych PID.
- **Naprawa:** Guard: wywoływać hydration tylko gdy foreground PID ma `path_detection_attempted = false`.

### 2.4 ŚREDNI: `replace_day_snapshot` — pełny scan + per-row DELETE co 5 minut

- **Plik:** `shared/daily_store.rs:267-289`
- **Problem:** `SELECT` wszystkich plików + indywidualne `DELETE` per usunięty plik. Przy 500 wierszy na dzień to dużo operacji.
- **Naprawa:** Jeden `DELETE WHERE file_name NOT IN (...)` zamiast pętli DELETE.

### 2.5 ŚREDNI: `ProjectDayTimeline.tsx` — brak memoizacji kosztownych obliczeń

- **Plik:** `dashboard/src/components/dashboard/ProjectDayTimeline.tsx:180-285`
- **Problem:** `mergeSessionFragments` i `summarizeCluster` obliczane przy każdym renderze (sortowanie + iteracja segmentów). Komponent 1502 linii.
- **Naprawa:** Opakować w `useMemo` z odpowiednimi deps.

### 2.6 ŚREDNI: `BackgroundServices.tsx` — niestabilne deps mogą restartować interwał

- **Plik:** `dashboard/src/components/sync/BackgroundServices.tsx:427-468`
- **Problem:** `useEffect` z `setInterval` zależy od callbacków, które mogą tracić stabilność referencji (np. `refreshDiagnostics`, `refreshDatabaseSettings`).
- **Naprawa:** Zweryfikować stabilność referencji; jeśli niestabilne — opakować w `useRef`.

### 2.7 ŚREDNI: `Sessions.tsx` — event listener re-registration na zmianę filtrów

- **Plik:** `dashboard/src/pages/Sessions.tsx:407-422`
- **Problem:** `visibilitychange` i `focus` listenery re-rejestrowane przy każdej zmianie filtrów, bo `loadFirstSessionsPage` jest dep.
- **Naprawa:** `useRef` do trzymania latest ref, listener registration z `[]` deps.

### 2.8 ŚREDNI: WMI COM lazy-init blokuje polling loop na 30-60 ms

- **Plik:** `src/monitor.rs:325-330`
- **Problem:** `COMLibrary::new()` odpalany przy pierwszym PID wymagającym WMI.
- **Naprawa:** Eager init przy starcie wątku monitora.

---

## 3. Duplikacje kodu i refaktoryzacja {#3-duplikacje}

### 3.1 WYSOKI: Zduplikowana logika stacked bar (80 linii × 2)

- **Status 2026-03-14:** zamknięte. Wspólny builder został wydzielony do `analysis.rs` i użyty z `dashboard.rs`.

- **Pliki:** `dashboard.rs:180-256` vs `analysis.rs:595-673`
- **Problem:** Identyczna sekwencja: sort ranked_projects → take(limit) → build HashMap → sum other → insert OTHER_KEY.
- **Naprawa:** Wydzielić `build_stacked_bar_output(...)` do `analysis.rs`, oba miejsca wywołują wspólną funkcję.

### 3.2 WYSOKI: Trzy oddzielne parsery dat

- **Status 2026-03-14:** zamknięte. `datetime.rs` udostępnia teraz wspólne parsery dla `FixedOffset`, `Local` i opcjonalnych milisekund.

- **Pliki:** `datetime.rs:1-33`, `analysis.rs:159-178`, `sessions/query.rs:44-48`
- **Problem:** 3 funkcje parsujące te same formaty RFC3339 z wariantami. `parse_rfc3339_millis` to dokładnie `parse_datetime_ms`.
- **Naprawa:** Centralizacja w `datetime.rs`, usunięcie duplikatów.

### 3.3 WYSOKI: Trzy zestawy typów daily data + ręczny mapping

- **Pliki:** `src/storage.rs:19-63`, `shared/daily_store.rs:10-50`, `commands/types.rs:7-48`
- **Problem:** 3 strukturalnie identyczne zestawy typów (`DailyData`/`StoredDailyData`/`JsonDailyData`) z boilerplate mappingiem.
- **Naprawa:** Dashboard powinien używać `timeflow_shared::daily_store::StoredXxx` bezpośrednio, eliminując `JsonXxx` z types.rs. Wymaga dodania `#[derive(Serialize)]` do StoredXxx.

### 3.4 ŚREDNI: `is_hidden` filter jako literal string w 10 miejscach

- **Pliki:** `analysis.rs` (×2), `dashboard.rs` (×5), `sessions/split.rs`, `sessions/rebuild.rs`, `assignment_model/auto_safe.rs`
- **Naprawa:** Stała `ACTIVE_SESSION_FILTER` w `sql_fragments.rs`.

### 3.5 ŚREDNI: Zduplikowana logika disambiguation nazw projektów

- **Status 2026-03-14:** zamknięte. `analysis.rs` i `dashboard.rs` używają wspólnych helperów z `commands/helpers.rs`.

- **Pliki:** `analysis.rs:95-119` vs `dashboard.rs:147-175`
- **Naprawa:** Wydzielić `disambiguate_project_names(...)`.

### 3.6 ŚREDNI: Triplowany refresh listener pattern w 3 stronach

- **Pliki:** `Sessions.tsx`, `Projects.tsx`, `ProjectPage.tsx`
- **Problem:** 40-60 linii identycznego boilerplate (addEventListener → shouldRefreshPage → reload).
- **Naprawa:** Hook `usePageRefreshListener(shouldRefresh, onRefresh)`.

### 3.7 NISKI: Pure functions wyeksportowane z pliku hooka

- **Plik:** `hooks/useSessionActions.ts:32-46`
- **Problem:** `findSessionIdsMissingComment`, `requiresCommentForMultiplierBoost` to pure functions importowane przez strony — powinny być w `lib/`.
- **Naprawa:** Przenieść do `lib/session-utils.ts`.

### 3.8 NISKI: Zduplikowany hash kernel w generatorach kolorów

- **Status 2026-03-14:** zamknięte. Wspólny hash został wydzielony do `commands/helpers.rs`.

- **Pliki:** `dashboard.rs:506-517` vs `projects.rs:100-132`
- **Naprawa:** Wydzielić `fn name_hash(name: &str) -> u32` do `helpers.rs`.

### 3.9 NISKI: `project-colors.ts` — potencjalnie martwy plik

- **Plik:** `dashboard/src/lib/project-colors.ts`
- **Problem:** 8-elementowa paleta niezsynchronizowana z 12-elementową w Rust. Sprawdzić importy — jeśli nieużywany, usunąć.

### 3.10 NISKI: Brak `updated_at` w `db-types.ts` Project

- **Status 2026-03-14:** zamknięte.

- **Pliki:** `commands/types.rs:71` (ma pole) vs `lib/db-types.ts:1-11` (brak pola)
- **Naprawa:** Dodać `updated_at: string` do interface Project w db-types.ts.

### 3.11 NISKI: Rozdrobnienie plików date helpers (3 pliki po 5-14 linii)

- **Pliki:** `lib/date-utils.ts`, `lib/date-ranges.ts`, `lib/date-locale.ts`
- **Naprawa:** Scalić do jednego `lib/date-helpers.ts` (niski priorytet).

---

## 4. Tłumaczenia i Help {#4-tlumaczenia}

### 4.1 BUG: 3 brakujące klucze tłumaczeń — EN widzi polskie etykiety

- **Status 2026-03-14:** zamknięte.

- **Plik:** `dashboard/src/pages/Sessions.tsx` linie 827, 834, 840, 858, 864, 872
- **Brakujące klucze:** `sessions.menu.top_projects_az`, `sessions.menu.newest_projects_az`, `sessions.menu.remaining_active_az`
- **Efekt:** W EN menu assign pokazuje polskie fallbacki ("Top projekty (A-Z)" itp.)
- **Naprawa:** Dodać klucze do obu plików common.json:
  - PL: `"top_projects_az": "Top projekty (A-Z)"` itd.
  - EN: `"top_projects_az": "Top projects (A-Z)"` itd.

### 4.2 NISKI: Polski fallback w `t()` call

- **Status 2026-03-14:** zamknięte.

- **Plik:** `Sessions.tsx:1206` — `t('sessions.menu.split_session', 'Podziel sesję')`
- **Naprawa:** Zmienić fallback na `'Split session'`.

### 4.3 Help.tsx — KOMPLETNE pokrycie

Wszystkie 12 sekcji Help pokrywają wszystkie strony i funkcje aplikacji:
- QuickStart, Dashboard, Sessions, Projects, Estimates, Applications, Time Analysis, AI, Data, Reports, Daemon, Settings
- Podstrony (ProjectPage, ReportView, ImportPage) opisane w odpowiednich sekcjach

### 4.4 Rust i18n — kompletne

`src/i18n.rs` zawiera 10 komunikatów tray w PL i EN. Brak braków.

---

## 5. Architektura i modularyzacja {#5-architektura}

### 5.1 Duże pliki wymagające podziału

| Plik | Linie | Sugerowany podział |
|------|-------|--------------------|
| `Projects.tsx` | 1694 | Wydzielić logikę do hooks: `useProjectsList`, `useProjectFilters`, `useProjectActions` |
| `online-sync.ts` | 1633 | Podzielić na: `sync-engine.ts` (core), `sync-queue.ts` (kolejkowanie), `sync-status.ts` (status/listeners) |
| `ProjectPage.tsx` | 1565 | Wydzielić podkomponenty do folderu `components/project-page/` |
| `ProjectDayTimeline.tsx` | 1502 | Wydzielić: `timeline-calculations.ts` (merge/cluster), `TimelineRow.tsx`, `TimelineSegment.tsx` |
| `Sessions.tsx` | 1375 | Częściowo już zrefaktoryzowana (SessionRow, SessionsToolbar). Wydzielić: `useSessionsData.ts`, `useSessionsFilters.ts` |
| `daily_store.rs` | 1118 | Podzielić na: `daily_store/schema.rs`, `daily_store/read.rs`, `daily_store/write.rs`, `daily_store/types.rs` |
| `monitor.rs` | 934 | Wydzielić: `wmi_detection.rs`, `pid_cache.rs` |

### 5.2 Proponowana struktura modułów (dashboard/src/)

```
lib/
  date-helpers.ts          (scalony z date-utils + date-ranges + date-locale)
  session-helpers.ts       (pure functions z useSessionActions + istniejące session-utils)
  sync/
    sync-engine.ts
    sync-queue.ts
    sync-status.ts
    sync-types.ts          (istniejące online-sync-types.ts)
hooks/
  usePageRefreshListener.ts  (nowy — wspólny pattern z 3 stron)
  useSessionsData.ts         (wydzielony z Sessions.tsx)
  useProjectsData.ts         (wydzielony z Projects.tsx)
```

### 5.3 Tauri commands — potencjalny podział `commands/`

```
commands/
  sessions/        (istniejący — dobrze podzielony)
  assignment_model/ (istniejący — dobrze podzielony)
  daemon/           (istniejący — dobrze podzielony)
  analysis/
    mod.rs
    stacked_bar.rs   (wydzielony z analysis.rs + dashboard.rs)
    timeline.rs
  dashboard/
    mod.rs
    project_rows.rs
    color_utils.rs   (wydzielony z dashboard.rs + projects.rs)
```

---

## 6. Sugestie funkcjonalne {#6-sugestie}

### 6.1 `run_db_blocking` vs `run_db_primary_blocking` — brak dokumentacji

- **Plik:** `commands/helpers.rs:45-81`
- **Sugestia:** Dodać komentarz doc wyjaśniający semantykę (kiedy primary, kiedy pool). Rozważyć lint/clippy custom rule.

### 6.2 `onlineSyncStatusListeners` — brak ochrony przed wyciekiem

- **Plik:** `lib/online-sync.ts:88`
- **Sugestia:** Zweryfikować, że wszystkie call-site usuwają listener na unmount. Dodać weak reference pattern lub auto-cleanup.

### 6.3 Brak change-detection guard w polling loops

- **Sugestia:** W `BackgroundServices.tsx` — interwał 1s odpala joby bezwarunkowo. Dodać guard "skip if nothing changed" dla refresh/diagnostics.

---

## 7. Plan prac (kolejność implementacji) {#7-plan-prac}

### Faza 1: Krytyczne (zachowanie danych + bug-fixy)
1. **[1.1]** Naprawa `dedupe_files` + migracja DB schema `daily_files` — PRIORYTET ABSOLUTNY — ZAMKNIĘTE 2026-03-14
2. **[4.1]** Dodanie 3 brakujących kluczy tłumaczeń (5 min fix) — ZAMKNIĘTE 2026-03-14
3. **[1.2]** Fix dashboard timeline — `has_boost`/`has_manual` flags — ZAMKNIĘTE WCZEŚNIEJ

### Faza 2: Wydajność (bez zmian w API/strukturze danych)
4. **[2.1]** N+1 fix w scoring.rs (batch fetch projects) — ZAMKNIĘTE 2026-03-14
5. **[2.2]** `prepare_cached` na hot-path w scoring + context — ZAMKNIĘTE 2026-03-14
6. **[2.3]** Guard na hydration w monitor.rs — ZAMKNIĘTE 2026-03-14
7. **[2.5]** useMemo w ProjectDayTimeline.tsx

### Faza 3: Refaktoryzacja Rust (duplikacje)
8. **[3.2]** Centralizacja parserów dat w datetime.rs — ZAMKNIĘTE 2026-03-14
9. **[3.1]** Wydzielenie `build_stacked_bar_output` — ZAMKNIĘTE 2026-03-14
10. **[3.4]** Stała `ACTIVE_SESSION_FILTER` w sql_fragments.rs
11. **[3.5]** Wydzielenie `disambiguate_project_names` — ZAMKNIĘTE 2026-03-14
12. **[3.8]** Wydzielenie `name_hash` — ZAMKNIĘTE 2026-03-14

### Faza 4: Refaktoryzacja Frontend (duplikacje + modularyzacja)
13. **[3.6]** Hook `usePageRefreshListener`
14. **[3.7]** Przeniesienie pure functions z hooka do lib
15. **[2.6]** Stabilizacja deps w BackgroundServices.tsx
16. **[2.7]** useRef pattern w Sessions.tsx listeners
17. **[3.10]** Dodanie `updated_at` do db-types.ts — ZAMKNIĘTE 2026-03-14

### Faza 5: Architektura (duże pliki, modularyzacja)
18. **[5.1]** Podział `ProjectDayTimeline.tsx` (obliczenia → osobny plik)
19. **[5.1]** Podział `online-sync.ts` na moduły
20. **[5.1]** Wydzielenie hooks z `Sessions.tsx` i `Projects.tsx`
21. **[5.1]** Podział `daily_store.rs` na moduły
22. **[5.1]** Podział `monitor.rs` (wmi_detection + pid_cache)

### Faza 6: Cleanup (niski priorytet)
23. **[3.3]** Unifikacja typów daily data (Stored → bezpośrednio w dashboard)
24. **[3.9]** Sprawdzenie/usunięcie `project-colors.ts`
25. **[3.11]** Scalenie plików date helpers
26. **[4.2]** Fix polskiego fallbacku w t() call — ZAMKNIĘTE 2026-03-14
27. **[2.4]** Optymalizacja `replace_day_snapshot` (batch DELETE)
28. **[2.8]** Eager WMI init

---

## 8. Wskazówki dla modelu implementującego {#8-wskazowki}

### Ogólne zasady

1. **BEZWZGLĘDNIE zachowuj dane użytkownika** — każda zmiana DB schema wymaga migracji, nie DROP+CREATE.
2. **Testuj każdą zmianę Rust:** `cargo build` w katalogu głównym (daemon) i `cd dashboard/src-tauri && cargo build` (Tauri backend).
3. **Testuj TypeScript:** `cd dashboard && npx tsc --noEmit`.
4. **Nie zmieniaj API komend Tauri** bez aktualizacji odpowiadających wywołań w `lib/tauri.ts` i typów w `db-types.ts`.
5. **Kolejność prac:** Faza 1 → 2 → 3 → 4 → 5 → 6. Nie przeskakuj.

### Wskazówki do poszczególnych zmian

**[1.1] daily_files migration:**
- Plik migracji: `dashboard/src-tauri/src/db_migrations.rs` — dodaj nową migrację
- Schemat: zmień PRIMARY KEY z `(date, exe_name, file_name)` na `(date, exe_name, file_name, detected_path)` — wymaga `CREATE TABLE new ... INSERT INTO new SELECT ... DROP TABLE old ... ALTER TABLE new RENAME`
- `detected_path` powinno mieć DEFAULT '' dla istniejących wierszy
- Po migracji: zmień `dedupe_files_preserving_last` w `shared/daily_store.rs` by uwzględniać `detected_path` w kluczu

**[3.1] build_stacked_bar_output:**
- Sygnatura: `fn build_stacked_bar_output(bucket_project_seconds: &[HashMap<String, i64>], total_by_project: &HashMap<String, i64>, series_meta: &HashMap<String, SeriesMeta>, bucket_flags: Option<&[BucketFlags]>, bucket_comments: Option<&[Vec<String>]>, limit: usize) -> Vec<StackedBarData>`
- Umieść w `analysis.rs` lub nowym `stacked_bar.rs`
- Dashboard.rs i analysis.rs wywołują tę samą funkcję — dashboard przekazuje `None` dla flags/comments jeśli ich nie obsługuje (lub lepiej: zacznij je obsługiwać)

**[3.2] Centralizacja parserów:**
- Zachowaj `parse_datetime_fixed` i `parse_datetime_ms` w `datetime.rs`
- Dodaj `parse_datetime_local` (konwersja na `DateTime<Local>`)
- W `analysis.rs`: zastąp `parse_local_timestamp` wywołaniem `parse_datetime_local`
- W `sessions/query.rs`: zastąp `parse_rfc3339_millis` wywołaniem `parse_datetime_ms`
- Grep po `parse_local_timestamp` i `parse_rfc3339_millis` by znaleźć wszystkie call-sites

**[3.6] usePageRefreshListener:**
```typescript
// hooks/usePageRefreshListener.ts
export function usePageRefreshListener(
  shouldRefresh: (reasons: string[]) => boolean,
  onRefresh: () => void
) {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      if (shouldRefresh(e.detail?.reasons ?? [])) {
        onRefreshRef.current();
      }
    };
    window.addEventListener('APP_REFRESH_EVENT', handler);
    window.addEventListener('LOCAL_DATA_CHANGED_EVENT', handler);
    return () => {
      window.removeEventListener('APP_REFRESH_EVENT', handler);
      window.removeEventListener('LOCAL_DATA_CHANGED_EVENT', handler);
    };
  }, [shouldRefresh]);
}
```

**[4.1] Brakujące klucze tłumaczeń:**
- `dashboard/src/locales/pl/common.json` → sekcja `sessions.menu` → dodaj:
  ```json
  "top_projects_az": "Top projekty (A-Z)",
  "newest_projects_az": "Najnowsze projekty (A-Z)",
  "remaining_active_az": "Pozostałe aktywne (A-Z)"
  ```
- `dashboard/src/locales/en/common.json` → sekcja `sessions.menu` → dodaj:
  ```json
  "top_projects_az": "Top projects (A-Z)",
  "newest_projects_az": "Newest projects (A-Z)",
  "remaining_active_az": "Remaining active (A-Z)"
  ```

### Jak sporządzić plan_implementacji.md

Dla każdej pozycji z sekcji 7 stwórz wpis zawierający:
1. **ID i opis** — np. "[1.1] Naprawa deduplikacji plików + migracja DB"
2. **Pliki do zmiany** — pełne ścieżki
3. **Dokładne linie kodu** — co usunąć / co dodać (diff-like)
4. **Test manualny** — jak zweryfikować, że zmiana działa
5. **Ryzyko regresji** — co może się zepsuć
6. **Zależności** — które inne pozycje muszą być zrobione wcześniej

Kolejność w plan_implementacji.md powinna odpowiadać kolejności z sekcji 7 tego dokumentu.

---

*Dokument wygenerowany automatycznie. Przed implementacją zweryfikuj aktualność wskazanych linii kodu.*
