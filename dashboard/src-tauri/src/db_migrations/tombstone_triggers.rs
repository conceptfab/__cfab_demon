//! Shared tombstone trigger SQL constants — used by migrations
//! and by purge_unregistered_apps (which temporarily disables them).
//!
//! NOTE: the daemon crate keeps a mirror of these definitions in
//! src/tombstone_triggers.rs (it cannot depend on this crate) and actively
//! re-creates the triggers from that mirror after every LAN merge. When
//! changing a trigger here (or projects/manual_sessions triggers in
//! resources/sql/schema.sql), update the daemon mirror in the same release —
//! otherwise the first merge silently downgrades the trigger.

pub(crate) const DROP_SESSIONS_TOMBSTONE_TRIGGER_SQL: &str =
    "DROP TRIGGER IF EXISTS trg_sessions_tombstone";

pub(crate) const DROP_APPLICATIONS_TOMBSTONE_TRIGGER_SQL: &str =
    "DROP TRIGGER IF EXISTS trg_applications_tombstone";

/// Current version (from m21) — sync_key = executable_name|start_time.
pub(crate) const SESSIONS_TOMBSTONE_TRIGGER_SQL: &str =
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

/// Version from m12 — sync_key = executable_name.
pub(crate) const APPLICATIONS_TOMBSTONE_TRIGGER_SQL: &str =
    "CREATE TRIGGER IF NOT EXISTS trg_applications_tombstone
     AFTER DELETE ON applications
     FOR EACH ROW
     BEGIN
         INSERT INTO tombstones (table_name, record_id, sync_key)
         VALUES ('applications', OLD.id, OLD.executable_name);
     END;";

pub(crate) const DROP_PROJECTS_TOMBSTONE_TRIGGER_SQL: &str =
    "DROP TRIGGER IF EXISTS trg_projects_tombstone";

pub(crate) const DROP_MANUAL_SESSIONS_TOMBSTONE_TRIGGER_SQL: &str =
    "DROP TRIGGER IF EXISTS trg_manual_sessions_tombstone";

/// Mirror of resources/sql/schema.sql — sync_key = project name.
pub(crate) const PROJECTS_TOMBSTONE_TRIGGER_SQL: &str =
    "CREATE TRIGGER IF NOT EXISTS trg_projects_tombstone
     AFTER DELETE ON projects
     FOR EACH ROW
     BEGIN
         INSERT INTO tombstones (table_name, record_id, sync_key)
         VALUES ('projects', OLD.id, OLD.name);
     END;";

/// Mirror of resources/sql/schema.sql — sync_key = project_id|start_time|title.
pub(crate) const MANUAL_SESSIONS_TOMBSTONE_TRIGGER_SQL: &str =
    "CREATE TRIGGER IF NOT EXISTS trg_manual_sessions_tombstone
     AFTER DELETE ON manual_sessions
     FOR EACH ROW
     BEGIN
         INSERT INTO tombstones (table_name, record_id, sync_key)
         VALUES ('manual_sessions', OLD.id, OLD.project_id || '|' || OLD.start_time || '|' || OLD.title);
     END;";

/// All four production tombstone triggers — for code paths that must run
/// technical (non-user-intent) DELETEs without minting tombstones.
pub(crate) const DROP_ALL_TOMBSTONE_TRIGGERS_SQL: [&str; 4] = [
    DROP_SESSIONS_TOMBSTONE_TRIGGER_SQL,
    DROP_APPLICATIONS_TOMBSTONE_TRIGGER_SQL,
    DROP_PROJECTS_TOMBSTONE_TRIGGER_SQL,
    DROP_MANUAL_SESSIONS_TOMBSTONE_TRIGGER_SQL,
];

pub(crate) const CREATE_ALL_TOMBSTONE_TRIGGERS_SQL: [&str; 4] = [
    SESSIONS_TOMBSTONE_TRIGGER_SQL,
    APPLICATIONS_TOMBSTONE_TRIGGER_SQL,
    PROJECTS_TOMBSTONE_TRIGGER_SQL,
    MANUAL_SESSIONS_TOMBSTONE_TRIGGER_SQL,
];
