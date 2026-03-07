# TIMEFLOW — Raport analizy kodu

**Data**: 2026-03-07
**Gałąź**: `next`
**Zakres**: Frontend (React/TypeScript), backend (Rust/Tauri), tłumaczenia, dokumentacja Help

---

## 1. TŁUMACZENIA (i18n)

### Stan ogólny: ✅ Dobry

Pliki `en/common.json` i `pl/common.json` są **w pełni zsynchronizowane** — zero brakujących kluczy w obu kierunkach. Oba zawierają ~912 kluczy.

### Problem: ~40 stringów poza JSON-em (inline i18n)

Następujące komponenty używają wzorca `t('Polski tekst', 'English text')` zamiast odwoływać się do kluczy w `common.json`. Oznacza to, że te teksty nie pojawiają się w plikach lokalizacyjnych i są trudniejsze do utrzymania:

| Plik | Liczba stringów | Przykłady |
|------|----------------|-----------|
| `components/sessions/SessionRow.tsx` | 3 | `'AI sugeruje podział'`, `'Potwierdź (👍)'`, `'Odrzuć (👎)'` |
| `components/data/ImportPanel.tsx` | 9 | `'Wczytaj plik eksportu...'`, `'Import zakończony!'`, `'Brakujące projekty'` |
| `components/sessions/MultiSplitSessionModal.tsx` | 7 | `'Podziel sesję na wiele projektów'`, `'Lider'`, `'Nieprzypisane'`, `'Część ręczna'` |
| `components/data/ExportPanel.tsx` | 3 | `'Eksport nie powiódł się: {{error}}'`, `'Cały okres (od początku)'` |
| `components/data/DatabaseManagement.tsx` | 14 | Komunikaty sukcesu/błędu vacuum, backup, optymalizacji |

**Zalecenie**: Przenieść te stringi do `common.json` (sekcje `components.import`, `components.export`, `components.sessions`) i zastąpić wywołania inline kluczami JSON.

---

## 2. DOKUMENTACJA (Help.tsx)

### Stan ogólny: ✅ Kompletna

`Help.tsx` dokumentuje 12 sekcji pokrywając wszystkie główne funkcje aplikacji:

- QUICK START, DASHBOARD, SESSIONS, PROJECTS, ESTIMATES
- APPLICATIONS, TIME ANALYSIS, AI & MODEL, DATA, REPORTS
- DAEMON, SETTINGS

**Brak nieudokumentowanych funkcji** — wszystkie ekrany i tryby działania mają opis w Help.

---

## 3. BŁĘDY LOGIKI I MEMORY LEAKS

### 🔴 KRYTYCZNE

#### `pages/Settings.tsx` — setTimeout bez cleanup (~linia 237)
```typescript
setTimeout(() => setShowSavedToast(false), 3000)
// Brak clearTimeout przy unmount komponentu
```
**Problem**: Jeśli użytkownik opuści stronę przed upływem 3 sekund, React zgłosi warning o aktualizacji stanu na odmontowanym komponencie. W React 18+ może to powodować memory leak.
**Naprawa**:
```typescript
const toastTimer = useRef<ReturnType<typeof setTimeout>>();
// przy ustawieniu:
toastTimer.current = setTimeout(() => setShowSavedToast(false), 3000);
// w useEffect cleanup:
return () => clearTimeout(toastTimer.current);
```

---

### 🟡 ŚREDNIE

#### `pages/Sessions.tsx` — O(n²) lookup w `ensureCommentForBoost` (~linia 755)
```typescript
const missingIds = boostIds.filter(id => sessions.find(s => s.id === id));
```
**Problem**: `sessions.find()` w pętli = O(n²). Przy 100+ sesjach zauważalne spowolnienie.
**Naprawa**: Zbuduj `Set<number>` z ID sesji przed filtrowaniem → O(n).

#### `pages/Sessions.tsx` — Potencjalny race condition przy unmount (~linia 623)
Auto-refresh co 15 sekund: jeśli komponent zostanie odmontowany w trakcie fetch, `isAutoRefreshing` ref może nie zostać zresetowany przed następnym cyklem.
**Naprawa**: Dodaj flagę `isMounted` lub `AbortController` do anulowania żądań przy unmount.

