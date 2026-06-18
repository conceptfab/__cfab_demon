# RAPORT — LAN sync zapętla się i nie kończy („Project name is blacklisted")

Data: 2026-06-18. Diagnoza wykonana z maszyny Windows `192.168.1.73`.
Druga maszyna: macOS `192.168.1.98` (`/Users/micz/__DEV__/__cfab_demon`).

## 1. Objaw
LAN sync „startuje, ale nigdy się nie kończy". W rzeczywistości **nie wisi — pętli się**: sekwencja dochodzi do kroku **[12/13]**, pada, i cały sync rusza od nowa (`[2/13] Preflight...`) co ~45–50 s, w kółko.

## 2. Dowód z logów (`%APPDATA%/TIMEFLOW/logs/lan_sync.log` + `daemon.log`)
```
[11/13] Dane wyslane do peera
[12/13] Polecenie importu dla peera (db-ready)...
[12/13] Proba db-ready 1/3...
[12/13] db-ready proba 1/3 nieudana: HTTP 500: {"error":"Merge failed: Project name is blacklisted"}
[12/13] Ponowienie db-ready za 10s...
[12/13] Proba db-ready 2/3...
[12/13] db-ready proba 2/3 nieudana: HTTP 500: {"error":"No incoming data file: ... (os error 2)"}
[12/13] Proba db-ready 3/3...
[12/13] db-ready proba 3/3 nieudana: HTTP 500: {"error":"No incoming data file: ... (os error 2)"}
=== SYNC NIEUDANY po 3 probach ===
[2/13] Preflight ...      ← i cała sekwencja od nowa
```

**Ważne dla zrozumienia ról:** w tej sesji sync to **maszyna Windows `.73` jest orkiestratorem/wysyłającym**, a **Mac `.98` importuje** (odbiera `db-ready` i robi merge). Czyli **trigger blokujący merge odpala się na Macu `.98`**, a sprzeczne dane „aktywnego projektu" przychodzą z Windows `.73`. (To niezależne od etykiet master/slave w UI — orkiestratorem zostaje ten, kto inicjuje.)

## 3. Przyczyna pierwotna (próba 1: „Project name is blacklisted")
Mechanizm „czarnej listy nazw projektów" jest egzekwowany triggerami SQLite:

- `dashboard/src-tauri/resources/sql/schema.sql:27-39` — `trg_projects_blacklist_block_insert` (BEFORE INSERT)
- `dashboard/src-tauri/resources/sql/schema.sql:41-53` — `trg_projects_blacklist_block_update` (BEFORE UPDATE OF name, excluded_at)

Oba robią `RAISE(ABORT, 'Project name is blacklisted')`, gdy wstawiany/aktualizowany projekt jest **aktywny** (`excluded_at IS NULL`, `trim(name) <> ''`) i jego `lower(trim(name))` istnieje w tabeli `project_name_blacklist`.

Tabela `project_name_blacklist` jest zasilana automatycznie, gdy projekt zostaje **wykluczony** (`excluded_at` ustawione) — triggery `trg_projects_blacklist_sync_insert/exclude` (`schema.sql:55-74`).

**Scenariusz konfliktu (dokładnie nasz przypadek):**
1. Na Macu `.98` jakiś projekt o nazwie *X* został kiedyś **wykluczony** → nazwa *X* trafiła do `project_name_blacklist` Maca.
2. Na Windows `.73` projekt o tej samej nazwie *X* jest **aktywny** (`excluded_at = NULL`).
3. Podczas sync Mac importuje dane z Windows. Merge próbuje INSERT/UPDATE projektu *X* jako **aktywnego**:
   - `src/sync_common.rs:631-647` (INSERT nowego projektu) lub
   - `src/sync_common.rs:614-627` (UPDATE istniejącego).
4. BEFORE-trigger widzi *X* na czarnej liście Maca → `RAISE(ABORT)` → **cała transakcja merge pada**.
5. `handle_db_ready` łapie błąd, przywraca backup i zwraca `500 "Merge failed: Project name is blacklisted"` (`src/lan_server.rs:857-862`).

To **jedna** sprzeczna nazwa wystarcza, by zablokować **cały** sync — merge jest atomowy (transakcja).

## 4. Przyczyna wtórna (próby 2–3: „No incoming data file") — psuje retry i napędza pętlę
W `handle_db_ready` plik z danymi przychodzącymi jest **kasowany od razu po odczycie, PRZED merge**:

- odczyt danych: `src/lan_server.rs:828-834`
- **kasowanie pliku: `src/lan_server.rs:836-837`** (`remove_file(&incoming_path)` + pointer)
- merge dopiero: `src/lan_server.rs:857`

Skutek: gdy merge w próbie 1 pada (blacklist), plik **już nie istnieje**. Próby 2 i 3 czytają nieistniejący plik → `No incoming data file (os error 2)` (`src/lan_server.rs:828-832`). Mechanizm retry (`src/lan_sync_orchestrator.rs:669-690`, 3×) jest więc **bezużyteczny** — po pierwszym błędzie nigdy się nie uda. A orkiestrator po nieudanym sync startuje **całą** sekwencję od nowa → **nieskończona pętla**.

## 5. Jak namierzyć winną nazwę projektu
Sprzeczność = nazwa na czarnej liście **Maca**, która jest **aktywnym** projektem na Windows.

**Na Macu `.98`** (baza: `~/Library/Application Support/TIMEFLOW/timeflow_dashboard.db` — potwierdź ścieżkę przez `find ~/Library -name timeflow_dashboard.db`):
```sql
SELECT name_key FROM project_name_blacklist ORDER BY 1;
```
Porównaj z **aktywnymi projektami z Windows `.73`** (zrzut z dziś):
```
00_0000_firm, 00_PM_NX, 01_26_RM_Jutrzenki, 02_26_Metro_QX, 03_26_Metro_Szafy,
04_25_CFAB_VR_PAGE, 04_26_Metro_QS, 05_26_Metro_VR, 06_25_Metro_Meble,
06_26_Metro_Akcesoria, 07_25_Metro_Lada, 07_26_Metro_TS, 08_25_Metro_CUBE,
08_26_Metro_FM, 09_25_Metro_packshots_, 09_26_Metro_Fota, 10_25_Metro_MANAGE-IT,
10_26_Metro_MCR1000, 11_25_Metro_CI, 11_26_Metro_Visuals, 12_25_Metro_FOTA,
12_26_Profil_Mistly, 13_25_cubly_, 13_26_Metro_FENG, 14_25_NA_DC, 14_26_Metro_TARGI,
15_25_Metro_IN, 15_26_Maja_site, 16_25_Metro_DESIGN, 16_26_Profil_Korea_HAIR,
17_25_NA_WAWEL, 17_26_PROFIL_AMOYA, 18_26_PROFIL_Family_Wave, 19_26_PROFIL_NORU,
20_26_METRO_PAGE, Clank, EXRuster, _3DPRINT, _AI, _CFAB_3D_Viewer, _GFX_tools,
_IP_Tool, _YOPE_, __3D__, __CFAB_browser, __Cfab_pano, __ConceptDesk, __Headless_WP,
__METRO_catalogs, __METRO_catalogs_stage1, __METRO_catalogs_stage2,
__METRO_catalogs_stage3, __SKYsorter, __TimeFlow, ___3D_TEST, ___EXRuster,
___EXRuster_tools, ___QX, _____metro_oddanie, ____interactive_catalogs, ...
```
Część wspólna (po `lower(trim())`) = winna nazwa/nazwy. (Czarna lista Windows zawiera m.in.: `__metro_catalogs_final`, `__metro_backup`, `onedrive`, `wordpress`, `backup`, `high pass`, `nowy folder`, `out` — na Macu może być inny zestaw; liczy się przecięcie listy Maca z aktywnymi z Windows.)

## 6. Naprawa natychmiastowa (odblokowanie bez zmiany kodu)
Zdecyduj, czy projekt *X* ma być **aktywny** (zwykle tak — skoro pracujesz na nim na Windows). Wtedy **na Macu** usuń sprzeczny wpis z czarnej listy i zsynchronizuj:
```sql
-- 1) podejrzyj przecięcie (jeśli wgrasz kopię bazy Windows jako ATTACH) lub ręcznie z listy z pkt 5
-- 2) usuń konkretną nazwę (przykład):
DELETE FROM project_name_blacklist WHERE name_key = lower(trim('__METRO_catalogs'));
```
Jeśli woli się odblokować szybko i hurtowo (świadomie czyszcząc całą historię wykluczeń nazw na Macu):
```sql
DELETE FROM project_name_blacklist;   -- usuwa blokadę dla wszystkich nazw
```
Po usunięciu wpisu(ów) uruchom sync ponownie — krok [12/13] przejdzie.
> Uwaga: jeśli ten sam projekt jest na Macu *celowo wykluczony*, a na Windows aktywny, to jest to konflikt decyzji produktowej — najpierw ustal, która strona ma rację (aktywny vs wykluczony), bo merge i tak rozstrzyga `excluded_at` po `updated_at`.

