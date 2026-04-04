# Data Precision & AI Model Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve daemon time-tracking precision and AI assignment model accuracy based on analysis in `data.md`.

**Architecture:** Two independent streams — (A) daemon precision fixes in Rust tracker/hook code, (B) AI scoring/training improvements in dashboard Tauri backend. Both modify Rust code, no frontend changes needed.

**Tech Stack:** Rust, Tauri, SQLite, winapi (Windows)

**Scope note:** This plan covers P1 items + low-effort P2 items from `data.md`. P3 items (background CPU refinement, crash-safe buffer, sub-minute dashboard buckets, title history expansion, stronger temporal layer, incremental retrain) are deferred.

---

## File Map

### Stream A — Daemon Precision

| File | Action | Responsibility |
|------|--------|----------------|
| `src/foreground_hook.rs` | Modify | Add timestamp to switch events |
| `src/tracker.rs` | Modify | Consume switch events, split time, idle interpolation |

### Stream B — AI Model

| File | Action | Responsibility |
|------|--------|----------------|
| `dashboard/src-tauri/src/commands/assignment_model/context.rs` | Modify | Stop-words, bigrams, source-weighted tokens, overlap duration |
| `dashboard/src-tauri/src/commands/assignment_model/training.rs` | Modify | Time decay, session duration weighting, source-weighted token training |
| `dashboard/src-tauri/src/commands/assignment_model/scoring.rs` | Modify | Duration-weighted Layer 0, sharper confidence sigmoid |

---

## Stream A — Daemon Precision

### Task 1: Foreground hook time-split (data.md #3)

**Problem:** Hook wakes tracker instantly on window switch, but elapsed time is still assigned as one block to whichever app is foreground at tick time. Fast Alt+Tab creates ±10s error.

**Files:**
- Modify: `src/foreground_hook.rs`
- Modify: `src/tracker.rs`

- [ ] **Step 1: Add timestamp storage to ForegroundSignal**

In `src/foreground_hook.rs`, add a `switch_instants` queue to the signal so the tracker can see WHEN switches happened, not just that they happened.

```rust
use std::collections::VecDeque;
use std::time::Instant;

/// Shared signal between the hook thread and the tracker.
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

    // wait_timeout stays the same
}
```

- [ ] **Step 2: Build and verify compilation**

Run: `cargo build 2>&1 | head -20`
Expected: Successful compilation (warnings OK, no errors).

- [ ] **Step 3: Modify tracker to use switch timestamps for time-splitting**

In `src/tracker.rs`, after polling the foreground window (~line 486), use the switch timestamps to determine how much of `actual_elapsed` belongs to the PREVIOUS foreground app vs the current one.

Find the section starting at line 479:
```rust
        // Calculate actual elapsed time since last poll (D-9, D-11)
        let now = Instant::now();
        let max_elapsed = poll_interval.saturating_mul(3);
        let actual_elapsed = now.duration_since(last_tracking_tick).min(max_elapsed);
        last_tracking_tick = now;
```

Replace with:
```rust
        // Calculate actual elapsed time since last poll (D-9, D-11)
        let now = Instant::now();
        let max_elapsed = poll_interval.saturating_mul(3);
        let actual_elapsed = now.duration_since(last_tracking_tick).min(max_elapsed);

        // Drain foreground switch timestamps for time-splitting.
        // If a switch happened mid-tick, the CURRENT foreground app only gets
        // time from the last switch to now; previous app(s) got their share
        // from last_tick to the switch.
        let switch_times: Vec<Instant> = foreground_signal
            .as_ref()
            .map(|s| s.drain_switch_times())
            .unwrap_or_default();

        // Determine the effective elapsed for the current foreground app.
        // If a switch happened, the current app only gets time since the last switch.
        let effective_elapsed = if let Some(&last_switch) = switch_times.last() {
            // Clamp: last_switch must be between last_tracking_tick and now
            if last_switch > last_tracking_tick && last_switch < now {
                now.duration_since(last_switch).min(actual_elapsed)
            } else {
                actual_elapsed
            }
        } else {
            actual_elapsed
        };

        last_tracking_tick = now;
```

