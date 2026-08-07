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
