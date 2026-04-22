// macOS process snapshot — cienka obwoluta nad `sysinfo`.
// Uwaga: sysinfo::System jest stanowe (refresh + odczyt), tutaj tworzymy
// świeżą instancję na każde wywołanie dla symetrii z Windowsem.

use sysinfo::{ProcessesToUpdate, System};

use crate::platform::process_info::ProcessEntryInfo;

pub fn collect_process_entries() -> Option<Vec<ProcessEntryInfo>> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All);

    let entries = sys
        .processes()
        .iter()
        .map(|(pid, proc_)| {
            let exe_name = proc_
                .exe()
                .and_then(|p| p.file_name())
                .map(|s| s.to_string_lossy().to_lowercase())
                .unwrap_or_else(|| proc_.name().to_string_lossy().to_lowercase());
            let parent = proc_.parent().map(|p| p.as_u32()).unwrap_or(0);
            ProcessEntryInfo {
                process_id: pid.as_u32(),
                parent_process_id: parent,
                exe_name,
            }
        })
        .collect();

    Some(entries)
}
