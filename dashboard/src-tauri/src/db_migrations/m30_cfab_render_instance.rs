use rusqlite::Connection;

/// m30: CFAB render composite key with hub_instance_id.
///
/// Converts cfab_render_ack and cfab_render_cost to composite identity:
/// (hub_instance_id, ledger_id), defaulting existing rows to "legacy".
/// Adds machine_name to cfab_render_cost and index on (project_id, ended_at).
pub fn run(tx: &Connection) -> Result<(), rusqlite::Error> {
    // If cfab_render_ack already has hub_instance_id (e.g. freshly created or rerun), skip rebuilding
    let has_instance: bool = tx
        .prepare("SELECT COUNT(*) FROM pragma_table_info('cfab_render_ack') WHERE name='hub_instance_id'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_instance {
        tx.execute_batch(
            "CREATE TABLE cfab_render_ack_new (
                hub_instance_id TEXT NOT NULL DEFAULT 'legacy',
                ledger_id INTEGER NOT NULL,
                ingested_at TEXT NOT NULL,
                project_id INTEGER NOT NULL,
                rbh REAL NOT NULL,
                coefficient REAL NOT NULL,
                contract INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (hub_instance_id, ledger_id)
            );

            INSERT INTO cfab_render_ack_new (hub_instance_id, ledger_id, ingested_at, project_id, rbh, coefficient, contract)
                SELECT 'legacy', ledger_id, ingested_at, project_id, rbh, coefficient, contract FROM cfab_render_ack;

            DROP TABLE cfab_render_ack;
            ALTER TABLE cfab_render_ack_new RENAME TO cfab_render_ack;

            CREATE TABLE cfab_render_cost_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                hub_instance_id TEXT NOT NULL DEFAULT 'legacy',
                ledger_id INTEGER NOT NULL,
                project_id INTEGER NOT NULL,
                working_path TEXT NOT NULL,
                render_seconds REAL NOT NULL,
                ended_at REAL NOT NULL,
                rbh REAL NOT NULL,
                coefficient REAL NOT NULL,
                value REAL NOT NULL,
                ingested_at TEXT NOT NULL,
                machine_name TEXT,
                UNIQUE (hub_instance_id, ledger_id)
            );

            INSERT INTO cfab_render_cost_new (id, hub_instance_id, ledger_id, project_id, working_path, render_seconds, ended_at, rbh, coefficient, value, ingested_at)
                SELECT id, 'legacy', ledger_id, project_id, working_path, render_seconds, ended_at, rbh, coefficient, value, ingested_at FROM cfab_render_cost;

            DROP TABLE cfab_render_cost;
            ALTER TABLE cfab_render_cost_new RENAME TO cfab_render_cost;

            CREATE INDEX IF NOT EXISTS idx_cfab_render_cost_project_ended ON cfab_render_cost (project_id, ended_at);",
        )?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_m29_tables(conn: &Connection) {
        crate::db_migrations::m29_cfab_render::run(conn).unwrap();
    }

    #[test]
    fn m30_migrates_m29_data_to_legacy_instance() {
        let conn = Connection::open_in_memory().unwrap();
        setup_m29_tables(&conn);

        conn.execute(
            "INSERT INTO cfab_render_ack (ledger_id, ingested_at, project_id, rbh, coefficient, contract)
             VALUES (5, '2026-03-15T12:00:00Z', 1, 1.0, 0.2, 1)",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO cfab_render_cost (ledger_id, project_id, working_path, render_seconds, ended_at, rbh, coefficient, value, ingested_at)
             VALUES (5, 1, '/work/scena.c4d', 3600.0, 1234567890.0, 1.0, 0.2, 10.0, '2026-03-15T12:00:00Z')",
            [],
        ).unwrap();

        run(&conn).expect("m30 migration should succeed");

        let (ack_instance, ack_ledger_id): (String, i64) = conn
            .query_row("SELECT hub_instance_id, ledger_id FROM cfab_render_ack WHERE ledger_id = 5", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!(ack_instance, "legacy");
        assert_eq!(ack_ledger_id, 5);

        let (cost_instance, cost_val, cost_machine): (String, f64, Option<String>) = conn
            .query_row("SELECT hub_instance_id, value, machine_name FROM cfab_render_cost WHERE ledger_id = 5", [], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .unwrap();
        assert_eq!(cost_instance, "legacy");
        assert!((cost_val - 10.0).abs() < 1e-9);
        assert_eq!(cost_machine, None);
    }

    #[test]
    fn m30_composite_key_allows_same_ledger_id_across_different_instances() {
        let conn = Connection::open_in_memory().unwrap();
        setup_m29_tables(&conn);
        run(&conn).unwrap();

        // First insert with legacy
        conn.execute(
            "INSERT INTO cfab_render_ack (hub_instance_id, ledger_id, ingested_at, project_id, rbh, coefficient, contract)
             VALUES ('legacy', 5, '2026-03-15T12:00:00Z', 1, 1.0, 0.2, 1)",
            [],
        ).unwrap();

        // Duplicate with legacy should fail UNIQUE
        let err_dup = conn.execute(
            "INSERT INTO cfab_render_ack (hub_instance_id, ledger_id, ingested_at, project_id, rbh, coefficient, contract)
             VALUES ('legacy', 5, '2026-03-15T13:00:00Z', 1, 1.0, 0.2, 1)",
            [],
        ).expect_err("duplicate (legacy, 5) must fail");
        assert!(err_dup.to_string().contains("UNIQUE") || err_dup.to_string().contains("PRIMARY KEY"));

        // Another instance with the same ledger_id 5 must succeed
        conn.execute(
            "INSERT INTO cfab_render_ack (hub_instance_id, ledger_id, ingested_at, project_id, rbh, coefficient, contract)
             VALUES ('3f2a-hub-uuid', 5, '2026-03-15T13:00:00Z', 1, 1.0, 0.2, 2)",
            [],
        ).expect("insert with distinct hub_instance_id should succeed");

        // Same for cfab_render_cost
        conn.execute(
            "INSERT INTO cfab_render_cost (hub_instance_id, ledger_id, project_id, working_path, render_seconds, ended_at, rbh, coefficient, value, ingested_at, machine_name)
             VALUES ('legacy', 5, 1, '/work/1.c4d', 100.0, 1.0, 0.02, 0.2, 5.0, 'now', NULL)",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO cfab_render_cost (hub_instance_id, ledger_id, project_id, working_path, render_seconds, ended_at, rbh, coefficient, value, ingested_at, machine_name)
             VALUES ('3f2a-hub-uuid', 5, 1, '/work/2.c4d', 200.0, 2.0, 0.04, 0.2, 10.0, 'now', 'node-1')",
            [],
        ).expect("cost insert with distinct hub_instance_id should succeed");
    }

    #[test]
    fn m30_fresh_db_m29_then_m30_creates_composite_tables() {
        let conn = Connection::open_in_memory().unwrap();
        setup_m29_tables(&conn);
        run(&conn).unwrap();

        let has_instance_col: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('cfab_render_ack') WHERE name='hub_instance_id'")
            .unwrap()
            .query_row([], |row| row.get::<_, i64>(0))
            .map(|c| c > 0)
            .unwrap();
        assert!(has_instance_col);

        let has_machine_col: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('cfab_render_cost') WHERE name='machine_name'")
            .unwrap()
            .query_row([], |row| row.get::<_, i64>(0))
            .map(|c| c > 0)
            .unwrap();
        assert!(has_machine_col);
    }
}
