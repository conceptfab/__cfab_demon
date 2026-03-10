# TIMEFLOW — Raport analizy kodu

**Data:** 2026-03-10
**Zakres:** dashboard/src/ (React + Tauri)

**Statusy realizacji:**
- `[ZROBIONE]` — wdrożone
- `[CZĘŚCIOWO]` — wdrożone inaczej albo częściowo
- `[ZWERYFIKOWANE - NIEAKTUALNE]` — raport wskazał problem, ale po sprawdzeniu założenie okazało się nieaktualne
- `[DO ZROBIENIA]` — nadal otwarte

---

## 1. WYDAJNOŚĆ I OPTYMALIZACJE

### 1.1 KRYTYCZNE (pewność 90–95%)

#### [C1] `Sessions.tsx:253` — `readMinSessionDuration()` w render-body `[ZWERYFIKOWANE - NIEAKTUALNE]`
`readMinSessionDuration()` wywołuje `loadSessionSettings()`, która parsuje JSON z `localStorage` przy **każdym** re-renderze komponentu Sessions. Komponent re-renderuje się przy każdym wyszukiwaniu, tick-u timera, zmianie `aiBreakdowns` itp.

**Status (2026-03-10):** nie wdrażano proponowanego `useMemo`, bo `loadSessionSettings()` korzysta już z cache in-memory w `dashboard/src/lib/user-settings.ts`, więc teza o parsowaniu `localStorage` przy każdym renderze jest nieaktualna.

**Naprawa:**
```ts
const minDuration = useMemo(() => readMinSessionDuration(), [refreshKey]);
```

---

#### [C2] `Projects.tsx:259 + 341` — `loadFreezeSettings()` podwójnie, bez cache `[ZWERYFIKOWANE - NIEAKTUALNE]`
Linia 259: `loadFreezeSettings()` wołane w render-body (parsuje localStorage przy każdym re-renderze).
Linia 341: `loadFreezeSettings()` wołane **ponownie** w `useEffect` — podwójny odczyt bez powodu.

**Status (2026-03-10):** nie wdrażano proponowanego `useMemo`, bo `loadFreezeSettings()` także korzysta z cache in-memory; raport poprawnie wskazał duplikację wywołań, ale nieaktualnie opisał ich koszt.

**Naprawa:** jedno `useMemo(() => loadFreezeSettings(), [])` przypisane do zmiennej, używane w obu miejscach.

---

#### [C3] `Projects.tsx:256–258` — `projectExtraInfoCache` w `useState` zamiast `useRef` `[ZROBIONE]`
Cache dla `ProjectExtraInfo` jest w `useState`, co oznacza że każde wpisanie nowego projektu do cache triggeruje **pełny re-render** komponentu Projects (~1934 linii, wiele `useMemo`). Cache powinien być w `useRef`, bo nie wpływa na render.

**Status (2026-03-10):** zrobione. Cache przeniesiony do `useRef`, a invalidacja działa przez osobną wersję cache.

**Naprawa:**
```ts
const projectExtraInfoCacheRef = useRef<Record<number, ProjectExtraInfo>>({});
```

---

#### [C4] `Sessions.tsx:942–967` — kaskada re-renderów z background fetch breakdownów `[DO ZROBIENIA]`
useEffect z deps `[sessions, aiBreakdowns, ...]` — każdy fetch breakdownu mutuje `aiBreakdowns`, co trigguje ponowne uruchomienie efektu. Dla 100 sesji: **kaskada 100 re-renderów**.

Dodatkowo bliźniaczy efekt na linii 982 (`viewMode === 'ai_detailed'`) robi to samo — **potencjalne podwójne fetch-y**.

**Naprawa:** śledzić listę ID sesji przez `useRef`, uruchamiać bulk-fetch tylko gdy zmienia się lista sesji, nie stan breakdownów.

---

#### [C5] `Sessions.tsx:523–546` — 15s polling bez change detection `[DO ZROBIENIA]`
Auto-refresh co 15 s bezwarunkowo nadpisuje cały `sessions` state nową referencją tablicy → pełne przeliczenie `flattenedItems` → re-render Virtuoso. BackgroundServices już ma `refreshKey` mechanizm (co 5 s) — ten polling może być redundantny.

