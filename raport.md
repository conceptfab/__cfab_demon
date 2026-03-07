# TIMEFLOW - Raport analizy kodu

**Data:** 2026-03-07
**Zakres:** Poprawnosc logiki, wydajnosc, optymalizacje, nadmiarowy kod, tlumaczenia, dokumentacja Help

---

## 1. PROBLEMY KRYTYCZNE

### 1.1 Memory leak w BackgroundServices.tsx (linia 237-241)

**Problem:** `runAutoSplit` jest w dependency array `useEffect`, ale zmienia sie przy kazdym renderze (jego deps `triggerRefresh` zmienia sie czesto). Powoduje to resetowanie `setInterval` przy kazdym renderze — zamiast 1 intervalu, moze byc ich 12+ na minute.

```typescript
useEffect(() => {
  if (!autoImportDone) return;
  void runAutoSplit();
  const interval = window.setInterval(() => void runAutoSplit(), 60_000);
  return () => clearInterval(interval);
}, [autoImportDone, runAutoSplit]); // runAutoSplit zmienia sie co render!
```

**Rozwiazanie:** Uzyc `useRef` do przechowywania aktualnej wersji `runAutoSplit` i w `useEffect` odwolywac sie do ref.current. Dependency array powinien zawierac tylko `autoImportDone`.

---

### 1.2 Globalna flaga `heavyOperationInProgress` (BackgroundServices.tsx, linia 29-40)

**Problem:** Jedna globalna flaga blokuje WSZYSTKIE ciezkie operacje (rebuild, train, auto-assign). Jesli rebuild trwa, user klika "Train Now" w AI.tsx — dostaje ciche niepowodzenie bez komunikatu bledu.

```typescript
let heavyOperationInProgress = false; // Jedna flaga dla wszystkiego
```

**Rozwiazanie:** Zamienic na `Map<string, boolean>` per typ operacji, lub przynajmniej informowac uzytkownika, ze operacja jest zablokowana.

---

### 1.3 Brak rate-limitingu na emitLocalDataChanged (tauri.ts, linia 72-80)

**Problem:** Kazda mutacja emituje event `localDataChanged`. Przy batch operacjach (np. przypisanie 10 sesji) generuje 10 eventow, kazdy triggeruje pelny refresh danych w BackgroundServices.

```typescript
function invokeMutation<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args).then((result) => {
    emitLocalDataChanged(command); // 10 mutacji = 10 refreshow
    return result;
  });
}
```

**Rozwiazanie:** Dodac debounce/throttle na `emitLocalDataChanged` (np. 300ms) lub batch mutations z jednym eventem na koniec.

---

### 1.4 Race condition w fetchStatus (AI.tsx, linia 183-207)

**Problem:** `fetchStatus()` uruchamia sie co 30s w interwale, ale nie sprawdza, czy poprzedni request sie zakonczyl. Przy wolnym backendzie moze nakladac sie wiele requestow.

**Rozwiazanie:** Dodac `AbortController` lub flage `isFetching` z early return.

---

### 1.5 Niespojnosc scoringu sesji (Sessions.tsx vs BackgroundServices.tsx)

**Problem:** `isSplittableFromBreakdown()` (Sessions.tsx, linia 122-134) uzywa `scoreBreakdownData` z frontendu, podczas gdy `autoSplitSessions` (BackgroundServices.tsx, linia 207-211) uzywa `analyzeSessionProjects` API call. Moga dawac rozne wyniki jesli model AI zmienil sie miedzy wywolaniami.

**Rozwiazanie:** Ujednolicic zrodlo danych — albo zawsze z API, albo zawsze z cache.

---

## 2. PROBLEMY SREDNIE

### 2.1 Brak error recovery w handleTrainNow (AI.tsx, linia 242-257)

**Problem:** Jesli trening sie nie powiedzie, status nie jest odswiezany. Uzytkownik widzi stary status.

**Rozwiazanie:** W bloku `catch` dodac `fetchStatus(true)` przed `showError`.

