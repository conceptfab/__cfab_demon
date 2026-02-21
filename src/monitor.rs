// Moduł monitora procesów — ultra-lekkie odpytywanie WinAPI
// Tylko GetForegroundWindow + PID → exe_name cache

use std::collections::HashMap;
use std::time::Instant;

use winapi::shared::minwindef::{DWORD, FILETIME};
use winapi::um::processthreadsapi::{OpenProcess, GetProcessTimes};
use winapi::um::winuser::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId};
use winapi::um::handleapi::CloseHandle;
use winapi::um::tlhelp32::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW,
    PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};

/// Cache PID → (exe_name, timestamp). Używany do ewikcji starych wpisów.
pub type PidCache = HashMap<u32, (String, Instant, Instant)>;

/// Informacja o aktywnym procesie
#[derive(Debug, Clone)]
pub struct ProcessInfo {
    pub exe_name: String,
    pub pid: u32,
    pub window_title: String,
}

/// Sprawdza czy proces o danym PID nadal żyje (ochrona przed PID reuse).
fn process_still_alive(pid: u32) -> bool {
    unsafe {
        let handle = OpenProcess(
            winapi::um::winnt::PROCESS_QUERY_LIMITED_INFORMATION,
            0,
            pid,
        );
        if handle.is_null() {
            return false;
        }
        CloseHandle(handle);
        true
    }
}

/// Sprawdza czy string zawiera znak zastępczy U+FFFD (nieprawidłowe UTF-16).
fn has_utf16_replacement_char(s: &str) -> bool {
    s.contains('\u{FFFD}')
}

/// Pobiera informację o aktualnie aktywnym oknie (foreground).
/// Koszt: 3 wywołania WinAPI + HashMap lookup.
/// `pid_cache` mapuje PID → (exe_name, timestamp) — przy hicie walidujemy czy proces żyje.
pub fn get_foreground_info(pid_cache: &mut PidCache) -> Option<ProcessInfo> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }

        // PID z okna
        let mut pid: DWORD = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return None;
        }

        // Tytuł okna
        let mut title_buf = [0u16; 512];
        let title_len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), title_buf.len() as i32);
        let window_title = if title_len > 0 {
            let s = String::from_utf16_lossy(&title_buf[..title_len as usize]);
            if has_utf16_replacement_char(&s) {
                log::debug!("Tytuł okna zawiera nieprawidłowe sekwencje UTF-16 (PID {}): {:?}", pid, s);
            }
            s
        } else {
            return None; // Brak tytułu = systemowe okno, ignorujemy
        };

        // Nazwa exe — z cache (z walidacją PID reuse) lub przez OpenProcess
        let now = Instant::now();
        let exe_name = if let Some((name, cached_at, last_alive_check)) = pid_cache.get_mut(&pid) {
            // Re-walidacja PID ograniczona do 60s, aby zredukować koszt OpenProcess.
            if now.duration_since(*last_alive_check) < std::time::Duration::from_secs(60) {
                *cached_at = now;
                name.clone()
            } else if process_still_alive(pid) {
                *cached_at = now;
                *last_alive_check = now;
                name.clone()
            } else {
                pid_cache.remove(&pid);
                let name = get_exe_name_from_pid(pid)?;
                pid_cache.insert(pid, (name.clone(), now, now));
                name
            }
        } else {
            let name = get_exe_name_from_pid(pid)?;
            pid_cache.insert(pid, (name.clone(), now, now));
            name
        };

        Some(ProcessInfo {
            exe_name,
            pid,
            window_title,
        })
    }
}

/// Pobiera nazwę exe z PID. Próbuje różnych metod WinAPI dla maksymalnej skuteczności.
fn get_exe_name_from_pid(pid: u32) -> Option<String> {
    use winapi::um::winbase::QueryFullProcessImageNameW;
    
    unsafe {
        // Próbujemy najpierw PROCESS_QUERY_LIMITED_INFORMATION (Działa dla większości procesów, nawet z wyższymi uprawnieniami)
        let handle = OpenProcess(
            winapi::um::winnt::PROCESS_QUERY_LIMITED_INFORMATION,
            0,
            pid,
        );
        
        if handle.is_null() {
            log::warn!("Błąd OpenProcess dla PID {}: {}", pid, winapi::um::errhandlingapi::GetLastError());
            return None;
        }

        let mut buf = [0u16; 1024];
        let mut size = buf.len() as DWORD;
        let res = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);
        CloseHandle(handle);

        if res == 0 {
            log::warn!("Błąd QueryFullProcessImageNameW dla PID {}: {}", pid, winapi::um::errhandlingapi::GetLastError());
            return None;
        }

        let full_path = String::from_utf16_lossy(&buf[..size as usize]);
        let exe_name = full_path
            .rsplit('\\')
            .next()
            .unwrap_or(&full_path)
            .to_lowercase();

        Some(exe_name)
    }
}