**Naprawa:** porównywać dane przed `setSessions` (np. hash/length) lub usunąć na rzecz `refreshKey`.

---

### 1.2 WAŻNE (pewność 80–88%)

#### [I1] `BackgroundServices.tsx:111,216` — `loadSessionSettings()`/`loadSplitSettings()` w job-loop bez cache `[ZWERYFIKOWANE - NIEAKTUALNE]`
Funkcje parsujące localStorage wołane w cyklach co 5–60 s. Dla `syncSettingsRef` zrobiono już ref-cache (linia 286) — ten sam wzorzec powinien być dla session/split settings.

**Status (2026-03-10):** po weryfikacji `loadSessionSettings()`/`loadSplitSettings()` korzystają już z cache managera w `user-settings.ts`, więc opis „bez cache” jest nieaktualny.

---

#### [I2] `Sessions.tsx:1037` — `loadFreezeSettings()` wewnątrz `useMemo` `[ZWERYFIKOWANE - NIEAKTUALNE]`
`loadFreezeSettings()` czyta localStorage wewnątrz `useMemo` przy każdej zmianie `projects`. Wynik nie zmienia się jeśli użytkownik nie zmienia ustawień.

**Status (2026-03-10):** odczyt nie parsuje już `localStorage` za każdym razem, bo bazuje na cache in-memory.

---

#### [I3] `Projects.tsx:388–393` — `hotProjectIds` jako Array zamiast Set `[ZROBIONE]`
`.includes()` na tablicy = O(n) przy każdym renderze projektu. Zamiana na `Set` jest trywialna:
```ts
const hotProjectIds = useMemo(() =>
  new Set([...projects].sort(...).slice(0, 5).map(p => p.id)),
  [projects]
);
```

**Status (2026-03-10):** zrobione. `hotProjectIds` działa jako `Set`, a odczyt w renderze używa `.has()`.

---

#### [I4] `AI.tsx:261–278` — missed concurrency `[ZROBIONE]`
`getAssignmentModelStatus()` i `getFeedbackWeight()` wołane sekwencyjnie, mogą być równoległe:
```ts
const [nextStatus, fw] = await Promise.all([
  getAssignmentModelStatus(),
  getFeedbackWeight(),
]);
```

**Status (2026-03-10):** zrobione.

---

#### [I5] `Dashboard.tsx:399` — `loadWorkingHoursSettings()` przy każdym refreshKey `[CZĘŚCIOWO]`
`workingHours` zmienia się tylko gdy użytkownik zmienia ustawienia, nie przy każdym `refreshKey`. To localStorage read + setState przy każdym odświeżeniu dashboardu (co 60 s + mutacje).

**Status (2026-03-10):** wdrożone inaczej niż w raporcie. Nie ograniczano do `mount only`, ale dodano change detection, więc `setWorkingHours` wykonuje się tylko przy realnej zmianie ustawień.

---

#### [I6] `ProjectPage.tsx:306` — `getProjects()` fetchuje całą listę dla jednego projektu `[DO ZROBIENIA]`
`getProjects()` ładuje wszystkie projekty, a następnie `.find(x => x.id === projectPageId)`. Jeśli projekty są dostępne w `useDataStore`, można je pobrać stamtąd.

---

#### [I7] `Sessions.tsx:247` — `document.querySelector('main')` w `useMemo([], [])` `[CZĘŚCIOWO]`
`useMemo` z `[]` jest wyliczane w trakcie renderowania — `main` element może jeszcze nie istnieć. Lepiej użyć `useRef` + `useEffect`.

**Status (2026-03-10):** uproszczono do leniwej inicjalizacji `useState`, ale nie wdrożono dokładnie wariantu `useRef + useEffect`.

---

## 2. BRAKUJĄCE TŁUMACZENIA

### 2.1 Hardcoded stringi w Help.tsx (bez t18n) `[ZROBIONE]`