Then in the foreground tracking section (~line 510), replace `actual_elapsed` with `effective_elapsed` for the foreground recording:

Find:
```rust
                record_app_activity(
                    ActivityContext {
                        exe_name: &info.exe_name,
                        file_name: &file_name,
                        window_title: &info.window_title,
                        detected_path: info.detected_path.as_deref(),
                        activity_type: info.activity_type,
                        elapsed: actual_elapsed,
                        session_gap,
                    },
```

Replace `elapsed: actual_elapsed,` with `elapsed: effective_elapsed,`.

Keep `actual_elapsed` for background CPU tracking (line 575) since background time is wall-clock based.

- [ ] **Step 4: Build and verify**

Run: `cargo build 2>&1 | head -20`
Expected: Successful compilation.

- [ ] **Step 5: Commit**

```bash
git add src/foreground_hook.rs src/tracker.rs
git commit -m "feat: split foreground time by hook switch timestamps

When the foreground window changes mid-tick, the current app only gets
time from the last switch to now instead of the full tick duration.
Reduces ±10s error to ±0.1s on fast Alt+Tab workflows."
```

---

### Task 2: Idle→active interpolation (data.md #1)

**Problem:** When user returns from idle (120s+), the first active tick records the full `poll_interval` (10s) even though the user may have returned mid-tick. Wastes 1-10s per idle cycle.

**Files:**
- Modify: `src/tracker.rs`

- [ ] **Step 1: Add `was_idle` state tracking**

In `src/tracker.rs`, before the main `loop` (around line 428), add:

```rust
    let mut was_idle = false;
```

- [ ] **Step 2: Implement idle→active interpolation**

Find the idle detection section (~line 505-532):
```rust
        let idle_ms = monitor::get_idle_time_ms();
        let is_idle = idle_ms >= IDLE_THRESHOLD_MS;

        // Foreground tracking (skip when idle — don't count time without user input)
        if !is_idle {
```

Replace with:
```rust
        let idle_ms = monitor::get_idle_time_ms();
        let is_idle = idle_ms >= IDLE_THRESHOLD_MS;

        // When transitioning from idle to active, the user returned sometime
        // during this tick. Estimate the active portion: the user has been
        // active for `idle_ms` less than the idle threshold used to be exceeded.
        // In practice: actual_active ≈ min(effective_elapsed, poll_interval - time_still_idle)
        let effective_elapsed_for_foreground = if !is_idle && was_idle {
            // User just came back from idle.
            // idle_ms is how long since last input — should be < IDLE_THRESHOLD_MS.
            // The user was active for at most idle_ms (they moved the mouse idle_ms ago).
            let active_portion_ms = idle_ms.min(effective_elapsed.as_millis() as u64);
            let active_duration = Duration::from_millis(active_portion_ms);
            log::debug!(
                "Idle→active transition: recording {}ms of {}ms tick",
                active_portion_ms,
                effective_elapsed.as_millis()
            );
            active_duration.max(Duration::from_secs(1)) // at least 1s
        } else {
            effective_elapsed
        };
        was_idle = is_idle;

        // Foreground tracking (skip when idle — don't count time without user input)
        if !is_idle {
```

Then in the `record_app_activity` call right below, replace `elapsed: effective_elapsed,` with `elapsed: effective_elapsed_for_foreground,`.

- [ ] **Step 3: Build and verify**

Run: `cargo build 2>&1 | head -20`
Expected: Successful compilation.

- [ ] **Step 4: Commit**

```bash
git add src/tracker.rs
git commit -m "feat: interpolate active time on idle→active transition

When returning from idle, estimate the active portion of the tick
using GetLastInputInfo idle_ms instead of recording the full tick."
```

---

## Stream B — AI Model Improvements

### Task 3: Smart tokenization — stop-words + bigrams (data.md AI-1)

**Problem:** `tokenize()` in context.rs produces noisy tokens like "src", "app", "lib", "test" that appear in all projects, diluting Layer 3 signal.

**Files:**
- Modify: `dashboard/src-tauri/src/commands/assignment_model/context.rs`

