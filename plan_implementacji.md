# Plan implementacji: Automatyczne przyporządkowywanie sesji do projektów przy synchronizacji

## Problem

Dane wysyłane przez synchronizację online (`online-sync`) **nie zawierają informacji o przypisaniu sesji do projektu** (`project_id`). Struktura `SessionRow` w `types.rs` nie ma pola `project_id`, a zapytania SQL w `export.rs` nie pobierają tej kolumny. W efekcie:

1. Użytkownik na urządzeniu A ręcznie przyporządkowuje sesje do projektów
2. Dane są eksportowane i wysyłane na serwer **bez tych przyporządkowań**
3. Na urządzeniu B (lub po ponownym imporcie) sesje przychodzą bez `project_id`
4. Użytkownik musi ponownie ręcznie przyporządkowywać te same sesje

## Diagnoza kodu

### Brakujące `project_id` w eksporcie sesji

**Plik:** `dashboard/src-tauri/src/commands/types.rs` (linia 407-416)
```rust
pub struct SessionRow {
    pub id: i64,
    pub app_id: i64,
    pub start_time: String,
    pub end_time: String,
    pub duration_seconds: i64,
    pub rate_multiplier: f64,
    pub date: String,
    // ⛔ BRAK: pub project_id: Option<i64>
}
```

**Plik:** `dashboard/src-tauri/src/commands/export.rs` (linia 149-153)
```sql
SELECT s.id, s.app_id, s.start_time, s.end_time, s.duration_seconds, s.date,
       COALESCE(s.rate_multiplier, 1.0)
FROM sessions s ...
-- ⛔ BRAK: s.project_id
```

### Brakujące `project_id` w imporcie sesji

**Plik:** `dashboard/src-tauri/src/commands/import_data.rs` (linia 394-407)
```rust
// merge_or_insert_session() - INSERT nie zawiera project_id:
"INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, rate_multiplier)
 VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
// ⛔ BRAK: project_id w INSERT i UPDATE
```

---

## Plan zmian

### Krok 1: Rozszerzenie `SessionRow` o `project_id`

**Plik:** `dashboard/src-tauri/src/commands/types.rs`

```rust
pub struct SessionRow {
    pub id: i64,
    pub app_id: i64,
    pub start_time: String,
    pub end_time: String,
    pub duration_seconds: i64,
    #[serde(default = "default_rate_multiplier")]
    pub rate_multiplier: f64,
    pub date: String,
    #[serde(default)]                    // ← NOWE
    pub project_id: Option<i64>,         // ← NOWE
}
```

`#[serde(default)]` zapewnia kompatybilność wsteczną - starsze archiwa bez tego pola będą deserializowane z `project_id = None`.

---

### Krok 2: Eksport sesji z `project_id`

**Plik:** `dashboard/src-tauri/src/commands/export.rs`

Zmienić zapytanie SQL (linia ~149):
```sql
SELECT s.id, s.app_id, s.start_time, s.end_time, s.duration_seconds, s.date,
       COALESCE(s.rate_multiplier, 1.0),
       s.project_id                      -- ← NOWE
FROM sessions s
INNER JOIN _export_app_ids e ON e.id = s.app_id
WHERE s.date >= ?1 AND s.date <= ?2
```

Zmienić mapowanie `SessionRow` w query_map:
```rust
Ok(SessionRow {
    id: row.get(0)?,
    app_id: row.get(1)?,
    start_time: row.get(2)?,
    end_time: row.get(3)?,
    duration_seconds: row.get(4)?,
    date: row.get(5)?,
    rate_multiplier: row.get(6)?,
    project_id: row.get(7)?,             // ← NOWE
})
```

---

### Krok 3: Import sesji z zachowaniem `project_id`

**Plik:** `dashboard/src-tauri/src/commands/import_data.rs`

#### 3a. Mapowanie `project_id` w imporcie sesji (sekcja "3. Import and Merge Sessions", linia ~224)

Przed wywołaniem `merge_or_insert_session` zmapować `project_id` sesji:
```rust
for s in &archive.data.sessions {
    if let Some(&local_app_id) = app_mapping.get(&s.app_id) {
        // Mapowanie project_id z archiwum na lokalne ID
        let mapped_project_id = s.project_id
            .and_then(|old_pid| project_mapping.get(&old_pid).copied());

        let incoming = SessionRow {
            id: s.id,
            app_id: local_app_id,
            start_time: s.start_time.clone(),
            end_time: s.end_time.clone(),
            duration_seconds: s.duration_seconds,
            rate_multiplier: s.rate_multiplier,
            date: s.date.clone(),
            project_id: mapped_project_id,   // ← NOWE
        };

        let merged = merge_or_insert_session(&tx, local_app_id, &incoming)?;
        // ...
    }
}
```

#### 3b. Rozszerzenie `merge_or_insert_session` (linia ~339)

**INSERT nowej sesji** - dodać `project_id`:
```rust
if overlap_ids.is_empty() {
    tx.execute(
        "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, rate_multiplier, project_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            local_app_id,
            incoming.start_time,
            incoming.end_time,
            incoming.duration_seconds,
            incoming.date,
            merged_rate_multiplier,
            incoming.project_id              // ← NOWE
        ],
    ).map_err(|e| e.to_string())?;
    return Ok(false);
}
```

