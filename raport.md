# TIMEFLOW — Raport analizy kodu

Data: 2026-03-01

---

## Spis treści

1. [Podsumowanie](#1-podsumowanie)
2. [Problemy krytyczne](#2-problemy-krytyczne)
3. [Logika i poprawność](#3-logika-i-poprawność)
4. [Wydajność i optymalizacje](#4-wydajność-i-optymalizacje)
5. [Nadmiarowy i zduplikowany kod](#5-nadmiarowy-i-zduplikowany-kod)
6. [Architektura i wzorce](#6-architektura-i-wzorce)
7. [Tłumaczenia (i18n)](#7-tłumaczenia-i18n)
8. [Sugerowane działania — priorytetyzacja](#8-sugerowane-działania--priorytetyzacja)

---

## 1. Podsumowanie

| Kategoria | Krytyczne | Średnie | Niskie |
|-----------|:---------:|:-------:|:------:|
| Dead code / nadmiarowy kod | 1 | 4 | 3 |
| Logika / poprawność | 1 | 3 | 2 |
| Wydajność | — | 2 | 3 |
| Duplikacja kodu | — | 5 | 1 |
| Architektura / wzorce | — | 2 | 2 |
| Tłumaczenia (i18n) | 1 | 1 | — |
| **Razem** | **3** | **17** | **11** |

---

## 2. Problemy krytyczne

### 2.1 Dead code: `app-store.ts` (227 linii)

**Plik:** `src/store/app-store.ts`

Cały plik jest nieużywany. `useAppStore` nie jest importowany nigdzie w projekcie. To stary monolityczny store sprzed refaktoryzacji na `ui-store.ts`, `data-store.ts` i `settings-store.ts`. Zawiera zduplikowaną logikę (`presetToRange`, `inferPreset`, `scheduleThrottledRefresh`).

**Akcja:** Usunąć plik.

### 2.2 Race condition: brak mutexa na `runOnlineSyncOnce`

**Plik:** `src/lib/online-sync.ts`

Jeśli dwa wywołania uruchomią się równocześnie (timer + ręczny trigger + local_change event), mogą wykonać push/pull równolegle. To prowadzi do race condition na stanie localStorage i sprzecznych operacji z serwerem.

**Uwaga:** `BackgroundServices.tsx` używa `syncRunningRef` jako guard, ale bezpośrednie wywołania `runOnlineSyncOnce()` z Sidebara (linia 276) i Settings (linia 942) go pomijają.

**Akcja:** Dodać moduł-level lock (`let isSyncRunning = false` lub Promise-based mutex) wewnątrz `runOnlineSyncOnce`.

### 2.3 Tekst polski w angielskim UI

**Plik:** `src/components/ManualSessionDialog.tsx`, linia ~306

Checkbox label `"Przedłuż sesję na kolejne dni"` — tekst po polsku wmieszany w angielski interfejs. Powinien być przetłumaczony lub użyty przez system i18n.

**Akcja:** Przenieść do systemu i18n lub co najmniej dodać angielski odpowiednik.

---

## 3. Logika i poprawność

### 3.1 Brakujący dependency w useCallback

**Plik:** `src/pages/Dashboard.tsx`, linia 229

`handleUpdateSessionComment` używa `triggerRefresh` w ciele `useCallback`, ale dependency array to `[]`. Narusza to reguły React hooks. Zustand selektory są stabilne, więc w praktyce nie powoduje buga, ale linter to zgłosi.

**Poprawka:** Zmienić `[]` na `[triggerRefresh]` (analogicznie do `handleAssignSession` w linii 197).

### 3.2 `fetchStatus` poza dep array w useEffect

**Plik:** `src/pages/AI.tsx`, linia 145-151

`useEffect(() => { fetchStatus(); ... }, [])` — `fetchStatus` nie jest w dependency array. Funkcja używa `showError`, więc React linter zgłosi ostrzeżenie.

**Poprawka:** Opakować `fetchStatus` w `useCallback` lub przenieść logikę bezpośrednio do efektu.

### 3.3 Brak try/catch w handleResetAppTime

**Plik:** `src/pages/Applications.tsx`, linia ~158-161

`handleResetAppTime` wywołuje `resetAppTime()` bez try/catch. Jeśli komenda Tauri rzuci błąd, Promise zostanie odrzucony bez obsługi.

**Poprawka:** Dodać try/catch z `showError` lub `console.error`.

### 3.4 Komendy Tauri używające `invoke` zamiast `invokeMutation`

**Plik:** `src/lib/tauri.ts`

Następujące komendy zmieniają stan, ale używają `invoke` zamiast `invokeMutation`, więc nie emitują eventu `LOCAL_DATA_CHANGED`:

| Linia | Komenda |
|-------|---------|
| 200 | `setAssignmentMode` |
| 213 | `setAssignmentModelCooldown` |
| 216 | `trainAssignmentModel` |
| 253 | `setFeedbackWeight` |

**Poprawka:** Zmienić na `invokeMutation`.

### 3.5 `formatDuration` nie obsługuje ujemnych wartości

**Plik:** `src/lib/utils.ts`, linia 8-15

Ujemna wartość `seconds` da niepoprawny wynik (np. `-5` → `"0m -5s"`).

**Poprawka:** Dodać `Math.abs()` lub zwracać `"0s"` dla wartości ≤ 0.

---

## 4. Wydajność i optymalizacje

### 4.1 Duplikacja pollingu: Sidebar vs BackgroundServices

**Pliki:** `src/components/layout/Sidebar.tsx` (linia 134-168), `src/components/sync/BackgroundServices.tsx`

Sidebar odpytuje 5 endpointów co 10 sekund (`getDaemonStatus`, `getAssignmentModelStatus`, `getDatabaseSettings`, 2x `getSessionCount`). BackgroundServices ma własny polling loop (co 1s z warunkami czasowymi). Oba działają niezależnie.

**Sugestia:** Przenieść polling Sidebara do BackgroundServices lub współdzielonego store'a, aby uniknąć podwójnych wywołań IPC.

### 4.2 `loadOnlineSyncSettings` zapisuje do localStorage przy każdym odczycie

**Plik:** `src/lib/online-sync.ts`, linia ~665

Funkcja `load*` ma side-effect: zapisuje do localStorage (aby utrwalić wygenerowane `deviceId`). Przy częstych odczytach (co 1s w job pool) to niepotrzebne operacje I/O.

**Poprawka:** Zapisywać tylko gdy `deviceId` był wygenerowany (nie istniał w storage).

### 4.3 DaemonControl — logi bez memoizacji

**Plik:** `src/pages/DaemonControl.tsx`, linia 277-289

`logs.split("\n").map(...)` przy każdym auto-refresh (co 5s) tworzy nową tablicę i przerenderowuje cały blok DOM.

**Poprawka:** Użyć `useMemo` na splittowanych liniach.

### 4.4 `loadSessionSettings()` wywoływane co 10s w Sidebar

**Plik:** `src/components/layout/Sidebar.tsx`, linia ~138

Synchroniczny odczyt z localStorage przy każdym ticku intervalu. Niewielki koszt, ale niepotrzebne powtarzanie.

**Poprawka:** Cache'ować wartość i odświeżać rzadziej (np. na focus window).

### 4.5 Podwójna serializacja `JSON.stringify(archive)` w online-sync

**Plik:** `src/lib/online-sync.ts`

Archiwum jest serializowane do JSON dwukrotnie: raz w `sha256Hex` i ponownie w `pushPayloadSize`. Dla dużych zbiorów danych to zbędna operacja.

**Poprawka:** Zachować serializowany string i użyć ponownie.

---

## 5. Nadmiarowy i zduplikowany kod

### 5.1 `getErrorMessage` — 3 identyczne kopie

**Pliki:** `Estimates.tsx:33`, `Projects.tsx:92`, `ManualSessionDialog.tsx:41`

Identyczna funkcja `getErrorMessage(error: unknown, fallback: string): string` powtórzona w 3 plikach.

**Poprawka:** Wynieść do `@/lib/utils.ts`.

### 5.2 `formatMultiplierLabel` — 3 identyczne kopie

**Pliki:** `Sessions.tsx:70`, `ProjectPage.tsx:76`, `ProjectDayTimeline.tsx:115`

**Poprawka:** Wynieść do `@/lib/utils.ts`.

### 5.3 `PromptConfig` — 4 identyczne interfejsy

**Pliki:** `Applications.tsx:30`, `Sessions.tsx:62`, `ProjectPage.tsx:88`, `ProjectDayTimeline.tsx:70`

Identyczny interfejs `PromptConfig { title, initialValue, onConfirm, description? }` zdefiniowany w 4 plikach.

**Poprawka:** Wynieść do wspólnego pliku typów.

### 5.4 Date-range toolbar — zduplikowany JSX w 3+ stronach

**Pliki:** `Dashboard.tsx`, `Estimates.tsx`, `Sessions.tsx` (+ `TimeAnalysis.tsx` z własną wersją)

Prawie identyczny blok JSX: przyciski preset (today/week/month/all), nawigacja prev/next, wyświetlanie zakresu dat.

**Poprawka:** Wydzielić komponent `DateRangeToolbar`.

### 5.5 Nieużywane eksporty

| Plik | Eksport | Status |
|------|---------|--------|
| `src/lib/utils.ts:25` | `formatDurationLong` | Nigdzie nie importowany |
| `src/lib/utils.ts:32` | `formatHours` | Nigdzie nie importowany |
| `src/lib/tauri.ts:76` | `checkFileImported` | Nigdzie nie importowany |

**Poprawka:** Usunąć nieużywane eksporty.

### 5.6 `chart-animation.ts` — powtórzony disabled config

**Plik:** `src/lib/chart-animation.ts`, linie 32-58

Obiekt `{ isAnimationActive: false, animationDuration: 0, animationEasing: 'ease-out' }` powtórzony 4 razy w różnych branchach.

**Poprawka:** Wydzielić stałą `DISABLED_ANIMATION_CONFIG`.

### 5.7 Redundantna funkcja `createDefaultOnlineSyncState`

**Plik:** `src/lib/online-sync.ts`, linia 309-319

Robi dokładnie to samo co `{ ...DEFAULT_ONLINE_SYNC_STATE }`.

**Poprawka:** Zamienić na spread operatora.

---

## 6. Architektura i wzorce

### 6.1 `window.alert` / `window.confirm` zamiast własnych komponentów

**Pliki:** Applications, Projects, Sessions, ProjectPage, ProjectDayTimeline (~20+ wystąpień)

Natywne `window.alert()` i `window.confirm()` zamiast komponentów dialogów. Na `AI.tsx` używa się `useToast`, ale reszta app nie — niespójne UX.

**Sugestia:** Zamienić na `useToast` (showError/showInfo) dla powiadomień i dedykowany komponent dialog potwierdzenia dla akcji destrukcyjnych.

### 6.2 Nadmierny rozmiar plików stron

| Plik | Linie |
|------|------:|
| `Projects.tsx` | ~1873 |
| `ProjectPage.tsx` | ~1612 |
| `Settings.tsx` | ~1201 |
| `Sessions.tsx` | ~1201 |

**Sugestia:** Wydzielić logiczne sekcje do subkomponentów (np. `ProjectDialogs.tsx`, `SessionGroupView.tsx`, `SettingsSection*.tsx`).

### 6.3 Import w środku pliku

**Plik:** `src/pages/Dashboard.tsx`, linia 104

`import { TopProjectsList }` umieszczony między definicją `AutoImportBanner` a eksportem `Dashboard`. Reszta importów jest na górze pliku.

**Poprawka:** Przenieść import na górę pliku.

### 6.4 `dangerouslySetInnerHTML` na statycznych danych

**Plik:** `src/pages/QuickStart.tsx`, linia 154

`dangerouslySetInnerHTML={{ __html: step.desc }}` — dane są statyczne (nie user input), więc nie ma ryzyka XSS, ale to niepotrzebne użycie niebezpiecznego API.

**Poprawka:** Użyć komponentów React zamiast HTML stringa.

### 6.5 Niespójne mapowanie camelCase/snake_case w tauri.ts

**Plik:** `src/lib/tauri.ts`, linia 388-396

`updateDatabaseSettings` ręcznie mapuje camelCase → snake_case, podczas gdy reszta API tego nie robi. Niespójny wzorzec.

### 6.6 `user-settings.ts` — powtarzalny boilerplate

**Plik:** `src/lib/user-settings.ts`

Każdy typ ustawień (7 typów) ma prawie identyczną strukturę: `loadRawSetting` + sprawdzenie legacy + `JSON.parse` + normalizacja + try/catch. ~100 linii boilerplate na typ.

**Sugestia:** Generyczna funkcja `loadSettings<T>(key, legacyKey, normalizer, defaults)`.

---

## 7. Tłumaczenia (i18n)

### 7.1 Stan obecny

| Metryka | Wartość |
|---------|--------|
| System i18n | i18next + react-i18next (skonfigurowany) |
| Pliki locale | `en/common.json`, `pl/common.json` (11 kluczy) |
| Strony z `useTranslation` | 3 / 14 (Settings, Help, QuickStart) |
| Strony w pełni przetłumaczone | 0 / 14 |
| Strony całkowicie bez i18n | 11 / 14 |
| Szacowana liczba brakujących kluczy | ~400-500 |
| Pokrycie tłumaczeń | **~1%** |

### 7.2 Główne problemy

1. **Minimalne pokrycie** — system i18n jest skonfigurowany, ale użyty w marginalnym stopniu. 11 z 14 stron nie importuje nawet `useTranslation`.

2. **Niespójny mechanizm tłumaczeń** — `Help.tsx` i `QuickStart.tsx` unikają plików locale na rzecz inline'owej funkcji `t(pl, en)` opartej na `i18n.resolvedLanguage`. To obchodzi system i18next i utrudnia centralne zarządzanie tłumaczeniami.

3. **Komponenty bez tłumaczeń** — nawigacja w Sidebar, dialogi, formularze, komunikaty błędów, tooltips — wszystko hardcoded po angielsku.

### 7.3 Strony i komponenty z największą liczbą hardcoded strings

| Plik | Szacowana liczba stringów |
|------|:-------------------------:|
| `Projects.tsx` | 80+ |
| `AI.tsx` | 60+ |
| `ProjectPage.tsx` | 50+ |
| `Sessions.tsx` | 40+ |
| `Settings.tsx` | 40+ (poza sekcją Language) |
| `Applications.tsx` | 30+ |
| `DatabaseManagement.tsx` | 30+ |
| `Estimates.tsx` | 25+ |
| `DaemonControl.tsx` | 25+ |
| `ManualSessionDialog.tsx` | 20+ |
| `BugHunter.tsx` | 15+ |
| `Sidebar.tsx` | 15+ |
| `Help.tsx` | Inline `t(pl, en)` — ~200 stringów poza systemem i18n |
| `QuickStart.tsx` | Inline `t(pl, en)` — ~30 stringów poza systemem i18n |

---

## 8. Sugerowane działania — priorytetyzacja

### Priorytet 1 — natychmiast (krytyczne / szybkie wygrane)

| # | Akcja | Pliki | Nakład |
|---|-------|-------|--------|
| 1 | Usunąć `app-store.ts` (dead code) | 1 plik | 5 min |
| 2 | Dodać mutex na `runOnlineSyncOnce` | `online-sync.ts` | 15 min |
| 3 | Naprawić polski tekst w `ManualSessionDialog.tsx` | 1 plik | 5 min |
| 4 | Dodać `[triggerRefresh]` do dep array w `Dashboard.tsx:229` | 1 plik | 2 min |
| 5 | Zmienić `invoke` → `invokeMutation` dla 4 komend AI w `tauri.ts` | 1 plik | 5 min |
| 6 | Usunąć 3 nieużywane eksporty | 2 pliki | 5 min |

### Priorytet 2 — wkrótce (średnie / poprawa jakości)

| # | Akcja | Pliki | Nakład |
|---|-------|-------|--------|
| 7 | Wynieść `getErrorMessage` do utils | 4 pliki | 10 min |
| 8 | Wynieść `formatMultiplierLabel` do utils | 4 pliki | 10 min |
| 9 | Wynieść `PromptConfig` do wspólnego pliku | 5 plików | 10 min |
| 10 | Wydzielić `DateRangeToolbar` | 4+ pliki | 30 min |
| 11 | Zamienić `window.alert/confirm` na toast/dialog | 10+ plików | 1-2h |
| 12 | Dodać try/catch w `Applications.tsx` | 1 plik | 5 min |
| 13 | Naprawić side-effect w `loadOnlineSyncSettings` | 1 plik | 10 min |

### Priorytet 3 — planowane (refaktoring / architektura)

| # | Akcja | Pliki | Nakład |
|---|-------|-------|--------|
| 14 | Rozbić duże strony na subkomponenty | 4 pliki | 2-4h |
| 15 | Zunifikować polling (Sidebar + BackgroundServices) | 2 pliki | 1h |
| 16 | Generyczna funkcja `loadSettings<T>` | `user-settings.ts` | 30 min |
| 17 | Ujednolicić camelCase/snake_case w tauri.ts | 1 plik | 15 min |

### Priorytet 4 — backlog (i18n)

| # | Akcja | Nakład |
|---|-------|--------|
| 18 | Zunifikować mechanizm tłumaczeń (usunąć inline `t(pl,en)`, użyć kluczy i18next) | 2-3h |
| 19 | Dodać klucze dla nawigacji, wspólnych elementów UI, dialogów | 1-2 dni |
| 20 | Przetłumaczyć wszystkie strony (~400-500 kluczy) | 3-5 dni |

---

*Raport wygenerowany automatycznie na podstawie analizy kodu źródłowego.*
