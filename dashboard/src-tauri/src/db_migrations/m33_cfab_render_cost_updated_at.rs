use rusqlite::Connection;

/// m33: `updated_at` w `cfab_render_cost` — warunek wstępny synchronizacji renderów.
///
/// Tabela nie miała żadnego znacznika zmiany: `ingested_at` jest ustawiane raz przy
/// wejściu wiersza, a `assigned_at` tylko przy ręcznym przypisaniu. Bez `updated_at`
/// nie da się ani wyznaczyć okna delty, ani rozstrzygnąć konfliktu LWW po
/// przypisaniu tego samego renderu do innego projektu na dwóch maszynach.
///
/// Backfill: `COALESCE(assigned_at, ingested_at)` — najlepsze przybliżenie momentu
/// ostatniej zmiany dla wierszy istniejących przed migracją.
pub fn run(tx: &Connection) -> Result<(), rusqlite::Error> {
    let has_updated_at: bool = tx
        .prepare("SELECT COUNT(*) FROM pragma_table_info('cfab_render_cost') WHERE name='updated_at'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_updated_at {
        // DEFAULT stały (nie CURRENT_TIMESTAMP) — ALTER TABLE ... ADD COLUMN w SQLite
        // wymaga wartości niezmiennej, a poza tym epoka jako default gwarantuje, że
        // każdy realny zapis wygra LWW nad wierszem, którego nikt nie dotknął.
        tx.execute_batch(
            "ALTER TABLE cfab_render_cost
                ADD COLUMN updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00';",
        )?;
        tx.execute_batch(
            "UPDATE cfab_render_cost
                SET updated_at = COALESCE(assigned_at, ingested_at)
              WHERE COALESCE(assigned_at, ingested_at) IS NOT NULL;",
        )?;
    }

    // Delta sync filtruje po `updated_at`; bez indeksu każdy pull to pełny skan.
    tx.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_cfab_render_cost_updated_at
            ON cfab_render_cost (updated_at);",
    )?;

    // Tombstone dla odpięcia renderu (`detach`) — bez niego usunięcie cofałoby się
    // przy każdym pełnym sync, bo peer nadal ma wiersz w snapshocie.
    tx.execute_batch(super::tombstone_triggers::CFAB_RENDER_COST_TOMBSTONE_TRIGGER_SQL)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_m32_tables(conn: &Connection) {
        crate::db_migrations::m29_cfab_render::run(conn).unwrap();
        crate::db_migrations::m30_cfab_render_instance::run(conn).unwrap();
        crate::db_migrations::m31_cfab_path_index_and_manual::run(conn).unwrap();
        crate::db_migrations::m32_cfab_thumbnails_and_project_summary::run(conn).unwrap();
    }

    fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
        conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
            [table, column],
            |row| row.get::<_, i64>(0),
        )
        .unwrap()
            > 0
    }

    fn insert_row(conn: &Connection, ledger_id: i64, ingested_at: &str, assigned_at: Option<&str>) {
        conn.execute(
            "INSERT INTO cfab_render_cost (
                hub_instance_id, ledger_id, project_id, working_path, render_seconds,
                ended_at, rbh, coefficient, value, ingested_at, assigned_at
            ) VALUES ('inst-A', ?1, 1, '/p/a.hip', 3600.0, 1.0, 1.0, 0.2, 10.0, ?2, ?3)",
            rusqlite::params![ledger_id, ingested_at, assigned_at],
        )
        .unwrap();
    }

    #[test]
    fn m33_adds_updated_at_column() {
        let conn = Connection::open_in_memory().unwrap();
        setup_m32_tables(&conn);
        assert!(!column_exists(&conn, "cfab_render_cost", "updated_at"));
        run(&conn).unwrap();
        assert!(column_exists(&conn, "cfab_render_cost", "updated_at"));
    }

    #[test]
    fn m33_backfills_from_assigned_at_then_ingested_at() {
        let conn = Connection::open_in_memory().unwrap();
        setup_m32_tables(&conn);
        insert_row(&conn, 1, "2026-01-01 10:00:00", Some("2026-02-02 11:00:00"));
        insert_row(&conn, 2, "2026-01-03 12:00:00", None);
        run(&conn).unwrap();

        let ts1: String = conn
            .query_row(
                "SELECT updated_at FROM cfab_render_cost WHERE ledger_id = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let ts2: String = conn
            .query_row(
                "SELECT updated_at FROM cfab_render_cost WHERE ledger_id = 2",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ts1, "2026-02-02 11:00:00", "assigned_at ma priorytet");
        assert_eq!(ts2, "2026-01-03 12:00:00", "fallback na ingested_at");
    }

    #[test]
    fn m33_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        setup_m32_tables(&conn);
        insert_row(&conn, 1, "2026-01-01 10:00:00", None);
        run(&conn).unwrap();
        conn.execute(
            "UPDATE cfab_render_cost SET updated_at = '2026-05-05 05:05:05' WHERE ledger_id = 1",
            [],
        )
        .unwrap();
        // Drugi przebieg nie może nadpisać wartości ustawionej po pierwszym.
        run(&conn).unwrap();
        let ts: String = conn
            .query_row("SELECT updated_at FROM cfab_render_cost", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ts, "2026-05-05 05:05:05");
    }

    #[test]
    fn m33_creates_tombstone_trigger_that_records_composite_sync_key() {
        let conn = Connection::open_in_memory().unwrap();
        setup_m32_tables(&conn);
        conn.execute_batch(
            "CREATE TABLE tombstones (id INTEGER PRIMARY KEY, table_name TEXT, \
             record_id INTEGER, sync_key TEXT, deleted_at TEXT DEFAULT CURRENT_TIMESTAMP);",
        )
        .unwrap();
        run(&conn).unwrap();
        insert_row(&conn, 7, "2026-01-01 10:00:00", None);
        conn.execute("DELETE FROM cfab_render_cost WHERE ledger_id = 7", [])
            .unwrap();

        let (table_name, sync_key): (String, String) = conn
            .query_row(
                "SELECT table_name, sync_key FROM tombstones",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(table_name, "cfab_render_cost");
        assert_eq!(sync_key, "inst-A|7");
    }

    #[test]
    fn m33_creates_updated_at_index() {
        let conn = Connection::open_in_memory().unwrap();
        setup_m32_tables(&conn);
        run(&conn).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type='index' AND name='idx_cfab_render_cost_updated_at'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }
}
