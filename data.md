# TIMEFLOW — Analiza zbierania i przetwarzania danych

## Obecny pipeline (podsumowanie)

```
SetWinEventHook (instant) + polling (10s)
    → idle check (120s threshold)
    → record_app_activity() in-memory
    → CPU background snapshot (co 30s)
    → SQLite save (co 5 min)
    → Dashboard: load DailyData → bucket by hour/day → render
```

**Rozdzielczość danych:** sekundy (nanosekundy obcinane w `aligned_local_now()`).
**Granulacja zapisu:** sesje + pliki per aplikacja per dzień.

---

## Problemy z precyzją i sugestie poprawy

### 1. Utrata czasu przy przejściu idle → active

**Problem:** Gdy użytkownik jest idle >120s, cały tick (10s) jest pomijany. Ale przejście z idle do aktywności nie jest interpolowane — jeśli użytkownik wrócił po 125s idle, straciliśmy ~5s aktywności (czas między faktycznym powrotem a następnym tickiem).

**Sugestia:** Przy wyjściu z idle (`was_idle && !is_idle`), obliczyć `actual_active_time = poll_interval - (idle_ms - IDLE_THRESHOLD_MS).min(poll_interval)` i zapisać proporcjonalny czas zamiast pełnego `actual_elapsed`.

**Wpływ:** +1-10s precyzji na każde wznowienie po idle. Przy 20 idle-cyklach dziennie = do ~3 min.

---

### 2. Brak detekcji sleep/wake i hibernacji

**Problem:** `GetLastInputInfo()` nie resetuje się po sleep. Po wybudzeniu `idle_ms` może zwrócić ogromną wartość (czas snu), ale następny tick po wybudzeniu po prostu pomija — OK. Problem jest odwrotny: jeśli system zasnął w trakcie `poll_interval`, `actual_elapsed` obejmie czas snu (bo `Instant::now()` liczy wall-clock). Zabezpieczenie `max_elapsed = poll_interval * 3` pomaga, ale przy krótkiej drzemce (np. 25s) przepuści fałszywy czas.

**Sugestia:**
- Dodać detekcję power events (Windows `RegisterPowerSettingNotification` lub `WM_POWERBROADCAST`).
- Przy wybudzeniu: wymusić nowy tick z `elapsed = 0` (reset `last_tracking_tick`).
- Alternatywnie: porównywać `SystemTime` z `Instant` — rozbieżność >2x `poll_interval` oznacza sleep.

**Wpływ:** Eliminuje fałszywe 10-30s aktywności po każdym sleep/wake.

---

### 3. Foreground hook (SetWinEventHook) nie wpływa na zapis czasu

**Problem:** Hook budzi pętlę trackera natychmiast przy zmianie okna, ALE czas aktywności wciąż jest liczony jako `actual_elapsed = now - last_tracking_tick`. Jeśli użytkownik zmienił okno po 2s od ostatniego ticka, a polling jest 10s, to:
- Stara aplikacja dostaje 2s (poprawnie z powodu instant wake).
- Nowa aplikacja dostanie ~8s przy następnym ticku.
- **Ale:** jeśli użytkownik przełączy się znów w ciągu tych 8s, czas drugiej apki jest zawyżony.

**Sugestia:** Zapisywać timestamp ostatniej zmiany foreground z hooka i używać go do podziału czasu:
```
app_A_time = hook_switch_time - last_tick_time
app_B_time = current_tick_time - hook_switch_time
```
To wymaga przechowania historii przełączeń między tickami (prosty `Vec<(Instant, String)>` max 50 elementów).

**Wpływ:** Znaczna poprawa precyzji przy szybkim przełączaniu okien (Alt+Tab workflow). Zamiast ±10s błędu → ±0.1s.

---

### 4. Background CPU tracking — fałszywe pozytywy i brak file context

**Problem:**
- Threshold 5% CPU to dużo dla idle procesów, ale mało dla build tools — przeglądarka z jednym YouTube'em przekracza 5%.
- Background activity nie ma `file_name` ani `window_title` — zapisywane jako `"(background)"` bez kontekstu.