---

### 2.2 Drift correction moze dac ujemne ratio (BackgroundServices.tsx, linia 60-64)

**Problem:** Korekta driftu dodaje roznice do ostatniego projektu. Jesli drift jest duzy (-0.1), ostatni projekt moze dostac ujemne ratio.

```typescript
const drift = 1 - ratioSum;
if (raw.length > 0 && Math.abs(drift) > 0.000_001) {
  raw[raw.length - 1].ratio += drift; // Moze byc ujemne!
}
```

**Rozwiazanie:** Normalizowac kazdy ratio proporcjonalnie: `ratio = ratio / ratioSum`.

---

### 2.3 Brak backoff strategy dla sync (BackgroundServices.tsx, linia 310)

**Problem:** Jesli synchronizacja online zawsze failuje (brak polaczenia), retry co 30s bez backoff — drain baterii i spam sieciowy.

**Rozwiazanie:** Implementowac exponential backoff (30s, 60s, 120s, max 5min).

---

### 2.4 Brak timeout dla score breakdown loading (SessionRow.tsx, linia 210-213)

**Problem:** Jesli ladowanie score breakdown zawiesi sie (timeout sieci), UI pokazuje "loading..." w nieskonczonosc. Brak stanu bledu.

**Rozwiazanie:** Dodac timeout (np. 10s) i fallback do stanu bledu.

---

### 2.5 Dwa niezalezne setInterval w Sidebar.tsx (linia 143-206)

**Problem:** Dwa niemal identyczne `useEffect` z `setInterval` (10s i 60s). Szybki unmount/remount moze spowodowac niezatrzymane timery.

**Rozwiazanie:** Polaczyc w jeden `useEffect` lub wydzielic hook `usePollingEffect(fn, interval)`.

---

### 2.6 Throttle timer bez cleanup (data-store.ts, linia 36-57)

**Problem:** Zmienne `lastRefreshAtMs` i `scheduledRefreshTimer` sa na poziomie modulu. Jesli store jest zdestrukturyzowany (testy), timer zostaje w tle.

**Rozwiazanie:** Dodac cleanup mechanism lub przeniesc do store lifecycle.

---

### 2.7 inferPreset nigdy nie zwraca 'all' dla dat historycznych (data-store.ts, linia 75-91)

**Problem:** Fallback zawsze do `'week'`. Jesli daty `start` sa starsze niz `ALL_TIME_START`, preset nie zsynchronizuje sie poprawnie.

**Rozwiazanie:** Dodac obsluge dla zakresow wykraczajacych poza predefiniowane presety.

---

### 2.8 Brak batch save dla ustawien (Settings.tsx)

**Problem:** Kazda zmiana ustawienia to osobny zapis. Jesli aplikacja crashuje miedzy zapisami, konfiguracja moze byc czesciowa.

**Rozwiazanie:** Batch save przy opuszczaniu strony ustawien lub debounce z jednym zapisem.

---

## 3. PROBLEMY DROBNE

### 3.1 Nieuzywany dirtyRef (AI.tsx, linia 163)

**Problem:** `dirtyRef.current = true` ustawiany w onChange, ale `syncFromStatus()` zawsze uzywa `force=true`. Flaga jest zbedna.

**Rozwiazanie:** Usunac `dirtyRef` i powiazana logike.

---

### 3.2 Redundancja w discoveredProjects (data-store.ts, linia 29-32)

**Problem:** Dwa osobne pola stanu:
```typescript
discoveredProjects: string[]
discoveredProjectsDismissed: boolean
```

**Rozwiazanie:** Polaczyc w jedno: `discoveredProjects: { projects: string[]; dismissed: boolean }`.

---

### 3.3 Zduplikowana logika confidence (SessionRow.tsx, linia 201-206 i 383-388)

**Problem:** Identyczna kalkulacja confidence w widoku compact i normal:
```typescript
const conf = s.suggested_confidence ?? bdConf ??
  (bdCandidate ? Math.min(bdCandidate.total_score / 10, 1) : null);
```

