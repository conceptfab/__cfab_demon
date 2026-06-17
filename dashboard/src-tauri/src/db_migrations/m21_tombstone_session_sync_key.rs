use rusqlite::Connection;

use super::tombstone_triggers;

pub fn run(tx: &Connection) -> Result<(), rusqlite::Error> {
    tx.execute(tombstone_triggers::DROP_SESSIONS_TOMBSTONE_TRIGGER_SQL, [])?;
    tx.execute(tombstone_triggers::SESSIONS_TOMBSTONE_TRIGGER_SQL, [])?;
    Ok(())
}
