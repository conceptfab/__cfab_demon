// Cross-platform ForegroundSignal. Mechanizm sygnalizacji zmiany okna
// pierwszoplanowego — używany przez trackera niezależnie od implementacji
// watchera platformowego.

use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

#[derive(Default)]
struct SwitchLog {
    /// Najnowszy znacznik przełączenia, jeszcze nieodebrany przez trackera.
    pending: Option<Instant>,
    /// Najnowszy zarejestrowany znacznik (nie jest czyszczony przy odbiorze) —
    /// służy do odsiewania duplikatów zgłaszanych przez fallback polling.
    last_recorded: Option<Instant>,
}

pub struct ForegroundSignal {
    mutex: Mutex<bool>,
    condvar: Condvar,
    switches: Mutex<SwitchLog>,
}

impl ForegroundSignal {
    pub fn new() -> Self {
        Self {
            mutex: Mutex::new(false),
            condvar: Condvar::new(),
            switches: Mutex::new(SwitchLog::default()),
        }
    }

    /// Notify foreground change and record the instant.
    pub fn notify(&self) {
        self.record_switch(Instant::now(), None);
        self.wake();
    }

    /// Wariant dla fallback pollingu: zawsze budzi trackera, ale znacznik
    /// zapisuje tylko, gdy w oknie `dedup_window` nie zarejestrowano innego
    /// przełączenia. Polling wykrywa zmianę z opóźnieniem (do interwału), więc
    /// gdy właściwe zdarzenie systemowe już ją zgłosiło, późniejszy znacznik
    /// przesunąłby punkt podziału ticku i przypisał czas poprzedniej aplikacji.
    pub fn notify_fallback(&self, dedup_window: Duration) {
        self.record_switch(Instant::now(), Some(dedup_window));
        self.wake();
    }

    fn record_switch(&self, now: Instant, dedup_window: Option<Duration>) {
        let mut log = self.switches.lock().unwrap_or_else(|p| p.into_inner());
        if let (Some(window), Some(last)) = (dedup_window, log.last_recorded) {
            if now.saturating_duration_since(last) <= window {
                return;
            }
        }
        log.pending = Some(now);
        log.last_recorded = Some(now);
    }

    fn wake(&self) {
        let mut changed = self.mutex.lock().unwrap_or_else(|p| p.into_inner());
        *changed = true;
        self.condvar.notify_one();
    }

    /// Zwraca najnowszy znacznik przełączenia od poprzedniego odbioru.
    pub fn take_last_switch_time(&self) -> Option<Instant> {
        let mut log = self.switches.lock().unwrap_or_else(|p| p.into_inner());
        log.pending.take()
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

#[cfg(test)]
mod tests {
    use super::ForegroundSignal;
    use std::time::{Duration, Instant};

    #[test]
    fn take_returns_latest_switch_and_clears() {
        let signal = ForegroundSignal::new();
        let t0 = Instant::now();
        signal.record_switch(t0, None);
        signal.record_switch(t0 + Duration::from_millis(10), None);
        assert_eq!(signal.take_last_switch_time(), Some(t0 + Duration::from_millis(10)));
        assert_eq!(signal.take_last_switch_time(), None);
    }

    #[test]
    fn fallback_duplicate_within_window_keeps_event_timestamp() {
        let signal = ForegroundSignal::new();
        let t0 = Instant::now();
        signal.record_switch(t0, None);
        // Polling wykrywa tę samą zmianę 1,5 s później — to duplikat.
        signal.record_switch(t0 + Duration::from_millis(1500), Some(Duration::from_secs(2)));
        assert_eq!(signal.take_last_switch_time(), Some(t0));
    }

    #[test]
    fn fallback_duplicate_is_ignored_even_after_tracker_took_event() {
        let signal = ForegroundSignal::new();
        let t0 = Instant::now();
        signal.record_switch(t0, None);
        assert_eq!(signal.take_last_switch_time(), Some(t0));
        signal.record_switch(t0 + Duration::from_millis(800), Some(Duration::from_secs(2)));
        assert_eq!(signal.take_last_switch_time(), None);
    }

    #[test]
    fn fallback_records_when_no_recent_event() {
        let signal = ForegroundSignal::new();
        let t0 = Instant::now();
        signal.record_switch(t0, None);
        let late = t0 + Duration::from_secs(5);
        signal.record_switch(late, Some(Duration::from_secs(2)));
        assert_eq!(signal.take_last_switch_time(), Some(late));

        let fresh = ForegroundSignal::new();
        fresh.record_switch(t0, Some(Duration::from_secs(2)));
        assert_eq!(fresh.take_last_switch_time(), Some(t0));
    }

    #[test]
    fn notify_wakes_waiter() {
        let signal = ForegroundSignal::new();
        signal.notify();
        assert!(signal.wait_timeout(Duration::from_millis(1)));
        assert!(!signal.wait_timeout(Duration::from_millis(1)));
    }
}
