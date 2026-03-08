# TIMEFLOW — Raport z analizy kodu

Data: 2026-03-08

---

## 1. NADMIAROWY / MARTWY KOD

### 1.1 Nieużywane eksporty w `tauri.ts`

Poniższe funkcje/typy są eksportowane z `dashboard/src/lib/tauri.ts`, ale **nigdzie nie są importowane** w kodzie frontendowym:

| Eksport | Linia | Opis |
|---|---|---|
| `getHourlyBreakdown` | 195 | Pobiera dane godzinowe — nigdzie nie używane |
| `getAppTimeline` | 216 | Timeline aplikacji — nigdzie nie używane |
| `getHeatmap` | 322 | Heatmapa — nigdzie nie używane |
| `getStackedTimeline` | 324 | Stacked timeline — nigdzie nie używane |
| `splitSession` | 501 | Stary podział sesji 2-stronny — zastąpiony przez `splitSessionMulti` |
| `suggestSessionSplit` | 523 | Sugestia podziału — nigdzie nie używane |
| `SplitSuggestion` (interfejs) | 514 | Typ dla powyższego — nigdzie nie używane |
| `exportDatabase` | 419 | Export DB do pliku — nigdzie nie używane (jest `exportData`/`exportDataArchive`) |

**Sugestia:** Usunąć martwe eksporty. Jeśli odpowiadające im komendy Rust też nie są nigdzie wywoływane, rozważyć usunięcie z backendu.

### 1.2 Zduplikowana logika inline tłumaczeń

Plik `Data.tsx` definiuje własną lokalna funkcję `t(pl, en)` (linia 12), zamiast użyć `useInlineT()` z `@/lib/inline-i18n`. Reszta aplikacji konsekwentnie używa `useInlineT()`.

**Sugestia:** Zamienić na `useInlineT()` dla spójności.

### 1.3 Help.tsx — własna implementacja tłumaczeń

`Help.tsx` definiuje własną lokalna funkcję `t(pl, en, interpolation?)` (linia 42–54) z obsługą interpolacji, zamiast użyć `useInlineT()`. Funkcja jest praktycznie identyczna z tą z `inline-i18n.ts`.

**Sugestia:** Przejść na `useInlineT()` i usunąć duplikat.

---

## 2. LOGIKA I POPRAWNOŚĆ

### 2.1 `inferPreset()` w `data-store.ts` — domyślny fallback

Linia 89: Gdy zakres dat nie pasuje do żadnego presetu (today/week/month/all), funkcja zwraca `'week'` jako fallback. Może to powodować, że po ręcznej zmianie zakresu dat nawigacja strzałkami (<>) nagle przeskoczy o 7 dni, co jest nieintuicyjne.

**Sugestia:** Rozważyć zwracanie `null` lub `'custom'` i wyłączanie strzałek nawigacji dla niestandardowych zakresów.

### 2.2 `useAutoSplitSessions` — wykrywanie splitów po komentarzu

`BackgroundServices.tsx` linia 217: `if ((session.comment ?? '').includes('Split')) continue;` — logika opiera się na obecności tekstu "Split" w komentarzu, co jest kruche (user może ręcznie dodać komentarz zawierający "Split").

**Sugestia:** Użyć dedykowanego pola (np. `split_source`) lub flagi zamiast parsowania komentarzy.

### 2.3 `useAutoSplitSessions` — brak throttlingu między iteracjami

Linia 216–234: Pętla `for (const session of sessions)` wykonuje `analyzeSessionProjects` i `splitSessionMulti` sekwencyjnie dla do 50 sesji bez żadnego throttlingu. Przy dużej liczbie niesplitowanych sesji może to zablokować backend na dłuższy czas.

**Sugestia:** Ograniczyć do mniejszego batcha lub dodać `await sleep(100)` między iteracjami.

### 2.4 `handleUpdateColor` w `Applications.tsx` — brak try/catch

Linia 182–186: `await updateAppColor(appId, color)` nie jest opakowane w try/catch. Błąd backendu spowoduje nieobsłużony wyjątek.

**Sugestia:** Dodać obsługę błędu z `showError()`.

### 2.5 `DaemonControl.tsx` — sleep 1500ms po akcji

