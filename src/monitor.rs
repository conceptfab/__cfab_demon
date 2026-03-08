// Moduł monitora procesów — ultra-lekkie odpytywanie WinAPI
// Tylko GetForegroundWindow + PID → exe_name cache

use std::collections::HashMap;
use std::time::Instant;

use winapi::shared::minwindef::{DWORD, FILETIME};
use winapi::um::handleapi::CloseHandle;
use winapi::um::processthreadsapi::{GetProcessTimes, OpenProcess};
use winapi::um::tlhelp32::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use winapi::um::winuser::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId};

thread_local! {
    static WMI_CONN_CACHE: std::cell::RefCell<Option<wmi::WMIConnection>> =
        std::cell::RefCell::new(None);
}

/// Cache PID -> (exe_name, creation_time, cached_at, last_alive_check, detected_path).
/// Used to evict old entries and validate PID reuse.
pub type PidCache = HashMap<u32, (String, u64, Instant, Instant, Option<String>)>;

/// Informacja o aktywnym procesie
#[derive(Debug, Clone)]
pub struct ProcessInfo {
    pub exe_name: String,
    pub pid: u32,
    pub window_title: String,
    pub detected_path: Option<String>,
    pub activity_type: Option<String>,
}

/// Gets the creation time of a process as u64. Returns None if unable to fetch.
fn get_process_creation_time(pid: u32) -> Option<u64> {
    unsafe {
        let handle = OpenProcess(winapi::um::winnt::PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return None;
        }

        let mut creation: FILETIME = std::mem::zeroed();
        let mut exit: FILETIME = std::mem::zeroed();
        let mut kernel: FILETIME = std::mem::zeroed();
        let mut user: FILETIME = std::mem::zeroed();

        let ok = GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user);
        CloseHandle(handle);

        if ok != 0 {
            Some(filetime_to_u64(&creation))
        } else {
            None
        }
    }
}

/// Checks if a process with a specific PID is still alive AND has the same creation time (protects against PID reuse).
fn process_still_alive(pid: u32, expected_creation_time: u64) -> bool {
    if let Some(current_creation_time) = get_process_creation_time(pid) {
        current_creation_time == expected_creation_time
    } else {
        false
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
                log::debug!(
                    "Tytuł okna zawiera nieprawidłowe sekwencje UTF-16 (PID {}): {:?}",
                    pid,
                    s
                );
            }
            s
        } else {
            return None; // Brak tytułu = systemowe okno, ignorujemy
        };

        // Nazwa exe + path hint — z cache (z walidacją PID reuse) lub przez OpenProcess
        let now = Instant::now();
        let (exe_name, detected_path, activity_type) =
            if let Some((name, creation_time, cached_at, last_alive_check, cached_detected_path)) =
                pid_cache.get_mut(&pid)
            {
                // Re-walidacja PID ograniczona do 60s, aby zredukować koszt OpenProcess.
                if now.duration_since(*last_alive_check) < std::time::Duration::from_secs(60) {
                    *cached_at = now;
                    let activity_type = classify_activity_type(name);
                    (name.clone(), cached_detected_path.clone(), activity_type)
                } else if process_still_alive(pid, *creation_time) {
                    *cached_at = now;
                    *last_alive_check = now;
                    let activity_type = classify_activity_type(name);
                    (name.clone(), cached_detected_path.clone(), activity_type)
                } else {
                    pid_cache.remove(&pid);
                    let (name, new_creation_time) = get_exe_name_and_creation_time(pid)?;
                    let activity_type = classify_activity_type(&name);
                    let detected_path = detect_path_from_process(pid, activity_type.as_deref());
                    pid_cache.insert(
                        pid,
                        (
                            name.clone(),
                            new_creation_time,
                            now,
                            now,
                            detected_path.clone(),
                        ),
                    );
                    (name, detected_path, activity_type)
                }
            } else {
                let (name, creation_time) = get_exe_name_and_creation_time(pid)?;
                let activity_type = classify_activity_type(&name);
                let detected_path = detect_path_from_process(pid, activity_type.as_deref());
                pid_cache.insert(
                    pid,
                    (name.clone(), creation_time, now, now, detected_path.clone()),
                );
                (name, detected_path, activity_type)
            };

        Some(ProcessInfo {
            exe_name,
            pid,
            window_title,
            detected_path,
            activity_type,
        })
    }
}

