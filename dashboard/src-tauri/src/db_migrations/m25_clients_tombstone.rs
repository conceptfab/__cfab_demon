use rusqlite::Connection;

/// m25: clients tombstone trigger.
///
/// m24 added the `clients` entity (and `projects.client_name` / `projects.status`)
/// but wired NONE of it into LAN sync — no tombstone trigger for clients, and the
/// daemon export/merge ignored the new columns entirely. As a result a deleted
/// client could resurrect on the next merge, and client→project assignments were
/// dropped on convergence. This migration mints a tombstone on client delete,
/// mirroring `trg_projects_tombstone` (sync_key = client name). The daemon mirror
/// (src/tombstone_triggers.rs) re-creates the same trigger after every merge.
///
/// Idempotent: `CREATE TRIGGER IF NOT EXISTS`.
pub fn run(tx: &Connection) -> Result<(), rusqlite::Error> {
    tx.execute_batch(super::tombstone_triggers::CLIENTS_TOMBSTONE_TRIGGER_SQL)?;
    Ok(())
}