/// Ewiktuje wpisy cache starsze niż `max_age` (zamiast czyścić wszystko).
/// Zmniejsza serię wywołań OpenProcess po wyczyszczeniu.
pub fn evict_old_pid_cache(pid_cache: &mut PidCache, max_age: std::time::Duration) {
    let now = Instant::now();
    pid_cache.retain(|_, (_, ts, _)| now.duration_since(*ts) < max_age);
}

/// Parsuje tytuł okna i wyciąga nazwę pliku/projektu.
/// Heurystyka: bierze pierwszą część przed separatorem (` - `, ` — `, ` | `).
/// Przykłady:
///   "main.rs - cfab_demon - Visual Studio Code" → "main.rs - cfab_demon"
///   "projekt.psd @ 100% (RGB/8)" → "projekt.psd"
///   "Blender" → "Blender"
pub fn extract_file_from_title(title: &str) -> String {
    // Priority: " — " and " | " (checked via rfind) take precedence over " - ".
    // For "file.py - projekt | VS Code", rfind(" | ") matches first → result is "file.py - projekt".
    // This is intentional: " - " is last because it often appears inside file paths / project names.
    let separators = [" — ", " | "];

    for sep in separators {
        if let Some(pos) = title.rfind(sep) {
            let left = title[..pos].trim();
            if !left.is_empty() {
                return left.to_string();
            }
        }
    }

    // Dla " - " — specjalne traktowanie: bierzemy wszystko oprócz ostatniego segmentu
    // "main.rs - cfab_demon - Visual Studio Code" → "main.rs - cfab_demon"
    if let Some(pos) = title.rfind(" - ") {
        let left = title[..pos].trim();
        if !left.is_empty() {
            return left.to_string();
        }
    }

    // Dla " @ " — bierzemy lewą część
    if let Some(pos) = title.find(" @ ") {
        let left = title[..pos].trim();
        if !left.is_empty() {
            return left.to_string();
        }
    }

    title.trim().to_string()
}

// ── CPU tracking ──────────────────────────────────────────────

/// Konwertuje FILETIME (100-ns intervals od 1601) na u64.
fn filetime_to_u64(ft: &FILETIME) -> u64 {
    ((ft.dwHighDateTime as u64) << 32) | (ft.dwLowDateTime as u64)
}

/// Poprzedni stan CPU per aplikacja (suma kernel+user z ostatniego ticku).
#[derive(Debug, Clone)]
pub struct CpuSnapshot {
    /// Suma (kernel + user) w 100-ns jednostkach dla całego drzewa procesów.
    pub total_time: u64,
    /// Instant pomiaru (wall clock).
    pub measured_at: Instant,
}

/// Tracker CPU dla wielu aplikacji.
pub type CpuState = HashMap<String, CpuSnapshot>;

/// Snapshot of all processes: (parent→children tree, exe_name→PIDs map).
/// Built once per tick and reused across all monitored apps.
pub struct ProcessSnapshot {
    pub tree: HashMap<u32, Vec<u32>>,
    pub exe_pids: HashMap<String, Vec<u32>>,
}

/// Takes a single CreateToolhelp32Snapshot and builds both the parent→children
/// tree and the exe_name→PIDs map at once (replaces separate build_process_tree
/// + find_pids_by_exe which each created their own snapshot).
pub fn build_process_snapshot() -> ProcessSnapshot {
    let mut tree: HashMap<u32, Vec<u32>> = HashMap::new();
    let mut exe_pids: HashMap<String, Vec<u32>> = HashMap::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == winapi::um::handleapi::INVALID_HANDLE_VALUE {
            return ProcessSnapshot { tree, exe_pids };
        }

        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        if Process32FirstW(snap, &mut entry) != 0 {
            loop {
                tree.entry(entry.th32ParentProcessID)
                    .or_default()
                    .push(entry.th32ProcessID);

                let name_len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..name_len]).to_lowercase();
                exe_pids.entry(name).or_default().push(entry.th32ProcessID);

                if Process32NextW(snap, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
    }
    ProcessSnapshot { tree, exe_pids }
}

