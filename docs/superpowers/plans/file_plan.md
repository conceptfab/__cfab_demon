# File Activity Spans — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace coarse `first_seen`/`last_seen` file timestamps with fine-grained `activity_spans` — a list of `(start, end)` intervals per file entry — so that session↔file overlap queries become precise instead of matching every session between the absolute first and last observation.

**Architecture:** Add an `activity_spans` field (JSON-serialized `Vec<(String, String)>`) alongside existing `first_seen`/`last_seen` (which become derived min/max for backward compatibility). The daemon merges adjacent spans (gap <30s). Dashboard migration populates the new column from existing data (1 span per existing row). All overlap queries switch to span-based logic.

**Tech Stack:** Rust (daemon + Tauri backend), SQLite, TypeScript/React (dashboard types)

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `shared/daily_store/types.rs` | Add `activity_spans` field to `StoredFileEntry` |
| Modify | `shared/daily_store/schema.rs` | Add `activity_spans_json` column to `daily_files` table + migration |
| Modify | `shared/daily_store/write.rs` | Persist `activity_spans` to SQLite |
| Modify | `shared/daily_store/read.rs` | Read `activity_spans` from SQLite |
| Modify | `src/tracker.rs` | Build/merge spans in `update_file_entry` and `build_new_file_entry` |
| Create | `dashboard/src-tauri/src/db_migrations/m16_file_activity_spans.rs` | Dashboard DB migration: add `activity_spans` column to `file_activities` |
| Modify | `dashboard/src-tauri/src/db_migrations/mod.rs` | Register m16 migration |
| Modify | `dashboard/src-tauri/src/commands/types.rs` | Add `activity_spans` to Rust `FileActivity` struct |
| Modify | `dashboard/src-tauri/src/commands/import.rs` | Persist `activity_spans` during daily store import |
| Modify | `dashboard/src-tauri/src/commands/sessions/query.rs` | Use spans for overlap calculation |
| Modify | `dashboard/src-tauri/src/commands/assignment_model/context.rs` | Use spans for session↔file overlap in AI scoring |
| Modify | `dashboard/src/lib/db-types.ts` | Add `activity_spans` to TS `FileActivity` interface |
| Modify | `dashboard/src/lib/session-utils.ts` | Include `activity_spans` in equality check |
| Modify | `dashboard/src-tauri/resources/sql/schema.sql` | Update canonical schema with `activity_spans` column |

---

## Span Merging Algorithm (used across tasks)

```rust
/// Merge adjacent spans with gap < MERGE_GAP_SECS (30s).
/// Input spans MUST be sorted by start time.
/// Each span is (start_rfc3339, end_rfc3339).
fn merge_activity_spans(spans: &[(String, String)], new_start: &str, new_end: &str) -> Vec<(String, String)> {
    const MERGE_GAP_SECS: i64 = 30;
    let mut result: Vec<(String, String)> = spans.to_vec();
    result.push((new_start.to_string(), new_end.to_string()));
    result.sort_by(|a, b| a.0.cmp(&b.0));

    let mut merged: Vec<(String, String)> = Vec::with_capacity(result.len());
    for span in result {
        if let Some(last) = merged.last_mut() {
            // If gap between last.end and span.start <= MERGE_GAP_SECS, merge
            if rfc3339_diff_secs(&span.0, &last.1) <= MERGE_GAP_SECS {
                if span.1 > last.1 {
                    last.1 = span.1.clone();
                }
                continue;
            }
        }
        merged.push(span);
    }
    merged
}

/// Returns (a - b) in seconds. Positive means a is after b.
fn rfc3339_diff_secs(a: &str, b: &str) -> i64 {
    let parse = |s: &str| chrono::DateTime::parse_from_rfc3339(s).ok();
    match (parse(a), parse(b)) {
        (Some(da), Some(db)) => da.signed_duration_since(db).num_seconds(),
        _ => i64::MAX, // unparseable → don't merge
    }
}
```

This algorithm is placed in `shared/daily_store/types.rs` and reused by the daemon tracker.

---

### Task 1: Add `activity_spans` to `StoredFileEntry` (shared types)

**Files:**
- Modify: `shared/daily_store/types.rs:30-44`

- [ ] **Step 1: Add the field and helper functions**

