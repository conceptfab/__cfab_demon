// Cross-platform typ opisujący wpis w migawce procesów systemu.
// Dostarczany przez platform::process_snapshot::collect_process_entries.

#[derive(Debug, Clone)]
pub struct ProcessEntryInfo {
    pub process_id: u32,
    pub parent_process_id: u32,
    pub exe_name: String,
}
