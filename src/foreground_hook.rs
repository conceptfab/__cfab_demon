// Event-driven foreground window detection via SetWinEventHook.
// Runs a dedicated thread with a Windows message pump.
// Signals the tracker thread immediately on foreground window change
// so it can react faster than the default polling interval.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use winapi::shared::minwindef::DWORD;
use winapi::shared::ntdef::LONG;
use winapi::shared::windef::{HWINEVENTHOOK, HWND};
use winapi::um::winuser::{
    DispatchMessageW, MsgWaitForMultipleObjects, PeekMessageW, SetWinEventHook, TranslateMessage,
    UnhookWinEvent, MSG, PM_REMOVE, QS_ALLEVENTS,
};

const EVENT_SYSTEM_FOREGROUND: DWORD = 0x0003;
const WINEVENT_OUTOFCONTEXT: DWORD = 0x0000;

/// Shared signal between the hook thread and the tracker.
/// Notified when a foreground window change is detected via SetWinEventHook.
pub struct ForegroundSignal {
    mutex: Mutex<bool>,
    condvar: Condvar,
    /// Timestamps of foreground switch events (consumed by tracker each tick).
    switch_times: Mutex<VecDeque<Instant>>,
}

impl ForegroundSignal {
    fn new() -> Self {
        Self {
            mutex: Mutex::new(false),
            condvar: Condvar::new(),
            switch_times: Mutex::new(VecDeque::new()),
        }
    }

    /// Signal a foreground change and record the instant.
    pub fn notify(&self) {
        {
            let mut times = self.switch_times.lock().unwrap_or_else(|p| p.into_inner());
            // Cap at 50 to prevent unbounded growth if tracker is slow
            if times.len() < 50 {
                times.push_back(Instant::now());
            }
        }
        let mut changed = self.mutex.lock().unwrap_or_else(|p| p.into_inner());
        *changed = true;
        self.condvar.notify_one();
    }

    /// Drain all recorded switch timestamps since last call.
    pub fn drain_switch_times(&self) -> Vec<Instant> {
        self.switch_times
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .drain(..)
            .collect()
    }

    /// Wait for a signal or timeout. Returns `true` if signaled (foreground changed).
    /// Resets the flag after waking.
    pub fn wait_timeout(&self, timeout: Duration) -> bool {
        let mut changed = self.mutex.lock().unwrap_or_else(|p| p.into_inner());
        if !*changed {
            let result = self
                .condvar
                .wait_timeout(changed, timeout)
                .unwrap_or_else(|p| p.into_inner());
            changed = result.0;
        }
        let was_signaled = *changed;
        *changed = false;
        was_signaled
    }
}

// The hook callback runs on the hook thread, so thread_local is safe here.
thread_local! {
    static HOOK_SIGNAL: std::cell::RefCell<Option<Arc<ForegroundSignal>>> =
        const { std::cell::RefCell::new(None) };
}

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
/// Returns the shared signal for the tracker and the thread handle.
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
                0, // all processes
                0, // all threads
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

        // Message pump — required for out-of-context hooks.
        // MsgWaitForMultipleObjects lets us check stop_signal every 1s
        // without busy-looping.
        unsafe {
            let mut msg: MSG = std::mem::zeroed();
            loop {
                if stop_signal.load(Ordering::Relaxed) {
                    break;
                }
                let wait_result = MsgWaitForMultipleObjects(0, std::ptr::null(), 0, 1_000, QS_ALLEVENTS);
                if wait_result == 0xFFFFFFFF {
                    // WAIT_FAILED
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
