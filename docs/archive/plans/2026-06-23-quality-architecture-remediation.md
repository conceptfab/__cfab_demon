# Plan remediacji jakości i architektury TIMEFLOW — wszystkie findings

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zrealizować WSZYSTKIE 21 findings + polish z audytu [2026-06-23-quality-architecture-audit.md](2026-06-23-quality-architecture-audit.md), likwidując dług w podsystemie sync (duplikacja, rozbieżność checksumy, podatność m24), zakładając CI i porządkując frontend/tooling/higienę — bez utraty danych i bez regresji react-doctor 100/100.

**Architecture:** Sercem planu jest nowy moduł `timeflow-shared::sync` (triggery, checksum, normalizacja czasu, listy kolumn, rdzeń merge) — jedyne źródło prawdy współdzielone przez daemon i dashboard, eliminujące copy-paste przez granicę crate'ów. Reszta to warstwy obronne (panic-guard, PRAGMA FK), bramka CI, model błędów `thiserror`, rozbicie god-files/hooków i sprzątanie.

**Tech Stack:** Rust (workspace Cargo: `timeflow-demon`, `timeflow-dashboard`, `timeflow-shared`), Tauri v2, rusqlite 0.31, React 19 + TS 5.9 + Vite + Vitest, ESLint 9 / react-hooks 7, GitHub Actions, react-doctor.

**Zasady przekrojowe (CLAUDE.md):**
- Komunikacja PL; branding `TIMEFLOW`; nie refaktoruj identyfikatorów byle wymusić nazwę.
- Każda funkcja odczuwalna przez użytkownika (nowy event postępu, zmiana zachowania ustawień) → aktualizacja `Help.tsx` w tym samym commicie.
- Po każdej Fazie: bramka jakości `npx -y react-doctor@latest . --verbose` z roota = **100/100**.
- Zmiany łamiące kompat/dane wplecione w fazy (decyzja użytkownika), ale każda z własnym testem i osobnym commitem.

**Bramki weryfikacyjne (uruchamiane na końcu każdej Fazy):**
- Backend: `cargo test -p timeflow-shared && cargo test -p timeflow-demon && cargo test -p timeflow-dashboard`
- Frontend: `cd dashboard && npm run typecheck && npm run lint && npm test && npm run build`
- Jakość: `npx -y react-doctor@latest . --verbose` (root) → 100/100

---

## Faza 0: Setup worktree + baseline

### Task 0.1: Worktree z main + baseline green

**Files:** — (operacje git)

- [ ] **Step 1: Utwórz izolowany worktree z main**

```bash
cd /Users/micz/__DEV__/__cfab_demon
git fetch origin
git worktree add ../cfab_demon-remediation -b chore/quality-remediation origin/main
cd ../cfab_demon-remediation
```

Expected: nowy worktree na świeżej gałęzi `chore/quality-remediation` z `origin/main`.

- [ ] **Step 2: Skopiuj plan do worktree (żeby executor go miał na tej gałęzi)**

```bash
mkdir -p docs/superpowers/plans
cp /Users/micz/__DEV__/__cfab_demon/docs/superpowers/plans/2026-06-23-quality-architecture-audit.md docs/superpowers/plans/
cp /Users/micz/__DEV__/__cfab_demon/docs/superpowers/plans/2026-06-23-quality-architecture-remediation.md docs/superpowers/plans/
git add docs/superpowers/plans/ && git commit -m "docs: dodaj plan remediacji jakości/architektury"
```

- [ ] **Step 3: Ustal baseline (wszystko zielone PRZED zmianami)**

Run:
```bash
cargo test -p timeflow-shared -p timeflow-demon -p timeflow-dashboard 2>&1 | tail -20
cd dashboard && npm ci && npm run typecheck && npm run lint && npm test && npm run build && cd ..
npx -y react-doctor@latest . --verbose 2>&1 | tail -5
```
Expected: testy Rust PASS, frontend PASS, react-doctor **100/100**. Jeśli cokolwiek czerwone — zatrzymaj się i napraw baseline przed Fazą 1 (inaczej nie odróżnisz regresji od pre-existing).

---

## Faza 1: Fundament `timeflow-shared::sync` (#1, #2, #6, #10 — near-zero ryzyko najpierw)

Kolejność wewnątrz fazy rosnąco wg ryzyka: triggery (stałe `&str`) → checksum/normalizacja (czyste funkcje) → listy kolumn. Każdy krok: najpierw shared + test, potem podmiana obu stron na re-export/wywołanie.

### Task 1.1: Scaffold modułu `shared::sync` + zależności

**Files:**
- Modify: `shared/lib.rs`
- Modify: `shared/Cargo.toml`
- Create: `shared/sync/mod.rs`

- [ ] **Step 1: Dodaj `sha2` do shared (potrzebne dla kanonicznej checksumy)**

W `shared/Cargo.toml` w `[dependencies]` dodaj po `chrono`:
```toml
sha2 = "0.10"
```

- [ ] **Step 2: Zadeklaruj moduł w `shared/lib.rs`**

Dodaj linię (alfabetycznie, po `pub mod secret_store;`):
```rust
pub mod sync;
```

- [ ] **Step 3: Utwórz `shared/sync/mod.rs` (re-eksport podmodułów)**

