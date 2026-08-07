# Koszty dodatkowe (Faza 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dodać do TIMEFLOW koszty dodatkowe — kwotę z datą i komentarzem przypiętą do projektu, doliczaną do rozliczenia w estymacjach i raportach z respektowaniem wybranego okresu, w pełni synchronizowaną przez LAN/online.

**Architecture:** Nowa tabela `project_costs` (migracja `m26`) z kluczem synchronizacji `uid` (UUID), linkiem do projektu po NAZWIE (nie po `id` — `id` różni się między maszynami) i LWW po `updated_at`. Encja idzie 1:1 wzorcem `clients` z m24/m25: tombstone trigger → merge w `shared/sync/merge.rs` → eksport delty → checksum → lista tabel demona. `estimated_value` w estymacjach zostaje niezmienione (czas × stawka); koszty dochodzą jako osobne pola `costs_value` / `total_costs` / `grand_total`, dzięki czemu zaokrąglanie czasu i wykresy pozostają nietknięte, a stare archiwa dają zero kosztów.

**Tech Stack:** Rust (rusqlite, serde, tauri v2), React 19 + TypeScript + Tailwind + zustand, vitest, i18next (pl/en).

**Spec:** `docs/superpowers/specs/2026-08-07-koszty-dodatkowe-i-todo-design.md`

---

## Zanim zaczniesz — kontekst, którego nie widać z kodu

**Dlaczego link po nazwie, a nie po `id`.** Ta aplikacja synchronizuje bazy SQLite między maszynami. Autoinkrementowane `id` jest lokalne — ten sam projekt ma `id=3` na laptopie i `id=17` na desktopie. Dlatego wszystkie encje synchronizowane identyfikują projekt przez `projects.name` (patrz `projects.client_name` w m24). Konsekwencja: nie ma `FOREIGN KEY`, a kaskady kasowania i zmiany nazwy trzeba obsłużyć ręcznie (Task 2 i Task 9).

**Dlaczego `uid`, a nie klucz naturalny.** `clients` i `projects` mają unikalną nazwę, więc ona jest kluczem sync. Koszt nie ma nic unikalnego — dwa koszty tego samego dnia, tej samej kwoty, w tym samym projekcie są legalne i muszą być rozróżnialne. Stąd losowy `uid`.

**Dlaczego nie dodajemy crate'a `uuid`.** `getrandom` jest już zależnością `dashboard/src-tauri` (używa go `webui/auth.rs`). 16 bajtów entropii w hex daje ten sam efekt bez nowej zależności — CLAUDE.md §4 zabrania dokładania zależności bez uzasadnienia.

**Pułapka m24.** Migracja m24 dodała tabelę `clients`, ale nie wpięła jej w sync — po synchronizacji ginęły przypisania klientów, a usunięci klienci wracali. Naprawa wymagała osobnej migracji m25 i zmian w 6 plikach. Tasks 2–7 to komplet tego wpięcia dla `project_costs`; **żadnego z nich nie wolno pominąć**.

**Zakres tabeli `todos`.** Migracja `m26` tworzy OBIE tabele (`project_costs` i `todos`) oraz oba komplety triggerów — tak stanowi spec §11, żeby faza 2 nie wymagała kolejnej migracji. W tej fazie `todos` pozostaje pusta: żaden kod jej nie zapisuje ani nie czyta, a wpięcie jej w merge/eksport/checksum należy do fazy 2. To bezpieczne — nie ma danych, które mogłyby zginąć.

**Komendy weryfikacyjne** (uruchamiaj z podanego katalogu):

| Co | Komenda | Katalog |
|---|---|---|
| Testy Rust | `cargo test --workspace` | root repo |
| Testy pojedyncze | `cargo test --workspace <nazwa_testu> -- --nocapture` | root repo |
| Typecheck TS | `npm run typecheck` | `dashboard/` |
| Testy TS | `npm test` | `dashboard/` |
| Lint (w tym i18n + locales) | `npm run lint` | `dashboard/` |
| Audyt jakości | `npx -y react-doctor@latest . --verbose` (oczekiwane 100/100) | root repo |

---

## Struktura plików

### Nowe pliki

| Plik | Odpowiedzialność |
|---|---|
| `dashboard/src-tauri/src/db_migrations/m26_costs_and_todos.rs` | DDL obu tabel + triggery tombstone i rename-cascade |
| `dashboard/src-tauri/src/commands/costs.rs` | CRUD kosztów + agregacja per projekt (komendy Tauri) |
| `dashboard/src/lib/tauri/costs.ts` | Typy TS + bindingi `invoke` dla komend kosztów |
| `dashboard/src/lib/costs-utils.ts` | Czyste funkcje: parsowanie kwoty, sumowanie — testowalne bez renderu |
| `dashboard/src/lib/costs-utils.test.ts` | Testy powyższych |
| `dashboard/src/components/project-page/ProjectCostsSection.tsx` | Sekcja „Koszty dodatkowe" na karcie projektu |
| `dashboard/src/components/project-page/CostDialog.tsx` | Dialog dodawania/edycji kosztu |
| `dashboard/src/components/project-page/cost-dialog-state.ts` | Stan dialogu (wzorzec `manual-session-dialog-state.ts`) |

### Modyfikowane pliki

| Plik | Zmiana |
|---|---|
| `dashboard/src-tauri/src/db_migrations/mod.rs` | rejestracja `m26`, `LATEST_SCHEMA_VERSION` 25 → 26 |
| `dashboard/src-tauri/resources/sql/schema.sql` | lustro DDL dla świeżych instalacji |
| `shared/sync/triggers.rs` | 2 nowe stałe triggerów, tablice `[&str; 5]` → `[&str; 7]` |
| `src/tombstone_triggers.rs` | lustro powyższego po stronie demona |
| `shared/sync/merge.rs` | `merge_project_costs` + gałąź `project_costs` w `apply_tombstones` |
| `shared/sync/checksum.rs` | `table_hash_sql("project_costs")` |
| `dashboard/src-tauri/src/commands/types.rs` | `CostRow`, pola kosztów w `EstimateProjectRow` / `EstimateSummary` / `ProjectReportData` |
| `dashboard/src-tauri/src/commands/delta_export.rs` | `project_costs` w `DeltaData` + `TableHashes` + zapytanie eksportu |
| `dashboard/src-tauri/src/commands/helpers.rs` | `build_table_hashes` += `project_costs` |
| `dashboard/src-tauri/src/commands/export.rs` | `project_costs` w pełnym backupie |
| `dashboard/src-tauri/src/commands/import_data.rs` | wywołanie `merge_project_costs` |
| `dashboard/src-tauri/src/commands/estimates.rs` | koszty w `build_estimate_rows` i `get_estimates_summary` |
| `dashboard/src-tauri/src/commands/report.rs` | koszty w `get_project_report_data` |
| `dashboard/src-tauri/src/commands/projects.rs` | sprzątanie kosztów przy usuwaniu projektu |
| `dashboard/src-tauri/src/commands/mod.rs` | `mod costs; pub use costs::*;` |
| `dashboard/src-tauri/src/lib.rs` | rejestracja 4 komend w `invoke_handler` |
| `src/lan_common.rs` | `"project_costs"` na liście tabel checksumu |
| `src/sync_common.rs` | `ensure_project_costs_table` + wywołanie `merge_project_costs` |
| `src/lan_server.rs` | własny `TableHashes` demona (struct + konstruktor + `PartialEq`) i eksport w `build_delta_for_pull` |
| `dashboard/src/lib/db-types.ts` | pola kosztów w typach estymacji i raportu |
| `dashboard/src/lib/tauri.ts` | `export * from './tauri/costs'` |
| `dashboard/src/hooks/useProjectPageController.ts` | ładowanie i mutacje kosztów |
| `dashboard/src/pages/ProjectPageView.tsx` | osadzenie `ProjectCostsSection` |
| `dashboard/src/pages/EstimatesView.tsx` | kolumna „Koszty" + wiersz podsumowania |
| `dashboard/src/pages/report-view/*` | blok pozycji kosztowych |
| `dashboard/src/locales/pl/common.json`, `dashboard/src/locales/en/common.json` | klucze i18n |
| `dashboard/src/components/help/sections/HelpProjectsSection.tsx`, `HelpReportsSection.tsx` | opis funkcji |
| `PARITY.md` | zachowanie przy mieszanych wersjach |

---

## Task 1: Migracja m26 — tabele i triggery

**Files:**
- Create: `dashboard/src-tauri/src/db_migrations/m26_costs_and_todos.rs`
- Modify: `dashboard/src-tauri/src/db_migrations/mod.rs`
- Modify: `dashboard/src-tauri/resources/sql/schema.sql`

- [ ] **Step 1: Napisz migrację**

Utwórz `dashboard/src-tauri/src/db_migrations/m26_costs_and_todos.rs`:

```rust
use rusqlite::Connection;

/// m26: koszty dodatkowe (`project_costs`) + zadania (`todos`).
///
/// Obie encje są synchronizowane i identyfikowane przez losowy `uid` — nie mają
/// klucza naturalnego (dwa koszty tego samego dnia o tej samej kwocie są legalne).
/// Link do projektu/klienta idzie po NAZWIE, bo `id` jest lokalne per maszyna
/// (ten sam wybór co `projects.client_name` w m24). Brak FK ⇒ kasowanie i rename
/// obsługują triggery poniżej oraz kod komend (patrz `commands/projects.rs`).
///
/// `todos` powstaje tu razem z `project_costs`, żeby faza 2 (TODO) nie wymagała
/// kolejnej migracji. Do czasu fazy 2 tabela pozostaje pusta i niewpięta w sync.
pub fn run(tx: &Connection) -> Result<(), rusqlite::Error> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS project_costs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uid TEXT NOT NULL UNIQUE,
            project_name TEXT NOT NULL,
            cost_date TEXT NOT NULL,
            amount REAL NOT NULL,
            comment TEXT,
            created_at TEXT,
            updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
        );
        CREATE INDEX IF NOT EXISTS idx_project_costs_project_date
            ON project_costs(project_name, cost_date);
        CREATE INDEX IF NOT EXISTS idx_project_costs_updated_at
            ON project_costs(updated_at);

        CREATE TABLE IF NOT EXISTS todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uid TEXT NOT NULL UNIQUE,
            scope TEXT NOT NULL,
            project_name TEXT,
            client_name TEXT,
            title TEXT NOT NULL,
            notes TEXT,
            due_date TEXT,
            due_time TEXT,
            priority INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'open',
            completed_at TEXT,
            sort_order REAL,
            gcal_event_id TEXT,
            gcal_synced_at TEXT,
            created_at TEXT,
            updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
        );
        CREATE INDEX IF NOT EXISTS idx_todos_status_due ON todos(status, due_date);
        CREATE INDEX IF NOT EXISTS idx_todos_updated_at ON todos(updated_at);",
    )?;

    // Kaskada zmiany nazwy projektu — wzorzec z m20/m23. Bez tego rename projektu
    // osierociłby koszty. `updated_at` MUSI się odświeżyć, inaczej LWW nie rozniesie
    // zmiany na inne maszyny.
    tx.execute_batch(
        "DROP TRIGGER IF EXISTS trg_projects_rename_cascade_costs;
         CREATE TRIGGER trg_projects_rename_cascade_costs
         AFTER UPDATE OF name ON projects
         FOR EACH ROW
         WHEN OLD.name <> NEW.name
         BEGIN
             UPDATE project_costs
             SET project_name = NEW.name, updated_at = datetime('now')
             WHERE project_name = OLD.name;
         END;

         DROP TRIGGER IF EXISTS trg_projects_rename_cascade_todos;
         CREATE TRIGGER trg_projects_rename_cascade_todos
         AFTER UPDATE OF name ON projects
         FOR EACH ROW
         WHEN OLD.name <> NEW.name
         BEGIN
             UPDATE todos
             SET project_name = NEW.name, updated_at = datetime('now')
             WHERE project_name = OLD.name;
         END;",
    )?;

    // Triggery tombstone — kanoniczne definicje żyją w shared/sync/triggers.rs,
    // bo `merge_incoming_data` DROP-uje i CREATE-uje je przy każdym merge.
    tx.execute_batch(timeflow_shared::sync::triggers::PROJECT_COSTS_TOMBSTONE_TRIGGER_SQL)?;
    tx.execute_batch(timeflow_shared::sync::triggers::TODOS_TOMBSTONE_TRIGGER_SQL)?;

    Ok(())
}
```

> Ta migracja odwołuje się do stałych, które powstają w Task 2. Kod nie skompiluje się do czasu ukończenia Task 2 — to normalne; kompilację weryfikujemy na końcu Task 2.

- [ ] **Step 2: Zarejestruj migrację**

W `dashboard/src-tauri/src/db_migrations/mod.rs` dopisz moduł po `mod m25_clients_tombstone;`:

```rust
mod m26_costs_and_todos;
```

Zmień stałą:

```rust
pub(crate) const LATEST_SCHEMA_VERSION: i64 = 26;
```

Dopisz wywołanie zaraz po bloku `if current_version < 25 { ... }`, przed `tx.execute("INSERT OR REPLACE INTO schema_version ...")`:

```rust
    if current_version < 26 {
        m26_costs_and_todos::run(&tx)?;
    }
```

- [ ] **Step 3: Dopisz lustro do schema.sql**

Na końcu `dashboard/src-tauri/resources/sql/schema.sql` dopisz ten sam DDL (świeże instalacje nie przechodzą przez migracje):