#### `pages/Sessions.tsx` — Stare dane w mapach split eligibility (~linia 351)
`splitEligibilityBySession` i `splitAnalysisBySession` są czyszczone na podstawie `visibleIds`, ale zmiana `activeProjectId` lub `activeDateRange` nie czyści starych wpisów.
**Wpływ**: Długotrwałe użycie → akumulacja zbędnych danych w pamięci.

#### `pages/AI.tsx` — Cooldown nie jest usuwany po wygaśnięciu (~linia 94)
`buildTrainingReminder()` sprawdza `cooldownUntil` ale nie czyści przeterminowanych cooldownów z obiektu `status`. Kolejne wywołania mogą operować na nieaktualnych danych.

#### `pages/AI.tsx` — Brak deduplikacji wywołań `fetchStatus` (~linia 201)
`fetchStatus` jest wywoływana przy montażu + co 30 sekund, ale nie blokuje równoczesnych wywołań. Szybkie montowanie/odmontowanie komponentu może skutkować wielokrotnym równoczesnym zapytaniem.

#### `pages/Dashboard.tsx` — `projectColorMap` potencjalnie niezsynchronizowana (~linia 181)
Mapa kolorów jest budowana z `allProjects`, ale gdy projekty przychodzą z `Promise.allSettled` (niedeterministyczna kolejność), mapa może być tymczasowo nieaktualna.

---

### 🟢 NISKIE

#### `pages/Sessions.tsx` — Handlery w `useCallback` z częstymi zależnościami (~linia 738)
`assignSessions` z `useSessionActions` zmienia referencję przy każdym `triggerRefresh()`. Skutkuje przebudowaniem wszystkich handlerów przy każdym odświeżeniu danych.

#### `pages/Settings.tsx` — Bezwarunkowy zapis przy `handleSaveSettings`
Ustawienia są zapisywane zawsze, nawet gdy nic się nie zmieniło. Brak porównania ze stanem wyjściowym.

---

## 4. MARTWY KOD I NADMIAROWOŚĆ

### Zmienna `projectRenderLimits` — `pages/Projects.tsx` (~linia 211)
```typescript
const [projectRenderLimits, setProjectRenderLimits] = useState<...>();
```
`projectRenderLimits` jest zadeklarowane w state, ale nie jest używane w żadnym renderowanym elemencie (nie widać go w przeczytanym kodzie). Kandydat do usunięcia.

### Zduplikowany color picker UI
Logika wyboru koloru projektu jest zaimplementowana niezależnie w dwóch miejscach:
- `pages/ProjectPage.tsx` (~linia 699–744)
- `pages/Applications.tsx` (~linia 415–463)

**Zalecenie**: Wyekstrahować do `components/ui/ColorPicker.tsx`.

### Zduplikowane parsowanie stawki (`rate`)
- `pages/Estimates.tsx` (~linia 34) — dedykowana funkcja `parseRate()`
- `pages/ProjectPage.tsx` (~linia 640) — ta sama logika inline

**Zalecenie**: Przenieść `parseRate()` do `lib/utils.ts`.

---

## 5. OBSŁUGA BŁĘDÓW

### Rozproszonych ~60 wywołań `console.error`/`console.warn`
Błędy są logowane do konsoli bez centralnego aggregatora. Szczególnie dotkliwe miejsca:

| Plik | Przykład antywzorca |
|------|---------------------|
| `pages/Applications.tsx` (~linia 60) | `.catch(console.error)` — brak fallback state |
| `pages/DaemonControl.tsx` (~linia 39) | `.catch(console.error)` — brak aktualizacji UI |
| `pages/ProjectPage.tsx` (~linia 403) | `catch(e) { console.error(e) }` — brak toastu dla użytkownika |

**Zalecenie**: Stworzyć prosty `logger.ts` w `lib/` (wrapping `console.*`) i tam dodać np. BugHunter integration. Przy kluczowych błędach operacyjnych — pokazać `toast` z komunikatem dla użytkownika.

### Brak user feedback przy niepowodzeniu akcji
W `pages/ProjectPage.tsx` handler `handleAction()` (~linia 403) łapie wyjątek ale nie informuje użytkownika. Użytkownik może nie wiedzieć, że operacja się nie powiodła.

---

## 6. WYDAJNOŚĆ

