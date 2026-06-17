use rusqlite::Connection;

/// m23: logical project merge (stage → parent).
/// - projects.merged_into: parent project NAME (sync identifies projects by name)
/// - projects.merged_at: merge timestamp
/// - rename-cascade trigger: keeps children's merged_into in sync if a rename
///   path is ever added (mirrors trg_projects_rename_cascade_sessions from m20)
///
/// ALTER TABLE statements are guarded by pragma_table_info checks (idempotent)
/// because schema.sql already carries these columns on fresh installs.
pub fn run(tx: &Connection) -> Result<(), rusqlite::Error> {
    let has_merged_into: bool = tx
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name='merged_into'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_merged_into {
        tx.execute_batch("ALTER TABLE projects ADD COLUMN merged_into TEXT;")?;
    }

    let has_merged_at: bool = tx
        .prepare(
            "SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name='merged_at'",
        )?
        .query_row([], |row| row.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    if !has_merged_at {
        tx.execute_batch("ALTER TABLE projects ADD COLUMN merged_at TEXT;")?;
    }

    tx.execute_batch(
        "DROP TRIGGER IF EXISTS trg_projects_rename_cascade_merged;
         CREATE TRIGGER trg_projects_rename_cascade_merged
         AFTER UPDATE OF name ON projects
         FOR EACH ROW
         WHEN OLD.name <> NEW.name
         BEGIN
             UPDATE projects
             SET merged_into = NEW.name,
                 updated_at = datetime('now')
             WHERE merged_into = OLD.name;
         END;",
    )?;

    Ok(())
}
