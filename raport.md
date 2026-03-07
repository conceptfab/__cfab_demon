# Raport audytu kodu TIMEFLOW

Data audytu: 2026-03-07
Zakres: logika, wydajnosc, optymalizacje, nadmiarowy kod, tlumaczenia i pokrycie Help/Pomoc.

## 1) Metodyka i walidacja

Przeglad obejmowal:
- backend Rust (daemon + Tauri commands),
- frontend React/TypeScript,
- warstwe i18n,
- zgodnosc funkcjonalnosci z dokumentacja Help.

Wykonane kontrole techniczne:
- `npm run lint` (dashboard): 12 problemow (11 error, 1 warning).
- `cargo check --manifest-path dashboard/src-tauri/Cargo.toml`: OK (kompilacja poprawna).

## 2) Podsumowanie wykonawcze

Najwazniejsze wnioski:
1. Wystepuje krytyczny blad SQL w sugestii podzialu sesji (`suggest_session_split`) powodujacy runtime error.
2. Logika splitowania sesji nie domyka petli uczenia AI (brak `assignment_feedback` dla splitu), a podzial nie aktualizuje mapowania `file_activities`.
3. Widoczne sa problemy jakosciowe frontendu potwierdzone lintem (setState w `useEffect`, puste bloki `catch`, problem z memoizacja callbacku).
4. Pliki i18n sa kompletne kluczowo (PL/EN: 757/757), ale nadal istnieja twardo zaszyte teksty i mieszanie strategii tlumaczen.
5. Help opisuje glownie funkcje "happy path"; brakuje opisu kilku realnych zachowan produkcyjnych (ACK pending, reseed, sync logging, tryby listy projektow w Sessions).

## 3) Znalezione problemy - priorytety

### P0 (krytyczne)

#### P0.1 - Bledna kolumna SQL w `suggest_session_split`
- Obszar: backend / podzial sesji.
- Dowod:
  - `dashboard/src-tauri/src/commands/sessions.rs:1224` uzywa `af.project_id`.
  - `dashboard/src-tauri/src/db.rs:233-234` w tabeli `assignment_feedback` istnieja `from_project_id` i `to_project_id` (brak `project_id`).
- Wplyw:
  - runtime SQL error (`no such column: af.project_id`) w funkcji podpowiedzi splitu,
  - fallback splitu (current project + suggested project) przestaje dzialac.
- Rekomendacja:
  - zamienic `af.project_id` na `af.to_project_id` (lub jawnie zdefiniowac semantyke ostatniego feedbacku),
  - dodac test jednostkowy dla tej sciezki zapytania.

### P1 (wysokie)

#### P1.1 - Split sesji nie zapisuje feedbacku do modelu i nie synchronizuje mapowania aktywnosci
- Obszar: backend / AI quality / spojnosc danych.
- Dowod:
  - split modyfikuje tylko `sessions`: `dashboard/src-tauri/src/commands/sessions.rs:1167-1194` oraz `1567-1595`.
  - standardowe przypisanie (`assign_session_to_project`) zapisuje dodatkowo:
    - update `file_activities`: `dashboard/src-tauri/src/commands/sessions.rs:748-755`,
    - insert `assignment_feedback`: `dashboard/src-tauri/src/commands/sessions.rs:773-776`.
- Wplyw:
  - po splicie AI nie dostaje sygnalu uczenia tak jak przy zwyklym przypisaniu,
  - mozliwa niespojnosc miedzy nowymi sesjami a projektem w aktywnosciach plikow,
  - ryzyko slabszej trafnosci sugestii po dluzszej pracy.
- Rekomendacja:
  - po splitcie emitowac feedback per czesc (`from_project_id -> to_project_id`),
  - doprecyzowac strategia aktualizacji `file_activities` dla przedzialow czasu splitu,
  - zrefaktoryzowac split do jednej wspolnej sciezki logiki (single + multi).

#### P1.2 - Brak indeksu po `assignment_feedback.session_id`
- Obszar: wydajnosc bazy.
- Dowod:
  - wielokrotne zapytania po `session_id`: `dashboard/src-tauri/src/commands/sessions.rs:278-279`, `304-305`, `1224`.
  - indeksy tabeli feedback obecnie: tylko `created_at`, `source`: `dashboard/src-tauri/src/db.rs:273-274`.