**Sugestia:**
- Dodać per-app thresholdy w konfiguracji (np. przeglądarki 15%, IDE 3%).
- Przy detekcji background activity, pobrać tytuł okna przez `EnumWindows` dla tego PID — nawet w tle okno ma tytuł.
- Alternatywnie: nie liczyć background CPU dla aplikacji typu przeglądarka (flagowane w config).

**Wpływ:** Mniej szumu w danych, lepszy kontekst dla background sessions.

---

### 5. Session gap detection — zbyt gruboziarnista

**Problem:** Stały `session_gap = 300s` nie pasuje do wszystkich scenariuszy:
- Programista Alt+Tabujący między terminalem a IDE co 10s → niepotrzebne nowe sesje jeśli terminal nie jest monitorowany.
- Długa kompilacja (4 min idle w IDE) → fałszywie nowa sesja, choć to ta sama praca.

**Sugestia:**
- Session gap per-aplikacja w konfiguracji (IDE: 600s, przeglądarka: 120s).
- Opcjonalnie: inteligentne łączenie sesji — jeśli nowa sesja zaczyna się <30s po zakończeniu starej w tej samej aplikacji z tym samym plikiem, scal je.

**Wpływ:** Bardziej realistyczne sesje, mniej fragmentacji.

---

### 6. Utrata danych przy crash/freeze podczas db_frozen

**Problem:** Gdy baza jest zamrożona dla LAN sync, zapisy są pomijane. Jeśli daemon crashnie w tym czasie, dane od ostatniego zapisu (do 5 min) są tracone. Dane są trzymane tylko w pamięci.

**Sugestia:**
- Podczas freeze: pisać do tymczasowego WAL/journal pliku (np. `timeflow_buffer.jsonl`).
- Po unfreeze: flush WAL → SQLite → usuń WAL.
- Alternatywnie: zmniejszyć max freeze time i dodać timeout z wymuszonym zapisem.

**Wpływ:** Zero utraty danych przy crashach podczas sync.

---

### 7. Window title parsing — heurystyki gubią kontekst

**Problem:** `extract_file_from_title()` używa prostych separatorów (` — `, ` - `, ` | `). Przykłady problemów:
- `"my-project - README.md - Visual Studio Code"` → wyciąga `"my-project"` zamiast `"README.md"`.
- `"Slack | #dev-team | Company Workspace"` → wyciąga `"Slack"` (bezużyteczne).

**Sugestia:**
- Odwrócić kolejność parsowania: dla znanych aplikacji, brać segment PRZED separatorem app name (np. dla VSCode brać przedostatni segment).
- Dodać per-app regex/pattern w konfiguracji dla zaawansowanych użytkowników.
- Fallback na WMI-detected path gdy dostępny (już jest, ale tylko dla Coding/Design).

**Wpływ:** Lepsza identyfikacja plików/projektów, szczególnie dla IDE i przeglądarek.

---

### 8. File activity overlap — niedokładna asocjacja z sesjami

**Problem:** Dashboard (`sessions/query.rs`) łączy pliki z sesjami przez overlap `first_seen..last_seen` vs `session.start..session.end`. Ale `first_seen`/`last_seen` to absolutne granice — plik widziany rano i wieczorem ma overlap z KAŻDĄ sesją tego dnia.

**Sugestia:**
- Zamiast `first_seen`/`last_seen`, zapisywać listę przedziałów aktywności per plik (`activity_spans: Vec<(start, end)>`), łączonych jeśli gap <30s.
- Dashboard liczy overlap na bazie spans, nie globalnych granic.
- Ograniczyć spans do max 100 per plik per dzień (merge najkrótszych).

**Wpływ:** Dramatycznie lepsza precyzja przypisania plików do sesji. Największa pojedyncza poprawa jakości danych.

---

### 9. Brak sub-minute granulacji w dashboardzie

