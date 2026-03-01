# Raport analizy kodu — TIMEFLOW Dashboard

**Data:** 2026-03-01
**Gałąź:** `claude/distracted-gates`
**Zakres:** Cały kod dashboardu (`dashboard/src/`)

---

## Spis treści

1. [Struktura projektu](#1-struktura-projektu)
2. [Krytyczne problemy](#2-krytyczne-problemy)
3. [Błędy logiczne](#3-błędy-logiczne)
4. [Niespójności UX](#4-niespójności-ux)
5. [Problemy wydajnościowe](#5-problemy-wydajnościowe)
6. [Nadmiarowy / zduplikowany kod](#6-nadmiarowy--zduplikowany-kod)
7. [Brakujące tłumaczenia](#7-brakujące-tłumaczenia)
8. [Podsumowanie i priorytety](#8-podsumowanie-i-priorytety)

---

## 1. Struktura projektu

```
dashboard/src/
├── App.tsx                          # Root: routing (PageRouter), ErrorBoundary, providers
├── main.tsx                         # Punkt wejścia React (StrictMode włączony)
├── i18n.ts                          # Konfiguracja i18next
├── pages/
│   ├── Dashboard.tsx                # Strona główna: metryki, wykresy, timeline
│   ├── Sessions.tsx                 # Lista i zarządzanie sesjami (~800 linii)
│   ├── Projects.tsx                 # Zarządzanie projektami (~1000 linii)
│   ├── ProjectPage.tsx              # Karta pojedynczego projektu
│   ├── Applications.tsx             # Aplikacje monitorowane
│   ├── Estimates.tsx                # Wyceny i stawki
│   ├── TimeAnalysis.tsx             # Analiza czasu (daily/weekly/monthly)
│   ├── AI.tsx                       # Model AI i ustawienia
│   ├── DaemonControl.tsx            # Kontrola demona
│   ├── Settings.tsx                 # Wszystkie ustawienia użytkownika
│   ├── Data.tsx                     # Zarządzanie danymi / import / eksport
│   ├── ImportPage.tsx               # Strona importu
│   ├── Help.tsx                     # Panel pomocy z zakładkami
│   └── QuickStart.tsx               # Ekran startowy (onboarding)
├── components/
│   ├── ManualSessionDialog.tsx
│   ├── dashboard/                   # Wykresy i widgety dashboardu
│   ├── data/                        # Komponenty zarządzania danymi
│   ├── import/FileDropzone.tsx
│   ├── layout/                      # Shell: MainLayout, Sidebar, TopBar, BugHunter
│   ├── project/ProjectContextMenu.tsx
│   ├── sessions/SessionRow.tsx
│   ├── sync/BackgroundServices.tsx  # Wszystkie background joby
│   ├── time-analysis/               # Widoki i hook danych analizy czasu
│   └── ui/                          # Shadcn/UI primitives + shared components
├── store/
│   ├── data-store.ts                # Zakres dat, preset, refreshKey, autoImport
│   ├── settings-store.ts            # Waluta, animacje wykresów
│   └── ui-store.ts                  # Aktywna strona, fokusy, firstRun
├── lib/
│   ├── tauri.ts                     # Wszystkie invoke() do backendu Rust
│   ├── db-types.ts                  # Kontrakty typów TS ↔ Rust
│   ├── user-settings.ts             # Load/save localStorage (6 kategorii)
│   ├── online-sync.ts               # Logika synchronizacji online
│   ├── sync-events.ts               # CustomEvent LOCAL_DATA_CHANGED
│   ├── help-navigation.ts           # Mapowanie strona ↔ zakładka pomocy
│   ├── inline-i18n.ts               # Hook useInlineT() (pl/en inline)
│   ├── date-locale.ts               # date-fns locale resolver
│   └── utils.ts                     # cn, formatDuration, formatMoney, etc.
└── locales/
    ├── en/common.json               # ~334 linie, ~120 kluczy
    └── pl/common.json               # Identyczna struktura kluczy
```

### Routing i architektura danych

Projekt używa routingu opartego na Zustand (`useUIStore.currentPage`) zamiast React Router. Wszystkie strony poza `Dashboard` są lazy-loaded przez `React.lazy`. Przepływ danych:

```
UI Component → lib/tauri.ts (invoke) → emituje LOCAL_DATA_CHANGED_EVENT
    → BackgroundServices.tsx → triggerRefresh() → data-store.refreshKey++
    → Wszystkie komponenty reagują na refreshKey w deps useEffect
```

---

## 2. Krytyczne problemy

### 2.1 Podwójny system i18n — 60% tekstów poza kontrolą

**Pliki:** `AI.tsx`, `DaemonControl.tsx`, `Applications.tsx`, `TimeAnalysis.tsx`, `Estimates.tsx`, `Settings.tsx`, `Help.tsx`, `QuickStart.tsx`, `Projects.tsx` (częściowo), `ProjectPage.tsx` (częściowo)

W projekcie współistnieją dwa niezależne systemy tłumaczeń:

**System 1 — i18next (oficjalny):**
```typescript
const { t } = useTranslation();
t('sessions.menu.session_actions', { app: s.app_name })
// Zasięg: ManualSessionDialog, SessionRow, Sidebar, TopBar, BugHunter, Dashboard, DateRangeToolbar
```

**System 2 — inline (custom hook):**
```typescript
const t = useInlineT();
t('Trening modelu zakończony.', 'Model training completed.')
// lub lokalna lambda w każdym pliku:
const t = (pl: string, en: string) => (lang === 'pl' ? pl : en);
```

**Skutki:**
- Teksty z Systemu 2 NIE są w plikach JSON — nie można ich zmienić bez modyfikacji kodu źródłowego.
- Brakuje kluczy w `common.json` dla całych sekcji: `ai.*`, `daemon.*`, `applications.*`, `time_analysis.*`, `estimates.*`, `help.*` (poza `language_hint`).
- `Applications.tsx` ma lokalną `t()` która _próbuje_ łączyć oba systemy, co tworzy trzeci wariant:

```typescript
// Applications.tsx linia 38-44
const t = (pl: string, en?: string) => {
  if (typeof en === 'string') return lang === 'pl' ? pl : en;
  return i18n.t(pl); // ← fallback do i18next gdy brak 2. arg
};
```

**Rekomendacja:** Migracja wszystkich tekstów do plików JSON i18next. Priorytet: strony AI, DaemonControl, Applications, TimeAnalysis. `useInlineT()` należy oznaczyć jako deprecated i docelowo usunąć.

---

### 2.2 Format daty niezgodny z locale polskim

**Plik:** `dashboard/src/components/sessions/SessionRow.tsx:28`

```typescript
function formatDate(t: string, locale: Locale) {
  try {
    return format(parseISO(t), 'MMM d, yyyy', { locale });
  } catch {
    return t;
  }
}
```

Format `'MMM d, yyyy'` z `locale=pl` daje wynik np. `"sty 5, 2025"` — polska nazwa miesiąca z angielską interpunkcją (przecinek po dniu, rok po nim). Poprawny format dla polskiego to `'d MMM yyyy'` → `"5 sty 2025"`.

**Fix:**
```typescript
// Wariant warunkowy (zachowuje EN bez zmian):
const dateFormat = locale.code?.startsWith('pl') ? 'd MMM yyyy' : 'MMM d, yyyy';
return format(parseISO(t), dateFormat, { locale });

// lub prościej — format neutralny dla obu locale:
return format(parseISO(t), 'd MMM yyyy', { locale });
```

---

## 3. Błędy logiczne

### 3.1 `Estimates.tsx` — brak stanu ładowania przy re-fetchu

**Plik:** `dashboard/src/pages/Estimates.tsx:93`

```typescript
// Tylko pierwsze ładowanie ustawia loading=true
if (rows.length === 0) {
  setLoading(true);
}
```

Gdy tabela zawiera już dane i użytkownik zmienia zakres dat (`refreshKey++`), `loading` pozostaje `false`. Tabela nie pokazuje stanu ładowania — dane wyglądają na "zamrożone" do czasu powrotu odpowiedzi.

**Fix:**
```typescript
// Przed wywołaniem backendu, zawsze:
setLoading(true);
try {
  const result = await fetchEstimates(...);
  setRows(result);
} finally {
  setLoading(false);
}
```

---

### 3.2 `BackgroundServices.tsx` — stale closure w `setInterval`

**Plik:** `dashboard/src/components/sync/BackgroundServices.tsx:191-241`

```typescript
useEffect(() => {
  loopRef.current = window.setInterval(() => {
    if (autoImportDone) {  // ← capture z closure przy tworzeniu
      const syncSettings = loadOnlineSyncSettings();
      if (syncSettings.enabled) {
        if (nextSyncIntervalRef.current === 0) {
          nextSyncIntervalRef.current = now + syncIntervalMs;
        }
      }
    }
  }, 5000);
  return () => clearInterval(loopRef.current);
}, [autoImportDone, triggerRefresh]); // efekt restartuje się gdy autoImportDone zmienia się
```

Gdy `syncSettings.enabled` zmieni się z `false` na `true` bez restartu komponentu (np. przez zapis w Settings), `nextSyncIntervalRef.current` może być niezerowy z poprzedniej wartości i pierwsza synchronizacja nie zostanie zaplanowana. Obsługa `ONLINE_SYNC_SETTINGS_CHANGED_EVENT` (linia ~244) resetuje ref — ale tylko jeśli ten event jest emitowany przy każdej zmianie ustawień synca.

**Weryfikacja:** Upewnić się, że `Settings.tsx` emituje `ONLINE_SYNC_SETTINGS_CHANGED_EVENT` przy każdym zapisie ustawień online sync.

---

### 3.3 `BackgroundServices.tsx` — potencjalny wyciek interwału przy React StrictMode

**Plik:** `dashboard/src/components/sync/BackgroundServices.tsx:133`

```typescript
const startupAttemptedRef = useRef(false);

useEffect(() => {
  if (!autoImportDone || startupAttemptedRef.current) return;
  startupAttemptedRef.current = true;
  void runSync('startup', false);
}, [autoImportDone]);
```

W React StrictMode (aktywny w `main.tsx`) efekty są wywoływane dwukrotnie przy mountowaniu. `useRef` persystuje wartość między pierwszym a drugim wywołaniem w StrictMode, przez co `startupAttemptedRef.current = true` z pierwszego wywołania blokuje drugie. W środowisku produkcyjnym (StrictMode wyłączony) zachowanie jest prawidłowe, ale to może maskować rzeczywiste błędy w development.

---

### 3.4 `Applications.tsx` — `t` pominięta w dependency array useEffect

**Plik:** `dashboard/src/pages/Applications.tsx:65`

```typescript
const t = (pl: string, en?: string) => { ... }; // lokalna funkcja — tworzy się przy każdym renderze

useEffect(() => {
  Promise.allSettled([getApplications(), getMonitoredApps()]).then((results) => {
    setMonitoredError(t('Nie udało się...', 'Failed to...'));
  });
}, [refreshKey]); // ← brakuje t w deps
```

`t` jest lokalną funkcją closurowaną nad `lang` — tworzy się na nowo przy każdym renderze. Brak jej w `deps` nie powoduje błędu w praktyce (bo `lang` jest stały po inicjalizacji), ale ESLint `react-hooks/exhaustive-deps` powinien to oznaczyć jako warning.

**Fix:** Przenieść `t` na poziom modułu (stała) lub użyć `useCallback`, albo docelowo — migować do `useTranslation()`.

---

## 4. Niespójności UX

### 4.1 `Settings.tsx` — natywny `alert()` i `confirm()` zamiast komponentów UI

**Plik:** `dashboard/src/pages/Settings.tsx:221-250`

```typescript
const handleRebuildSessions = async () => {
  try {
    const merged = await rebuildSessions(...);
    alert(tt(`Pomyślnie połączono ${merged}...`, `Successfully merged ${merged}...`));
  } catch (e) {
    alert(tt('Błąd łączenia...', 'Error linking...'));
  }
};

const handleResetAllData = () => {
  if (!confirm(tt('Czy na pewno chcesz...', 'Are you sure you want...'))) return;
  // ...
};
```

Aplikacja posiada dedykowane komponenty: `useToast()` (w `toast-notification.tsx`) i `useConfirm()` (w `confirm-dialog.tsx`). Używanie natywnych `alert()`/`confirm()` jest stylowo niespójne z resztą UI i nie dostosowuje się do motywu aplikacji (dark mode itp.).

**Fix:**
```typescript
const { toast } = useToast();
const confirm = useConfirm();

const handleRebuildSessions = async () => {
  try {
    const merged = await rebuildSessions(...);
    toast({ title: tt('Pomyślnie połączono...', '...'), variant: 'success' });
  } catch (e) {
    toast({ title: tt('Błąd łączenia...', '...'), variant: 'destructive' });
  }
};

const handleResetAllData = async () => {
  const ok = await confirm({ title: tt('Czy na pewno...', '...') });
  if (!ok) return;
  // ...
};
```

---

## 5. Problemy wydajnościowe

### 5.1 `Projects.tsx` i `Sessions.tsx` — brak paginacji przy dużej liczbie rekordów

**Pliki:** `dashboard/src/pages/Projects.tsx`, `dashboard/src/pages/Sessions.tsx`

Obie strony ładują wszystkie rekordy z backendu i renderują je w pętli bez wirtualizacji ani paginacji. Przy dużej bazie danych (np. rok pracy = >50 000 sesji) może to powodować:
- Długi czas ładowania komponentu
- Duże zużycie pamięci DOM
- Wolne re-rendery przy filtracji

**Rekomendacja:** Rozważyć paginację po stronie backendu (Tauri) lub wirtualizację listy (np. `@tanstack/virtual` / `react-window`) dla `SessionRow` jeśli liczba sesji przekracza ~1000.

---

### 5.2 `Sidebar.tsx` — polling co 3s bez debounce'a przy nawigacji

**Plik:** `dashboard/src/components/layout/Sidebar.tsx`

Sidebar odpytuje backend co 3 sekundy (status demona, status AI, status synca). Jeśli strona jest często zmieniana (szybka nawigacja), mogą nakładać się poprzednie requesty (brak `AbortController`). Refs (`isFetchingRef`) chronią przed równoległymi wywołaniami, ale brak jest mechanizmu czyszczenia pending promise przy unmount.

---

### 5.3 `useTimeAnalysisData.ts` — brak memoizacji kosztownych agregacji

**Plik:** `dashboard/src/components/time-analysis/useTimeAnalysisData.ts`

Hook przetwarza i agreguje dane sesji do widoków daily/weekly/monthly. Agregacje są przeliczane przy każdym renderze komponentu nadrzędnego. Brak `useMemo` dla kosztownych transformacji danych.

**Rekomendacja:** Owrapować przeliczenia w `useMemo` z deps na dane surowe.

---

## 6. Nadmiarowy / zduplikowany kod

### 6.1 Logika operacji na sesjach zduplikowana w 3 miejscach

**Pliki:** `Sessions.tsx`, `ProjectPage.tsx`, `Dashboard.tsx`

Operacje `assign session`, `update comment`, `update multiplier`, `delete session` są implementowane niezależnie w każdym z tych plików. Każdy zawiera własne:
- Stan `contextMenu` (pozycja x/y, docelowa sesja)
- Obsługę keydown dla Escape
- Wywołania `assignSession()`, `updateSessionComment()`, `deleteSession()` z `lib/tauri.ts`
- Logikę odświeżania po mutacji

**Rekomendacja:** Wydzielić `useSessionActions()` hook zawierający wspólną logikę mutacji + stan menu kontekstowego. `ProjectContextMenu.tsx` już istnieje jako komponent — można go rozszerzyć.

---

### 6.2 `renderDuration()` w `Projects.tsx` vs `formatDuration()` w `utils.ts`

**Pliki:** `dashboard/src/pages/Projects.tsx:111-151`, `dashboard/src/lib/utils.ts`

`renderDuration()` w `Projects.tsx` reimplementuje logikę obliczania godzin/minut/sekund z `utils.ts::formatDuration()`, ale zwraca JSX z wystylizowanymi jednostkami (`<span>`). To jest świadoma decyzja stylowa — jednak warto rozważyć wydzielenie jej do osobnego komponentu `DurationDisplay` w `components/ui/`, by nie powtarzać formatu w innych miejscach jeśli zajdzie potrzeba.

---

### 6.3 Lokalna lambda `t()` w każdym pliku korzystającym z Systemu 2

**Pliki:** `AI.tsx`, `DaemonControl.tsx`, `Applications.tsx`, `Help.tsx`, `QuickStart.tsx`

Każdy z tych plików definiuje własną wersję lambdy tłumaczącej:

```typescript
// AI.tsx
const t = useCallback((pl: string, en: string) => (lang === 'pl' ? pl : en), [lang]);

// DaemonControl.tsx
const t = (pl: string, en: string) => (lang === "pl" ? pl : en);

// Applications.tsx
const t = (pl: string, en?: string) => {
  if (typeof en === 'string') return lang === 'pl' ? pl : en;
  return i18n.t(pl);
};
```

`useInlineT()` istnieje właśnie po to, by ujednolicić tę logikę — ale nie jest używany wszędzie. Przynajmniej `DaemonControl.tsx` i `AI.tsx` powinny używać `useInlineT()` zamiast własnych wariantów.

---

### 6.4 `user-settings.ts` — lista walut hardkodowana dwukrotnie

**Plik:** `dashboard/src/lib/user-settings.ts`

```typescript
// linia ~222 (loadCurrencySettings)
code: parsed.code && ["USD", "EUR", "PLN"].includes(parsed.code) ? parsed.code : ...

// linia ~241 (saveCurrencySettings lub walidacja)
// ten sam array ["USD", "EUR", "PLN"] pojawia się ponownie
```

**Fix:**
```typescript
const SUPPORTED_CURRENCIES = ["USD", "EUR", "PLN"] as const;
// używać SUPPORTED_CURRENCIES w obu miejscach
```

---

## 7. Brakujące tłumaczenia

### 7.1 Sekcje całkowicie nieobecne w plikach JSON

Poniższe strony używają wyłącznie inline strings — w `common.json` brakuje dla nich kluczy:

| Strona / komponent | Szacowana liczba brakujących kluczy |
|---|---|
| `AI.tsx` | ~30 kluczy (status, przyciski, komunikaty, opisy) |
| `DaemonControl.tsx` | ~20 kluczy (statusy, akcje, opisy) |
| `Applications.tsx` | ~15 kluczy (nagłówki, błędy, komunikaty) |
| `TimeAnalysis.tsx` + `DailyView/WeeklyView/MonthlyView` | ~25 kluczy (nagłówki, legendy, filtry) |
| `Estimates.tsx` | ~15 kluczy (nagłówki kolumn, błędy, komunikaty) |
| `Help.tsx` (poza `language_hint`) | ~50 kluczy (tytuły zakładek, opisy funkcji) |
| `QuickStart.tsx` (poza `language_hint`) | ~20 kluczy (opisy kroków, przyciski) |
| `ProjectPage.tsx` | ~10 kluczy |

**Łącznie:** ~185 brakujących kluczy w plikach JSON.

---

### 7.2 Klucze niezdefiniowane w `common.json` (wg analizy kodu)

Używane w kodzie przez `useTranslation()` / `t('klucz')`, ale nieobecne lub niekompletne w JSON:

| Klucz | Używany w | Status |
|---|---|---|
| `sessions.row.duration_tooltip` | `SessionRow.tsx` | Do weryfikacji |
| `projects.labels.*` (dynamiczne) | `Projects.tsx` | Częściowy |
| `settings.sections.*` | `Settings.tsx` | Brak całej sekcji |

> Uwaga: pełna weryfikacja wymagałaby uruchomienia skryptu wyciągającego wszystkie wywołania `t('...')` z kodu i porównania z plikami JSON.

---

### 7.3 Klucze istniejące w EN ale bez odpowiednika w PL (lub odwrotnie)

Na podstawie analizy struktury obu plików `common.json` — klucze są identyczne. Różnice wymagają weryfikacji wartości (nie tylko kluczy). Szczególnie sprawdzić: ciągi z interpolacją (`{{variable}}`), gdzie wartość EN i PL powinny mieć te same zmienne.

---

## 8. Podsumowanie i priorytety

### Wysoki priorytet (błędy lub regresje UX)

| # | Problem | Plik | Linia | Opis | Status (2026-03-01) |
|---|---|---|---|---|---|
| H1 | **Format daty PL** | `SessionRow.tsx` | 28 | `'MMM d, yyyy'` → `'d MMM yyyy'` dla locale PL | ✅ Zrobione |
| H2 | **`alert()`/`confirm()`** | `Settings.tsx` | 221, 233 | Zastąpić `useToast()` / `useConfirm()` | ✅ Zrobione |
| H3 | **Brak loading przy re-fetch** | `Estimates.tsx` | 93 | `setLoading(true)` tylko dla pustej tablicy | ✅ Zrobione |

### Średni priorytet (dług techniczny / niespójność)

| # | Problem | Status |
|---|---|---|
| M1 | **Migracja ~185 kluczy inline do plików JSON i18next** | ✅ Zrobione (etap przejściowy): automatyczna synchronizacja inline → i18next (`inline.*`), 457 par PL/EN w `common.json`, `skipped dynamic templates: 0` |
| M2 | **Wydzielenie `useSessionActions()` hook** | ✅ Zrobione |
| M4 | **Stale closure w `BackgroundServices.tsx`** | ✅ Zweryfikowane: `saveOnlineSyncSettings()` emituje `ONLINE_SYNC_SETTINGS_CHANGED_EVENT` |

### Niski priorytet (do rozważenia / clean code)

| # | Problem | Status |
|---|---|---|
| L1 | **Paginacja/wirtualizacja sesji i projektów** | ✅ Zrobione: sesje działają na limicie/offset + `react-virtuoso`, projekty renderowane stronicowane (`Load more`) per sekcja/lista |
| L3 | **Ujednolicenie lambdy `t()` w `AI.tsx`, `DaemonControl.tsx`** | ✅ Zrobione (`useInlineT`) |
| L4 | **Brak `AbortController` w Sidebar polling** | ✅ Zrobione |
| L5 | **Brak `useMemo` w `useTimeAnalysisData.ts`** | ✅ Zrobione |

---

*Raport wygenerowany automatycznie przez analizę kodu — wymaga weryfikacji przez dewelopera.*
