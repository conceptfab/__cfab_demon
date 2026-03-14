pub use timeflow_shared::process_utils::no_console;

#[derive(Debug, Clone)]
pub struct ProcessEntryInfo {
    pub process_id: u32,
    pub parent_process_id: u32,
    pub exe_name: String,
}

#[cfg(windows)]
pub fn collect_process_entries() -> Option<Vec<ProcessEntryInfo>> {
    use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};
    use winapi::um::tlhelp32::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return None;
        }

        let mut entries = Vec::new();
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        if Process32FirstW(snapshot, &mut entry) != 0 {
            loop {
                let name_len = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                entries.push(ProcessEntryInfo {
                    process_id: entry.th32ProcessID,
                    parent_process_id: entry.th32ParentProcessID,
                    exe_name: String::from_utf16_lossy(&entry.szExeFile[..name_len]).to_lowercase(),
                });

                if Process32NextW(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }

        CloseHandle(snapshot);
        Some(entries)
    }
}

#[cfg(not(windows))]
pub fn collect_process_entries() -> Option<Vec<ProcessEntryInfo>> {
    Some(Vec::new())
}
