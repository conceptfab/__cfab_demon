use std::collections::HashMap;
use std::time::{Duration, Instant};

use winapi::shared::minwindef::FILETIME;
use winapi::um::handleapi::CloseHandle;
use winapi::um::processthreadsapi::{GetProcessTimes, OpenProcess};

use crate::activity::ActivityType;

use super::{classify_activity_type, filetime_to_u64, get_exe_name_and_creation_time};

/// Cache PID -> metadata used for PID reuse validation and detected path hints.
#[derive(Debug, Clone)]
pub struct PidCacheEntry {
    pub exe_name: String,
    pub creation_time: u64,
    pub cached_at: Instant,
    pub last_alive_check: Instant,
    pub detected_path: Option<String>,
    pub activity_type: Option<ActivityType>,
    pub path_detection_attempted: bool,
}

pub type PidCache = HashMap<u32, PidCacheEntry>;

const PID_LIVENESS_REVALIDATION_INTERVAL: Duration = Duration::from_secs(180);

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

/// Checks if a process with a specific PID is still alive AND has the same creation time.
fn process_still_alive(pid: u32, expected_creation_time: u64) -> bool {
    if let Some(current_creation_time) = get_process_creation_time(pid) {
        current_creation_time == expected_creation_time
    } else {
        false
    }
}

pub(crate) fn ensure_pid_cache_entry(
    pid: u32,
    pid_cache: &mut PidCache,
    now: Instant,
) -> Option<()> {
    let mut needs_refresh = false;

    if let Some(entry) = pid_cache.get_mut(&pid) {
        if now.duration_since(entry.last_alive_check) >= PID_LIVENESS_REVALIDATION_INTERVAL {
            if process_still_alive(pid, entry.creation_time) {
                entry.last_alive_check = now;
            } else {
                needs_refresh = true;
            }
        }

        if !needs_refresh {
            entry.cached_at = now;
            return Some(());
        }
    }

    if needs_refresh {
        pid_cache.remove(&pid);
    }

    let (exe_name, creation_time) = get_exe_name_and_creation_time(pid)?;
    let activity_type = classify_activity_type(&exe_name);
    pid_cache.insert(
        pid,
        PidCacheEntry {
            exe_name,
            creation_time,
            cached_at: now,
            last_alive_check: now,
            detected_path: None,
            activity_type,
            path_detection_attempted: false,
        },
    );
    Some(())
}

/// Evicts cache entries older than `max_age` instead of clearing the whole map.
pub fn evict_old_pid_cache(pid_cache: &mut PidCache, max_age: std::time::Duration) {
    let now = Instant::now();
    pid_cache.retain(|_, entry| now.duration_since(entry.cached_at) < max_age);
}