In `shared/daily_store/types.rs`, add `activity_spans` to `StoredFileEntry` and add the span merging helpers:

```rust
// After line 42 (activity_type field), add:
    #[serde(default)]
    pub activity_spans: Vec<(String, String)>,
```

Full struct becomes:
```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredFileEntry {
    pub name: String,
    pub total_seconds: u64,
    pub first_seen: String,
    pub last_seen: String,
    #[serde(default)]
    pub window_title: String,
    #[serde(default)]
    pub detected_path: Option<String>,
    #[serde(default)]
    pub title_history: Vec<String>,
    #[serde(default)]
    pub activity_type: Option<String>,
    #[serde(default)]
    pub activity_spans: Vec<(String, String)>,
}
```

Add the merging helpers after `decode_detected_path`:

```rust
const SPAN_MERGE_GAP_SECS: i64 = 30;
const MAX_SPANS_PER_FILE: usize = 100;

/// Parse RFC3339 timestamp to DateTime.
fn parse_rfc3339(s: &str) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    chrono::DateTime::parse_from_rfc3339(s).ok()
}

/// Returns (a - b) in seconds. Positive means a is after b.
fn rfc3339_diff_secs(a: &str, b: &str) -> i64 {
    match (parse_rfc3339(a), parse_rfc3339(b)) {
        (Some(da), Some(db)) => da.signed_duration_since(db).num_seconds(),
        _ => i64::MAX,
    }
}

/// Extend spans with a new interval, merging adjacent spans (gap < 30s).
/// Caps at MAX_SPANS_PER_FILE by merging the two shortest-gap neighbors.
pub fn extend_activity_spans(
    spans: &[(String, String)],
    new_start: &str,
    new_end: &str,
) -> Vec<(String, String)> {
    let mut result: Vec<(String, String)> = spans.to_vec();
    result.push((new_start.to_string(), new_end.to_string()));
    result.sort_by(|a, b| a.0.cmp(&b.0));

    // Merge overlapping/adjacent spans
    let mut merged: Vec<(String, String)> = Vec::with_capacity(result.len());
    for span in result {
        if let Some(last) = merged.last_mut() {
            if rfc3339_diff_secs(&span.0, &last.1) <= SPAN_MERGE_GAP_SECS {
                if span.1 > last.1 {
                    last.1 = span.1;
                }
                continue;
            }
        }
        merged.push(span);
    }

    // Cap at MAX_SPANS_PER_FILE: repeatedly merge the pair with smallest gap
    while merged.len() > MAX_SPANS_PER_FILE {
        let mut min_gap = i64::MAX;
        let mut min_idx = 0;
        for i in 0..merged.len() - 1 {
            let gap = rfc3339_diff_secs(&merged[i + 1].0, &merged[i].1);
            if gap < min_gap {
                min_gap = gap;
                min_idx = i;
            }
        }
        let next_end = merged[min_idx + 1].1.clone();
        if next_end > merged[min_idx].1 {
            merged[min_idx].1 = next_end;
        }
        merged.remove(min_idx + 1);
    }

    merged
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd c:/_cloud/__cfab_demon/__client && cargo check 2>&1 | head -30`
Expected: Compilation succeeds (or only warnings). `activity_spans` defaults to `Vec::new()` via `#[serde(default)]`, so existing deserialization works.

- [ ] **Step 3: Commit**

```bash
git add shared/daily_store/types.rs
git commit -m "feat: add activity_spans field to StoredFileEntry with merge helpers"
```

---

### Task 2: Daemon daily store schema — add `activity_spans_json` column

**Files:**
- Modify: `shared/daily_store/schema.rs:62-81` (table definition)
- Modify: `shared/daily_store/schema.rs:162-201` (migration function)

- [ ] **Step 1: Add column to CREATE TABLE**

In `schema.rs`, line 75 (before the PRIMARY KEY), add the new column:

```sql
activity_spans_json TEXT NOT NULL DEFAULT '[]',
```