Linia 95: `await new Promise((r) => setTimeout(r, 1500))` po start/stop/restart demona. Jest to sztywny delay zamiast pollingu statusu.

**Sugestia:** Zamiast stałego delaya, odpytywać status co 300ms do czasu zmiany lub timeout 5s.

---

## 3. WYDAJNOŚĆ

### 3.1 Dashboard.tsx — 4 oddzielne useEffect z osobnymi zapytaniami

`Dashboard.tsx` ma 4 osobne hooki `useEffect` (linie 287, 315, 333, 353), z których każdy odpala osobne zapytania do backendu. Część z nich mogłaby być połączona w jedno `Promise.allSettled()`.

**Sugestia:** Połączyć efekty z tymi samymi zależnościami (`[dateRange, refreshKey]`) w jeden.

### 3.2 `useJobPool` — trzy timery uruchamiane co 5s

`BackgroundServices.tsx`: Job pool tickuje co 5s (`JOB_LOOP_TICK_MS = 5000`) i wewnątrz odpala `refreshToday()` co 30s oraz `checkFileChange()` co 5s. Sygnatura pliku jest sprawdzana przy każdym ticku, co jest OK, ale `refreshToday()` co 30s wywołuje `invokeMutation` (emituje `localDataChanged`), co triggeruje dalsze efekty uboczne w kaskadzie.

**Sugestia:** Rozważyć zwiększenie interwału `refreshToday` do 60s lub sprawdzanie sygnatury pliku przed wywołaniem refresh (skip jeśli się nie zmieniła).

### 3.3 `Sessions.tsx` — ładowanie score breakdown na żądanie bez cache

Każde kliknięcie w score breakdown wywołuje `getSessionScoreBreakdown()`. Dane są cache'owane w `aiBreakdowns` Map, ale mapa jest tworzona w `useState` i resetowana przy każdym przeładowaniu sesji. Przy częstym nawigowaniu między stronami te same dane są pobierane wielokrotnie.

**Sugestia:** Przenieść cache do `useRef` lub osobnego store'a, z TTL ~5 minut.

### 3.4 `Applications.tsx` — brak wirtualizacji tabeli

Tabela aplikacji nie używa wirtualizacji (w przeciwieństwie do `Sessions.tsx` która używa `Virtuoso`). Przy dużej liczbie aplikacji (>100) może to wpłynąć na wydajność.

**Sugestia:** Dodać `Virtuoso` lub ograniczyć widoczne wiersze z paginacją.

### 3.5 `Reports.tsx` — brak memoizacji `getSectionDef`

Linia 338: `getSectionDef` tworzy nowe closure przy każdym renderze i jest wywoływane w pętli `activeIds.map()`.

**Sugestia:** Zamienić na `useMemo` z mapą `id → SectionDef`.

---

## 4. BRAKUJĄCE TŁUMACZENIA

### 4.1 Hardcodowane stringi polskie/angielskie (inline `t()`) vs system i18n

Aplikacja używa dwóch systemów tłumaczeń:
1. **react-i18next** (`useTranslation`) z plikami `.json` — używane w części komponentów
2. **inline `t(pl, en)`** (`useInlineT`) — używane w pozostałych

To powoduje:
- Tłumaczenia w plikach `.json` są częściowo nieaktualne (np. usunięte klucze kciuków wciąż mogą mieć referencje)
- Stringi inline **nie są ekstrakowalne** do plików tłumaczeń dla zewnętrznych tłumaczy
- Baseline plik `check-hardcoded-i18n-baseline.json` próbuje śledzić hardcodowane stringi, ale lista rośnie

**Sugestia:** Uzgodnić jeden system. Jeśli inline `t(pl, en)` jest docelowy — usunąć nieużywane klucze z `.json`. Jeśli `.json` jest docelowy — migrować inline stringi.

### 4.2 Konkretne brakujące tłumaczenia w plikach `.json`

Poniższe stringi są używane inline i nie mają odpowiedników w plikach locale:

- `Applications.tsx`: "monitorowana" / "monitored", "Importowana" / "Imported"
- `Estimates.tsx`: wiele stringów (Łączne godziny, Wartość estymowana, Aktywne projekty, itd.)
- `DaemonControl.tsx`: wszystkie stringi (Status demona, Uruchomiony, Zatrzymany, itd.)
- `TimeAnalysis.tsx`: wszystkie stringi (Dzisiaj, Tydzień, Miesiąc, itd.)
- `Reports.tsx`: wszystkie stringi (Edytor szablonów raportów, Aktywne sekcje, itd.)
- `ImportPage.tsx`: wszystkie stringi (Zaimportowane pliki, Archiwum, itd.)
- `Data.tsx`: "Wymiana danych", "System i baza danych"

Te stringi działają poprawnie (system inline zwraca poprawny tekst w obu językach), ale nie są dostępne w plikach locale.

---

## 5. BRAKUJĄCA DOKUMENTACJA W HELP.TSX

### 5.1 Funkcje obecne w UI, ale nieopisane w Help

| Funkcja | Moduł | Status w Help |
|---|---|---|
| **Import JSON / archiwum** | Data → ImportPage | Wymieniony ogólnie, brak opisu archiwum |
| **Sesje manualne** | Dashboard / ProjectPage | Brak opisu w sekcji Dashboard ani Sessions |
| **Mnożniki stawek (boost)** | ProjectPage / Sessions | Brak opisu w sekcji Sessions |
| **Komentarze do sesji** | ProjectPage / Sessions | Brak opisu |
| **Podział sesji (split)** | Sessions (ikona nożyczek) | Brak opisu w Help |
| **Auto-split sesji** | Settings (Split) | Brak opisu auto-split w Help |
| **Synchronizacja online** | Settings (Online Sync) | Brak opisu w sekcji Settings |
| **Demo mode** | Settings | Brak opisu w Help |
| **Backup/Restore bazy** | Data → DatabaseManagement | Brak szczegółowego opisu |
| **Kompakcja danych projektu** | ProjectPage | Brak opisu |
| **Eksport raportu projektu** | ProjectPage → ReportView | Brak opisu w Help |
| **Szybki start (QuickStart)** | QuickStart page | Brak opisu w Help (jest link, ale nie opis samego procesu) |
| **Edytor szablonów raportów** | Reports | Sekcja Help "Raporty" istnieje, ale **nie opisuje edytora szablonów** (sekcje, font, logo, duplikacja) |
| **Foldery projektów** | Projects | Brak opisu skanowania folderów |
| **Auto-freeze projektów** | Projects / Settings | Brak opisu |
| **BugHunter** | Layout (komponent) | Brak opisu |

---

## 6. SUGEROWANE OPTYMALIZACJE

### 6.1 Architektura — wiele oddzielnych `loadXxxSettings()` z localStorage

Każda strona osobno wywołuje `loadIndicatorSettings()`, `loadSessionSettings()`, `loadSplitSettings()` itp. na mount. Nie ma współdzielonego cache — te same dane są parsowane wielokrotnie.

**Sugestia:** Przenieść ustawienia do zustand store'a (jak `useSettingsStore` dla currency/animations) i ładować raz przy starcie.

### 6.2 `ProjectPage.tsx` — bardzo duży komponent (~1500+ linii)

Plik łączy: info projektu, sesje, timeline, estymacje, ręczne sesje, kontekst menu, dialogi, boost, komentarze, kompakcję.

**Sugestia:** Wydzielić logiczne sekcje do podkomponentów (np. `ProjectSessions`, `ProjectTimeline`, `ProjectEstimates`).

### 6.3 `Sessions.tsx` — podobnie duży (~1600+ linii)

**Sugestia:** Wydzielić kontekst menu, toolbar filtrów i logikę AI breakdowns do osobnych hooków/komponentów.

### 6.4 `AI.tsx` — duży komponent z wieloma obowiązkami

Łączy: status modelu, metryki, parametry, trening, auto-safe, blacklisty, wskaźniki sesji, feedback weight.

**Sugestia:** Wydzielić sekcje do osobnych kart/komponentów.

### 6.5 `Settings.tsx` — jeden monolityczny komponent

**Sugestia:** Podział na sekcje (Working Hours, Sessions, Currency, Language, Freeze, Split, Sync, DemoMode, DangerZone).

---

## 7. POTENCJALNE PROBLEMY

### 7.1 Race condition w `useJobPool` — overlap refresh/sync

`runRefresh()` i `runSync()` mogą się nakładać, bo oba są wywoływane asynchronicznie z tego samego intervalu. Nie ma guard'a zapobiegającego jednoczesnemu wykonaniu.