**Rozwiazanie:** Wydzielic do utility function `computeConfidence(session, breakdown)`.

---

### 3.4 Filtrowanie po slice w buildAutoSplits (BackgroundServices.tsx, linia 42-66)

**Problem:** Kandydaci z `score <= 0` sa filtrowani PO `slice()`:
```typescript
const candidates = analysis.candidates
  .slice(0, Math.max(2, Math.min(5, maxProjects)))
  .filter((candidate) => candidate.score > 0); // Powinno byc PRZED slice
```

**Rozwiazanie:** Najpierw `.filter()`, potem `.slice()`.

---

### 3.5 toLocalDatetimeValue zdefiniowana w komponencie (ManualSessionDialog.tsx, linia 26-41)

**Problem:** Utility function zdefiniowana wewnatrz pliku komponentu zamiast w `lib/`.

**Rozwiazanie:** Przeniesc do `lib/date-utils.ts` lub `lib/utils.ts`.

---

## 4. NADMIAROWY KOD I DUPLIKACJE

### 4.1 Powtorzony pattern w user-settings.ts (8+ razy)

**Problem:** Kazde ustawienie (WorkingHours, Freeze, Session, Currency, Language, itd.) powtarza identyczny wzorzec: `STORAGE_KEY`, `LEGACY_KEY`, `loadRawSetting()`, `migrateLegacySetting()`, `loadXxxSettings()`, `saveXxxSettings()`.

**Rozwiazanie:** Stworzyc generyczna fabryke:
```typescript
function createSettingsManager<T>(config: {
  key: string;
  legacyKey?: string;
  defaults: T;
  validate?: (raw: unknown) => T;
}) { ... }
```

Redukcja ~200 linii powtorzonego kodu.

---

### 4.2 Dwa identyczne useEffect w Sidebar.tsx (linia 143-206)

**Problem:** Dwa efekty z prawie identyczna struktura (disposed flag, isVisible check, interval).

**Rozwiazanie:** Wydzielic hook `usePollingEffect(callback, intervalMs, deps)`.

---

## 5. WYDAJNOSC I OPTYMALIZACJE

### 5.1 Dashboard.tsx — cztery useMemo z nakladajacymi sie deps (linia 181-224)

**Problem:** `projectColorMap`, `unassignedToday`, `boostedByProject`, `manualCountsByProject` — wszystkie przeliczaja sie przy zmianie `allProjects` lub `todaySessions`.

**Rozwiazanie:** Memoizowac posrednie dane na poziomie store'a (Zustand selektory z `useShallow`).

---

### 5.2 Brak memoizacji w ProjectDayTimeline.tsx (linia 99-115)

**Problem:** Transformacja sesji do `TimelineRow` odbywa sie przy kazdym renderze.

**Rozwiazanie:** Opakować w `useMemo` z zaleznosciami `[sessions, projects]`.

---

### 5.3 CSS keyframes w JSX (SplashScreen.tsx, linia 30-35)

**Problem:** Animacje `@keyframes` zdefiniowane inline w komponencie.

**Rozwiazanie:** Przeniesc do pliku CSS/Tailwind config.

---

## 6. TLUMACZENIA I I18N

### Status: PRAWIDLOWY

System tlumaczen jest **poprawnie zaimplementowany**:
- Dwa jezyki: EN (domyslny), PL
- Slowniki: `locales/en/common.json` i `locales/pl/common.json` (914 linii kazdy)
- Wszystkie komponenty UI uzywaja `useTranslation()` lub `useInlineT()`
- Help.tsx i QuickStart.tsx poprawnie tlumaczone (wyjatki od reguly "UI po angielsku")
- Branding `TIMEFLOW` konsekwentnie wielkimi literami
- Brak hardkodowanych tekstow bez tlumaczen

### Drobna uwaga:
- `useInlineT()` w `lib/inline-i18n.ts` jest oznaczony jako `@deprecated` — warto zaplanowac migracje do pelnego systemu i18n z plikow JSON.

