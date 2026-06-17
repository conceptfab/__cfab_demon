# Folder Scan AI Boost — Spec

## Problem

System AI (assignment model) uczy sie tylko z historii uzytkowania — sesje, file_activities, feedback. Nie korzysta z faktycznej zawartosci folderow projektow, ktore uzytkownik juz zarejestrował w `project_folders`. Pliki w tych folderach czesto zawieraja nazwe projektu wprost (np. `08_25_Metro_CUBE_R1_4K0000.jpg`), co jest silnym sygnalem, ale model go nie widzi dopoki uzytkownik nie otworzy pliku w aplikacji.

## Rozwiazanie

Dodatkowe narzedzie na stronie AI — "Naucz sie moich projektow" (Learn My Projects). Skanuje zarejestrowane `project_folders`, wyciaga unikalne tokeny z nazw plikow/katalogow i rozszerzen, zapisuje je jako dodatkowe dane do Layer 3 (token scoring). Nie zastepuje istniejacego flow — wzmacnia go.

## Zakres

### Co robi

1. Skanuje foldery z tabeli `project_folders` (rekurencyjnie, max 4 poziomy glebokosci)
2. Wyklucza smieci: `node_modules`, `.git`, `target`, `dist`, `build`, `__pycache__`, `.next`, `.svn`
3. Dla kazdego projektu (= subfolder root-a) wyciaga unikalne tokeny z:
   - Nazw plikow (bez rozszerzenia)
   - Nazw podkatalogow
   - Rozszerzen plikow (jako osobny token z prefixem `ext~`)
4. Zapisuje zagregowane tokeny w nowej tabeli `project_folder_tokens(project_id, token, count, scanned_at)`
5. Podczas scoringu (scoring.rs) Layer 3 konsultuje rowniez `project_folder_tokens` jako dodatkowe zrodlo
6. UI: karta na stronie AI z przyciskiem "Skanuj foldery", statystykami (ile tokenow, kiedy ostatni skan), opcja czyszczenia

### Czego NIE robi

- Nie czyta zawartosci plikow (tylko nazwy i sciezki)
- Nie zastepuje istniejacego treningu — to dodatkowy sygnał
- Nie uruchamia sie automatycznie — tylko na zadanie uzytkownika
- Nie dodaje nowych project_folders — korzysta z juz zarejestrowanych

## Architektura

### Nowa tabela: `project_folder_tokens`

```sql
CREATE TABLE IF NOT EXISTS project_folder_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    token TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    scanned_at TEXT NOT NULL,
    UNIQUE(project_id, token)
);
CREATE INDEX idx_pft_token ON project_folder_tokens(token);
```

Szacowany rozmiar: ~30 projektow x ~80 tokenow = ~2400 wierszy.

### Backend (Rust, Tauri command)

Nowy modul: `dashboard/src-tauri/src/commands/assignment_model/folder_scan.rs`

```
pub fn scan_project_folders_sync(conn: &mut Connection) -> Result<FolderScanResult, String>
```

Logika:
1. `load_project_folders_from_db(conn)` — pobranie rootow
2. Dla kazdego roota: `collect_project_subfolders()` (juz istnieje) → lista (project_name, folder_path)
3. Dla kazdego projektu: rekurencyjny walk po folderze (max depth 4, skip blacklist dirs)
4. Tokenizacja (reuse `context::tokenize()`) nazw plikow i katalogow
5. Agregacja: HashMap<(project_id, token), count>
6. Zapis do `project_folder_tokens` (DELETE old + INSERT batch w transakcji)
7. Zwroc `FolderScanResult { projects_scanned, tokens_total, duration_ms }`

Tauri command:
```rust
#[tauri::command]
pub async fn scan_project_folders_for_ai(app: AppHandle) -> Result<FolderScanResult, String>
```

### Integracja ze scoringiem

W `scoring.rs`, po istniejacym Layer 3 (token z file_activities), dodac **Layer 3b**:

```sql
SELECT project_id, SUM(count), COUNT(*) 
FROM project_folder_tokens 
WHERE token IN (...)
GROUP BY project_id
```

Waga: rowna lub nizsza niz Layer 3 (np. 0.15-0.20), bo to wiedza statyczna (nie z uzytkowania).

Dodac wynik jako `layer3b_folder_score` do `CandidateScore` i `ScoreBreakdown`.

### Frontend

Nowa karta `AiFolderScanCard` na stronie AI (pod AiModelStatusCard):
- Statystyki: ostatni skan, ile projektow, ile tokenow
- Przycisk "Naucz sie moich projektow" / "Learn My Projects"
- Przycisk "Wyczysc dane skanu" / "Clear scan data"
- Loading state podczas skanu

### Migracja DB

Nowa migracja: `m18_project_folder_tokens.rs` (lub nastepny numer w kolejnosci)

### Help.tsx

Dodac sekcje o folder scan w opisie AI — co robi, kiedy uzywac, jakie sa ograniczenia.

## Szacunki

- Skan ~3500 plikow: <1s
- Rozmiar danych: ~2400 wierszy (~50KB w SQLite)
- Wplyw na scoring: dodatkowe 1 zapytanie SQL per scoring call

## Ograniczenia

- Wymaga zarejestrowanych `project_folders` — bez nich skan nic nie daje
- Mapowanie token→project wymaga istniejacego projektu w DB (uzywa `resolve_project_id_by_name`)
- Pliki bez charakterystycznych nazw (np. `image001.tif`) nie daja uzyecznych tokenow — ale to ok, bo tokenize() filtruje stop-words