The full `daily_files` CREATE TABLE becomes:
```sql
CREATE TABLE IF NOT EXISTS daily_files (
    date TEXT NOT NULL,
    exe_name TEXT NOT NULL,
    file_name TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    total_seconds INTEGER NOT NULL DEFAULT 0,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    window_title TEXT NOT NULL DEFAULT '',
    detected_path TEXT NOT NULL DEFAULT '',
    title_history_json TEXT NOT NULL DEFAULT '[]',
    activity_type TEXT,
    activity_spans_json TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (date, exe_name, file_name, detected_path),
    FOREIGN KEY (date, exe_name) REFERENCES daily_apps(date, exe_name) ON DELETE CASCADE
);
```

- [ ] **Step 2: Update migration to include `activity_spans_json`**

In `migrate_daily_files_schema()`, add detection + migration for the new column. After the existing `needs_migration` check (line 136-137), add a second migration path:

```rust
// After the existing migration block, add:
let has_activity_spans = columns.contains_key("activity_spans_json");
if !has_activity_spans {
    conn.execute_batch(
        "ALTER TABLE daily_files ADD COLUMN activity_spans_json TEXT NOT NULL DEFAULT '[]'"
    ).map_err(|e| format!("Failed to add activity_spans_json column: {}", e))?;
}
```

This approach uses simple ALTER TABLE ADD COLUMN (no table rebuild needed since it has a default value).

- [ ] **Step 3: Verify compilation**

Run: `cd c:/_cloud/__cfab_demon/__client && cargo check 2>&1 | head -30`
Expected: Compiles OK.

- [ ] **Step 4: Commit**

```bash
git add shared/daily_store/schema.rs
git commit -m "feat: add activity_spans_json column to daily_files schema"
```

---

### Task 3: Persist and read `activity_spans` in daily store

**Files:**
- Modify: `shared/daily_store/write.rs:103-108,208-221`
- Modify: `shared/daily_store/read.rs:87-94,125-134,240-246,280-289`

- [ ] **Step 1: Update write.rs — include activity_spans_json in INSERT**

Change the file INSERT statement (line 103-108) to include the new column:

```rust
    let mut file_stmt = tx
        .prepare_cached(
            "INSERT OR REPLACE INTO daily_files (
                 date, exe_name, file_name, ordinal, total_seconds, first_seen, last_seen,
                 window_title, detected_path, title_history_json, activity_type, activity_spans_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        )
        .map_err(|e| format!("Failed to prepare daily file insert: {}", e))?;
```

Update the execute call (around line 208-221) to add the 12th parameter:

```rust
            let activity_spans_json = serde_json::to_string(&file.activity_spans).map_err(|e| {
                format!(
                    "Failed to serialize activity spans for '{}' on {}: {}",
                    file.name, snapshot.date, e
                )
            })?;
            file_stmt
                .execute(params![
                    snapshot.date,
                    exe_name,
                    file.name,
                    ordinal as i64,
                    file.total_seconds,
                    file.first_seen,
                    file.last_seen,
                    file.window_title,
                    detected_path.as_str(),
                    title_history_json,
                    file.activity_type,
                    activity_spans_json
                ])
```

- [ ] **Step 2: Update read.rs — load_day_snapshot**

Update the SELECT query (line 89) to include `activity_spans_json`:

```sql
SELECT exe_name, file_name, total_seconds, first_seen, last_seen,
       window_title, detected_path, title_history_json, activity_type, activity_spans_json
FROM daily_files
WHERE date = ?1
ORDER BY exe_name COLLATE NOCASE, ordinal ASC
```

Update the query_map (line 97) to read 10 columns (add column index 9):

```rust
    let file_rows = file_stmt
        .query_map([date], |row| {
            Ok((
                row.get::<_, String>(0)?,  // exe_name
                row.get::<_, String>(1)?,  // file_name
                row.get::<_, u64>(2)?,     // total_seconds
                row.get::<_, String>(3)?,  // first_seen
                row.get::<_, String>(4)?,  // last_seen
                row.get::<_, String>(5)?,  // window_title
                row.get::<_, String>(6)?,  // detected_path
                row.get::<_, String>(7)?,  // title_history_json
                row.get::<_, Option<String>>(8)?,  // activity_type
                row.get::<_, String>(9).unwrap_or_else(|_| "[]".to_string()),  // activity_spans_json
            ))
        })
```

Update the destructuring and struct construction to include `activity_spans`:

