# Plan implementacji refaktoru TIMEFLOW

Data przygotowania: 2026-03-09
Ostatnia weryfikacja: 2026-03-09 (Claude Opus 4.6 — ponowna analiza kodu)

Dokument powstal na bazie `refactor.md` oraz weryfikacji aktualnego kodu i checkow uruchomionych lokalnie.

## 0. Postep realizacji

Stan na 2026-03-09:

- [x] Faza 1: dodany wspolny helper `run_db_blocking()` w `dashboard/src-tauri/src/commands/helpers.rs` oparty o `spawn_blocking`.
- [x] Faza 1: dodany dodatkowy helper `run_app_blocking()` w `dashboard/src-tauri/src/commands/helpers.rs` do izolacji synchronicznych helperow DB i IO bez lokalnego powielania `spawn_blocking`.
- [x] Faza 1: przepiete wszystkie komendy z `dashboard/src-tauri/src/commands/dashboard.rs`, aby otwieraly SQLite poza watkiem async.
- [x] Faza 1: przepiety caly `dashboard/src-tauri/src/commands/sessions.rs` — wszystkie handlery async korzystajace z SQLite otwieraja polaczenie przez `run_db_blocking()`.
- [x] Faza 1: przepiety caly `dashboard/src-tauri/src/commands/assignment_model.rs` — training, scoring, auto-safe i rollback nie wykonuja juz bezposrednio SQLite na watku async.
- [x] Faza 1: przepiety caly `dashboard/src-tauri/src/commands/projects.rs` — CRUD projektow, sync folderow, auto-freeze i compact dzialaja przez `run_db_blocking()`.
- [x] Faza 1: przepiete `analysis.rs`, `estimates.rs` i `monitored.rs` — mniejsze handlery analityczne, estymacyjne i monitored apps korzystaja juz z helperow blokujacych.
- [x] Faza 1: przepiete `database.rs`, `settings.rs`, `import.rs`, `import_data.rs`, `export.rs`, `report.rs` i `daemon.rs` — backup/restore, import/export, refresh danych, raport projektu i status demona nie wykonuja juz synchronicznego SQLite na watku async.
- [x] Faza 1: zakonczony audit komend `async` w `dashboard/src-tauri/src/commands` — pozostale bezposrednie wywolania `db::get_connection()` sa tylko w helperach blokujacych albo w komendach synchronicznych (`manual_sessions.rs`), wiec kryterium fazy jest spelnione.
- [x] Weryfikacja: wpis `Stan na 2026-03-09 (sesja 2 — naprawa logiki podzialu sesji)` zostal potwierdzony w kodzie (`strip_split_markers()`, badge `GitBranch`, box `BrainCircuit`, klucze i18n, `sesje.md`) oraz checkami (`cargo test`, `npm run lint`, `npm test`, `npx tsc --noEmit`).
- [x] Faza 2: zakonczone rozbicie modulu sesji — wydzielone `sessions/manual_overrides.rs`, `sessions/mutations.rs`, `sessions/query.rs`, `sessions/rebuild.rs`, `sessions/split.rs` i `sessions/tests.rs`, a dawny root `sessions.rs` zostal zastapiony przez docelowy `sessions/mod.rs` z cienkimi wrapperami Tauri.
- [x] Faza 3: `suggest_session_split()` liczy kandydatow tylko z overlapu sesji (`last_seen > start_time` i `first_seen < end_time`), a gdy overlap nie daje minimum 2 projektow, fallback przechodzi na wspolny scoring AI przez synchroniczny helper `get_session_score_breakdown_sync()`.
- [x] Faza 3: fallback `analyze_session_projects()` zostal przepiety z `app_id + date` na overlap sesji, a `analyze_sessions_splittable()` korzysta z tej samej logiki per sesja, wiec nozyczki i auto-split opieraja sie na identycznych kryteriach.
- [x] Faza 3: `assignment_feedback` ma addytywna kolumne `weight REAL NOT NULL DEFAULT 1.0`; split single/multi zapisuje wage rowna ratio czesci, a reinforcement w `retrain_model_sync()` liczy `SUM(weight)` i uwzglednia zrodla `manual_session_split_part_1..5`.
- [x] Faza 3: zaktualizowane testy backendu (overlap, AI fallback, weight splitu, weighted retraining) oraz Help/i18n dla zmienionego zachowania split suggestion.
- [ ] Fazy 4-6 bez zmian implementacyjnych.

