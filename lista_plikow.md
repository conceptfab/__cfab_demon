# TIMEFLOW — Lista plików do uproszczenia/refaktoryzacji

## Priorytet: WYSOKI

### 1. `dashboard/src/pages/Projects.tsx` (2115 linii)
- **Rozbić na komponenty:** ProjectCreationDialog, ProjectFolderSection, ProjectDetectionSection, ApplicationAssignmentPanel
- **Duplikacja:** `renderDuration()` duplikuje `formatDuration()` z `lib/utils.ts` — zastąpić
- **Storage:** 3 klucze localStorage z ręcznym get/set — użyć `createSettingsManager()` z `user-settings.ts`
- **Wydajność:** 4 osobne `useEffect` z tym samym dependency `[refreshKey]` — połączyć lub zbatchować
- **Wydajność:** Filtrowanie `sortedProjects` O(N*M) na każdy keystroke w wyszukiwarce — dodać debounce
- **Stringly-typed:** Klucze storage jako surowe stringi bez centralizacji

### 2. `dashboard/src/pages/Sessions.tsx` (1938 linii)
- **Rozbić na komponenty:** SessionsListView, SessionsFilterSection, ScoreBreakdownModal, MultiSplitSessionHandler
- **Redundantny state:** 7+ booleanowych flag loading/activity — rozważyć state machine
- **Memory leak:** `aiBreakdowns` (Map) rośnie bez limitu — dodać LRU cache lub max-size
- **No-op updates:** Auto-refresh co 15s bez sprawdzania czy dane się zmieniły — dodać shallow equality check
- **Reuse:** `isSplittableFromBreakdown()`, `buildAnalysisFromBreakdown()` — wyekstrahować do `lib/session-analysis.ts`
- **Polling:** Interwał działa nawet gdy tab jest w tle (timer nie jest czyszczony)

### 3. `dashboard/src/lib/online-sync.ts` (1721 linii)
- **Rozbić na moduły:** `online-sync-types.ts`, `online-sync-state.ts`, `online-sync-http.ts`, `online-sync-core.ts`
- **Leaky abstraction:** Wewnętrzne klucze storage i funkcje normalizacji są publiczne
- **Memory leak:** Globalne `onlineSyncStatusListeners` i cache nigdy nie są czyszczone
- **Normalizacja:** Funkcje `normalizeApiToken()`, `normalizeServerUrl()` — przenieść do wspólnego `lib/normalize.ts`

### 4. `dashboard/src/pages/ProjectPage.tsx` (1596 linii)
- **Wydajność:** `Promise.all()` ładuje 6 zasobów na każdą zmianę `refreshKey` — nawet gdy tylko 1 jest dirty
- **Wydajność:** `recentComments` robi 4 passy (map+filter+sort+slice) na każdym renderze — dodać `useMemo`
- **Leaky abstraction:** `getContextMenuStyle()` z hardcoded viewport calculations — wyekstrahować do utility

### 5. `dashboard/src/pages/AI.tsx` (1112 linii)
- **Rozbić na komponenty:** AiModelStatusCard, AiMetricsCharts, AiSettingsForm
- **Duplikacja:** `formatDateTime()`, `clampNumber()`, `parseMultilineList()`, `formatPercent()`, `formatDateLabel()` — przenieść do `lib/utils.ts`
- **Storage:** `loadAutoLimit()`/`saveAutoLimit()` — użyć `createSettingsManager()`
- **No-op updates:** Metrics refresh co 30s bez change detection

---

## Priorytet: ŚREDNI

### 6. `dashboard/src/pages/Settings.tsx` (756 linii)
- **Duplikacja:** `splitTime()` duplikuje logikę parsowania czasu — przenieść do `lib/form-validation.ts`
- **Error handling:** Łapie błędy inline bez spójnego formatu (vs `getErrorMessage()` w Projects.tsx)

### 7. `dashboard/src/pages/Applications.tsx` (641 linii)
- **Promise.allSettled:** Ręczne sprawdzanie statusu per-result — użyć wspólnego helpera

### 8. `dashboard/src/pages/Reports.tsx` (559 linii)
- **Brak loading state:** Preview raportu nie pokazuje loadera podczas ładowania sekcji
- **Brak empty state:** Lista szablonów bez komunikatu gdy pusta