| Linia | Tekst | Problem |
|-------|-------|---------|
| 362 | `Score & Base Log Prob:` | Hardcoded EN, brak tłumaczenia |
| 368 | `Matched Tokens & Context Matches:` | Hardcoded EN, brak tłumaczenia |
| 602 | `2. Suggest Min Confidence: 0.4 - 0.5 (Zmniejsz obecne 0.6)` | Hardcoded PL+EN mix, brak t18n |
| 629 | `Auto-safe Min Confidence: 0.85 - 0.95` | Hardcoded EN, brak tłumaczenia |

### 2.2 Hardcoded error messages (showError) `[ZROBIONE]`

| Plik:linia | Tekst |
|------------|-------|
| `ProjectDayTimeline.tsx:486` | `Failed to assign session(s): ...` |
| `ProjectDayTimeline.tsx:534` | `Failed to save comment required for boost: ...` |
| `ProjectDayTimeline.tsx:555` | `Failed to update session rate multiplier: ...` |
| `Projects.tsx:541` | `Failed to delete project "...": ...` |
| `Projects.tsx:569` | `Failed to compact project data: ...` |

Te komunikaty błędów są widoczne dla użytkownika (toast), ale nie są przetłumaczone.

### 2.3 Niezgodność kluczy EN/PL w common.json `[ZROBIONE]`

**Status (2026-03-10):** dodano brakujący klucz `ai_page.text.train_after_a_larger_series_of_manual_corrections` do PL, przepięto użycie kodu na wersję z `corrections`, a brakujące klucze `help_page.*` dopisano do EN. Stary klucz z literówką pozostawiono w PL jako alias kompatybilności.

**Brakuje w PL (jest w EN):**
- `ai_page.text.train_after_a_larger_series_of_manual_corrections`

**Brakuje w EN (jest w PL):**
- `ai_page.text.train_after_a_larger_series_of_manual_correction` (literówka — brak "s" na końcu)
- `help_page.training_blacklists_exclude_selected_applications_and_fo`
- `help_page.ai_progress_quality_metrics_panel_shows_feedback_trends`
- `help_page.training_horizon_set_how_many_days_of_history_e_g_30_730`
- `help_page.auto_safe_limit_control_the_maximum_number_of_sessions_p`
- `help_page.session_indicators_configure_indicators_displayed_on_ses`
- `help_page.k_100_privacy_the_ml_engine_runs_locally_in_rust_doesn_t`
- `help_page.model_status_card_diagnostic_panel_with_6_tiles_current`

**Podsumowanie:** EN ma 1296 kluczy, PL ma 1303 kluczy — 8 kluczy istnieje tylko w PL.

---

## 3. POKRYCIE HELP

### 3.1 Sekcje obecne w Help.tsx
- Quick Start ✅
- Dashboard ✅
- Sessions ✅
- Projects ✅
- Estimates ✅
- Applications ✅
- Time Analysis ✅
- AI Model ✅
- Data ✅
- Reports ✅
- Daemon ✅
- Settings ✅

### 3.2 Strony/funkcje BEZ opisu w Help `[DO ZROBIENIA]`

| Strona / funkcja | Uwagi |
|-------------------|-------|
| **Import** (`import` / ImportPage.tsx) | Strona importu plików jest osobną stroną w routerze (`case 'import'`), ale nie ma dedykowanej zakładki w Help. Import jest częściowo opisany w sekcji "Data", ale ImportPage to oddzielna strona z drag & drop. |
| **Project Card** (`project-card` / ProjectPage.tsx) | Widok szczegółowy projektu — brak dedykowanej zakładki w Help. Częściowo opisany w "Projects" (punkt o ProjectPage), ale brak szczegółowego opisu timeline projektu, karty komentarzy, sesji manualnych, kompaktowania danych, generowania raportów z poziomu projektu. |
| **Report View** (`report-view` / ReportView.tsx) | Podgląd raportu pełnoekranowy — wspomniany w sekcji Reports, ale bez szczegółów (drukowanie, eksport PDF, skalowanie). |

### 3.3 Funkcje nieudokumentowane lub słabo opisane `[DO ZROBIENIA]`