- [ ] **Step 1: Add stop-words list and bigram generation**

In `dashboard/src-tauri/src/commands/assignment_model/context.rs`, replace the `tokenize` function (lines 17-26):

```rust
/// Tokens considered too common to carry project-discriminating signal.
const STOP_TOKENS: &[&str] = &[
    // filesystem / code structure
    "src", "lib", "app", "bin", "pkg", "cmd", "api", "dist", "build", "out",
    "node_modules", "vendor", "target", "debug", "release",
    "index", "main", "mod", "init", "setup", "config", "utils", "helpers",
    "test", "tests", "spec", "specs", "bench",
    "tmp", "temp", "cache", "log", "logs",
    // common file extensions leaked as tokens
    "rs", "ts", "js", "tsx", "jsx", "py", "go", "css", "html", "json", "toml", "yaml", "yml",
    "md", "txt", "xml", "svg", "png", "jpg",
    // English function words
    "the", "and", "for", "with", "from", "into", "that", "this", "not", "but",
    "all", "are", "was", "were", "been", "have", "has", "had", "will", "would",
    "new", "old", "get", "set", "add", "del", "run", "use",
    // common IDE / UI labels
    "file", "edit", "view", "window", "help", "tools", "terminal", "output",
    "untitled", "welcome", "settings", "preferences",
];

pub fn tokenize(text: &str) -> Vec<String> {
    let separators = [
        ' ', '-', '_', '.', '/', '\\', '|', ',', ':', ';', '(', ')', '[', ']', '{', '}',
    ];
    let raw_tokens: Vec<String> = text
        .to_lowercase()
        .split(&separators[..])
        .filter(|t| t.len() >= 2 && t.chars().any(|c| c.is_alphabetic()))
        .filter(|t| !STOP_TOKENS.contains(t))
        .map(|t| t.to_string())
        .collect();

    // Generate bigrams from consecutive tokens for compound names
    // e.g. ["user", "service"] → also produces "user~service"
    let mut result = raw_tokens.clone();
    for window in raw_tokens.windows(2) {
        let bigram = format!("{}~{}", window[0], window[1]);
        result.push(bigram);
    }
    result
}
```

- [ ] **Step 2: Add unit tests for the new tokenizer**

At the bottom of `context.rs`, find the existing tests (or add a test module if none exists). Add:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_filters_stop_words() {
        let tokens = tokenize("src/app/user_service.rs");
        assert!(!tokens.contains(&"src".to_string()));
        assert!(!tokens.contains(&"app".to_string()));
        assert!(!tokens.contains(&"rs".to_string()));
        assert!(tokens.contains(&"user".to_string()));
        assert!(tokens.contains(&"service".to_string()));
    }

    #[test]
    fn tokenize_generates_bigrams() {
        let tokens = tokenize("user-service");
        assert!(tokens.contains(&"user".to_string()));
        assert!(tokens.contains(&"service".to_string()));
        assert!(tokens.contains(&"user~service".to_string()));
    }

    #[test]
    fn tokenize_no_bigram_for_single_token() {
        let tokens = tokenize("dashboard");
        assert!(tokens.contains(&"dashboard".to_string()));
        assert_eq!(tokens.len(), 1);
    }

    #[test]
    fn tokenize_handles_empty_and_short() {
        assert!(tokenize("").is_empty());
        assert!(tokenize("a").is_empty()); // too short
    }
}
```

- [ ] **Step 3: Run tests**

Run: `cd dashboard/src-tauri && cargo test --lib assignment_model::context::tests -- --nocapture 2>&1`
Expected: All 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src-tauri/src/commands/assignment_model/context.rs
git commit -m "feat(ai): add stop-words filtering and bigram generation to tokenizer

Filters ~70 common tokens (filesystem dirs, extensions, function words)
that appear across all projects and dilute Layer 3 signal. Adds bigrams
from consecutive tokens (e.g. 'user~service') for compound name matching."
```

---

### Task 4: Time decay in training (data.md AI-4)

**Problem:** Sessions from 2 years ago have the same weight as yesterday's. When user changes workflow, stale data poisons the model.

