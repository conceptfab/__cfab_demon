# Folder Scan AI Boost — Plan implementacji

Spec: `docs/superpowers/specs/2026-04-11-folder-scan-ai-boost-design.md`

## Krok 1: Migracja DB — tabela `project_folder_tokens`

**Plik:** `dashboard/src-tauri/src/db_migrations/m18_project_folder_tokens.rs` (nowy)

```sql
CREATE TABLE IF NOT EXISTS project_folder_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    token TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    scanned_at TEXT NOT NULL,
    UNIQUE(project_id, token)
);
CREATE INDEX IF NOT EXISTS idx_pft_token ON project_folder_tokens(token);
```

**Plik:** `dashboard/src-tauri/src/db_migrations/mod.rs`
- Dodac `mod m18_project_folder_tokens;`
- Zmienic `LATEST_SCHEMA_VERSION` na `18`
- Dodac blok `if current_version < 18 { m18_project_folder_tokens::run(&tx)?; }`

**Test:** Dashboard startuje, tabela istnieje (`SELECT name FROM sqlite_master WHERE name='project_folder_tokens'`).

---

## Krok 2: Backend — logika skanu folderow

**Plik:** `dashboard/src-tauri/src/commands/assignment_model/folder_scan.rs` (nowy)

### Struktury

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct FolderScanResult {
    pub projects_scanned: i64,
    pub tokens_total: i64,
    pub duration_ms: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderScanStatus {
    pub has_scan_data: bool,
    pub last_scanned_at: Option<String>,
    pub projects_count: i64,
    pub tokens_count: i64,
}
```

### Funkcja glowna

```rust
pub fn scan_project_folders_sync(conn: &mut Connection) -> Result<FolderScanResult, String>
```

Logika:
1. `load_project_folders_from_db(conn)` — pobranie rootow
2. `collect_project_subfolders(&roots)` — lista (name, folder_path, root_path)
3. Dla kazdego subfolderu: `resolve_project_id_by_name(conn, &name)` — mapowanie na project_id (skip jesli brak)
4. Rekurencyjny walk (`walkdir` lub reczny `std::fs::read_dir` max 4 levels):
   - Skip: `node_modules`, `.git`, `target`, `dist`, `build`, `__pycache__`, `.next`, `.svn`, `.hg`
   - Dla kazdego pliku: `tokenize(&file_name_without_ext)` + token `ext~{rozszerzenie}`
   - Dla kazdego katalogu: `tokenize(&dir_name)`
5. Agregacja: `HashMap<(i64, String), i64>` — (project_id, token) → count
6. Transakcja: `DELETE FROM project_folder_tokens; INSERT ...` batch
7. Zwroc `FolderScanResult`

### Funkcja statusu

```rust
pub fn get_folder_scan_status_sync(conn: &Connection) -> Result<FolderScanStatus, String>
```

Query: `SELECT COUNT(DISTINCT project_id), COUNT(*), MAX(scanned_at) FROM project_folder_tokens`

### Funkcja czyszczenia

```rust
pub fn clear_folder_scan_sync(conn: &Connection) -> Result<(), String>
```

Query: `DELETE FROM project_folder_tokens`

**Reuse:** `context::tokenize()` (juz istnieje, filtruje stop-words, generuje bigramy).

---

## Krok 3: Tauri commands + rejestracja

**Plik:** `dashboard/src-tauri/src/commands/assignment_model/mod.rs`
- Dodac `pub mod folder_scan;`
- Dodac `pub use folder_scan::*;`
- Dodac 3 Tauri commands:

```rust
#[command]
pub async fn scan_project_folders_for_ai(app: AppHandle) -> Result<FolderScanResult, String> {
    run_db_blocking(app, |conn| folder_scan::scan_project_folders_sync(conn)).await
}

#[command]
pub async fn get_folder_scan_status(app: AppHandle) -> Result<FolderScanStatus, String> {
    run_db_blocking(app, |conn| folder_scan::get_folder_scan_status_sync(conn)).await
}

#[command]
pub async fn clear_folder_scan_data(app: AppHandle) -> Result<(), String> {
    run_db_blocking(app, |conn| folder_scan::clear_folder_scan_sync(conn)).await
}
```

**Plik:** `dashboard/src-tauri/src/lib.rs`
- Dodac do `generate_handler![]`:
  - `commands::scan_project_folders_for_ai`
  - `commands::get_folder_scan_status`
  - `commands::clear_folder_scan_data`

**Test:** `cargo check` przechodzi, komendy sa zarejestrowane.

---

## Krok 4: Integracja ze scoringiem — Layer 3b

**Plik:** `dashboard/src-tauri/src/commands/assignment_model/scoring.rs`

Po istniejacym bloku Layer 3 (linia ~231), dodac nowy blok:

```rust
// Layer 3b: folder-scan tokens (static knowledge from project folder contents)
if !context.tokens.is_empty() {
    // Analogicznie do Layer 3, ale z tabeli project_folder_tokens
    // Waga: 0.15 (nizsza niz Layer 3, bo to wiedza statyczna)
    for chunk in context.tokens.chunks(200) {
        let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT project_id, SUM(count), COUNT(*) FROM project_folder_tokens WHERE token IN ({}) GROUP BY project_id",
            placeholders
        );
        // ... analogicznie do Layer 3, z waga 0.15
    }
}
```

**Plik:** `dashboard/src-tauri/src/commands/assignment_model/mod.rs`

Rozszerzyc `CandidateScore`:
```rust
pub struct CandidateScore {
    // ... istniejace pola ...
    pub layer3b_folder_score: f64,  // NOWE
}
```

Rozszerzyc `SuggestionBreakdown`:
```rust
pub struct SuggestionBreakdown {
    // ... istniejace pola ...
    pub folder_score: f64,  // NOWE
}
```

**UWAGA:** Sprawdzic wszystkie miejsca ktore konstruuja `CandidateScore` i `SuggestionBreakdown` — dodac nowe pole. Grep po `CandidateScore {` i `SuggestionBreakdown {`.

**Test:** Po skanie folderow, `get_score_breakdown` dla sesji zwraca niezerowy `layer3b_folder_score`.

---

## Krok 5: Frontend — TypeScript API

**Plik:** `dashboard/src/lib/db-types.ts`
- Dodac typy `FolderScanResult` i `FolderScanStatus`
- Rozszerzyc `CandidateScore` o `layer3b_folder_score`
- Rozszerzyc `SuggestionBreakdown` o `folder_score`

**Plik:** `dashboard/src/lib/tauri/ai.ts`
- Dodac 3 funkcje:
  - `scanProjectFoldersForAi()` → `invokeMutation<FolderScanResult>('scan_project_folders_for_ai')`
  - `getFolderScanStatus()` → `invoke<FolderScanStatus>('get_folder_scan_status')`
  - `clearFolderScanData()` → `invokeMutation<void>('clear_folder_scan_data')`
- Dodac do eksportu `aiApi`

---

## Krok 6: Frontend — komponent AiFolderScanCard

**Plik:** `dashboard/src/components/ai/AiFolderScanCard.tsx` (nowy)

Wzorowany na `AiBatchActionsCard.tsx` — prosty Card z:
- Tytul: "Nauka z folderow projektow" / "Learn from Project Folders"
- Statystyki: ostatni skan (data), ile projektow, ile tokenow
- Przycisk "Naucz sie moich projektow" / "Learn My Projects" — wywoluje `scanProjectFoldersForAi()`
- Przycisk "Wyczysc dane skanu" / "Clear Scan Data" (outline, destructive) — z confirm dialog
- Stan loading podczas skanu
- Komunikat jesli brak `project_folders` (zacheta do dodania)

---

## Krok 7: Integracja w AI.tsx

**Plik:** `dashboard/src/pages/AI.tsx`
- Import `AiFolderScanCard`
- Dodac state: `scanStatus`, `scanning`, `clearing`
- Fetch `getFolderScanStatus()` w `useEffect` (razem z innymi statusami)
- Renderowac `<AiFolderScanCard />` pod `<AiModelStatusCard />` (nad metryki)
- Obsluga akcji: scan → toast z wynikiem, clear → confirm + toast

---

## Krok 8: Tlumaczenia i18n

**Pliki:**
- `dashboard/src/locales/en/common.json` — klucze `ai_page.folder_scan.*`
- `dashboard/src/locales/pl/common.json` — to samo po polsku

Klucze:
- `ai_page.folder_scan.title`
- `ai_page.folder_scan.description`
- `ai_page.folder_scan.scan_button` / `ai_page.folder_scan.scanning`
- `ai_page.folder_scan.clear_button` / `ai_page.folder_scan.clearing`
- `ai_page.folder_scan.clear_confirm`
- `ai_page.folder_scan.scan_completed` (z interpolacja: projects, tokens, duration)
- `ai_page.folder_scan.cleared`
- `ai_page.folder_scan.no_folders_hint`
- `ai_page.folder_scan.last_scan` / `ai_page.folder_scan.projects_count` / `ai_page.folder_scan.tokens_count`

---

## Krok 9: Help.tsx

**Plik:** `dashboard/src/components/help/sections/` — odpowiednia sekcja AI

Dodac opis:
- Co robi: skanuje zarejestrowane foldery projektow i uczy sie nazw plikow/katalogow
- Kiedy uzywac: po dodaniu/zmianie folderow projektow, lub gdy model zle przypisuje sesje
- Ograniczenia: wymaga zarejestrowanych project_folders, nie czyta zawartosci plikow

---

## Krok 10: Score breakdown UI (opcjonalnie)

Jezeli `SessionScoreBadge` lub breakdown dialog pokazuje warstwy — dodac `folder_score` do wyswietlania. Grep po `layer3_token_score` w komponentach i dodac analogicznie `layer3b_folder_score`.

---

## Kolejnosc wykonania

```
Krok 1 (migracja)
    ↓
Krok 2 (folder_scan.rs)
    ↓
Krok 3 (Tauri commands + lib.rs)
    ↓
Krok 4 (scoring integration)  ← mozna testowac backend
    ↓
Krok 5 (TS types + API)
    ↓
Krok 6 (AiFolderScanCard)
    ↓
Krok 7 (AI.tsx integration)
    ↓
Krok 8 (i18n)
    ↓
Krok 9 (Help.tsx)
    ↓
Krok 10 (score breakdown UI)
```

Kroki 1-4 sa czysto backendowe (Rust). Kroki 5-10 sa frontendowe (TypeScript/React). Mozna je realizowac sekwencyjnie — kazdy krok zalezy od poprzedniego.

## Weryfikacja koncowa

- [ ] `cargo check` przechodzi
- [ ] `npx tsc --noEmit` przechodzi
- [ ] Skan folderow zwraca sensowne wyniki (>0 tokenow)
- [ ] Score breakdown sesji pokazuje niezerowy folder_score po skanie
- [ ] Clear data resetuje dane skanu
- [ ] Help.tsx zaktualizowany
- [ ] Tlumaczenia PL + EN kompletne