Stan na 2026-03-09 (sesja 2 — naprawa logiki podzialu sesji):

- [x] Fix: naprawiony format komentarzy przy podziale sesji w `sessions.rs` — dodana funkcja `strip_split_markers()` usuwajaca istniejace markery "Split N/M" przed dodaniem nowego, co zapobiega zagniezdzonej konkatenacji typu `"Split 2/2 (Split 1/2)"`. Jesli sesja miala komentarz uzytkownika, jest on zachowywany a marker dodawany po `|`.
- [x] Fix: dodana ikona `GitBranch` (niebieska) w `SessionRow.tsx` dla sesji z ustawionym `split_source_session_id` — widoczna w obu trybach (compact i full), z tooltipem informujacym o blokadzie ponownego podzialu.
- [x] UX: dodany komunikat o nauce AI w `MultiSplitSessionModal.tsx` — info box z ikona `BrainCircuit` pod paskiem podgladu informujacy uzytkownika, ze podział szkoli model AI i ze podzielone sesje nie moga byc ponownie dzielone.
- [x] i18n: dodane klucze `sessions.split_multi.learning_title`, `sessions.split_multi.learning_desc` i `sessions.split_badge` w obu localach (en/pl).
- [x] Dokumentacja: utworzony `sesje.md` z pelna analiza logiki podzialu sesji, zidentyfikowanymi problemami i planem naprawczym.
- Weryfikacja: `cargo check` OK, `npx tsc --noEmit` OK.

## 1. Stan po weryfikacji

### 1.1. Fakty potwierdzone

- Backend Tauri w `dashboard/src-tauri/src` ma wiele komend `async` (120+ zarejestrowanych w `lib.rs`), ale zadna nie uzywa `tokio::task::spawn_blocking` do izolacji blokujacego `rusqlite`.
- `dashboard/src-tauri/src/commands/sessions.rs` pozostaje monolitem: **2273 linii** (12 pub fn).
- `dashboard/src-tauri/src/commands/assignment_model.rs` pozostaje monolitem: **2412 linii** (17 pub fn, w tym 14 async).
- `dashboard/src-tauri/src/db.rs` jest duzym plikiem laczacym schema SQL (352 linii), migracje (~700 linii w jednej `run_migrations()`) i helpery polaczen: **1587 linii** lacznie.
- `dashboard/src-tauri/src/commands/projects.rs` rowniez jest znacznym plikiem: **1417 linii**, 20 pub fn — kandydat do przyszlego refaktoru (P2+).
- `db::get_connection()` otwiera nowe polaczenie per komenda (`rusqlite_open`). Przy WAL + `busy_timeout=5000` jest to poprawne, ale nie usuwa problemu blokowania watkow asynchronicznych przez synchroniczne zapytania.
- Logika `suggest_session_split()` ma **3-stopniowy fallback**: (1) file_activities z wyliczonym ratio, (2) current_project vs last feedback z ratio 0.5 i confidence 0.4, (3) pusty wynik z ratio 0.5 i confidence 0.0. Zaden z nich nie korzysta z warstw AI.

### 1.2. Fakty, ktore wymagaja korekty wzgledem `refactor.md`

- `analyze_session_projects()` nie jest juz czystym fallbackiem do `SUM(fa.total_seconds)`. Najpierw probuje uzyc `assignment_model::get_session_score_breakdown()`, a dopiero potem schodzi do danych z `file_activities`.
- `split_session_multi()` i `split_session()` juz zapisują `assignment_feedback`, aktualizuja `file_activities` i podbijaja `feedback_since_train`.
- Problem nie polega na braku zapisu feedbacku po split, tylko na tym, ze trening AI tego feedbacku jeszcze nie wykorzystuje.
- `Help.tsx` i locale juz zawieraja tresci o multi-split do 5 projektow. To nie jest blocker P0.

### 1.3. Zweryfikowane luki funkcjonalne