```sql
CREATE TABLE IF NOT EXISTS project_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    project_name TEXT NOT NULL,
    cost_date TEXT NOT NULL,
    amount REAL NOT NULL,
    comment TEXT,
    created_at TEXT,
    updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
);

CREATE INDEX IF NOT EXISTS idx_project_costs_project_date ON project_costs(project_name, cost_date);
CREATE INDEX IF NOT EXISTS idx_project_costs_updated_at ON project_costs(updated_at);

CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    scope TEXT NOT NULL,
    project_name TEXT,
    client_name TEXT,
    title TEXT NOT NULL,
    notes TEXT,
    due_date TEXT,
    due_time TEXT,
    priority INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'open',
    completed_at TEXT,
    sort_order REAL,
    gcal_event_id TEXT,
    gcal_synced_at TEXT,
    created_at TEXT,
    updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
);

CREATE INDEX IF NOT EXISTS idx_todos_status_due ON todos(status, due_date);
CREATE INDEX IF NOT EXISTS idx_todos_updated_at ON todos(updated_at);

CREATE TRIGGER IF NOT EXISTS trg_project_costs_tombstone
AFTER DELETE ON project_costs
FOR EACH ROW
BEGIN
    INSERT INTO tombstones (table_name, record_id, sync_key)
    VALUES ('project_costs', OLD.id, OLD.uid);
END;

CREATE TRIGGER IF NOT EXISTS trg_todos_tombstone
AFTER DELETE ON todos
FOR EACH ROW
BEGIN
    INSERT INTO tombstones (table_name, record_id, sync_key)
    VALUES ('todos', OLD.id, OLD.uid);
END;

CREATE TRIGGER IF NOT EXISTS trg_projects_rename_cascade_costs
AFTER UPDATE OF name ON projects
FOR EACH ROW
WHEN OLD.name <> NEW.name
BEGIN
    UPDATE project_costs
    SET project_name = NEW.name, updated_at = datetime('now')
    WHERE project_name = OLD.name;
END;

CREATE TRIGGER IF NOT EXISTS trg_projects_rename_cascade_todos
AFTER UPDATE OF name ON projects
FOR EACH ROW
WHEN OLD.name <> NEW.name
BEGIN
    UPDATE todos
    SET project_name = NEW.name, updated_at = datetime('now')
    WHERE project_name = OLD.name;
END;
```

- [ ] **Step 4: Commit (kompilacja dopiero po Task 2)**

```bash
git add dashboard/src-tauri/src/db_migrations/m26_costs_and_todos.rs \
        dashboard/src-tauri/src/db_migrations/mod.rs \
        dashboard/src-tauri/resources/sql/schema.sql
git commit -m "feat(db): m26 migration for project_costs and todos tables"
```

---

## Task 2: Triggery tombstone w shared/sync

**Files:**
- Modify: `shared/sync/triggers.rs`
- Modify: `src/tombstone_triggers.rs`

- [ ] **Step 1: Uruchom istniejący test, żeby zobaczyć stan wyjściowy**

Run: `cargo test --workspace create_and_drop_arrays_are_aligned`
Expected: PASS (tablice mają po 5 elementów)

- [ ] **Step 2: Napisz test wymuszający obecność nowych triggerów**

W `shared/sync/triggers.rs`, w bloku `mod tests`, dopisz:

```rust
    #[test]
    fn costs_and_todos_triggers_are_registered() {
        assert_eq!(CREATE_ALL_TOMBSTONE_TRIGGERS_SQL.len(), 7);
        let joined = CREATE_ALL_TOMBSTONE_TRIGGERS_SQL.join("\n");
        assert!(joined.contains("trg_project_costs_tombstone"));
        assert!(joined.contains("trg_todos_tombstone"));
        let dropped = DROP_ALL_TOMBSTONE_TRIGGERS_SQL.join("\n");
        assert!(dropped.contains("trg_project_costs_tombstone"));
        assert!(dropped.contains("trg_todos_tombstone"));
    }
```

- [ ] **Step 3: Uruchom test — musi nie przejść**

Run: `cargo test --workspace costs_and_todos_triggers_are_registered`
Expected: FAIL — kompilacja przechodzi, ale `assert_eq!(..., 7)` pada na wartości 5

- [ ] **Step 4: Dodaj stałe i rozszerz tablice**

W `shared/sync/triggers.rs`, po `CLIENTS_TOMBSTONE_TRIGGER_SQL`, dopisz:

```rust
pub const PROJECT_COSTS_TOMBSTONE_TRIGGER_SQL: &str =
    "CREATE TRIGGER IF NOT EXISTS trg_project_costs_tombstone
     AFTER DELETE ON project_costs
     FOR EACH ROW
     BEGIN
         INSERT INTO tombstones (table_name, record_id, sync_key)
         VALUES ('project_costs', OLD.id, OLD.uid);
     END;";

pub const TODOS_TOMBSTONE_TRIGGER_SQL: &str =
    "CREATE TRIGGER IF NOT EXISTS trg_todos_tombstone
     AFTER DELETE ON todos
     FOR EACH ROW
     BEGIN
         INSERT INTO tombstones (table_name, record_id, sync_key)
         VALUES ('todos', OLD.id, OLD.uid);
     END;";
```

Zamień obie tablice:

```rust
pub const DROP_ALL_TOMBSTONE_TRIGGERS_SQL: [&str; 7] = [
    "DROP TRIGGER IF EXISTS trg_sessions_tombstone",
    "DROP TRIGGER IF EXISTS trg_applications_tombstone",
    "DROP TRIGGER IF EXISTS trg_projects_tombstone",
    "DROP TRIGGER IF EXISTS trg_manual_sessions_tombstone",
    "DROP TRIGGER IF EXISTS trg_clients_tombstone",
    "DROP TRIGGER IF EXISTS trg_project_costs_tombstone",
    "DROP TRIGGER IF EXISTS trg_todos_tombstone",
];

pub const CREATE_ALL_TOMBSTONE_TRIGGERS_SQL: [&str; 7] = [
    SESSIONS_TOMBSTONE_TRIGGER_SQL,
    APPLICATIONS_TOMBSTONE_TRIGGER_SQL,
    PROJECTS_TOMBSTONE_TRIGGER_SQL,
    MANUAL_SESSIONS_TOMBSTONE_TRIGGER_SQL,
    CLIENTS_TOMBSTONE_TRIGGER_SQL,
    PROJECT_COSTS_TOMBSTONE_TRIGGER_SQL,
    TODOS_TOMBSTONE_TRIGGER_SQL,
];
```

- [ ] **Step 5: Zaktualizuj lustro po stronie demona**

Otwórz `src/tombstone_triggers.rs` i sprawdź, jak realizuje lustro (re-eksport ze `shared` albo własna kopia stałych). Jeśli to re-eksport — nic nie zmieniaj. Jeśli własne kopie — dopisz te same dwie stałe i rozszerz obie tablice do 7 elementów, dokładnie jak wyżej.

Run: `grep -n "CREATE_ALL_TOMBSTONE_TRIGGERS_SQL\|pub use" src/tombstone_triggers.rs`

- [ ] **Step 5a: Zapewnij istnienie obu tabel w demonie — OBOWIĄZKOWE w tym tasku**

> **Dlaczego tutaj, a nie w Task 6.** `merge_incoming_data` (`src/sync_common.rs`) bezwarunkowo DROP-uje i CREATE-uje **wszystkie** triggery z tablicy przy KAŻDYM merge. Z chwilą rozszerzenia tablicy do 7 pozycji demon próbuje `CREATE TRIGGER ... ON project_costs` — a demon ma własny, ręcznie pisany schemat i NIE uruchamia migracji dashboardu. Bez tego kroku merge wywala się na `no such table: main.project_costs` i przestaje działać **cała** synchronizacja (sesje, projekty, aplikacje — nie tylko koszty), bo pętla tworzenia triggerów przerywa się na pierwszym błędzie. Zweryfikowane: pominięcie tego kroku wywraca 24 testy w `sync_common::tests`.

W `src/sync_common.rs`, obok `ensure_project_client_columns`, dodaj:

```rust
/// Tabele encji z m26. Tworzone awaryjnie, bo demon ma własny schemat i NIE
/// uruchamia migracji dashboardu. Wołane przed odtworzeniem triggerów tombstone —
/// `CREATE TRIGGER ... ON <tabela>` wymaga istniejącej tabeli, a błąd przerwałby
/// CAŁY merge, nie tylko część kosztową.
///
/// `todos` jest tworzona razem z `project_costs`, bo jej trigger też jest już
/// w `CREATE_ALL_TOMBSTONE_TRIGGERS_SQL` (kod zadań dochodzi dopiero w fazie 2).
pub fn ensure_m26_entity_tables(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS project_costs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uid TEXT NOT NULL UNIQUE,
            project_name TEXT NOT NULL,
            cost_date TEXT NOT NULL,
            amount REAL NOT NULL,
            comment TEXT,
            created_at TEXT,
            updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
        );
        CREATE INDEX IF NOT EXISTS idx_project_costs_project_date
            ON project_costs(project_name, cost_date);
        CREATE INDEX IF NOT EXISTS idx_project_costs_updated_at
            ON project_costs(updated_at);

        CREATE TABLE IF NOT EXISTS todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uid TEXT NOT NULL UNIQUE,
            scope TEXT NOT NULL,
            project_name TEXT,
            client_name TEXT,
            title TEXT NOT NULL,
            notes TEXT,
            due_date TEXT,
            due_time TEXT,
            priority INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'open',
            completed_at TEXT,
            sort_order REAL,
            gcal_event_id TEXT,
            gcal_synced_at TEXT,
            created_at TEXT,
            updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
        );
        CREATE INDEX IF NOT EXISTS idx_todos_status_due ON todos(status, due_date);
        CREATE INDEX IF NOT EXISTS idx_todos_updated_at ON todos(updated_at);",
    )
    .map_err(|e| format!("ensure_m26_entity_tables: {e}"))
}
```

W `merge_incoming_data`, zaraz po `ensure_project_client_columns(conn)?;` (czyli PRZED otwarciem transakcji i pętlą DROP triggerów):

```rust
    ensure_m26_entity_tables(conn)?;
```

**Znana kruchość (świadomie nienaprawiana).** `verify_merge_integrity` ma WŁASNĄ, wewnętrzną pętlę DROP/CREATE wszystkich triggerów, odpalaną warunkowo przy `!fk_errors.is_empty()` (`src/sync_common.rs:~856`). Nie dostaje `ensure_m26_entity_tables`, bo wszystkie cztery produkcyjne wywołania (`lan_server.rs:1030`, `lan_sync_orchestrator.rs:663`, `online_store_forward.rs:382`, `online_async_delta.rs:371`) lecą bezpośrednio po `merge_incoming_data` na tej samej bazie — tabele zawsze już istnieją. Skutek uboczny: test wołający `verify_merge_integrity` w izolacji, na ręcznie zbudowanym schemacie, musi sam utworzyć tabele m26. Jeśli kiedyś pojawi się wywołanie `verify_merge_integrity` BEZ poprzedzającego merge, trzeba tam dodać `ensure_m26_entity_tables`.

Fixture'y testowe budujące schemat ręcznie i instalujące `CREATE_ALL_TOMBSTONE_TRIGGERS_SQL` (np. `orphan_cleanup_in_verify_does_not_mint_tombstones`) muszą dostać minimalne `project_costs` i `todos` — tak jak wcześniej dostały `clients`.

Dodaj też test regresji w `mod tests`:

```rust
    /// Rozszerzenie tablicy triggerów o m26 wywracało CAŁY merge na demonie,
    /// bo demon nie uruchamia migracji dashboardu i nie ma tych tabel.
    #[test]
    fn ensure_m26_entity_tables_is_idempotent() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory");
        ensure_m26_entity_tables(&conn).expect("pierwsze wywolanie");
        ensure_m26_entity_tables(&conn).expect("drugie wywolanie musi byc no-op");
        conn.execute(
            "INSERT INTO project_costs (uid, project_name, cost_date, amount, updated_at)
             VALUES ('u1', 'Acme', '2026-05-10', 10.0, '2026-05-10 10:00:00')",
            [],
        )
        .expect("insert po ensure");
        conn.execute(
            "INSERT INTO todos (uid, scope, title, updated_at)
             VALUES ('t1', 'global', 'zadanie', '2026-05-10 10:00:00')",
            [],
        )
        .expect("insert todo po ensure");
    }
```

- [ ] **Step 6: Uruchom testy**

Run: `cargo test --workspace triggers`
Expected: PASS — `create_and_drop_arrays_are_aligned` oraz `costs_and_todos_triggers_are_registered`

- [ ] **Step 7: Zweryfikuj CAŁY workspace (Task 1 + Task 2 razem)**

Run: `cargo build --workspace`
Expected: sukces, bez błędów o brakujących stałych w `m26_costs_and_todos.rs`

Run: `cargo test --workspace`
Expected: PASS — **cały** workspace, nie tylko filtr `triggers`. W szczególności `sync_common::tests` w crate `timeflow-demon` musi przejść w komplecie; jeśli sypie się `no such table: main.project_costs`, to znaczy że Step 5a został pominięty.

- [ ] **Step 8: Commit**

```bash
git add shared/sync/triggers.rs src/tombstone_triggers.rs src/sync_common.rs
git commit -m "feat(sync): tombstone triggers for project_costs and todos"
```

---

## Task 3: Merge kosztów w shared/sync/merge.rs

**Files:**
- Modify: `shared/sync/merge.rs`

- [ ] **Step 1: Napisz test LWW + tombstone**

W `shared/sync/merge.rs`, na końcu pliku, dodaj (jeśli plik nie ma jeszcze `mod tests`, utwórz go):

