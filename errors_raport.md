# TIMEFLOW - Raport analizy kodu

**Data:** 2026-02-25
**Zakres:** Pełna analiza projektu (demon Rust + dashboard React/Tauri)

---

## Spis treści

1. [Architektura ogólna](#1-architektura-ogólna)
2. [Brakujące tłumaczenia (PL → EN)](#2-brakujące-tłumaczenia)
3. [Analiza logiki AI](#3-analiza-logiki-ai)
4. [Problemy z logiką i poprawnością](#4-problemy-z-logiką-i-poprawnością)
5. [Wydajność i optymalizacje](#5-wydajność-i-optymalizacje)
6. [Nadmiarowy kod](#6-nadmiarowy-kod)
7. [Przygotowanie do dynamicznego rozwoju](#7-przygotowanie-do-dynamicznego-rozwoju)
8. [Podsumowanie priorytetów](#8-podsumowanie-priorytetów)

---

## 1. Architektura ogólna

Projekt składa się z dwóch części:
- **timeflow-demon** (Rust) – daemon tray monitorujący aktywne okna, śledzący CPU, zapisujący dane do JSON.
- **dashboard** (React + Tauri) – dashboard z importem JSON do SQLite, zarządzaniem projektami, sesjami, AI assignment, sync online, estymacjami kosztów.

**Ocena ogólna:** Architektura jest solidna i dobrze podzielona. Demon jest lekki i wydajny. Dashboard jest rozbudowany z wieloma funkcjami. Kod jest w większości czytelny i dobrze zorganizowany.

---

## 2. Brakujące tłumaczenia

> Reguła: cały UI ma być po angielsku (wyjątek: Help i QuickStart).

### 2.1 BugHunter (`BugHunter.tsx`) — CAŁY KOMPONENT PO POLSKU

| Linia | Tekst PL | Proponowany EN |
|-------|----------|----------------|
| 43 | `Plik ${files[i].name} jest za duży (max 5MB)` | `File ${files[i].name} is too large (max 5MB)` |
| 94 | `Błąd wysyłki: ${error}` | `Failed to send: ${error}` |
| 112 | `Znalazłeś błąd lub masz pomysł? Daj znać.` | `Found a bug or have an idea? Let us know.` |
| 121 | `Zgłoszenie zostało wysłane!` | `Report sent successfully!` |
| 126 | `Temat (wersja ${version})` | `Subject (version ${version})` |
| 129 | `Krótki opis błędu...` | `Brief bug description...` |
| 137 | `Szczegóły zgłoszenia` | `Report details` |
| 140 | `Opisz błąd lub swój pomysł... Zaraz się tym zajmiemy.` | `Describe the bug or your idea...` |
| 150 | `Załączniki (max 5MB/plik)` | `Attachments (max 5MB/file)` |
| 156 | `DODAJ PLIKI` | `ADD FILES` |
| 193 | `Anuluj` | `Cancel` |
| 205 | `Wysyłanie...` / `Wyślij zgłoszenie` | `Sending...` / `Submit report` |

### 2.2 Sessions.tsx — polskie fragmenty w context menu

| Linia | Tekst PL | Proponowany EN |
|-------|----------|----------------|
| 223 | `title: "Komentarz do sesji"` | `"Session comment"` |
| 224 | `description: "(zostaw puste aby usunąć)"` | `"(leave empty to remove)"` |
| 636 | `AI sugeruje:` | `AI suggests:` |
| 682 | `"Edytuj komentarz"` / `"Dodaj komentarz"` | `"Edit comment"` / `"Add comment"` |

### 2.3 ProjectDayTimeline.tsx — polskie fragmenty

| Linia | Tekst PL | Proponowany EN |
|-------|----------|----------------|
| 389 | `title: "Komentarz do sesji"` | `"Session comment"` |
| 390 | `description: "(zostaw puste aby usunąć)"` | `"(leave empty to remove)"` |
| 773 | `AI sugeruje:` | `AI suggests:` |
| 861 | `"Edytuj komentarz"` / `"Dodaj komentarz"` | `"Edit comment"` / `"Add comment"` |

### 2.4 Sidebar.tsx

| Linia | Tekst PL | Proponowany EN |
|-------|----------|----------------|
| 298 | `title="BugHunter - zgłoś błąd"` | `title="BugHunter - report a bug"` |

### 2.5 Komentarze w Rust (mniejszy priorytet)

Komentarze w plikach `config.rs`, `storage.rs`, `monitor.rs` są częściowo po polsku. Nie wpływają na UI, ale warto zunifikować na angielski dla spójności.

---

## 3. Analiza logiki AI

### 3.1 Architektura AI assignment (3 warstwy)

Zidentyfikowane warstwy z `App.tsx` → `AutoAiAssignment`:

1. **Deterministic** (`applyDeterministicAssignment`) — mapowanie app→project na bazie historii (100% pewność)
2. **ML auto-safe** (`autoRunIfNeeded`) — model ML z progami confidence/evidence
3. **Suggestions** — wyświetlane w UI z przyciskami Accept/Reject

### 3.2 KRYTYCZNY PROBLEM: Brak komunikatu o zachowaniu AI w UI

> Wymaganie: "Wszystkie zachowania AI muszą być precyzyjnie komunikowane, by zachowanie użytkownika było elementem treningu."

**Problem:** Kiedy użytkownik ręcznie przypisuje sesję (prawy klik → projekt), NIE MA informacji, że ta akcja trenuje model AI. Użytkownik nie wie, że:
- Każde ręczne przypisanie to "feedback" liczony w `feedback_since_train`
- Odrzucenie sugestii AI (`ai_suggestion_reject`) jest rejestrowane jako sygnał negatywny
- Akceptacja sugestii AI (`ai_suggestion_accept`) jest rejestrowana jako sygnał pozytywny

**Rekomendacja — HIGH PRIORITY:**
- Dodać jednokrotny tooltip/notyfikację po pierwszym ręcznym przypisaniu: *"Your manual assignments train the AI model. The more you assign, the smarter it gets."*
- W sekcji "AI: No sample" dodać lepszy tekst: *"AI needs more training data. Assign this session manually to teach the model."* (obecny tekst jest niejasny)
- Po akceptacji/odrzuceniu sugestii AI krótki toast: *"Feedback recorded. This helps improve future suggestions."*

### 3.3 PROBLEM: "AI: No sample" nie jest precyzyjne

**Linia Sessions.tsx:553:** `AI: No sample` — ten tekst jest wyświetlany gdy model nie jest wystarczająco pewny. Ale nie mówi użytkownikowi CO zrobić.

**Propozycja:** Zmienić na `AI: Learning — assign manually to train` z tooltipem wyjaśniającym.

### 3.4 PROBLEM: Deterministic assignment nie jest widoczny w UI

Warstwa 1 (deterministic) przypisuje sesje automatycznie, ale NIE MA żadnego wskaźnika w UI odróżniającego deterministic od ML. W `SessionWithApp` jest pole `ai_assigned` ale nie ma `deterministic_assigned`.

**Rekomendacja:** Dodać pole `assignment_source` z wartościami: `manual`, `deterministic`, `ai_auto`, `ai_suggestion_accept` — i wyświetlać odpowiedni badge w sesji.

### 3.5 PROBLEM: AutoAiAssignment uruchamia się na KAŻDY refreshKey

```tsx
// App.tsx:248
useEffect(() => {
  if (!autoImportDone) return;
  // ...runs deterministic + ML on every refresh
}, [autoImportDone, refreshKey, triggerRefresh]);
```

Deterministic i ML assignment uruchamiają się na każdy `triggerRefresh()` — czyli po każdym ręcznym przypisaniu, zmianie daty, refresh itp. To niepotrzebne i może prowadzić do race conditions (użytkownik właśnie zmienił przypisanie, a sekwndę później AI próbuje je nadpisać).

**Rekomendacja:** Usunąć `refreshKey` z dependencies. Uruchamiać AI assignment TYLKO:
- Po starcie aplikacji (po `autoImportDone`)
- Po zakończeniu treningu modelu
- Po ręcznym kliknięciu "Run auto-safe" na stronie AI

### 3.6 PROBLEM: Brak informacji o training data w AI page

Strona AI.tsx wyświetla "Corrections since last training" — ale nie pokazuje:
- Ile jest danych treningowych ogółem (total manual assignments)
- Jakie projekty mają najwięcej sampli
- Jaka jest accuracy/quality modelu

**Rekomendacja:** Dodać sekcję "Training Data Overview" z tabelką: projekt → ilość sampli → % ze wszystkich.

### 3.7 Cooldown/snooze reminder

Logika `buildTrainingReminder` jest poprawna i dobrze zaimplementowana. Próg 30 korekcji i 24h interwał to sensowne domyślne wartości.

### 3.8 PROBLEM: "AI Suggests: Unknown (0%)" — mylący komunikat gdy AI nie ma danych

**Zgłoszone przez użytkownika.** Na screenshotach widać:
- Tooltip na timeline: `Antigravity: 00:00 - 00:07 • AI Suggests: Unknown (0%) (Right-click to assign)`
- Context menu: `AI sugeruje: Unknown (0%)` z przyciskami Accept/Reject

**Problem fundamentalny:** AI poprawnie rozpoznaje projekt (np. `__cfab_demon`), ale UI wyświetla "Unknown (0%)" zamiast rzeczywistej nazwy i pewności. To oznacza, że:

1. **Backend prawdopodobnie zwraca poprawny `suggested_project_id`**, ale `suggested_project_name` nie jest resolwowane (zostaje null/undefined → UI renderuje "Unknown").
2. **Confidence 0%** — backend zwraca `suggested_confidence = 0` lub null, mimo że model faktycznie podjął decyzję. Błąd leży w pipeline'ie między wynikiem modelu a danymi zwracanymi do frontendu.
3. **"Unknown" jako tekst fallback** — frontend renderuje `suggested_project_name || "Unknown"` — ale problem jest po stronie backendu, który nie dołącza nazwy projektu do odpowiedzi.
4. **Accept/Reject dla "Unknown (0%)"** — paradoks: użytkownik klika Accept na "Unknown" ale faktycznie przypisuje do poprawnego projektu (bo `suggested_project_id` jest prawidłowy). UX jest kompletnie mylący.

**Prawdopodobna przyczyna (do weryfikacji w backendzie Tauri/Rust):**
- Zapytanie SQL zwracające sugestie nie JOINuje z tabelą `projects` aby pobrać `name`
- Lub confidence nie jest propagowane z modelu do response'a

**Rekomendacja — HIGH PRIORITY:**

Backend powinien rozróżniać:
- `suggested_project_id = null` + `suggested_confidence = null` → AI nie ma sugestii → UI: brak sekcji sugestii, pokazać "AI: Learning"
- `suggested_project_id = X` + `suggested_confidence = 0.75` → AI sugeruje projekt X z 75% pewnością → UI: normalna sugestia z Accept/Reject

Frontend powinien:
- **Nie wyświetlać Accept/Reject** gdy `suggested_project_id` jest null/undefined lub `suggested_confidence` jest 0 lub null
- Zmienić tooltip z `AI Suggests: Unknown (0%)` na `AI: No suggestion yet — assign manually to train`
- W context menu: nie wyświetlać sekcji "AI sugeruje" gdy brak realnej sugestii

**Dodatkowy problem widoczny na screenshotach:**
- Context menu zawiera polski tekst: "AI sugeruje", "Detale sesji", "Dodaj komentarz" (zob. sekcja 2)

---

## 4. Problemy z logiką i poprawnością

### 4.1 `is_dashboard_running()` — kosztowne i niekompletne

**Plik:** `tray.rs:207-219`

```rust
fn is_dashboard_running() -> bool {
    use sysinfo::{System, ProcessRefreshKind, RefreshKind};
    let s = System::new_with_specifics(
        RefreshKind::new().with_processes(ProcessRefreshKind::new()),
    );
    s.processes().values().any(|p| {
        let name = p.name().to_lowercase();
        // ...
    })
}
```

**Problem:** Tworzy nowy `System` snapshot za każdym razem (skanuje wszystkie procesy). Wywoływane przy każdym kliknięciu "Launch Dashboard" — ale nie jest krytyczne.

**Bardziej istotne:** `p.name().to_lowercase()` — `sysinfo` zwraca `OsStr`, więc `to_lowercase()` może nie istnieć w takiej formie. Sprawdzić kompatybilność z wersją sysinfo 0.30.

### 4.2 Atomic write — potencjalny problem z uprawnieniami

**Plik:** `storage.rs:72-87`

`atomic_replace_file` używa `MoveFileExW` z FFI. Deklaracja `extern "system"` jest poprawna, ale:
- Brak sprawdzenia czy plik tmp został faktycznie zapisany przed próbą rename
- Jeśli `MoveFileExW` zawiedzie, tmp NIE jest usuwany (celowe — ale warto logować rozmiar pliku)

### 4.3 Session auto-refresh w Sessions.tsx — podwójne zapytanie

**Plik:** `Sessions.tsx:94-108` i `Sessions.tsx:119-136`

Dwa osobne `useEffect` robią dokładnie to samo zapytanie `getSessions(...)`:
1. Pierwszy uruchamia się na zmianę filtrów/refresh
2. Drugi uruchamia się co 15 sekund

**Problem:** Przy zmianie filtrów oba uruchamiają się jednocześnie — podwójne zapytanie do backendu.

**Rekomendacja:** Połączyć w jeden `useEffect` z `setInterval` i immediate first run.

### 4.4 `window.confirm` i `window.alert` w Tauri

**Pliki:** `Settings.tsx:151,152,224`, `Projects.tsx:275`, `Applications.tsx:167`

Użycie natywnych `window.confirm()` i `window.alert()` w aplikacji Tauri jest problematyczne — blokują thread i wyglądają nienatywnie. Projekt ma już `PromptModal` — powinien być używany konsekwentnie.

**Rekomendacja:** Zastąpić wszystkie `confirm()` i `alert()` komponentami modalnymi (`PromptModal` lub dedykowanym `ConfirmDialog`).

### 4.5 Race condition w `handleAssign` (Dashboard.tsx)

```tsx
const handleAssignSession = useCallback(
  async (sessionIds: number[], projectId: number | null) => {
    await Promise.all(sessionIds.map((sessionId) => assignSessionToProject(sessionId, projectId)));
    triggerRefresh();
  },
```

Brak obsługi błędów dla poszczególnych sesji — jeśli jedna z N sesji fail, wszystkie wcześniejsze są przypisane ale refresh nie następuje (throw przerywa).

**Rekomendacja:** Użyć `Promise.allSettled` zamiast `Promise.all`.

---

## 5. Wydajność i optymalizacje

### 5.1 Demon: `check_dashboard_compatibility()` czyta plik co 30s

**Plik:** `tracker.rs:226-228`

```rust
if last_config_reload.elapsed() >= config_reload_interval {
    cfg = config::load();
    check_dashboard_compatibility();
```

`check_dashboard_compatibility()` czyta plik `dashboard_version.txt` i potencjalnie wyświetla `MessageBoxW` (blokujący!).

**Problem:** Jeśli wersje są niezgodne, `MessageBoxW` wyświetla się raz (chronione flagą `WARNING_SHOWN`), ale czytanie pliku odbywa się co 30s niepotrzebnie.

**Rekomendacja:** Sprawdzać raz na 5 minut, nie co 30s. Lub cachować wynik i sprawdzać ponownie tylko gdy plik się zmienił.

### 5.2 Dashboard: Sidebar odpytuje 5 endpointów co 10s

**Plik:** `Sidebar.tsx:117-148`

```tsx
const check = () => {
  void Promise.allSettled([
    getDaemonStatus(),
    getAssignmentModelStatus(),
    getDatabaseSettings(),
    getSessionCount({ ... }),  // today
    getSessionCount({ ... }),  // all
  ]).then(...)
};
const interval = setInterval(check, 10_000);
```

5 zapytań IPC co 10 sekund — to agresywne, zwłaszcza `getDatabaseSettings()` i `getAssignmentModelStatus()` które rzadko się zmieniają.

**Rekomendacja:** Rozdzielić na dwie grupy:
- **Fast** (co 10s): `getDaemonStatus()`, `getSessionCount()` (x2)
- **Slow** (co 60s): `getAssignmentModelStatus()`, `getDatabaseSettings()`

### 5.3 Dashboard.tsx: 7 równoległych zapytań przy każdej zmianie

**Plik:** `Dashboard.tsx:206-249`

7 `Promise.allSettled` zapytań przy każdej zmianie `dateRange`, `refreshKey`, `timePreset`. Jest to poprawne (all settled), ale warto dodać debounce przy szybkim klikaniu presetów.

### 5.4 Online Sync: duże payloady

`online-sync.ts` eksportuje CAŁY `ExportArchive` (wszystkie projekty, sesje, manual sessions) i wysyła na serwer. Dla dużych baz danych to może być setki MB.

**Rekomendacja na przyszłość:** Implementacja delta-sync zamiast full snapshot.

---

## 6. Nadmiarowy kod

### 6.1 Zduplikowana logika komentarzy

Logika obsługi komentarzy sesji jest zduplikowana w 3 miejscach:
- `Sessions.tsx:217-241` (`handleEditComment`)
- `ProjectDayTimeline.tsx:385-407` (anonimowa lambda)
- Oba mają identyczne polskie stringi

**Rekomendacja:** Wyciągnąć do współdzielonego hooka `useSessionComment()`.

### 6.2 Zduplikowana logika AI suggestions w context menu

Context menu z sugestiami AI jest zduplikowane:
- `Sessions.tsx:631-656` (context menu)
- `ProjectDayTimeline.tsx:770-801` (context menu)

**Rekomendacja:** Wyciągnąć komponent `AiSuggestionContextMenuSection`.

### 6.3 `getErrorMessage` zduplikowane

Funkcja `getErrorMessage(error, fallback)` jest zdefiniowana identycznie w:
- `Projects.tsx:47-50`
- `Estimates.tsx:31-35`

**Rekomendacja:** Przenieść do `lib/utils.ts`.

### 6.4 `formatMultiplierLabel` zduplikowane

Zdefiniowane w `Sessions.tsx:28-31` — używane tylko tam, ale logicznie mogłoby być w `utils.ts`.

### 6.5 Nieużywane importy/funkcje (do weryfikacji)

- `HourlyBreakdown.tsx` — sprawdzić czy jest gdziekolwiek importowany (nie widzę użycia w Dashboard.tsx)
- `ImportPage.tsx` — lazy-loaded ale nie widoczny w nawigacji sidebar (brak w `navItems`). Czy jest dostępny z innej ścieżki?

---

## 7. Przygotowanie do dynamicznego rozwoju

### 7.1 System routingu

Obecny routing to prosty `switch` na stringach w `App.tsx` + `navItems` w `Sidebar.tsx`. Przy dodawaniu nowych stron trzeba zmienić 3 miejsca:
1. `App.tsx` — PageRouter switch
2. `Sidebar.tsx` — navItems array
3. Lazy import

**Rekomendacja:** Stworzyć centralne `routes.ts`:
```ts
export const routes = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, component: lazy(() => ...) },
  // ...
] as const;
```

### 7.2 Brak systemu i18n

Help i QuickStart mają ręczny system `t("PL", "EN")`, ale reszta aplikacji nie ma żadnego systemu lokalizacji. Dodawanie nowych języków wymaga refaktoryzacji.

**Rekomendacja (przyszłość):** Wdrożyć `i18next` lub podobny system. Na teraz — upewnić się, że WSZYSTKIE stringi UI są po angielsku (poza wyjątkami).

### 7.3 Brak centralizacji stałych konfiguracyjnych

Stałe takie jak `FEEDBACK_TRIGGER = 30`, `RETRAIN_INTERVAL_HOURS = 24`, `PAGE_SIZE = 100`, `MAX_RATE = 100000` są rozproszone po plikach.

**Rekomendacja:** Stworzyć `lib/constants.ts` z wszystkimi domyślnymi wartościami.

### 7.4 Brak obsługi wersjonowania schematu DB

Dashboard używa SQLite, ale nie widać systemu migracji schematu w kodzie frontendu. Jeśli backend Tauri zmienia schemat, dashboard musi być zaktualizowany jednocześnie.

**Rekomendacja:** Upewnić się, że `check_version_compatibility()` w demonie jest wystarczające, lub dodać obsługę migracji po stronie Tauri.

### 7.5 Store — możliwy memory leak

`app-store.ts:148`:
```ts
firstRun: localStorage.getItem("timeflow_first_run") !== "false",
```

Zustand store jest globalny i nie ma cleanup. Jest OK dla SPA, ale warto dodać `devtools` middleware w development mode.

### 7.6 Brak test infrastructure

Demon Rust ma testy jednostkowe (`monitor.rs:372-426`), ale dashboard NIE ma żadnych testów.

**Rekomendacja na przyszłość:** Dodać przynajmniej:
- Testy `lib/utils.ts` (pure functions)
- Testy `lib/user-settings.ts` (localStorage logic)
- Testy `buildTrainingReminder` (AI logic)

---

## 8. Podsumowanie priorytetów

### WYSOKI PRIORYTET

| # | Problem | Plik(i) | Typ |
|---|---------|---------|-----|
| 1 | BugHunter — cały komponent po polsku | `BugHunter.tsx` | Tłumaczenie |
| 2 | Sessions/Timeline context menu — polskie stringi | `Sessions.tsx`, `ProjectDayTimeline.tsx` | Tłumaczenie |
| 3 | Sidebar — polski tooltip BugHunter | `Sidebar.tsx:298` | Tłumaczenie |
| 4 | AI: brak komunikacji, że ręczne przypisania trenują model | `Sessions.tsx`, `ProjectDayTimeline.tsx` | AI UX |
| 5 | AI: "No sample" tekst niejasny | `Sessions.tsx:553` | AI UX |
| 6 | AutoAiAssignment uruchamia się na każdy refresh | `App.tsx:248` | Logika/AI |
| 7 | "AI Suggests: Unknown (0%)" — mylący gdy AI nie ma danych LUB gdy trafia | Sessions, ProjectDayTimeline, backend | AI UX/Logika |

### ŚREDNI PRIORYTET

| # | Problem | Plik(i) | Typ |
|---|---------|---------|-----|
| 7 | Podwójne zapytanie getSessions | `Sessions.tsx` | Wydajność |
| 8 | `Promise.all` zamiast `Promise.allSettled` w handleAssign | `Dashboard.tsx:153` | Logika |
| 9 | `window.confirm`/`alert` zamiast komponentów modalnych | Settings, Projects, Applications | UX |
| 10 | Sidebar: 5 zapytań co 10s (za agresywne) | `Sidebar.tsx` | Wydajność |
| 11 | Zduplikowana logika komentarzy (3 miejsca) | Sessions, ProjectDayTimeline | Kod |
| 12 | `getErrorMessage` zduplikowane | Projects, Estimates | Kod |

### NISKI PRIORYTET

| # | Problem | Plik(i) | Typ |
|---|---------|---------|-----|
| 13 | Polskie komentarze w Rust | `config.rs`, `storage.rs`, `monitor.rs` | Spójność |
| 14 | Centralny routing (`routes.ts`) | `App.tsx`, `Sidebar.tsx` | Architektura |
| 15 | `lib/constants.ts` | Rozproszone stałe | Architektura |
| 16 | Brak testów dashboard | Dashboard | Jakość |
| 17 | check_dashboard_compatibility co 30s | `tracker.rs` | Wydajność |

---

## Załącznik: Pliki wymagające zmian wg priorytetu

**Natychmiastowe (tłumaczenia + AI UX):**
- `dashboard/src/components/layout/BugHunter.tsx` — tłumaczenie PL→EN
- `dashboard/src/pages/Sessions.tsx` — tłumaczenie + AI feedback UX
- `dashboard/src/components/dashboard/ProjectDayTimeline.tsx` — tłumaczenie + AI feedback UX
- `dashboard/src/components/layout/Sidebar.tsx` — tooltip tłumaczenie
- `dashboard/src/App.tsx` — fix AutoAiAssignment dependencies

**Do rozważenia:**
- `dashboard/src/lib/utils.ts` — dodać `getErrorMessage()`
- Nowy plik `dashboard/src/lib/constants.ts`
- Nowy komponent `dashboard/src/components/ConfirmDialog.tsx`