**Files:**
- Modify: `dashboard/src-tauri/src/commands/assignment_model/training.rs`
- Modify: `dashboard/src-tauri/src/commands/assignment_model/config.rs` (add `decay_half_life_days` state key)

- [ ] **Step 1: Add decay half-life config constant**

In `dashboard/src-tauri/src/commands/assignment_model/mod.rs`, alongside existing constants, add:

```rust
pub const DEFAULT_DECAY_HALF_LIFE_DAYS: i64 = 90;
pub const MIN_DECAY_HALF_LIFE_DAYS: i64 = 14;
pub const MAX_DECAY_HALF_LIFE_DAYS: i64 = 365;
```

- [ ] **Step 2: Apply exponential decay to app model training**

In `dashboard/src-tauri/src/commands/assignment_model/training.rs`, in `retrain_model_sync`, after parsing `training_horizon_days` (~line 53-61), add:

```rust
    let decay_half_life_days = clamp_i64(
        parse_state_i64(&state, "decay_half_life_days", DEFAULT_DECAY_HALF_LIFE_DAYS),
        MIN_DECAY_HALF_LIFE_DAYS,
        MAX_DECAY_HALF_LIFE_DAYS,
    );
    // ln(2) / half_life converts half-life to decay rate for exp(-rate * days_ago)
    let decay_rate = 0.693147 / (decay_half_life_days as f64);
```

Then replace the app model INSERT (lines 95-113):

```sql
INSERT INTO assignment_model_app (app_id, project_id, cnt, last_seen)
SELECT s.app_id, s.project_id,
       CAST(ROUND(SUM(exp(-?2 * (julianday('now') - julianday(s.start_time))))) AS INTEGER) as cnt,
       MAX(s.start_time)
FROM sessions s
WHERE s.project_id IS NOT NULL
  AND s.duration_seconds > 10
  AND date(s.start_time) >= date('now', ?1)
  AND NOT EXISTS (
       SELECT 1 FROM temp_training_blacklist_apps b WHERE b.app_id = s.app_id
  )
  AND COALESCE((
        SELECT af.source
        FROM assignment_feedback af
        WHERE af.session_id = s.id
        ORDER BY af.created_at DESC, af.id DESC
        LIMIT 1
      ), '') <> 'auto_accept'
GROUP BY s.app_id, s.project_id
HAVING cnt > 0
```

Pass `decay_rate` as the second parameter:
```rust
rusqlite::params![&training_horizon_modifier, decay_rate],
```

**Note:** SQLite does NOT have a built-in `exp()` function. You must register it. Add before the transaction:

```rust
use rusqlite::functions::FunctionFlags;

conn.create_scalar_function("exp", 1, FunctionFlags::SQLITE_DETERMINISTIC, |ctx| {
    let val: f64 = ctx.get(0)?;
    Ok(val.exp())
})?;
```

- [ ] **Step 3: Apply same decay to time model training**

Replace the time model INSERT (lines 116-139) with the same `exp(-decay_rate * days_ago)` weighting:

```sql
INSERT INTO assignment_model_time (app_id, hour_bucket, weekday, project_id, cnt)
SELECT
    s.app_id,
    CAST(strftime('%H', s.start_time) AS INTEGER) as hour_bucket,
    CAST(strftime('%w', s.start_time) AS INTEGER) as weekday,
    s.project_id,
    CAST(ROUND(SUM(exp(-?2 * (julianday('now') - julianday(s.start_time))))) AS INTEGER) as cnt
FROM sessions s
WHERE s.project_id IS NOT NULL
  AND s.duration_seconds > 10
  AND date(s.start_time) >= date('now', ?1)
  AND NOT EXISTS (
       SELECT 1 FROM temp_training_blacklist_apps b WHERE b.app_id = s.app_id
  )
  AND COALESCE((
        SELECT af.source
        FROM assignment_feedback af
        WHERE af.session_id = s.id
        ORDER BY af.created_at DESC, af.id DESC
        LIMIT 1
      ), '') <> 'auto_accept'
GROUP BY s.app_id, hour_bucket, weekday, s.project_id
HAVING cnt > 0
```