```rust
        let (
            exe_name, name, total_seconds, first_seen, last_seen,
            window_title, detected_path, title_history_json, activity_type,
            activity_spans_json,
        ) = row.map_err(|e| format!("Failed to map daily file row for {}: {}", date, e))?;
        let title_history = parse_title_history_json(&title_history_json);
        let activity_spans = parse_activity_spans_json(&activity_spans_json);
        if let Some(app) = apps.get_mut(&exe_name) {
            app.files.push(StoredFileEntry {
                name,
                total_seconds,
                first_seen,
                last_seen,
                window_title,
                detected_path: decode_detected_path(detected_path),
                title_history,
                activity_type,
                activity_spans,
            });
        }
```

Add the parser function at the top of `read.rs`:

```rust
fn parse_activity_spans_json(json: &str) -> Vec<(String, String)> {
    serde_json::from_str::<Vec<(String, String)>>(json).unwrap_or_default()
}
```

- [ ] **Step 3: Update read.rs — load_range_snapshots**

Same pattern for `load_range_snapshots` (line 240-292). Update the SELECT to include `activity_spans_json` as the 11th column (index 10), update the query_map tuple, and construct `StoredFileEntry` with `activity_spans`.

SELECT (line 242):
```sql
SELECT date, exe_name, file_name, total_seconds, first_seen, last_seen,
       window_title, detected_path, title_history_json, activity_type, activity_spans_json
FROM daily_files
WHERE date >= ?1 AND date <= ?2
ORDER BY date ASC, exe_name COLLATE NOCASE, ordinal ASC
```

query_map — add index 10:
```rust
                row.get::<_, String>(10).unwrap_or_else(|_| "[]".to_string()),  // activity_spans_json
```

Destructuring + struct:
```rust
        let (
            date, exe_name, name, total_seconds, first_seen, last_seen,
            window_title, detected_path, title_history_json, activity_type,
            activity_spans_json,
        ) = ...;
        // ...
        app.files.push(StoredFileEntry {
            // ... all existing fields ...
            activity_spans: parse_activity_spans_json(&activity_spans_json),
        });
```

- [ ] **Step 4: Verify compilation**

Run: `cd c:/_cloud/__cfab_demon/__client && cargo check 2>&1 | head -30`
Expected: Compiles OK.

- [ ] **Step 5: Commit**

```bash
git add shared/daily_store/write.rs shared/daily_store/read.rs
git commit -m "feat: persist and load activity_spans in daily store"
```

---

### Task 4: Daemon tracker — build spans during activity recording

**Files:**
- Modify: `src/tracker.rs:203-248`

- [ ] **Step 1: Update `build_new_file_entry` to initialize spans**

In `build_new_file_entry` (line 227-248), add `activity_spans` with the initial span:

```rust
fn build_new_file_entry(
    file_name: &str,
    elapsed_seconds: u64,
    now_str: &str,
    window_title: &str,
    detected_path: Option<&str>,
    activity_type: Option<&str>,
) -> FileEntry {
    let mut title_history = Vec::new();
    push_title_history(&mut title_history, window_title);

    FileEntry {
        name: file_name.to_string(),
        total_seconds: elapsed_seconds,
        first_seen: now_str.to_string(),
        last_seen: now_str.to_string(),
        window_title: window_title.to_string(),
        detected_path: detected_path.map(str::to_string),
        title_history,
        activity_type: activity_type.map(str::to_string),
        activity_spans: vec![(now_str.to_string(), now_str.to_string())],
    }
}
```

- [ ] **Step 2: Update `update_file_entry` to extend spans**

In `update_file_entry` (line 203-225), extend the last span or create new one:

```rust
fn update_file_entry(
    file_entry: &mut FileEntry,
    elapsed_seconds: u64,
    now_str: &str,
    window_title: &str,
    detected_path: Option<&str>,
    activity_type: Option<&str>,
) {
    file_entry.total_seconds += elapsed_seconds;
    file_entry.last_seen = now_str.to_string();

    // Extend activity spans — the new observation is (last_seen_before_update, now_str).
    // Since update_file_entry is called every poll tick (~10s), adjacent ticks will
    // be merged by extend_activity_spans (gap < 30s).
    file_entry.activity_spans = crate::daily_store::extend_activity_spans(
        &file_entry.activity_spans,
        now_str,
        now_str,
    );

    if !window_title.is_empty() {
        file_entry.window_title = window_title.to_string();
        push_title_history(&mut file_entry.title_history, window_title);
    }
    if let Some(path) = detected_path {
        file_entry.detected_path = Some(path.to_string());
    }
    if let Some(kind) = activity_type {
        file_entry.activity_type = Some(kind.to_string());
    }
}
```

