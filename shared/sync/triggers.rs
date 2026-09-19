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

pub const CFAB_RENDER_COST_TOMBSTONE_TRIGGER_SQL: &str =
    "CREATE TRIGGER IF NOT EXISTS trg_cfab_render_cost_tombstone
     AFTER DELETE ON cfab_render_cost
     FOR EACH ROW
     BEGIN
         INSERT INTO tombstones (table_name, record_id, sync_key)
         VALUES ('cfab_render_cost', OLD.id, OLD.hub_instance_id || '|' || OLD.ledger_id);
     END;";

pub const DROP_ALL_TOMBSTONE_TRIGGERS_SQL: [&str; 8] = [
    "DROP TRIGGER IF EXISTS trg_sessions_tombstone",
    "DROP TRIGGER IF EXISTS trg_applications_tombstone",
    "DROP TRIGGER IF EXISTS trg_projects_tombstone",
    "DROP TRIGGER IF EXISTS trg_manual_sessions_tombstone",
    "DROP TRIGGER IF EXISTS trg_clients_tombstone",
    "DROP TRIGGER IF EXISTS trg_project_costs_tombstone",
    "DROP TRIGGER IF EXISTS trg_todos_tombstone",
    "DROP TRIGGER IF EXISTS trg_cfab_render_cost_tombstone",
];

pub const CREATE_ALL_TOMBSTONE_TRIGGERS_SQL: [&str; 8] = [
    SESSIONS_TOMBSTONE_TRIGGER_SQL,
    APPLICATIONS_TOMBSTONE_TRIGGER_SQL,
    PROJECTS_TOMBSTONE_TRIGGER_SQL,
    MANUAL_SESSIONS_TOMBSTONE_TRIGGER_SQL,
    CLIENTS_TOMBSTONE_TRIGGER_SQL,
    PROJECT_COSTS_TOMBSTONE_TRIGGER_SQL,
    TODOS_TOMBSTONE_TRIGGER_SQL,
    CFAB_RENDER_COST_TOMBSTONE_TRIGGER_SQL,
];

/// Trigger + tabela, na której siedzi. Pozwala pominąć trigger, którego tabeli
/// jeszcze nie ma: dashboard jest właścicielem migracji, a demon może dotknąć bazy
/// przed jego pierwszym startem po upgrade'cie. Bez tego `CREATE TRIGGER` na
/// nieistniejącej tabeli wysadzałby cały merge.
pub const TOMBSTONE_TRIGGERS_BY_TABLE: [(&str, &str); 8] = [
    ("sessions", SESSIONS_TOMBSTONE_TRIGGER_SQL),
    ("applications", APPLICATIONS_TOMBSTONE_TRIGGER_SQL),
    ("projects", PROJECTS_TOMBSTONE_TRIGGER_SQL),
    ("manual_sessions", MANUAL_SESSIONS_TOMBSTONE_TRIGGER_SQL),
    ("clients", CLIENTS_TOMBSTONE_TRIGGER_SQL),
    ("project_costs", PROJECT_COSTS_TOMBSTONE_TRIGGER_SQL),
    ("todos", TODOS_TOMBSTONE_TRIGGER_SQL),
    ("cfab_render_cost", CFAB_RENDER_COST_TOMBSTONE_TRIGGER_SQL),
];

fn table_exists(conn: &rusqlite::Connection, table: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [table],
        |row| row.get::<_, i64>(0),
    )
    .map(|c| c > 0)
    .unwrap_or(false)
}

/// Zakłada wszystkie triggery tombstone, pomijając te bez tabeli docelowej.
pub fn create_all_tombstone_triggers(conn: &rusqlite::Connection) -> Result<(), String> {
    for (table, sql) in TOMBSTONE_TRIGGERS_BY_TABLE {
        if !table_exists(conn, table) {
            continue;
        }
        conn.execute_batch(sql)
            .map_err(|e| format!("create trigger for '{table}': {e}"))?;
    }
    Ok(())
}

/// Te same triggery jako pojedynczy tekst SQL do wklejenia w większy batch
/// (bez `BEGIN`/`COMMIT` — wołający je dokłada). Pomija tabele nieistniejące.
pub fn create_all_tombstone_triggers_sql_for(conn: &rusqlite::Connection) -> String {
    let mut out = String::new();
    for (table, sql) in TOMBSTONE_TRIGGERS_BY_TABLE {
        if !table_exists(conn, table) {
            continue;
        }
        out.push_str(sql);
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_and_drop_arrays_are_aligned() {
        assert_eq!(CREATE_ALL_TOMBSTONE_TRIGGERS_SQL.len(), DROP_ALL_TOMBSTONE_TRIGGERS_SQL.len());
    }

    #[test]
    fn costs_todos_and_cfab_triggers_are_registered() {
        assert_eq!(CREATE_ALL_TOMBSTONE_TRIGGERS_SQL.len(), 8);
        let joined = CREATE_ALL_TOMBSTONE_TRIGGERS_SQL.join("\n");
        assert!(joined.contains("trg_project_costs_tombstone"));
        assert!(joined.contains("trg_todos_tombstone"));
        assert!(joined.contains("trg_cfab_render_cost_tombstone"));
        let dropped = DROP_ALL_TOMBSTONE_TRIGGERS_SQL.join("\n");
        assert!(dropped.contains("trg_project_costs_tombstone"));
        assert!(dropped.contains("trg_todos_tombstone"));
        assert!(dropped.contains("trg_cfab_render_cost_tombstone"));
    }

    #[test]
    fn by_table_list_covers_every_trigger() {
        assert_eq!(
            TOMBSTONE_TRIGGERS_BY_TABLE.len(),
            CREATE_ALL_TOMBSTONE_TRIGGERS_SQL.len(),
            "lista (tabela, trigger) musi pokrywac CREATE_ALL — inaczej merge cicho gubi trigger"
        );
    }

    #[test]
    fn missing_table_is_skipped_not_fatal() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE tombstones (id INTEGER PRIMARY KEY, table_name TEXT, \
             record_id INTEGER, sync_key TEXT, deleted_at TEXT);
             CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT);",
        )
        .unwrap();
        // Brak sessions/cfab_render_cost itd. — instalacja nie moze wysadzic merge'u.
        create_all_tombstone_triggers(&conn).expect("brakujaca tabela jest pomijana");
        let installed: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(installed, 1, "tylko trigger projektow ma swoja tabele");
    }

    #[test]
    fn triggers_install_and_mint_tombstone() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, updated_at TEXT);
             CREATE TABLE tombstones (id INTEGER PRIMARY KEY, table_name TEXT, record_id INTEGER, sync_key TEXT, deleted_at TEXT DEFAULT CURRENT_TIMESTAMP);",
        ).unwrap();
        for sql in CREATE_ALL_TOMBSTONE_TRIGGERS_SQL {
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