**UPDATE przy merge** - zachować `project_id` z priorytetem:
- Jeśli istniejąca sesja **już ma** `project_id` → zachować istniejące (lokalne przypisanie ma priorytet)
- Jeśli istniejąca sesja **nie ma** `project_id`, a przychodzące dane mają → użyć przychodzącego

```rust
// Pobierz istniejące project_id z sesji, którą zachowujemy (keep_id)
let existing_project_id: Option<i64> = tx.query_row(
    "SELECT project_id FROM sessions WHERE id = ?1",
    [keep_id],
    |row| row.get(0),
).map_err(|e| e.to_string())?;

// Priorytet: lokalne > przychodzące
let final_project_id = existing_project_id.or(incoming.project_id);

tx.execute(
    "UPDATE sessions
     SET start_time = ?1, end_time = ?2, duration_seconds = ?3,
         rate_multiplier = ?4, project_id = ?5
     WHERE id = ?6",
    rusqlite::params![
        merged_start, merged_end, duration,
        merged_rate_multiplier, final_project_id, keep_id
    ],
).map_err(|e| e.to_string())?;
```

---

### Krok 4: Rozszerzenie funkcji `merge_or_insert_session`

Zaktualizować sygnaturę i logikę śledzenia `project_id` przy scalaniu wielu sesji:

```rust
fn merge_or_insert_session(
    tx: &rusqlite::Transaction<'_>,
    local_app_id: i64,
    incoming: &SessionRow,
) -> Result<bool, String> {
    // ... istniejąca logika merge ...

    // Przy iteracji po overlapping sesji, zbierać też project_id:
    // Dodać do zapytania SELECT: , project_id
    // Priorytet: pierwsze znalezione non-null project_id wygrywa
    let mut merged_project_id: Option<i64> = incoming.project_id;

    // W pętli overlap:
    // if merged_project_id.is_none() { merged_project_id = row_project_id; }

    // ...
}
```

---

### Krok 5: Aktualizacja typu TypeScript (opcjonalne, ale zalecane)

**Plik:** `dashboard/src/lib/db-types.ts`

Sprawdzić czy interfejs `SessionRow` / odpowiadający typ TS ma pole `project_id`. Jeśli nie - dodać:
```typescript
export interface SessionRow {
  // ... istniejące pola ...
  project_id?: number | null;
}
```

---

### Krok 6: Bump wersji archiwum

**Plik:** `dashboard/src-tauri/src/commands/export.rs`

Zmienić wersję archiwum z `"1.1"` na `"1.2"` aby serwer i klienty mogły rozpoznać nowy format:
```rust
version: "1.2".to_string(),
```

---

### Krok 7: Testy

**Plik:** `dashboard/src-tauri/src/commands/import_data.rs` (sekcja `#[cfg(test)]`)

Dodać testy:
1. **Import sesji z `project_id`** - sesja przychodzi z `project_id`, zostaje wstawiona z tym ID
2. **Merge z priorytetem lokalnym** - istniejąca sesja ma `project_id`, przychodzące też → zachowane lokalne
3. **Merge z przejęciem** - istniejąca sesja bez `project_id`, przychodzące z → przejęte
4. **Kompatybilność wsteczna** - archiwum v1.1 bez pola `project_id` importuje się poprawnie (deserializacja daje `None`)

Schemat testowej tabeli `sessions` wymaga aktualizacji o kolumnę `project_id`:
```rust
fn setup_sessions_conn() -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().expect("in-memory sqlite");
    conn.execute_batch(
        "CREATE TABLE sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            app_id INTEGER NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            duration_seconds INTEGER NOT NULL,
            date TEXT NOT NULL,
            rate_multiplier REAL NOT NULL DEFAULT 1.0,
            project_id INTEGER              -- NOWE
        );",
    ).expect("create sessions schema");
    conn
}
```

---

## Podsumowanie zmian

| Plik | Zmiana |
|------|--------|
| `src-tauri/src/commands/types.rs` | Dodanie `project_id: Option<i64>` do `SessionRow` |
| `src-tauri/src/commands/export.rs` | Dodanie `s.project_id` do zapytania SQL i mapowania |
| `src-tauri/src/commands/import_data.rs` | Mapowanie `project_id` przy imporcie, rozszerzenie `merge_or_insert_session` |
| `src/lib/db-types.ts` | Dodanie `project_id` do interfejsu TS (jeśli brak) |
| `src-tauri/src/commands/import_data.rs` (testy) | Nowe testy + aktualizacja schematu testowego |

## Kompatybilność wsteczna

- `#[serde(default)]` na nowym polu → starsze archiwa (v1.1) deserializują się bez błędu
- Serwer przechowuje archiwum jako opaque JSON blob → nie wymaga zmian po stronie serwera
- Wersja archiwum `1.2` pozwala klientom rozpoznać obecność nowego pola

## Ryzyko

- **Niskie** - zmiana jest addytywna, nie łamie istniejących danych
- Jedyne ryzyko: starszy klient (bez tej zmiany) zignoruje `project_id` przy odczycie → ale to zachowanie identyczne jak obecne, więc nie pogarsza sytuacji
