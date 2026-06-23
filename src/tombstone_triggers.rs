//! Re-eksport kanonicznych triggerów z timeflow-shared::sync::triggers.
//! (Definicje przeniesione do shared — patrz finding #6.)

// Indywidualne stałe są używane w testach (sync_common.rs:2860-2863);
// kompilator nie widzi tych referencji w build bez cfg(test).
#[allow(unused_imports)]
pub(crate) use timeflow_shared::sync::triggers::{
    APPLICATIONS_TOMBSTONE_TRIGGER_SQL, CREATE_ALL_TOMBSTONE_TRIGGERS_SQL,
    DROP_ALL_TOMBSTONE_TRIGGERS_SQL, MANUAL_SESSIONS_TOMBSTONE_TRIGGER_SQL,
    PROJECTS_TOMBSTONE_TRIGGER_SQL, SESSIONS_TOMBSTONE_TRIGGER_SQL,
};