```rust
//! Współdzielony rdzeń synchronizacji TIMEFLOW.
//!
//! Jedyne źródło prawdy dla logiki sync używanej przez OBA crate'y binarne
//! (daemon: LAN sync; dashboard: import/restore z pliku). Crate'y binarne nie
//! mogą się nawzajem importować, więc wszystko, co było kopiowane między
//! `src/*` a `dashboard/src-tauri/src/*`, mieszka tutaj.

pub mod triggers;
pub mod checksum;
pub mod timestamp;
pub mod columns;
```

- [ ] **Step 4: Tymczasowe puste pliki, żeby się kompilowało**

```bash
printf '//! placeholder\n' > shared/sync/triggers.rs
printf '//! placeholder\n' > shared/sync/checksum.rs
printf '//! placeholder\n' > shared/sync/timestamp.rs
printf '//! placeholder\n' > shared/sync/columns.rs
```

- [ ] **Step 5: Kompilacja**

Run: `cargo build -p timeflow-shared`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/ && git commit -m "feat(shared): scaffold modułu shared::sync"
```

### Task 1.2: Triggery tombstone → `shared` (#6)

**Files:**
- Modify: `shared/sync/triggers.rs`
- Modify: `src/tombstone_triggers.rs` (daemon — staje się re-eksportem)
- Modify: `dashboard/src-tauri/src/db_migrations/tombstone_triggers.rs` (staje się re-eksportem)
- Test: `shared/sync/triggers.rs` (inline `#[cfg(test)]`)

- [ ] **Step 1: Wpisz kanoniczne stałe do `shared/sync/triggers.rs`**

```rust
//! Kanoniczne definicje triggerów tombstone — jedno źródło dla daemona i dashboardu.
//!
//! `merge_incoming_data` DROP-uje i CREATE-uje te triggery przy KAŻDYM merge,
//! więc rozjazd kopii cicho downgrade'uje trigger. Dlatego jedna definicja tutaj.

pub const SESSIONS_TOMBSTONE_TRIGGER_SQL: &str =
    "CREATE TRIGGER IF NOT EXISTS trg_sessions_tombstone
     AFTER DELETE ON sessions
     FOR EACH ROW
     BEGIN
         INSERT INTO tombstones (table_name, record_id, sync_key)
         VALUES (
             'sessions',
             OLD.id,
             COALESCE(
                 (SELECT executable_name FROM applications WHERE id = OLD.app_id),
                 CAST(OLD.app_id AS TEXT)
             ) || '|' || OLD.start_time
         );
     END;";

pub const APPLICATIONS_TOMBSTONE_TRIGGER_SQL: &str =
    "CREATE TRIGGER IF NOT EXISTS trg_applications_tombstone
     AFTER DELETE ON applications
     FOR EACH ROW
     BEGIN
         INSERT INTO tombstones (table_name, record_id, sync_key)
         VALUES ('applications', OLD.id, OLD.executable_name);
     END;";

pub const PROJECTS_TOMBSTONE_TRIGGER_SQL: &str =
    "CREATE TRIGGER IF NOT EXISTS trg_projects_tombstone
     AFTER DELETE ON projects
     FOR EACH ROW
     BEGIN
         INSERT INTO tombstones (table_name, record_id, sync_key)
         VALUES ('projects', OLD.id, OLD.name);
     END;";

pub const MANUAL_SESSIONS_TOMBSTONE_TRIGGER_SQL: &str =
    "CREATE TRIGGER IF NOT EXISTS trg_manual_sessions_tombstone
     AFTER DELETE ON manual_sessions
     FOR EACH ROW
     BEGIN
         INSERT INTO tombstones (table_name, record_id, sync_key)
         VALUES ('manual_sessions', OLD.id, OLD.project_id || '|' || OLD.start_time || '|' || OLD.title);
     END;";

pub const CLIENTS_TOMBSTONE_TRIGGER_SQL: &str =
    "CREATE TRIGGER IF NOT EXISTS trg_clients_tombstone
     AFTER DELETE ON clients
     FOR EACH ROW
     BEGIN
         INSERT INTO tombstones (table_name, record_id, sync_key)
         VALUES ('clients', OLD.id, OLD.name);
     END;";

pub const DROP_ALL_TOMBSTONE_TRIGGERS_SQL: [&str; 5] = [
    "DROP TRIGGER IF EXISTS trg_sessions_tombstone",
    "DROP TRIGGER IF EXISTS trg_applications_tombstone",
    "DROP TRIGGER IF EXISTS trg_projects_tombstone",
    "DROP TRIGGER IF EXISTS trg_manual_sessions_tombstone",
    "DROP TRIGGER IF EXISTS trg_clients_tombstone",
];

pub const CREATE_ALL_TOMBSTONE_TRIGGERS_SQL: [&str; 5] = [
    SESSIONS_TOMBSTONE_TRIGGER_SQL,
    APPLICATIONS_TOMBSTONE_TRIGGER_SQL,
    PROJECTS_TOMBSTONE_TRIGGER_SQL,
    MANUAL_SESSIONS_TOMBSTONE_TRIGGER_SQL,
    CLIENTS_TOMBSTONE_TRIGGER_SQL,
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_and_drop_arrays_are_aligned() {
        assert_eq!(CREATE_ALL_TOMBSTONE_TRIGGERS_SQL.len(), DROP_ALL_TOMBSTONE_TRIGGERS_SQL.len());
    }

    #[test]
    fn triggers_install_and_mint_tombstone() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, updated_at TEXT);
             CREATE TABLE tombstones (id INTEGER PRIMARY KEY, table_name TEXT, record_id INTEGER, sync_key TEXT, deleted_at TEXT DEFAULT CURRENT_TIMESTAMP);",
        ).unwrap();
        for sql in CREATE_ALL_TOMBSTONE_TRIGGERS_SQL {
            // tylko projects istnieje w tym mini-schemacie; pozostałe triggery
            // odnoszą się do nieistniejących tabel, więc instalujemy tylko projects
            if sql.contains("trg_projects_tombstone") {
                conn.execute_batch(sql).unwrap();
            }
        }
        conn.execute("INSERT INTO projects (name, updated_at) VALUES ('Acme','2026-01-01 00:00:00')", []).unwrap();
        conn.execute("DELETE FROM projects WHERE name='Acme'", []).unwrap();
        let key: String = conn.query_row(
            "SELECT sync_key FROM tombstones WHERE table_name='projects'", [], |r| r.get(0)).unwrap();
        assert_eq!(key, "Acme");
    }
}
```

- [ ] **Step 2: Test (fail → pass)**

Run: `cargo test -p timeflow-shared sync::triggers`
Expected: PASS (2 testy).

- [ ] **Step 3: Daemon `src/tombstone_triggers.rs` → re-eksport**

Zastąp CAŁĄ zawartość pliku (zachowaj `pub(crate)` aliasy, żeby istniejące `crate::tombstone_triggers::*` nadal działały):
```rust
//! Re-eksport kanonicznych triggerów z timeflow-shared::sync::triggers.
//! (Definicje przeniesione do shared — patrz finding #6.)

pub(crate) use timeflow_shared::sync::triggers::{
    CREATE_ALL_TOMBSTONE_TRIGGERS_SQL, DROP_ALL_TOMBSTONE_TRIGGERS_SQL,
};
```
Jeśli `cargo build -p timeflow-demon` zgłosi nieużywany import dla pojedynczych stałych — dodaj je do listy `use` tylko jeśli są realnie używane (grep `tombstone_triggers::`).

- [ ] **Step 4: Dashboard `db_migrations/tombstone_triggers.rs` → re-eksport**

Najpierw sprawdź, które symbole są używane:
```bash
grep -rn "tombstone_triggers::" dashboard/src-tauri/src/ | grep -v "db_migrations/tombstone_triggers.rs"
```
Zastąp zawartość, re-eksportując DOKŁADNIE te używane symbole z shared, np.:
```rust
//! Re-eksport kanonicznych triggerów z timeflow-shared::sync::triggers (finding #6).
pub(crate) use timeflow_shared::sync::triggers::{
    CREATE_ALL_TOMBSTONE_TRIGGERS_SQL, DROP_ALL_TOMBSTONE_TRIGGERS_SQL,
    PROJECTS_TOMBSTONE_TRIGGER_SQL, MANUAL_SESSIONS_TOMBSTONE_TRIGGER_SQL,
    SESSIONS_TOMBSTONE_TRIGGER_SQL, APPLICATIONS_TOMBSTONE_TRIGGER_SQL,
    CLIENTS_TOMBSTONE_TRIGGER_SQL,
};
```
(Indywidualne `DROP_*` stałe dashboardu, jeśli używane gdzie indziej, dodaj jako `pub(crate) const DROP_X: &str = "DROP TRIGGER IF EXISTS trg_x";` — są trywialne.)

- [ ] **Step 5: Build obu crate'ów**

Run: `cargo build -p timeflow-demon -p timeflow-dashboard`
Expected: PASS. (Jeśli błąd „unresolved import" — dorównaj listę re-eksportu do realnie używanych symboli.)

- [ ] **Step 6: Commit**

```bash
git add shared/ src/tombstone_triggers.rs dashboard/src-tauri/src/db_migrations/tombstone_triggers.rs
git commit -m "refactor(sync): triggery tombstone do shared::sync (finding #6)"
```

### Task 1.3: Kanoniczna checksum → `shared` (#2)

Decyzja: kanonem jest algorytm daemona (SHA-256 → 128-bit, `{:032x}`) — silniejszy i to daemon jest autorytatywną stroną LAN merge. Dashboard porzuca FNV-1a/64. Hashe nie są nigdzie persystowane (liczone tylko przy porównaniu konwergencji), więc zmiana algorytmu po obu stronach jednocześnie jest bezpieczna.

**Files:**
- Modify: `shared/sync/checksum.rs`
- Modify: `src/lan_common.rs` (daemon `compute_table_hash`)
- Modify: `dashboard/src-tauri/src/commands/helpers.rs` (dashboard `compute_table_hash` + usuń fałszywy komentarz + fn `fnv1a_64`)

- [ ] **Step 1: Test najpierw — daemon-path i dashboard-path muszą dać IDENTYCZNY hash**

Dodaj do `shared/sync/checksum.rs`:
```rust
//! Kanoniczna checksum treści tabeli (SHA-256 → 128-bit, hex 32 znaki).
//! Jedno źródło dla daemona i dashboardu (finding #2 — wcześniej rozjazd
//! SHA-256/128 vs FNV-1a/64, plus komentarz referujący nieistniejącą fn).

use sha2::{Digest, Sha256};

/// Hash treści: SHA-256 z bajtów, obcięty do 128 bitów, sformatowany jako 32-znakowy hex.
pub fn content_hash(concat: &str) -> String {
    let digest = Sha256::digest(concat.as_bytes());
    let mut bytes16 = [0u8; 16];
    bytes16.copy_from_slice(&digest[..16]);
    format!("{:032x}", u128::from_be_bytes(bytes16))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_and_32_hex_chars() {
        let a = content_hash("Acme|#fff|2026-01-01 00:00:00");
        let b = content_hash("Acme|#fff|2026-01-01 00:00:00");
        assert_eq!(a, b);
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn distinct_input_distinct_hash() {
        assert_ne!(content_hash("a"), content_hash("b"));
        assert_ne!(content_hash(""), content_hash("a"));
    }
}
```
Run: `cargo test -p timeflow-shared sync::checksum` → PASS.

- [ ] **Step 2: Daemon — podmień format na shared `content_hash`**

W `src/lan_common.rs` w `compute_table_hash`, ostatnią linię:
```rust
    format!("{:032x}", hash_128(concat.as_bytes()))
```
zamień na:
```rust
    timeflow_shared::sync::checksum::content_hash(&concat)
```
Jeśli `hash_128` nie jest już nigdzie używana (`grep -n "hash_128" src/`), usuń jej definicję.

- [ ] **Step 3: Dashboard — podmień format + usuń fałszywy komentarz i `fnv1a_64`**

W `dashboard/src-tauri/src/commands/helpers.rs`:
- Usuń funkcję `fn fnv1a_64(...)` (cała) oraz komentarz „matches daemon's lan_common::fnv1a_64".
- Ostatnią linię `compute_table_hash`:
```rust
    format!("{:016x}", fnv1a_64(concat.as_bytes()))
```
zamień na:
```rust
    timeflow_shared::sync::checksum::content_hash(&concat)
```

- [ ] **Step 4: Test integracyjny równości — w `dashboard` (ma dostęp do realnego schematu)**

Dodaj test inline w `dashboard/src-tauri/src/commands/helpers.rs` (`#[cfg(test)] mod tests`):
```rust
#[test]
fn projects_hash_matches_shared_algorithm() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, color TEXT, hourly_rate REAL,
            excluded_at TEXT, frozen_at TEXT, merged_into TEXT, client_name TEXT, status TEXT, updated_at TEXT);
         INSERT INTO projects (name,color,updated_at,status) VALUES ('Acme','#fff','2026-01-01 00:00:00','active');",
    ).unwrap();
    let h = compute_table_hash(&conn, "projects");
    assert_eq!(h.len(), 32, "checksum musi być 32-znakowym hexem (shared content_hash)");
}
```
Run: `cargo test -p timeflow-dashboard helpers` → PASS.

- [ ] **Step 5: Build + commit**

```bash
cargo build -p timeflow-demon -p timeflow-dashboard
git add shared/ src/lan_common.rs dashboard/src-tauri/src/commands/helpers.rs
git commit -m "fix(sync): jedna kanoniczna checksum w shared::sync (finding #2)"
```

### Task 1.4: Normalizacja czasu → `shared` (część #1)

**Files:**
- Modify: `shared/sync/timestamp.rs`
- Modify: `src/sync_common.rs` (daemon `normalize_ts`)
- Modify: `dashboard/src-tauri/src/commands/delta_export.rs` (`normalize_datetime_for_sqlite`)

- [ ] **Step 1: Wpisz obie funkcje do shared + test krzyżowy**

```rust
//! Normalizacja znaczników czasu do formatu SQLite ("YYYY-MM-DD HH:MM:SS", UTC),
//! by porównanie leksykograficzne było poprawne dla LWW. Wcześniej zaimplementowane
//! niezależnie po obu stronach (finding #1) — tu jedno źródło.

/// LWW-merge (daemon): RFC3339/offset → UTC; fallback naive.
pub fn normalize_ts(ts: &str) -> String {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) {
        return dt.naive_utc().format("%Y-%m-%d %H:%M:%S").to_string();
    }
    if let Ok(dt) = chrono::DateTime::parse_from_str(ts, "%Y-%m-%dT%H:%M:%S%z") {
        return dt.naive_utc().format("%Y-%m-%d %H:%M:%S").to_string();
    }
    chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%d %H:%M:%S"))
        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_else(|_| ts.to_string())
}

/// Eksport (dashboard): fast-path dla już-SQLite, RFC3339 → UTC, fallback obcięcia.
pub fn normalize_datetime_for_sqlite(s: &str) -> String {
    if s.len() == 19 && !s.contains('T') && !s.ends_with('Z') {
        return s.to_string();
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return dt.with_timezone(&chrono::Utc).format("%Y-%m-%d %H:%M:%S").to_string();
    }
    let s = s.replace('T', " ");
    let s = s.trim_end_matches('Z');
    if let Some(dot_pos) = s.find('.') {
        s[..dot_pos].to_string()
    } else if s.len() > 19 {
        s[..19].to_string()
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_agree_on_common_inputs() {
        for input in ["2026-03-29T10:00:00Z", "2026-03-29T10:00:00+02:00", "2026-03-29 08:00:00"] {
            assert_eq!(normalize_ts(input), normalize_datetime_for_sqlite(input),
                "rozjazd normalizacji dla {input}");
        }
    }

    #[test]
    fn utc_conversion() {
        assert_eq!(normalize_ts("2026-03-29T10:00:00+02:00"), "2026-03-29 08:00:00");
        assert_eq!(normalize_datetime_for_sqlite("2026-03-29T10:00:00+02:00"), "2026-03-29 08:00:00");
    }
}
```
Run: `cargo test -p timeflow-shared sync::timestamp` → PASS. (Jeśli `both_agree_on_common_inputs` FAIL na którymś wejściu — to realna pre-existing rozbieżność; udokumentuj który input i zostaw obie funkcje rozdzielne, ale NIE wymuszaj równości.)

- [ ] **Step 2: Daemon — usuń lokalny `normalize_ts`, użyj shared**

W `src/sync_common.rs` usuń `fn normalize_ts(...)` i dodaj na górze (lub przy użyciu):
```rust
use timeflow_shared::sync::timestamp::normalize_ts;
```

- [ ] **Step 3: Dashboard — przekieruj `normalize_datetime_for_sqlite` na shared**

W `dashboard/src-tauri/src/commands/delta_export.rs` zostaw publiczny wrapper `normalize_datetime_for_sqlite_pub`, ale jego ciało i prywatny `normalize_datetime_for_sqlite` zastąp delegacją:
```rust
pub fn normalize_datetime_for_sqlite_pub(s: &str) -> String {
    timeflow_shared::sync::timestamp::normalize_datetime_for_sqlite(s)
}
```
Usuń lokalną `fn normalize_datetime_for_sqlite(...)` jeśli nieużywana poza wrapperem (grep).

- [ ] **Step 4: Build + testy sync + commit**

```bash
cargo test -p timeflow-shared -p timeflow-demon -p timeflow-dashboard 2>&1 | tail -15
git add shared/ src/sync_common.rs dashboard/src-tauri/src/commands/delta_export.rs
git commit -m "refactor(sync): normalizacja czasu do shared::sync (finding #1)"
```

### Task 1.5: Listy kolumn jako jedno źródło (#10)

Cel: zlikwidować ręczne przepisywanie listy kolumn `projects` w export SELECT / delta SELECT / row-mapping / checksum. Wprowadzamy stałą + `Project::from_row`.

**Files:**
- Modify: `shared/sync/columns.rs`
- Modify: `dashboard/src-tauri/src/commands/export.rs` (użyj stałej + `from_row`)
- Modify: `dashboard/src-tauri/src/commands/delta_export.rs` (użyj stałej)

- [ ] **Step 1: Stała kolumn + builder w shared**

```rust
//! Listy kolumn synchronizowanych encji — jedno źródło dla export SELECT,
//! delta SELECT, row-mapping i checksum (finding #10 — „5 miejsc na kolumnę").

/// Kolumny `projects` w kolejności używanej przy eksporcie i mapowaniu na Project.
/// COALESCE(status,'active') zachowane jako wyrażenie SELECT — patrz PROJECT_SELECT.
pub const PROJECT_COLUMNS: &[&str] = &[
    "id", "name", "color", "hourly_rate", "created_at", "excluded_at",
    "assigned_folder_path", "is_imported", "frozen_at", "merged_into",
    "merged_at", "updated_at", "client_name", "status",
];

/// SELECT projektów do eksportu/merge (status z domyślką dla pre-m24 wierszy).
pub const PROJECT_SELECT: &str =
    "SELECT id, name, color, hourly_rate, created_at, excluded_at, assigned_folder_path, \
     is_imported, frozen_at, merged_into, merged_at, updated_at, client_name, \
     COALESCE(status, 'active') FROM projects";

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn select_lists_all_columns_in_order() {
        for (i, col) in PROJECT_COLUMNS.iter().enumerate() {
            // status pojawia się jako COALESCE(...), więc sprawdzamy nazwę bez aliasu
            if *col == "status" { continue; }
            assert!(PROJECT_SELECT.contains(col), "PROJECT_SELECT pomija kolumnę {col} (#{i})");
        }
    }
}
```
Run: `cargo test -p timeflow-shared sync::columns` → PASS.

- [ ] **Step 2: `export.rs` — użyj `PROJECT_SELECT`**

W `dashboard/src-tauri/src/commands/export.rs` zastąp dwa literały SELECT projektów (linie ~76 i ~126) przez:
```rust
timeflow_shared::sync::columns::PROJECT_SELECT
```
Mapowanie `row → Project` (linie 83-98, 105-120) zostaw — ale dodaj test, że indeksy zgadzają się z `PROJECT_COLUMNS.len()`:
```rust
#[test]
fn project_row_mapping_covers_all_columns() {
    assert_eq!(timeflow_shared::sync::columns::PROJECT_COLUMNS.len(), 14);
}
```

- [ ] **Step 3: `delta_export.rs` — użyj `PROJECT_SELECT`**

Zastąp literał SELECT projektów (linie ~85-86) przez `timeflow_shared::sync::columns::PROJECT_SELECT` (dodając ewentualne `WHERE`/filtry delty jako osobny string konkatenowany, jeśli delta ma warunek).

- [ ] **Step 4: Build + test + commit**

```bash
cargo test -p timeflow-shared -p timeflow-dashboard 2>&1 | tail -10
git add shared/ dashboard/src-tauri/src/commands/export.rs dashboard/src-tauri/src/commands/delta_export.rs
git commit -m "refactor(sync): stała PROJECT_SELECT jako jedno źródło kolumn (finding #10)"
```

- [ ] **Step 5: Bramka Fazy 1**

Run pełne bramki (backend + frontend + react-doctor). Expected: wszystko PASS, react-doctor 100/100.

---

## Faza 2: Content-hash dla wszystkich 5 encji (#3)

Dziś tylko `projects` hashuje pełny zestaw kolumn; `clients/applications/sessions/manual_sessions` hashują key+updated_at → rozjazd przy równym `updated_at` jest niewidoczny (klasa m24). Rozszerzamy SQL hashujący na pełne kolumny synchronizowane, najlepiej wyprowadzony z list kolumn.

### Task 2.1: SQL hashujący pełne kolumny — w `shared`

**Files:**
- Modify: `shared/sync/checksum.rs` (dodaj `pub fn table_hash_sql`)
- Test: inline

- [ ] **Step 1: Ustal synchronizowane kolumny każdej encji (research, NIE zgadywanie)**

```bash
# Wypisz kolumny eksportu/merge dla każdej encji:
grep -n "INSERT INTO clients\|UPDATE clients\|INSERT INTO applications\|UPDATE applications" src/sync_common.rs
grep -n "SELECT .* FROM applications\|SELECT .* FROM sessions\|SELECT .* FROM manual_sessions" src/lan_server.rs
```
Zapisz zestaw kolumn faktycznie synchronizowanych dla applications/sessions/manual_sessions (clients znamy: name, contact, address, tax_id, currency, default_hourly_rate, color, archived_at, updated_at).

- [ ] **Step 2: Dodaj `table_hash_sql` z pełnymi kolumnami (clients pełne; pozostałe z researchu)**

```rust
/// SQL budujący wejście do content_hash dla danej encji.
/// Hashuje PEŁNY zestaw synchronizowanych kolumn (finding #3) — nie tylko
/// key+updated_at — by rozjazd przy równym updated_at był wykrywalny.
pub fn table_hash_sql(table: &str) -> Option<&'static str> {
    Some(match table {
        "projects" =>
            "SELECT COALESCE(group_concat( \
                name || '|' || COALESCE(color,'') || '|' || COALESCE(hourly_rate,'') || '|' || \
                COALESCE(excluded_at,'') || '|' || COALESCE(frozen_at,'') || '|' || \
                COALESCE(merged_into,'') || '|' || COALESCE(client_name,'') || '|' || \
                COALESCE(status,'') || '|' || updated_at, ';'), '') \
             FROM (SELECT * FROM projects ORDER BY name)",
        "clients" =>
            "SELECT COALESCE(group_concat( \
                name || '|' || COALESCE(contact,'') || '|' || COALESCE(address,'') || '|' || \
                COALESCE(tax_id,'') || '|' || COALESCE(currency,'') || '|' || \
                COALESCE(default_hourly_rate,'') || '|' || COALESCE(color,'') || '|' || \
                COALESCE(archived_at,'') || '|' || updated_at, ';'), '') \
             FROM (SELECT * FROM clients ORDER BY name)",
        // applications/sessions/manual_sessions: uzupełnij pełny zestaw kolumn
        // ustalony w Step 1 — wzorzec identyczny (COALESCE każda kolumna || '|').
        "applications" => /* z researchu Step 1 */ "<APPLICATIONS_FULL_SQL>",
        "sessions" => /* z researchu Step 1 */ "<SESSIONS_FULL_SQL>",
        "manual_sessions" => /* z researchu Step 1 */ "<MANUAL_SESSIONS_FULL_SQL>",
        _ => return None,
    })
}
```
> Uwaga wykonawcy: `<..._FULL_SQL>` zastąp realnymi kolumnami z researchu Step 1 — to NIE placeholder do zostawienia, tylko jawne miejsce na zweryfikowaną listę. Zacznij od testu w Step 3, który wymusi poprawność.

- [ ] **Step 3: Test wykrywania rozjazdu (per encja) — najpierw FAIL, potem zaimplementuj SQL**

W `dashboard/src-tauri/src/commands/helpers.rs` test:
```rust
#[test]
fn clients_hash_detects_field_divergence_at_equal_updated_at() {
    let mk = |contact: &str| {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT, contact TEXT, address TEXT,
                tax_id TEXT, currency TEXT, default_hourly_rate REAL, color TEXT, archived_at TEXT,
                created_at TEXT, updated_at TEXT);").unwrap();
        conn.execute(
            "INSERT INTO clients (name,contact,color,updated_at) VALUES ('Acme',?1,'#fff','2026-01-01 00:00:00')",
            [contact]).unwrap();
        compute_table_hash(&conn, "clients")
    };
    assert_ne!(mk("a@x.pl"), mk("b@x.pl"),
        "rozjazd pola contact przy równym updated_at MUSI zmienić hash (finding #3)");
}
```
Run: `cargo test -p timeflow-dashboard clients_hash_detects` → najpierw FAIL (stary SQL hashował tylko name|updated_at), po Step 2 PASS. Analogiczne testy dla applications/sessions/manual_sessions.

- [ ] **Step 4: Podłącz `table_hash_sql` w obu `compute_table_hash`**

W daemon `src/lan_common.rs` i dashboard `helpers.rs`: zamiast lokalnego `match table { ... }` budującego SQL, użyj:
```rust
let sql = match timeflow_shared::sync::checksum::table_hash_sql(table) {
    Some(s) => s,
    None => return String::new(), // lub: zachowaj dashboardowe assignment_* lokalnie
};
```
Dashboard zachowuje `assignment_feedback`/`assignment_auto_runs` lokalnie (diagnostyczne, niesynchronizowane) — fallback po `None`.

- [ ] **Step 5: Bramka Fazy 2 + commit**

```bash
cargo test -p timeflow-shared -p timeflow-demon -p timeflow-dashboard 2>&1 | tail -15
git add shared/ src/lan_common.rs dashboard/src-tauri/src/commands/helpers.rs
git commit -m "fix(sync): content-hash pełnych kolumn dla wszystkich 5 encji (finding #3)"
```

---

## Faza 3: Rdzeń merge → `shared` (#1, dokończenie)

Najbardziej ryzykowny krok — przenosi `merge_incoming_data` (846 linii) i `apply_archive_tombstones` do jednej implementacji w `shared::sync::merge`, parametryzowanej domknięciem logowania. Daemon i dashboard wołają wspólny rdzeń. Wykonywać DOPIERO gdy Fazy 1-2 zielone (mają osłaniające testy).

### Task 3.1: Charakteryzacja — testy „golden" PRZED ruszeniem rdzenia

**Files:**
- Test: `src/sync_common.rs` (rozszerz istniejący `#[cfg(test)]`)