Note: `extend_activity_spans` is called with `(now_str, now_str)` — a point span. Since the poll interval is 10s and the merge gap is 30s, consecutive ticks will always be merged into a single growing span. When the user goes idle (>30s gap between ticks for this file), a new span starts automatically.

- [ ] **Step 3: Verify compilation**

Run: `cd c:/_cloud/__cfab_demon/__client && cargo check 2>&1 | head -30`
Expected: Compiles OK.

- [ ] **Step 4: Commit**

```bash
git add src/tracker.rs
git commit -m "feat: build activity_spans during daemon tracking"
```

---

### Task 5: Dashboard DB migration — add `activity_spans` column to `file_activities`

**Files:**
- Create: `dashboard/src-tauri/src/db_migrations/m16_file_activity_spans.rs`
- Modify: `dashboard/src-tauri/src/db_migrations/mod.rs:1-17,84-91`

- [ ] **Step 1: Create migration file**

Create `dashboard/src-tauri/src/db_migrations/m16_file_activity_spans.rs`:

```rust
use rusqlite::Connection;

/// Migration 16: Add activity_spans column to file_activities.
/// For existing rows, generate a single span from (first_seen, last_seen).
pub fn run(db: &Connection) -> Result<(), rusqlite::Error> {
    db.execute_batch(
        "ALTER TABLE file_activities ADD COLUMN activity_spans TEXT NOT NULL DEFAULT '[]';"
    )?;

    // Backfill: create a single span [first_seen, last_seen] for every existing row
    // where first_seen and last_seen are non-empty.
    db.execute_batch(
        "UPDATE file_activities
         SET activity_spans = '[' || '[\"' || first_seen || '\",\"' || last_seen || '\"]' || ']'
         WHERE first_seen != '' AND last_seen != '' AND activity_spans = '[]';"
    )?;

    Ok(())
}
```

- [ ] **Step 2: Register migration in mod.rs**

Add module declaration at the top of `mod.rs`:

```rust
mod m16_file_activity_spans;
```

Update `LATEST_SCHEMA_VERSION`:

```rust
const LATEST_SCHEMA_VERSION: i64 = 16;
```

Add migration call before the version update:

```rust
    if current_version < 16 {
        m16_file_activity_spans::run(&tx)?;
    }
```

- [ ] **Step 3: Update canonical schema.sql**

In `dashboard/src-tauri/resources/sql/schema.sql`, add `activity_spans` column to `file_activities` table (after `activity_type TEXT,`):

```sql
    activity_spans TEXT NOT NULL DEFAULT '[]',
```

- [ ] **Step 4: Verify compilation**

Run: `cd c:/_cloud/__cfab_demon/__client/dashboard && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | head -30`
Expected: Compiles OK.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/src/db_migrations/m16_file_activity_spans.rs \
      dashboard/src-tauri/src/db_migrations/mod.rs \
      dashboard/src-tauri/resources/sql/schema.sql