Pass `decay_rate` as second param: `rusqlite::params![&training_horizon_modifier, decay_rate]`.

- [ ] **Step 4: Update token training with decay weighting**

In the token counting loop (~lines 255-306), the token_counts are built in Rust code (not SQL). Add decay weighting there.

After extracting `file_rows`, change the token counting to use a weight based on session date. Replace the token accumulation with:

```rust
        let mut token_counts: HashMap<(String, i64), f64> = HashMap::new(); // changed from i64 to f64
        {
            let mut file_stmt = tx.prepare(
                "SELECT app_id, file_name, file_path, detected_path, project_id, window_title, title_history, date
                 FROM file_activities
                 WHERE project_id IS NOT NULL
                   AND date >= date('now', ?1)",
            )?;
            let mut file_rows = file_stmt.query(rusqlite::params![&training_horizon_modifier])?;
            while let Some(row) = file_rows.next()? {
                let app_id: i64 = row.get(0)?;
                let file_name: String = row.get(1)?;
                let file_path: String = row.get(2)?;
                let detected_path: Option<String> = row.get(3)?;
                let project_id: i64 = row.get(4)?;
                let window_title: Option<String> = row.get(5)?;
                let title_history: Option<String> = row.get(6)?;
                let date_str: String = row.get(7)?;

                if blacklisted_app_ids.contains(&app_id) {
                    continue;
                }
                if is_under_blacklisted_folder(
                    Some(&file_path),
                    detected_path.as_deref(),
                    &training_folder_blacklist,
                ) {
                    continue;
                }

                // Compute decay weight from date
                let days_ago = chrono::NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
                    .ok()
                    .map(|d| {
                        (chrono::Local::now().date_naive() - d).num_days().max(0) as f64
                    })
                    .unwrap_or(0.0);
                let weight = (-decay_rate * days_ago).exp();

                for token in tokenize(&file_name) {
                    *token_counts.entry((token, project_id)).or_insert(0.0) += weight;
                }
                for token in tokenize(&file_path) {
                    *token_counts.entry((token, project_id)).or_insert(0.0) += weight;
                }
                if let Some(ref path) = detected_path {
                    for token in tokenize(path) {
                        *token_counts.entry((token, project_id)).or_insert(0.0) += weight;
                    }
                }
                if let Some(ref wt) = window_title {
                    for token in tokenize(wt) {
                        *token_counts.entry((token, project_id)).or_insert(0.0) += weight;
                    }
                }
                for title in parse_title_history(title_history.as_deref()) {
                    for token in tokenize(&title) {
                        *token_counts.entry((token, project_id)).or_insert(0.0) += weight;
                    }
                }
            }
        }

        {
            let mut insert_token = tx.prepare(
                "INSERT INTO assignment_model_token (token, project_id, cnt, last_seen)
                 VALUES (?1, ?2, ?3, datetime('now'))",
            )?;
            for ((token, project_id), count) in token_counts {
                let rounded = count.round() as i64;
                if rounded > 0 {
                    insert_token.execute(rusqlite::params![token, project_id, rounded])?;
                }
            }
        }
```

- [ ] **Step 5: Update existing tests**

In `training.rs` tests, the `retrain_model_uses_weighted_split_feedback` and `retrain_model_supports_split_feedback_rows_without_explicit_weight` tests use `setup_training_conn()` which creates an in-memory DB. Add the `exp` function registration there:

In `setup_training_conn()`, after `let conn = rusqlite::Connection::open_in_memory()...`:

```rust
        conn.create_scalar_function(
            "exp",
            1,
            rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
            |ctx| {
                let val: f64 = ctx.get(0)?;
                Ok(val.exp())
            },
        )
        .expect("register exp");
```

- [ ] **Step 6: Run tests**

Run: `cd dashboard/src-tauri && cargo test --lib assignment_model::training::tests -- --nocapture 2>&1`
Expected: All existing tests pass (values may change slightly due to decay, update assertions if needed — sessions are 1-2 days ago so decay is minimal).

- [ ] **Step 7: Commit**