- Feedback ze splitu nie bierze udzialu w reinforcement training. `retrain_model_sync()` filtruje `assignment_feedback.source` do 8 typow (App Model) / 5 typow (Time Model) — lista: `manual_session_assign`, `manual_session_change`, `manual_project_card_change`, `manual_session_unassign`, `bulk_unassign`, `manual_app_assign`, `ai_suggestion_reject`, `ai_suggestion_accept`. Zrodla `manual_session_split_part_*` **nie sa uwzglednione**.
- W AI istnieje realna duplikacja logiki: `get_session_score_breakdown()` (linie 2223-2390) replikuje identyczne 4 warstwy z `compute_raw_suggestion()` (linie 620-768) — te same wagi (0.80/0.30/0.10/0.30), te same formuly `ln()`, te same chunki 200-tokenowe. Roznica: breakdown zwraca per-layer scores per projekt, a `compute_raw_suggestion()` zwraca tylko najlepszego kandydata.
- **Dwie funkcje** filtruja po calym dniu zamiast overlapu sesji: `suggest_session_split()` (WHERE `fa.app_id = ?1 AND fa.date = ?2`) oraz fallback w `analyze_session_projects()` (ten sam wzorzec). Natomiast `apply_split_side_effects()` juz poprawnie filtruje po `first_seen/last_seen` overlapie z oknem sesji.
- `assignment_feedback` nie ma kolumny `weight` — feedback jest wazony globalnym ustawieniem `feedback_weight` (default 5.0, gettery/settery istnieja: `get_feedback_weight()` i `set_feedback_weight()` linie 2394-2412).

### 1.4. Wynik checkow

Uruchomione lokalnie 2026-03-09:

- `cargo test` w repo root: 13/13 testow OK
- `cargo test` w `dashboard/src-tauri`: 14/14 testow OK
- `npm test` w `dashboard`: 3/3 testy OK
- `npm run lint` w `dashboard`: OK

Wniosek: baza jest obecnie stabilna, wiec plan mozna oprzec na refaktorze iteracyjnym, a nie naprawczym.

## 2. Cele implementacyjne

### P0

- Usunac blokujace operacje SQLite z watkow obslugujacych komendy async Tauri.
- Uporzadkowac `sessions.rs` bez zmiany publicznego API komend.
- Poprawic logike split suggestion tak, aby fallback korzystal z istniejacych warstw AI zamiast ze stalego `50/50`.
- Wlaczyc feedback ze splitu do treningu AI w sposob zgodny wstecznie z obecna baza.

### P1

- Rozbic `assignment_model.rs` tak, aby scoring, context building i training byly rozdzielone.
- Ograniczyc duplikacje logiki scoringu i uproscic testowanie warstw AI.
- Wyniesc bazowy schema SQL z `db.rs`, ale bez przebudowy systemu migracji.

### P2

- Dopracowac frontend dla nowych zachowan AI/split tylko tam, gdzie backend zmieni zachowanie lub dane.
- Uzupelnic dokumentacje Help/Quick Start jedynie w zakresie nowych funkcji, nie robic szerokiego rewrite.

## 3. Zasady realizacji

- Bez ORM. Zostajemy przy `rusqlite` i SQL.
- Bez destrukcyjnych migracji. Tylko migracje addytywne albo przepiecia tabel z kopiowaniem danych, jesli beda absolutnie konieczne.
- Bez zmiany nazw publicznych komend Tauri, chyba ze powstanie mocny powod i osobna decyzja.
- Najpierw helpery infrastrukturalne i testy, potem dopiero przesuwanie kodu miedzy plikami.
- Refaktor ma byc iteracyjny: po kazdej fazie zielone `cargo test` i `npm run lint`.

## 4. Kolejnosc prac

### Faza 1. Izolacja blokujacego SQLite w Tauri

Cel: wdrozyc jeden prosty wzorzec uruchamiania kodu DB poza watkami async.

Zakres:

- Rozszerzyc istniejacy `commands/helpers.rs` (obecnie 52 linie) o helper `db::run_blocking(app, |conn| { ... })`.
- Helper powinien:
  - klonowac `AppHandle`
  - otwierac polaczenie wewnatrz `spawn_blocking`
  - zwracac `Result<T, String>`
  - obslugiwac zarowno odczyty, jak i transakcje na `&mut Connection`
- Na poczatek przeniesc do helpera komendy najciezsze albo najczesciej wywolywane:
  - `sessions` (12 pub fn): `get_sessions`, `get_session_count`, `rebuild_sessions`, `suggest_session_split`, `analyze_session_projects`, `analyze_sessions_splittable`, `split_session`, `split_session_multi`, `assign_session_to_project`, `delete_session`
  - `assignment_model` (14 async pub fn): `train_assignment_model`, `suggest_project_for_session`, `run_auto_safe_assignment`, `rollback_last_auto_safe_run`, `apply_deterministic_assignment`, `get_session_score_breakdown`, `get_assignment_model_status`, `get_assignment_model_metrics`, `auto_run_if_needed`
  - `dashboard` (9 pub fn): `get_dashboard_stats`, `get_timeline`, `get_hourly_breakdown`, `get_applications`, `get_top_projects`, `get_dashboard_projects`, `get_activity_date_span`, `get_app_timeline`
  - `projects` (20 pub fn): `get_project_extra_info`, `sync_projects_from_folders`, `auto_create_projects_from_detection`, `get_projects`, `freeze_project`, `auto_freeze_projects`, `compact_project_data`