**Problem:** Dashboard bucketuje dane co godzinę lub co dzień. Nie ma widoku 5-minutowego lub 15-minutowego, co uniemożliwia analizę micro-patterns (np. „ile czasu spędzam na przełączaniu kontekstu?").

**Sugestia:**
- Dodać granulację 5min/15min w TimeAnalysis.
- Dane już mają rozdzielczość sekundową — to zmiana tylko w dashboard bucketing logic.

**Wpływ:** Lepszy wgląd w wzorce pracy bez zmian w demonie.

---

### 10. Title history — FIFO z utratą danych

**Problem:** `MAX_TITLE_HISTORY_LEN = 12` z FIFO (`history.remove(0)`) — stare tytuły są tracone bezpowrotnie. Dla IDE z wieloma plikami, 12 tytułów to za mało na cały dzień.

**Sugestia:**
- Zwiększyć limit do 50 lub usunąć limit (z max per-day cap ~200).
- Zamiast FIFO: deduplikacja + counter (ile razy widziany) + last_seen timestamp. To daje kompaktową, ale pełną historię.

**Wpływ:** Pełniejszy kontekst dla AI analizy i raportów.

---

## Priorytetyzacja (impact × effort)

| # | Sugestia | Impact | Effort | Priorytet |
|---|----------|--------|--------|-----------|
| 3 | Foreground hook time-split | **Wysoki** — eliminuje ±10s błąd | Średni | **P1** |
| 8 | File activity spans | **Wysoki** — poprawia sesja↔plik | Średni-wysoki | **P1** |
| 1 | Idle→active interpolacja | Średni | Niski | **P2** |
| 2 | Sleep/wake detection | Średni | Średni | **P2** |
| 7 | Window title parsing | Średni | Średni | **P2** |
| 5 | Per-app session gap | Średni | Niski | **P2** |
| 4 | Background CPU refinement | Niski-średni | Średni | **P3** |
| 6 | Crash-safe db_frozen buffer | Niski (edge case) | Średni | **P3** |
| 9 | Sub-minute dashboard buckets | Niski (UI only) | Niski | **P3** |
| 10 | Title history expansion | Niski | Niski | **P3** |

---

## Podsumowanie

Obecny pipeline jest solidny — eventowy hook + polling + idle detection to dobre fundamenty. Główne luki w precyzji to:

1. **Brak podziału czasu przy szybkim przełączaniu okien** (#3) — hook budzi pętlę, ale nie dzieli czasu proporcjonalnie.
2. **Gruboziarnista asocjacja plik↔sesja** (#8) — `first_seen/last_seen` to za mało.
3. **Sleep/wake i idle transitions** (#1, #2) — edge cases, ale kumulują się.

Implementacja P1 (#3 i #8) da największy skok jakości danych przy rozsądnym nakładzie pracy.

---
---

# Moduł AI (Assignment Model) — analiza i sugestie

## Obecna architektura

Moduł AI to **lokalny, deterministyczny klasyfikator** (nie LLM). Przypisuje sesje do projektów na podstawie 4 warstw dowodów:

```
Layer 0: File Evidence    — pliki otwarte w sesji mają przypisany projekt   (waga: 0.80/hit)
Layer 1: App Pattern      — app X historycznie używana na projekcie Y       (waga: 0.30 * ln(1+cnt))
Layer 2: Time Pattern     — app X o godzinie H w dzień W → projekt Y       (waga: 0.10 * ln(1+cnt))
Layer 3: Token Matching   — tokeny z nazw plików/tytułów → projekt Y       (waga: 0.30 * avg_log)

Confidence = sigmoid(margin) * (1 - exp(-evidence/2))
```

**Kluczowe pliki:**
- [scoring.rs](dashboard/src-tauri/src/commands/assignment_model/scoring.rs) — 4-warstwowy scoring
- [training.rs](dashboard/src-tauri/src/commands/assignment_model/training.rs) — budowanie 3 tabel modelu
- [context.rs](dashboard/src-tauri/src/commands/assignment_model/context.rs) — ekstrakcja kontekstu sesji + tokenizacja
- [auto_safe.rs](dashboard/src-tauri/src/commands/assignment_model/auto_safe.rs) — batch auto-assignment

---

## Problemy i sugestie poprawy

### AI-1. Tokenizacja jest zbyt naiwna — brak stop-words i n-gramów

**Problem:** `tokenize()` ([context.rs:17-26](dashboard/src-tauri/src/commands/assignment_model/context.rs#L17-L26)) dzieli tekst prostymi separatorami i filtruje tylko po długości (≥2 znaki) i obecności litery. Rezultat:
- Tokeny jak `"the"`, `"src"`, `"app"`, `"new"`, `"test"` pojawiają się we WSZYSTKICH projektach → rozmywają sygnał.
- Brak n-gramów: `"user-service"` staje się `["user", "service"]` — oba pospolite, ale razem unikalne.

**Sugestia:**
- Dodać stop-list (~50-100 słów: "src", "app", "lib", "index", "main", "test", "new", "old", "tmp", "the", "and", "for" itp.).
- Dodać bigramy: oprócz tokenów `["user", "service"]`, generować też `"user_service"` jako dodatkowy token.
- Opcjonalnie: ważyć tokeny przez IDF (inverse document frequency) — rzadki token = mocniejszy sygnał.

**Wpływ:** Mniejszy szum w Layer 3, lepsza dyskryminacja między projektami. Szczególnie istotne gdy użytkownik ma wiele projektów z podobną strukturą folderów.

---

### AI-2. Layer 3 (tokeny) nie rozróżnia źródła tokena

**Problem:** Token z `file_name`, `file_path`, `detected_path`, `window_title` i `title_history` jest traktowany identycznie. Ale token z `detected_path` (np. `"c:/projects/alpha/src/main.rs"`) jest ZNACZNIE silniejszym sygnałem niż token z `window_title` (np. `"untitled"` z Notatnika).

**Sugestia:** Ważyć tokeny według źródła:
```
detected_path tokens:  × 3.0  (pewna ścieżka z WMI)
file_path tokens:      × 2.0  (ścieżka z tytułu okna)
file_name tokens:      × 1.5  (nazwa pliku)
window_title tokens:   × 1.0  (tytuł okna — często szum)
title_history tokens:  × 0.5  (historyczne tytuły — mogą być nieaktualne)
```
Implementacja: zamiast `cnt += 1` w `token_counts`, robić `cnt += source_weight`.

**Wpływ:** Lepsze odróżnianie sygnału od szumu, szczególnie dla aplikacji z dużym title churn (przeglądarki, Slack).

---

### AI-3. Confidence sigmoid nie wykorzystuje evidence dobrze

**Problem:** Formuła confidence ([scoring.rs:278-281](dashboard/src-tauri/src/commands/assignment_model/scoring.rs#L278-L281)):
```rust
evidence_factor = 1.0 - exp(-evidence_count / 2.0)
sigmoid_margin = 1.0 / (1.0 + exp(-margin))
confidence = sigmoid_margin * evidence_factor
```
- `sigmoid(-margin)` startuje od 0.5 przy margin=0, co oznacza, że nawet przy braku marginu (dwa projekty na tym samym score) confidence = 0.5 × evidence_factor.
- Przy evidence=2, evidence_factor = ~0.63. Więc confidence = 0.32 — wystarczy do sugestii z progiem 0.30.
- **Problem:** to za dużo pewności przy zerowym marginie — model "nie wie" który projekt wybrać, ale i tak sugeruje.

**Sugestia:** Zaostrzyć sigmoid:
```rust
// Przesunięty sigmoid — wymaga margin > 0.3 żeby przekroczyć 0.5
let sigmoid_margin = 1.0 / (1.0 + (-(margin - 0.3) * 4.0).exp());
```
Lub dodać penalty za niski margin: `confidence *= (margin / (margin + 0.2))`.

**Wpływ:** Mniej fałszywych sugestii przy niejednoznacznych sesjasjach. Lepszy precision kosztem minimalnego recall.

---

### AI-4. Brak decay — stare dane mają tę samą wagę co nowe

**Problem:** Training horizon to max 730 dni, ale sesja sprzed 2 lat liczy się tak samo jak wczorajsza. Jeśli użytkownik zmienił workflow (np. przeszedł z WebStorm na VSCode), stare dane zatruwają model.

**Sugestia:** Dodać exponential decay w treningu:
```sql
-- Zamiast COUNT(*) → SUM(weight)
-- weight = exp(-days_ago / half_life)
-- half_life = 90 dni (konfigurowalne)
```
Implementacja w SQL:
```sql
SELECT s.app_id, s.project_id,
       SUM(exp(-julianday('now') - julianday(s.start_time)) / 90.0) as weighted_cnt
FROM sessions s
WHERE ...
GROUP BY s.app_id, s.project_id
```

**Wpływ:** Model szybciej adaptuje się do zmian workflow. Kluczowe dla użytkowników pracujących nad wieloma projektami z rotacją.

---

### AI-5. Layer 2 (temporal) jest za słaba — 0.10 to za mało

**Problem:** Layer 2 ([scoring.rs:173-195](dashboard/src-tauri/src/commands/assignment_model/scoring.rs#L173-L195)) ma wagę 0.10 — minimalny wpływ na końcowy score. Ale wzorce czasowe mogą być bardzo silnym sygnałem (np. "rano robię projekt A, po południu projekt B").

**Sugestia:**
- Zwiększyć wagę Layer 2 do 0.20.
- Rozszerzyć granulację: oprócz `(hour, weekday)`, dodać `hour_range` (rano=6-12, popołudnie=12-18, wieczór=18-24) jako dodatkowy feature z mniejszą wagą — łapie broader patterns.
- Dodać duration-weighted counting: dłuższa sesja na projekcie o danej porze = silniejszy sygnał.

**Wpływ:** Lepsze przewidywania dla użytkowników z regularnymi harmonogramami.

---

### AI-6. File overlap (Layer 0) nie weryfikuje duration — krótki overlap = pełny score

**Problem:** Layer 0 daje 0.80 za KAŻDY projekt znaleziony w `file_project_ids`. Ale `build_session_context` ([context.rs:152-158](dashboard/src-tauri/src/commands/assignment_model/context.rs#L152-L158)) bierze pliki gdzie `last_seen > session.start AND first_seen < session.end`. To znaczy: plik widziany przez 1 sekundę w 3-godzinnej sesji daje ten sam score co plik aktywny przez 3 godziny.

**Sugestia:** Ważyć Layer 0 przez overlap fraction:
```
overlap_seconds = min(file.last_seen, session.end) - max(file.first_seen, session.start)
session_seconds = session.end - session.start
weight = (overlap_seconds / session_seconds).clamp(0.1, 1.0)
score = 0.80 * weight
```

**Wpływ:** Redukcja fałszywych pozytywów od krótkotrwałych plików. Szczególnie ważne dla sesji z wieloma projektami (IDE z wieloma workspace'ami).

---

### AI-7. Brak negatywnego feedbacku w modelu tokenów

**Problem:** Feedback z `ai_suggestion_reject` i `manual_session_change` jest używany w tabelach `assignment_model_app` i `assignment_model_time` (boost/penalty), ale NIE w `assignment_model_token`. Tokeny są budowane wyłącznie z pozytywnych danych (pliki przypisane do projektów).

**Sugestia:** Przy odrzuceniu sugestii:
- Zmniejszyć `cnt` tokenów sesji dla odrzuconego projektu.
- Zwiększyć `cnt` dla projektu, który użytkownik wybrał zamiast.
- To jest symetryczne z obecnym podejściem w Layer 1.

**Wpływ:** Layer 3 uczy się z błędów, nie tylko z sukcesów.

---

### AI-8. Auto-retrain jest za rzadki — 30 feedbacków + 24h cooldown

**Problem:** Model retrenuje się po ≥30 feedbackach I ≥24h od ostatniego treningu. Dla aktywnego użytkownika (30 feedbacków dziennie) to może działać. Ale dla casual użytkownika (5 feedbacków/dzień), retrain nastąpi po ~6 dniach. W tym czasie model daje sugestie na podstawie przestarzałych danych.

**Sugestia:**
- Obniżyć threshold do 10 feedbacków LUB 7 dni od ostatniego treningu.
- Dodać "incremental update": zamiast pełnego retreningu, aktualizować tabele modelu inkrementalnie przy każdym feedbacku (add/subtract counts). Pełny retrain co 7 dni jako garbage collection.

**Wpływ:** Szybsza adaptacja modelu, mniej przestarzałych sugestii.

---

### AI-9. Brak session duration weighting w treningu

**Problem:** W `training.rs` ([linie 95-113](dashboard/src-tauri/src/commands/assignment_model/training.rs#L95-L113)), każda sesja >10s liczy się jako 1 w `COUNT(*)`. Sesja 15-sekundowa ma tę samą wagę co sesja 4-godzinna.

**Sugestia:** Zamiast `COUNT(*)`, użyć ważonej sumy:
```sql
SUM(CASE
    WHEN duration_seconds > 3600 THEN 3.0  -- > 1h: silny sygnał
    WHEN duration_seconds > 600  THEN 2.0  -- > 10min: średni
    ELSE 1.0                               -- krótka sesja: słaby
END) as weighted_cnt
```

**Wpływ:** Dłuższe sesje (silniejszy sygnał intencji) mają większy wpływ na model. Krótkie "false positives" (przypadkowe otwarcie aplikacji) mają mniejszy wpływ.

---

### AI-10. Brak cross-app context w sesji

**Problem:** Model analizuje każdą sesję izolowannie per-aplikacja. Ale workflow często obejmuje wiele aplikacji: "VSCode + Terminal + Chrome z docs". Jeśli Chrome nie ma bezpośrednich danych o projekcie, model nie wie że Chrome session o 14:00 jest częścią tego samego workflow co VSCode session o 14:00.

**Sugestia:**
- Dodać Layer 5 "Concurrent Session Pattern": jeśli w tym samym oknie czasowym (±5 min) inna aplikacja jest przypisana do projektu X, to nieprzypisana sesja dostaje bonus 0.15 za projekt X.
- Implementacja: podczas scoring, query `sessions WHERE project_id IS NOT NULL AND start_time < :end AND end_time > :start AND app_id != :app_id`.

**Wpływ:** Lepsze przypisanie aplikacji "towarzyszących" (przeglądarka, komunikatory, terminale).

---

## Priorytetyzacja sugestii AI (impact × effort)

| # | Sugestia | Impact | Effort | Priorytet |
|---|----------|--------|--------|-----------|
| AI-1 | Stop-words + bigramy w tokenizacji | **Wysoki** | Niski | **P1** |
| AI-4 | Time decay w treningu | **Wysoki** | Średni | **P1** |
| AI-6 | Duration-weighted file overlap | **Wysoki** | Niski | **P1** |
| AI-9 | Session duration weighting | Średni | Niski | **P2** |
| AI-2 | Source-weighted tokeny | Średni | Niski | **P2** |
| AI-3 | Ostrzejszy sigmoid confidence | Średni | Niski | **P2** |
| AI-7 | Negatywny feedback w tokenach | Średni | Średni | **P2** |
| AI-10 | Cross-app concurrent context | Średni | Średni | **P2** |
| AI-5 | Silniejsza warstwa temporalna | Niski-średni | Niski | **P3** |
| AI-8 | Częstszy retrain / incremental | Niski | Średni | **P3** |

---

## Podsumowanie modułu AI

System jest dobrze zaprojektowany — 4 warstwy dowodów, feedback loop, rollback, blacklisting. Największe luki to:

1. **Brak rozróżniania jakości sygnałów** (AI-1, AI-2, AI-6, AI-9) — każdy token, plik i sesja są traktowane jednakowo.
2. **Brak time decay** (AI-4) — stare dane zatruwają model przy zmianie workflow.
3. **Naiwna tokenizacja** (AI-1) — stop-words rozmywają sygnał.

Implementacja P1 (AI-1, AI-4, AI-6) wymaga zmian głównie w `training.rs` i `scoring.rs` i da największy skok precision.
