//! Re-eksport kanonicznych triggerów z timeflow-shared::sync::triggers (finding #6).
//!
//! Indywidualne DROP_* używane bezpośrednio przez import.rs (m21-style targeted
//! drops) trzymamy lokalnie — shared eksponuje tylko tablicę DROP_ALL.

pub(crate) use timeflow_shared::sync::triggers::{
    APPLICATIONS_TOMBSTONE_TRIGGER_SQL, CLIENTS_TOMBSTONE_TRIGGER_SQL,
    CREATE_ALL_TOMBSTONE_TRIGGERS_SQL, DROP_ALL_TOMBSTONE_TRIGGERS_SQL,
    SESSIONS_TOMBSTONE_TRIGGER_SQL,
};

pub(crate) const DROP_SESSIONS_TOMBSTONE_TRIGGER_SQL: &str =
    "DROP TRIGGER IF EXISTS trg_sessions_tombstone";
pub(crate) const DROP_APPLICATIONS_TOMBSTONE_TRIGGER_SQL: &str =
    "DROP TRIGGER IF EXISTS trg_applications_tombstone";