- Wplyw:
  - skanowanie tabeli przy rosnacej historii feedbacku,
  - rosnace opoznienia dla `get_sessions` i split suggestion.
- Rekomendacja:
  - dodac indeks: `CREATE INDEX IF NOT EXISTS idx_assignment_feedback_session ON assignment_feedback(session_id, created_at DESC);`.

#### P1.3 - Problemy React Hooks i ryzyko cascading renders
- Obszar: frontend / responsywnosc / stabilnosc.
- Dowod (`npm run lint`):
  - `react-hooks/set-state-in-effect`:
    - `dashboard/src/components/reports/ReportTemplateSelector.tsx:20`,
    - `dashboard/src/pages/Sessions.tsx:397`, `434`, `507`.
  - `react-hooks/preserve-manual-memoization`:
    - `dashboard/src/pages/Sessions.tsx:642`.
- Wplyw:
  - dodatkowe renderowania, niestabilne profile wydajnosci,
  - utrudniona optymalizacja przez React Compiler.
- Rekomendacja:
  - inicjalizowac state w lazy initializer zamiast sync `setState` w efektach,
  - przebudowac zaleznosci callbackow i usunac reczne memo tam, gdzie nie daje wartosci,
  - uruchamiac lint jako gate w CI.

### P2 (srednie)

#### P2.1 - Puste bloki `catch` i puste bloki kodu
- Obszar: diagnostyka i utrzymanie.
- Dowod:
  - `dashboard/src/components/sync/BackgroundServices.tsx:290`, `297`,
  - `dashboard/src/pages/Sessions.tsx:1765`, `1791`, `1817`.
- Wplyw:
  - ciche ukrywanie bledow,
  - trudniejsze debugowanie awarii synchro/UX.
- Rekomendacja:
  - logowanie z kontekstem (`warn/error`) i minimalny fallback,
  - dla localStorage: `catch (e) { console.warn(...) }`.

#### P2.2 - Problem typowania (`any`) w managerze ustawien
- Obszar: TypeScript hygiene.
- Dowod:
  - `dashboard/src/lib/user-settings.ts:32` (`normalize: (parsed: Partial<T> | any) => T`).
- Wplyw:
  - oslabienie gwarancji typow,
  - latwiejsze ukrycie regresji przy zmianie schematow ustawien.
- Rekomendacja:
  - zastapic `any` przez `unknown` + type-guardy per manager.

#### P2.3 - Potencjalnie kosztowna logika `get_sessions`
- Obszar: backend / skala danych.
- Dowod:
  - budowa i czyszczenie temp table `_fa_keys`: `dashboard/src-tauri/src/commands/sessions.rs:402-407`,
  - ladowanie aktywnosci po `(app_id, date)` i klonowanie ich do kazdej sesji: `479-482`,
  - iteracje overlap per plik i per sesja: `491-520`.
- Wplyw:
  - wzrost kosztu CPU i RAM przy duzych dniach/duzej liczbie plikow,
  - duze payloady do UI (powielanie tych samych list plikow na wiele sesji).
- Rekomendacja:
  - rozwazyc tryb "light sessions" bez `files` dla widokow zbiorczych,
  - przesunac czesc filtrowania overlap do SQL,
  - cachowac preagregacje (np. per `(app_id, date)` z TTL) dla powtarzalnych zapytan.

#### P2.4 - Podwojny mechanizm blokady sync
- Obszar: architektura sync.
- Dowod:
  - blokada w komponencie: `dashboard/src/components/sync/BackgroundServices.tsx:271`, `306`,
  - blokada globalna w bibliotece: `dashboard/src/lib/online-sync.ts:1242-1249`.
- Wplyw:
  - kod dziala, ale jest bardziej zlozony niz potrzebne,
  - trudniejsze reasonowanie o concurrency i retry.
- Rekomendacja:
  - zostawic jeden "source of truth" dla locka (preferencyjnie w `online-sync.ts`).

## 4) Nadmiarowy kod / dlug techniczny