git commit -m "feat: migration m16 — add activity_spans to file_activities with backfill"
```

---

### Task 6: Dashboard import — persist `activity_spans` during daily store import

**Files:**
- Modify: `dashboard/src-tauri/src/commands/import.rs:219-233,331-344`

- [ ] **Step 1: Update file INSERT/upsert statement**

In `import.rs` (around line 219-233), update the INSERT to include `activity_spans`:

```rust
    let mut file_stmt = match tx.prepare_cached(
        "INSERT INTO file_activities (
            app_id, date, file_name, file_path, total_seconds, first_seen, last_seen,
            project_id, window_title, detected_path, title_history, activity_type, activity_spans
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(app_id, date, file_path) DO UPDATE SET
           file_name = excluded.file_name,
           total_seconds = excluded.total_seconds,
           first_seen = MIN(file_activities.first_seen, excluded.first_seen),
           last_seen = MAX(file_activities.last_seen, excluded.last_seen),
           project_id = COALESCE(excluded.project_id, file_activities.project_id),
           window_title = COALESCE(excluded.window_title, file_activities.window_title),
           detected_path = COALESCE(excluded.detected_path, file_activities.detected_path),
           title_history = COALESCE(excluded.title_history, file_activities.title_history),
           activity_type = COALESCE(excluded.activity_type, file_activities.activity_type),
           activity_spans = CASE
               WHEN excluded.activity_spans != '[]' THEN excluded.activity_spans
               ELSE file_activities.activity_spans
           END",
    ) {
```

Note: The `activity_spans` merge on conflict uses a simple "take the incoming if non-empty" strategy. This is sufficient because the daemon is the authoritative source — it builds the full spans from scratch on each save cycle.

- [ ] **Step 2: Update file_stmt.execute to pass activity_spans**

Around line 331-344, add the 13th parameter:

```rust
            let activity_spans_param = if file.activity_spans.is_empty() {
                "[]".to_string()
            } else {
                serde_json::to_string(&file.activity_spans).unwrap_or_else(|_| "[]".to_string())
            };
            if let Err(e) = file_stmt.execute(rusqlite::params![
                app_id,
                file_date,
                safe_file_name,
                normalized_file_path,
                file.total_seconds,
                file.first_seen,
                file.last_seen,
                file_project_id,
                window_title_param,
                detected_path_param,
                title_history_param.as_deref(),
                activity_type_param,
                activity_spans_param
            ]) {
```

- [ ] **Step 3: Verify compilation**

Run: `cd c:/_cloud/__cfab_demon/__client/dashboard && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | head -30`
Expected: Compiles OK.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src-tauri/src/commands/import.rs
git commit -m "feat: persist activity_spans during daily store import"
```

---

### Task 7: Dashboard Rust types — add `activity_spans` to `FileActivity`

**Files:**
- Modify: `dashboard/src-tauri/src/commands/types.rs:91-101`

- [ ] **Step 1: Add field to Rust struct**

Update `FileActivity` struct (line 91-101):

```rust
#[derive(Serialize, Clone)]
pub struct FileActivity {
    pub id: i64,
    pub app_id: i64,
    pub file_name: String,
    pub total_seconds: i64,
    pub first_seen: String,
    pub last_seen: String,
    pub project_id: Option<i64>,
    pub project_name: Option<String>,
    pub project_color: Option<String>,
    pub activity_spans: Vec<(String, String)>,
}
```

- [ ] **Step 2: Update all FileActivity construction sites**

In `sessions/query.rs` (around line 323-333), where `FileActivity` is constructed from the SELECT result, add `activity_spans` parsing. The SELECT also needs the column.

Update the SELECT (line 311):
```sql
SELECT fa.id, fa.app_id, fa.date, fa.file_name, fa.total_seconds, fa.first_seen, fa.last_seen,
       fa.project_id, p.name, p.color, fa.activity_spans
FROM file_activities fa
LEFT JOIN projects p ON p.id = fa.project_id
INNER JOIN _fa_keys k ON fa.app_id = k.app_id AND fa.date = k.date
```

Update the `FileActivity` construction:
```rust
                    FileActivity {
                        id: row.get(0)?,
                        app_id: row.get(1)?,
                        file_name: row.get(3)?,
                        total_seconds: row.get(4)?,
                        first_seen: row.get(5)?,
                        last_seen: row.get(6)?,
                        project_id: row.get(7)?,
                        project_name: row.get(8)?,
                        project_color: row.get(9)?,
                        activity_spans: {
                            let json: String = row.get::<_, String>(10).unwrap_or_else(|_| "[]".to_string());
                            serde_json::from_str(&json).unwrap_or_default()
                        },
                    },
```

- [ ] **Step 3: Verify compilation**

Run: `cd c:/_cloud/__cfab_demon/__client/dashboard && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | head -30`
Expected: Compiles OK.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src-tauri/src/commands/types.rs \
      dashboard/src-tauri/src/commands/sessions/query.rs
git commit -m "feat: expose activity_spans in FileActivity struct and session query"
```

---

### Task 8: Span-based overlap in session↔file matching

**Files:**
- Modify: `dashboard/src-tauri/src/commands/sessions/query.rs:29-65`

- [ ] **Step 1: Update `IndexedFileActivity` to use spans for overlap**

Replace the simple `overlap_ms` method with span-aware logic:

```rust
struct IndexedFileActivity {
    activity: FileActivity,
    first_seen_ms: Option<i64>,
    last_seen_ms: Option<i64>,
    parsed_spans: Vec<(i64, i64)>,  // parsed span milliseconds
}

impl IndexedFileActivity {
    fn new(activity: FileActivity) -> Self {
        let parsed_spans: Vec<(i64, i64)> = activity
            .activity_spans
            .iter()
            .filter_map(|(s, e)| {
                Some((parse_datetime_ms_opt(s)?, parse_datetime_ms_opt(e)?))
            })
            .collect();

        Self {
            first_seen_ms: parse_datetime_ms_opt(&activity.first_seen),
            last_seen_ms: parse_datetime_ms_opt(&activity.last_seen),
            activity,
            parsed_spans,
        }
    }

    fn overlap_ms(&self, session_start_ms: i64, session_end_ms: i64) -> Option<i64> {
        // If we have spans, use them for precise overlap
        if !self.parsed_spans.is_empty() {
            let total: i64 = self
                .parsed_spans
                .iter()
                .filter_map(|&(span_start, span_end)| {
                    compute_overlap_ms(session_start_ms, session_end_ms, span_start, span_end)
                })
                .sum();
            return if total > 0 { Some(total) } else { None };
        }

        // Fallback to first_seen/last_seen for legacy data
        compute_overlap_ms(
            session_start_ms,
            session_end_ms,
            self.first_seen_ms?,
            self.last_seen_ms?,
        )
    }
}
```

The `compute_overlap_ms` function (line 48-65) stays exactly the same.

- [ ] **Step 2: Verify compilation**

Run: `cd c:/_cloud/__cfab_demon/__client/dashboard && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | head -30`
Expected: Compiles OK.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src-tauri/src/commands/sessions/query.rs
git commit -m "feat: use activity_spans for precise session-file overlap calculation"
```

---

### Task 9: Span-based overlap in AI assignment model

**Files:**
- Modify: `dashboard/src-tauri/src/commands/assignment_model/context.rs:183-194`

- [ ] **Step 1: Update file query to include activity_spans**

Update the SELECT in `build_session_context` (line 186):

```rust
    let mut file_stmt = conn
        .prepare_cached(
            "SELECT file_name, file_path, detected_path, project_id, window_title, title_history, activity_spans
             FROM file_activities
             WHERE app_id = ?1 AND date = ?2
               AND last_seen > ?3 AND first_seen < ?4",
        )
        .map_err(|e| e.to_string())?;
```

Note: We keep the `last_seen > ?3 AND first_seen < ?4` pre-filter for performance — it narrows candidates using the indexed columns. The precise span-based check happens in application code.

- [ ] **Step 2: Add span-based filtering after fetching rows**

After reading each row (around line 198-204), parse `activity_spans` and check for actual overlap:

```rust
    while let Some(row) = file_rows.next().map_err(|e| e.to_string())? {
        let file_name: String = row.get(0).map_err(|e| e.to_string())?;
        let file_path: String = row.get(1).map_err(|e| e.to_string())?;
        let detected_path: Option<String> = row.get(2).map_err(|e| e.to_string())?;
        let project_id: Option<i64> = row.get(3).map_err(|e| e.to_string())?;
        let window_title: Option<String> = row.get(4).map_err(|e| e.to_string())?;
        let title_history: Option<String> = row.get(5).map_err(|e| e.to_string())?;
        let activity_spans_json: String = row.get::<_, String>(6).unwrap_or_else(|_| "[]".to_string());
        let activity_spans: Vec<(String, String)> =
            serde_json::from_str(&activity_spans_json).unwrap_or_default();

        // If spans exist, verify at least one overlaps with the session window
        if !activity_spans.is_empty() {
            let session_start = parse_timestamp(&start_time);
            let session_end = parse_timestamp(&end_time);
            if let (Some(ss), Some(se)) = (session_start, session_end) {
                let has_overlap = activity_spans.iter().any(|(s, e)| {
                    if let (Some(span_s), Some(span_e)) = (parse_timestamp(s), parse_timestamp(e)) {
                        span_s < se && span_e > ss
                    } else {
                        true // unparseable → keep for safety
                    }
                });
                if !has_overlap {
                    continue; // skip this file — no span actually overlaps
                }
            }
        }

        // ... rest of existing token extraction logic unchanged ...
```

- [ ] **Step 3: Verify compilation**

Run: `cd c:/_cloud/__cfab_demon/__client/dashboard && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | head -30`
Expected: Compiles OK.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src-tauri/src/commands/assignment_model/context.rs
git commit -m "feat: use activity_spans for precise file overlap in AI scoring"
```

---

### Task 10: TypeScript types and equality check

**Files:**
- Modify: `dashboard/src/lib/db-types.ts:34-45`
- Modify: `dashboard/src/lib/session-utils.ts:49-65`

- [ ] **Step 1: Add `activity_spans` to TS `FileActivity` interface**

In `db-types.ts`, after line 43 (`project_color`), add:

```typescript
export interface FileActivity {
  id: number;
  app_id: number;
  file_name: string;
  file_path?: string;
  total_seconds: number;
  first_seen: string;
  last_seen: string;
  project_id?: number | null;
  project_name?: string | null;
  project_color?: string | null;
  activity_spans?: [string, string][];
}
```

- [ ] **Step 2: Update equality check**

In `session-utils.ts`, update `areFileActivitiesEqual` (line 49-65) to include `activity_spans`:

```typescript
export function areFileActivitiesEqual(
  left: SessionWithApp['files'][number],
  right: SessionWithApp['files'][number],
): boolean {
  return (
    left.id === right.id &&
    left.app_id === right.app_id &&
    left.file_name === right.file_name &&
    (left.file_path ?? null) === (right.file_path ?? null) &&
    left.total_seconds === right.total_seconds &&
    left.first_seen === right.first_seen &&
    left.last_seen === right.last_seen &&
    (left.project_id ?? null) === (right.project_id ?? null) &&
    (left.project_name ?? null) === (right.project_name ?? null) &&
    (left.project_color ?? null) === (right.project_color ?? null) &&
    JSON.stringify(left.activity_spans ?? []) === JSON.stringify(right.activity_spans ?? [])
  );
}
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cd c:/_cloud/__cfab_demon/__client/dashboard && npx tsc --noEmit 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/lib/db-types.ts dashboard/src/lib/session-utils.ts
git commit -m "feat: add activity_spans to TypeScript FileActivity type"
```

---

### Task 11: Update post-migration indexes

**Files:**
- Modify: `dashboard/src-tauri/src/db_migrations/mod.rs:98-111`

- [ ] **Step 1: Verify existing overlap index still works**

The existing index `idx_file_activities_app_date_overlap ON file_activities(app_id, date, last_seen, first_seen)` (line 104) is still correct — we use `first_seen`/`last_seen` as a pre-filter in SQL, then refine with spans in application code.

No changes needed to the index. This is a verification step only.

- [ ] **Step 2: Commit (skip if no changes)**

No commit needed — this was a verification step.

---

## Post-implementation checklist

- [ ] Run full daemon build: `cd c:/_cloud/__cfab_demon/__client && cargo build`
- [ ] Run dashboard build: `cd c:/_cloud/__cfab_demon/__client/dashboard && cargo build --manifest-path src-tauri/Cargo.toml`
- [ ] Run TS check: `cd c:/_cloud/__cfab_demon/__client/dashboard && npx tsc --noEmit`
- [ ] Manual test: start daemon, work for 5 minutes, check daily store DB for `activity_spans_json` content
- [ ] Manual test: open dashboard, verify sessions page loads with files
- [ ] Manual test: check that old data (pre-migration) still displays correctly via backfilled single-span

---

## Backward Compatibility Notes

1. **`#[serde(default)]` on `activity_spans`** — existing JSON files without this field deserialize with `Vec::new()`. No breakage.
2. **`first_seen`/`last_seen` preserved** — they remain the authoritative timestamps for legacy queries, indexes, and pre-filter. Spans refine within that window.
3. **Migration backfill** — m16 creates a single `[first_seen, last_seen]` span for all existing rows, so old data participates in span-based overlap correctly.
4. **LAN sync** — `StoredFileEntry` serialization via serde automatically includes `activity_spans` (with `#[serde(default)]` for receiving old-format data from peers not yet upgraded).
