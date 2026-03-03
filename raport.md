# TIMEFLOW — Raport analizy kodu
*Data: 2026-03-03 | Wersja analizy: kompletna*

---

## Spis treści
1. [Podsumowanie wykonawcze](#1-podsumowanie-wykonawcze)
2. [Logika — błędy i problemy](#2-logika--błędy-i-problemy)
3. [Wydajność — problemy i optymalizacje](#3-wydajność--problemy-i-optymalizacje)
4. [Nadmiarowy kod i duplikacje](#4-nadmiarowy-kod-i-duplikacje)
5. [Brakujące tłumaczenia i i18n](#5-brakujące-tłumaczenia-i-i18n)
6. [Bezpieczeństwo](#6-bezpieczeństwo)
7. [Architektura AI — ocena i sugestie](#7-architektura-ai--ocena-i-sugestie)
8. [Sugestie priorytetowe](#8-sugestie-priorytetowe)

---

## 1. Podsumowanie wykonawcze

Aplikacja działa poprawnie i ma solidną architekturę (Tauri + React + SQLite + Rust). Kod jest ogólnie czytelny, ale zawiera kilka istotnych problemów logicznych i wydajnościowych. Największe ryzyka to:

- **Brakujące debounce** na wyszukiwaniu i auto-odświeżaniu powodują zbędne zapytania do DB
- **N+1 query pattern** w AI score prefetch dla sesji
- **Mieszany system i18n** — `useInlineT()` oznaczony jako `@deprecated` wciąż dominuje w kluczowych stronach
- **Puste date range** `2100-01-01` używane jako "nieskończoność" to hack, który może powodować problemy przy filtrowaniu
- **Model AI** ma poprawną architekturę, ale confidence formula ma istotny problem

---

> **Uwaga:** Raport łączy dwie niezależne analizy dla pełnego pokrycia.

---

## 2. Logika — błędy i problemy

### 2.1 KRYTYCZNY: Błąd w formule confidence modelu AI

**Plik:** `dashboard/src-tauri/src/commands/assignment_model.rs:500–504`

```rust
let evidence_factor = ((evidence_count as f64) / 3.0).min(1.0);
let sigmoid_margin = 1.0 / (1.0 + (-margin).exp());
let confidence = sigmoid_margin * evidence_factor;
```

**Problem:** Gdy `evidence_count = 1` (co jest często, szczególnie dla nowych projektów), `evidence_factor = 0.33`, więc nawet przy marginesie 1.0 maksymalna confidence wynosi tylko ~0.33. Przy domyślnym progu `suggest = 0.60` model **nigdy nie zasugeruje projektu** jeśli ma tylko 1 dowód.

**Skutek:** Model przy małej liczbie danych jest zbyt zachowawczy. Użytkownik widzi "brak sugestii" mimo że dane są wystarczające.

**Sugestia:** Rozważyć addytywną formułę lub zmianę evidence_factor na miękkie skalowanie (np. `0.5 + 0.5 * (1 - exp(-evidence/3))`).

---

### 2.2 POWAŻNY: Race condition w Sessions.tsx — auto-odświeżanie nadpisuje dane

**Plik:** `dashboard/src/pages/Sessions.tsx:296–315`

```ts
// Auto-refresh sessions every 15 seconds
useEffect(() => {
  const interval = setInterval(() => {
    getSessions({ ... }).then((data) => setSessions(data))
    ...
  }, 15_000);
```

**Problem:** Auto-odświeżanie co 15s może nadpisać stan sesji w trakcie, gdy użytkownik otworzył context menu lub modyfikuje sesję. Brak anulacji poprzedniego requestu (AbortController), brak blokady gdy coś jest w toku.

**Sugestia:** Dodać `useRef` flagę `isMutating` i pomijać auto-refresh gdy flag jest ustawiona.

---

### 2.3 Auto-freeze nowych projektów (już naprawione)

**Plik:** `dashboard/src-tauri/src/commands/projects.rs:533`
Poprawka dodana w tym samym dniu — warunek `julianday('now') - julianday(created_at) >= threshold_days`.

---

### 2.4 POWAŻNY: Sessions.tsx — ignorowane błędy ładowania

**Plik:** `dashboard/src/pages/Sessions.tsx:212–230`

```ts
getSessions({ ... })
  .then((data) => { setSessions(data); setHasMore(data.length >= PAGE_SIZE); })
  .catch(console.error);  // ← tylko log, brak feedback dla użytkownika
```

**Problem:** Błąd ładowania sesji jest cicho logowany. Użytkownik widzi pustą listę bez żadnego komunikatu błędu.

**Sugestia:** Dodać stan `error` i wyświetlić komunikat w UI.

---

### 2.5 Data range "2100-01-01" jako nieskończoność

**Pliki:** `Projects.tsx:307`, `Projects.tsx:361`

```ts
getDetectedProjects({ start: '2020-01-01', end: '2100-01-01' })
getProjectEstimates({ start: '2020-01-01', end: '2100-01-01' })
```

**Problem:** Hardcodowana data w przyszłości jako "all time" to hack. Jeśli zapis daty w DB używa ISO8601 z timezone, filtr `<= '2100-01-01'` może zachować się niepoprawnie przy datach z UTC-offset.

**Sugestia:** Dodać stałą `ALL_TIME_RANGE = { start: '2020-01-01', end: '2099-12-31' }` lub lepiej — obsłużyć `null` jako "bez limitu" po stronie Rust.

---

### 2.6 Dashboard.tsx — `loadSessionSettings()` wywołane wewnątrz efektu bez memoizacji

**Plik:** `dashboard/src/pages/Dashboard.tsx:267`

```ts
minDuration: loadSessionSettings().minSessionDurationSeconds || undefined,
```

Wywołane przy każdym renderze efektu, ale odczytuje z `localStorage`. Przy częstych refreshKey zmianach generuje zbędny odczyt. Identyczny problem w `Sessions.tsx:138–142` (już zmemoizowany poprawnie) — warto ujednolicić podejście.

---

### 2.7 useEffect w Projects.tsx — getProjectEstimates wywołane zagnieżdżone

**Plik:** `dashboard/src/pages/Projects.tsx:361–369`

```ts
Promise.allSettled([...]).then(([...]) => {
  // ...
  getProjectEstimates(...)  // ← wywołane w .then() zamiast razem z allSettled
    .then(...)
    .catch(console.error);
});
```

**Problem:** `getProjectEstimates` jest wywoływany dopiero po zakończeniu `allSettled`, co wydłuża całkowity czas ładowania strony. Powinien być w tablicy `allSettled`.

---

### 2.8 AI.tsx — `buildTrainingReminder` używa literałów PL/EN zamiast i18n

**Plik:** `dashboard/src/pages/AI.tsx:81–141`

Funkcja `buildTrainingReminder` przyjmuje `translate?` jako parametr, ale sam jej sygnatura i wywołania w środku używają inline PL/EN par. Oznacza to, że gdy `translate` jest `undefined`, zawsze zwraca angielski tekst.

---

### 2.9 Projects.tsx — `isNewProject` oblicza Date.now() wielokrotnie

**Plik:** `dashboard/src/pages/Projects.tsx:431–434`

```ts
const isNewProject = (created_at: string) => {
  const age = Date.now() - new Date(created_at).getTime();
  return age < 7 * 24 * 60 * 60 * 1000;
};
```

Zdefiniowana wewnątrz komponentu — tworzona na nowo przy każdym renderze. Powinna być `useCallback` lub funkcją pomocniczą poza komponentem.

---

### 2.10 window.prompt() zamiast PromptModal — 3 miejsca

**Pliki:**

- `Sessions.tsx:393` — boost comment prompt
- `ProjectPage.tsx:417` — `"Boost requires a comment. Enter a comment for ${label}:"` (hardcoded EN)
- `ProjectDayTimeline.tsx:387-388` — `"this session"` / `"${count} sessions in this chunk"` (hardcoded EN)

**Problem:** Natywny `window.prompt()` nie jest stylizowany, nie wspiera i18n, i działa inaczej niż reszta UI. Projekt już posiada gotowy `<PromptModal>` — powinien być użyty.

---

### 2.11 Data.tsx — własna implementacja t() poza i18next

**Plik:** `dashboard/src/pages/Data.tsx:12`

```ts
const t = (pl: string, en: string) => (lang === "pl" ? pl : en);
```

Własna funkcja tłumaczenia zamiast `useTranslation()` — niezgodna z systemem i18n, nie wspiera interpolacji, nie korzysta z `common.json`.

---

## 3. Wydajność — problemy i optymalizacje

### 3.1 KRYTYCZNY: N+1 query w prefetch AI breakdown

**Plik:** `dashboard/src/pages/Sessions.tsx:240–294`

```ts
const promises = sessions.map(async (s) => {
  const data = await getSessionScoreBreakdown(s.id);  // ← jedno zapytanie na sesję!
  ...
});
await Promise.allSettled(promises);
```

Dla 100 sesji (PAGE_SIZE=100) generuje 100 równoległych zapytań Tauri → SQLite. Choć są wykonywane równolegle przez `Promise.allSettled`, obciąża to wątek Rust i SQLite connection pool.

**Sugestia:** Dodać Rust command `get_sessions_score_breakdowns(ids: Vec<i64>)` zwracający batch wyników.

---

### 3.2 POWAŻNY: Brak debounce na wyszukiwaniu projektów

**Plik:** `dashboard/src/pages/Projects.tsx:204`

```ts
const [search, setSearch] = useState('');
```

Wyszukiwanie jest filtrowane po stronie frontu (useMemo), ale brak debounce oznacza ciągłe przeliczanie przy każdym keystroke. Przy >500 projektach to odczuwalny koszt.

---

### 3.3 Projects.tsx — `hotProjectIds` re-sortuje cały array projektów przy każdym renderze

**Plik:** `dashboard/src/pages/Projects.tsx:293–298`

```ts
const hotProjectIds = useMemo(() => {
  return [...projects]
    .sort((a, b) => b.total_seconds - a.total_seconds)
    .slice(0, 5)
    .map((p) => p.id);
}, [projects]);
```

To poprawne użycie `useMemo`, ale sortowanie wszystkich projektów dla wyznaczenia top-5 to O(n log n) zamiast O(n). Można zastąpić algorytmem selekcji k-największych.

---

### 3.4 retrain_model_sync — pełne załadowanie `file_activities` do pamięci

**Plik:** `dashboard/src-tauri/src/commands/assignment_model.rs:799–810`

```rust
let mut file_stmt = tx.prepare(
    "SELECT file_name, project_id FROM file_activities WHERE project_id IS NOT NULL",
)?;
```

Przy dużych bazach (tysiące wpisów file_activities) całość jest ładowana do pamięci RAM w `HashMap<(String, i64), i64>`. Nie ma limitu ani paginacji.

**Sugestia:** Przetworzyć tokenizację po stronie SQL (np. ograniczyć do ostatnich N dni aktywności).

---

### 3.5 assign_sessions wysyła N osobnych requestów Tauri

**Plik:** `dashboard/src/hooks/useSessionActions.ts:48–54`

```ts
await Promise.all(
  sessionIds.map((sessionId) =>
    assignSessionToProject(sessionId, projectId, source),
  ),
);
```

Każde przypisanie to osobny Tauri IPC call → osobna transakcja SQLite. Przy bulk-assign (np. przypisaniu całej grupy sesji) to N transakcji zamiast 1.

**Sugestia:** Dodać `assign_sessions_bulk(ids: Vec<i64>, project_id: Option<i64>)` na poziomie Rust.

---

### 3.6 Dashboard.tsx — 7 równoległych zapytań na każdy `refreshKey`

**Plik:** `dashboard/src/pages/Dashboard.tsx:250–274`

```ts
Promise.allSettled([
  getDashboardStats(dateRange),
  getProjects(),
  getTopProjects(dateRange, 5),
  getDashboardProjects(dateRange),
  getProjectTimeline(...),
  getSessions(...),
  getManualSessions(...),
])
```

To poprawny pattern (allSettled), ale warto sprawdzić czy `getProjects()` nie jest też wywoływane w innych komponentach renderowanych na dashboardzie (duplicate fetch).

---

### 3.7 check_manual_override — 2 osobne zapytania SQLite per sesja

**Plik:** `dashboard/src-tauri/src/commands/assignment_model.rs:193–249`

Funkcja wykonuje 2 zapytania: najpierw pobiera metadane sesji, potem szuka override. Te 2 można połączyć w 1 JOIN.

---

## 4. Nadmiarowy kod i duplikacje

### 4.1 `renderDuration` vs `formatDuration` — dwie implementacje

**Pliki:** `dashboard/src/pages/Projects.tsx:113–153`, `dashboard/src/lib/utils.ts`

`renderDuration` w Projects.tsx to specjalna JSX-owa wersja z jednostkami jako sub-spanami. `formatDuration` w utils.ts zwraca string. Obie są potrzebne w różnych kontekstach, ale warto to udokumentować.

---

### 4.2 Storage keys rozrzucone po komponentach

Stałe localStorage zdefiniowane inline w komponentach:
- `Projects.tsx:194` — `VIEW_MODE_STORAGE_KEY`
- `Projects.tsx:209` — `SORT_STORAGE_KEY`
- `Projects.tsx:214` — `FOLDERS_STORAGE_KEY`
- `Projects.tsx:219` — `SECTION_STORAGE_KEY`
- `ProjectDayTimeline.tsx:75` — `TIMELINE_SORT_STORAGE_KEY`
- `AI.tsx:38` — `AUTO_LIMIT_STORAGE_KEY`

**Sugestia:** Przenieść wszystkie storage keys do `user-settings.ts` lub osobnego `storage-keys.ts`.

---

### 4.3 Wzorzec `persist*` powtarzany wielokrotnie

`persistSectionOpen`, `saveViewMode`, `saveSortBy` — każdy to wariant tego samego wzorca `localStorage.setItem(key, JSON.stringify(value))`. Można wydzielić ogólny hook `useLocalStorage<T>(key, defaultValue)`.

---

### 4.4 `VIEW_MODE_STORAGE_KEY` stała zdefiniowana wewnątrz funkcji komponentu

**Plik:** `dashboard/src/pages/Projects.tsx:194`

```ts
const VIEW_MODE_STORAGE_KEY = 'timeflow-dashboard-projects-view-mode';
```

Stała zdefiniowana wewnątrz ciała komponentu — tworzona na nowo przy każdym renderze. Powinna być na poziomie modułu.

---

### 4.5 Zduplikowana logika date range w `data-store.ts`

`inferPreset` i `presetToRange` działają na zasadzie "jaka data odpowiada jakiemu presetowi". Przy zmianie logiki (np. "tydzień" = 5 dni roboczych) trzeba modyfikować obie funkcje symetrycznie.

---

### 4.6 Zakomentowany kod w sessions.rs

**Plik:** `dashboard/src-tauri/src/commands/sessions.rs`

Sprawdzić czy są zakomentowane fragmenty (CREATE TABLE w runtime — linia 46–62) — tabela `session_manual_overrides` jest tworzona przy każdym wywołaniu `upsert_manual_session_override`. Powinno to być w migracji DB, nie w kodzie operacyjnym.

---

### 4.7 `formatDateTime` w AI.tsx — lokalna funkcja

**Plik:** `dashboard/src/pages/AI.tsx:63–68`

```ts
function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}
```

Lokalna utility bez i18n (używa `toLocaleString()` bez locale). Powinna używać `date-fns` z locale lub być w utils.ts.

---

## 5. Brakujące tłumaczenia i i18n

### 5.1 Stan systemu i18n

Aplikacja używa **dwóch systemów równolegle**:
1. **Właściwy i18n** — `useTranslation()` + `common.json` (nowoczesny)
2. **Inline i18n** — `useInlineT()` / `tt('PL', 'EN')` + `inline.*` klucze w JSON (legacy, oznaczony `@deprecated`)

System inline jest akceptowalny jako mostek migracyjny, ale **AI.tsx, Settings.tsx, Projects.tsx wciąż używają głównie `useInlineT()`** zamiast migrować do `useTranslation()`.

---

### 5.2 Hardcodowane teksty angielskie — brak tłumaczenia

| Plik | Linia | Tekst |
|------|-------|-------|
| `AI.tsx` | 193 | `'Failed to load AI model status:'` — poza tt() |
| `Projects.tsx` | 444 | `'Permanently delete project "${projectLabel}"?...'` — pełne zdanie po angielsku zamiast klucza i18n |
| `Projects.tsx` | ~337 | Błąd folderError: `'Failed to load project folders'` |
| `ProjectPage.tsx` | 701 | `'Unfreeze project'` / `'Freeze project'` — hardcode en |
| `Sessions.tsx` | 90 | `console.error` komunikaty — ok jako dev output |
| `Dashboard.tsx` | 194 | `'Dashboard session action failed...'` — ok jako dev |

---

### 5.3 AI.tsx — `buildTrainingReminder` z mieszanym PL/EN

**Plik:** `dashboard/src/pages/AI.tsx:109–128`

```ts
reason = (translate ?? ((_: string, en: string) => en))(
  'Masz {{feedbackCount}} korekt...',  // PL
  'You have {{feedbackCount}} corrections...',  // EN
  ...
```

To poprawny inline-i18n pattern, ale `buildTrainingReminder` jest **czystą funkcją** wywoływaną poza hookami — nie może używać `useInlineT()`. Fallback `((_: string, en: string) => en)` powoduje, że jeśli `translate` jest undefined, zawsze zwraca EN. Ten problem nie jest krytyczny ale warto go udokumentować.

---

### 5.4 Brakujące klucze w `en/common.json` (nie ma polskiego odpowiednika)

Pliki JSON są symetryczne — obie wersje językowe mają identyczne klucze. Brak desynchronizacji.

---

### 5.5 Sekcja `settings` w common.json jest wyjątkowo szczupła

`settings` w `common.json` ma tylko `language.*` — cała reszta Settings.tsx używa inline-i18n. Docelowo Settings powinno być w pełni zmigrowane.

---

### 5.6 Help.tsx i QuickStart.tsx — mieszane języki

**Plik:** `dashboard/src/pages/Help.tsx:498, 501`

```ts
"Auto-freezing – the system automatically 'freezes'...",  // EN
'Odmrażanie (Unfreeze) – ikona płomienia...',  // PL
```

W tym samym renderze Help.tsx mieszają się angielskie i polskie teksty. Wymaga audytu Help.tsx pod kątem spójności językowej.

---

## 6. Bezpieczeństwo

### 6.1 SQL injection — dynamiczne budowanie zapytań

**Pliki:**
- `sessions.rs:8–38` — `apply_session_filters` buduje SQL z `format!()` dla warunków, ale używa parametrów `?{}` — **bezpieczne**
- `assignment_model.rs:454–464` — `format!("... WHERE token IN ({})", placeholders)` — **bezpieczne** (placeholders to tylko `?` znaki)

Ogólnie: dynamiczne SQL jest bezpieczne — używa parametryzowanych zapytań.

---

### 6.2 Token API przechowywany w secure store

**Plik:** `dashboard/src/lib/online-sync.ts`, `commands/secure_store.rs`

Dobra praktyka — token nie jest w localStorage.

---

### 6.3 BugHunter — brak sanitizacji attachmentów po stronie klienta (poza rozmiarem)

**Plik:** `dashboard/src/components/layout/BugHunter.tsx`

Walidacja tylko rozmiaru pliku (5MB), brak walidacji typu MIME. Niska krytyczność (aplikacja desktopowa, użytkownik = właściciel).

---

### 6.4 Demo mode — dane live i demo w tej samej aplikacji

**Plik:** `dashboard/src-tauri/src/commands/database.rs`

Tryb demo przełącza ścieżkę DB. Ryzyko: jeśli błąd w logice przełączania spowoduje zapis do live DB w trybie demo. Warto mieć test weryfikujący że `is_demo_mode()` jest sprawdzany przed zapisami.

---

## 7. Architektura AI — ocena i sugestie

### 7.1 Architektura modelu — ocena ogólna

Model używa 4-warstwowego scoringu (file_overlap > token_matching > app_history > time_patterns). To solidna, interpretowalna architektura. Główne zalety:
- Deterministyczna, przewidywalna
- Szybka (brak sieci neuronowych)
- Łatwa do debugowania (ScoreBreakdown UI)

### 7.2 Problemy w architekturze AI

**A) Confidence formula — patrz punkt 2.1**

**B) Token matching w Layer 3 nie uwzględnia wagi pliku**

```rust
let avg_log = (1.0 + (sum_cnt / matches_cnt.max(1.0))).ln() * (matches_cnt / token_total);
```

Plik `README.md` i plik `my-project-core.rs` mają takie same tokeny wagowo. Nazwy plików specyficzne dla projektu (np. `timeflow_storage.rs`) powinny mieć wyższy weight niż generyczne (`index.js`, `main.rs`).

**C) Brak decay historycznych danych**

Sesja sprzed roku ma taką samą wagę jak sesja z zeszłego tygodnia. Po importie starych danych model może być "zatruwany" przez historyczne wzorce.

**Sugestia:** W `retrain_model_sync` dodać filtr `WHERE date >= date('now', '-180 days')` lub czynnik decay `exp(-days_old / 30)`.

**D) Reinforcement tylko dla `assignment_model_app`, nie dla `assignment_model_time` i `assignment_model_token`**

```rust
// Boost the correct project
tx.execute("INSERT INTO assignment_model_app ... ON CONFLICT DO UPDATE ...")?;
// Penalize the wrong project
tx.execute("UPDATE assignment_model_app SET cnt = MAX(cnt - ?3, 1) ...")?;
```

Feedback reinforcement jest aplikowany **tylko** do tabeli `app`. Tabele `time` i `token` nie są korygowane przez ręczne poprawki użytkownika. Oznacza to, że jeśli model myli się przez dopasowania tokenów, training nie naprawi tego błędu.

**E) `auto_accept` wykluczone z treningu**

```rust
AND COALESCE((SELECT af.source ... LIMIT 1), '') <> 'auto_accept'
```

Sesje przypisane automatycznie przez model (auto_safe) są wykluczone z danych treningowych. To celowe — ale oznacza, że im więcej auto_safe używa, tym mniej danych treningowych ma. W długim terminie model może się "degenerować".

**Sugestia:** Rozważyć włączenie auto_accept z niższą wagą (np. `feedback_weight * 0.1`), tak by potwierdzone przez użytkownika auto_safe wzmacniało model.

---

### 7.3 UX modelu — sugestie

1. **Brak widoczności dlaczego model nie dał sugestii** — użytkownik widzi "brak danych AI", ale nie wie czy to brak dowodów, za niska confidence, czy frozen project.

2. **Snoozowanie przypomnienia o treningu** — gdy snooze = 24h, a RETRAIN_INTERVAL = 24h, przypomnienie może pojawiać się co godzinę po wygaśnięciu snooze.

3. **Feedback thumbs up/down nie wyjaśniają co "dobra/zła" sugestia oznacza dla modelu** — warto dodać tooltip "Kliknięcie kciuka w górę wzmocni tę sugestię w przyszłości".

---

## 8. Sugestie priorytetowe

### P1 — Krytyczne (naprawić jak najszybciej)

| # | Problem | Plik | Rozwiązanie |
|---|---------|------|-------------|
| 1 | Confidence formula zbyt restrykcyjna | `assignment_model.rs:502` | Zmienić evidence_factor na miękkie skalowanie |
| 2 | N+1 query w AI breakdown prefetch | `Sessions.tsx:244` | Dodać `get_sessions_score_breakdowns(ids)` w Rust |
| 3 | Race condition auto-refresh vs mutacja | `Sessions.tsx:296` | Dodać `isMutating` blokadę |

### P2 — Ważne (naprawić w ciągu 1-2 sprintów)

| # | Problem | Plik | Rozwiązanie |
|---|---------|------|-------------|
| 4 | Feedback reinforcement tylko dla app layer | `assignment_model.rs:748` | Rozszerzyć na token layer |
| 5 | Brak temporal decay w modelu | `assignment_model.rs:700` | Filtr 180-dniowy lub decay |
| 6 | Assign bulk — N osobnych transakcji | `useSessionActions.ts:49` | Backend batch command |
| 7 | getProjectEstimates poza allSettled | `Projects.tsx:361` | Przenieść do allSettled |
| 8 | `session_manual_overrides` CREATE TABLE w runtime | `sessions.rs:46` | Przenieść do migracji DB |

### P3 — Dobre praktyki (naprawić przy okazji)

| # | Problem | Plik | Rozwiązanie |
|---|---------|------|-------------|
| 9 | Storage keys inline w komponentach | wiele | Przenieść do `storage-keys.ts` |
| 10 | Migracja inline-i18n na useTranslation | AI.tsx, Settings.tsx | Sukcesywna migracja |
| 11 | `isNewProject` poza komponentem | `Projects.tsx:431` | Przenieść poza komponent |
| 12 | Help.tsx — mieszane PL/EN teksty | `Help.tsx:498,501` | Audyt i ujednolicenie |
| 13 | `2100-01-01` jako "nieskończoność" | `Projects.tsx:307` | Stała lub `null` w Rust |
| 14 | `formatDateTime` bez locale | `AI.tsx:63` | Użyć date-fns z locale |

---

*Raport wygenerowany na podstawie analizy: Projects.tsx, Sessions.tsx, Dashboard.tsx, AI.tsx, Settings.tsx, assignment_model.rs, projects.rs, sessions.rs, data-store.ts, useSessionActions.ts, inline-i18n.ts, user-settings.ts, locales/en/common.json, locales/pl/common.json*