- [ ] **Step 1: Dodaj test roundtrip per encja, jeśli brak (clients/applications/sessions/manual_sessions)**

Wzorzec (clients): zbuduj 2 in-memory bazy z rozbieżnymi `clients`, wyeksportuj jedną, `merge_incoming_data` do drugiej, sprawdź LWW + brak utraty. Cel: te testy MUSZĄ przejść zarówno przed, jak i po ekstrakcji (charakteryzacja zachowania).
```bash
grep -n "fn test_merge\|merge_incoming_data" src/sync_common.rs | head
```
Uzupełnij brakujące encje analogicznie do istniejącego `projects` testu (~`sync_common.rs:2353`).

- [ ] **Step 2: Uruchom — wszystkie zielone (baseline zachowania)**

Run: `cargo test -p timeflow-demon merge` → PASS. Zapisz liczbę testów.

- [ ] **Step 3: Commit (same testy, bez zmian logiki)**

```bash
git add src/sync_common.rs && git commit -m "test(sync): testy charakteryzacyjne merge per encja (pre-ekstrakcja)"
```

### Task 3.2: Przenieś rdzeń merge do `shared::sync::merge`

**Files:**
- Create: `shared/sync/merge.rs`
- Modify: `shared/sync/mod.rs` (dodaj `pub mod merge;`)
- Modify: `src/sync_common.rs` (`merge_incoming_data` → cienki wrapper na shared)
- Modify: `dashboard/src-tauri/src/commands/import_data.rs` (`import_archive_into_tx`/tombstony → shared)