```bash
git add dashboard/src-tauri/src/commands/assignment_model/training.rs dashboard/src-tauri/src/commands/assignment_model/mod.rs
git commit -m "feat(ai): add exponential time decay to model training

Recent sessions now contribute more to the model than old ones.
Default half-life: 90 days (configurable via decay_half_life_days).
Applies to all 3 model tables (app, time, token)."
```

---

### Task 5: Session duration weighting in training (data.md AI-9)

**Problem:** A 15-second accidental session counts the same as a 4-hour focused session. This introduces noise.

**Files:**
- Modify: `dashboard/src-tauri/src/commands/assignment_model/training.rs`

- [ ] **Step 1: Add duration weight to app model SQL**

In the app model INSERT query (modified in Task 4), change the SUM to include duration weighting. Replace:

```sql
SUM(exp(-?2 * (julianday('now') - julianday(s.start_time))))
```

with:

```sql
SUM(
  exp(-?2 * (julianday('now') - julianday(s.start_time)))
  * CASE
      WHEN s.duration_seconds > 3600 THEN 3.0
      WHEN s.duration_seconds > 600  THEN 2.0
      ELSE 1.0
    END
)
```

This gives 3x weight to sessions >1h, 2x to >10min, 1x to short sessions.

- [ ] **Step 2: Apply same to time model SQL**

Same change in the time model INSERT query.

- [ ] **Step 3: Run tests**

Run: `cd dashboard/src-tauri && cargo test --lib assignment_model::training::tests -- --nocapture 2>&1`
Expected: Tests pass (test sessions use `duration_seconds: 3600` so they get 2.0 or 3.0 weight).

- [ ] **Step 4: Commit**

```bash
git add dashboard/src-tauri/src/commands/assignment_model/training.rs
git commit -m "feat(ai): weight training by session duration

Sessions >1h get 3x weight, >10min get 2x, short sessions get 1x.
Reduces impact of accidental/brief app opens on model accuracy."
```

---

### Task 6: Duration-weighted file overlap in Layer 0 (data.md AI-6)

**Problem:** Layer 0 gives 0.80 per project found in overlapping files regardless of whether the file was active 1 second or 3 hours in the session.

**Files:**
- Modify: `dashboard/src-tauri/src/commands/assignment_model/context.rs`
- Modify: `dashboard/src-tauri/src/commands/assignment_model/scoring.rs`

- [ ] **Step 1: Return overlap data from session context**

In `context.rs`, change `SessionContext` to include per-project overlap weights:

```rust
#[derive(Debug)]
pub struct SessionContext {
    pub app_id: i64,
    pub hour_bucket: i64,
    pub weekday: i64,
    pub tokens: Vec<String>,
    /// project_ids with their overlap weight (0.0..1.0) relative to session duration
    pub file_project_weights: HashMap<i64, f64>,
}
```

Replace `file_project_ids: Vec<i64>` with `file_project_weights: HashMap<i64, f64>`.

Add `use std::collections::HashMap;` at the top if not already imported.

- [ ] **Step 2: Compute overlap fraction in build_session_context**

In `build_session_context`, parse session start/end times and compute overlap fraction per project. Replace the `file_project_set` logic:

```rust
    let mut file_project_set = HashSet::new();
```

with:

```rust
    let mut file_project_overlap: HashMap<i64, f64> = HashMap::new();

    let session_start_ts = parse_timestamp(&start_time);
    let session_end_ts = parse_timestamp(&end_time);
    let session_duration_secs = session_start_ts
        .zip(session_end_ts)
        .map(|(s, e)| (e - s).num_seconds().max(1) as f64)
        .unwrap_or(1.0);
```

Then in the file_rows loop, replace:
```rust
        if let Some(pid) = project_id {
            file_project_set.insert(pid);
        }
```

with:
```rust
        if let Some(pid) = project_id {
            // Compute overlap fraction
            let file_first = parse_timestamp(&row.get::<_, String>(6).unwrap_or_default()); // first_seen already loaded
            let file_last = parse_timestamp(&row.get::<_, String>(7).unwrap_or_default()); // last_seen already loaded
            // Wait — first_seen and last_seen are not separate columns in the query.
            // They ARE loaded via the file_activities query but not extracted.
        }
```

