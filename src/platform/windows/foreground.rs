// Event-driven foreground window detection via SetWinEventHook (Windows).
// Runs a dedicated thread with a Windows message pump. Signals the tracker
// thread immediately on foreground window change so it can react faster
// than the default polling interval.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use winapi::shared::minwindef::DWORD;
use winapi::shared::ntdef::LONG;
use winapi::shared::windef::{HWINEVENTHOOK, HWND};
use winapi::um::winuser::{
    DispatchMessageW, MsgWaitForMultipleObjects, PeekMessageW, SetWinEventHook, TranslateMessage,
    UnhookWinEvent, MSG, PM_REMOVE, QS_ALLEVENTS,
};

use crate::platform::foreground_signal::ForegroundSignal;

const EVENT_SYSTEM_FOREGROUND: DWORD = 0x0003;
const WINEVENT_OUTOFCONTEXT: DWORD = 0x0000;

thread_local! {
    static HOOK_SIGNAL: std::cell::RefCell<Option<Arc<ForegroundSignal>>> =
        const { std::cell::RefCell::new(None) };
}

// SAFETY: The callback is invoked by SetWinEventHook on the same thread that
// installed the hook (message-pump thread). HOOK_SIGNAL is thread_local!, so
// the RefCell borrow is safe — no cross-thread access is possible.
unsafe extern "system" fn win_event_proc(
    _hook: HWINEVENTHOOK,
    _event: DWORD,
    _hwnd: HWND,
    _id_object: LONG,
    _id_child: LONG,
    _event_thread: DWORD,
    _event_time: DWORD,
) {
    HOOK_SIGNAL.with(|signal| {
        if let Some(ref s) = *signal.borrow() {
            s.notify();
        }
    });
}

/// Start the foreground hook thread.
pub fn start(stop_signal: Arc<AtomicBool>) -> (Arc<ForegroundSignal>, thread::JoinHandle<()>) {
    let signal = Arc::new(ForegroundSignal::new());
    let signal_clone = signal.clone();

    let handle = thread::spawn(move || {
        HOOK_SIGNAL.with(|s| {
            *s.borrow_mut() = Some(signal_clone);
        });

        let hook = unsafe {
            SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                std::ptr::null_mut(),
                Some(win_event_proc),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            )
        };

        if hook.is_null() {
            log::error!("SetWinEventHook failed — tracker will use polling only");
            while !stop_signal.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_secs(1));
            }
            return;
        }

        log::info!("Foreground hook installed (event-driven detection active)");

        unsafe {
            let mut msg: MSG = std::mem::zeroed();
            loop {
                if stop_signal.load(Ordering::Relaxed) {
                    break;
                }
                let wait_result =
                    MsgWaitForMultipleObjects(0, std::ptr::null(), 0, 1_000, QS_ALLEVENTS);
                if wait_result == 0xFFFFFFFF {
                    log::error!("MsgWaitForMultipleObjects failed (WAIT_FAILED)");
                }
                while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
            UnhookWinEvent(hook);
        }

        log::info!("Foreground hook uninstalled");
    });

    (signal, handle)
}