- W drugiej turze objac tym wzorcem pozostale komendy backendu korzystajace z `db::get_connection` (lacznie 120+ komend w 23 modulach `commands/`).

Dlaczego tak:

- To daje najwiekszy zysk wydajnosciowy i najmniejszy koszt ryzyka.
- Nie wymaga jeszcze connection poola.
- Pozwala zachowac biezace API i testy.

Kryterium zamkniecia fazy:

- W `dashboard/src-tauri/src/commands` nie ma juz komend `async`, ktore wykonują ciezki SQL bezposrednio na watku async.
- Testy nadal sa zielone.

## 5. Faza 2. Rozbicie `sessions.rs`

Cel: wydzielic logike biznesowa od handlerow komend, bez przepisywania wszystkiego naraz.

Docelowy podzial:

- `dashboard/src-tauri/src/commands/sessions/mod.rs`
  - cienkie handlery Tauri i re-export
- `dashboard/src-tauri/src/commands/sessions/query.rs`
  - `get_sessions`, `get_session_count`, filtry, pobieranie file activities
- `dashboard/src-tauri/src/commands/sessions/split.rs`
  - `suggest_session_split`, `split_session`, `split_session_multi`, `execute_session_split`, `apply_split_side_effects` (linie 1099-1179), `validate_split_parts` (linie 1258-1275), `load_split_source_session`, walidacje splitu
- `dashboard/src-tauri/src/commands/sessions/manual_overrides.rs`
  - `upsert_manual_session_override`, `apply_manual_session_overrides`
- `dashboard/src-tauri/src/commands/sessions/rebuild.rs`
  - `rebuild_sessions` i logika scalania/odtwarzania
- `dashboard/src-tauri/src/commands/sessions/tests.rs`
  - testy modulowe przeniesione z dolu pliku

Uwagi wykonawcze:

- Zostawic `sql_fragments.rs`, bo fragment `SESSION_PROJECT_CTE_ALL_TIME` juz jest sensownie wydzielony.
- Najpierw przenosic prywatne helpery, potem publiczne komendy.
- Po kazdym przeniesieniu utrzymac te same nazwy publicznych funkcji eksportowanych przez `commands/mod.rs`.

Kryterium zamkniecia fazy:

- `sessions/mod.rs` zawiera glownie handlery i importy.
- Testy splitow i CTE dalej przechodza bez zmian behawioralnych.

## 6. Faza 3. Poprawa split suggestion i feedback loop dla AI

Cel: wykorzystac istniejacy model AI do lepszego splitu oraz wlaczyc multi-split do treningu.

### 6.1. Uspojnienie zrodel danych do splitu

Do zrobienia:

- Wydzielic wewnetrzny helper, ktory zwraca kandydatow splitu dla sesji na podstawie:
  1. `file_activities` nachodzacych na zakres czasu sesji
  2. wspolnego scoringu AI warstw 0-3
  3. fallbacku do obecnego projektu / ostatniego feedbacku tylko jako ostatniej deski ratunku
- Zmienic `suggest_session_split()` tak, aby:
  - nie liczylo po calym `app_id + date`, tylko po overlapie z `start_time/end_time` (analogicznie do tego jak robi to `apply_split_side_effects` z filtrem `last_seen > ?3 AND first_seen < ?4`)
  - umialo zwrocic ratio wyliczone z wag kandydatow AI, gdy brak poprawnych `file_activities`
  - nie wracalo do stalego `0.5`, jesli AI ma nierowne score dla top2
- Analogicznie poprawic fallback w `analyze_session_projects()`, ktory rowniez uzywa `WHERE fa.app_id = ?1 AND fa.date = ?2` zamiast overlapu sesji

### 6.2. Wlaczenie feedbacku ze splitu do treningu

Kontekst: obecny system wazenia feedbacku opiera sie na globalnym `feedback_weight` (default 5.0), ktory mnozy `COUNT(*)` rekordow. Nie ma kolumny `weight` per rekord. Istniejace gettery/settery: `get_feedback_weight()` / `set_feedback_weight()`.