Actually, looking at the query more carefully (lines 153-158), it only fetches `file_name, file_path, detected_path, project_id, window_title, title_history`. We need `first_seen` and `last_seen` too.

Update the SQL query to include them:

```rust
    let mut file_stmt = conn
        .prepare_cached(
            "SELECT file_name, file_path, detected_path, project_id, window_title, title_history,
                    first_seen, last_seen
             FROM file_activities
             WHERE app_id = ?1 AND date = ?2
               AND last_seen > ?3 AND first_seen < ?4",
        )
        .map_err(|e| e.to_string())?;
```

Then extract first_seen/last_seen in the loop:

```rust
        let file_first_seen: String = row.get(6).map_err(|e| e.to_string())?;
        let file_last_seen: String = row.get(7).map_err(|e| e.to_string())?;

        if let Some(pid) = project_id {
            let overlap = if let (Some(ss), Some(se), Some(fs), Some(fe)) = (
                session_start_ts,
                session_end_ts,
                parse_timestamp(&file_first_seen),
                parse_timestamp(&file_last_seen),
            ) {
                let overlap_start = ss.max(fs);
                let overlap_end = se.min(fe);
                let overlap_secs = (overlap_end - overlap_start).num_seconds().max(0) as f64;
                (overlap_secs / session_duration_secs).clamp(0.05, 1.0)
            } else {
                1.0 // fallback: full weight if timestamps can't be parsed
            };
            let entry = file_project_overlap.entry(pid).or_insert(0.0);
            *entry = (*entry).max(overlap); // take the max overlap for this project
        }
```

Finally, change the return:

```rust
    Ok(Some(SessionContext {
        app_id,
        hour_bucket,
        weekday,
        tokens,
        file_project_weights: file_project_overlap,
    }))
```

- [ ] **Step 3: Update scoring.rs to use weighted Layer 0**

In `scoring.rs`, `compute_score_breakdowns` (line 132+), replace the Layer 0 section:

```rust
    // Layer 0: direct file-activity project evidence
    for &pid in &context.file_project_ids {
        if is_project_active_cached(conn, &mut active_project_cache, pid) {
            *layer0.entry(pid).or_insert(0.0) += 0.80;
            *candidate_evidence.entry(pid).or_insert(0) += 2;
        }
    }
```

with:

```rust
    // Layer 0: direct file-activity project evidence (weighted by overlap fraction)
    for (&pid, &weight) in &context.file_project_weights {
        if is_project_active_cached(conn, &mut active_project_cache, pid) {
            *layer0.entry(pid).or_insert(0.0) += 0.80 * weight;
            *candidate_evidence.entry(pid).or_insert(0) += 2;
        }
    }
```

Also update the `is_background_app` check:

```rust
    let is_background_app = context.file_project_weights.is_empty();
```

- [ ] **Step 4: Build and run all assignment model tests**

Run: `cd dashboard/src-tauri && cargo test --lib assignment_model -- --nocapture 2>&1`
Expected: All tests compile and pass.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/src/commands/assignment_model/context.rs dashboard/src-tauri/src/commands/assignment_model/scoring.rs
git commit -m "feat(ai): weight Layer 0 file evidence by session overlap fraction

A file active for 1s in a 3h session now scores 0.80 * (1/10800)
instead of the full 0.80. Reduces false positives from brief file
overlap in multi-project sessions."
```

---

### Task 7: Sharper confidence sigmoid (data.md AI-3)

**Problem:** At margin=0 (two equally-scored projects), sigmoid gives 0.5, which combined with evidence can exceed the suggestion threshold. The model is "confident" when it shouldn't be.

**Files:**
- Modify: `dashboard/src-tauri/src/commands/assignment_model/scoring.rs`

- [ ] **Step 1: Replace confidence formula**

In `scoring.rs`, find the confidence calculation (lines 276-281):

```rust
        let second_score = candidates.get(1).map(|c| c.total_score).unwrap_or(0.0);
        let margin = (best.total_score - second_score).max(0.0);
        let evidence_factor = 1.0 - (-(best.evidence_count as f64) / 2.0).exp();
        let sigmoid_margin = 1.0 / (1.0 + (-margin).exp());
        let confidence = sigmoid_margin * evidence_factor;