### Wirtualizacja list
`react-virtuoso` jest zainstalowane (`^4.18.1`), ale warto sprawdzić czy jest używane we wszystkich długich listach (Sesje, Projekty, Aplikacje). Listy bez wirtualizacji przy 1000+ elementach mogą być wolne.

### Auto-refresh w Sessions.tsx — brak incremental loading
Co 15 sekund pobierany jest pełny `PAGE_SIZE` (100 sesji) od offsetu 0. Dla dużych baz danych jest to zbędne. Mogłoby wystarczyć sprawdzenie znacznika czasu ostatniej zmiany.

### `hotProjectIds` bez memoizacji — `pages/Projects.tsx` (~linia 298)
```typescript
const hotProjectIds = [...].slice(0, 5); // nowa tablica przy każdym renderze
```
**Naprawa**: Opakować w `useMemo`.

---

## 7. JAKOŚĆ KOMPONENTÓW

### `pages/ProjectPage.tsx` — 15+ zmiennych stanu
Komponent zarządza ~15 niezależnymi wywołaniami `useState`. Trudny w utrzymaniu, ryzyko desynchronizacji stanów.
**Zalecenie**: Wyekstrahować logikę do customowego hooka `useProjectPageState()` lub pogrupować powiązane stany w jeden obiekt.

### `components/sessions/MultiSplitSessionModal.tsx` — emoji w stringach tłumaczeń
`'Potwierdź (👍)'` i `'Odrzuć (👎)'` — emoji zahardkodowane w stringach tłumaczeń. Przy ewentualnym customizacji UI mogą sprawiać problemy.

---

## 8. BEZPIECZEŃSTWO I DOBRE PRAKTYKI

- ✅ Zero użycia `@ts-ignore` ani `as any` — doskonałe typowanie
- ✅ Prawidłowe czyszczenie event listenerów w TopBar.tsx, ProjectPage.tsx, Sidebar.tsx
- ✅ `Promise.allSettled()` stosowane prawidłowo przy równoległych żądaniach
- ✅ Flaga `disposed`/`isMounted` w Sidebar.tsx zapobiega race condition
- ✅ Brak sekretów w kodzie
- ⚠️ Brak `aria-checked` na custom toggle w `pages/DaemonControl.tsx` (~linia 264) — minor dostępność

---

## 9. PODSUMOWANIE PRIORYTETÓW

| # | Problem | Plik | Pilność |
|---|---------|------|---------|
| 1 | `setTimeout` bez cleanup | `Settings.tsx:237` | 🔴 Wysoka |
| 2 | O(n²) lookup w `ensureCommentForBoost` | `Sessions.tsx:755` | 🟡 Średnia |
| 3 | ~40 stringów poza `common.json` (inline i18n) | Wiele plików | 🟡 Średnia |
| 4 | Brak user feedback przy błędach akcji | `ProjectPage.tsx:403`, `Applications.tsx:60` | 🟡 Średnia |
| 5 | Race condition w `fetchStatus` (AI.tsx) | `AI.tsx:201` | 🟡 Średnia |
| 6 | Zduplikowany color picker | `ProjectPage.tsx`, `Applications.tsx` | 🟢 Niska |
| 7 | `projectRenderLimits` — dead code | `Projects.tsx:211` | 🟢 Niska |
| 8 | `hotProjectIds` bez `useMemo` | `Projects.tsx:298` | 🟢 Niska |
| 9 | 15+ useState w ProjectPage | `ProjectPage.tsx` | 🟢 Niska |
| 10 | Brak `aria-checked` na toggle | `DaemonControl.tsx:264` | 🟢 Niska |

---

## 10. OGÓLNA OCENA

Kod jest **dobrej jakości** — poprawna architektura, spójne wzorce, brak problemów z typowaniem TypeScript. Główne obszary do poprawy to:

1. Obsługa błędów (centralizacja, user feedback)
2. Kilka memory leaków (głównie `setTimeout` bez cleanup)
3. Migracja inline i18n do plików JSON
4. Drobna optymalizacja wydajności (O(n²) → O(n), memoizacja)

Brakuje: skonfigurowanych komend `Dev`, `Build`, `Test` w `CLAUDE.md` — bez nich nie można uruchomić linta/testów automatycznie.
