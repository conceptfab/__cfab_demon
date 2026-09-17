use rusqlite::Connection;

/// m31: CFAB path index table and manual assignment tracking.
///
/// Adds `cfab_project_path_index` for longest-prefix project resolution.
/// Adds `assigned_by` and `assigned_at` to `cfab_render_ack` and `cfab_render_cost`.
pub fn run(tx: &Connection) -> Result<(), rusqlite::Error> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS cfab_project_path_index (
            folder_norm TEXT PRIMARY KEY,
            project_id INTEGER NOT NULL,
            source TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cfab_path_index_proj ON cfab_project_path_index (project_id);",
    )?;

    let has_assigned_by_ack: bool = tx
        .prepare("SELECT COUNT(*) FROM pragma_table_info('cfab_render_ack') WHERE name='assigned_by'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_assigned_by_ack {
        tx.execute_batch(
            "ALTER TABLE cfab_render_ack ADD COLUMN assigned_by TEXT NOT NULL DEFAULT 'auto';
             ALTER TABLE cfab_render_ack ADD COLUMN assigned_at TEXT;",
        )?;
    }

    let has_assigned_by_cost: bool = tx
        .prepare("SELECT COUNT(*) FROM pragma_table_info('cfab_render_cost') WHERE name='assigned_by'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_assigned_by_cost {
        tx.execute_batch(
            "ALTER TABLE cfab_render_cost ADD COLUMN assigned_by TEXT NOT NULL DEFAULT 'auto';
             ALTER TABLE cfab_render_cost ADD COLUMN assigned_at TEXT;",
        )?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_m30_tables(conn: &Connection) {
        crate::db_migrations::m29_cfab_render::run(conn).unwrap();
        crate::db_migrations::m30_cfab_render_instance::run(conn).unwrap();
    }

    #[test]
    fn m31_creates_path_index_and_adds_assignment_columns() {
        let conn = Connection::open_in_memory().unwrap();
        setup_m30_tables(&conn);

        conn.execute(
            "INSERT INTO cfab_render_ack (hub_instance_id, ledger_id, ingested_at, project_id, rbh, coefficient, contract)
             VALUES ('legacy', 1, '2026-03-15T12:00:00Z', 1, 1.0, 0.2, 1)",
            [],
        ).unwrap();

        run(&conn).expect("m31 migration should succeed");

        conn.execute(
            "INSERT INTO cfab_project_path_index (folder_norm, project_id, source, updated_at)
             VALUES ('/work/project_alpha', 1, 'assigned', '2026-09-18T00:00:00Z')",
            [],
        ).unwrap();

        let (proj, src): (i64, String) = conn
            .query_row("SELECT project_id, source FROM cfab_project_path_index WHERE folder_norm = '/work/project_alpha'", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(proj, 1);
        assert_eq!(src, "assigned");

        let assigned_by: String = conn
            .query_row("SELECT assigned_by FROM cfab_render_ack WHERE ledger_id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(assigned_by, "auto");

        conn.execute(
            "UPDATE cfab_render_ack SET assigned_by = 'manual', assigned_at = '2026-09-18T00:00:00Z' WHERE ledger_id = 1",
            [],
        ).unwrap();
    }
}