```rust
#[cfg(test)]
mod project_costs_merge_tests {
    use super::*;

    fn make_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory");
        conn.execute_batch(
            "PRAGMA foreign_keys=OFF;
             CREATE TABLE project_costs (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 uid TEXT NOT NULL UNIQUE,
                 project_name TEXT NOT NULL,
                 cost_date TEXT NOT NULL,
                 amount REAL NOT NULL,
                 comment TEXT,
                 created_at TEXT,
                 updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
             );
             CREATE TABLE tombstones (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 table_name TEXT NOT NULL,
                 record_id INTEGER,
                 record_uuid TEXT,
                 deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                 sync_key TEXT
             );
             CREATE TABLE sync_merge_log (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 table_name TEXT, record_key TEXT, resolution TEXT,
                 local_updated_at TEXT, remote_updated_at TEXT, winner TEXT
             );",
        )
        .expect("schema");
        conn
    }

    fn hooks() -> MergeHooks<'static> {
        MergeHooks { log: &|_: &str| {}, diag: false }
    }

    /// Nowszy rekord peera nadpisuje lokalny; starszy jest ignorowany.
    #[test]
    fn merge_costs_last_writer_wins() {
        let mut conn = make_db();
        conn.execute(
            "INSERT INTO project_costs (uid, project_name, cost_date, amount, comment, updated_at)
             VALUES ('u1', 'Acme', '2026-05-10', 100.0, 'stary', '2026-05-10 10:00:00')",
            [],
        )
        .unwrap();

        // Peer ma NOWSZĄ wersję → wygrywa
        let newer = serde_json::json!({
            "data": { "project_costs": [{
                "uid": "u1", "project_name": "Acme", "cost_date": "2026-05-11",
                "amount": 250.0, "comment": "nowy", "created_at": "2026-05-10 10:00:00",
                "updated_at": "2026-05-12 09:00:00"
            }]}
        });
        let tx = conn.transaction().unwrap();
        merge_project_costs(&tx, &newer, &hooks()).unwrap();
        tx.commit().unwrap();

        let (amount, comment): (f64, String) = conn
            .query_row(
                "SELECT amount, comment FROM project_costs WHERE uid = 'u1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(amount, 250.0);
        assert_eq!(comment, "nowy");

        // Peer ma STARSZĄ wersję → lokalne zostaje
        let older = serde_json::json!({
            "data": { "project_costs": [{
                "uid": "u1", "project_name": "Acme", "cost_date": "2026-05-01",
                "amount": 5.0, "comment": "przestarzale",
                "updated_at": "2026-05-01 08:00:00"
            }]}
        });
        let tx = conn.transaction().unwrap();
        merge_project_costs(&tx, &older, &hooks()).unwrap();
        tx.commit().unwrap();

        let amount: f64 = conn
            .query_row("SELECT amount FROM project_costs WHERE uid = 'u1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(amount, 250.0, "starszy rekord peera nie moze nadpisac lokalnego");
    }

    /// Rekord peera nie może wskrzesić kosztu skasowanego lokalnie później.
    #[test]
    fn merge_costs_respects_local_tombstone() {
        let mut conn = make_db();
        conn.execute(
            "INSERT INTO tombstones (table_name, sync_key, deleted_at)
             VALUES ('project_costs', 'u2', '2026-06-01 12:00:00')",
            [],
        )
        .unwrap();

        let archive = serde_json::json!({
            "data": { "project_costs": [{
                "uid": "u2", "project_name": "Acme", "cost_date": "2026-05-20",
                "amount": 99.0, "updated_at": "2026-05-20 10:00:00"
            }]}
        });
        let tx = conn.transaction().unwrap();
        merge_project_costs(&tx, &archive, &hooks()).unwrap();
        tx.commit().unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM project_costs WHERE uid = 'u2'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0, "tombstone nowszy niz rekord peera blokuje wskrzeszenie");
    }

    /// Tombstone peera kasuje lokalny koszt.
    #[test]
    fn apply_tombstone_deletes_cost() {
        let mut conn = make_db();
        conn.execute(
            "INSERT INTO project_costs (uid, project_name, cost_date, amount, updated_at)
             VALUES ('u3', 'Acme', '2026-05-10', 100.0, '2026-05-10 10:00:00')",
            [],
        )
        .unwrap();

        let archive = serde_json::json!({
            "data": { "tombstones": [{
                "table_name": "project_costs", "record_id": 1,
                "sync_key": "u3", "deleted_at": "2026-06-01 12:00:00"
            }]}
        });
        let tx = conn.transaction().unwrap();
        apply_tombstones(&tx, &archive, &hooks()).unwrap();
        tx.commit().unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM project_costs WHERE uid = 'u3'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    /// Rekord odtworzony PO tombstonie nie może zostać skasowany starym tombstonem.
    #[test]
    fn apply_tombstone_skips_cost_updated_after_delete() {
        let mut conn = make_db();
        conn.execute(
            "INSERT INTO project_costs (uid, project_name, cost_date, amount, updated_at)
             VALUES ('u4', 'Acme', '2026-05-10', 100.0, '2026-06-05 10:00:00')",
            [],
        )
        .unwrap();

        let archive = serde_json::json!({
            "data": { "tombstones": [{
                "table_name": "project_costs", "record_id": 1,
                "sync_key": "u4", "deleted_at": "2026-06-01 12:00:00"
            }]}
        });
        let tx = conn.transaction().unwrap();
        apply_tombstones(&tx, &archive, &hooks()).unwrap();
        tx.commit().unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM project_costs WHERE uid = 'u4'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "rekord nowszy niz tombstone musi przetrwac");
    }

    /// Rekord bez `uid` nie może wywrócić transakcji merge.
    #[test]
    fn merge_costs_skips_row_without_uid() {
        let mut conn = make_db();
        let archive = serde_json::json!({
            "data": { "project_costs": [{
                "project_name": "Acme", "cost_date": "2026-05-10",
                "amount": 10.0, "updated_at": "2026-05-10 10:00:00"
            }]}
        });
        let tx = conn.transaction().unwrap();
        merge_project_costs(&tx, &archive, &hooks()).expect("brak uid nie moze byc bledem");
        tx.commit().unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM project_costs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
}
```

- [ ] **Step 2: Uruchom testy — muszą nie przejść**

Run: `cargo test --workspace project_costs_merge_tests`
Expected: FAIL — `cannot find function 'merge_project_costs' in this scope`

- [ ] **Step 3: Dodaj `merge_project_costs`**

W `shared/sync/merge.rs`, bezpośrednio po funkcji `merge_clients`, dopisz:

```rust
/// Merge kosztów dodatkowych (m26). Identyfikacja po `uid` — koszt nie ma klucza
/// naturalnego (dwa koszty tego samego dnia o tej samej kwocie są legalne).
/// Last-writer-wins po `updated_at`; lokalny tombstone nowszy niż rekord peera
/// blokuje wskrzeszenie. `project_name` jedzie jako nazwa, bo `id` jest lokalne.
pub fn merge_project_costs(
    tx: &rusqlite::Transaction<'_>,
    archive: &serde_json::Value,
    _hooks: &MergeHooks<'_>,
) -> Result<(), String> {
    let Some(costs) = archive.pointer("/data/project_costs").and_then(|v| v.as_array()) else {
        return Ok(());
    };
    for c in costs {
        let uid = c.get("uid").and_then(|v| v.as_str()).unwrap_or("");
        if uid.is_empty() {
            continue;
        }
        let updated_at = c.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
        if local_tombstone_covers(tx, "project_costs", uid, updated_at) {
            continue;
        }
        let project_name = json_str_opt(c, "project_name").unwrap_or_default();
        if project_name.is_empty() {
            continue;
        }
        let cost_date = json_str_opt(c, "cost_date").unwrap_or_default();
        // json_f64 (nie json_f64_opt) — koszt 0.0 jest legalny, a json_f64_opt
        // odfiltrowuje wartości <= 0.
        let amount = json_f64(c, "amount");
        let comment = json_str_opt(c, "comment");

        let local_ts: Option<String> = tx
            .query_row(
                "SELECT updated_at FROM project_costs WHERE uid = ?1",
                [uid],
                |row| row.get(0),
            )
            .ok();

        match local_ts {
            Some(lt) if normalize_ts(&lt) >= normalize_ts(updated_at) => { /* local wins */ }
            Some(lt) => {
                log_merge_conflict(tx, "project_costs", uid, &lt, updated_at, "remote");
                tx.execute(
                    "UPDATE project_costs SET project_name = ?1, cost_date = ?2, amount = ?3, \
                     comment = ?4, updated_at = ?5 WHERE uid = ?6",
                    rusqlite::params![project_name, cost_date, amount, comment, updated_at, uid],
                )
                .map_err(|e| e.to_string())?;
            }
            None => {
                tx.execute(
                    "INSERT INTO project_costs (uid, project_name, cost_date, amount, comment, \
                     created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    rusqlite::params![
                        uid,
                        project_name,
                        cost_date,
                        amount,
                        comment,
                        json_str_opt(c, "created_at"),
                        updated_at,
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}
```

- [ ] **Step 4: Dodaj gałąź `project_costs` do `apply_tombstones`**

W funkcji `apply_tombstones`, w bloku `let skip_tombstone = match table_name {`, dopisz przed `_ => false,`:

```rust
                    "project_costs" => {
                        // sync_key = uid
                        let local_updated: Option<String> = tx
                            .query_row(
                                "SELECT updated_at FROM project_costs WHERE uid = ?1",
                                [sync_key],
                                |row| row.get(0),
                            )
                            .ok();
                        local_updated
                            .as_deref()
                            .map(|lu| normalize_ts(lu) > normalize_ts(deleted_at_str))
                            .unwrap_or(false)
                    }
```

W drugim `match table_name {` (blok kasujący, ten z gałęzią `"clients"`), dopisz przed `_ => { log::warn!(...) }`:

```rust
                    "project_costs" => {
                        // Brak FK — koszt nie ma zależnych rekordów do posprzątania.
                        let _ = tx.execute("DELETE FROM project_costs WHERE uid = ?1", [sync_key]);
                    }
```

- [ ] **Step 5: Uruchom testy**

Run: `cargo test --workspace project_costs_merge_tests`
Expected: PASS — 5 testów

- [ ] **Step 6: Commit**

```bash
git add shared/sync/merge.rs
git commit -m "feat(sync): LWW merge and tombstone handling for project_costs"
```

---

## Task 4: Checksum treści tabeli

**Files:**
- Modify: `shared/sync/checksum.rs`

- [ ] **Step 1: Rozszerz istniejący test o nową tabelę**

W `shared/sync/checksum.rs`, w `mod table_hash_sql_tests`, w teście `known_tables_have_sql_unknown_none` dopisz `"project_costs"` do listy tabel:

```rust
        for t in [
            "projects", "clients", "applications", "sessions", "manual_sessions",
            "assignment_feedback", "assignment_auto_runs", "project_costs",
        ] {
            assert!(table_hash_sql(t).is_some(), "brak SQL dla {t}");
        }
```

Dodaj też test wykrywania rozjazdu:

```rust
    /// Checksum musi reagować na zmianę KWOTY, nie tylko na uid/updated_at —
    /// inaczej rozjazd wyglądałby na "zsynchronizowane" i nigdy by się nie wyleczył.
    #[test]
    fn project_costs_hash_detects_amount_drift() {
        let schema = "CREATE TABLE project_costs (
            id INTEGER PRIMARY KEY, uid TEXT NOT NULL UNIQUE, project_name TEXT NOT NULL,
            cost_date TEXT NOT NULL, amount REAL NOT NULL, comment TEXT,
            created_at TEXT, updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00');";

        let conn_a = rusqlite::Connection::open_in_memory().unwrap();
        conn_a.execute_batch(schema).unwrap();
        conn_a.execute(
            "INSERT INTO project_costs (uid, project_name, cost_date, amount, updated_at)
             VALUES ('u1', 'Acme', '2026-05-10', 100.0, '2026-05-10 10:00:00')",
            [],
        ).unwrap();

        let conn_b = rusqlite::Connection::open_in_memory().unwrap();
        conn_b.execute_batch(schema).unwrap();
        conn_b.execute(
            "INSERT INTO project_costs (uid, project_name, cost_date, amount, updated_at)
             VALUES ('u1', 'Acme', '2026-05-10', 999.0, '2026-05-10 10:00:00')",
            [],
        ).unwrap();

        let sql = table_hash_sql("project_costs").unwrap();
        let raw_a: String = conn_a.query_row(sql, [], |r| r.get(0)).unwrap();
        let raw_b: String = conn_b.query_row(sql, [], |r| r.get(0)).unwrap();
        assert_ne!(content_hash(&raw_a), content_hash(&raw_b));
    }
```

- [ ] **Step 2: Uruchom testy — muszą nie przejść**

Run: `cargo test --workspace table_hash_sql_tests`
Expected: FAIL — `brak SQL dla project_costs` oraz panic w `project_costs_hash_detects_amount_drift`

- [ ] **Step 3: Dodaj SQL hashujący**

W `shared/sync/checksum.rs`, w `table_hash_sql`, dopisz przed `_ => return None,`:

```rust
        "project_costs" =>
            "SELECT COALESCE(group_concat( \
                uid || '|' || project_name || '|' || cost_date || '|' || amount || '|' || \
                COALESCE(comment,'') || '|' || updated_at, ';'), '') \
             FROM (SELECT * FROM project_costs ORDER BY uid)",
```

- [ ] **Step 4: Uruchom testy**

Run: `cargo test --workspace table_hash_sql_tests`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/sync/checksum.rs
git commit -m "feat(sync): content hash for project_costs table"
```

---

## Task 5: Eksport delty (dashboard)

**Files:**
- Modify: `dashboard/src-tauri/src/commands/types.rs`
- Modify: `dashboard/src-tauri/src/commands/delta_export.rs`
- Modify: `dashboard/src-tauri/src/commands/helpers.rs`

- [ ] **Step 1: Dodaj typ `CostRow`**

W `dashboard/src-tauri/src/commands/types.rs`, obok `ClientRow` (ok. linii 51), dopisz:

```rust
/// Wiersz kosztu dodatkowego (m26). Serializowany do sync i do UI.
/// `uid` jest kluczem synchronizacji; `project_name` linkuje projekt po NAZWIE.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CostRow {
    #[serde(default)]
    pub uid: String,
    #[serde(default)]
    pub project_name: String,
    #[serde(default)]
    pub cost_date: String,
    #[serde(default)]
    pub amount: f64,
    #[serde(default)]
    pub comment: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: String,
}
```

- [ ] **Step 2: Napisz test eksportu**

W `dashboard/src-tauri/src/commands/delta_export.rs`, w `mod tests`, dopisz:

```rust
    /// Eksport delty musi nieść koszty — bez tego sync ich nie rozniesie
    /// (dokładnie ta luka wywołała regresję m24 dla `clients`).
    #[test]
    fn delta_archive_carries_project_costs() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory");
        conn.execute_batch(
            "CREATE TABLE project_costs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uid TEXT NOT NULL UNIQUE,
                project_name TEXT NOT NULL,
                cost_date TEXT NOT NULL,
                amount REAL NOT NULL,
                comment TEXT,
                created_at TEXT,
                updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
            );
            INSERT INTO project_costs (uid, project_name, cost_date, amount, comment, updated_at)
            VALUES ('u1', 'Acme', '2026-05-10', 250.5, 'licencja', '2026-05-10 10:00:00');",
        )
        .expect("schema");

        let rows = query_project_costs(&conn).expect("query");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].uid, "u1");
        assert_eq!(rows[0].project_name, "Acme");
        assert_eq!(rows[0].amount, 250.5);
        assert_eq!(rows[0].comment.as_deref(), Some("licencja"));
    }
```

- [ ] **Step 3: Uruchom test — musi nie przejść**

Run: `cargo test --workspace delta_archive_carries_project_costs`
Expected: FAIL — `cannot find function 'query_project_costs' in this scope`

- [ ] **Step 4: Wpięcie w eksport**

W `dashboard/src-tauri/src/commands/delta_export.rs`:

Rozszerz import na górze pliku o `CostRow`:

```rust
use super::types::{
    ApplicationRow, AssignmentAutoRunRow, AssignmentFeedbackRow, ClientRow, CostRow, ManualSession,
    Project, SessionRow, Tombstone,
};
```

W `struct TableHashes` dopisz pole:

```rust
    #[serde(default)]
    pub project_costs: String,
```

W `struct DeltaData` dopisz pole (po `clients`):

```rust
    #[serde(default)]
    pub project_costs: Vec<CostRow>,
