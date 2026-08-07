# Spec: Numeracja projektów PM — auto-sugestia + edycja/potwierdzenie przez użytkownika

Data: 2026-05-14
Status: zatwierdzony do implementacji

## Problem

Przy tworzeniu nowego projektu w module PM program nie sprawdza realnie istniejących
numerów. Obecna funkcja `next_project_number()` w
`dashboard/src-tauri/src/commands/pm_manager.rs:102-115` **zlicza** projekty z bieżącego
roku i dodaje 1 — zamiast brać maksymalny istniejący numer. Skutkuje to kolizjami, gdy
numeracja ma luki (skasowany/zarchiwizowany projekt) albo gdy folder projektów zawiera
projekty utworzone wcześniej / poza aplikacją.

Dodatkowo dialog tworzenia (`PmCreateProjectDialog.tsx:42-44`) pokazuje tylko placeholder
`XX26` — użytkownik nigdy nie widzi ani nie potwierdza numeru przed utworzeniem projektu.

## Cel

1. Domyślny numer = **max istniejący numer dla bieżącego roku + 1**.
2. Źródło „istniejących numerów" = **suma**: rejestr `projects_list.json` ∪ skan folderów
   na dysku w folderze projektów.
3. Numer prezentowany w dialogu w **edytowalnym polu**, pre-wypełniony sugestią.
4. Kolizja (numer już zajęty w danym roku) **blokuje** utworzenie projektu z czytelnym
   komunikatem.

## Decyzje projektowe

- **Podejście A** — logika numeracji i walidacji żyje w backendzie (Rust), bo tam jest
  dostęp do dysku i `create_project`. Frontend tylko pobiera sugestię i prezentuje pole.
- **Numeracja jest per rok** (2-cyfrowy rok `RR`, np. `26`). Numery z innych lat nie
  wpływają na bieżący.