- [ ] **Step 1: Zaprojektuj API rdzenia (sygnatura + seam logowania)**

```rust
//! Rdzeń LWW-merge + tombstony — jedno źródło dla LAN sync (daemon) i importu
//! z pliku (dashboard). Logowanie wstrzykiwane domknięciem (każda strona ma
//! własny sink). Działa na otwartej transakcji rusqlite.

pub struct MergeHooks<'a> {
    pub log: &'a dyn Fn(&str),
}

/// Aplikuje archiwum peera do transakcji: tombstony + LWW-merge 5 encji.
/// Wymaga: triggery tombstone DROP-nięte przez wołającego, FK=OFF.
pub fn merge_archive_into_tx(
    tx: &rusqlite::Transaction<'_>,
    archive: &serde_json::Value,
    hooks: &MergeHooks<'_>,
) -> Result<(), String> {
    apply_tombstones(tx, archive, hooks)?;
    merge_clients(tx, archive, hooks)?;
    merge_projects(tx, archive, hooks)?;
    merge_applications(tx, archive, hooks)?;
    merge_sessions(tx, archive, hooks)?;
    merge_manual_sessions(tx, archive, hooks)?;
    Ok(())
}
```
Każdą `merge_*`/`apply_tombstones` przenieś 1:1 z `src/sync_common.rs` (bloki per encja, które ekstraktor pokazał — np. `merge_clients` z `sync_common.rs:765-823`), zmieniając `lan_common::sync_log(...)` na `(hooks.log)(...)`. Helpery `json_str_opt`/`json_f64_opt`/`local_tombstone_covers` też przenieś do `shared::sync::merge` (są czyste).

- [ ] **Step 2: Daemon `merge_incoming_data` → wrapper**