---

## 7. DOKUMENTACJA HELP — BRAKUJACE OPISY

### Funkcje NIEUDOKUMENTOWANE w Help.tsx:

| # | Funkcja | Plik zrodlowy | Opis |
|---|---------|---------------|------|
| 1 | ImportPage (osobna strona importu) | `pages/ImportPage.tsx` | Niezalezna strona importu plikow JSON — brak w Help |
| 2 | DataStats (statystyki bazy) | `components/data/DataStats.tsx` | Rozmiar bazy, liczba rekordow — brak w Help |
| 3 | Currency Settings (waluta) | `pages/Settings.tsx` | Ustawienia waluty i formatu — brak w Help |
| 4 | Language Settings (jezyk) | `pages/Settings.tsx` | Przelaczanie PL/EN — brak w Help |

### Funkcje CZESCIOWO opisane:

| # | Funkcja | Co brakuje |
|---|---------|------------|
| 1 | ReportView (pelnoekranowy raport) | Brak opisu fullscreen mode i opcji drukowania |
| 2 | Daemon Live Logs | Brak szczegolow real-time monitorowania i 200 linii logow |
| 3 | ProjectContextMenu | Brak opisu menu kontekstowego projektow |
| 4 | Session Split Settings (zaawansowane) | Brak szczegolow tolerancji, auto-split |
| 5 | Online Sync (zaawansowane) | Brak szczegolow recznej synchronizacji i zarzadzania tokenem |

---

## 8. PODSUMOWANIE PRIORYTETOW

### PILNE (wplyw na stabilnosc):
1. Memory leak w `useAutoSplitSessions` interval — BackgroundServices.tsx
2. Globalna flaga `heavyOperationInProgress` bez informowania usera — BackgroundServices.tsx
3. Brak rate-limitingu na `emitLocalDataChanged` — tauri.ts
4. Race condition w `fetchStatus` — AI.tsx

### WAZNE (wplyw na jakosc):
5. Niespojnosc scoringu (frontend vs API) — Sessions.tsx vs BackgroundServices.tsx
6. Brak error recovery w treningu AI — AI.tsx
7. Drift correction z mozliwym ujemnym ratio — BackgroundServices.tsx
8. Brak backoff w sync retry — BackgroundServices.tsx
9. Uzupelnic Help.tsx o brakujace funkcje (ImportPage, DataStats, Currency/Language Settings)

### NICE TO HAVE (czystosc kodu):
10. Factory pattern dla user-settings.ts (~200 linii redukcji)
11. Hook `usePollingEffect` dla powtorzonych intervalow
12. Usunac nieuzywany `dirtyRef` z AI.tsx
13. Migracja z `useInlineT()` na pelny system i18n
14. Przeniesienie utility functions do `lib/`

---

## 9. OCENA OGOLNA

| Aspekt | Ocena | Komentarz |
|--------|-------|-----------|
| Architektura | 8/10 | Dobra separacja (store, hooks, pages, components). Lazy loading stron. |
| I18n | 9/10 | Pelne pokrycie, dwa jezyki, konsekwentne uzycie. |
| Logika AI | 7/10 | Dziala, ale brak recovery, niespojnosc zrodel danych. |
| Wydajnosc | 6/10 | Memory leaki w intervalach, brak debounce na mutacjach. |
| Czystosc kodu | 6/10 | Duplikacje w user-settings, sidebar; zbedne zmienne. |
| Dokumentacja Help | 7/10 | Wiekszosc funkcji opisana, ale 4 calkowicie brakuje. |
| Obsluga bledow | 5/10 | Wiele miejsc bez recovery, brak backoff, ciche faile. |

**Wniosek:** Projekt ma solidna architekture i dobrze dzialajacy system tlumaczen. Glowne obszary do poprawy to: zarzadzanie cyklem zycia asynchronicznych operacji (intervaly, race conditions), obsluga bledow (recovery, backoff, informowanie usera) oraz redukcja duplikacji kodu.
