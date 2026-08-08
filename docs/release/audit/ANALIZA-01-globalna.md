# ANALIZA 01 — globalna

**Data:** 2026-08-08 · **Gałąź:** `stable_1.6` · **Commit:** `1aeaf32` · **Wersja:** `0.1.5760`

**Cel etapu:** ustalić kształt systemu, granice odpowiedzialności i **gdzie kopać w etapie 2**. To nie jest lista błędów — to mapa terenu z zaznaczonymi miejscami podwyższonego ryzyka.

**Metoda:** statyczny przegląd całego repo (struktura modułów, kierunki zależności, powierzchnia API, rozkład testów), plus punktowa weryfikacja twierdzeń z dokumentacji projektu (`PARITY.md`, `SECURITY_AUDIT.md`, `CLAUDE.md`) przeciwko kodowi. Bez uruchamiania aplikacji, bez profilowania — to należy do etapu 2.

**Czego ta analiza NIE obejmuje:** poprawności algorytmów w szczegółach, wydajności zmierzonej, testów manualnych na dwóch maszynach, przeglądu bezpieczeństwa endpoint po endpoincie. Wszystko to jest świadomie odłożone do etapu 2.

---

## 1. Skala i kształt systemu

| Wymiar | Wartość |
|---|---|
| Rust — kod własny (bez `target/`) | ~57 000 linii |
| TypeScript/TSX (`dashboard/src`) | ~58 800 linii |
| Crate'y w workspace | 3: `timeflow-demon`, `timeflow-dashboard`, `timeflow-shared` |
| Komendy Tauri (`#[tauri::command]`) | **206** zdefiniowanych, **221** zarejestrowanych w `invoke_handler`, **220** w moście webui |
| Moduły komend | 32 (`dashboard/src-tauri/src/commands/`) |
| Migracje bazy | 27 (`m01` … `m27`) |
| Pliki źródłowe frontu | 469 |
| Pliki testowe frontu | 30 |
| Pliki Rust z `#[cfg(test)]` | 50 |
| Commity w ostatnich 90 dniach | 274 |

**Wniosek o skali:** to nie jest prototyp. 206 komend i 27 migracji to powierzchnia produktu w fazie dojrzałej — i to jest główny czynnik ryzyka: **każda zmiana w rdzeniu dotyka wielu miejsc jednocześnie**, a rdzeń (czas, sync) jest wspólny dla trzech niezależnych konsumentów: desktopu, webui i demona.

---

## 2. Architektura — mapa warstw

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONT (dashboard/src)                                           │
│  26 stron · 48 hooków-kontrolerów · 6 store'ów Zustand            │
│  lib/ = czysta logika (rounding, report-*, sessions-grouping…)    │
└────────────┬──────────────────────────────┬──────────────────────┘
             │ invoke() (desktop)           │ HTTP RPC (webui/telefon)
             ▼                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  DASHBOARD BACKEND (dashboard/src-tauri/src)                     │
│  commands/ (32 moduły, 206 komend)                               │
│  db.rs + db_migrations/ (m01–m27)  ← WŁAŚCICIEL SCHEMATU         │
│  webui/ (serwer HTTP + auth + rpc_generated)                     │
│  mcp/ (serwer MCP — narzędzia sterujące danymi)                  │
└────────────┬──────────────────────────────┬──────────────────────┘
             │                              │
             ▼                              ▼
┌──────────────────────────┐   ┌────────────────────────────────────┐
│ SHARED (timeflow-shared) │   │  DEMON (src/)                       │
│ sync/ (merge, checksum,  │◄──┤  monitor + tracker (zbieranie)      │
│   triggers, columns)     │   │  lan_server + lan_sync_orchestrator │
│ daily_store/             │   │  online_sync + store_forward        │
│ timeflow_paths           │   │  sync_common.rs (3668 linii)        │
│ title_parser             │   │  platform/{macos,windows}/          │
└──────────────────────────┘   └────────────────────────────────────┘
             │                              │
             └──────────► SQLite ◄──────────┘
               ~/Library/Application Support/TIMEFLOW/
                (współdzielona baza — oba procesy piszą)
