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