Zostaw w `src/sync_common.rs` całą obudowę (MERGE_MUTEX, ensure_*_columns, parsing, limit payloadu, DROP/CREATE triggerów, COMMIT), a właściwe aplikowanie zastąp wywołaniem:
```rust
let hooks = timeflow_shared::sync::merge::MergeHooks { log: &|m| lan_common::sync_log(m) };
timeflow_shared::sync::merge::merge_archive_into_tx(&tx, &archive, &hooks)?;
```
Usuń przeniesione bloki `merge_*`/`apply_tombstones` z daemona.

- [ ] **Step 3: Dashboard `import_archive_into_tx` → wrapper**

W `dashboard/src-tauri/src/commands/import_data.rs` zastąp wewnętrzną logikę tombstonów + merge encji (linie ~289-466, 550-591) wywołaniem `merge_archive_into_tx`. UWAGA: dashboard pracuje na `ExportArchive` (typowane), daemon na `serde_json::Value`. Ujednolić: w rdzeniu przyjmij `&serde_json::Value`, a dashboard serializuje `archive` do `Value` przed wywołaniem (`serde_json::to_value(&archive.data)`), albo rdzeń przyjmie trait. Wybierz `serde_json::Value` (mniejsze ryzyko, daemon już go używa).

- [ ] **Step 4: Testy charakteryzacyjne MUSZĄ nadal przechodzić**

Run: `cargo test -p timeflow-demon merge && cargo test -p timeflow-dashboard import` → identyczna liczba PASS jak w Task 3.1 Step 2.

- [ ] **Step 5: Test współdzielenia — daemon i dashboard dają identyczny wynik merge**

W `shared/sync/merge.rs` dodaj test in-memory: ten sam `archive` + ta sama baza → identyczny stan po `merge_archive_into_tx` niezależnie od sinka logów.

- [ ] **Step 6: Bramka Fazy 3 + commit**

```bash
cargo test -p timeflow-shared -p timeflow-demon -p timeflow-dashboard 2>&1 | tail -20
git add shared/ src/sync_common.rs dashboard/src-tauri/src/commands/import_data.rs
git commit -m "refactor(sync): rdzeń merge/tombstony do shared::sync::merge (finding #1)"
```

---

## Faza 4: Warstwy obronne (#4, #5, polish #79)

### Task 4.1: Panic-guard wątku master LAN-sync (#4)

**Files:**
- Modify: `src/lan_sync_orchestrator.rs:327-427`

- [ ] **Step 1: Test — panika w merge nie ubija procesu (catch_unwind)**

Trudne do testu jednostkowego na całym wątku; zamiast tego test na helperze. Wyodrębnij ciało pętli do `fn run_master_attempts(...)` i otocz wywołanie `catch_unwind`. Test: funkcja, która panikuje wewnątrz, zwraca `Err`, a flagi `sync_in_progress`/`db_frozen` zostają wyczyszczone.

- [ ] **Step 2: Owiń ciało wątku w `SyncGuard` + `catch_unwind`**

W `thread::spawn(move || { ... })` na początku ustaw guard (analogicznie do online-sync `lan_server.rs:1237`):
```rust
let _guard = crate::lan_server::SyncGuard(sync_state.clone());
let panic_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
    // ... dotychczasowe ciało wątku (pętla retry + cleanup) ...
}));
if let Err(e) = panic_result {
    sync_log(&format!("=== SYNC PANIC (przechwycony, daemon żyje): {:?} ===", e));
}
```
Guard w `Drop` wyczyści `sync_in_progress` nawet przy panice. Popraw też nieprawdziwy komentarz w `:417-418` (cleanup faktycznie nie działał przy panice przed tą zmianą).

- [ ] **Step 3: Build + test + commit**

```bash
cargo test -p timeflow-demon lan_sync_orchestrator 2>&1 | tail
git add src/lan_sync_orchestrator.rs && git commit -m "fix(sync): panic-guard wątku master LAN-sync (finding #4)"
```

### Task 4.2: Wspólny `open_sync_connection` + assert FK (#5)

**Files:**
- Create: `shared/sync/connection.rs` (+ `pub mod connection;` w `shared/sync/mod.rs`)
- Modify: `src/lan_common.rs:185-192` (daemon open → deleguje)
- Modify: `dashboard/src-tauri/src/commands/import_data.rs` (assert przy wejściu merge)

- [ ] **Step 1: Helper ustawiający wymagane PRAGMA dla ścieżki merge**

```rust
//! Otwarcie połączenia w stanie wymaganym przez merge: foreign_keys=OFF
//! (merge ręcznie zarządza FK; ON → CASCADE kasuje manual_sessions, finding #5).

pub fn set_merge_pragmas(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch("PRAGMA foreign_keys=OFF; PRAGMA synchronous=NORMAL;")
        .map_err(|e| format!("Failed to set merge pragmas: {e}"))
}

/// Debug-assert, że FK są wyłączone (wołać na wejściu rdzenia merge).
pub fn assert_fk_off(conn: &rusqlite::Connection) {
    if cfg!(debug_assertions) {
        let fk_on: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap_or(0);
        debug_assert_eq!(fk_on, 0, "merge wymaga foreign_keys=OFF (finding #5)");
    }
}
```

- [ ] **Step 2: Wywołaj assert na wejściu `merge_archive_into_tx`**

W `shared/sync/merge.rs` na początku `merge_archive_into_tx`: `crate::sync::connection::assert_fk_off(tx);` (tx Deref-uje do Connection).

- [ ] **Step 3: Daemon `open_dashboard_db` używa `set_merge_pragmas`**

W `src/lan_common.rs` zamień ręczny `execute_batch("PRAGMA foreign_keys=OFF; ...")` na `timeflow_shared::sync::connection::set_merge_pragmas(&conn)?;` (zachowaj komentarz wyjaśniający).

- [ ] **Step 4: Test — merge na FK=ON panikuje w debug**

```rust
#[test]
#[should_panic(expected = "foreign_keys=OFF")]
fn merge_asserts_fk_off() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    crate::sync::connection::assert_fk_off(&conn);
}
```

- [ ] **Step 5: Commit**

```bash
cargo test -p timeflow-shared connection 2>&1 | tail
git add shared/ src/lan_common.rs dashboard/src-tauri/src/commands/import_data.rs
git commit -m "fix(sync): wspólny open_sync_connection + assert FK=OFF (finding #5)"
```

### Task 4.3: `ensure_project_merge_columns` rozróżnia błędy (polish #79)

**Files:**
- Modify: `src/sync_common.rs:310-328`

- [ ] **Step 1: Rozróżnij „już istnieje" od realnej awarii ALTER**

Zmień obie `ensure_*` tak, by realny błąd (nie „duplicate column name") był propagowany (zmiana sygnatury na `-> Result<(), String>`), a wołający w `merge_incoming_data` go obsłużył (abort merge zamiast cichego logu).
```rust
pub(crate) fn ensure_project_merge_columns(conn: &rusqlite::Connection) -> Result<(), String> {
    for sql in ["ALTER TABLE projects ADD COLUMN merged_into TEXT",
                "ALTER TABLE projects ADD COLUMN merged_at TEXT"] {
        if let Err(e) = conn.execute(sql, []) {
            let msg = e.to_string();
            if !msg.contains("duplicate column name") {
                return Err(format!("ensure_project_merge_columns: {msg}"));
            }
        }
    }
    Ok(())
}
```
Zaktualizuj wołania: `ensure_project_merge_columns(conn)?;`

- [ ] **Step 2: Build + commit**

```bash
cargo build -p timeflow-demon && cargo test -p timeflow-demon 2>&1 | tail
git add src/sync_common.rs && git commit -m "fix(sync): ensure_*_columns abortuje przy realnym błędzie ALTER (finding #79)"
```

- [ ] **Step 3: Bramka Fazy 4** (pełne bramki + react-doctor 100/100).

---

## Faza 5: CI + luki testowe (#7, #11)

### Task 5.1: GitHub Actions CI (#7)

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Workflow (macOS — Windows cross-compile znany-zepsuty, patrz Faza 9)**

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  rust:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - run: cargo test -p timeflow-shared -p timeflow-demon -p timeflow-dashboard
  frontend:
    runs-on: macos-14
    defaults: { run: { working-directory: dashboard } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: dashboard/package-lock.json }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npm run build
  quality:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npx -y react-doctor@latest . --verbose
```

- [ ] **Step 2: Walidacja składni lokalnie (jeśli `act`/`actionlint` dostępne) + commit**

```bash
git add .github/workflows/ci.yml && git commit -m "ci: dodaj GitHub Actions (cargo test + frontend + react-doctor) (finding #7)"
```
Expected: po pushu workflow zielony (zweryfikuj w Actions po otwarciu PR).

### Task 5.2: Testy `online_sync.rs` i `delta_export.rs` (#11)

**Files:**
- Modify: `src/online_sync.rs` (dodaj `#[cfg(test)] mod tests`)
- Modify: `dashboard/src-tauri/src/commands/delta_export.rs` (dodaj testy)

- [ ] **Step 1: `delta_export.rs` — test roundtrip eksportu delty**

Test: zbuduj in-memory bazę z 2 projektami (1 zmieniony po cutoff), wywołaj delta-export, sprawdź że tylko zmieniony trafia do payloadu i `normalize_datetime_for_sqlite_pub` daje porównywalny format.

- [ ] **Step 2: `online_sync.rs` — testy czystych helperów**

Zidentyfikuj czyste funkcje (parsing, diff, normalizacja) i otocz je testami. Dla I/O-bound części wydziel logikę do testowalnych funkcji (bez sieci). Min. 3 testy.

- [ ] **Step 3: Commit**

```bash
cargo test -p timeflow-demon online_sync && cargo test -p timeflow-dashboard delta_export 2>&1 | tail
git add src/online_sync.rs dashboard/src-tauri/src/commands/delta_export.rs
git commit -m "test: pokrycie online_sync i delta_export (finding #11)"
```

### Task 5.3: Frontend — jsdom + Testing Library + coverage (#11)

**Files:**
- Modify: `dashboard/package.json` (devDeps + skrypt coverage)
- Modify: `dashboard/vitest.config.ts` (environment jsdom dla testów komponentów)
- Create: `dashboard/src/components/ui/__tests__/example.test.tsx` (smoke render)

- [ ] **Step 1: Dodaj zależności**

```bash
cd dashboard
npm i -D jsdom @testing-library/react @testing-library/dom @vitest/coverage-v8
cd ..
```

- [ ] **Step 2: Vitest — projekt jsdom dla komponentów**

W `dashboard/vitest.config.ts` w `test` dodaj `environmentMatchGlobs` (lub osobny projekt):
```ts
  test: {
    setupFiles: ['./vitest.setup.ts'],
    environmentMatchGlobs: [
      ['src/**/*.test.tsx', 'jsdom'],
    ],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
```

- [ ] **Step 3: Smoke test komponentu (fail→pass)**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Badge } from '@/components/ui/badge';