```

Dodaj funkcję pomocniczą (nad `build_delta_archive`), żeby dała się przetestować bez `AppHandle`:

```rust
/// Koszty dodatkowe (m26) — zawsze pełny zbiór, tabela jest mała, a pełny snapshot
/// upraszcza konwergencję (tak samo jak dla `clients`).
pub(crate) fn query_project_costs(
    conn: &rusqlite::Connection,
) -> Result<Vec<CostRow>, CommandError> {
    let mut stmt = conn
        .prepare(
            "SELECT uid, project_name, cost_date, amount, comment, created_at, updated_at \
             FROM project_costs",
        )
        .map_err(|e| CommandError::Other(e.to_string()))?;
    stmt.query_map([], |row| {
        Ok(CostRow {
            uid: row.get(0)?,
            project_name: row.get(1)?,
            cost_date: row.get(2)?,
            amount: row.get(3)?,
            comment: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })
    .map_err(|e| CommandError::Other(e.to_string()))?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| CommandError::Other(e.to_string()))
}
```

W ciele `build_delta_archive`, bezpośrednio po bloku pobierającym `clients`, dopisz:

```rust
    let project_costs = query_project_costs(&conn)?;
```

W logu podsumowania (ok. linii 291) dopisz licznik — zmień formatkę i listę argumentów tak, by zawierały `costs={}` i `project_costs.len()`:

```rust
    log::info!(
        "Delta export (since={}): projects={}, clients={}, costs={}, apps={}, sessions={}, manual={}, tombstones={}, feedback={}, auto_runs={}",
        since, projects.len(), clients.len(), project_costs.len(), applications.len(),
        sessions.len(), manual_sessions.len(), tombstones.len(),
        assignment_feedback.len(), assignment_auto_runs.len()
    );
```

W konstruktorze `DeltaData { ... }` dopisz pole po `clients`:

```rust
            project_costs,
```

- [ ] **Step 5: Dopnij checksum tabeli**

W `dashboard/src-tauri/src/commands/helpers.rs`, w `build_table_hashes`, dopisz pole:

```rust
        project_costs: compute_table_hash(conn, "project_costs"),
```

- [ ] **Step 6: Uruchom test**

Run: `cargo test --workspace delta_archive_carries_project_costs`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add dashboard/src-tauri/src/commands/types.rs \
        dashboard/src-tauri/src/commands/delta_export.rs \
        dashboard/src-tauri/src/commands/helpers.rs
git commit -m "feat(sync): export project_costs in delta archive and table hashes"
```

---

## Task 6: Wpięcie po stronie demona

**Files:**
- Modify: `src/lan_common.rs`
- Modify: `src/sync_common.rs`
- Modify: `src/lan_server.rs`

> **Uwaga — dwa niezależne eksporty.** Task 5 dotknął eksportu dashboardu (`delta_export.rs`). Demon ma WŁASNY, całkowicie odrębny eksport: `build_delta_for_pull` w `src/lan_server.rs:1648` buduje JSON ręcznie przez `fetch_all_rows`, i ma WŁASNĄ strukturę `TableHashes` (`lan_server.rs:43`) z własnym `build_table_hashes` (`:745`) oraz ręcznym `impl PartialEq` (`:1783`). Demon jest serwerem LAN sync — bez tych zmian koszty nigdy nie wyjdą do peera, mimo poprawnego merge. To dokładnie ta klasa błędu, którą popełniono w m24.

- [ ] **Step 1: Dodaj tabelę do listy checksumu**

W `src/lan_common.rs`, w `compute_tables_hash_string` (ok. linii 205), rozszerz tablicę:

```rust
    let tables = [
        "projects", "clients", "applications", "sessions", "manual_sessions",
        "assignment_feedback", "assignment_auto_runs", "project_costs",
    ];
```

- [ ] **Step 2: Wywołaj merge kosztów**

> Funkcja obronna `ensure_m26_entity_tables` oraz jej wywołanie w `merge_incoming_data` **powstały już w Task 2 Step 5a** — bez nich merge wywalał się na braku tabeli. Tutaj dokładasz wyłącznie samo wywołanie merge kosztów.

W `src/sync_common.rs`, w `merge_incoming_data`, po `merge_clients`:

```rust
    timeflow_shared::sync::merge::merge_project_costs(&tx, &archive, &hooks)?;
```

- [ ] **Step 3: Rozszerz `TableHashes` demona**

W `src/lan_server.rs`, w `struct TableHashes` (linia 43), dopisz po `clients`:

```rust
    // m26 koszty dodatkowe. `#[serde(default)]` utrzymuje parsowalność archiwów
    // od peerów sprzed m26 (pomijają to pole).
    #[serde(default)]
    pub project_costs: String,
```

W `build_table_hashes` (linia 745) dopisz:

```rust
        project_costs: compute_table_hash(conn, "project_costs"),
```

W ręcznym `impl PartialEq for TableHashes` (linia 1783) dopisz warunek:

```rust
            && self.project_costs == other.project_costs
```

> Bez tego ostatniego kroku rozjazd kosztów NIE zostałby wykryty — dwa peery z różnymi kwotami raportowałyby „zsynchronizowane" i nigdy by się nie uzgodniły.

- [ ] **Step 4: Dodaj koszty do eksportu demona**

W `src/lan_server.rs`, w `build_delta_for_pull`, obok pozostałych wywołań obronnych (po `ensure_project_client_columns(conn)?;`):

```rust
    crate::sync_common::ensure_m26_entity_tables(conn)?;
```

Pod pobraniem `clients` (linia ~1669) dopisz:

```rust
    // Koszty dodatkowe (m26 encja — zawsze pełny zbiór, tabela mała).
    // Identyfikowane przez `uid`; `project_name` linkuje projekt po nazwie.
    let project_costs = fetch_all_rows(conn, "SELECT id, uid, project_name, cost_date, amount, comment, created_at, updated_at FROM project_costs ORDER BY uid")?;
```

W obiekcie JSON budowanym na końcu funkcji, obok `"clients": clients,`:

```rust
            "project_costs": project_costs,
```

- [ ] **Step 5: Uruchom testy**

Run: `cargo build --workspace`
Expected: sukces — `TableHashes` ma komplet pól we wszystkich trzech miejscach (struct, konstruktor, `PartialEq`)

Run: `cargo test --workspace`
Expected: PASS — wszystkie istniejące testy sync nadal przechodzą

- [ ] **Step 6: Commit**

```bash
git add src/lan_common.rs src/sync_common.rs src/lan_server.rs
git commit -m "feat(daemon): export project_costs and include it in sync table hashes"
```

---

## Task 7: Backup — pełny eksport i import

**Files:**
- Modify: `dashboard/src-tauri/src/commands/export.rs`
- Modify: `dashboard/src-tauri/src/commands/import_data.rs`

> **Uwaga:** pełny backup używa `ExportArchive` / `ExportData` — INNEGO typu niż `DeltaArchive` / `DeltaData` z Task 5. Oba serializują się do `data.project_costs`, więc `merge_project_costs` obsługuje jedno i drugie, ale pole trzeba dodać w obu strukturach.

- [ ] **Step 1: Dodaj pole do `ExportData`**

W `dashboard/src-tauri/src/commands/types.rs`, w `struct ExportData`, obok `clients` dopisz:

```rust
    // m26 koszty dodatkowe. `#[serde(default)]` utrzymuje importowalność archiwów
    // sprzed m26 (brak klucza → pusta lista, nie błąd).
    #[serde(default)]
    pub project_costs: Vec<CostRow>,
```

- [ ] **Step 2: Dodaj koszty do pełnego backupu**

W `dashboard/src-tauri/src/commands/export.rs`, obok bloku pobierającego `clients` (ok. linii 134), dopisz analogiczny blok:

```rust
        let project_costs: Vec<CostRow> = {
            let mut stmt = conn
                .prepare(
                    "SELECT uid, project_name, cost_date, amount, comment, created_at, updated_at \
                     FROM project_costs",
                )
                .map_err(|e| e.to_string())?;
            stmt.query_map([], |row| {
                Ok(CostRow {
                    uid: row.get(0)?,
                    project_name: row.get(1)?,
                    cost_date: row.get(2)?,
                    amount: row.get(3)?,
                    comment: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
        };
```

Dopisz `CostRow` do importu typów na górze pliku oraz `project_costs,` do konstruktora `ExportData` (ok. linii 449, obok `clients,`).

- [ ] **Step 3: Napisz test importu**

W `dashboard/src-tauri/src/commands/import_data.rs`, w `mod tests`, obok `online_sync_merges_clients_last_writer_wins` (ok. linii 1688), dopisz:

```rust
    /// Import backupu musi wnosić koszty — inaczej przywrócenie archiwum
    /// gubiłoby całą historię kosztów projektu.
    #[test]
    fn import_merges_project_costs() {
        use super::super::types::CostRow;

        let mut conn = full_schema_conn();
        let mut archive = base_archive();
        archive.data.project_costs.push(CostRow {
            uid: "u1".into(),
            project_name: "Acme".into(),
            cost_date: "2026-05-10".into(),
            amount: 320.0,
            comment: Some("podwykonawca".into()),
            created_at: Some("2026-05-10 10:00:00".into()),
            updated_at: "2026-05-10 10:00:00".into(),
        });

        run_sync_import(&mut conn, &archive);

        let (amount, comment): (f64, String) = conn
            .query_row(
                "SELECT amount, comment FROM project_costs WHERE uid = 'u1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("koszt musi byc zaimportowany");
        assert_eq!(amount, 320.0);
        assert_eq!(comment, "podwykonawca");
    }
```

> `full_schema_conn()` ładuje prawdziwy `schema.sql` + `run_migrations`, więc tabela `project_costs` istnieje automatycznie po Task 1 — nie trzeba dopisywać DDL do helpera. `base_archive()` i `run_sync_import()` to helpery obecne w tym module (`import_data.rs:1478` i `:1488`).

- [ ] **Step 4: Uruchom test — musi nie przejść**

Run: `cargo test --workspace import_merges_project_costs`
Expected: FAIL — koszt nie trafia do bazy (brak wywołania merge)

- [ ] **Step 5: Wywołaj merge kosztów w imporcie**

W `dashboard/src-tauri/src/commands/import_data.rs`, po linii `timeflow_shared::sync::merge::merge_clients(tx, &archive_value, &hooks)?;` (ok. linii 414):

```rust
    timeflow_shared::sync::merge::merge_project_costs(tx, &archive_value, &hooks)?;
```

- [ ] **Step 6: Uruchom test**

Run: `cargo test --workspace import_merges_project_costs`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add dashboard/src-tauri/src/commands/types.rs \
        dashboard/src-tauri/src/commands/export.rs \
        dashboard/src-tauri/src/commands/import_data.rs
git commit -m "feat(backup): include project_costs in full export and import"
```

---

## Task 8: Komendy CRUD kosztów

**Files:**
- Create: `dashboard/src-tauri/src/commands/costs.rs`
- Modify: `dashboard/src-tauri/src/commands/mod.rs`
- Modify: `dashboard/src-tauri/src/lib.rs`

- [ ] **Step 1: Napisz testy walidacji i filtra okresu**

Utwórz `dashboard/src-tauri/src/commands/costs.rs` z samymi testami i pustymi sygnaturami (implementacja w Step 3):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory");
        conn.execute_batch(
            "CREATE TABLE project_costs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uid TEXT NOT NULL UNIQUE,
                project_name TEXT NOT NULL,
                cost_date TEXT NOT NULL,
                amount REAL NOT NULL,
                comment TEXT,
                created_at TEXT,
                updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
            );",
        )
        .expect("schema");
        conn
    }

    fn insert(conn: &rusqlite::Connection, uid: &str, date: &str, amount: f64) {
        conn.execute(
            "INSERT INTO project_costs (uid, project_name, cost_date, amount, updated_at)
             VALUES (?1, 'Acme', ?2, ?3, '2026-05-10 10:00:00')",
            rusqlite::params![uid, date, amount],
        )
        .expect("insert");
    }

    /// Filtr okresu obejmuje OBIE granice — tak samo jak filtr sesji po `session_date`.
    #[test]
    fn list_filters_by_period_inclusive() {
        let conn = setup();
        insert(&conn, "before", "2026-04-30", 1.0);
        insert(&conn, "start", "2026-05-01", 2.0);
        insert(&conn, "middle", "2026-05-15", 3.0);
        insert(&conn, "end", "2026-05-31", 4.0);
        insert(&conn, "after", "2026-06-01", 5.0);

        let range = DateRange { start: "2026-05-01".into(), end: "2026-05-31".into() };
        let rows = list_costs(&conn, "Acme", &range).expect("list");

        let uids: Vec<&str> = rows.iter().map(|r| r.uid.as_str()).collect();
        assert_eq!(uids, vec!["start", "middle", "end"]);
    }

    /// Koszty innego projektu nie mogą przeciekać do listy.
    #[test]
    fn list_is_scoped_to_project() {
        let conn = setup();
        insert(&conn, "acme", "2026-05-10", 10.0);
        conn.execute(
            "INSERT INTO project_costs (uid, project_name, cost_date, amount, updated_at)
             VALUES ('other', 'Globex', '2026-05-10', 99.0, '2026-05-10 10:00:00')",
            [],
        )
        .expect("insert");

        let range = DateRange { start: "2026-05-01".into(), end: "2026-05-31".into() };
        let rows = list_costs(&conn, "Acme", &range).expect("list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].uid, "acme");
    }

    /// Suma per projekt w okresie — wejście dla estymacji i raportu.
    #[test]
    fn totals_sums_amounts_per_project() {
        let conn = setup();
        insert(&conn, "a", "2026-05-10", 100.0);
        insert(&conn, "b", "2026-05-20", 50.5);
        insert(&conn, "outside", "2026-07-01", 999.0);

        let range = DateRange { start: "2026-05-01".into(), end: "2026-05-31".into() };
        let totals = costs_totals_by_project(&conn, &range).expect("totals");

        let entry = totals.get("Acme").expect("Acme musi byc w mapie");
        assert_eq!(entry.value, 150.5);
        assert_eq!(entry.count, 2);
    }

    #[test]
    fn validate_rejects_negative_amount() {
        assert!(validate_amount(-1.0).is_err());
        assert!(validate_amount(f64::NAN).is_err());
        assert!(validate_amount(0.0).is_ok(), "koszt 0 jest legalny");
        assert!(validate_amount(12.5).is_ok());
    }

    #[test]
    fn validate_rejects_malformed_date() {
        assert!(validate_cost_date("2026-05-10").is_ok());
        assert!(validate_cost_date("10.05.2026").is_err());
        assert!(validate_cost_date("").is_err());
    }

    /// `uid` musi być losowy i unikalny — jest kluczem synchronizacji.
    #[test]
    fn new_uid_is_unique_hex() {
        let a = new_uid();
        let b = new_uid();
        assert_ne!(a, b);
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
```

- [ ] **Step 2: Uruchom testy — muszą nie przejść**

Run: `cargo test --workspace commands::costs`
Expected: FAIL — błędy kompilacji o brakujących `list_costs`, `costs_totals_by_project`, `validate_amount`, `validate_cost_date`, `new_uid`

- [ ] **Step 3: Napisz implementację**

Na początku `dashboard/src-tauri/src/commands/costs.rs`, PRZED blokiem `mod tests`, wstaw:

```rust
use std::collections::HashMap;

use tauri::AppHandle;

use crate::commands::error::CommandError;

use super::helpers::run_db_blocking;
use super::types::{CostRow, DateRange};

const MAX_COST_AMOUNT: f64 = 100_000_000.0;

/// Agregat kosztów jednego projektu w okresie — wejście dla estymacji i raportu.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct CostsTotal {
    pub value: f64,
    pub count: i64,
}

/// 16 bajtów entropii OS w hex. `uid` jest kluczem synchronizacji, więc musi być
/// nieodgadywalny i unikalny między maszynami. Świadomie NIE dodajemy crate'a
/// `uuid` — `getrandom` jest już zależnością (patrz `webui/auth.rs`).
pub(crate) fn new_uid() -> String {
    let mut buf = [0u8; 16];
    if getrandom::getrandom(&mut buf).is_err() {
        // Skrajnie mało prawdopodobne. Fallback na zegar — nadal unikalny lokalnie.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        return format!("{nanos:032x}");
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) fn validate_amount(amount: f64) -> Result<(), String> {
    if !amount.is_finite() {
        return Err("Amount must be a finite number".to_string());
    }
    if amount < 0.0 {
        return Err("Amount must be >= 0".to_string());
    }
    if amount > MAX_COST_AMOUNT {
        return Err(format!("Amount must be <= {MAX_COST_AMOUNT}"));
    }
    Ok(())
}

/// Wymuszamy `YYYY-MM-DD` — ten sam format co `sessions.date`, dzięki czemu
/// porównanie leksykograficzne w filtrze okresu jest poprawne.
pub(crate) fn validate_cost_date(date: &str) -> Result<(), String> {
    let ok = date.len() == 10
        && date.as_bytes()[4] == b'-'
        && date.as_bytes()[7] == b'-'
        && date
            .char_indices()
            .all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() });
    if !ok {
        return Err(format!("Cost date must be YYYY-MM-DD, got '{date}'"));
    }
    Ok(())
}

/// Koszty jednego projektu w okresie. Obie granice WŁĄCZNIE — identycznie jak
/// filtr sesji po `session_date`. Preset „all time" to szeroki zakres
/// (2020-01-01 .. 2100-01-01), więc nie wymaga osobnej gałęzi.
pub(crate) fn list_costs(
    conn: &rusqlite::Connection,
    project_name: &str,
    date_range: &DateRange,
) -> Result<Vec<CostRow>, String> {
    let mut stmt = conn
        .prepare_cached(
            "SELECT uid, project_name, cost_date, amount, comment, created_at, updated_at \
             FROM project_costs \
             WHERE project_name = ?1 AND cost_date >= ?2 AND cost_date <= ?3 \
             ORDER BY cost_date ASC, uid ASC",
        )
        .map_err(|e| e.to_string())?;
    stmt.query_map(
        rusqlite::params![project_name, date_range.start, date_range.end],
        |row| {
            Ok(CostRow {
                uid: row.get(0)?,
                project_name: row.get(1)?,
                cost_date: row.get(2)?,
                amount: row.get(3)?,
                comment: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}

/// Suma i licznik kosztów per NAZWA projektu w okresie. Jedno zapytanie dla
/// wszystkich projektów — estymacje budują dziesiątki wierszy naraz.
pub(crate) fn costs_totals_by_project(
    conn: &rusqlite::Connection,
    date_range: &DateRange,
) -> Result<HashMap<String, CostsTotal>, String> {
    let mut stmt = conn
        .prepare_cached(
            "SELECT project_name, COALESCE(SUM(amount), 0.0), COUNT(*) \
             FROM project_costs \
             WHERE cost_date >= ?1 AND cost_date <= ?2 \
             GROUP BY project_name",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![date_range.start, date_range.end], |row| {
            Ok((
                row.get::<_, String>(0)?,
                CostsTotal { value: row.get(1)?, count: row.get(2)? },
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out = HashMap::new();
    for row in rows {
        let (name, total) = row.map_err(|e| e.to_string())?;
        out.insert(name, total);
    }
    Ok(out)
}

fn load_cost(conn: &rusqlite::Connection, uid: &str) -> Result<CostRow, String> {
    conn.query_row(
        "SELECT uid, project_name, cost_date, amount, comment, created_at, updated_at \
         FROM project_costs WHERE uid = ?1",
        [uid],
        |row| {
            Ok(CostRow {
                uid: row.get(0)?,
                project_name: row.get(1)?,
                cost_date: row.get(2)?,
                amount: row.get(3)?,
                comment: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

fn normalize_comment(comment: Option<String>) -> Option<String> {
    comment
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
}

#[tauri::command]
pub async fn costs_list(
    app: AppHandle,
    project_name: String,
    date_range: DateRange,
) -> Result<Vec<CostRow>, CommandError> {
    run_db_blocking(app, move |conn| list_costs(conn, &project_name, &date_range))
        .await
        .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn costs_create(
    app: AppHandle,
    project_name: String,
    cost_date: String,
    amount: f64,
    comment: Option<String>,
) -> Result<CostRow, CommandError> {
    run_db_blocking(app, move |conn| {
        let project_name = project_name.trim().to_string();
        if project_name.is_empty() {
            return Err("Project name is required".to_string());
        }
        validate_cost_date(&cost_date)?;
        validate_amount(amount)?;

        let uid = new_uid();
        conn.execute(
            "INSERT INTO project_costs (uid, project_name, cost_date, amount, comment, \
             created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'), datetime('now'))",
            rusqlite::params![
                uid,
                project_name,
                cost_date,
                amount,
                normalize_comment(comment)
            ],
        )
        .map_err(|e| e.to_string())?;
        load_cost(conn, &uid)
    })
    .await
    .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn costs_update(
    app: AppHandle,
    uid: String,
    cost_date: String,
    amount: f64,
    comment: Option<String>,
) -> Result<CostRow, CommandError> {
    run_db_blocking(app, move |conn| {
        validate_cost_date(&cost_date)?;
        validate_amount(amount)?;

        // `updated_at` MUSI się odświeżyć — to on rozstrzyga LWW przy synchronizacji.
        let changed = conn
            .execute(
                "UPDATE project_costs SET cost_date = ?1, amount = ?2, comment = ?3, \
                 updated_at = datetime('now') WHERE uid = ?4",
                rusqlite::params![cost_date, amount, normalize_comment(comment), uid],
            )
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err(format!("Cost '{uid}' not found"));
        }
        load_cost(conn, &uid)
    })
    .await
    .map_err(CommandError::Other)
}

#[tauri::command]
pub async fn costs_delete(app: AppHandle, uid: String) -> Result<(), CommandError> {
    run_db_blocking(app, move |conn| {
        // DELETE, nie soft-delete — trigger `trg_project_costs_tombstone` zapisze
        // tombstone, dzięki czemu usunięcie rozejdzie się na pozostałe maszyny.
        conn.execute("DELETE FROM project_costs WHERE uid = ?1", [&uid])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(CommandError::Other)
}
```

- [ ] **Step 3a: Zregeneruj warstwę RPC webui — OBOWIĄZKOWE po dodaniu komend**

> **Trzecie miejsce rejestracji komend, którego spec nie przewidział.** Poza `mod.rs`
> i `invoke_handler` w `lib.rs` istnieje `dashboard/src-tauri/src/webui/rpc_generated.rs`
> — plik GENEROWANY, przez który webui (wersja mobilna serwowana po HTTP) dispatchuje
> komendy. Bez regeneracji komendy działają w aplikacji desktop, ale **cicho nie działają
> na telefonie**. `build.rs` sygnalizuje rozjazd tylko ostrzeżeniem (nie błędem), więc
> łatwo to przeoczyć.

```bash
cd dashboard/src-tauri && node scripts/gen_webrpc.cjs
node scripts/gen_webrpc.cjs --check   # exit 0 = zgodne
```

Zweryfikuj, że wszystkie cztery komendy wylądowały w pliku:

```bash
grep -c "costs_" dashboard/src-tauri/src/webui/rpc_generated.rs   # oczekiwane: 4
```

- [ ] **Step 4: Zarejestruj moduł i komendy**

W `dashboard/src-tauri/src/commands/mod.rs` dopisz (zachowując alfabetyczne sąsiedztwo z `mod clients;`):

```rust
mod costs;
```

oraz w sekcji re-eksportów:

```rust
pub use costs::*;
```

W `dashboard/src-tauri/src/lib.rs`, w `invoke_handler`, obok komend klientów:

```rust
            commands::costs_list,
            commands::costs_create,
            commands::costs_update,
            commands::costs_delete,
```

- [ ] **Step 5: Uruchom testy**

Run: `cargo test --workspace commands::costs`
Expected: PASS — 6 testów

- [ ] **Step 6: Commit**

```bash
git add dashboard/src-tauri/src/commands/costs.rs \
        dashboard/src-tauri/src/commands/mod.rs \
        dashboard/src-tauri/src/lib.rs
git commit -m "feat(costs): CRUD commands with period filtering and validation"
```

---

## Task 9: Sprzątanie kosztów przy usuwaniu projektu

**Files:**
- Modify: `dashboard/src-tauri/src/commands/projects.rs`

- [ ] **Step 1: Znajdź komendę usuwania projektu**

Run: `grep -n "DELETE FROM projects" dashboard/src-tauri/src/commands/projects.rs`

Zanotuj nazwę funkcji zawierającej to zapytanie — będzie potrzebna w Step 2 i 4.

- [ ] **Step 2: Napisz test kasowania sierot**

W `dashboard/src-tauri/src/commands/projects.rs`, w `mod tests`, dopisz. Helper `test_conn()` (`projects.rs:1930`) ładuje prawdziwy `schema.sql` + `run_migrations`, więc tabela `project_costs` i triggery z m26 są dostępne bez dodatkowego DDL:

```rust
    /// Brak FK (link po nazwie) ⇒ kasowanie projektu musi jawnie usunąć jego koszty,
    /// inaczej zostają sieroty, które nadal liczyłyby się w raporcie klienta.
    #[test]
    fn deleting_project_removes_its_costs() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO projects (id, name, color, updated_at)
             VALUES (1, 'Acme', '#fff', '2026-05-01 10:00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO project_costs (uid, project_name, cost_date, amount, updated_at)
             VALUES ('u1', 'Acme', '2026-05-10', 100.0, '2026-05-10 10:00:00')",
            [],
        )
        .unwrap();

        delete_project_rows(&conn, "Acme").expect("delete");

        let costs: i64 = conn
            .query_row("SELECT COUNT(*) FROM project_costs WHERE project_name = 'Acme'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(costs, 0);

        // Trigger tombstone musi odnotować usunięcie, żeby sync je rozniósł.
        let tombstones: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tombstones WHERE table_name = 'project_costs' AND sync_key = 'u1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tombstones, 1);
    }

    /// Rename projektu przenosi koszty na nową nazwę (trigger m26) i odświeża
    /// `updated_at`, żeby LWW rozniósł zmianę.
    #[test]
    fn renaming_project_cascades_to_costs() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO projects (id, name, color, updated_at)
             VALUES (1, 'Acme', '#fff', '2026-05-01 10:00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO project_costs (uid, project_name, cost_date, amount, updated_at)
             VALUES ('u1', 'Acme', '2026-05-10', 100.0, '1970-01-01 00:00:00')",
            [],
        )
        .unwrap();

        conn.execute("UPDATE projects SET name = 'Acme Corp' WHERE id = 1", []).unwrap();

        let (name, updated_at): (String, String) = conn
            .query_row(
                "SELECT project_name, updated_at FROM project_costs WHERE uid = 'u1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(name, "Acme Corp");
        assert_ne!(updated_at, "1970-01-01 00:00:00", "rename musi odswiezyc updated_at");
    }
```

- [ ] **Step 3: Uruchom testy — muszą nie przejść**

Run: `cargo test --workspace deleting_project_removes_its_costs renaming_project_cascades_to_costs`
Expected: FAIL — `deleting_project_removes_its_costs` nie znajduje `delete_project_rows`; `renaming_project_cascades_to_costs` powinien PRZEJŚĆ (trigger z m26 już działa)

- [ ] **Step 4: Wydziel i uzupełnij kasowanie**

W funkcji znalezionej w Step 1, tuż PRZED `DELETE FROM projects`, dodaj kasowanie kosztów. Żeby dało się to przetestować bez `AppHandle`, wydziel czystą funkcję:

```rust
/// Kasuje projekt wraz z encjami linkowanymi po NAZWIE (brak FK ⇒ brak kaskady SQLite).
/// DELETE, nie UPDATE — triggery tombstone muszą odnotować usunięcie, żeby sync
/// rozniósł je na pozostałe maszyny.
pub(crate) fn delete_project_rows(
    conn: &rusqlite::Connection,
    project_name: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM project_costs WHERE project_name = ?1",
        [project_name],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM projects WHERE name = ?1", [project_name])
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

Podmień istniejące `DELETE FROM projects ...` w komendzie na wywołanie `delete_project_rows(conn, &name)?;`. Jeśli komenda operuje na `id`, najpierw rozwiąż nazwę:

```rust
        let project_name: String = conn
            .query_row("SELECT name FROM projects WHERE id = ?1", [id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        delete_project_rows(conn, &project_name)?;
```

- [ ] **Step 5: Uruchom testy**

Run: `cargo test --workspace deleting_project_removes_its_costs renaming_project_cascades_to_costs`
Expected: PASS — oba testy

- [ ] **Step 6: Commit**

```bash
git add dashboard/src-tauri/src/commands/projects.rs
git commit -m "fix(costs): delete orphaned costs when a project is removed"
```

---

## Task 10: Koszty w estymacjach

**Files:**
- Modify: `dashboard/src-tauri/src/commands/types.rs`
- Modify: `dashboard/src-tauri/src/commands/estimates.rs`

- [ ] **Step 1: Rozszerz typy**

W `dashboard/src-tauri/src/commands/types.rs`, w `struct EstimateProjectRow`, na końcu dopisz:

```rust
    /// Suma kosztów dodatkowych projektu w wybranym okresie. ŚWIADOMIE osobne pole:
    /// `estimated_value` zostaje „czas × stawka", więc zaokrąglanie per_day i wykresy
    /// pozostają nietknięte, a stare archiwa dają tu 0.
    #[serde(default)]
    pub costs_value: f64,
    /// Liczba pozycji kosztowych w okresie — do badge'a w UI.
    #[serde(default)]
    pub costs_count: i64,
```

W `struct EstimateSummary` na końcu dopisz:

```rust
    #[serde(default)]
    pub total_costs: f64,
    /// `total_value + total_costs` — kwota faktycznie do rozliczenia.
    #[serde(default)]
    pub grand_total: f64,
```

- [ ] **Step 2: Napisz testy**

Najpierw rozszerz `setup_conn()` (`estimates.rs:404`) o tabelę kosztów — dopisz do jego `execute_batch`, przed zamykającym `";`:

```sql
            CREATE TABLE project_costs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uid TEXT NOT NULL UNIQUE,
                project_name TEXT NOT NULL,
                cost_date TEXT NOT NULL,
                amount REAL NOT NULL,
                comment TEXT,
                created_at TEXT,
                updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
            );
```

Następnie, w tym samym `mod tests`, dopisz helper i dwa testy:

```rust
    /// Projekt „Acme" z jedną godzinną sesją 10.05.2026 — minimalne wejście
    /// dla `build_estimate_rows`. Wzorowane na `estimate_rows_use_project_override_or_global`.
    fn seed_acme_with_one_hour(conn: &rusqlite::Connection) {
        conn.execute(
            "INSERT INTO estimate_settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))",
            rusqlite::params!["global_hourly_rate", "100"],
        )
        .expect("insert setting");
        conn.execute(
            "INSERT INTO projects (id, name, color, hourly_rate) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![1i64, "Acme", "#111111", Option::<f64>::None],
        )
        .expect("insert project");
        conn.execute(
            "INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, project_id, is_hidden)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
            rusqlite::params![
                1i64,
                "2026-05-10T10:00:00",
                "2026-05-10T11:00:00",
                3600i64,
                "2026-05-10",
                1i64
            ],
        )
        .expect("insert session");
    }

    /// Koszt z okresu wchodzi do `costs_value`, ale NIE zmienia `estimated_value`.
    #[test]
    fn estimate_row_carries_costs_without_touching_time_value() {
        let conn = setup_conn();
        seed_acme_with_one_hour(&conn);
        conn.execute(
            "INSERT INTO project_costs (uid, project_name, cost_date, amount, updated_at)
             VALUES ('u1', 'Acme', '2026-05-10', 200.0, '2026-05-10 10:00:00')",
            [],
        )
        .expect("insert cost");

        let range = DateRange { start: "2026-05-01".into(), end: "2026-05-31".into() };
        let rows = build_estimate_rows(&conn, &range).expect("rows");
        let row = rows.iter().find(|r| r.project_name == "Acme").expect("wiersz Acme");

        assert_eq!(row.costs_value, 200.0);
        assert_eq!(row.costs_count, 1);
        assert_eq!(
            row.estimated_value,
            row.weighted_hours * row.effective_hourly_rate,
            "estimated_value musi pozostac czystym iloczynem czasu i stawki"
        );
    }

    /// Koszt spoza okresu nie może wpaść do wiersza.
    #[test]
    fn estimate_row_excludes_costs_outside_period() {
        let conn = setup_conn();
        seed_acme_with_one_hour(&conn);
        conn.execute(
            "INSERT INTO project_costs (uid, project_name, cost_date, amount, updated_at)
             VALUES ('u1', 'Acme', '2026-07-15', 200.0, '2026-07-15 10:00:00')",
            [],
        )
        .expect("insert cost");

        let range = DateRange { start: "2026-05-01".into(), end: "2026-05-31".into() };
        let rows = build_estimate_rows(&conn, &range).expect("rows");
        let row = rows.iter().find(|r| r.project_name == "Acme").expect("wiersz Acme");

        assert_eq!(row.costs_value, 0.0);
        assert_eq!(row.costs_count, 0);
    }
```

- [ ] **Step 3: Uruchom testy — muszą nie przejść**

Run: `cargo test --workspace estimate_row_carries_costs`
Expected: FAIL — `no field 'costs_value'` przy konstrukcji `EstimateProjectRow` (typ ma pole, ale `build_estimate_rows` go nie ustawia)

- [ ] **Step 4: Wpięcie w `build_estimate_rows`**

W `dashboard/src-tauri/src/commands/estimates.rs`, w `build_estimate_rows`, obok pozostałych zapytań pomocniczych (po `query_project_multiplier_extra_seconds`):

```rust
    let costs_by_project = super::costs::costs_totals_by_project(conn, date_range)?;
```

W pętli budującej wiersze, przed `rows.push(...)`:

```rust
        let costs = costs_by_project
            .get(mapped_name.as_str())
            .copied()
            .unwrap_or_default();
```

W konstruktorze `EstimateProjectRow { ... }` dopisz na końcu:

```rust
            costs_value: costs.value,
            costs_count: costs.count,
```

- [ ] **Step 5: Uzupełnij podsumowanie**

W `get_estimates_summary`, po `let total_value = ...`:

```rust
        let total_costs = rows.iter().map(|r| r.costs_value).sum::<f64>();
```

W konstruktorze `EstimateSummary { ... }` dopisz:

```rust
            total_costs,
            grand_total: total_value + total_costs,
```

- [ ] **Step 6: Uruchom testy**

Run: `cargo test --workspace commands::estimates`
Expected: PASS — nowe testy oraz wszystkie istniejące

- [ ] **Step 7: Commit**

```bash
git add dashboard/src-tauri/src/commands/types.rs dashboard/src-tauri/src/commands/estimates.rs
git commit -m "feat(estimates): add costs_value and grand_total alongside time value"
```

---

## Task 11: Koszty w raporcie projektu

**Files:**
- Modify: `dashboard/src-tauri/src/commands/types.rs`
- Modify: `dashboard/src-tauri/src/commands/report.rs`

- [ ] **Step 1: Rozszerz `ProjectReportData`**

W `dashboard/src-tauri/src/commands/types.rs`, w `struct ProjectReportData`, dopisz:

```rust
    /// Pozycje kosztowe z okresu raportu, chronologicznie.
    #[serde(default)]
    pub costs: Vec<CostRow>,
    /// Suma powyższych — żeby front nie musiał sumować sam.
    #[serde(default)]
    pub costs_total: f64,
```

- [ ] **Step 2: Napisz test**

W `dashboard/src-tauri/src/commands/report.rs`, w `mod tests` (jeśli moduł nie istnieje, utwórz go), dopisz:

```rust
#[cfg(test)]
mod costs_tests {
    use super::*;
    use crate::commands::types::DateRange;

    fn setup() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory");
        conn.execute_batch(
            "CREATE TABLE projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
            );
            CREATE TABLE project_costs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uid TEXT NOT NULL UNIQUE,
                project_name TEXT NOT NULL,
                cost_date TEXT NOT NULL,
                amount REAL NOT NULL,
                comment TEXT,
                created_at TEXT,
                updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
            );
            INSERT INTO projects (id, name) VALUES (1, 'Acme');
            INSERT INTO project_costs (uid, project_name, cost_date, amount, updated_at) VALUES
                ('a', 'Acme', '2026-05-05', 100.0, '2026-05-05 10:00:00'),
                ('b', 'Acme', '2026-05-25', 50.0, '2026-05-25 10:00:00'),
                ('c', 'Acme', '2026-06-05', 999.0, '2026-06-05 10:00:00');",
        )
        .expect("schema");
        conn
    }

    /// Raport bierze tylko koszty z okresu i podaje ich sumę.
    #[test]
    fn report_costs_are_scoped_to_period() {
        let conn = setup();
        let range = DateRange { start: "2026-05-01".into(), end: "2026-05-31".into() };

        let (costs, total) = load_report_costs(&conn, 1, &range).expect("costs");

        assert_eq!(costs.len(), 2);
        assert_eq!(costs[0].uid, "a", "pozycje musza byc chronologiczne");
        assert_eq!(costs[1].uid, "b");
        assert_eq!(total, 150.0);
    }

    /// Projekt bez kosztów daje pustą listę i zero — nie błąd.
    #[test]
    fn report_costs_empty_for_project_without_costs() {
        let conn = setup();
        conn.execute("INSERT INTO projects (id, name) VALUES (2, 'Globex')", []).unwrap();
        let range = DateRange { start: "2026-05-01".into(), end: "2026-05-31".into() };

        let (costs, total) = load_report_costs(&conn, 2, &range).expect("costs");

        assert!(costs.is_empty());
        assert_eq!(total, 0.0);
    }
}
```

- [ ] **Step 3: Uruchom testy — muszą nie przejść**

Run: `cargo test --workspace costs_tests`
Expected: FAIL — `cannot find function 'load_report_costs'`

- [ ] **Step 4: Napisz `load_report_costs` i wepnij w raport**

W `dashboard/src-tauri/src/commands/report.rs` dopisz:

```rust
/// Pozycje kosztowe projektu w okresie raportu + ich suma.
/// Projekt rozwiązywany po `id` → NAZWA, bo koszty linkują się nazwą.
pub(crate) fn load_report_costs(
    conn: &rusqlite::Connection,
    project_id: i64,
    date_range: &DateRange,
) -> Result<(Vec<CostRow>, f64), String> {
    let project_name: String = conn
        .query_row("SELECT name FROM projects WHERE id = ?1", [project_id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    let costs = super::costs::list_costs(conn, &project_name, date_range)?;
    let total = costs.iter().map(|c| c.amount).sum();
    Ok((costs, total))
}
```

Dopisz `CostRow` do importu typów na górze pliku.

W `get_project_report_data` dodaj równoległe zadanie obok pozostałych `spawn`-ów:

```rust
    let costs_handle = tauri::async_runtime::spawn({
        let app = app.clone();
        let date_range = date_range.clone();
        async move {
            super::helpers::run_db_blocking(app, move |conn| {
                load_report_costs(conn, project_id, &date_range)
            })
            .await
        }
    });
```

W miejscu, gdzie funkcja składa `ProjectReportData`, dołącz wynik (obsłuż `JoinError` tak samo jak pozostałe handle'e w tej funkcji — podejrzyj, jak robi to `extra_handle`):

```rust
    let (costs, costs_total) = costs_handle.await??;
```

i dopisz do konstruktora:

```rust
        costs,
        costs_total,
```

- [ ] **Step 5: Uruchom testy**

Run: `cargo test --workspace costs_tests`
Expected: PASS — 2 testy

Run: `cargo test --workspace`
Expected: PASS — cały workspace

- [ ] **Step 6: Commit**

```bash
git add dashboard/src-tauri/src/commands/types.rs dashboard/src-tauri/src/commands/report.rs
git commit -m "feat(report): include period-scoped cost items in project report"
```

---

## Task 12: Typy i API po stronie frontu

**Files:**
- Create: `dashboard/src/lib/tauri/costs.ts`
- Create: `dashboard/src/lib/costs-utils.ts`
- Create: `dashboard/src/lib/costs-utils.test.ts`
- Modify: `dashboard/src/lib/tauri.ts`
- Modify: `dashboard/src/lib/db-types.ts`

- [ ] **Step 1: Napisz testy funkcji pomocniczych**

Utwórz `dashboard/src/lib/costs-utils.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { parseAmountInput, sumCosts } from '@/lib/costs-utils';
import type { ProjectCost } from '@/lib/tauri/costs';

function cost(uid: string, amount: number): ProjectCost {
  return {
    uid,
    project_name: 'Acme',
    cost_date: '2026-05-10',
    amount,
    comment: null,
    created_at: null,
    updated_at: '2026-05-10 10:00:00',
  };
}

describe('parseAmountInput', () => {
  it('accepts a comma as the decimal separator', () => {
    expect(parseAmountInput('12,50')).toBe(12.5);
  });

  it('accepts a dot as the decimal separator', () => {
    expect(parseAmountInput('12.50')).toBe(12.5);
  });

  it('accepts zero', () => {
    expect(parseAmountInput('0')).toBe(0);
  });

  it('rejects negative amounts', () => {
    expect(parseAmountInput('-5')).toBeNull();
  });

  it('rejects non-numeric input', () => {
    expect(parseAmountInput('abc')).toBeNull();
    expect(parseAmountInput('')).toBeNull();
  });
});

describe('sumCosts', () => {
  it('returns 0 for an empty list', () => {
    expect(sumCosts([])).toBe(0);
  });

  it('sums amounts', () => {
    expect(sumCosts([cost('a', 100), cost('b', 50.5)])).toBe(150.5);
  });
});
```

- [ ] **Step 2: Uruchom testy — muszą nie przejść**

Run (w `dashboard/`): `npm test -- costs-utils`
Expected: FAIL — `Cannot find module '@/lib/costs-utils'`

- [ ] **Step 3: Napisz bindingi API**

Utwórz `dashboard/src/lib/tauri/costs.ts`:

```typescript
// @public-api — Tauri command bindings; knip cannot detect dynamic invoke() usage
import { invoke, invokeMutation } from './core';
import type { DateRange } from '@/lib/db-types';

/**
 * Koszt dodatkowy projektu. `uid` jest kluczem synchronizacji (nie `id` — ten jest
 * lokalny per maszyna), a projekt linkuje się NAZWĄ z tego samego powodu.
 */
export interface ProjectCost {
  uid: string;
  project_name: string;
  /** YYYY-MM-DD */
  cost_date: string;
  amount: number;
  comment: string | null;
  created_at: string | null;
  updated_at: string;
}

export const costsList = (projectName: string, dateRange: DateRange) =>
  invoke<ProjectCost[]>('costs_list', { projectName, dateRange });

export const costsCreate = (
  projectName: string,
  costDate: string,
  amount: number,
  comment: string | null,
) =>
  invokeMutation<ProjectCost>('costs_create', {
    projectName,
    costDate,
    amount,
    comment,
  });

export const costsUpdate = (
  uid: string,
  costDate: string,
  amount: number,
  comment: string | null,
) => invokeMutation<ProjectCost>('costs_update', { uid, costDate, amount, comment });

export const costsDelete = (uid: string) =>
  invokeMutation<void>('costs_delete', { uid });
```

Utwórz `dashboard/src/lib/costs-utils.ts`:

```typescript
import type { ProjectCost } from '@/lib/tauri/costs';

/**
 * Parsuje kwotę z pola tekstowego. Akceptuje przecinek jako separator dziesiętny
 * (polska klawiatura numeryczna). Zwraca `null` dla wartości nienumerycznych
 * i ujemnych — koszt 0 jest legalny (np. pozycja informacyjna).
 */
export function parseAmountInput(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

export function sumCosts(costs: ProjectCost[]): number {
  return costs.reduce((acc, c) => acc + c.amount, 0);
}
```

- [ ] **Step 4: Podłącz moduł i rozszerz typy raportu/estymacji**

W `dashboard/src/lib/tauri.ts` dopisz (obok `export * from './tauri/clients';`):

```typescript
export * from './tauri/costs';
```

W `dashboard/src/lib/db-types.ts`, w `interface EstimateProjectRow`, dopisz:

```typescript
  /** Suma kosztów dodatkowych projektu w okresie (osobno od `estimated_value`). */
  costs_value: number;
  /** Liczba pozycji kosztowych w okresie. */
  costs_count: number;
```

W `interface EstimateSummary` dopisz:

```typescript
  total_costs: number;
  /** `total_value + total_costs` — kwota do rozliczenia. */
  grand_total: number;
```

W `interface ProjectReportData` dopisz (dodaj import typu `ProjectCost` z `@/lib/tauri/costs`):

```typescript
  costs: ProjectCost[];
  costs_total: number;
```

- [ ] **Step 5: Uruchom testy i typecheck**

Run (w `dashboard/`): `npm test -- costs-utils`
Expected: PASS — 7 testów

Run (w `dashboard/`): `npm run typecheck`
Expected: sukces

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/lib/tauri/costs.ts dashboard/src/lib/costs-utils.ts \
        dashboard/src/lib/costs-utils.test.ts dashboard/src/lib/tauri.ts \
        dashboard/src/lib/db-types.ts
git commit -m "feat(costs): frontend types, API bindings and amount parsing"
```

---

## Task 13: Klucze i18n

**Files:**
- Modify: `dashboard/src/locales/pl/common.json`
- Modify: `dashboard/src/locales/en/common.json`

> Ten task idzie PRZED komponentami, bo lint (`npm run lint:i18n-hardcoded`) odrzuca teksty wpisane na sztywno w JSX. Mając klucze wcześniej, komponenty piszesz od razu poprawnie.

- [ ] **Step 1: Dodaj klucze polskie**

W `dashboard/src/locales/pl/common.json` dopisz sekcję (umieść ją zgodnie z porządkiem obowiązującym w pliku — obok pozostałych sekcji `project_page` / `estimates`):

```json
"costs": {
  "section_title": "Koszty dodatkowe",
  "add": "Dodaj koszt",
  "edit": "Edytuj koszt",
  "delete": "Usuń koszt",
  "empty": "Brak kosztów w wybranym okresie",
  "loading": "Wczytywanie kosztów…",
  "error": "Nie udało się wczytać kosztów",
  "column_date": "Data",
  "column_amount": "Kwota",
  "column_comment": "Komentarz",
  "column_actions": "Akcje",
  "field_date": "Data kosztu",
  "field_amount": "Kwota",
  "field_comment": "Komentarz",
  "invalid_amount": "Podaj kwotę większą lub równą 0",
  "invalid_date": "Podaj datę w formacie RRRR-MM-DD",
  "delete_confirm": "Usunąć ten koszt? Operacja jest nieodwracalna.",
  "total": "Koszty razem",
  "estimates_column": "Koszty",
  "summary_time": "Czas",
  "summary_costs": "Koszty",
  "summary_grand_total": "Razem",
  "report_section_title": "Koszty dodatkowe w okresie"
}
```

- [ ] **Step 2: Dodaj klucze angielskie**

W `dashboard/src/locales/en/common.json` dopisz lustrzaną sekcję w tym samym miejscu struktury:

```json
"costs": {
  "section_title": "Additional costs",
  "add": "Add cost",
  "edit": "Edit cost",
  "delete": "Delete cost",
  "empty": "No costs in the selected period",
  "loading": "Loading costs…",
  "error": "Failed to load costs",
  "column_date": "Date",
  "column_amount": "Amount",
  "column_comment": "Comment",
  "column_actions": "Actions",
  "field_date": "Cost date",
  "field_amount": "Amount",
  "field_comment": "Comment",
  "invalid_amount": "Enter an amount greater than or equal to 0",
  "invalid_date": "Enter a date in YYYY-MM-DD format",
  "delete_confirm": "Delete this cost? This cannot be undone.",
  "total": "Costs total",
  "estimates_column": "Costs",
  "summary_time": "Time",
  "summary_costs": "Costs",
  "summary_grand_total": "Total",
  "report_section_title": "Additional costs in period"
}
```

- [ ] **Step 3: Zweryfikuj spójność locale**

Run (w `dashboard/`): `npm run lint:locales`
Expected: sukces — brak brakujących kluczy w żadnym języku

Run (z roota repo): `python3 compare_locales.py`
Expected: brak zgłoszonych różnic

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/locales/pl/common.json dashboard/src/locales/en/common.json
git commit -m "i18n: add translation keys for additional costs"
```

---

## Task 14: Sekcja kosztów na karcie projektu

**Files:**
- Create: `dashboard/src/components/project-page/cost-dialog-state.ts`
- Create: `dashboard/src/components/project-page/CostDialog.tsx`
- Create: `dashboard/src/components/project-page/ProjectCostsSection.tsx`
- Modify: `dashboard/src/hooks/useProjectPageController.ts`
- Modify: `dashboard/src/pages/ProjectPageView.tsx`

- [ ] **Step 1: Stan dialogu**

Utwórz `dashboard/src/components/project-page/cost-dialog-state.ts`:

```typescript
import { useCallback, useState } from 'react';

import { parseAmountInput } from '@/lib/costs-utils';
import type { ProjectCost } from '@/lib/tauri/costs';

export interface CostDialogValues {
  costDate: string;
  amount: string;
  comment: string;
}

const EMPTY: CostDialogValues = { costDate: '', amount: '', comment: '' };

export function useCostDialogState() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectCost | null>(null);
  const [values, setValues] = useState<CostDialogValues>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const openForCreate = useCallback((defaultDate: string) => {
    setEditing(null);
    setValues({ ...EMPTY, costDate: defaultDate });
    setError(null);
    setOpen(true);
  }, []);

  const openForEdit = useCallback((cost: ProjectCost) => {
    setEditing(cost);
    setValues({
      costDate: cost.cost_date,
      amount: String(cost.amount),
      comment: cost.comment ?? '',
    });
    setError(null);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setEditing(null);
    setError(null);
  }, []);

  /** Zwraca sparsowaną kwotę albo null — walidacja tekstu należy do dialogu. */
  const parsedAmount = parseAmountInput(values.amount);

  return {
    open,
    editing,
    values,
    setValues,
    error,
    setError,
    parsedAmount,
    openForCreate,
    openForEdit,
    close,
  };
}
```

- [ ] **Step 2: Dialog**

Utwórz `dashboard/src/components/project-page/CostDialog.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CostDialogValues } from '@/components/project-page/cost-dialog-state';
import type { ProjectCost } from '@/lib/tauri/costs';

interface CostDialogProps {
  open: boolean;
  editing: ProjectCost | null;
  values: CostDialogValues;
  error: string | null;
  parsedAmount: number | null;
  saving: boolean;
  onChange: (values: CostDialogValues) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function CostDialog({
  open,
  editing,
  values,
  error,
  parsedAmount,
  saving,
  onChange,
  onSubmit,
  onClose,
}: CostDialogProps) {
  const { t } = useTranslation();
  const canSubmit = parsedAmount !== null && values.costDate.length === 10 && !saving;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editing ? t('costs.edit') : t('costs.add')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">{t('costs.field_date')}</span>
            <input
              type="date"
              value={values.costDate}
              onChange={(e) => onChange({ ...values, costDate: e.target.value })}
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">{t('costs.field_amount')}</span>
            <input
              type="text"
              inputMode="decimal"
              value={values.amount}
              onChange={(e) => onChange({ ...values, amount: e.target.value })}
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">{t('costs.field_comment')}</span>
            <textarea
              rows={3}
              value={values.comment}
              onChange={(e) => onChange({ ...values, comment: e.target.value })}
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
          </label>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('ui.buttons.cancel')}
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit}>
            {t('ui.buttons.ok')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

> Sprawdź nazwy eksportów w `@/components/ui/dialog` — jeśli repo używa innych (np. `DialogFooter`), dostosuj import. Podejrzyj `ManualSessionDialog.tsx`, który korzysta z tego samego zestawu.

- [ ] **Step 3: Sekcja listy**

Utwórz `dashboard/src/components/project-page/ProjectCostsSection.tsx`:

```tsx
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { sumCosts } from '@/lib/costs-utils';
import type { ProjectCost } from '@/lib/tauri/costs';
import { formatMoney } from '@/lib/utils';

interface ProjectCostsSectionProps {
  costs: ProjectCost[];
  currencyCode: string;
  loading: boolean;
  error: string | null;
  onAdd: () => void;
  onEdit: (cost: ProjectCost) => void;
  onDelete: (cost: ProjectCost) => void;
}

export function ProjectCostsSection({
  costs,
  currencyCode,
  loading,
  error,
  onAdd,
  onEdit,
  onDelete,
}: ProjectCostsSectionProps) {
  const { t } = useTranslation();
  const total = sumCosts(costs);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {t('costs.section_title')}
        </CardTitle>
        <Button size="sm" onClick={onAdd}>
          <Plus className="mr-1 h-4 w-4" />
          {t('costs.add')}
        </Button>
      </CardHeader>

      <CardContent>
        {loading ? (
          <p className="py-4 text-sm text-muted-foreground">{t('costs.loading')}</p>
        ) : error ? (
          <p className="py-4 text-sm text-destructive">{error}</p>
        ) : costs.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{t('costs.empty')}</p>
        ) : (
          <>
            {/* Desktop: tabela. Mobile: lista kart — ten sam kod serwuje webui na telefonie. */}
            <table className="hidden w-full text-sm md:table">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-2 font-medium">{t('costs.column_date')}</th>
                  <th className="py-2 text-right font-medium">{t('costs.column_amount')}</th>
                  <th className="py-2 font-medium">{t('costs.column_comment')}</th>
                  <th className="py-2 text-right font-medium">{t('costs.column_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {costs.map((cost) => (
                  <tr key={cost.uid} className="border-t">
                    <td className="py-2">{cost.cost_date}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatMoney(cost.amount, currencyCode)}
                    </td>
                    <td className="py-2 text-muted-foreground">{cost.comment ?? '—'}</td>
                    <td className="py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => onEdit(cost)}
                        aria-label={t('costs.edit')}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onDelete(cost)}
                        aria-label={t('costs.delete')}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="space-y-2 md:hidden">
              {costs.map((cost) => (
                <li key={cost.uid} className="rounded border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">{cost.cost_date}</span>
                    <span className="tabular-nums">
                      {formatMoney(cost.amount, currencyCode)}
                    </span>
                  </div>
                  {cost.comment ? (
                    <p className="mt-1 text-sm text-muted-foreground">{cost.comment}</p>
                  ) : null}
                  <div className="mt-2 flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => onEdit(cost)}
                      aria-label={t('costs.edit')}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onDelete(cost)}
                      aria-label={t('costs.delete')}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex justify-between border-t pt-3 text-sm font-medium">
              <span>{t('costs.total')}</span>
              <span className="tabular-nums">{formatMoney(total, currencyCode)}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

> Zweryfikuj sygnaturę `formatMoney` w `dashboard/src/lib/utils.ts` (`grep -n "export function formatMoney" -A 5 dashboard/src/lib/utils.ts`) i dostosuj kolejność argumentów, jeśli różni się od `(amount, currencyCode)`.

- [ ] **Step 4: Podłącz kontroler**

W `dashboard/src/hooks/useProjectPageController.ts` dodaj stan i akcje kosztów. Wzoruj się na tym, jak kontroler ładuje `manualSessions`:

```typescript
  const [costs, setCosts] = useState<ProjectCost[]>([]);
  const [costsLoading, setCostsLoading] = useState(false);
  const [costsError, setCostsError] = useState<string | null>(null);

  const reloadCosts = useCallback(async () => {
    if (!project?.name) return;
    setCostsLoading(true);
    setCostsError(null);
    try {
      setCosts(await costsList(project.name, dateRange));
    } catch (e) {
      setCostsError(e instanceof Error ? e.message : String(e));
    } finally {
      setCostsLoading(false);
    }
  }, [project?.name, dateRange]);

  useEffect(() => {
    void reloadCosts();
  }, [reloadCosts]);
```

Dodaj importy `costsList`, `costsCreate`, `costsUpdate`, `costsDelete` oraz typ `ProjectCost` z `@/lib/tauri`. Zwróć `costs`, `costsLoading`, `costsError`, `reloadCosts` oraz handlery zapisu i usuwania w obiekcie kontrolera. Handler zapisu wywołuje `costsCreate` lub `costsUpdate` zależnie od `editing`, a po sukcesie `reloadCosts()` i zamknięcie dialogu.

> `dateRange` — użyj tego samego zakresu, którym kontroler już filtruje sesje projektu. Jeśli karta projektu nie ma jeszcze pickera okresu, przekaż `ALL_TIME_DATE_RANGE` z `@/lib/date-helpers`.

- [ ] **Step 5: Osadź sekcję w widoku**

W `dashboard/src/pages/ProjectPageView.tsx` rozpakuj nowe pola z `controller` i wstaw komponenty pod `ProjectEstimatesSection`:

```tsx
      <ProjectCostsSection
        costs={costs}
        currencyCode={currencyCode}
        loading={costsLoading}
        error={costsError}
        onAdd={handleAddCost}
        onEdit={handleEditCost}
        onDelete={handleDeleteCost}
      />

      <CostDialog
        open={costDialog.open}
        editing={costDialog.editing}
        values={costDialog.values}
        error={costDialog.error}
        parsedAmount={costDialog.parsedAmount}
        saving={costSaving}
        onChange={costDialog.setValues}
        onSubmit={handleSubmitCost}
        onClose={costDialog.close}
      />
```

- [ ] **Step 6: Weryfikacja**

Run (w `dashboard/`): `npm run typecheck`
Expected: sukces

Run (w `dashboard/`): `npm run lint`
Expected: sukces — w szczególności `lint:i18n-hardcoded` nie zgłasza tekstów na sztywno

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/components/project-page/ProjectCostsSection.tsx \
        dashboard/src/components/project-page/CostDialog.tsx \
        dashboard/src/components/project-page/cost-dialog-state.ts \
        dashboard/src/hooks/useProjectPageController.ts \
        dashboard/src/pages/ProjectPageView.tsx
git commit -m "feat(costs): add costs section and dialog to the project page"
```

---

## Task 15: Koszty w panelu Estymacje

**Files:**
- Modify: `dashboard/src/pages/EstimatesView.tsx`

- [ ] **Step 1: Dodaj kolumnę i podsumowanie**

W `dashboard/src/pages/EstimatesView.tsx`:

W nagłówku tabeli projektów dopisz kolumnę obok wartości:

```tsx
              <th className="py-2 text-right font-medium">
                {t('costs.estimates_column')}
              </th>
```

W wierszu projektu, w tym samym miejscu kolejności kolumn:

```tsx
              <td className="py-2 text-right tabular-nums">
                {row.costs_value > 0
                  ? currency.format(row.costs_value)
                  : t('ui.common.not_available')}
              </td>
```

Wiersz podsumowania (ok. linii 103, gdzie renderowane jest `filteredSummary.total_value`) zamień na trzyczłonowy rozkład — rozbicie jest istotą tej funkcji, użytkownik musi widzieć, ile pochodzi z czasu, a ile z kosztów:

```tsx
              <div className="flex flex-col items-end gap-1">
                <span className="text-sm text-muted-foreground">
                  {t('costs.summary_time')}: {currency.format(filteredSummary.total_value)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t('costs.summary_costs')}: {currency.format(filteredSummary.total_costs)}
                </span>
                <span className="text-lg font-semibold tabular-nums">
                  {t('costs.summary_grand_total')}:{' '}
                  {currency.format(filteredSummary.grand_total)}
                </span>
              </div>
```

> `filteredSummary` może być liczone lokalnie z przefiltrowanych wierszy, a nie brane wprost z `get_estimates_summary`. Sprawdź, jak powstaje (`grep -n "filteredSummary" dashboard/src/pages/EstimatesView.tsx`). Jeśli jest liczone lokalnie, dolicz tam również `total_costs` (suma `row.costs_value`) i `grand_total`.

- [ ] **Step 2: Weryfikacja**

Run (w `dashboard/`): `npm run typecheck`
Expected: sukces

Run (w `dashboard/`): `npm test`
Expected: PASS — cały pakiet testów frontu

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/EstimatesView.tsx
git commit -m "feat(estimates): show costs column and time/costs/total breakdown"
```

---

## Task 16: Koszty w raporcie (widok)

**Files:**
- Modify: pliki w `dashboard/src/pages/report-view/`

- [ ] **Step 1: Znajdź sekcję rozliczenia w raporcie**

Run: `grep -rn "estimate\|total" dashboard/src/pages/report-view/ | head -20`

Zlokalizuj komponent renderujący podsumowanie finansowe raportu projektu.

- [ ] **Step 2: Dodaj blok pozycji kosztowych**

W znalezionym komponencie, pod podsumowaniem czasu i wyceny, dopisz:

```tsx
      {data.costs.length > 0 ? (
        <section className="mt-6">
          <h3 className="mb-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {t('costs.report_section_title')}
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-medium">{t('costs.column_date')}</th>
                <th className="py-1 font-medium">{t('costs.column_comment')}</th>
                <th className="py-1 text-right font-medium">{t('costs.column_amount')}</th>
              </tr>
            </thead>
            <tbody>
              {data.costs.map((cost) => (
                <tr key={cost.uid} className="border-t">
                  <td className="py-1">{cost.cost_date}</td>
                  <td className="py-1 text-muted-foreground">{cost.comment ?? '—'}</td>
                  <td className="py-1 text-right tabular-nums">
                    {formatMoney(cost.amount, currencyCode)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex justify-between border-t pt-2 font-medium">
            <span>{t('costs.total')}</span>
            <span className="tabular-nums">
              {formatMoney(data.costs_total, currencyCode)}
            </span>
          </div>
        </section>
      ) : null}
```

Dopasuj nazwy propsów (`data`, `currencyCode`) do tych, których używa otaczający komponent. Raport jest też drukowany (`lib/print.ts`) — upewnij się, że blok nie jest ukrywany przez klasy `print:hidden` używane w sąsiedztwie.

- [ ] **Step 3: Weryfikacja**

Run (w `dashboard/`): `npm run typecheck`
Expected: sukces

Run (w `dashboard/`): `npm run lint`
Expected: sukces

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/report-view/
git commit -m "feat(report): render cost items and total in the project report"
```

---

## Task 17: Panel pomocy

**Files:**
- Modify: `dashboard/src/components/help/sections/HelpProjectsSection.tsx`
- Modify: `dashboard/src/components/help/sections/HelpReportsSection.tsx`

> CLAUDE.md §3 wymaga aktualizacji Help.tsx w tym samym commicie co funkcja. Ten task domyka wymóg dla fazy 1.

- [ ] **Step 1: Dodaj klucze pomocy do obu locale**

W `dashboard/src/locales/pl/common.json`, do sekcji `costs` z Task 13, dopisz:

```json
"help_title": "Koszty dodatkowe",
"help_what": "Kwoty niezwiązane z czasem pracy — licencje, podwykonawca, materiały — dopisywane do projektu z konkretną datą i komentarzem.",
"help_when": "Gdy do rozliczenia z klientem trzeba doliczyć wydatek, którego nie da się wyrazić godzinami.",
"help_limits": "Koszt zawsze należy do jednego projektu; klient wynika z przypisania projektu. Kwota jest zawsze doliczana do wartości rozliczenia — nie ma trybu „koszt własny\". Usunięcie projektu kasuje jego koszty bezpowrotnie.",
"help_reports": "Panel Estymacje i raport projektu pokazują koszty jako osobną pozycję obok wartości czasu. Wybrany okres filtruje koszty po ich dacie — tak samo jak sesje. Podsumowanie rozbija kwotę na Czas, Koszty i Razem."
```

W `dashboard/src/locales/en/common.json`, w tym samym miejscu:

```json
"help_title": "Additional costs",
"help_what": "Amounts unrelated to tracked time — licences, subcontractors, materials — added to a project with a specific date and comment.",
"help_when": "When a client invoice needs an expense that cannot be expressed in hours.",
"help_limits": "A cost always belongs to exactly one project; the client follows from the project assignment. The amount is always added to the billed value — there is no \"own cost\" mode. Deleting a project deletes its costs permanently.",
"help_reports": "The Estimates panel and the project report show costs as a separate line next to the time value. The selected period filters costs by their date, exactly like sessions. The summary breaks the amount into Time, Costs and Total."
```

- [ ] **Step 2: Opis w sekcji projektów**

W `dashboard/src/components/help/sections/HelpProjectsSection.tsx` dodaj blok w miejscu zgodnym z kolejnością pozostałych bloków tej sekcji:

```tsx
      <HelpDetailsBlock title={t('costs.help_title')}>
        <p>{t('costs.help_what')}</p>
        <p>{t('costs.help_when')}</p>
        <p>{t('costs.help_limits')}</p>
      </HelpDetailsBlock>
```

> Sprawdź sygnaturę `HelpDetailsBlock` (`dashboard/src/components/help/HelpDetailsBlock.tsx`) — przyjmuje `title` i `children`. Dopasuj sposób przekazania treści do tego, jak robią to sąsiednie bloki w pliku.

- [ ] **Step 3: Opis w sekcji raportów**

W `dashboard/src/components/help/sections/HelpReportsSection.tsx` dodaj analogicznie:

```tsx
      <HelpDetailsBlock title={t('costs.help_title')}>
        <p>{t('costs.help_reports')}</p>
      </HelpDetailsBlock>
```

- [ ] **Step 4: Weryfikacja**

Run (w `dashboard/`): `npm run lint`
Expected: sukces — `lint:locales` potwierdza komplet nowych kluczy w pl i en

Run (w `dashboard/`): `npm run typecheck`
Expected: sukces

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/help/sections/ dashboard/src/locales/
git commit -m "docs(help): describe additional costs in projects and reports sections"
```

---

## Task 18: PARITY.md i weryfikacja końcowa

**Files:**
- Modify: `PARITY.md`

- [ ] **Step 1: Udokumentuj zachowanie przy mieszanych wersjach**

W `PARITY.md`, w sekcji „Parity wersji (LAN sync)", dopisz:

```markdown
- **Koszty dodatkowe (m26, `project_costs`):** encja synchronizuje się jako osobna
  tabela (LWW po `updated_at`, klucz sync = `uid`) z tombstonami (trigger
  `trg_project_costs_tombstone` w schema.sql + migracja **m26** + lustro
  `src/tombstone_triggers.rs`). Peer ze starszą wersją TIMEFLOW nie zna tabeli:
  jego archiwum jej nie zawiera, a nasze klucze ignoruje — koszty NIE propagują się
  do czasu aktualizacji obu maszyn. Nie ma ryzyka utraty danych (nieznane klucze
  są pomijane, nie nadpisują lokalnych rekordów). Checksum `project_costs` jest
  content-hashem po pełnym zestawie kolumn, więc rozjazd kwoty/daty/komentarza jest
  wykrywalny i sam się leczy.
- **Rename projektu a koszty:** kaskadę realizuje trigger
  `trg_projects_rename_cascade_costs` (m26), wzorem `trg_projects_rename_cascade_merged`
  z m23. Trigger odświeża `updated_at`, więc zmiana nazwy rozchodzi się przez LWW.
  Kasowanie projektu czyści koszty w kodzie komendy (`delete_project_rows`), bo link
  idzie po nazwie i SQLite nie ma tu kaskady FK.
- **Tabela `todos` (m26):** utworzona razem z `project_costs`, ale w tej wersji
  pusta i NIEwpięta w sync — wpięcie należy do fazy 2 (TODO).
- **Profil wzrostu `project_costs` a pełny snapshot:** koszty jadą w eksporcie jako
  PEŁNY zbiór (bez filtra `since`), wzorem `clients`. Różnica: `clients` jest z natury
  skończoną tabelą referencyjną, a `project_costs` rośnie liniowo z czasem — każdy
  wydatek to nowy wiersz, przez lata. Przy dzisiejszej skali (dziesiątki/setki wpisów)
  to nieistotne, ale gdyby tabela urosła do tysięcy rekordów, każda delta zaczęłaby
  przenosić cały zbiór. Wtedy przejść na filtr `since`, jak `sessions`/`manual_sessions`.
```

- [ ] **Step 2: Pełna weryfikacja**

Run (z roota repo): `cargo test --workspace`
Expected: PASS — wszystkie testy

Run (w `dashboard/`): `npm run typecheck`
Expected: sukces

Run (w `dashboard/`): `npm test`
Expected: PASS

Run (w `dashboard/`): `npm run lint`
Expected: sukces

Run (z roota repo): `npx -y react-doctor@latest . --verbose`
Expected: 100/100. Jeśli wyjdzie ~49/100 z błędami „security" na plikach `.py` — config się nie załadował, sprawdź obecność `doctor.config.json` w roocie (CLAUDE.md §5).

- [ ] **Step 3: Scenariusze testu manualnego**

Przejdź je na uruchomionej aplikacji przed zamknięciem zadania:

1. Karta projektu → „Dodaj koszt" → data 10.05.2026, kwota `250,50`, komentarz „licencja". Pozycja pojawia się na liście, suma sekcji pokazuje 250,50.
2. Estymacje z okresem „Ten miesiąc" ustawionym na maj 2026 → projekt ma kolumnę „Koszty" = 250,50, podsumowanie rozbite na Czas / Koszty / Razem.
3. Przełącz okres na „Poprzedni miesiąc" → koszt znika z kolumny i z podsumowania.
4. Raport projektu za maj 2026 → blok „Koszty dodatkowe w okresie" z jedną pozycją i sumą; wydruk zawiera ten blok.
5. Zmień nazwę projektu → koszt nadal widoczny na karcie pod nową nazwą.
6. Usuń projekt → koszt znika; w tabeli `tombstones` pojawia się wiersz `table_name='project_costs'`.
7. Uruchom sync LAN z drugą maszyną na tej samej wersji → koszt pojawia się po drugiej stronie z tą samą kwotą, datą i komentarzem; usunięcie po jednej stronie znika po obu.

- [ ] **Step 4: Commit**

```bash
git add PARITY.md
git commit -m "docs(parity): document project_costs sync behaviour across versions"
```

---

## Pokrycie specu

| Sekcja specu | Task |
|---|---|
| §3 Model danych m26 | Task 1 |
| §4.1 Migracja + lustro schema.sql | Task 1 |
| §4.2 Triggery tombstone | Task 2 |
| §4.3 Merge LWW + tombstone | Task 3 |
| §4.4 Eksport delty (dashboard) | Task 5 |
| §4.4 Eksport delty (demon, `build_delta_for_pull`) | Task 6 |
| §4.5 Lista tabel demona | Task 6 |
| §4.6 Obronne `ensure_*` | Task 6 |
| §4.7 Checksum content-hash | Task 4 |
| §4.8 Backup (export + import) | Task 7 |
| §5 Komendy CRUD | Task 8 |
| §5 Wpięcie w rozliczenia | Task 10 |
| §5 Sprzątanie sierot + kaskada rename | Task 1 (triggery), Task 9 (kasowanie) |
| §6 UI karta projektu | Task 14 |
| §6 UI Estymacje | Task 15 |
| §6 UI raport | Task 16 |
| §9 Testy Rust | Tasks 2–11 |
| §9 Testy TypeScript | Task 12 |
| §10 Help + i18n + PARITY | Tasks 13, 17, 18 |

**Poza zakresem fazy 1** (spec §11): TODO (faza 2) i Google Calendar (faza 3). Tabela `todos` i jej triggery powstają w Task 1, ale nie mają w tej fazie ani kodu, ani wpięcia w sync.

## Odstępstwo od specu

Spec §5 mówi, że preset „all time" pomija warunek okresu. W kodzie `ALL_TIME_DATE_RANGE` to zwykły szeroki zakres `2020-01-01 .. 2100-01-01` ([date-helpers.ts:7-13](dashboard/src/lib/date-helpers.ts#L7-L13)), więc `BETWEEN` obsługuje go bez osobnej gałęzi — plan nie dodaje specjalnego przypadku. Skutek uboczny: koszt datowany przed 2020 rokiem nie pojawi się w „all time". Jest to identyczne z zachowaniem sesji, więc świadomie zostawiamy tak, jak jest.