**Sugestia:** Dodać flagę `isRefreshing` / `isSyncing` analogicznie do `heavyOperations` w `BackgroundServices`.

### 7.2 `HourlyBreakdown` import w `tauri.ts` ale brak komponentu

Typ `HourlyData` jest importowany i `getHourlyBreakdown` jest eksportowane, ale `HourlyBreakdown.tsx` komponent importuje dane z innego źródła.

**Sugestia:** Zweryfikować, czy `HourlyBreakdown.tsx` faktycznie używa `getHourlyBreakdown` — jeśli nie, usunąć martwy eksport.

### 7.3 `window.localStorage` bez fallbacku w `user-settings.ts`

Funkcje ładowania ustawień obsługują `typeof window === 'undefined'` (SSR), ale nie obsługują sytuacji gdy localStorage jest pełny (`QuotaExceededError`). Save rzuci wyjątek.

**Sugestia:** Owinąć `localStorage.setItem` w try/catch w metodzie `save`.

---

## 8. BEZPIECZEŃSTWO

### 8.1 SQL injection w `settings.rs` — `export_database`

`src-tauri/src/commands/settings.rs` linia ~307: Funkcja `export_database` przyjmuje ścieżkę pliku od użytkownika i wstawia ją bezpośrednio do komendy SQL (`VACUUM INTO`). Jeśli ścieżka zawiera znaki specjalne SQL (np. `'; DROP TABLE ...`), może to prowadzić do SQL injection.

**Sugestia:** Użyć parametryzowanego zapytania lub walidacji/escapowania ścieżki przed wstawieniem do SQL.

**Priorytet: KRYTYCZNY**

---

## 9. BACKEND RUST — DODATKOWE PROBLEMY

### 9.1 N+1 queries w `sessions.rs` — `analyze_sessions_splittable`

`src-tauri/src/commands/sessions.rs` linia ~1654: Funkcja iteruje po sesjach i dla każdej wykonuje osobne zapytanie. Przy dużej liczbie sesji generuje to N+1 zapytań do bazy.

**Sugestia:** Pobrać wszystkie potrzebne dane jednym zapytaniem z JOIN lub subquery i przetwarzać w pamięci.

### 9.2 Brak transakcji w `projects.rs` — `exclude_project` / `delete_project`

`src-tauri/src/commands/projects.rs` linia ~739: Operacje `exclude_project` i `delete_project` wykonują wiele kroków (usunięcie sesji, usunięcie projektu, aktualizacja referencji) bez owinięcia w transakcję. Przerwanie w połowie może zostawić bazę w niespójnym stanie.

**Sugestia:** Owinąć w `BEGIN/COMMIT` transakcję.

### 9.3 Kruche indeksy kolumn w `analysis.rs`

`src-tauri/src/commands/analysis.rs` linia ~173: Kod odwołuje się do kolumn wynikowych po indeksie numerycznym (np. `row.get(0)`, `row.get(3)`) zamiast po nazwie. Zmiana kolejności kolumn w SELECT spowoduje ciche błędy danych.

**Sugestia:** Używać `row.get("column_name")` lub zdefiniować struktury deserializacji.

### 9.4 `report.rs` — sekwencyjne zapytania

Backend raportów wykonuje 4 kosztowne zapytania sekwencyjnie. Mogłyby być wykonane równolegle (np. `tokio::join!`), co skróciłoby czas generowania raportu.

---

## 10. FRONTEND — DODATKOWE PROBLEMY

### 10.1 `Sessions.tsx:273` — `splitSettings` odtwarzane co render

`splitSettings` jest tworzone przy każdym renderze komponentu (wywołanie `loadSplitSettings()` w ciele komponentu, poza hookiem). Powinno być w `useState` z lazy initializer lub `useMemo`.

### 10.2 `Sessions.tsx:876` — błąd kolejności `.catch().then()` w `loadScoreBreakdown`

Funkcja `loadScoreBreakdown` ma `.catch(() => null).then(data => ...)` — `.catch` zwraca `null`, a `.then` nadal się wykonuje z `data = null`, co powoduje trwałe cache'owanie pustego breakdown. Powinno być `.then().catch()` lub `try/catch` w `async` funkcji.