describe('Badge', () => {
  it('renderuje dzieci', () => {
    render(<Badge>TIMEFLOW</Badge>);
    expect(screen.getByText('TIMEFLOW')).toBeTruthy();
  });
});
```
Run: `cd dashboard && npx vitest run src/components/ui/__tests__/example.test.tsx` → PASS.

- [ ] **Step 4: Dodaj skrypt coverage + commit**

W `dashboard/package.json` scripts: `"test:coverage": "vitest run --coverage"`.
```bash
git add dashboard/package.json dashboard/package-lock.json dashboard/vitest.config.ts dashboard/src/components/ui/__tests__/
git commit -m "test(frontend): jsdom + Testing Library + coverage (finding #11)"
```

### Task 5.4: Audyt zależności — cargo-deny + npm audit (#11)

**Files:**
- Create: `deny.toml`
- Modify: `.github/workflows/ci.yml` (job audit)
- Modify: `dashboard/package.json` (skrypt audit)

- [ ] **Step 1: `deny.toml` minimalny**

```toml
[advisories]
yanked = "deny"
[bans]
multiple-versions = "warn"
[licenses]
allow = ["MIT", "Apache-2.0", "BSD-3-Clause", "BSD-2-Clause", "ISC", "Unicode-3.0", "Zlib"]
```

- [ ] **Step 2: Job CI**

Dodaj do `ci.yml`:
```yaml
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo install cargo-deny --locked
      - run: cargo deny check advisories bans
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd dashboard && npm audit --omit=dev || true
```

- [ ] **Step 3: Skrypt npm + commit**

`dashboard/package.json` scripts: `"audit": "npm audit --omit=dev"`.
```bash
git add deny.toml .github/workflows/ci.yml dashboard/package.json
git commit -m "ci: cargo-deny + npm audit (finding #11)"
```

- [ ] **Step 4: Bramka Fazy 5** (pełne bramki + react-doctor).

---

## Faza 6: Model błędów `thiserror` (#8)

668 wystąpień `Result<T, String>`. Wprowadzamy `CommandError` z `From`-impl-ami, by migracja była mechaniczna i bezpieczna (każdy `?` działa dalej). Migrujemy moduł po module; frontend zyskuje kod błędu, nie tylko string.

### Task 6.1: Typ `CommandError`

**Files:**
- Modify: `dashboard/src-tauri/Cargo.toml` (dodaj `thiserror = "2"`)
- Create: `dashboard/src-tauri/src/commands/error.rs`
- Modify: `dashboard/src-tauri/src/commands/mod.rs` (`mod error; pub use error::*;`)

- [ ] **Step 1: Definicja + Serialize jako kod**

```rust
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("validation: {0}")]
    Validation(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("db: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("{0}")]
    Other(String),
}

impl From<String> for CommandError {
    fn from(s: String) -> Self { CommandError::Other(s) }
}
impl From<&str> for CommandError {
    fn from(s: &str) -> Self { CommandError::Other(s.to_string()) }
}

#[derive(Serialize)]
struct WireError { code: String, message: String }

impl Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let code = match self {
            CommandError::NotFound(_) => "not_found",
            CommandError::Conflict(_) => "conflict",
            CommandError::Validation(_) => "validation",
            CommandError::Io(_) => "io",
            CommandError::Db(_) => "db",
            CommandError::Other(_) => "error",
        };
        WireError { code: code.into(), message: self.to_string() }.serialize(s)
    }
}
```
> Konflikt: `thiserror::Error` generuje `Display`, a my ręcznie piszemy `Serialize` (nie `derive`), bo chcemy kształt `{code,message}`. To celowe.

- [ ] **Step 2: Test serializacji**

```rust
#[test]
fn serializes_with_code() {
    let json = serde_json::to_string(&CommandError::NotFound("x".into())).unwrap();
    assert!(json.contains("\"code\":\"not_found\""));
    assert!(json.contains("x"));
}
```
Run: `cargo test -p timeflow-dashboard commands::error` → PASS.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src-tauri/Cargo.toml dashboard/src-tauri/src/commands/error.rs dashboard/src-tauri/src/commands/mod.rs
git commit -m "feat(commands): typ CommandError (thiserror) z kodem błędu (finding #8)"
```

### Task 6.2: Migracja modułów (iteracyjnie, 1 commit/moduł)

**Files:** kolejne `dashboard/src-tauri/src/commands/*.rs`

- [ ] **Step 1: Migruj moduł o najwyższym ryzyku najpierw (`database.rs`)**

Zamień sygnatury `-> Result<T, String>` na `-> Result<T, CommandError>`; istniejące `.map_err(|e| e.to_string())?` można zostawić (string → Other przez From) lub uściślić do wariantu. Frontend: dodaj typ `WireError` po stronie TS w `lib/tauri/core.ts` (`catch` rozpakowuje `{code,message}`).

- [ ] **Step 2: Po każdym module — build + testy + commit**

```bash
cargo test -p timeflow-dashboard 2>&1 | tail
git add -A && git commit -m "refactor(commands): <moduł> na CommandError (finding #8)"
```
Powtórz dla wszystkich modułów z `mod.rs` (lista: analysis, assignment_model, bughunter, clients, daemon, dashboard, database, delta_export, estimates, export, import, import_data, lan_server, lan_sync, log_management, online_sync, manual_sessions, monitored, projects, report, secure_store, sessions, settings, sync_log, sync_markers, time_algorithm, user_settings, pm, webserver). Migracja zachowuje kompat: frontend nadal dostaje string w `message`.

- [ ] **Step 3: Help.tsx — jeśli komunikaty błędów zmieniają się dla użytkownika**

Jeśli UI prezentuje kody błędów inaczej — zaktualizuj `Help.tsx` (sekcja o błędach/diagnostyce). W przeciwnym razie pomiń.

- [ ] **Step 4: Bramka Fazy 6.**

---

## Faza 7: Struktura backendu (#9, #18, polish #74–#78)

### Task 7.1: `gen_webrpc.cjs` w buildzie + kontrola driftu (#18)

**Files:**
- Modify: `dashboard/src-tauri/build.rs`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Build regeneruje i sprawdza brak diffa**

W `dashboard/src-tauri/build.rs` przed `tauri_build::build()`:
```rust
println!("cargo:rerun-if-changed=src/lib.rs");
println!("cargo:rerun-if-changed=scripts/gen_webrpc.cjs");
let status = std::process::Command::new("node")
    .arg("scripts/gen_webrpc.cjs").arg("--check")
    .status();
if let Ok(s) = status {
    if !s.success() {
        println!("cargo:warning=rpc_generated.rs jest nieaktualny — uruchom: node scripts/gen_webrpc.cjs");
    }
}
```
Dodaj do `gen_webrpc.cjs` tryb `--check` (generuje do tymczasowego stringa i porównuje z plikiem; exit 1 przy różnicy). Nie regenerujemy w buildzie (ryzyko niedeterminizmu) — tylko ostrzegamy; twardy gate jest w CI.

- [ ] **Step 2: CI twardo wymusza zero-diff**

Dodaj job step do `frontend`/nowego joba:
```yaml
      - run: cd dashboard/src-tauri && node scripts/gen_webrpc.cjs && git diff --exit-code src/webui/rpc_generated.rs
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src-tauri/build.rs dashboard/src-tauri/scripts/gen_webrpc.cjs .github/workflows/ci.yml
git commit -m "ci: kontrola driftu rpc_generated.rs (finding #18)"
```

