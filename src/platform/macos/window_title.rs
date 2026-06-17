use core_foundation::base::{CFType, TCFType};
use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_graphics::window::{
    copy_window_info, kCGNullWindowID, kCGWindowListExcludeDesktopElements,
    kCGWindowListOptionOnScreenOnly, kCGWindowName, kCGWindowOwnerPID,
};

pub fn frontmost_window_title(pid: i32) -> Option<String> {
    let windows = copy_window_info(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID,
    )?;

    for raw_window in windows.get_all_values() {
        let window = unsafe {
            CFDictionary::<CFString, CFType>::wrap_under_get_rule(raw_window as CFDictionaryRef)
        };

        if window_owner_pid(&window) != Some(pid) {
            continue;
        }

        if let Some(title) = window_title(&window) {
            return Some(title);
        }
    }

    None
}

fn window_owner_pid(window: &CFDictionary<CFString, CFType>) -> Option<i32> {
    let owner_pid = window.find(unsafe { kCGWindowOwnerPID })?;
    owner_pid.downcast::<CFNumber>()?.to_i32()
}

fn window_title(window: &CFDictionary<CFString, CFType>) -> Option<String> {
    let title = window.find(unsafe { kCGWindowName })?;
    let title = title.downcast::<CFString>()?.to_string();
    let trimmed = title.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}
