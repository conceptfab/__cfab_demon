# TIMEFLOW — Audyt kodu i plan refaktoryzacji

> Wygenerowano: 2026-03-15
> Projekt: ~53 000 linii kodu (Rust daemon + Tauri backend + React frontend)
> Priorytet: zachowanie dotychczasowych danych

---

## Spis treści

1. [Błędy krytyczne](#1-błędy-krytyczne)
2. [Błędy logiczne](#2-błędy-logiczne)
3. [Duplikacja kodu](#3-duplikacja-kodu)
4. [Wydajność i optymalizacje](#4-wydajność-i-optymalizacje)
5. [Tłumaczenia i i18n](#5-tłumaczenia-i-i18n)
6. [Dokumentacja pomocy (Help.tsx)](#6-dokumentacja-pomocy-helptsx)
7. [Architektura i modularność](#7-architektura-i-modularność)
8. [Sugestie funkcjonalne](#8-sugestie-funkcjonalne)
9. [Wskazówki dla kolejnego modelu](#9-wskazówki-dla-kolejnego-modelu)

---

## 1. Błędy krytyczne

### 1.1 `rebuild_sessions` może scalać sesje po splicie → utrata danych

**Plik:** `dashboard/src-tauri/src/commands/sessions/rebuild.rs:24-60`

`ACTIVE_SESSION_FILTER` wyklucza `is_hidden = 1`, ale NIE wyklucza sesji z `split_source_session_id`. Rebuild może scalić dwie połówki splitu z powrotem, jeśli gap między nimi mieści się w `gap_fill_minutes`.

**Naprawa:** Dodać warunek `AND split_source_session_id IS NULL` do filtra rebuild lub oznaczyć sesje ze splitu jako niemerge'owalne.

### 1.2 Zduplikowany klucz `sessions.prompts` w JSON — utrata tłumaczeń

**Pliki:** `dashboard/src/locales/{en,pl}/common.json` (~linia 328 i 357)

Klucz `prompts` zdefiniowany dwukrotnie w obiekcie `sessions`. JSON bierze ostatnią wartość — klucze `bulk_comment_title` i `bulk_comment_description` z pierwszego bloku są niedostępne w runtime.

**Naprawa:** Zmergować oba bloki `prompts` w jeden lub przenieść pierwszy do `sessions.bulk_prompts`.

### 1.3 `train_assignment_model` z `force=true` przy 0 danych resetuje model AI

**Plik:** `dashboard/src-tauri/src/commands/assignment_model/mod.rs:556-578`

Gdy użytkownik wymusza retrain przy 0 feedbacku, model zapisuje puste tabele → utrata całej wiedzy.

**Naprawa:** Dodać guard: jeśli feedback_count == 0, zwrócić błąd lub status "nothing to train".

---

## 2. Błędy logiczne

### 2.1 Race condition w `useSessionsData` — podwójne ładowanie przy starcie

**Plik:** `dashboard/src/hooks/useSessionsData.ts:54-89`

Dwa effecty mogą uruchomić `loadFirstSessionsPage` jednocześnie (reloadVersion + visibility/focus). Brak deduplikacji między nimi.

**Naprawa:** Dodać flagę `isLoadingRef` (useRef) i sprawdzać ją przed rozpoczęciem fetcha.

### 2.2 `feedback_since_train` rośnie N razy przy N-way splicie

**Pliki:**
- `dashboard/src-tauri/src/commands/sessions/split.rs:156-165` — dodaje `segments.len()` do licznika
- `dashboard/src-tauri/src/commands/sessions/mutations.rs:107-128` — dodaje zawsze `1`

Niespójna semantyka: 5-way split dodaje 5, ale 5 pojedynczych assignów też dodaje 5. Split powinien liczyć jako jedna operacja feedbacku.

**Naprawa:** W `split.rs` zmienić `feedback_count = segments.len()` na `feedback_count = 1`.

### 2.3 `inferPreset` nie rozpoznaje przesuniętego miesiąca

**Plik:** `dashboard/src/store/data-store.ts:58-74`

Po powrocie do bieżącego miesiąca strzałkami, `inferPreset` porównuje z `now` zamiast z zakresem. Może zwrócić `'custom'` zamiast `'month'`.

**Naprawa:** `inferPreset` powinien sprawdzać `isSameMonth(start, end)` zamiast `isSameMonth(start, now)`.

### 2.4 `suggest_project_for_session_raw` — nazwa myląca

**Plik:** `dashboard/src-tauri/src/commands/assignment_model/scoring.rs:379-430`

Funkcja `raw` nie stosuje thresholdów i może być przypadkowo użyta tam, gdzie threshold jest wymagany.

**Naprawa:** Zmienić nazwę na `suggest_project_for_session_unfiltered` i dodać doc-comment wyjaśniający intencje.

---

## 3. Duplikacja kodu

### 3.1 `session-analysis.ts` vs `split.rs` — zduplikowana logika analizy splitu

**Pliki:**
- `dashboard/src/lib/session-analysis.ts:16-63` (TypeScript)
- `dashboard/src-tauri/src/commands/sessions/split.rs:509-531` (Rust)

Identyczna logika `buildAnalysisFromBreakdown` — filtrowanie kandydatów, `ratio_to_leader`, `is_splittable`.

**Naprawa:** Usunąć logikę z TS. Rust zwraca `is_splittable` w odpowiedzi — frontend powinien tylko konsumować wynik.

### 3.2 `withTimeout` w złym pliku

**Plik:** `dashboard/src/lib/session-analysis.ts:65-81`

Funkcja `withTimeout<T>` nie ma związku z analizą sesji. Powinna być w `async-utils.ts`.

**Naprawa:** Przenieść do `dashboard/src/lib/async-utils.ts`.

### 3.3 `get_dashboard_stats` vs `get_dashboard_data` — podwójne obliczanie

**Plik:** `dashboard/src-tauri/src/commands/dashboard.rs:168, 211`

Obie funkcje wywołują `compute_project_activity_unique`. Sprawdzić czy `get_dashboard_stats` jest faktycznie używany w UI — jeśli nie, usunąć.

---

## 4. Wydajność i optymalizacje

### 4.1 `rebuild.rs` — DELETE i UPDATE w pętli (N+1)

**Plik:** `dashboard/src-tauri/src/commands/sessions/rebuild.rs:119-141`

- DELETE per-id zamiast `DELETE FROM sessions WHERE id IN (?,...)`
- UPDATE `session_manual_overrides` per-pair zamiast batch

**Naprawa:** Zbatchować operacje — zgromadzić ID do usunięcia/aktualizacji, wykonać 1-2 zapytania zamiast N.

### 4.2 Daemon — nowe połączenie SQLite przy każdym zapisie

**Plik:** `src/storage.rs:save_daily`

`open_daily_store()` otwiera nowe `rusqlite::Connection` co 5 minut.

**Naprawa:** Trzymać `Connection` jako pole struktury tracker loop. Odświeżać tylko przy błędzie.

### 4.3 WMI blokuje wątek monitorujący

**Plik:** `src/monitor/wmi_detection.rs`

WMI query (40-200 ms) blokuje polling. Batching (16 PIDów) i jednorazowe wywołanie per-PID łagodzą problem, ale przy wielu nowych procesach jednocześnie opóźnienie rośnie.

**Naprawa (niska priorytet):** Rozważyć wykonywanie WMI queries w osobnym wątku z `mpsc::channel` do zwracania wyników.

### 4.4 `Sessions.tsx:itemContent` — brak `React.memo` na wierszu

**Plik:** `dashboard/src/components/sessions/SessionRow.tsx` + `dashboard/src/pages/Sessions.tsx`

Inline render w Virtuoso powoduje re-render wszystkich widocznych wierszy przy każdej zmianie stanu.

**Naprawa:** Owinąć `SessionRow` w `React.memo()`.

### 4.5 `Sessions.tsx` — ~990 linii, trudny do utrzymania

**Plik:** `dashboard/src/pages/Sessions.tsx`

~15 useCallback, ~8 useMemo, ~10 useState w jednym komponencie.

**Naprawa:** Wydzielić:
- `useSessionContextMenuActions` hook (logika context menu)
- `useSessionBulkActions` hook (operacje batch)
- `SessionsHeader` komponent (toolbar + filtry)

### 4.6 Tracker sleep loop — N mikro-budzień zamiast jednego

**Plik:** `src/tracker.rs:531-546`

Pętla 1-sekundowych sleep zamiast jednego `thread::sleep(remain)` z osobnym wątkiem do stop-signalu.

**Naprawa (niska priorytet):** Użyć `Condvar::wait_timeout` na stop mutex — budzi się natychmiast przy stop lub po timeout.

---

## 5. Tłumaczenia i i18n

### 5.1 Niespójność "ręczne" vs "manualne" w PL

Dotyczy ~10 kluczy. Mieszane użycie w `common.json` PL:
- `layout.tooltips.manual_sessions` → "Sesje manualne"
- `components.manual_session_dialog.title_add` → "Dodaj sesję ręczną"
- `reports_page.sections.manual_sessions` → "Sesje manualne"

**Naprawa:** Ujednolicić do "ręczne" (naturalniejsze po polsku) we wszystkich kluczach.

### 5.2 `project_day_timeline.text.s` PL = "e" — prawdopodobna literówka

**Plik:** `dashboard/src/locales/pl/common.json:1718`

EN: `"s": "s"`, PL: `"s": "e"`. Wartość "e" nie ma sensu.

**Naprawa:** Zmienić na "s" (skrót od "sesje") lub odpowiedni skrót PL.

### 5.3 Niespójność wielkości liter "Auto-safe" vs "Auto-Safe"

**Pliki:** `common.json` EN — `layout.status.auto_safe` vs `help_page.auto_safe`

**Naprawa:** Ujednolicić do "Auto-safe" (lowercase 's').

### 5.4 Martwy klucz `sync_on_startup_perform_...`

**Pliki:** `dashboard/src/locales/{en,pl}/common.json:1598`

Nieużywany — zastąpiony przez `sync_on_startup_runs_only_when_online_sync_is_en`.

**Naprawa:** Usunąć z obu plików.

---

## 6. Dokumentacja pomocy (Help.tsx)

### 6.1 Brak sekcji dla ReportView

ReportView to osobna pełnoekranowa strona z toolbarem (Print/PDF), ale w Help.tsx jest tylko wspomniana jako cecha sekcji Reports.

**Naprawa:** Dodać `HelpDetailsBlock` w `TabsContent value="reports"` z: co robi, kiedy użyć, ograniczenia.

### 6.2 Brak opisu "Font selection" w sekcji Reports

Klucz `help_page.font_selection_and_scaling_change_font_family_sans_serif` istnieje w JSON (linia 1565) ale nie jest podpięty do `features[]` w Help.tsx.

**Naprawa:** Dodać `t18n('help_page.font_selection_and_scaling_...')` do tablicy features sekcji Reports.

### 6.3 Pokrycie stron — status

| Strona | Status w Help.tsx |
|---|---|
| Dashboard | ✅ Pełne |
| Sessions | ✅ Pełne |
| Projects | ✅ Pełne + HelpDetailsBlock |
| Estimates | ✅ Pełne |
| Applications | ✅ Pełne |
| TimeAnalysis | ✅ Pełne |
| AI | ✅ Pełne |
| Data | ✅ Pełne + HelpDetailsBlock |
| Reports | ⚠️ Brak ReportView + font selection |
| DaemonControl | ✅ Pełne |
| Settings | ✅ Pełne |
| QuickStart | ✅ Pełne |
| ProjectPage | ✅ Wbudowane w Projects |
| ImportPage | ✅ Wbudowane w Data |

---

## 7. Architektura i modularność

### 7.1 Mocne strony (nie ruszać)

- **Daemon:** 1 wątek monitorujący, zero współdzielonego mutowalnego stanu — eliminuje race conditions
- **PID cache** z liveness check przez `creation_time` — niezawodna detekcja reużycia PID
- **Job pool pattern** w `BackgroundServices.tsx` — jeden centralny interval zamiast wielu timerów
- **Lazy loading** wszystkich stron przez `React.lazy()`
- **Connection pool** z WAL + busy_timeout w Tauri
- **Assignment model** — 4-warstwowy scoring z evidence_factor
- **Throttle + deduplicacja** refresh w data-store

### 7.2 Obszary do poprawy

| Obszar | Problem | Sugestia |
|---|---|---|
| `settings-store.ts` | Przechowuje tylko 2 z N ustawień; reszta w localStorage bez reaktywności | Rozszerzyć store o kluczowe ustawienia (workingHours, language) |
| `background-status-store.ts` | 3 osobne flagi `InFlight` zamiast mapy | Zamienić na `Map<string, boolean>` lub zostawić (prosty wzorzec) |
| `Sessions.tsx` | 990 linii, trudny do utrzymania | Wydzielić hooki i subkomponenty (patrz 4.5) |
| `src/process_utils.rs` vs `shared/process_utils.rs` | Dwa pliki o podobnej nazwie, różna odpowiedzialność | OK — nie duplikacja, ale nazwa myląca. Rozważyć rename src/ na `win_process_snapshot.rs` |
| `shared/` crate | Dobrze używany, ale `daily_store/` mógłby mieć lepszą dokumentację modułu | Dodać doc-comments do `shared/daily_store/mod.rs` |

### 7.3 Sugestie podziału na moduły (przygotowanie do rozwoju)

```
dashboard/src/
├── components/
│   ├── sessions/
│   │   ├── SessionRow.tsx          ← dodać React.memo
│   │   ├── SessionsToolbar.tsx     ← wydzielić z Sessions.tsx
│   │   ├── SessionsBulkBar.tsx     ← wydzielić z Sessions.tsx
│   │   └── ...
│   └── ...
├── hooks/
│   ├── useSessionContextMenuActions.ts  ← wydzielić z Sessions.tsx
│   ├── useSessionBulkActions.ts         ← wydzielić z Sessions.tsx
│   └── ...
└── lib/
    ├── async-utils.ts   ← przenieść withTimeout z session-analysis.ts
    └── ...
```

---

## 8. Sugestie funkcjonalne

1. **Evidence boost dla background apps**: Model AI słabo klasyfikuje sesje bez plików (background apps) — evidence_count rośnie wolno (warstwy 1/2/3 dają +1 vs warstwa 0 +2). Rozważyć podwyższenie wagi layer1 dla znanych background apps.

2. **Reaktywność ustawień**: Zmiana ustawień (workingHours, splitSettings) w jednym widoku nie propaguje się do innych bez przeładowania. Rozszerzyć Zustand store o te ustawienia.

3. **ReportView UX**: Strona raportów nie ma dedykowanej sekcji w Help — użytkownik nie wie jak drukować/eksportować PDF.

4. **Daemon → SetWinEventHook**: Zamiana pollingu na event-driven detekcję zmian okna zmniejszyłaby opóźnienie wykrycia z 10 s do natychmiastowego. Jest to jednak duża zmiana architektoniczna — traktować jako long-term.

5. **Auto-split false positives**: Przy 50 sesjach per cykl z `sleep(100ms)` throttle, cykl trwa 5-10 s. Jeśli użytkownik w tym czasie zmieni projekt sesji, auto-split może nadpisać przypisanie. Rozważyć sprawdzanie `updated_at` przed splitem.

---

## 9. Wskazówki dla kolejnego modelu

### Jak sporządzić `plan_implementacji.md`

1. **Kolejność priorytetów** (od najważniejszych):
   - Faza 1: Błędy krytyczne (1.1, 1.2, 1.3) — ryzyko utraty danych
   - Faza 2: Błędy logiczne (2.1-2.4) — poprawność działania
   - Faza 3: Tłumaczenia i Help (5.x, 6.x) — jakość UX
   - Faza 4: Wydajność (4.1-4.4) — optymalizacje
   - Faza 5: Refaktoryzacja (3.x, 7.x) — utrzymywalność kodu
   - Faza 6: Sugestie funkcjonalne (8.x) — rozwój

2. **Każda zmiana w planie musi zawierać:**
   - Dokładną ścieżkę pliku i numer linii
   - Co zmienić (stary kod → nowy kod lub opis)
   - Jak przetestować (scenariusz manualny lub test)
   - Ryzyko regresji (niskie/średnie/wysokie)

3. **Zasady bezpieczeństwa danych:**
   - Przed zmianami w `rebuild.rs`, `split.rs`, `mutations.rs` — BACKUP bazy
   - Zmiany w migracjach DB: TYLKO addytywne (nowe kolumny, indeksy), NIGDY destructive
   - Zmiany w `daily_store/write.rs` — testować na kopii plików JSON
   - Zmiany w `common.json` — uruchomić `npm run lint:locales` po każdej edycji

4. **Pliki kluczowe do przeczytania przed implementacją:**
   - `dashboard/src-tauri/src/commands/sessions/rebuild.rs` — cała logika rebuild
   - `dashboard/src-tauri/src/commands/assignment_model/mod.rs` — training flow
   - `dashboard/src-tauri/src/commands/sessions/split.rs` — logika splitu
   - `dashboard/src/lib/session-analysis.ts` — frontend duplikat do usunięcia
   - `dashboard/src/pages/Sessions.tsx` — do podziału na moduły
   - `dashboard/src/pages/Help.tsx` — uzupełnienie sekcji
   - `dashboard/src/locales/{en,pl}/common.json` — naprawa struktury JSON
   - `dashboard/src/store/data-store.ts` — fix inferPreset

5. **Komendy do weryfikacji:**
   - TypeScript: `cd dashboard && npx tsc --noEmit`
   - Tłumaczenia: `cd dashboard && npm run lint:locales`
   - Testy: `cd dashboard && npm run test`
   - Lint: `cd dashboard && npm run lint`
   - Rust: `cargo check --workspace`

6. **Format planu implementacji:**
   ```markdown
   ## Faza N: [nazwa]

   ### Zadanie N.M: [tytuł]
   - **Plik:** ścieżka:linia
   - **Problem:** opis
   - **Zmiana:** co dokładnie zmienić
   - **Test:** jak sprawdzić
   - **Ryzyko:** niskie/średnie/wysokie
   - **Zależności:** czy wymaga innych zadań najpierw
   ```

---

## Podsumowanie ilościowe

| Kategoria | Znalezione | Krytyczne | Średnie | Niskie |
|---|---|---|---|---|
| Błędy krytyczne | 3 | 3 | — | — |
| Błędy logiczne | 4 | — | 4 | — |
| Duplikacja kodu | 3 | — | 2 | 1 |
| Wydajność | 6 | — | 3 | 3 |
| Tłumaczenia | 4 | 1 (duplikat kluczy) | 2 | 1 |
| Help.tsx | 2 | — | 2 | — |
| Architektura | 5 | — | 2 | 3 |
| Sugestie funkcjonalne | 5 | — | — | 5 |
| **RAZEM** | **32** | **4** | **15** | **13** |
