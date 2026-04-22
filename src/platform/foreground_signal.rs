// Cross-platform ForegroundSignal. Mechanizm sygnalizacji zmiany okna
// pierwszoplanowego — używany przez trackera niezależnie od implementacji
// watchera platformowego.

use std::collections::VecDeque;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

pub struct ForegroundSignal {
    mutex: Mutex<bool>,
    condvar: Condvar,
    switch_times: Mutex<VecDeque<Instant>>,
}

impl ForegroundSignal {
    pub fn new() -> Self {
        Self {
            mutex: Mutex::new(false),
            condvar: Condvar::new(),
            switch_times: Mutex::new(VecDeque::new()),
        }
    }

    /// Notify foreground change and record the instant.
    pub fn notify(&self) {
        {
            let mut times = self.switch_times.lock().unwrap_or_else(|p| p.into_inner());
            if times.len() < 50 {
                times.push_back(Instant::now());
            }
        }
        let mut changed = self.mutex.lock().unwrap_or_else(|p| p.into_inner());
        *changed = true;
        self.condvar.notify_one();
    }

    pub fn drain_switch_times(&self) -> Vec<Instant> {
        self.switch_times
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .drain(..)
            .collect()
    }

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

impl Default for ForegroundSignal {
    fn default() -> Self {
        Self::new()
    }
}