### Task 7.2: Async `std::fs` → `spawn_blocking` (polish #75)

**Files:** lista z ekstrakcji (async fns): `lan_sync.rs:100,152`, `user_settings.rs:12,47`, `monitored.rs:37,477`, `import.rs:112`, `log_management.rs:56,65,113,135`, `online_sync.rs:62,92`, `settings.rs:81`.

- [ ] **Step 1: Dla każdej async komendy z blokującym `std::fs` — przenieś I/O do `spawn_blocking`**

Wzorzec (per plik:linia):
```rust
let content = tokio::task::spawn_blocking(move || std::fs::read_to_string(&path))
    .await.map_err(|e| e.to_string())??;
```
Lub: zmień komendę na zwykłą `fn` (Tauri i tak uruchamia sync-komendy poza main thread) jeśli nie ma innych `.await`.

- [ ] **Step 2: Build + commit (1 commit zbiorczy)**

```bash
cargo build -p timeflow-dashboard && cargo test -p timeflow-dashboard 2>&1 | tail
git add -A && git commit -m "perf(commands): async fs I/O przez spawn_blocking (finding #75)"
```

### Task 7.3: Jawne re-eksporty zamiast glob (polish #78)

**Files:**
- Modify: `dashboard/src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Zamień `pub use module::*` na jawne listy komend**

Dla każdego modułu wygeneruj jawną listę (grep `#[tauri::command]` w module → nazwy fn) i wpisz `pub use module::{cmd_a, cmd_b, ...}`. Pomocniczo:
```bash
for m in analysis clients projects sessions; do
  echo "// $m"; grep -A1 "#\[tauri::command\]" dashboard/src-tauri/src/commands/$m.rs | grep "fn " | sed -E 's/.*fn ([a-z0-9_]+).*/\1/'
done
```

- [ ] **Step 2: Build (kompilator zweryfikuje kompletność) + commit**

```bash
cargo build -p timeflow-dashboard 2>&1 | tail
git add dashboard/src-tauri/src/commands/mod.rs
git commit -m "refactor(commands): jawne re-eksporty zamiast glob (finding #78)"
```

### Task 7.4: Eventy postępu zamiast pollingu (polish #74) + Help.tsx

**Files:**
- Modify: sync task w `src/` emitujący przez kanał do dashboardu (lub Tauri `emit` po stronie dashboardu)
- Modify: `dashboard/src/` listener postępu
- Modify: `dashboard/src/components/.../Help.tsx`

- [ ] **Step 1: Dashboard emituje event `lan-sync-progress`**

W miejscu gdzie dashboard odpytuje `get_lan_sync_progress`, zamień polling na `app.emit("lan-sync-progress", payload)` z komendy aktualizującej postęp; frontend `listen('lan-sync-progress', ...)`. (Daemon→dashboard nadal przez HTTP; event dotyczy warstwy dashboard↔webview.)

- [ ] **Step 2: Help.tsx — opis zachowania postępu sync (CLAUDE.md: zmiana odczuwalna)**

Zaktualizuj sekcję o synchronizacji: „postęp aktualizowany na żywo (push), bez odpytywania".

- [ ] **Step 3: Test + commit**

```bash
cd dashboard && npm test && npm run typecheck && cd ..
git add -A && git commit -m "feat(sync): postęp przez eventy Tauri zamiast pollingu + Help (finding #74)"
```

### Task 7.5: Rozbicie god-files (#9) + nazewnictwo/dedup komend (polish #76, #77 — kompat)

**Files:** `src/sync_common.rs`, `dashboard/.../commands/projects.rs`, `import_data.rs`, `mod.rs`

- [ ] **Step 1: Po Fazie 3 `sync_common.rs` jest mniejszy — wydziel resztę na seamy**

Rozbij `sync_common.rs` na `sync_common/{export.rs, ensure.rs, mod.rs}` (merge już w shared). `projects.rs` → `projects/{crud,merge,folders,inference,colors}.rs` (wzorzec jak istniejący `sessions/`). Każdy ruch = osobny commit, testy zielone między.

