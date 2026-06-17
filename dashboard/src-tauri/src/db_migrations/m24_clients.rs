use rusqlite::Connection;

/// m24: clients entity + project↔client link + project status.
///
/// - `clients`: full client entity. `name` is UNIQUE and is the stable key used
///   for the project link (and for future cross-machine sync, mirroring how
///   projects are identified by name). `updated_at` is carried for future LWW.
/// - `projects.client_name`: links a project to a client by NAME (portable; an
///   integer id would differ per machine once sync is added).
/// - `projects.status`: 'active' | 'done' | 'paid' ("zrealizowane" = paid).
///
/// NOTE: clients do NOT participate in sync merge yet (see C1b) — they are local
/// until the merge + tombstone wiring is added on both daemon/dashboard mirrors.
///
/// ALTER statements are guarded by pragma_table_info checks (idempotent).
pub fn run(tx: &Connection) -> Result<(), rusqlite::Error> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            contact TEXT,
            address TEXT,
            tax_id TEXT,
            currency TEXT,
            default_hourly_rate REAL,
            color TEXT NOT NULL DEFAULT '#38bdf8',
            archived_at TEXT,
            created_at TEXT,
            updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
        );",
    )?;

    let has_client_name: bool = tx
        .prepare("SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name='client_name'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_client_name {
        tx.execute_batch("ALTER TABLE projects ADD COLUMN client_name TEXT;")?;
    }

    let has_status: bool = tx
        .prepare("SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name='status'")?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if !has_status {
        tx.execute_batch(
            "ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active';",
        )?;
    }

    Ok(())
}