/// Retrieves the exe name and process creation time from PID.
fn get_exe_name_and_creation_time(pid: u32) -> Option<(String, u64)> {
    use winapi::um::winbase::QueryFullProcessImageNameW;

    unsafe {
        let handle = OpenProcess(winapi::um::winnt::PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);

        if handle.is_null() {
            log::warn!(
                "OpenProcess error for PID {}: {}",
                pid,
                winapi::um::errhandlingapi::GetLastError()
            );
            return None;
        }

        let mut buf = [0u16; 1024];
        let mut size = buf.len() as DWORD;
        let res = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);

        let mut creation: FILETIME = std::mem::zeroed();
        let mut exit: FILETIME = std::mem::zeroed();
        let mut kernel: FILETIME = std::mem::zeroed();
        let mut user: FILETIME = std::mem::zeroed();
        let times_ok = GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user);

        CloseHandle(handle);

        if res == 0 || times_ok == 0 {
            log::warn!(
                "QueryFullProcessImageNameW or GetProcessTimes error for PID {}: {}",
                pid,
                winapi::um::errhandlingapi::GetLastError()
            );
            return None;
        }

        let full_path = String::from_utf16_lossy(&buf[..size as usize]);
        let exe_name = full_path
            .rsplit('\\')
            .next()
            .unwrap_or(&full_path)
            .to_lowercase();

        let creation_time = filetime_to_u64(&creation);

        Some((exe_name, creation_time))
    }
}

fn should_detect_path_for_activity(activity_type: Option<&str>) -> bool {
    matches!(activity_type, Some("coding") | Some("design"))
}

fn detect_path_from_process(pid: u32, activity_type: Option<&str>) -> Option<String> {
    if !should_detect_path_for_activity(activity_type) {
        return None;
    }
    let command_line = get_process_command_line_wmi(pid)?;
    extract_path_from_command_line(&command_line)
}

fn get_process_command_line_wmi(pid: u32) -> Option<String> {
    #[derive(serde::Deserialize, Debug)]
    struct Win32ProcessCommandLineRow {
        #[serde(rename = "CommandLine")]
        command_line: Option<String>,
    }

    let query = format!(
        "SELECT CommandLine FROM Win32_Process WHERE ProcessId = {}",
        pid
    );
    WMI_CONN_CACHE.with(|cache| {
        let mut cached_conn = cache.borrow_mut();
        if cached_conn.is_none() {
            let com = wmi::COMLibrary::new().ok()?;
            let conn = wmi::WMIConnection::new(com.into()).ok()?;
            *cached_conn = Some(conn);
        }

        let query_result: Result<Vec<Win32ProcessCommandLineRow>, _> = {
            let conn = cached_conn.as_ref()?;
            conn.raw_query(&query)
        };

        match query_result {
            Ok(mut rows) => rows.pop()?.command_line,
            Err(_) => {
                // Reset cached connection; next call will reinitialize COM/WMI.
                *cached_conn = None;
                None
            }
        }
    })
}

fn split_command_line_tokens(command_line: &str) -> Vec<String> {
    if let Some(tokens) = split_command_line_tokens_winapi(command_line) {
        return tokens;
    }
    split_command_line_tokens_fallback(command_line)
}

fn split_command_line_tokens_winapi(command_line: &str) -> Option<Vec<String>> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::shellapi::CommandLineToArgvW;
    use winapi::um::winbase::LocalFree;

    unsafe {
        let wide: Vec<u16> = OsStr::new(command_line)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut argc: i32 = 0;
        let argv = CommandLineToArgvW(wide.as_ptr(), &mut argc);
        if argv.is_null() || argc <= 0 {
            if !argv.is_null() {
                LocalFree(argv as *mut _);
            }
            return None;
        }

        let mut tokens = Vec::with_capacity(argc as usize);
        for i in 0..argc {
            let arg_ptr = *argv.add(i as usize);
            if arg_ptr.is_null() {
                continue;
            }
            let mut len = 0usize;
            while *arg_ptr.add(len) != 0 {
                len += 1;
            }
            tokens.push(String::from_utf16_lossy(std::slice::from_raw_parts(
                arg_ptr, len,
            )));
        }
        LocalFree(argv as *mut _);
        Some(tokens)
    }
}