**Priorytet: WYSOKI** — bug powoduje, że po jednym błędzie sieci breakdown jest już na zawsze pusty (do przeładowania strony).

### 10.3 `Sessions.tsx:561` — auto-refresh działa gdy strona niewidoczna

15-sekundowy interwał odświeżania działa nawet gdy komponent nie jest aktywny (użytkownik przeszedł na inną zakładkę). Generuje niepotrzebne zapytania do backendu.

**Sugestia:** Dodać `document.visibilityState` check lub `usePageVisibility` hook.

### 10.4 `ProjectPage.tsx` — race condition w `fetchAllSessions`

`fetchAllSessions` nie ma mechanizmu anulowania. Szybka zmiana projektu może spowodować, że odpowiedź ze starego zapytania nadpisze dane nowego projektu.

**Sugestia:** Użyć `AbortController` lub flagi `isCancelled` w cleanup `useEffect`.

### 10.5 Race condition: `useAutoSplitSessions` vs `useAutoAiAssignment`

W `BackgroundServices.tsx` oba hooki operują na tych samych sesjach bez koordynacji. Auto-split może podzielić sesję w trakcie gdy auto-AI-assignment ją przetwarza, co prowadzi do niespójności.

**Sugestia:** Dodać współdzielony mutex/semafor lub sekwencyjne wykonanie (split → assign).

---

## 11. PODSUMOWANIE PRIORYTETÓW

| Priorytet | Zakres | Opis |
|---|---|---|
| **KRYTYCZNY** | Bezpieczeństwo | SQL injection w `export_database` (settings.rs) |
| **Wysoki** | Bug | `.catch().then()` kolejność w Sessions.tsx — trwale cache'uje pusty breakdown |
| **Wysoki** | Backend | Brak transakcji w delete/exclude project — ryzyko niespójności bazy |
| **Wysoki** | Backend | N+1 queries w `analyze_sessions_splittable` |
| **Wysoki** | Help.tsx | Dodać opisy brakujących funkcji (split, sesje manualne, boost, sync, raporty) |
| **Wysoki** | Martwy kod | Usunąć nieużywane eksporty z `tauri.ts` |
| **Średni** | Race condition | `fetchAllSessions` bez cancellation, auto-split vs auto-assign overlap |
| **Średni** | Wydajność | Połączyć useEffect w Dashboard, splitSettings co render, refresh gdy niewidoczny |
| **Średni** | Tłumaczenia | Uzgodnić system (inline vs json) i usunąć zduplikowane/nieużywane klucze |
| **Niski** | Refaktoring | Wydzielić podkomponenty z dużych plików (ProjectPage, Sessions, AI, Settings) |
| **Niski** | UX | Naprawić `inferPreset` fallback, poprawić DaemonControl delay |

---

*Raport wygenerowany na podstawie analizy kodu źródłowego projektu TIMEFLOW.*

---

## 12. STATUS WDROŻENIA (aktualizacja: 2026-03-08)

### 12.1 Zrobione