- [ ] **Step 2: Dedup komend singular/plural (#77 — kompat: oba sterowane przez nas)**

Frontend: przełącz wywołania `delete_session`/`update_session_comment`/`assign_session_to_project`/`delete_manual_session` na warianty batch z 1-elementową listą. Usuń komendy singular z `generate_handler!` i `mod.rs`. Zregeneruj `rpc_generated.rs`. Test: `cargo test` + `npm test` zielone.

- [ ] **Step 3: Nazewnictwo (#76) — udokumentuj prefiksy legacy**

Nie zmieniaj `clients_*`/`pm_*`/`webserver_*` (back-compat IPC), ale dodaj komentarz-nagłówek w `mod.rs`: „prefiksy legacy, nowe komendy: verb_noun".

- [ ] **Step 4: Commit(y) + bramka Fazy 7.**

---

## Faza 8: Jakość frontendu (#12–#16, #19)

### Task 8.1: Write-through ustawień (#12)

**Files:**
- Modify: `dashboard/src/store/settings-store.ts`
- Modify: `dashboard/src/lib/user-settings.ts` (`managedKeys`)

- [ ] **Step 1: Ujednolić settery do wzorca self-persist (jak `setSidebarCollapsed`)**

Każdy setter (`setCurrencyCode`, `setWorkingHours`, `setLanguage`, `setSplitSettings`, `setRoundingSettings`) ma wołać odpowiednie `saveXxxSettings(...)` przed `set({...})` — analogicznie do `setSidebarCollapsed` (linie 51-54). Dodaj klucze do `managedKeys`, by `hydrateUserSettings` je synchronizował między oknem a web UI.

- [ ] **Step 2: Test (Vitest) — setter persystuje do user_settings.json (mock RPC)**

Test sprawdza, że po `setCurrencyCode('EUR')` wywołane jest `setUserSetting` z odpowiednim kluczem.

- [ ] **Step 3: Help.tsx — jeśli zachowanie ustawień zmienia się dla użytkownika** (np. „ustawienia są teraz wspólne dla okna i web UI"). Commit.

### Task 8.2: Wspólny `usePageError` (#13)

**Files:**
- Create: `dashboard/src/hooks/usePageError.ts`
- Modify: kontrolery z `console.error`/`logTauriError` połykające błędy

- [ ] **Step 1: Hook ujednolicający log+toast+stan błędu**

```ts
import { useCallback } from 'react';
import { useToast } from '@/components/ui/toast-notification';
import { getErrorMessage, logTauriError } from '@/lib/utils';

export function usePageError() {
  const { showError } = useToast();
  return useCallback((action: string, err: unknown, fallback: string) => {
    logTauriError(action, err);
    showError(getErrorMessage(err, fallback));
  }, [showError]);
}
```

- [ ] **Step 2: Podmień ciche `.catch(console.error)` / sam `logTauriError` w kontrolerach na `usePageError`** (sessions, dashboard, ai, applications — wg findingu). Test render + commit.

### Task 8.3: `useAsyncData` zamiast 11 wyciszeń `set-state-in-effect` (#15)

**Files:**
- Create: `dashboard/src/hooks/useAsyncData.ts`
- Modify: 11 sites z ekstrakcji

- [ ] **Step 1: Hook ładujący async bez set-state-in-render**

```ts
import { useEffect, useState } from 'react';

export function useAsyncData<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    loader().then(d => { if (alive) { setData(d); setError(null); } })
            .catch(e => { if (alive) setError(e); })
            .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, loading, error };
}
```

- [ ] **Step 2: Migruj load-into-state efekty (PmTemplateManager, PmSettingsCard, DataHistory, useAiPageController, useDatabaseManagementController, useClientsPageController, useLanSyncManager×2, useApplicationsPageController, ClientPage, useProjectDayTimelineController)** na `useAsyncData`, usuwając `eslint-disable react-hooks/set-state-in-effect`. (Czyste reset-state przypadki — useLanSyncManager:93, useProjectDayTimelineController:110 — zostaw lub przenieś do event-handlera; udokumentuj jeśli zostają.)

- [ ] **Step 3: `npm run lint` — liczba wyciszeń `set-state-in-effect` spada do 0 (lub udokumentowanego minimum). Commit.**

### Task 8.4: Sweep `cn()` (#16)

**Files:** 46 plików z template-literal className

- [ ] **Step 1: Zlokalizuj i zamień**

```bash
grep -rln 'className={`' dashboard/src/ | sort
```
Dla każdego: zamień `` className={`base ${cond ? 'a' : 'b'}`} `` na `className={cn('base', cond ? 'a' : 'b')}` (import `cn` z `@/lib/utils`). Priorytet: pliki z kolidującymi `text-*`/`bg-*`.

- [ ] **Step 2: `npm run build` + wizualny smoke (kilka kluczowych widoków). Commit zbiorczy.**

### Task 8.5: Split god-hooków (#14)

**Files:** `useProjectsPageController.tsx`, `useJobPool.ts`

- [ ] **Step 1: `useProjectsPageController` — wyjmij `renderProjectCard` do komponentu**

Przenieś render karty do rodzica `ProjectCard`-listy (przekaż dane, nie render-prop factory). Hook zwraca dane + akcje, nie JSX. Zmień rozszerzenie na `.ts` gdy zniknie JSX.

- [ ] **Step 2: `useJobPool` — wydziel schedulery**

Rozbij na `useLanSyncScheduler`, `useOnlineSyncScheduler`, `useDaemonSyncScheduler`, `useFileSignatureScheduler`; `useJobPool` staje się cienkim kompozytorem. Zachowaj inicjalizację deadline'ów w mount-only efekcie (react-hooks/purity).

- [ ] **Step 3: Testy (jsdom) dla wydzielonych hooków + commit.**

### Task 8.6: TS `noUncheckedIndexedAccess` (#19)

**Files:**
- Modify: `dashboard/tsconfig.app.json`

- [ ] **Step 1: Włącz flagę**

W `compilerOptions` dodaj `"noUncheckedIndexedAccess": true`.

- [ ] **Step 2: `npm run typecheck` — napraw nowe `T | undefined`**

Przejdź błędy iteracyjnie (guardy / `?.` / asercje z komentarzem). Może być sporo — to realne łapanie bugów indeksowania DB-rows.

- [ ] **Step 3: Commit + bramka Fazy 8.**

---

## Faza 9: Tooling + higiena (#17, #20, #21, polish #71–#73, #80, #81)

### Task 9.1: knip wpięty (#17)

**Files:** `dashboard/package.json`, `.github/workflows/ci.yml`

- [ ] **Step 1: Dodaj knip + skrypt**

```bash
cd dashboard && npm i -D knip && cd ..
```
`dashboard/package.json` scripts: `"lint:knip": "knip"`. Uruchom `cd dashboard && npx knip` — napraw realne dead-exports lub dopisz do `ignore` w `knip.json` (z uzasadnieniem). Dodaj `lint:knip` do joba CI.

- [ ] **Step 2: Commit.**

### Task 9.2: Ujednolicenie wersji crate'ów + version-gate (#20 — kompat/dane)

**Files:** `scripts/sync-version.cjs`, root `Cargo.toml`, `shared/Cargo.toml`, kod version-gate

- [ ] **Step 1: Zbadaj, czego używa version-gate**

```bash
grep -rn "CARGO_PKG_VERSION\|TIMEFLOW_VERSION" src/ shared/ | grep -i version
```
Decyzja: version-gate ma czytać `env!("TIMEFLOW_VERSION")` (z VERSION, build.rs już go wstrzykuje), NIE `CARGO_PKG_VERSION`. Jeśli używa `CARGO_PKG_VERSION` — przełącz na `TIMEFLOW_VERSION`.

- [ ] **Step 2: `sync-version.cjs` aktualizuje też daemon i shared**

Rozszerz skrypt o przepisanie `[package] version` w root `Cargo.toml` i `shared/Cargo.toml` (analogiczna funkcja jak `syncCargoToml`, inne ścieżki). Test: `node dashboard/scripts/sync-version.cjs` → wszystkie 3 crate'y dostają wersję z VERSION.

- [ ] **Step 3: Commit (kompat: version-gate czyta stabilne TIMEFLOW_VERSION).**

### Task 9.3: `[workspace.dependencies]` (#21)

**Files:** root `Cargo.toml`, `shared/Cargo.toml`, `dashboard/src-tauri/Cargo.toml`

- [ ] **Step 1: Hoist wspólnych zależności**

W root `Cargo.toml` dodaj:
```toml
[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
chrono = { version = "0.4", features = ["serde"] }
rusqlite = { version = "0.31", features = ["bundled"] }
log = "0.4"
sha2 = "0.10"
```
W każdym crate zamień te deps na `serde = { workspace = true }` itd. (uważaj na różne feature-sety: daemon ma rusqlite z `backup` — dodaj `features = ["backup"]` przy `workspace = true`).

- [ ] **Step 2: `cargo build --workspace` + commit.**

### Task 9.4: Higiena repo (polish #71, #72 — kompat, #73, #80)

**Files:** różne

- [ ] **Step 1: Usuń osierocony `dashboard/src-tauri/Cargo.lock` (#71)**

```bash
git rm dashboard/src-tauri/Cargo.lock
echo "Cargo.lock" >> dashboard/src-tauri/.gitignore
```

- [ ] **Step 2: Usuń duże/wrażliwe artefakty (#72 — najpierw zweryfikuj, że nie są build-inputem)**

```bash
grep -rn "projects_list.json" src/ dashboard/ scripts/ || echo "BRAK referencji — bezpieczne do usunięcia"
git rm projects_list.json icons.ai
printf 'projects_list.json\n*.ai\n' >> .gitignore
```
Jeśli grep ZNAJDZIE referencje do `projects_list.json` — NIE usuwaj, udokumentuj jako build-input i pomiń.

- [ ] **Step 3: Konsolidacja `claude.md`/TODO (#73)**

```bash
git rm claude.md           # zostaje CLAUDE.md (kanoniczny)
git rm TODO.md             # pusty; treść trzymamy w docs/TODO.md
```

- [ ] **Step 4: `bundle.targets` per platforma + `.gitignore` (#80)**

W `tauri.conf.json` zmień `"targets": "all"` na macOS-build path: `"targets": ["app", "dmg"]`. (Decyzja podpisywania macOS bez zmian — świadomy dług per PARITY.md.)

- [ ] **Step 5: Commit zbiorczy higieny.**

### Task 9.5: Windows CI compile (polish #81)

**Files:** `.github/workflows/ci.yml`

- [ ] **Step 1: Job kompilujący target Windows (smoke, bez testów na realnym sprzęcie)**

```yaml
  windows-build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - run: cargo build -p timeflow-demon
```
To zamienia „nigdy nie budowane" na „buduje się na Windows" dla kodu `platform/windows/*`.

- [ ] **Step 2: Commit + bramka Fazy 9 (pełne bramki + react-doctor 100/100).**

---

## Faza 10: Domknięcie

### Task 10.1: PARITY.md + finalna weryfikacja

**Files:** `PARITY.md`, `Help.tsx`

- [ ] **Step 1: Zaktualizuj PARITY.md** — zaznacz pozycje rozwiązane (shared::sync, content-hash 5 encji, panic-guard, CI), zaktualizuj statusy.

- [ ] **Step 2: Pełna weryfikacja end-to-end**

```bash
cargo test -p timeflow-shared -p timeflow-demon -p timeflow-dashboard
cd dashboard && npm run typecheck && npm run lint && npm test && npm run build && cd ..
npx -y react-doctor@latest . --verbose
```
Expected: wszystko PASS, react-doctor **100/100**.

- [ ] **Step 3: Test manualny LAN sync na 2 maszynach** (najważniejszy — dane): sparuj, edytuj klienta/projekt po obu stronach przy zbliżonym czasie, zsynchronizuj, potwierdź brak utraty przypisań i konwergencję. Udokumentuj wynik.

- [ ] **Step 4: Finalny commit + PR**

```bash
git push -u origin chore/quality-remediation
gh pr create --title "Remediacja jakości i architektury (audyt 2026-06-23)" --body "Realizuje wszystkie findings z docs/superpowers/plans/2026-06-23-quality-architecture-audit.md"
```

---

## Macierz pokrycia findings → taski (self-review)

| Finding | Task(i) |
|---|---|
| #1 rdzeń sync zduplikowany | 1.1, 1.4, 3.1, 3.2 |
| #2 rozjazd checksumy | 1.3 |
| #3 content-hash tylko projects | 2.1 |
| #4 master-sync bez panic-guard | 4.1 |
| #5 PRAGMA FK sprzeczność | 4.2 |
| #6 triggery zmirrorowane | 1.2 |
| #7 brak CI | 5.1 |
| #8 model błędów String | 6.1, 6.2 |
| #9 god-files | 7.5 |
| #10 „5 miejsc na kolumnę" | 1.5, 2.1 |
| #11 luki testowe | 5.2, 5.3, 5.4 |
| #12 potrójne źródło ustawień | 8.1 |
| #13 niespójne błędy frontu | 8.2 |
| #14 god-hook JSX | 8.5 |
| #15 react-hooks suppressions | 8.3 |
| #16 Tailwind bez cn() | 8.4 |
| #17 knip osierocony | 9.1 |
| #18 rpc_generated drift | 7.1 |
| #19 noUncheckedIndexedAccess | 8.6 |
| #20 wersje crate'ów | 9.2 |
| #21 workspace.dependencies | 9.3 |
| polish: orphaned Cargo.lock | 9.4/1 |
| polish: projects_list.json/icons.ai | 9.4/2 |
| polish: claude.md/TODO | 9.4/3 |
| polish: emit/events | 7.4 |
| polish: async std::fs | 7.2 |
| polish: nazewnictwo/dedup komend | 7.5/2-3 |
| polish: glob re-exports | 7.3 |
| polish: ensure_* ALTER | 4.3 |
| polish: bundle targets | 9.4/4 |
| polish: Windows parity CI | 9.5 |

Wszystkie 21 findings + 11 polish mają przypisany task.