/// Rekurencyjnie zbiera wszystkie potomne PIDs.
fn collect_descendants(tree: &HashMap<u32, Vec<u32>>, root: u32, result: &mut Vec<u32>) {
    if let Some(children) = tree.get(&root) {
        for &child in children {
            result.push(child);
            collect_descendants(tree, child, result);
        }
    }
}

/// Pobiera sumaryczny czas CPU (kernel + user) dla zbioru PIDów.
/// Zwraca sumę w 100-ns jednostkach.
fn sum_cpu_times(pids: &[u32]) -> u64 {
    let mut total: u64 = 0;
    unsafe {
        for &pid in pids {
            let handle = OpenProcess(
                winapi::um::winnt::PROCESS_QUERY_LIMITED_INFORMATION,
                0,
                pid,
            );
            if handle.is_null() {
                continue;
            }

            let mut creation: FILETIME = std::mem::zeroed();
            let mut exit: FILETIME = std::mem::zeroed();
            let mut kernel: FILETIME = std::mem::zeroed();
            let mut user: FILETIME = std::mem::zeroed();

            if GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) != 0 {
                total += filetime_to_u64(&kernel) + filetime_to_u64(&user);
            }
            CloseHandle(handle);
        }
    }
    total
}

/// Pobiera aktualne zużycie CPU dla drzewa procesów danej aplikacji.
/// Zwraca (cpu_fraction, nowy snapshot).
/// cpu_fraction = ułamek jednego rdzenia (0.0 - N.0) zużyty od ostatniego pomiaru.
/// Accepts a pre-built ProcessSnapshot to avoid redundant system calls.
pub fn measure_cpu_for_app(
    exe_name: &str,
    prev: Option<&CpuSnapshot>,
    proc_snap: &ProcessSnapshot,
) -> (f64, CpuSnapshot) {
    let root_pids = proc_snap.exe_pids.get(exe_name).cloned().unwrap_or_default();

    let mut all_pids = root_pids.clone();
    for &root in &root_pids {
        collect_descendants(&proc_snap.tree, root, &mut all_pids);
    }

    let now = Instant::now();
    let total_time = sum_cpu_times(&all_pids);

    let snapshot = CpuSnapshot {
        total_time,
        measured_at: now,
    };

    let cpu_fraction = if let Some(prev) = prev {
        let wall_elapsed = now.duration_since(prev.measured_at).as_secs_f64();
        if wall_elapsed > 0.0 && total_time >= prev.total_time {
            let delta_cpu_secs = (total_time - prev.total_time) as f64 / 10_000_000.0;
            delta_cpu_secs / wall_elapsed
        } else {
            0.0
        }
    } else {
        0.0 // Pierwszy pomiar — brak delty
    };

    (cpu_fraction, snapshot)
}

#[cfg(test)]
mod tests {
    use super::extract_file_from_title;

    #[test]
    fn extract_file_single_separator() {
        assert_eq!(
            extract_file_from_title("main.rs - cfab_demon - Visual Studio Code"),
            "main.rs - cfab_demon"
        );
    }

    #[test]
    fn extract_file_at_separator() {
        assert_eq!(
            extract_file_from_title("projekt.psd @ 100% (RGB/8)"),
            "projekt.psd"
        );
    }

    #[test]
    fn extract_file_no_separator() {
        assert_eq!(extract_file_from_title("Blender"), "Blender");
    }

    #[test]
    fn extract_file_pipe_separator() {
        assert_eq!(
            extract_file_from_title("file.py | VS Code"),
            "file.py"
        );
    }

    #[test]
    fn extract_file_mixed_separators() {
        // " - " ma pierwszeństwo przed " | " przy rfind — bierzemy lewą część przed ostatnim " - "
        assert_eq!(
            extract_file_from_title("file.py - projekt | VS Code"),
            "file.py - projekt"
        );
    }

    #[test]
    fn extract_file_empty_after_trim() {
        assert_eq!(extract_file_from_title("   "), "");
    }

    #[test]
    fn extract_file_em_dash() {
        assert_eq!(
            extract_file_from_title("dokument — Edytor"),
            "dokument"
        );
    }
}