| Funkcja | Plik | Opis w Help |
|---------|------|-------------|
| Multi-split sesji (podział na wiele części) | `MultiSplitSessionModal.tsx` | Brak — Help opisuje split, ale nie multi-split |
| BugHunter (raportowanie błędów) | `BugHunter.tsx` | Wspomniany jednym zdaniem w Settings |
| Online Sync szczegóły (conflict resolution, ACK) | `OnlineSyncCard.tsx` | Opisany, ale bez szczegółów conflict resolution |
| Session score badges (AI quality indicators) | `SessionScoreBadge.tsx` | Częściowo opisany w AI |
| DateRangeToolbar (nawigacja zakresami dat) | `DateRangeToolbar.tsx` | Nie opisany osobno |

---

## 4. JAKOŚĆ KODU — PROBLEMY

### 4.1 Nadmiarowy kod / duplikacja

**Status (2026-03-10):** po weryfikacji pierwsze dwa punkty są częściowo nieaktualne, bo `loadFreezeSettings()` i `loadSessionSettings()` korzystają z cache in-memory w `user-settings.ts`. Otwarty pozostaje głównie temat duplikacji efektów fetch-breakdownów.

| Problem | Lokalizacja |
|---------|-------------|
| `loadFreezeSettings()` wołane w 4+ miejscach bez cachowania | Sessions.tsx:1037, Projects.tsx:259, Projects.tsx:341, BackgroundServices.tsx |
| `loadSessionSettings()` wołane w 3+ miejscach bez cachowania | Sessions.tsx:253, BackgroundServices.tsx:111, BackgroundServices.tsx:216 |
| Efekty fetch-breakdownów (linie 942 i 982 w Sessions.tsx) robią niemal to samo z minimalną różnicą warunku | Sessions.tsx:942, Sessions.tsx:982 |

### 4.2 Potencjalne problemy logiczne

**Status (2026-03-10):** drugi punkt (`today` po północy) został naprawiony. Pierwszy punkt (`document.querySelector('main')`) jest rozwiązany częściowo.

| Problem | Lokalizacja |
|---------|-------------|
| `useMemo([], [])` dla DOM query — element `main` może nie istnieć przy pierwszym renderze | Sessions.tsx:247 |
| `today` w `useMemo(() => format(new Date(), 'yyyy-MM-dd'), [])` — nie aktualizuje się po północy jeśli app jest otwarta | Sessions.tsx:254 |

---

## 5. PODSUMOWANIE PRIORYTETÓW

### Wysoki priorytet (szybki zysk, niskie ryzyko):
1. **C1–C2**: Cache `loadFreezeSettings` / `readMinSessionDuration` w `useMemo` — eliminuje parsowanie localStorage przy każdym re-renderze
   Status: `[ZWERYFIKOWANE - NIEAKTUALNE]`
2. **C3**: `projectExtraInfoCache` → `useRef` — eliminuje zbędne re-rendery Projects
   Status: `[ZROBIONE]`
3. Hardcoded stringi w Help.tsx (linie 362, 368, 602, 629) — przetłumaczyć
   Status: `[ZROBIONE]`

### Średni priorytet:
4. **C4**: Refactor kaskady breakdownów w Sessions — oddzielić deps
   Status: `[DO ZROBIENIA]`
5. **C5**: Usunąć lub ulepszyć 15s polling (redundantny z refreshKey)
   Status: `[DO ZROBIENIA]`
6. Przetłumaczyć error messages w showError (5 miejsc)
   Status: `[ZROBIONE]`
7. Zsynchronizować klucze EN/PL (1 brakujący + 8 nadmiarowych)
   Status: `[ZROBIONE]`

### Niski priorytet:
8. **I3**: `hotProjectIds` Array → Set
   Status: `[ZROBIONE]`
9. **I4**: Promise.all w fetchStatus (AI.tsx)
   Status: `[ZROBIONE]`
10. **I5**: loadWorkingHoursSettings only on mount
    Status: `[CZĘŚCIOWO]`
11. Uzupełnić Help o Import, multi-split, ProjectPage details
    Status: `[DO ZROBIENIA]`