Dwie opcje (do wyboru):

**Opcja A — kolumna `weight` per rekord (rekomendowana):**
- Dodac kompatybilna migracje: `ALTER TABLE assignment_feedback ADD COLUMN weight REAL NOT NULL DEFAULT 1.0`
- Przy `split_session()` i `split_session_multi()` zapisywac `weight` proporcjonalnie do ratio danej czesci (np. ratio 0.7 → weight 0.7)
- W `retrain_model_sync()`: zamienic `COUNT(*)` na `SUM(weight)` w obu zapytaniach reinforcement (App Model linia ~1337, Time Model linia ~1394)
- Stare rekordy bez jawnego weight dostana DEFAULT 1.0 — brak regresji

**Opcja B — tylko dodanie zrodel do listy IN (prostsze):**
- Bez migracji schematu
- Dodac `'manual_session_split_part_1'` do `'manual_session_split_part_5'` do list `IN (...)` w obu zapytaniach reinforcement
- Kazdy split part liczy sie jako 1 rekord, niezaleznie od ratio

W obu opcjach:
- Zachowac dotychczasowe 8/5 zrodel manualnych i AI accept/reject
- Format zrodel splitu to `manual_session_split_part_{i+1}` (generowany w `apply_split_side_effects`)
- Nie uzywac `LIKE` — dodac jawna liste wartosci do `IN (...)`

### 6.3. Testy

Dodac lub zaktualizowac testy:

- `suggest_session_split` liczy overlap sesji, nie calego dnia
- fallback korzysta z AI score, gdy brak `file_activities`
- split multi zapisuje `assignment_feedback.weight`
- retraining uwzglednia weighted split feedback
- stare rekordy `assignment_feedback` bez `weight` nadal dzialaja po migracji

Kryterium zamkniecia fazy:

- Split suggestion nie zwraca slepego `50/50`, jesli model ma lepsze dane.
- Rekordy split feedback wplywaja na trening AI.

## 7. Faza 4. Rozbicie `assignment_model.rs`

Cel: usunac duplikacje logiki i zrobic modul AI latwiejszy w utrzymaniu.

Docelowy podzial KISS:

- `dashboard/src-tauri/src/commands/assignment_model/mod.rs`
  - publiczne handlery Tauri (14 async fn), re-export, typy odpowiedzi
- `dashboard/src-tauri/src/commands/assignment_model/context.rs`
  - `build_session_context`, tokenizacja, filtry danych wejsciowych
- `dashboard/src-tauri/src/commands/assignment_model/scoring.rs`
  - **wspolne** liczenie warstw 0-3 (wagi 0.80/0.30/0.10/0.30)
  - struktury `CandidateScore`, `SuggestionBreakdown`
  - jeden silnik scoringu uzywany przez:
    - `compute_raw_suggestion()` (obecne linie 620-768)
    - `get_session_score_breakdown()` (obecne linie 2223-2390 — **eliminacja duplikacji**)
    - split suggestion z Fazy 3
  - wspolna logika confidence (evidence_factor * sigmoid_margin)
- `dashboard/src-tauri/src/commands/assignment_model/training.rs`
  - `retrain_model_sync()` (obecne linie 1237-1546), reset, training horizon, blacklisty, reinforcement
- `dashboard/src-tauri/src/commands/assignment_model/auto_safe.rs`
  - auto-run, rollback, deterministic apply, `auto_run_if_needed`
- `dashboard/src-tauri/src/commands/assignment_model/config.rs`
  - `get_feedback_weight`, `set_feedback_weight`, `set_assignment_mode`, `set_training_horizon_days`, `set_training_blacklists`, `set_assignment_model_cooldown` — proste gettery/settery

Najwazniejszy efekt tej fazy:

- Zmiana wag warstw AI bedzie robiona w jednym miejscu, a nie w dwoch prawie identycznych implementacjach.

Kryterium zamkniecia fazy:

- Nie ma juz zdublowanej implementacji warstw scoringu.
- `get_session_score_breakdown()` i sugestie AI korzystaja z tego samego silnika.

## 8. Faza 5. Uporzadkowanie `db.rs`

Cel: zmniejszyc rozmiar pliku (1587 linii) bez ryzykownej przebudowy migracji.

Zakres:

- Wyniesc bazowy `SCHEMA` (352 linii, linie 6-357) do pliku typu `dashboard/src-tauri/resources/sql/schema.sql` i ladowac przez `include_str!`.
- Rozbic `run_migrations()` (~700 linii w jednej funkcji, linie 731-1430) na mniejsze funkcje, np.:
  - `migrate_file_activities_schema()`
  - `migrate_assignment_tables()`
  - `migrate_demo_mode_support()`
  - wyniesc `ensure_post_migration_indexes()` (linie 1431-1485) do osobnego modulu
- Zostawic helpery polaczen (`get_connection`, `get_primary_connection`, `rusqlite_open`) w `db.rs`.
- Nie wdrazac osobnego frameworka migracyjnego w tej iteracji.

Kryterium zamkniecia fazy:

- `db.rs` przestaje byc jednym duzym blokiem schema + migracje + connection helpers.
- `run_migrations()` sklada sie z wywolan mniejszych funkcji, a nie z jednego ciala 700-liniowego.
- Zachowana zostaje pelna zgodnosc z istniejacymi bazami danych.

## 9. Faza 6. Frontend i dokumentacja

Priorytet: niski, tylko pod backendowe zmiany.

Zakres:

- `MultiSplitSessionModal.tsx`
  - usunac twarde polskie fallbacki tam, gdzie odpowiednie klucze i18n juz istnieja
  - opcjonalnie pokazac, ze proporcje splitu staja sie sygnalem treningowym
- `Help.tsx` / locale
  - aktualizowac tylko wtedy, gdy split suggestion albo AI feedback beda zachowywaly sie inaczej z perspektywy uzytkownika
- Widget thumbs up/down dla AI:
  - traktowac jako osobny feature po backendowym uporzadkowaniu feedbacku
  - nie blokowac nim faz P0/P1

## 10. Ryzyka i ograniczenia

- `spawn_blocking` nie rozwiaze wszystkiego, jesli dlugie transakcje beda trzymaly locki SQLite (`busy_timeout=5000ms` ogranicza, ale nie eliminuje). To jednak i tak jest poprawa wzgledem obecnego stanu.
- Zbyt szybkie rozbijanie plikow bez helperow wspolnych moze chwilowo zwiekszyc duplikacje. Dlatego najpierw trzeba wprowadzic wspolne entry-pointy dla DB i scoringu.
- Migracja `assignment_feedback.weight` (jesli Opcja A) musi byc addytywna i bezpieczna dla istniejacych rekordow (`DEFAULT 1.0`).
- Nie ma potrzeby wprowadzac connection poola w pierwszej iteracji. `get_connection()` juz otwiera fresh connection per call, co przy WAL jest bezpieczne. Pool ocenic dopiero po `spawn_blocking` i pomiarach.
- Przy podziale `sessions.rs` na moduly: `commands/mod.rs` eksportuje wszystkie komendy przez `pub use` — trzeba zachowac te sciezki importow w `lib.rs` (120+ komend w `generate_handler![]`).
- `projects.rs` (1417 linii) celowo nie jest w P0/P1, ale moze stac sie waskym gardlem utrzymania w przyszlosci.

## 11. Definition of Done

Refaktor mozna uznac za zakonczony, gdy:

- ciezkie komendy Tauri nie wykonują juz blokujacego SQLite na watkach async
- `sessions.rs` i `assignment_model.rs` sa rozbite na mniejsze moduly
- split suggestion korzysta z overlapu sesji i/lub wspolnego scoringu AI
- feedback ze splitu trafia do treningu modelu
- migracje pozostaja zgodne wstecznie
- `cargo test` w root i `dashboard/src-tauri` sa zielone
- `npm test` i `npm run lint` w `dashboard` sa zielone

## 12. Rekomendowana kolejnosc wdrozenia do konsultacji

1. Faza 1: helper `spawn_blocking` + migracja najciezszych komend.
2. Faza 2: rozbicie `sessions.rs`.
3. Faza 3: poprawa split suggestion + weighted feedback dla splitu.
4. Faza 4: rozbicie `assignment_model.rs` i wspolny silnik scoringu.
5. Faza 5: uporzadkowanie `db.rs`.
6. Faza 6: frontend/help tylko jako domkniecie zmian backendowych.

To jest najbezpieczniejsza kolejnosc, bo najpierw redukuje ryzyko runtime i przygotowuje grunt pod refaktor plikow, a dopiero potem dotyka logiki AI i migracji danych.
