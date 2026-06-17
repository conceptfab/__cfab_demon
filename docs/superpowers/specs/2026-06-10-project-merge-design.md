# Scalanie projektów (stage → projekt nadrzędny) — design

Data: 2026-06-10
Status: do akceptacji

## Cel

Użytkownik prowadzi jeden projekt w kilku stadiach (np. `Projekt_stage1`, `Projekt_stage2`, `Projekt_final`). Funkcja pozwala scalić projekty-stadia w jeden projekt nadrzędny:

- czas stadiów liczy się do projektu nadrzędnego (agregacja),
- podział na stadia pozostaje widoczny (rozbicie per-stage w karcie projektu nadrzędnego),
- scalony projekt zostaje w bazie ze specjalnym markerem „scalony",
- scalony projekt jest zablokowany: nie otrzymuje nowych sesji, nie bierze udziału w przypisywaniu czasu,
- scalone projekty trafiają do osobnej kategorii „Projekty scalone" w panelu (auto-exclude),
- operacja jest odwracalna (unmerge).

## Podejście: scalenie logiczne (B)

Żadna sesja nie jest mutowana. Merge to wyłącznie zmiana stanu projektu-stadium + przepięcie aplikacji. Czas projektu nadrzędnego liczy się w zapytaniach jako `czas własny + czas projektów scalonych do niego`.

Odrzucone podejście A (fizyczne przepisanie `project_id` sesji + komentarze `[stage]`): masowa mutacja sesji = masowy bump `updated_at` = burza syncowa i ryzyko powtórki utraty danych na LAN sync (audyt 2026-06-09); nieodwracalne; nadpisywałoby istniejące komentarze sesji.

## Model danych

Migracja (nowa, w `dashboard/src-tauri/src/db_migrations/` + lustro w schemacie eksportu daemona):

```sql
ALTER TABLE projects ADD COLUMN merged_into TEXT;  -- nazwa projektu nadrzędnego (sync identyfikuje projekty po nazwie)
ALTER TABLE projects ADD COLUMN merged_at TEXT;    -- timestamp scalenia
```

Bez nowych triggerów. Stany projektu po zmianie:

| Stan | excluded_at | frozen_at | merged_into |
|---|---|---|---|
| aktywny | NULL | NULL | NULL |
| excluded (archiwum) | set | — | NULL |
| frozen | NULL | set | NULL |
| **scalony** | **set (auto)** | — | **set** |

Scalony projekt ma ustawione `excluded_at` (auto-exclude) — dzięki temu wszystkie istniejące filtry przypisywania czasu (Layer 1–3: `excluded_at IS NULL AND frozen_at IS NULL`) blokują go bez żadnych zmian, a starsze wersje aplikacji po sync też go ignorują (łagodna degradacja).

## Operacje

### merge_project(source_id, target_id) — komenda Tauri, jedna transakcja

Walidacje:
- source ≠ target; oba istnieją,
- target jest aktywny (`excluded_at IS NULL AND frozen_at IS NULL AND merged_into IS NULL`) — nie można scalać do projektu scalonego/archiwalnego (płaska hierarchia, jeden poziom),
- source nie jest już scalony.

Kroki (w transakcji):
1. Jeśli source ma własne scalone „dzieci" → przepisz ich `merged_into` na nazwę targetu (spłaszczenie hierarchii).
2. `UPDATE applications SET project_id = target WHERE project_id = source` (przyszły czas idzie do nadrzędnego; analogia do `exclude_project`, ale z przepięciem zamiast NULL).
3. `UPDATE projects SET merged_into = target.name, merged_at = now, excluded_at = COALESCE(excluded_at, now), updated_at = now WHERE id = source`.

### unmerge_project(source_id)

`UPDATE projects SET merged_into = NULL, merged_at = NULL, excluded_at = NULL, updated_at = now`. Aplikacje pozostają przy projekcie nadrzędnym (przepięcia nie da się wiarygodnie odtworzyć) — opisane w Help.

### rename projektu nadrzędnego

Trigger kaskady rename (m20) obejmuje `sessions.project_name`; analogiczna kaskada musi zaktualizować `projects.merged_into` dzieci (w komendzie rename, nie w triggerze, lustrzanie z istniejącym mechanizmem).

### delete projektu nadrzędnego

Zablokowany, jeśli istnieją projekty z `merged_into = name` — komunikat „najpierw rozłącz scalone projekty". Chroni przed wiszącymi wskaźnikami.

### delete projektu scalonego

Dozwolony jak dziś (tombstone po nazwie) — czas tego stadium znika z agregacji projektu nadrzędnego (świadoma decyzja użytkownika, jak przy zwykłym delete).

## Liczenie czasu (agregacja)

Jedno kanoniczne mapowanie w SQL (fragment/CTE w `sql_fragments.rs`):