## 7. Naprawa w kodzie (docelowa) — 2 zmiany

### Fix A (przyczyna pierwotna) — merge nie może być blokowany przez czarną listę
Merge sync to **autorytatywne pogodzenie danych**, nie tworzenie projektu przez użytkownika. Przed UPSERT-em projektu, który w danych przychodzących jest **aktywny** (`excluded_at` puste), należy w tej samej transakcji usunąć kolidujący wpis z czarnej listy.

- Plik: `src/sync_common.rs`, funkcja `merge_incoming_data` (od linii 326), pętla projektów ~`580-650`.
- Tuż przed UPDATE (`:614`) i INSERT (`:631`), gdy finalny `excluded_at` projektu jest `NULL`:
  ```rust
  // Odblokuj trigger blacklisty: dane autorytatywne mówią, że projekt jest aktywny.
  if json_str_opt(proj, "excluded_at").is_none() {
      tx.execute(
          "DELETE FROM project_name_blacklist WHERE name_key = lower(trim(?1))",
          rusqlite::params![name],
      ).map_err(|e| e.to_string())?;
  }
  ```
  Semantyka: jeśli peer ma projekt aktywny, lokalny (stary) wpis na czarnej liście jest nieaktualny i ustępuje. Rozstrzyganie aktywny/wykluczony i tak realizuje już LWW po `updated_at` (kolumna `excluded_at` w `:615/:620`).
- **Test**: dodaj przypadek do istniejących testów merge (`src/sync_common.rs` ma testy ~`1430+`): projekt aktywny po stronie peera + nazwa w `project_name_blacklist` lokalnie → merge przechodzi, projekt aktywny, brak wpisu na czarnej liście.

> Alternatywa (gdyby blacklist miała pozostać twarda): wyłączać oba BEFORE-triggery na czas merge przez sesyjną flagę w `WHEN (...)` triggera. Bardziej inwazyjne i łatwo o regresję — rekomendowany Fix A powyżej.

### Fix B (przyczyna wtórna, hardening) — nie kasuj pliku przed udanym merge
Przenieś kasowanie pliku wejściowego **za** udany merge (i weryfikację), żeby retry miało sens i nie napędzało pętli „No incoming data file".

- Plik: `src/lan_server.rs`, `handle_db_ready`.
- Usuń `remove_file` z linii **`836-837`** i przenieś je **po** udanym `verify_merge_integrity` (po `:873`), np. tuż przed wygenerowaniem markera (`:875`). Dzięki temu nieudany merge zostawia plik dla kolejnej próby.

### (Opcjonalnie) Fix C — pętla orkiestratora
Po `SYNC NIEUDANY` cała sekwencja rusza od zera bez limitu/backoffu (obserwowane co ~45 s). Rozważ górny limit prób całego cyklu albo wykładniczy backoff, by przy trwałym konflikcie nie obciążać obu maszyn w nieskończoność. Punkt wejścia: pętla retry orkiestratora wywołująca cykl [2/13]→[12/13] (`src/lan_sync_orchestrator.rs`).

## 8. Help.tsx / dokumentacja
To poprawka błędu, nie nowa funkcja — Help.tsx nie wymaga zmian. Jeśli jednak opisujesz gdzieś zachowanie „wykluczania projektów" i czarnej listy nazw, warto dopisać jedno zdanie, że wykluczenie nazwy na jednej maszynie nie blokuje już sync, gdy druga maszyna ma projekt o tej nazwie aktywny.

## 9. Kolejność działań
1. **Teraz**: na Macu `.98` usuń sprzeczny wpis z `project_name_blacklist` (pkt 6) i przepuść sync — potwierdzenie diagnozy.
2. **Docelowo**: Fix A + Fix B (+ test do A). Zbuduj na Macu, zweryfikuj pełny sync `.73 ⇄ .98` bez pętli.
3. Opcjonalnie Fix C.

## Skróty (plik:linia)
- Trigger blokujący: `dashboard/src-tauri/resources/sql/schema.sql:27-53`
- Zasilanie czarnej listy: `dashboard/src-tauri/resources/sql/schema.sql:55-74`
- Merge projektów (UPDATE/INSERT): `src/sync_common.rs:614-627`, `:631-647`
- Kasowanie pliku przed merge: `src/lan_server.rs:836-837` (merge: `:857`, zwrot 500: `:862`)
- Retry db-ready (3×, bezużyteczne po Fix B nie będzie): `src/lan_sync_orchestrator.rs:669-690`