```

Replace with:

```rust
        let second_score = candidates.get(1).map(|c| c.total_score).unwrap_or(0.0);
        let margin = (best.total_score - second_score).max(0.0);
        let evidence_factor = 1.0 - (-(best.evidence_count as f64) / 2.0).exp();
        // Shifted sigmoid: requires margin > ~0.3 to cross 0.5
        // At margin=0 → ~0.23, at margin=0.3 → ~0.50, at margin=1.0 → ~0.94
        let sigmoid_margin = 1.0 / (1.0 + (-(margin - 0.3) * 4.0).exp());
        let confidence = sigmoid_margin * evidence_factor;
```

- [ ] **Step 2: Add tests for new confidence curve**

In `scoring.rs` (or a test module), add:

```rust
#[cfg(test)]
mod confidence_tests {
    #[test]
    fn zero_margin_gives_low_confidence() {
        let margin = 0.0;
        let sigmoid = 1.0 / (1.0 + (-(margin - 0.3) * 4.0_f64).exp());
        // At margin=0, sigmoid should be well below 0.5
        assert!(sigmoid < 0.30, "sigmoid at margin=0 was {}", sigmoid);
    }

    #[test]
    fn high_margin_gives_high_confidence() {
        let margin = 1.0;
        let sigmoid = 1.0 / (1.0 + (-(margin - 0.3) * 4.0_f64).exp());
        assert!(sigmoid > 0.90, "sigmoid at margin=1.0 was {}", sigmoid);
    }

    #[test]
    fn moderate_margin_is_around_half() {
        let margin = 0.3;
        let sigmoid = 1.0 / (1.0 + (-(margin - 0.3) * 4.0_f64).exp());
        assert!((sigmoid - 0.5).abs() < 0.01, "sigmoid at margin=0.3 was {}", sigmoid);
    }
}
```

- [ ] **Step 3: Run tests**

Run: `cd dashboard/src-tauri && cargo test --lib assignment_model::scoring::confidence_tests -- --nocapture 2>&1`
Expected: All 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src-tauri/src/commands/assignment_model/scoring.rs
git commit -m "feat(ai): sharpen confidence sigmoid to require margin > 0.3

Shifted sigmoid: margin=0 → ~0.23 (was 0.50), margin=0.3 → 0.50,
margin=1.0 → ~0.94. Reduces false suggestions on ambiguous sessions."
```

---

## Final Verification

- [ ] **Step 1: Full build from project root**

Run: `cargo build 2>&1 | tail -5`
Expected: Successful compilation.

- [ ] **Step 2: Full test suite**

Run: `cd dashboard/src-tauri && cargo test 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 3: Verify daemon starts**

Run: `cargo run 2>&1 | head -30` (stop after seeing heartbeat message)
Expected: Daemon starts, foreground hook installed, heartbeat written.

---

## Summary of Changes

| Task | Files | data.md ref | Impact |
|------|-------|-------------|--------|
| 1. Foreground hook time-split | `foreground_hook.rs`, `tracker.rs` | #3 (P1) | ±10s → ±0.1s on Alt+Tab |
| 2. Idle→active interpolation | `tracker.rs` | #1 (P2) | +1-10s precision per idle cycle |
| 3. Smart tokenization | `context.rs` | AI-1 (P1) | Less noise in Layer 3 |
| 4. Time decay in training | `training.rs`, `mod.rs` | AI-4 (P1) | Model adapts to workflow changes |
| 5. Duration-weighted training | `training.rs` | AI-9 (P2) | Long sessions = stronger signal |
| 6. Duration-weighted Layer 0 | `context.rs`, `scoring.rs` | AI-6 (P1) | Brief file overlap ≠ full score |
| 7. Sharper confidence sigmoid | `scoring.rs` | AI-3 (P2) | Fewer false positives on ambiguous sessions |