```sql
-- effective project: projekt sam dla siebie, chyba że scalony → wtedy nadrzędny
SELECT p.id AS child_id, COALESCE(parent.id, p.id) AS effective_id
FROM projects p LEFT JOIN projects parent ON parent.name = p.merged_into
```

- `get_projects` / statystyki: `total_seconds` i `period_seconds` projektu nadrzędnego = suma po `effective_id`.
- Karta projektu nadrzędnego: sekcja „Scalone projekty" z rozbiciem czasu per stadium (nazwa, czas, data scalenia).
- Zasada braku podwójnego liczenia: każde zapytanie sumujące czas wielu projektów (listy, raporty, wykresy) grupuje po `effective_id` — sesja liczy się dokładnie raz, zawsze pod projektem nadrzędnym. Własny czas scalonego projektu jest pokazywany wyłącznie informacyjnie w jego karcie i w rozbiciu per-stage karty nadrzędnego.

## Nadrzędność hintów (decyzja 3)

`ensure_app_project_from_file_hint()` (Layer 2) dziś dopasowuje wyłącznie projekty aktywne. Rozszerzenie: dopasowanie obejmuje też projekty scalone, ale wynik jest **rozwiązywany do projektu nadrzędnego** (`merged_into`). Efekt: praca w folderze `Projekt_stage1` po scaleniu liczy się do `Projekt_final`. Analogicznie hinty z `assigned_folder_path` stadium.

## Panel projektów (UI)

- Nowa kategoria/sekcja **„Projekty scalone"**: `merged_into IS NOT NULL`. Lista „Excluded" filtruje `merged_into IS NULL` (rozłączne zbiory).
- Badge na kafelku: `SCALONY → <nazwa nadrzędnego>` + kliknięcie prowadzi do projektu nadrzędnego.
- Akcja „Scal do projektu…" w karcie/menu projektu: picker z listą aktywnych projektów (bez samego siebie), potwierdzenie z opisem skutków.
- Akcja „Rozłącz (unmerge)" na scalonym projekcie.
- Stany loading/empty/error jak w istniejących listach.

## LAN sync — kompatybilność

Nowe kolumny `merged_into`, `merged_at` muszą wejść symetrycznie (daemon `src/sync_common.rs` + dashboard `commands/lan_sync.rs` — lustra w lockstepie) do:
1. eksportu projektów,
2. UPDATE w merge'u syncowym (`sync_common.rs:593`),
3. INSERT nowego projektu (`sync_common.rs:608`),
4. tabeli tymczasowej (`sync_common.rs:1254`),
5. checksumu stanu (`sync_common.rs:1370`).

Zachowanie w wersjach mieszanych:
- stary peer nie zna kolumn → nie wysyła ich i nie nadpisuje (jego UPDATE listuje tylko stare kolumny po swojej stronie; po stronie nowej wersji rekord z brakującym polem w JSON daje `NULL` — **ryzyko**: remote-wins ze starego peera wyzeruje `merged_into`. Mitygacja: w upsercie nowej wersji `merged_into = COALESCE(json.merged_into, zachowaj_lokalne)` gdy pole nieobecne w archiwum — rozróżnić „brak klucza" od „null"),
- `excluded_at` propaguje się do starego peera → blokada liczenia czasu działa wszędzie,
- wpis do `PARITY.md`: marker „scalony" wymaga tej samej wersji po obu stronach.

## Testy

- Rust (testy jak istniejące w `sessions/tests.rs` / testy sync):
  1. merge → czas nadrzędnego = własny + stadium; stadium nie dostaje nowych sesji,
  2. merge → unmerge → stany i czasy wracają,
  3. spłaszczenie hierarchii (merge projektu mającego dzieci),
  4. rename nadrzędnego → `merged_into` dzieci zaktualizowane,
  5. delete nadrzędnego zablokowany przy dzieciach,
  6. sync roundtrip: merge na A → sync → B widzi marker; edycja projektu na B → sync → marker przeżywa (last-writer-wins),
  7. sync ze „starym" archiwum bez kluczy merged_* → lokalny marker przeżywa.
- Manualnie: praca w folderze stadium po merge'u → czas liczy się do nadrzędnego.

## Help.tsx (obowiązkowo, ten sam commit co UI)

Sekcja „Scalanie projektów": co robi (łączy stadia w jeden projekt, czas liczy się do nadrzędnego z zachowaniem rozbicia), kiedy użyć (projekt prowadzony etapami), konsekwencje (scalony projekt jest zablokowany i trafia do kategorii „Projekty scalone"; rozłączenie nie przywraca przypisań aplikacji; pełne działanie markera na obu maszynach wymaga tej samej wersji).

## Poza zakresem

- Hierarchia wielopoziomowa (zawsze spłaszczana do jednego poziomu).
- Fizyczne przenoszenie sesji i edycja ich komentarzy.
- Integracja z PM (`projects_list.json`) — bez zmian.