- **Projekty zarchiwizowane liczą się** do numeracji — ich foldery zostają na dysku i
  wpisy w JSON, więc numery nigdy nie są reużywane (spójne z zasadą „brak kolizji").
- **Bez nowych zależności** — parsowanie nazw folderów ręczne, bez crate `regex`.
- Format numeru: zero-padded, `{:02}` (`01`..`09`, potem `10`+; >99 renderuje się jako
  3 cyfry i nadal działa).

## Architektura

### Backend (Rust)

Plik `dashboard/src-tauri/src/commands/pm_manager.rs`:

- **Nowa** `scan_disk_project_numbers(work_folder: &str, year: &str) -> Vec<u32>`
  - Czyta wpisy katalogu `work_folder`.
  - Dla każdego podkatalogu parsuje nazwę wzorcem `NN_RR_...`: pierwsze dwa segmenty
    rozdzielone `_` muszą być 2-cyfrowymi liczbami. Walidacja ręczna (split + `parse`).
  - Zbiera `NN` tam, gdzie `RR == year`.
  - Wpisy niepasujące (np. `00_PM_NX`), pliki oraz błędy odczytu katalogu są ignorowane
    (funkcja zwraca to, co udało się zebrać; pusty `Vec` przy błędzie odczytu katalogu).
- **Nowa** `existing_project_numbers(work_folder: &str, year: &str) -> Result<Vec<u32>, String>`
  - Numery z `read_projects()` filtrowane po `prj_year == year`, `prj_number` parsowane do `u32`.
  - Suma ze `scan_disk_project_numbers()`.
- **Zmiana** `next_project_number` — nowa sygnatura
  `next_project_number(work_folder: &str) -> Result<String, String>`:
  - `year` = bieżący rok 2-cyfrowy (`Local::now().format("%y")`).
  - `next = existing_project_numbers(..).into_iter().max().unwrap_or(0) + 1`.
  - Zwraca `format!("{:02}", next)`.
  - Stara `count_projects_this_year` oraz stara wersja `next_project_number(&[PmProject])`
    zostają usunięte.
- **Zmiana** `create_project(work_folder, new: PmNewProject)`:
  - Normalizuje `new.prj_number`: trim, `parse::<u32>()`, musi być `> 0`; przy złym
    formacie → `Err` z komunikatem.
  - Liczy `existing_project_numbers` dla bieżącego roku; jeśli znormalizowany numer jest
    w zbiorze → `Err` (komunikat typu „Numer projektu 03 już istnieje w roku 26").
  - Używa znormalizowanego numeru (`format!("{:02}", n)`) dla `prj_number`, `prj_code`,
    `prj_full_name` zamiast wyliczania wewnętrznego.
  - Reszta (`create_dirs_tree`, zapis JSON) bez zmian.

Plik `dashboard/src-tauri/src/commands/pm.rs` + rejestracja komend Tauri:

- **Nowa komenda** `pm_suggest_project_number() -> Result<String, String>`:
  `load_work_folder()` → `pm_manager::next_project_number(&folder)`. Rejestracja w
  `invoke_handler` (plik `lib.rs`/`main.rs` — do ustalenia w planie).
- `pm_create_project` — sygnatura bez zmian (już przyjmuje `PmNewProject`), ale
  `PmNewProject` zyskuje pole.

Typ `PmNewProject` (Rust struct): nowe pole `prj_number: String`.

### Frontend

- `dashboard/src/lib/pm-types.ts` — `prj_number: string` w `PmNewProject`.
- `dashboard/src/lib/pm-api.ts` — wrapper `suggestProjectNumber(): Promise<string>`
  (`invoke('pm_suggest_project_number')`).
- `dashboard/src/components/pm/PmCreateProjectDialog.tsx`:
  - Nowy stan `projectNumber: string` + stan `numberLoading` / `numberError`.
  - Przy otwarciu dialogu wywołuje `pmApi.suggestProjectNumber()`, pre-wypełnia pole.
    Błąd pobrania → komunikat, submit zablokowany.
  - Nowe **edytowalne** pole „Numer projektu" (label/hint z i18n).
  - Podgląd `previewCode` / `previewName` używa `projectNumber` zamiast hardcoded `XX`.
  - Lekka walidacja formatu przed wysłaniem (1–2 cyfry, `> 0`).
  - Submit dołącza `prj_number` do payloadu `PmNewProject`.
  - `Err` z backendu (kolizja / zły format) wyświetlany w istniejącym miejscu na błędy
    dialogu.

### i18n

Nowe klucze `pm.create.*`: etykieta pola numeru, hint, ewentualny komunikat błędu
formatu po stronie frontendu. Pliki lokalizacji do zlokalizowania w planie.

### Dokumentacja — Help.tsx

CLAUDE.md wymaga aktualizacji `Help.tsx` przy zmianie zachowania funkcji odczuwalnej
przez użytkownika. Sekcja PM: opis auto-sugerowanego, edytowalnego numeru projektu i
blokady kolizji (co robi / kiedy użyć / ograniczenia).

## Przepływ danych

1. Użytkownik otwiera dialog „Nowy projekt".
2. Dialog → `pm_suggest_project_number` → backend liczy `max(JSON ∪ skan dysku) + 1` dla
   bieżącego roku → zwraca np. `"03"`.
3. Pole „Numer projektu" pre-wypełnione `03`, edytowalne. Podgląd nazwy aktualizuje się
   na żywo.
4. Submit → `pm_create_project` z `prj_number`.
5. Backend `create_project` waliduje format + kolizję po obu źródłach.
   - OK → tworzy foldery, dopisuje do JSON, zwraca `PmProject`.
   - Kolizja / zły format → `Err`, dialog pokazuje komunikat, projekt nie powstaje.

## Obsługa błędów i przypadki brzegowe

- Pusty folder / brak projektów w roku → sugestia `01`.
- Brak `projects_list.json` → `read_projects` zwraca `vec![]`; numeracja opiera się na
  skanie dysku.
- Folder roboczy nieustawiony → `pm_suggest_project_number` zwraca `Err`; dialog pokazuje
  błąd, submit zablokowany.
- Foldery na dysku niepasujące do wzorca `NN_RR_...` → ignorowane.
- Numer > 99 → `{:02}` renderuje 3 cyfry, działa poprawnie.
- Wyścig (dwa szybkie utworzenia) — akceptowalne ryzyko; walidacja kolizji w
  `create_project` i tak odrzuci duplikat przy drugim zapisie.

## Testy

Rust (unit):
- `scan_disk_project_numbers` — poprawne parsowanie `NN_RR_...`, ignorowanie
  `00_PM_NX` i plików, filtrowanie po roku.
- `existing_project_numbers` — scalanie JSON + dysk, dedup nieistotny dla `max`.
- `next_project_number` — `max + 1`; pusty zbiór → `01`; luki w numeracji nie są
  wypełniane (np. `01,02,04` → `05`).
- `create_project` — odrzucenie kolizji (numer istniejący w JSON i/lub na dysku),
  odrzucenie złego formatu, akceptacja poprawnego numeru.

Manualnie:
- Otwarcie dialogu pokazuje sugerowany numer; zmiana numeru aktualizuje podgląd;
  wpisanie zajętego numeru → komunikat i brak utworzenia; wskazanie folderu z
  istniejącymi projektami (pusty JSON) → sugestia uwzględnia skan dysku.

## Zakres plików (szacunkowo)

- `dashboard/src-tauri/src/commands/pm_manager.rs`
- `dashboard/src-tauri/src/commands/pm.rs`
- plik rejestracji komend Tauri (`lib.rs` / `main.rs`)
- `dashboard/src/lib/pm-types.ts`
- `dashboard/src/lib/pm-api.ts`
- `dashboard/src/components/pm/PmCreateProjectDialog.tsx`
- pliki i18n (`pm.create.*`)
- `Help.tsx`

## Poza zakresem

- Reorganizacja / przenumerowanie istniejących projektów.
- Synchronizacja `projects_list.json` ze stanem dysku (poza odczytem do numeracji).
- Zmiana formatu kodu projektu / struktury folderów szablonu.