1. Dublowanie logiki splitu:
- `split_session` i `split_session_multi` implementuja podobne kroki osobno (`dashboard/src-tauri/src/commands/sessions.rs:1102`, `1484`).
- Ryzyko: naprawa w jednej sciezce nie trafia do drugiej.

2. Rownolegly model i18n:
- Hook `useInlineT` jest jawnie oznaczony jako migracyjny/deprecated (`dashboard/src/lib/inline-i18n.ts:38-40`).
- W kodzie nadal wystepuje szeroko (30 uzyc).
- Ryzyko: niespojna terminologia, trudniejszy audyt tlumaczen i utrzymania.

3. Lokalna logika harmonogramow i timerow rozproszona po hookach `BackgroundServices`:
- Wiele mechanizmow cyklicznych i timeoutow w jednym komponencie (`dashboard/src/components/sync/BackgroundServices.tsx`).
- Ryzyko: zlozony lifecycle i regresje przy rozbudowie.

## 5) Tlumaczenia (i18n)

### 5.1 Stan kluczy
- `dashboard/src/locales/en/common.json`: 757 kluczy.
- `dashboard/src/locales/pl/common.json`: 757 kluczy.
- Braki kluczy: 0 po obu stronach.

### 5.2 Realne luki tlumaczen

1. Twarde stringi w podgladzie sekcji raportu:
- `dashboard/src/pages/Reports.tsx:24-29`, `39-49`, `60-66`, `97-99`, `109-114`, `138`, `150-151`, `209`.
- Wplyw: mieszanie jezykow i niespojne UX przy zmianie jezyka.

2. Twardy sufiks przy duplikowaniu szablonu:
- `dashboard/src/lib/report-templates.ts:98` -> `"(kopia)"`.
- Wplyw: w UI EN pojawia sie polski sufiks.

3. Czesciowa migracja i18n:
- Wiele miejsc opiera sie na inline parach PL/EN zamiast kluczy.
- Wplyw: brak centralnego glosariusza i wieksze ryzyko niespojnosci.

### 5.3 Rekomendacja i18n
- Etap 1: usunac hardcoded stringi z `Reports.tsx` i `report-templates.ts`.
- Etap 2: migrowac `useInlineT` -> `t('namespace.key')` (modulami).
- Etap 3: dodac test/skript CI: wykrywanie hardcoded stringow poza katalogiem locales.

## 6) Funkcjonalnosci nieopisane lub niedoprecyzowane w Help/Pomoc

### 6.1 Online Sync - zbyt ogolny opis
- Help zawiera glownie: URL + User ID + Token (`dashboard/src/pages/Help.tsx:1069-1070`).
- W Settings i logice sync istnieja dodatkowe zachowania, ktore nie sa czytelnie opisane:
  - `ACK pending` i statusy ack (`dashboard/src/pages/Settings.tsx:1276`, `1317-1318`; `dashboard/src/lib/online-sync.ts:549-556`),
  - scenariusz `server_snapshot_pruned` i reseed (`dashboard/src/pages/Settings.tsx:1293-1294`; `dashboard/src/lib/online-sync.ts:1159-1238`),
  - sync logging do pliku (`dashboard/src/pages/Settings.tsx:1073`; `dashboard/src/lib/online-sync.ts:1008-1053`),
  - powiazanie z Demo Mode (sync disabled) (`dashboard/src/lib/online-sync.ts:508-513`).

### 6.2 Sessions - brak opisu zaawansowanych trybow listy projektow
- Funkcja obecna: tryby `alpha_active`, `new_top_rest`, `top_new_rest` (`dashboard/src/pages/Sessions.tsx:1747-1801`).
- Brak odpowiedniego opisu w Help (sekcja Sessions opisuje split, AI, filtry, ale nie te tryby).

### 6.3 Auto-split - brak opisu ograniczen operacyjnych
- Implementacja auto-split dziala cyklicznie i ma limit per przebieg (`dashboard/src/components/sync/BackgroundServices.tsx:233`, `253-255`).
- Help opisuje funkcje splitu, ale nie komunikuje taktowania i limitu automatu.

## 7) Plan naprawczy (priorytety wdrozenia)

