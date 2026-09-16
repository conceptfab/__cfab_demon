use rusqlite::Connection;

/// m29: CFAB render ingest — ACK ledger, cost rows, per-project settings.
///
/// Coefficient lives in `cfab_render_project_settings`, not in `estimate_settings`.
pub fn run(tx: &Connection) -> Result<(), rusqlite::Error> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS cfab_render_ack (
            ledger_id INTEGER PRIMARY KEY,
            ingested_at TEXT NOT NULL,
            project_id INTEGER NOT NULL,
            rbh REAL NOT NULL,
            coefficient REAL NOT NULL,
            contract INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS cfab_render_cost (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ledger_id INTEGER NOT NULL UNIQUE,
            project_id INTEGER NOT NULL,
            working_path TEXT NOT NULL,
            render_seconds REAL NOT NULL,
            ended_at REAL NOT NULL,
            rbh REAL NOT NULL,
            coefficient REAL NOT NULL,
            value REAL NOT NULL,
            ingested_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cfab_render_project_settings (
            project_id INTEGER PRIMARY KEY,
            coefficient REAL NOT NULL DEFAULT 0.2,
            include_in_billing INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
        );",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn run_migration(conn: &Connection) {
        run(conn).expect("migration should succeed");
    }

    fn table_exists(conn: &Connection, name: &str) -> bool {
        conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            [name],
            |row| row.get::<_, i64>(0),
        )
        .unwrap()
            > 0
    }

    #[test]
    fn m29_creates_cfab_render_tables() {
        let conn = Connection::open_in_memory().unwrap();
        run_migration(&conn);

        assert!(table_exists(&conn, "cfab_render_ack"));
        assert!(table_exists(&conn, "cfab_render_cost"));
        assert!(table_exists(&conn, "cfab_render_project_settings"));
    }

    #[test]
    fn m29_cfab_render_cost_ledger_id_is_unique() {
        let conn = Connection::open_in_memory().unwrap();
        run_migration(&conn);

        conn.execute(
            "INSERT INTO cfab_render_cost (
                ledger_id, project_id, working_path, render_seconds,
                ended_at, rbh, coefficient, value, ingested_at
            ) VALUES (1, 1, '/path', 100.0, 1234567890.0, 0.027, 0.2, 5.4, '2026-01-01T00:00:00Z')",
            [],
        )
        .expect("first insert");

        let err = conn
            .execute(
                "INSERT INTO cfab_render_cost (
                    ledger_id, project_id, working_path, render_seconds,
                    ended_at, rbh, coefficient, value, ingested_at
                ) VALUES (1, 2, '/other', 50.0, 1234567891.0, 0.014, 0.2, 2.8, '2026-01-01T01:00:00Z')",
                [],
            )
            .expect_err("duplicate ledger_id should fail");

        assert!(
            err.to_string().contains("UNIQUE"),
            "expected UNIQUE constraint error, got: {}",
            err
        );
    }

    #[test]
    fn m29_project_settings_no_seed_row_required() {
        let conn = Connection::open_in_memory().unwrap();
        run_migration(&conn);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM cfab_render_project_settings", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(
            count, 0,
            "migration must not seed project settings rows"
        );
    }

    #[test]
    fn m29_no_estimate_settings_cfab_render_coefficient_seed() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS estimate_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );",
        )
        .unwrap();
        run_migration(&conn);

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM estimate_settings WHERE key = 'cfab_render_coefficient'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            count, 0,
            "must not seed estimate_settings.cfab_render_coefficient"
        );
    }
}