### 9. `dashboard/src/pages/ReportView.tsx` (555 linii)
- **Async pattern:** Ręczny `cancelled` flag w useEffect — kandydat na `useCancellableAsync()`

### 10. `dashboard/src/pages/Dashboard.tsx` (553 linii)
- **No-op updates:** `refreshKey` inkrementowany zbyt często (throttle 250ms) powoduje ponowne ładowanie 6+ endpointów
- **JSX nesting:** `AutoImportBanner()` i `DiscoveredProjectsBanner()` z nadmiarowym zagnieżdżeniem warunkowym

### 11. `dashboard/src/pages/Estimates.tsx` (517 linii)
- **Duplikacja:** `parseRateInput()`/`formatRateInput()` — przenieść do `lib/form-validation.ts`
- **Brak empty state:** Brak komunikatu gdy żaden projekt nie ma estymacji
- **Brak loading state:** Brak spinnera per-row przy zapisie

### 12. `dashboard/src/components/sessions/SessionRow.tsx`
- **JSX nesting:** Głęboko zagnieżdżone warunkowe badge — wyekstrahować do osobnego komponentu
- **Duplikacja:** `formatTime()`, `formatDate()` — przenieść do `lib/utils.ts`

### 13. `dashboard/src/components/sessions/SessionsToolbar.tsx`
- **Parameter sprawl:** 16 propsów, w tym wiele tłumaczeniowych — zbundlować w grupy

### 14. `dashboard/src/hooks/useSessionActions.ts`
- **Wydajność:** Aktualizacja wielu sesji robi N osobnych wywołań Tauri zamiast batch — rozważyć batch endpoint

### 15. `dashboard/src/store/data-store.ts`
- **No-op updates:** `triggerRefresh()` zawsze inkrementuje `refreshKey` nawet gdy wielokrotnie wywołany z tego samego powodu

---

## Priorytet: NISKI

### 16. `dashboard/src/pages/DaemonControl.tsx` (356 linii)
- Przejrzeć pod kątem wspólnych wzorców async fetch

### 17. `dashboard/src/components/dashboard/TimelineChart.tsx`
- **Brak empty/loading/error state:** Props nie zawierają tych stanów
- **Parameter sprawl:** 10 parametrów z wieloma opcjonalnymi callbackami

### 18. `dashboard/src/lib/user-settings.ts` (364 linie)
- **Normalizacja:** `normalizeHexColor()`, `isValidTime()` — kandydaci do przeniesienia do `lib/normalize.ts`

### 19. `src/monitor.rs` (Rust daemon)
- **Wydajność:** `get_process_command_line_wmi()` robi osobne zapytanie WMI per-proces — zbatchować
- **Wydajność:** `process_still_alive()` waliduje cache co 60s nawet dla aktywnych procesów (akceptowalne, ale kumulatywne)

---

## Sugerowane nowe pliki/hooki (refaktor wspólny)

| Plik | Cel | Eliminuje duplikację w |
|------|-----|------------------------|
| `lib/async-utils.ts` | `useCancellableAsync()`, `useConcurrentLoads()` | Projects, Sessions, ProjectPage, Dashboard, Estimates, ReportView |
| `lib/normalize.ts` | `clamp()`, `normalizeString()`, walidatory | AI, Projects, online-sync, user-settings, Estimates |
| `lib/form-validation.ts` | `parseRateInput()`, `splitTime()`, `isValidHex()` | Estimates, Settings, user-settings |
| `lib/session-analysis.ts` | `isSplittableFromBreakdown()`, `buildAnalysisFromBreakdown()` | Sessions, ProjectPage |
| `lib/date-format.ts` | `formatSessionDate()`, `formatSessionTime()`, `formatDateLabel()` | SessionRow, AI, Estimates |
| Hook: `useConfirmedAction()` | Confirmation + action + error toast + loading | Projects, ProjectPage, Sessions, Settings |
| Hook: `useCache(maxSize)` | LRU cache z TTL | Projects (extraInfoCache), Sessions (breakdownCache) |
| Komponenty: `<LoadingState>`, `<EmptyState>`, `<ErrorState>` | Spójne stany UI | Wszystkie strony |
