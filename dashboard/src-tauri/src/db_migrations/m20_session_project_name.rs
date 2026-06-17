// m20: Persistent project_name on sessions/manual_sessions.
//
// Problem: sessions store the project assignment as a LOCAL integer project_id.
// After LAN sync, if the peer's project doesn't exist locally (different project
// list per machine), session.project_id resolves to NULL and the session appears
// as "Unassigned" — even though the peer knows which project it belongs to.
//
// Fix: duplicate the project NAME on every session. Triggers keep it in sync
// with project_id on local writes. LAN sync writes the peer's project_name
// directly, so sessions retain their assignment label even when the project
// itself isn't present locally.
pub fn run(db: &rusqlite::Transaction) -> Result<(), rusqlite::Error> {
    // 1. Add column to sessions (idempotent via table_info check)
    let has_sessions_col: i64 = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='project_name'")?
        .query_row([], |r| r.get(0))
        .unwrap_or(0);
    if has_sessions_col == 0 {
        db.execute_batch("ALTER TABLE sessions ADD COLUMN project_name TEXT;")?;
    }

    // 2. Add column to manual_sessions
    let has_manual_col: i64 = db
        .prepare("SELECT COUNT(*) FROM pragma_table_info('manual_sessions') WHERE name='project_name'")?
        .query_row([], |r| r.get(0))
        .unwrap_or(0);
    if has_manual_col == 0 {
        db.execute_batch("ALTER TABLE manual_sessions ADD COLUMN project_name TEXT;")?;
    }

    // 3. Backfill from projects table (where the local project still exists)
    db.execute_batch(
        "UPDATE sessions SET project_name = (SELECT name FROM projects WHERE projects.id = sessions.project_id)
          WHERE project_id IS NOT NULL AND (project_name IS NULL OR project_name = '');
         UPDATE manual_sessions SET project_name = (SELECT name FROM projects WHERE projects.id = manual_sessions.project_id)
          WHERE project_id IS NOT NULL AND project_id != 0 AND (project_name IS NULL OR project_name = '');",
    )?;

    // 4. Triggers: auto-sync project_name when project_id changes (insert/update).
    //    Trigger fires AFTER UPDATE OF project_id — updating project_name does NOT re-fire it.
    db.execute_batch(
        "DROP TRIGGER IF EXISTS trg_sessions_sync_project_name_ins;
         DROP TRIGGER IF EXISTS trg_sessions_sync_project_name_upd;
         DROP TRIGGER IF EXISTS trg_manual_sessions_sync_project_name_ins;
         DROP TRIGGER IF EXISTS trg_manual_sessions_sync_project_name_upd;
         DROP TRIGGER IF EXISTS trg_projects_rename_cascade_sessions;

         CREATE TRIGGER trg_sessions_sync_project_name_ins
         AFTER INSERT ON sessions
         FOR EACH ROW WHEN NEW.project_id IS NOT NULL
         BEGIN
           UPDATE sessions
              SET project_name = (SELECT name FROM projects WHERE id = NEW.project_id)
            WHERE id = NEW.id AND (project_name IS NULL OR project_name = '');
         END;

         CREATE TRIGGER trg_sessions_sync_project_name_upd
         AFTER UPDATE OF project_id ON sessions
         FOR EACH ROW WHEN NEW.project_id IS NOT NULL AND NEW.project_id IS NOT OLD.project_id
         BEGIN
           UPDATE sessions
              SET project_name = (SELECT name FROM projects WHERE id = NEW.project_id)
            WHERE id = NEW.id;
         END;

         CREATE TRIGGER trg_manual_sessions_sync_project_name_ins
         AFTER INSERT ON manual_sessions
         FOR EACH ROW WHEN NEW.project_id IS NOT NULL AND NEW.project_id != 0
         BEGIN
           UPDATE manual_sessions
              SET project_name = (SELECT name FROM projects WHERE id = NEW.project_id)
            WHERE id = NEW.id AND (project_name IS NULL OR project_name = '');
         END;

         CREATE TRIGGER trg_manual_sessions_sync_project_name_upd
         AFTER UPDATE OF project_id ON manual_sessions
         FOR EACH ROW WHEN NEW.project_id IS NOT NULL AND NEW.project_id != 0 AND NEW.project_id IS NOT OLD.project_id
         BEGIN
           UPDATE manual_sessions
              SET project_name = (SELECT name FROM projects WHERE id = NEW.project_id)
            WHERE id = NEW.id;
         END;

         CREATE TRIGGER trg_projects_rename_cascade_sessions
         AFTER UPDATE OF name ON projects
         FOR EACH ROW WHEN NEW.name IS NOT OLD.name
         BEGIN
           UPDATE sessions SET project_name = NEW.name WHERE project_id = NEW.id;
           UPDATE manual_sessions SET project_name = NEW.name WHERE project_id = NEW.id;
         END;",
    )?;

    // 5. Force next LAN sync to re-transmit every assigned session, so peers
    //    receive the backfilled project_name and can retroactively restore
    //    labels on sessions whose project doesn't exist locally.
    db.execute_batch(
        "UPDATE sessions SET updated_at = datetime('now') WHERE project_id IS NOT NULL;
         UPDATE manual_sessions SET updated_at = datetime('now') WHERE project_id IS NOT NULL AND project_id != 0;",
    )?;

    log::info!("m20_session_project_name: migration complete");
    Ok(())
}