- **1.1** Usunięto martwe eksporty z `dashboard/src/lib/tauri.ts` (`getHourlyBreakdown`, `getAppTimeline`, `getHeatmap`, `getStackedTimeline`, `splitSession`, `suggestSessionSplit`, `SplitSuggestion`, `exportDatabase`).
- **1.2** `Data.tsx` przełączono z lokalnego `t(pl, en)` na wspólny mechanizm i18n.
- **1.3** `Help.tsx` przełączono na `useInlineT()` (usunięto lokalny duplikat tłumaczenia).
- **2.1** `inferPreset()` ma fallback `custom` (zamiast `week`), a strzałki nawigacji są wyłączone dla custom range.
- **2.2** Wykrywanie splitów przeniesione na dedykowane pole `split_source_session_id` (DB + backend + frontend). Dodano backfill legacy wpisów.
- **2.3** Dodano throttling w `useAutoSplitSessions` (`sleep` między iteracjami).
- **2.4** `handleUpdateColor` w `Applications.tsx` ma `try/catch` + `showError`.
- **2.5** `DaemonControl.tsx`: usunięto stały `sleep(1500)` na rzecz pollingu statusu (300ms, timeout 5s).
- **3.2** `useJobPool`: zwiększono interwał `refreshToday` do 60s oraz dodano guardy przed nakładaniem `refresh/sync`.
- **3.1** `Dashboard.tsx`: główne zapytania (stats/top/projects/timeline/sessions/manual/working-hours) skonsolidowane do jednego efektu i jednego `Promise.allSettled()`.
- **3.3** `Sessions.tsx`: cache score breakdown przeniesiony do `useRef` + TTL 5 minut.
- **3.4** `Applications.tsx`: dodano ograniczenie renderu listy (przycisk „Load more” / paginacja przyrostowa).
- **3.5** `Reports.tsx`: `getSectionDef` zmemoizowane przez mapę `id -> SectionDef`.
- **7.1** Race condition `useJobPool` ograniczony guardami `isRefreshing` / `isSyncing`.
- **7.2** Powiązany martwy kod timeline/hourly usunięty po stronie frontu (`tauri.ts`).
- **7.3** `user-settings.ts`: `localStorage.setItem` owinięte w `try/catch`.
- **6.1** `user-settings.ts`: dodano cache in-memory dla `loadXxxSettings()`, żeby nie parsować localStorage przy każdym odczycie.
- **8.1 (KRYTYCZNY)** Naprawiono SQL injection w `export_database` (`settings.rs`) przez bezpieczne quoting ścieżki (`SELECT quote(?1)`).
- **9.1** `sessions.rs`: `analyze_sessions_splittable` przerobione z N+1 na batch SQL.
- **9.2** `projects.rs`: `exclude_project` i `delete_project` działają w transakcjach.
- **9.3** `analysis.rs`: odczyt kolumn po nazwach zamiast indeksów.
- **9.4** `report.rs`: zapytania wykonywane równolegle (spawn + join wyników).
- **10.1** `Sessions.tsx`: `splitSettings` nie jest odtwarzane przy każdym renderze.
- **10.2 (WYSOKI)** Naprawiono kolejność obsługi błędu w `loadScoreBreakdown` (brak trwałego cache pustego wyniku po błędzie).
- **10.3** `Sessions.tsx`: auto-refresh pomija niewidoczną kartę (`document.visibilityState`).
- **10.4** `ProjectPage.tsx`: dodano cancellation guard dla asynchronicznego ładowania.
- **10.5** Ograniczono konflikt `useAutoSplitSessions` vs `useAutoAiAssignment` (wspólny klucz heavy-operation).
- **4.2** Dokończono migrację wskazanych ekranów do kluczy i18n (`Data.tsx`, `ImportPage.tsx`, `TimeAnalysis.tsx`, `DaemonControl.tsx`, `Applications.tsx`, `Estimates.tsx`, `Reports.tsx`) oraz dopisano sekcje locale: `data_page`, `import_page`, `time_analysis_page`, `daemon_page`, `applications_page`, `estimates_page`, `reports_page` (PL/EN).

### 12.2 Częściowo zrobione

- **4.1** Spójność systemu i18n poprawiona (kolejne ekrany migrowane na klucze), ale pełna unifikacja całej aplikacji nadal trwa.
- **5.1** Help został szeroko uzupełniony; zalecany okresowy audyt po dodaniu nowych funkcji.

### 12.3 Pozostało do zrobienia

- **6.2** Refaktor `ProjectPage.tsx` na mniejsze podkomponenty.
- **6.3** Refaktor `Sessions.tsx` na mniejsze podkomponenty/hooki.
- **6.4** Refaktor `AI.tsx` na sekcje.
- **6.5** Refaktor `Settings.tsx` na sekcje.

### 12.4 Status priorytetów (po wdrożeniu)

- **KRYTYCZNY:** SQL injection `export_database` — **zamknięte**.
- **WYSOKI:** bug `.catch().then()` w `Sessions.tsx` — **zamknięte**.
- **WYSOKI:** transakcje `delete/exclude project` — **zamknięte**.
- **WYSOKI:** N+1 `analyze_sessions_splittable` — **zamknięte**.
- **WYSOKI:** martwy kod eksportów w `tauri.ts` — **zamknięte**.
- **WYSOKI:** dokumentacja Help — **w większości zamknięte**.
- **ŚREDNI:** migracja brakujących tłumaczeń z listy 4.2 — **zamknięte**.