fn split_command_line_tokens_fallback(command_line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;

    for ch in command_line.chars() {
        match ch {
            '"' => {
                in_quotes = !in_quotes;
            }
            c if c.is_whitespace() && !in_quotes => {
                if !current.is_empty() {
                    tokens.push(current.clone());
                    current.clear();
                }
            }
            _ => current.push(ch),
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

fn normalize_path_candidate(raw: &str) -> Option<String> {
    let token = raw.trim().trim_matches('"').trim();
    if token.is_empty() {
        return None;
    }
    if token.starts_with("http://")
        || token.starts_with("https://")
        || token.starts_with("vscode://")
        || token.starts_with("mailto:")
    {
        return None;
    }
    let candidate = token
        .trim_end_matches(',')
        .trim_end_matches(';')
        .trim_end_matches('"')
        .trim();
    if candidate.is_empty() {
        return None;
    }

    let looks_like_abs_drive = candidate.len() >= 3
        && candidate.as_bytes()[1] == b':'
        && matches!(candidate.as_bytes()[2], b'\\' | b'/');
    let looks_like_unc = candidate.starts_with("\\\\") || candidate.starts_with("//");
    let looks_like_relative = candidate.starts_with(".\\")
        || candidate.starts_with("./")
        || candidate.starts_with("..\\")
        || candidate.starts_with("../");

    if !(looks_like_abs_drive || looks_like_unc || looks_like_relative) {
        return None;
    }

    let lower = candidate.to_lowercase();
    if lower.ends_with(".exe")
        || lower.ends_with(".dll")
        || lower.ends_with(".lnk")
        || lower.ends_with(".tmp")
    {
        return None;
    }

    Some(candidate.to_string())
}

fn is_probably_file_path(path: &str) -> bool {
    let extension = std::path::Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase());
    let Some(ext) = extension else {
        return false;
    };
    !matches!(ext.as_str(), "cache" | "log" | "ini" | "json")
}

fn extract_path_from_command_line(command_line: &str) -> Option<String> {
    let tokens = split_command_line_tokens(command_line);
    if tokens.len() <= 1 {
        return None;
    }

    let mut fallback_path: Option<String> = None;
    for token in tokens.iter().skip(1) {
        if token.starts_with('-') && !token.contains(':') {
            continue;
        }

        let direct_candidate = normalize_path_candidate(token);
        let eq_candidate = token
            .split_once('=')
            .and_then(|(_, rhs)| normalize_path_candidate(rhs));
        let candidate = direct_candidate.or(eq_candidate);
        let Some(path) = candidate else {
            continue;
        };

        if is_probably_file_path(&path) {
            return Some(path);
        }
        if fallback_path.is_none() {
            fallback_path = Some(path);
        }
    }

    fallback_path
}

/// Lightweight app category used by the tracker to tag file activities.
pub fn classify_activity_type(exe_name: &str) -> Option<String> {
    let exe = exe_name.to_lowercase();

    if matches!(
        exe.as_str(),
        "code.exe"
            | "code-insiders.exe"
            | "cursor.exe"
            | "idea64.exe"
            | "pycharm64.exe"
            | "webstorm64.exe"
            | "clion64.exe"
            | "rider64.exe"
            | "devenv.exe"
            | "notepad++.exe"
            | "vim.exe"
            | "nvim.exe"
    ) {
        return Some("coding".to_string());
    }

    if matches!(
        exe.as_str(),
        "chrome.exe"
            | "msedge.exe"
            | "firefox.exe"
            | "brave.exe"
            | "opera.exe"
            | "opera_gx.exe"
            | "vivaldi.exe"
            | "arc.exe"
    ) {
        return Some("browsing".to_string());
    }

    if matches!(
        exe.as_str(),
        "figma.exe"
            | "photoshop.exe"
            | "illustrator.exe"
            | "blender.exe"
            | "gimp-2.10.exe"
            | "inkscape.exe"
            | "adobexd.exe"
    ) {
        return Some("design".to_string());
    }

    None
}

/// Ewiktuje wpisy cache starsze niż `max_age` (zamiast czyścić wszystko).
/// Zmniejsza serię wywołań OpenProcess po wyczyszczeniu.
pub fn evict_old_pid_cache(pid_cache: &mut PidCache, max_age: std::time::Duration) {
    let now = Instant::now();
    pid_cache.retain(|_, (_, _, ts, _, _)| now.duration_since(*ts) < max_age);
}

/// Parsuje tytuł okna i wyciąga nazwę pliku/projektu.
/// Heurystyka: bierze pierwszą część przed separatorem (` - `, ` — `, ` | `).
/// Przykłady:
///   "main.rs - timeflow_demon - Visual Studio Code" → "main.rs - timeflow_demon"
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
    // "main.rs - timeflow_demon - Visual Studio Code" → "main.rs - timeflow_demon"
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

// ── Idle detection ────────────────────────────────────────────

/// Zwraca czas bezczynności użytkownika (brak klawiatury/myszy) w milisekundach.
/// Używa WinAPI `GetLastInputInfo`.
pub fn get_idle_time_ms() -> u64 {
    use winapi::um::sysinfoapi::GetTickCount64;
    use winapi::um::winuser::{GetLastInputInfo, LASTINPUTINFO};

    unsafe {
        let mut lii: LASTINPUTINFO = std::mem::zeroed();
        lii.cbSize = std::mem::size_of::<LASTINPUTINFO>() as u32;

        if GetLastInputInfo(&mut lii) == 0 {
            return 0; // Fallback: zakładaj aktywność
        }

        let now = GetTickCount64();
        now.saturating_sub(u64::from(lii.dwTime))
    }
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

                let name_len = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
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

/// Recursively collects all descendant PIDs.
fn collect_descendants(
    tree: &HashMap<u32, Vec<u32>>,
    root: u32,
    result: &mut Vec<u32>,
    visited: &mut std::collections::HashSet<u32>,
) {
    if !visited.insert(root) {
        return; // Cycle detected or already visited
    }
    if let Some(children) = tree.get(&root) {
        for &child in children {
            result.push(child);
            collect_descendants(tree, child, result, visited);
        }
    }
}

/// Pobiera sumaryczny czas CPU (kernel + user) dla zbioru PIDów.
/// Zwraca sumę w 100-ns jednostkach.
fn sum_cpu_times(pids: &[u32]) -> u64 {
    let mut total: u64 = 0;
    unsafe {
        for &pid in pids {
            let handle = OpenProcess(winapi::um::winnt::PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
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
    let root_pids = proc_snap
        .exe_pids
        .get(exe_name)
        .cloned()
        .unwrap_or_default();

    let mut all_pids = root_pids.clone();
    let mut visited = std::collections::HashSet::new();
    for &root in &root_pids {
        visited.insert(root);
    }
    for &root in &root_pids {
        if let Some(children) = proc_snap.tree.get(&root) {
            for &child in children {
                all_pids.push(child);
                collect_descendants(&proc_snap.tree, child, &mut all_pids, &mut visited);
            }
        }
    }
    all_pids.sort_unstable();
    all_pids.dedup();

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
    use super::{classify_activity_type, extract_file_from_title, extract_path_from_command_line};

    #[test]
    fn extract_file_single_separator() {
        assert_eq!(
            extract_file_from_title("main.rs - timeflow_demon - Visual Studio Code"),
            "main.rs - timeflow_demon"
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
        assert_eq!(extract_file_from_title("file.py | VS Code"), "file.py");
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
        assert_eq!(extract_file_from_title("dokument — Edytor"), "dokument");
    }

    #[test]
    fn extracts_detected_path_from_command_line() {
        let cmd = r#""C:\Users\me\AppData\Local\Programs\Microsoft VS Code\Code.exe" "C:\work\timeflow\src\main.rs""#;
        assert_eq!(
            extract_path_from_command_line(cmd).as_deref(),
            Some(r"C:\work\timeflow\src\main.rs")
        );
    }

    #[test]
    fn classify_activity_type_for_known_apps() {
        assert_eq!(
            classify_activity_type("code.exe").as_deref(),
            Some("coding")
        );
        assert_eq!(
            classify_activity_type("chrome.exe").as_deref(),
            Some("browsing")
        );
        assert_eq!(
            classify_activity_type("blender.exe").as_deref(),
            Some("design")
        );
        assert_eq!(classify_activity_type("unknown.exe"), None);
    }
}