```

### Przepływ danych

1. **Zbieranie:** demon (`monitor` → `tracker` → `activity`) obserwuje aktywne okno i pliki, zapisuje dzienne snapshoty do `daily_store` (SQLite, `shared/daily_store/`).
2. **Materializacja:** dashboard czyta snapshoty przez `commands/daily_store_bridge.rs` i buduje z nich sesje (`sessions/rebuild.rs`) w głównej bazie.
3. **Interpretacja:** `commands/time_algorithm.rs` zamienia sesje na czas per projekt (host + strategia + rejestr).
4. **Prezentacja:** front formatuje i nakłada zaokrąglenie prezentacyjne (`lib/rounding.ts`).
5. **Rozgałęzienie:** ta sama baza jest źródłem dla synchronizacji LAN/online — **ale przez dwie niezależne implementacje eksportu** (dashboard: serde; demon: ręczne składanie JSON).

---

## 3. Co jest mocne — i dlaczego to ma znaczenie dla audytu

Zapisuję to jawnie, bo audyt, który wymienia tylko problemy, jest niewiarygodny i prowadzi do przebudowy rzeczy, które działają.

| Obszar | Ocena | Dowód |
|---|---|---|
| **Świadomość jednego źródła prawdy** | Wysoka | `time_algorithm.rs` ma jawną architekturę HOST/STRATEGY/REGISTRY z komentarzem „single physical home". `shared/sync/columns.rs` istnieje właśnie po to, by zlikwidować „5 miejsc na kolumnę" |
| **Granica błędów** | Spójna | **185 na 185** komend zwracających `Result` używa `CommandError` z kodami (`not_found`, `conflict`, `validation`, `io`, `db`) — front dostaje ustrukturyzowany błąd, nie goły string |
| **Dokumentacja ryzyk** | Nietypowo dobra | `PARITY.md` opisuje realne pułapki (dwa eksporty, `ensure_m26_entity_tables`, pola per-maszyna `gcal_*`) z nazwami testów, które ich pilnują |
| **Testy inwariantów sync** | Obecne | `merge_roundtrip_project_costs_via_daemon_export`, `merge_todos_never_touches_gcal_fields`, `todos_hash_ignores_gcal_fields`, asercja zbieżności `table_hashes` w `sync_common.rs:1754` |
| **Testy logiki prezentacyjnej** | Obecne | `report-consistency.test.ts` sprawdza, że suma dni po zaokrągleniu = zaokrąglona suma całkowita — dokładnie właściwy inwariant |
| **Bramki i18n** | Trzy niezależne | `check-hardcoded-i18n`, `check-inline-i18n-bridge`, `check-locale-consistency` — wszystkie w CI |
| **Logowanie** | Zdyscyplinowane | 445 wywołań `log::*` vs 26 `println!/eprintln!` poza testami |
| **Migracje** | Numerowane, przyrostowe | m01–m27 z triggerami tombstone re-eksportowanymi przy każdym merge |

**Konsekwencja dla etapu 2:** nie zaczynamy od przebudowy architektury. Zaczynamy od sprawdzenia, czy deklaracje z tej tabeli są prawdziwe **wszędzie**, czy tylko tam, gdzie ktoś ostatnio patrzył.

---

## 4. Obszary podwyższonego ryzyka — ustalenia globalne

Numeracja `G-xx` (globalne). Każde ma dowód i wskazanie, co dokładnie zweryfikować w etapie 2.

### G-01 · Rdzeń liczący czas ma jednego właściciela, ale wielu konsumentów liczących samodzielnie

**Dowód:** `time_algorithm.rs` deduplikuje nakładające się przedziały i dzieli czas współbieżny (`effective_by_source` z jawnym niezmiennikiem). Równolegle `SUM(...)` po czasie pojawia się w `commands/dashboard.rs`, `commands/report.rs`, `commands/clients.rs`, `commands/estimates.rs`, `commands/analysis.rs`. Po stronie frontu logika agregująca żyje w `timeline-calculations.ts` (628 linii), `useTimeAnalysisData.ts` (528), `report-timeline.ts`, `sessions-grouping.ts`, `pm-projects-list-utils.ts`.

**Dlaczego to ryzyko:** proste `SUM(duration_seconds)` i przejście przez strategię dają **różne liczby** przy nakładających się sesjach. Jeśli dwa ekrany pokazują „czas projektu X" różnymi drogami, użytkownik zobaczy dwie różne liczby dla tej samej rzeczy.

**Do weryfikacji w etapie 2:** dla każdego miejsca — czy liczba trafia na ekran, czy backend zwraca ją już inną komendą, i czy obie drogi dają ten sam wynik przy włączonym zaokrągleniu.

---

### G-02 · `TableHashes` — trzy niezależne definicje, jedna z realnym błędem

**Dowód:**
- `src/lan_server.rs:43` (demon) — 9 pól,
- `dashboard/src-tauri/src/commands/delta_export.rs:11` (dashboard) — 9 pól, inna kolejność,
- `dashboard/src/lib/online-sync-types.ts` — typ TS.

Dodatkowo `src/lan_server.rs:1804` ma **ręcznie pisany** `impl PartialEq`, który porównuje 7 z 9 pól — pomija `assignment_feedback` i `assignment_auto_runs`.

**Dlaczego to ryzyko:** `PARITY.md` sam nazywa ten typ pominięcia najgroźniejszym — rozjazd danych nie zostaje wykryty, a peery raportują „zsynchronizowane". Uwaga: obecnie ten `impl` nie ma czynnych wywołań w kodzie produkcyjnym, więc **skutek jest dziś potencjalny, nie czynny** — ale jest to bomba z opóźnionym zapłonem: pierwszy kod, który porówna `TableHashes`, odziedziczy błąd po cichu.

**Do weryfikacji w etapie 2:** czy zestawy pól w trzech definicjach są zgodne; czy istnieje jakakolwiek ścieżka porównująca hashe, która używa tego `impl`.

---

### G-03 · Demon i dashboard mają rozłączne schematy tej samej bazy

**Dowód:** dashboard jest właścicielem schematu (`db_migrations/m01`–`m27`). Demon ma własny, ręcznie pisany zestaw `CREATE TABLE` w `src/sync_common.rs` (m.in. `clients`, `project_costs`, `todos`) i **nie uruchamia migracji dashboardu**. `PARITY.md` dokumentuje, że to już raz wysadziło cały merge na `no such table` — obejściem jest `ensure_m26_entity_tables` wołane przed pętlą triggerów.

**Dlaczego to ryzyko:** obejście jest punktowe (dotyczy m26). Każda przyszła migracja dodająca tabelę synchronizowaną powtórzy ten sam błąd, a objaw — padnięcie **całego** merge, nie tylko nowej encji — jest nieproporcjonalny do przyczyny.

**Do weryfikacji w etapie 2:** pełna lista tabel, które demon musi znać; czy `verify_merge_integrity` (który celowo nie dostaje `ensure_*`) jest na to odporny.

---

### G-04 · `panic = "abort"` w profilu release przy dużej liczbie punktów paniki

**Dowód:** `Cargo.toml` ustawia `panic = "abort"` dla `[profile.release]`. Skan `.unwrap()` / `.expect(` / `panic!(` w kodzie Rust daje ~1096 trafień, z koncentracją w `src/sync_common.rs` (252), `commands/import_data.rs` (102), `commands/projects.rs` (100), `shared/sync/merge.rs` (93). Część z nich leży w blokach testowych — dokładny podział wymaga narzędzia odsiewającego `#[cfg(test)]`, czego ta analiza nie robiła.

**Dlaczego to ryzyko:** z `panic = "abort"` panika **nie rozwija stosu** — proces ginie natychmiast, bez `Drop`, bez domknięcia transakcji SQLite, bez komunikatu dla użytkownika. Miejsca o najwyższym ryzyku to te, które przetwarzają dane spoza kontroli programu: import archiwum od użytkownika, merge archiwum od peera, odczyt uszkodzonej bazy.

**Do weryfikacji w etapie 2:** ile z tych trafień leży na ścieżce produkcyjnej (nie w testach) i ile z nich może wystrzelić na danych zewnętrznych.

**Ocena wstępna: to jest najpoważniejsze pojedyncze ryzyko wydania.**

---

### G-05 · Most webui cicho pomija komendy, których nie umie przenieść

**Dowód:** `dashboard/src-tauri/scripts/gen_webrpc.cjs` pomija komendy przyjmujące `Window`/`WebviewWindow`/`State` (typy niedeserializowalne z JSON) — wypisuje je jako `Skipped:` i **generuje poprawny plik**, więc `--check` przechodzi. Porównanie rejestracji potwierdza dokładnie jedną taką komendę: **`print_report`** jest w `invoke_handler`, nie ma jej w moście webui.

**Dlaczego to ryzyko:** pominięcie jest technicznie uzasadnione, ale **niewidoczne dla użytkownika**. Na telefonie przycisk drukowania raportu istnieje w UI i nie ma jak zadziałać. `PARITY.md` opisuje ten mechanizm jako źródło „cicho NIE działa w webui".

**Do weryfikacji w etapie 2:** czy front wie, że jest w trybie webui, i czy ukrywa albo wyjaśnia funkcje niedostępne w tym trybie; czy `print_report` to jedyny taki przypadek dziś i co się stanie przy następnej komendzie z `Window`.

---

### G-06 · Rozjazd między dokumentacją powierzchni API a kodem

**Dowód:** komentarz-spis w `commands/mod.rs` deklaruje „**Total: 171 registered tauri commands across 29 modules**". Faktycznie jest **206** definicji `#[tauri::command]` i **221** wpisów w `invoke_handler`, a trzy moduły (`costs`, `todos`, `mcp_server`) są w `pub use`, ale **nie mają wpisu w spisie**.

**Dlaczego to ryzyko:** spis jest w kodzie opisany jako „EXPLICIT command surface" — czyli pełni rolę dokumentacji, na której ktoś polega. Rozjazd o ~35 komend znaczy, że przestał być odświeżany, a to podważa zaufanie do reszty komentarzy w tym pliku.

**Do weryfikacji w etapie 2:** czy spis da się wygenerować automatycznie (jak `rpc_generated.rs`), zamiast utrzymywać ręcznie.

---

### G-07 · Definicje kolumn scentralizowane tylko dla jednej encji z dziewięciu

**Dowód:** `shared/sync/columns.rs` zawiera `PROJECT_COLUMNS` + `PROJECT_SELECT` z testem strażniczym i komentarzem „finding #10 — 5 miejsc na kolumnę". Jest to **jedyna** encja tam obecna. Tymczasem `FROM sessions` występuje w **32 plikach**.

**Dlaczego to ryzyko:** wzorzec został poprawnie zaprojektowany i zastosowany raz. Dla pozostałych encji (`sessions`, `applications`, `manual_sessions`, `clients`, `project_costs`, `todos`, `assignment_feedback`, `assignment_auto_runs`) dodanie kolumny nadal wymaga trafienia w kilka miejsc — a pominięcie któregoś oznacza kolumnę, która się nie synchronizuje.

**Do weryfikacji w etapie 2:** dla każdej encji — ile realnie miejsc trzeba dotknąć i czy listy kolumn są dziś identyczne (rozjazd = kolumna już się nie synchronizuje).

---

### G-08 · Bramki jakości istnieją, ale część z nich nic nie blokuje

**Dowód w `.github/workflows/ci.yml`:**

| Bramka | Stan |
|---|---|
| `cargo test --workspace` | ✅ działa |
| `npm run typecheck / lint / lint:knip / test` | ✅ działa |
| `gen_webrpc.cjs --check` | ✅ działa |
| `react-doctor` | ✅ działa |
| `cargo clippy` | ❌ **nie jest uruchamiany wcale** |
| `cargo fmt --check` | ❌ **nie jest uruchamiany wcale** |
| `npm audit --omit=dev \|\| true` | ❌ `\|\| true` — **zawsze zielone** |
| `cargo deny check advisories bans` | ⚠️ bez `licenses` i `sources` |
| Windows | ⚠️ tylko `cargo build -p timeflow-demon` — **żadnych testów** |
| Spójność `VERSION` z 5 manifestami | ❌ brak bramki; sync tylko w `pretauri` |

**Dlaczego to ryzyko:** cztery z tych pozycji dają **złudzenie** pokrycia. Kod Windows jest kompilowany, ale nigdy nie wykonywany w CI — a to właśnie platforma, na której `PARITY.md` ma dwa TODO z adnotacją „NIEZWERYFIKOWANE".

---

### G-09 · Audyt bezpieczeństwa zdefiniowany, ale niewykonany

**Dowód:** `docs/SECURITY_AUDIT.md` zawiera dojrzałą metodykę (7 oczekiwań na endpoint) i macierz **21 endpointów** LAN/online. Kolumna „Reviewed?" ma **`[ ]` we wszystkich 21 wierszach**. Kolumna „Released in" jest pusta w całości.

Dodatkowo lista endpointów bez uwierzytelnienia jest długa i obejmuje pozycje mutujące stan lub wyzwalające sync: `/lan/store-paired-device`, `/lan/remove-paired-device`, `/lan/trigger-sync`, `/online/trigger-sync`, `/online/cancel-sync`, `/lan/generate-pairing-code`.

**Dlaczego to ryzyko:** demon wystawia serwer HTTP w sieci lokalnej. Endpointy bez AuthN, które modyfikują listę sparowanych urządzeń albo wyzwalają synchronizację, to powierzchnia, którą trzeba świadomie uzasadnić — albo zamknąć.

**Do weryfikacji w etapie 2:** przejście macierzy endpoint po endpoincie; osobno powierzchnia `webui/` (serwer HTTP z `lan_exposure`) i `mcp/` (narzędzia sterujące danymi).

---

### G-10 · Rozkład testów: mocny w rdzeniu, rzadki w warstwie prezentacji

**Dowód:** front — 30 plików testowych na 469 źródłowych. Testy koncentrują się w `lib/` (logika czysta: `rounding`, `report-*`, `sessions-grouping`, `costs-utils`, `estimate-report`) — czyli **dokładnie tam, gdzie powinny**. Rust — 50 plików z `#[cfg(test)]`, z gęstym pokryciem sync (`sync_common.rs`, `merge.rs`, `checksum.rs`).

**Czego brakuje:** testów **międzymodułowych** — nikt nie sprawdza, że Dashboard i Time Analysis pokazują tę samą liczbę dla tego samego projektu. Testy jednostkowe pilnują modułów osobno; inwariant „ta sama liczba wszędzie" nie ma dziś strażnika.

**Ocena:** to nie jest problem ilości testów. To brak **jednej kategorii** testów — i akurat tej, która pilnowałaby głównego wymagania („nie może być dwóch algorytmów do liczenia tej samej rzeczy").

---

### G-11 · Koncentracja złożoności w kilku plikach

**Dowód:**

| Plik | Linie |
|---|---|
| `src/sync_common.rs` | 3 668 |
| `dashboard/src-tauri/src/commands/projects.rs` | 2 765 |
| `dashboard/src-tauri/src/commands/import_data.rs` | 2 397 |
| `src/lan_server.rs` | 2 060 |
| `shared/sync/merge.rs` | 1 653 |
| `dashboard/src-tauri/src/commands/assignment_model/` (7 plików) | 4 408 łącznie |
| `dashboard/src/hooks/useProjectsPageController.tsx` | 854 |

**Dlaczego to ryzyko:** trzy z czterech największych plików Rusta to **dokładnie te**, które mają najwięcej punktów paniki (G-04) i obsługują dane zewnętrzne. Wielkość sama w sobie nie jest wadą — ale koncentracja „duży plik × dane niezaufane × panika = abort" jest.

**Uwaga:** `docs/TODO.md` notuje „refactor duży plików" jako otwarty punkt. Podział przed wydaniem to ryzyko regresji — rekomendacja wstępna: **nie dzielić teraz**, tylko usunąć z tych plików punkty paniki.

---

### G-12 · Sygnały higieniczne — drobne, ale warte zapisania

| Ustalenie | Dowód | Skutek |
|---|---|---|
| `.gitignore` ignoruje `dashboard/src-tauri/Cargo.toml`, który **jest śledzony** | `.gitignore` ostatnia sekcja vs `git ls-files` | Dziś bez skutku; pułapka przy `git rm --cached` |
| Erozja typów błędów wewnątrz modułów | 614 × `map_err(\|e\| e.to_string())` przy w pełni spójnej granicy `CommandError` | Kontekst błędu ginie zanim dotrze do granicy; diagnostyka trudniejsza |
| 49 × `eslint-disable`, 37 × `#[allow(...)]` | grep | Do przejrzenia: które są uzasadnione, a które maskują |
| 19 × TODO/FIXME/HACK w kodzie | grep | Mała liczba — dobry znak; warto domknąć przed wydaniem |
| 10 × `console.*` we froncie | grep | Do sprawdzenia, czy nie trafiają do builda produkcyjnego |
| 0 × `any` w TypeScript | grep | **Bardzo dobry wynik** — typowanie utrzymane |

---

## 5. Podsumowanie oceny globalnej

**Stan ogólny:** kod jest dojrzały, dobrze udokumentowany w miejscach najtrudniejszych i ma świadomie zaprojektowane granice. Nie wymaga przebudowy architektury.

**Charakter ryzyka:** nie leży w tym, że rozwiązania są złe — leży w tym, że **dobre rozwiązania są zastosowane punktowo**. Wzorzec centralizacji kolumn zastosowany raz z dziewięciu. Test inwariantu sync napisany dla dwóch encji z dziewięciu. Metodyka audytu bezpieczeństwa spisana dla 21 endpointów i wykonana dla zera. To jest wzorzec „zaczęte i niedokończone", nie „zrobione źle".

**Trzy ryzyka o najwyższym priorytecie, w kolejności:**

1. **G-04** — `panic = "abort"` na ścieżkach przetwarzających dane zewnętrzne. Skutek: utrata danych bez komunikatu.
2. **G-01** — wiele dróg do jednej liczby (czas → pieniądze). Skutek: użytkownik fakturuje z liczby, która na innym ekranie wygląda inaczej.
3. **G-09** — niewykonany audyt bezpieczeństwa serwera HTTP w LAN. Skutek: nieznana powierzchnia ataku.

**Ryzyko systemowe (przecina wszystkie):** G-08 — brak działających bramek oznacza, że każda naprawa może zostać cofnięta następnym commitem i nikt tego nie zauważy. **Dlatego etap 2 musi zaczynać się od bramek, nie od napraw.**

---

## 6. Zakres etapu 2 — analiza szczegółowa

Kolejność wynika z zależności (nie da się ocenić kwot bez oceny czasu) i z priorytetu ryzyka.

| # | Obszar analizy szczegółowej | Wynika z | Produkt |
|---|---|---|---|
| **2.0** | Bramki: clippy, fmt, spójność wersji, audyt zależności, testy na Windows | G-08 | Działające CI, `BASELINE.md` z liczbami wyjściowymi |
| **2.1** | **Obliczenia czasu** — inwentaryzacja każdego miejsca liczącego, mapa „która liczba skąd" | G-01, G-10 | Rejestr inwariantów + tabela miejsc z werdyktem |
| **2.2** | **Punkty paniki** — odsianie testów, klasyfikacja A/B/C, ocena ekspozycji na dane zewnętrzne | G-04, G-11 | Tabela z klasą i skutkiem dla każdego trafienia na ścieżce produkcyjnej |
| **2.3** | **Definicje danych** — macierz encji: schemat / kolumny / eksport ×2 / checksum / merge / typ TS | G-02, G-03, G-07 | Macierz z liczbą miejsc na encję |
| **2.4** | **Synchronizacja** — obie ścieżki eksportu, tombstony, idempotencja, kompatybilność wersji | G-02, G-03 | Macierz wpięcia encji + lista scenariuszy międzywersyjnych |
| **2.5** | **Pieniądze** — kanoniczna reguła: czas × mnożnik × stawka + koszty, pod zaokrągleniem | G-01 | Jedna reguła + weryfikacja per moduł |
| **2.6** | **Bezpieczeństwo** — 21 endpointów × 7 oczekiwań, plus webui i MCP | G-09 | Wypełniona macierz `SECURITY_AUDIT.md` |
| **2.7** | **Wydajność** — profil SQL, indeksy, renderowanie, bundel, zasoby demona | — | Tabela wolnych zapytań + porównanie z baseline |
| **2.8** | **Parity + webui** — realny build Windows, tryb webui a niedostępne funkcje | G-05, G-08 | `PARITY.md` bez „NIEZWERYFIKOWANE" |
| **2.9** | **Nadmiar** — martwy kod, abstrakcje bez drugiego użytkownika, spis komend | G-06, G-12 | Tabela abstrakcji z werdyktem |
| **2.10** | **UI/i18n/Help** — pokrycie pomocy, stany ekranów, terminologia | — | Tabela pokrycia Help.tsx |

**Produkt końcowy etapu 2:** komplet tabel ustaleń z priorytetami (`P0`–`P4`) — surowiec dla etapu 3.

**Produkt etapu 3:** jeden spójny plan napraw, uporządkowany **nie według obszarów analizy, lecz według kolejności bezpiecznego wykonania** — tak, by każdy krok zostawiał aplikację w stanie zdatnym do wydania.

---

## 7. Zastrzeżenia do tej analizy

Zapisane, żeby etap 2 nie oparł się na moich niesprawdzonych twierdzeniach:

- Liczba ~1096 punktów paniki (G-04) **obejmuje bloki testowe**. Realna liczba na ścieżce produkcyjnej jest niższa i wymaga narzędzia odsiewającego `#[cfg(test)]`. Nie traktuj tej liczby jako ustalenia — tylko jako sygnał skali.
- Twierdzenie, że `impl PartialEq for TableHashes` nie ma dziś czynnych wywołań (G-02), opiera się na wyszukiwaniu tekstowym. Wywołanie pośrednie (przez generyk, `assert_eq!` w kodzie produkcyjnym, porównanie w kolekcji) mogło mi umknąć.
- Nie uruchamiałem aplikacji ani nie profilowałem. Wszystkie stwierdzenia o wydajności są hipotezami do sprawdzenia w 2.7.
- Nie weryfikowałem poprawności algorytmu przypisań AI (`assignment_model/`, 4408 linii). `docs/TODO.md` notuje wątpliwości autora co do jego rdzenia — to zasługuje na osobną, dedykowaną analizę, której **nie ma w zakresie etapu 2** i którą trzeba świadomie zaplanować albo świadomie odłożyć.
