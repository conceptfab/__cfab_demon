//! Production tombstone trigger definitions, daemon-side copy.
//!
//! The dashboard crate owns the canonical definitions
//! (dashboard/src-tauri/src/db_migrations/tombstone_triggers.rs and
//! resources/sql/schema.sql); this crate cannot depend on it, so the SQL is
//! mirrored here. Keep both in sync when changing trigger definitions:
//! merge_incoming_data actively DROPs and re-CREATEs the triggers from these
//! constants on every merge, so a stale mirror silently downgrades a trigger
//! upgraded by a newer dashboard migration — ship trigger changes in both
//! crates in the same release.
//!
//! Used by merge_incoming_data to suppress tombstone minting while applying
//! peer tombstones: deletions performed during merge are replays of already
//! recorded tombstones, and trigger-minted copies (deleted_at = now) would
//! propagate onward and defeat updated_at guards on other devices.

pub(crate) const DROP_ALL_TOMBSTONE_TRIGGERS_SQL: [&str; 4] = [
    "DROP TRIGGER IF EXISTS trg_sessions_tombstone",
    "DROP TRIGGER IF EXISTS trg_applications_tombstone",
    "DROP TRIGGER IF EXISTS trg_projects_tombstone",
    "DROP TRIGGER IF EXISTS trg_manual_sessions_tombstone",
];

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

pub(crate) const PROJECTS_TOMBSTONE_TRIGGER_SQL: &str =
    "CREATE TRIGGER IF NOT EXISTS trg_projects_tombstone
     AFTER DELETE ON projects
     FOR EACH ROW
     BEGIN
         INSERT INTO tombstones (table_name, record_id, sync_key)
         VALUES ('projects', OLD.id, OLD.name);
     END;";

pub(crate) const MANUAL_SESSIONS_TOMBSTONE_TRIGGER_SQL: &str =
    "CREATE TRIGGER IF NOT EXISTS trg_manual_sessions_tombstone
     AFTER DELETE ON manual_sessions
     FOR EACH ROW
     BEGIN
         INSERT INTO tombstones (table_name, record_id, sync_key)
         VALUES ('manual_sessions', OLD.id, OLD.project_id || '|' || OLD.start_time || '|' || OLD.title);
     END;";

pub(crate) const CREATE_ALL_TOMBSTONE_TRIGGERS_SQL: [&str; 4] = [
    SESSIONS_TOMBSTONE_TRIGGER_SQL,
    APPLICATIONS_TOMBSTONE_TRIGGER_SQL,
    PROJECTS_TOMBSTONE_TRIGGER_SQL,
    MANUAL_SESSIONS_TOMBSTONE_TRIGGER_SQL,
];