### Etap A - natychmiast (P0/P1)
1. Naprawa SQL w `suggest_session_split`.
2. Dodanie indeksu `assignment_feedback(session_id, created_at DESC)`.
3. Domkniecie split workflow: feedback + strategia synchronizacji `file_activities`.
4. Usuniecie bledow eslint (`set-state-in-effect`, `preserve-manual-memoization`, `no-empty`, `no-explicit-any`).

### Etap B - krotki horyzont
1. Refaktoryzacja splitu do wspolnej sciezki (single/multi).
2. Ograniczenie kosztu `get_sessions` (light mode + mniej duplikacji `files`).
3. Uproszczenie lockowania sync do jednego mechanizmu.

### Etap C - dokumentacja i i18n
1. Aktualizacja Help (Online Sync, ACK/reseed, sync logging, tryby listy projektow, auto-split cadence).
2. Migracja hardcoded tekstow i inline i18n do kluczy.

## 8) Sugestie testow po poprawkach

1. Test integracyjny `suggest_session_split` z danymi `assignment_feedback` (sprawdzenie fallbacku).
2. Test splitu (single i multi):
- poprawna suma czasu,
- poprawne przypisania projektow,
- oczekiwane wpisy feedbacku.
3. Test wydajnosciowy `get_sessions` na wiekszym wolumenie (np. 10k sesji, 100k file_activities).
4. Snapshot testy i18n dla PL/EN w Reports i Sessions.

## 9) Ocena koncowa

Kod ma dobre fundamenty (kompilacja backendu przechodzi, architektura jest modularna), ale wymaga pilnej korekty jednego bledu krytycznego SQL i kilku istotnych poprawek spojnosc/wydajnosc/jakosc frontendu. Najwiekszy zysk biznesowy i techniczny da szybkie domkniecie split workflow + porzadek w sync/i18n + aktualizacja Help pod rzeczywiste zachowania systemu.

## 10) Status wdrozenia (2026-03-08)

Wdrozone:
- [x] P0.1: poprawiono SQL w `suggest_session_split` (`af.to_project_id` zamiast nieistniejacego `af.project_id`).
- [x] P1.1: split (single + multi) zapisuje `assignment_feedback`, aktualizuje `file_activities` i odswieza manual overrides.
- [x] P1.2: dodano indeks `idx_assignment_feedback_session(session_id, created_at DESC)` (schema + post-migration indexes).
- [x] P1.3/P2.1/P2.2: usuniete bledy eslint (`set-state-in-effect`, `preserve-manual-memoization`, `no-empty`, `no-explicit-any`).
- [x] Dodano test regresyjny dla fallbacku split-suggestion (`split_suggestion_fallback_reads_latest_to_project_id`).
- [x] i18n quick-fix: suffix duplikatu szablonu zmieniony z `"(kopia)"` na `"(copy)"`.
- [x] Etap C.1: zaktualizowano Help (Online Sync ACK/reseed/sync logging, tryby listy projektow w Sessions, cadence i limity auto-split).
- [x] Etap C.2 (zakres raportu): usunieto twarde stringi z preview sekcji w `Reports.tsx` (PL/EN przez `tt(...)`).
- [x] Etap B.1: split single/multi zrefaktoryzowany do wspolnej sciezki wykonania (`execute_session_split`).
- [x] Etap B.2: dodano tryb lekki `get_sessions` (`includeFiles`) i wlaczono go tam, gdzie szczegoly plikow nie sa potrzebne (Dashboard + auto-split background).
- [x] Etap B.3: uproszczono lockowanie sync do jednego source of truth (`online-sync.ts`), usuwajac lokalny lock z `BackgroundServices`.
- [x] Etap C.3: dodano skrypt detekcji hardcoded PL stringow poza `locales` z baseline (gate na nowe regresje).

Walidacja po wdrozeniu:
- `npm run lint` -> OK
- `npm run build` -> OK
- `cargo check --manifest-path dashboard/src-tauri/Cargo.toml` -> OK
- `cargo test --manifest-path dashboard/src-tauri/Cargo.toml split_suggestion_fallback_reads_latest_to_project_id` -> OK
- `cargo test --manifest-path dashboard/src-tauri/Cargo.toml` -> OK (12/12)
