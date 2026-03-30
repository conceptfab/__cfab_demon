# LAN Sync — Plan naprawy z raportu

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Naprawić 24 problemy zidentyfikowane w raporcie analizy kodu LAN sync — od krytycznych (SQL injection, utrata danych) przez wysokie (sync logic, wydajność) po średnie/niskie (DRY, i18n, React).

**Architecture:** Poprawki podzielone na 10 zadań pogrupowanych priorytetem. Najpierw tworzymy moduł `lan_common.rs` (eliminacja duplikacji), potem naprawiamy krytyczne bugi (SQL injection, mapowanie ID), następnie logikę sync, wydajność, i na koniec frontend.

**Tech Stack:** Rust (rusqlite, serde_json, chrono), React/TypeScript (Tauri invoke API), i18n (en/pl common.json)

---

## Struktura plików

| Akcja | Plik | Odpowiedzialność |
|-------|------|-----------------|
| **Utwórz** | `src/lan_common.rs` | Wspólne funkcje: `get_device_id`, `get_machine_name`, `sync_log`, `open_dashboard_db`, `compute_table_hash`, `build_table_hashes`, `generate_marker_hash` |
| Modyfikuj | `src/main.rs` | Dodaj `mod lan_common;` |
| Modyfikuj | `src/lan_server.rs` | Usuń zduplikowane funkcje, użyj `lan_common::*`, napraw SQL injection |
| Modyfikuj | `src/lan_sync_orchestrator.rs` | Usuń zduplikowane funkcje, użyj `lan_common::*`, dodaj mapowanie ID, jedno połączenie DB, napraw backoff |
| Modyfikuj | `src/lan_discovery.rs` | Użyj `lan_common::get_device_id/get_machine_name`, dodaj jitter do elekcji |
| Modyfikuj | `dashboard/src/components/settings/LanSyncCard.tsx` | i18n hardcoded strings |
| Modyfikuj | `dashboard/src/pages/Settings.tsx` | Usuń podwójny polling, napraw deps, useMemo |
| Modyfikuj | `dashboard/src/locales/en/common.json` | Klucze i18n |
| Modyfikuj | `dashboard/src/locales/pl/common.json` | Klucze i18n |

---

### Task 1: Utwórz `lan_common.rs` — wspólne funkcje [DRY — raport §3]

**Files:**
- Create: `src/lan_common.rs`
- Modify: `src/main.rs` — dodaj `mod lan_common;`

- [ ] **Step 1: Utwórz `src/lan_common.rs` z przeniesionymi funkcjami**

```rust
// src/lan_common.rs
//! Shared utilities for LAN sync modules (server, orchestrator, discovery).

use crate::config;
use std::hash::{Hash, Hasher};

/// Read device_id from config dir, fallback to machine name.
pub fn get_device_id() -> String {
    let dir = match config::config_dir() {
        Ok(d) => d,
        Err(_) => return get_machine_name(),
    };
    let path = dir.join("device_id.txt");
    if let Ok(id) = std::fs::read_to_string(&path) {
        let trimmed = id.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    get_machine_name()
}

/// Get machine name from COMPUTERNAME env var.
pub fn get_machine_name() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string())
}

/// Append timestamped line to lan_sync.log (max 100KB — rotated at start).
pub fn sync_log(msg: &str) {
    log::info!("{}", msg);
    if let Ok(dir) = config::config_dir() {
        let path = dir.join("lan_sync.log");
        // Rotate if > 100KB
        if let Ok(meta) = std::fs::metadata(&path) {
            if meta.len() > 100_000 {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    let lines: Vec<&str> = content.lines().collect();
                    let keep = lines.len().saturating_sub(200);
                    let _ = std::fs::write(&path, lines[keep..].join("\n"));
                }
            }
        }
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
            let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
            let _ = writeln!(f, "[{}] {}", ts, msg);
        }
    }
}

/// Open the dashboard SQLite DB in read-write mode.
pub fn open_dashboard_db() -> Result<rusqlite::Connection, String> {
    let db_path = config::dashboard_db_path().map_err(|e| e.to_string())?;
    if !db_path.exists() {
        return Err("Dashboard DB not found".to_string());
    }
    rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Failed to open dashboard DB: {}", e))
}

/// Compute a deterministic hash for a table's content.
/// Uses SipHash (DefaultHasher) — same binary, same result.
pub fn compute_table_hash(conn: &rusqlite::Connection, table: &str) -> String {
    let sql = match table {
        "projects" => {
            "SELECT COALESCE(group_concat(name || '|' || updated_at, ';'), '') \
             FROM (SELECT name, updated_at FROM projects ORDER BY name)"
        }
        "applications" => {
            "SELECT COALESCE(group_concat(executable_name || '|' || updated_at, ';'), '') \
             FROM (SELECT executable_name, updated_at FROM applications ORDER BY executable_name)"
        }
        "sessions" => {
            "SELECT COALESCE(group_concat(app_name || '|' || start_time || '|' || updated_at, ';'), '') \
             FROM (SELECT a.executable_name AS app_name, s.start_time, s.updated_at \
                   FROM sessions s JOIN applications a ON s.app_id = a.id \
                   ORDER BY a.executable_name, s.start_time)"
        }
        "manual_sessions" => {
            "SELECT COALESCE(group_concat(title || '|' || start_time || '|' || updated_at, ';'), '') \
             FROM (SELECT title, start_time, updated_at FROM manual_sessions ORDER BY title, start_time)"
        }
        _ => return String::new(),
    };
    let concat: String = conn.query_row(sql, [], |row| row.get(0))
        .unwrap_or_else(|_| String::new());
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    concat.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// Compute hashes for all 4 sync tables.
pub fn compute_tables_hash_string(conn: &rusqlite::Connection) -> String {
    let tables = ["projects", "applications", "sessions", "manual_sessions"];
    let mut combined = String::new();
    for table in &tables {
        combined.push_str(&compute_table_hash(conn, table));
    }
    combined
}

/// Generate a marker hash from tables_hash + timestamp + device_id.
pub fn generate_marker_hash(tables_hash: &str, timestamp: &str, device_id: &str) -> String {
    let input = format!("{}{}{}", tables_hash, timestamp, device_id);
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    input.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}
```

- [ ] **Step 2: Dodaj `mod lan_common;` do `src/main.rs`**

Dodaj linię `mod lan_common;` obok istniejących deklaracji modułów (np. obok `mod lan_server;`).

- [ ] **Step 3: Commit**

```bash
git add src/lan_common.rs src/main.rs
git commit -m "feat: create lan_common.rs with shared LAN sync utilities"
```

---

### Task 2: Podłącz `lan_common` — usuń duplikaty z 3 plików [DRY — raport §3.1, §3.2]

**Files:**
- Modify: `src/lan_server.rs` — usuń `get_device_id`, `get_machine_name`, `sync_log`, `open_dashboard_db`, `compute_table_hash`, `build_table_hashes`; użyj `crate::lan_common::*`
- Modify: `src/lan_sync_orchestrator.rs` — usuń `get_device_id`, `get_machine_name`, `sync_log`, `open_dashboard_db`, `compute_single_table_hash`, `compute_tables_hash_string`, `generate_marker_hash_simple`; użyj `crate::lan_common::*`
- Modify: `src/lan_discovery.rs` — użyj `crate::lan_common::{get_device_id, get_machine_name}`

- [ ] **Step 1: W `lan_server.rs`**

Dodaj na górze:
```rust
use crate::lan_common;
```

Zamień ciała zduplikowanych funkcji na delegacje:
- `get_device_id()` → `lan_common::get_device_id()`
- `get_machine_name()` → `lan_common::get_machine_name()`
- `sync_log(msg)` → `lan_common::sync_log(msg)`
- `open_dashboard_db()` → `lan_common::open_dashboard_db()`
- `compute_table_hash(conn, table)` → `lan_common::compute_table_hash(conn, table)`
- `build_table_hashes(conn)` — inline użyj `lan_common::compute_table_hash`

Zachowaj prywatne wrappery (inline fn), żeby nie zmieniać sygnatur w reszcie pliku. Przykład:

```rust
fn get_device_id() -> String { lan_common::get_device_id() }
fn get_machine_name() -> String { lan_common::get_machine_name() }
fn sync_log(msg: &str) { lan_common::sync_log(msg) }
fn open_dashboard_db() -> Result<rusqlite::Connection, String> { lan_common::open_dashboard_db() }
```

Zachowaj `open_dashboard_db_readonly()` — ta jest unikalna.

- [ ] **Step 2: W `lan_sync_orchestrator.rs`**

Dodaj `use crate::lan_common;` i zamień:
- `sync_log` (linia 16-26) → `fn sync_log(msg: &str) { lan_common::sync_log(msg) }`
- `get_device_id` (401-414) → `fn get_device_id() -> String { lan_common::get_device_id() }`
- `get_machine_name` (416-418) → `fn get_machine_name() -> String { lan_common::get_machine_name() }`
- `open_dashboard_db` (440-447) → `fn open_dashboard_db() -> Result<rusqlite::Connection, String> { lan_common::open_dashboard_db() }`
- `compute_single_table_hash` (811-824) → `fn compute_single_table_hash(conn: &rusqlite::Connection, table: &str) -> String { lan_common::compute_table_hash(conn, table) }`
- `compute_tables_hash_string` (800-809) — zmień na wersję przyjmującą `&Connection`:
```rust
fn compute_tables_hash_string_with_conn(conn: &rusqlite::Connection) -> String {
    lan_common::compute_tables_hash_string(conn)
}
// Zachowaj bezparametrową wersję jako wrapper:
fn compute_tables_hash_string() -> Result<String, String> {
    let conn = open_dashboard_db()?;
    Ok(lan_common::compute_tables_hash_string(&conn))
}
```
- `generate_marker_hash_simple` (826-832) → `fn generate_marker_hash_simple(t: &str, ts: &str, d: &str) -> String { lan_common::generate_marker_hash(t, ts, d) }`

- [ ] **Step 3: W `lan_discovery.rs`**

Dodaj `use crate::lan_common;` i zamień:
- `get_or_create_device_id()` — zachowaj logikę tworzenia pliku, ale wydziel odczyt do `lan_common::get_device_id()`
- `get_machine_name()` → deleguj do `lan_common::get_machine_name()`

- [ ] **Step 4: Zbuduj i sprawdź kompilację**

```bash
cd c:/_cloud/__cfab_demon/__client && cargo check 2>&1
```

- [ ] **Step 5: Commit**

```bash
git add src/lan_server.rs src/lan_sync_orchestrator.rs src/lan_discovery.rs
git commit -m "refactor: deduplicate LAN sync functions via lan_common module"
```

---

### Task 3: Napraw SQL injection w `build_delta_for_pull` [KRYTYCZNY — raport §1.1]

**Files:**
- Modify: `src/lan_server.rs:764-796`

- [ ] **Step 1: Zamień `format!()` na parametryzowane zapytania**

W `build_delta_for_pull()` zamień 3 zapytania z interpolacją stringa na wersje z `rusqlite::params![]`:

```rust
fn build_delta_for_pull(conn: &rusqlite::Connection, since: &str) -> Result<String, String> {
    let since_norm = since.replace('T', " ");
    let since_ref = if since_norm.len() > 19 { &since_norm[..19] } else { &since_norm };

    let projects = fetch_all_rows(conn, "SELECT id, name, color, hourly_rate, created_at, excluded_at, frozen_at, assigned_folder_path, updated_at FROM projects ORDER BY name")?;
    let apps = fetch_all_rows(conn, "SELECT id, executable_name, display_name, project_id, updated_at FROM applications ORDER BY executable_name")?;

    // FIXED: use parameterized queries instead of format!()
    let sessions = fetch_all_rows_params(conn,
        "SELECT s.id, s.app_id, s.project_id, s.start_time, s.end_time, s.duration_seconds, \
         s.date, s.rate_multiplier, s.comment, s.is_hidden, s.updated_at \
         FROM sessions s WHERE s.updated_at >= ?1 ORDER BY s.start_time",
        rusqlite::params![since_ref]
    )?;

    let manual = fetch_all_rows_params(conn,
        "SELECT id, title, session_type, project_id, app_id, start_time, end_time, \
         duration_seconds, date, created_at, updated_at \
         FROM manual_sessions WHERE updated_at >= ?1 ORDER BY start_time",
        rusqlite::params![since_ref]
    )?;

    let tombstones = fetch_all_rows_params(conn,
        "SELECT id, table_name, record_id, record_uuid, deleted_at, sync_key \
         FROM tombstones WHERE deleted_at >= ?1 ORDER BY deleted_at",
        rusqlite::params![since_ref]
    )?;

    // ... rest unchanged
}
```

- [ ] **Step 2: Dodaj `fetch_all_rows_params` obok istniejącego `fetch_all_rows`**

```rust
fn fetch_all_rows_params(conn: &rusqlite::Connection, sql: &str, params: &[&dyn rusqlite::types::ToSql]) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let col_count = stmt.column_count();
    let col_names: Vec<String> = (0..col_count)
        .map(|i| stmt.column_name(i).unwrap_or("?").to_string())
        .collect();

    let rows = stmt.query_map(params, |row| {
        let mut map = serde_json::Map::new();
        for (i, name) in col_names.iter().enumerate() {
            let val: rusqlite::types::Value = row.get(i)?;
            map.insert(name.clone(), match val {
                rusqlite::types::Value::Null => serde_json::Value::Null,
                rusqlite::types::Value::Integer(n) => serde_json::json!(n),
                rusqlite::types::Value::Real(f) => serde_json::json!(f),
                rusqlite::types::Value::Text(s) => serde_json::json!(s),
                rusqlite::types::Value::Blob(b) => serde_json::json!(base64::encode(&b)),
            });
        }
        Ok(serde_json::Value::Object(map))
    }).map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}
```

Uwaga: Sprawdź jak wygląda istniejąca `fetch_all_rows` — jeśli już robi to samo, ale z `[]` params, to po prostu zmień sygnaturę istniejącej funkcji, żeby akceptowała `params`. Albo dodaj nową obok.

- [ ] **Step 3: Usuń `_device_id` z `build_delta_for_pull_public`**

```rust
pub fn build_delta_for_pull_public(conn: &rusqlite::Connection, since: &str) -> Result<String, String> {
    build_delta_for_pull(conn, since)
}
```

Zaktualizuj wywołanie w `lan_sync_orchestrator.rs:858`.

- [ ] **Step 4: Zbuduj i sprawdź**

```bash
cargo check 2>&1
```

- [ ] **Step 5: Commit**

```bash
git add src/lan_server.rs src/lan_sync_orchestrator.rs
git commit -m "fix(security): replace SQL string interpolation with parameterized queries in build_delta_for_pull"
```

---

### Task 4: Napraw mapowanie app_id/project_id w merge [KRYTYCZNY — raport §1.2]

**Files:**
- Modify: `src/lan_sync_orchestrator.rs:487-760` — funkcja `merge_incoming_data`

- [ ] **Step 1: Dodaj budowanie map ID po merge projektów i aplikacji**

Po merge projektów (linia ~548) i aplikacji (linia ~590), dodaj budowanie map:

```rust
fn merge_incoming_data(slave_data: &str) -> Result<(), String> {
    let archive: serde_json::Value = serde_json::from_str(slave_data)
        .map_err(|e| format!("Failed to parse slave data: {}", e))?;

    // ... (log counts — unchanged) ...

    let mut conn = open_dashboard_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // --- Merge projects (unchanged — by name) ---
    // ... existing project merge code ...

    // --- Merge applications (unchanged — by executable_name) ---
    // ... existing app merge code ...

    // --- Build ID maps for session merge ---
    // Map: remote app executable_name → local app_id
    let mut app_name_to_local_id: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    {
        let mut stmt = tx.prepare("SELECT id, executable_name FROM applications")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| e.to_string())?;
        for row in rows {
            if let Ok((id, name)) = row {
                app_name_to_local_id.insert(name, id);
            }
        }
    }

    // Map: remote app_id → executable_name (from incoming data)
    let mut remote_app_id_to_name: std::collections::HashMap<i64, String> = std::collections::HashMap::new();
    if let Some(apps) = archive.pointer("/data/applications").and_then(|v| v.as_array()) {
        for app in apps {
            let remote_id = app.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let exe_name = app.get("executable_name").and_then(|v| v.as_str()).unwrap_or("");
            if remote_id > 0 && !exe_name.is_empty() {
                remote_app_id_to_name.insert(remote_id, exe_name.to_string());
            }
        }
    }

    // Map: remote project name → local project_id
    let mut project_name_to_local_id: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    {
        let mut stmt = tx.prepare("SELECT id, name FROM projects")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| e.to_string())?;
        for row in rows {
            if let Ok((id, name)) = row {
                project_name_to_local_id.insert(name, id);
            }
        }
    }

    // Map: remote project_id → name (from incoming data)
    let mut remote_project_id_to_name: std::collections::HashMap<i64, String> = std::collections::HashMap::new();
    if let Some(projects) = archive.pointer("/data/projects").and_then(|v| v.as_array()) {
        for proj in projects {
            let remote_id = proj.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let name = proj.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if remote_id > 0 && !name.is_empty() {
                remote_project_id_to_name.insert(remote_id, name.to_string());
            }
        }
    }

    // Helper: resolve remote app_id to local app_id
    let resolve_app_id = |remote_app_id: i64| -> Option<i64> {
        let exe_name = remote_app_id_to_name.get(&remote_app_id)?;
        app_name_to_local_id.get(exe_name).copied()
    };

    // Helper: resolve remote project_id to local project_id
    let resolve_project_id = |remote_project_id: Option<i64>| -> Option<i64> {
        let remote_id = remote_project_id?;
        let name = remote_project_id_to_name.get(&remote_id)?;
        project_name_to_local_id.get(name).copied()
    };

    // --- Merge sessions (FIXED: use local IDs) ---
    if let Some(sessions) = archive.pointer("/data/sessions").and_then(|v| v.as_array()) {
        for sess in sessions {
            let remote_app_id = sess.get("app_id").and_then(|v| v.as_i64()).unwrap_or(0);
            let start_time = sess.get("start_time").and_then(|v| v.as_str()).unwrap_or("");
            let updated_at = sess.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
            if start_time.is_empty() || remote_app_id == 0 { continue; }

            let local_app_id = match resolve_app_id(remote_app_id) {
                Some(id) => id,
                None => {
                    sync_log(&format!("  SKIP sesja (brak lokalnego app_id dla remote={})", remote_app_id));
                    continue;
                }
            };
            let local_project_id = resolve_project_id(sess.get("project_id").and_then(|v| v.as_i64()));

            let existing: Option<(i64, Option<String>)> = tx
                .query_row(
                    "SELECT id, updated_at FROM sessions WHERE app_id = ?1 AND start_time = ?2",
                    rusqlite::params![local_app_id, start_time],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .ok();

            match existing {
                Some((id, local_ts)) => {
                    let local = local_ts.as_deref().unwrap_or("");
                    if updated_at > local {
                        tx.execute(
                            "UPDATE sessions SET end_time = ?1, duration_seconds = ?2, \
                             rate_multiplier = ?3, comment = ?4, is_hidden = ?5, \
                             updated_at = ?6 WHERE id = ?7",
                            rusqlite::params![
                                json_str_opt(sess, "end_time"),
                                json_i64(sess, "duration_seconds"),
                                json_f64(sess, "rate_multiplier"),
                                json_str_opt(sess, "comment"),
                                json_i64(sess, "is_hidden"),
                                updated_at,
                                id,
                            ],
                        ).map_err(|e| e.to_string())?;
                    }
                }
                None => {
                    tx.execute(
                        "INSERT OR IGNORE INTO sessions (app_id, project_id, start_time, end_time, \
                         duration_seconds, date, rate_multiplier, comment, is_hidden, updated_at) \
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                        rusqlite::params![
                            local_app_id,
                            local_project_id,
                            start_time,
                            json_str_opt(sess, "end_time"),
                            json_i64(sess, "duration_seconds"),
                            json_str(sess, "date"),
                            json_f64(sess, "rate_multiplier"),
                            json_str_opt(sess, "comment"),
                            json_i64(sess, "is_hidden"),
                            updated_at,
                        ],
                    ).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    // --- Merge manual_sessions (FIXED: resolve project_id and app_id) ---
    if let Some(manual_sessions) = archive.pointer("/data/manual_sessions").and_then(|v| v.as_array()) {
        for ms in manual_sessions {
            let title = ms.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let start_time = ms.get("start_time").and_then(|v| v.as_str()).unwrap_or("");
            let updated_at = ms.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
            let local_project_id = resolve_project_id(ms.get("project_id").and_then(|v| v.as_i64()));
            let local_app_id = ms.get("app_id").and_then(|v| v.as_i64())
                .and_then(|rid| resolve_app_id(rid));
            if title.is_empty() || start_time.is_empty() { continue; }

            // ... rest of manual_sessions merge stays the same, but use local_project_id and local_app_id
            // instead of json_i64_opt(ms, "project_id") and json_i64_opt(ms, "app_id")
        }
    }

    // --- Merge tombstones (unchanged) ---
    // ... existing tombstone code ...

    tx.commit().map_err(|e| e.to_string())?;
    sync_log("  Scalanie zakonczone — commit transakcji");
    Ok(())
}
```

- [ ] **Step 2: Zbuduj i sprawdź**

```bash
cargo check 2>&1
```

- [ ] **Step 3: Commit**

```bash
git add src/lan_sync_orchestrator.rs
git commit -m "fix(critical): resolve remote app_id/project_id to local IDs during LAN merge"
```

---

### Task 5: Napraw freeze rollback [ŚREDNI — raport §2.4]

**Files:**
- Modify: `src/lan_sync_orchestrator.rs:284-290`

- [ ] **Step 1: Dodaj rollback mastera gdy freeze slave'a nie powiedzie się**

W `execute_master_sync`, po `sync_state.freeze()`, zamień:

```rust
// Przed (obecny kod):
sync_state.freeze();
http_post(&format!("{}/lan/freeze-ack", base_url), "{}")
    .map_err(|e| { sync_log(&format!("[5/13] BLAD freeze slave: {}", e)); e })?;
```

Na:

```rust
sync_state.freeze();
if let Err(e) = http_post(&format!("{}/lan/freeze-ack", base_url), "{}") {
    sync_log(&format!("[5/13] BLAD freeze slave: {} — rollback master freeze", e));
    sync_state.unfreeze();
    return Err(e);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lan_sync_orchestrator.rs
git commit -m "fix: rollback master freeze when slave freeze fails"
```

---

### Task 6: Napraw backoff z respektowaniem stop_signal [ŚREDNI — raport §5.2]

**Files:**
- Modify: `src/lan_sync_orchestrator.rs:212-215`

- [ ] **Step 1: Zamień `thread::sleep(backoff)` na pętlę sprawdzającą stop_signal**

```rust
if attempt < MAX_RETRIES {
    let backoff = Duration::from_secs(5 * 3u64.pow(attempt - 1));
    sync_log(&format!("[!] Ponowienie za {:?}...", backoff));
    // Sleep in 1s increments, checking stop_signal
    let deadline = Instant::now() + backoff;
    while Instant::now() < deadline {
        if stop_signal.load(Ordering::Relaxed) {
            sync_log("[!] Stop signal podczas backoff — przerywam");
            return;
        }
        thread::sleep(Duration::from_secs(1));
    }
}
```

Uwaga: Kontekst to closure w `run_sync_as_master_with_options` — `stop_signal` jest dostępny.

- [ ] **Step 2: Commit**

```bash
git add src/lan_sync_orchestrator.rs
git commit -m "fix: respect stop_signal during sync backoff sleep"
```

---

### Task 7: Jedno połączenie DB w execute_master_sync [WYDAJNOŚĆ — raport §4.1]

**Files:**
- Modify: `src/lan_sync_orchestrator.rs`

- [ ] **Step 1: Zmień sygnatury funkcji, żeby przyjmowały `&Connection`**

Dodaj warianty z `conn` parametrem dla:
- `get_local_marker_hash(&conn)`
- `get_local_marker_created_at(&conn)`
- `backup_database()` — ta musi otworzyć własne (VACUUM INTO wymaga)
- `merge_incoming_data(slave_data, &mut conn)` — zmień na `conn` parametr
- `verify_merge_integrity(&conn)`
- `compute_tables_hash_string(&conn)` — już mamy wersję z `lan_common`
- `insert_sync_marker_db(..., &conn)`
- `build_full_export(&conn)`

Główna zmiana w `execute_master_sync`:

```rust
fn execute_master_sync(peer: &PeerTarget, sync_state: &LanSyncState, stop_signal: &AtomicBool, force: bool) -> Result<(), String> {
    let base_url = format!("http://{}:{}", peer.ip, peer.port);
    let sync_start = Instant::now();

    // Open single DB connection for entire sync flow
    let mut conn = open_dashboard_db()?;

    // Step 3: Negotiate
    sync_state.set_progress(3, "negotiating", "local");
    let device_id = get_device_id();
    let local_marker = get_local_marker_hash_with_conn(&conn);
    // ... rest uses &conn / &mut conn everywhere ...
}
```

- [ ] **Step 2: Zbuduj i sprawdź**

```bash
cargo check 2>&1
```

- [ ] **Step 3: Commit**

```bash
git add src/lan_sync_orchestrator.rs
git commit -m "perf: use single DB connection throughout execute_master_sync"
```

---

### Task 8: Usuń fikcyjny port z UI [ŚREDNI — raport §2.5]

**Files:**
- Modify: `dashboard/src/components/settings/LanSyncCard.tsx` — ukryj pole portu (comment out lub usuń)
- Modify: `dashboard/src/pages/Settings.tsx` — usuń `onPortChange` prop

- [ ] **Step 1: W `LanSyncCard.tsx` ukryj sekcję portu**

Zakomentuj lub usuń sekcję z polem portu (znajdź `portLabel` prop i powiązany input).

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/components/settings/LanSyncCard.tsx dashboard/src/pages/Settings.tsx
git commit -m "fix: remove non-functional port setting from LAN sync UI"
```

---

### Task 9: Napraw problemy React/TypeScript [ŚREDNI/NISKI — raport §4.4, §6.1, §6.2, §4.8, §4.9]

**Files:**
- Modify: `dashboard/src/pages/Settings.tsx`

- [ ] **Step 1: Usuń podwójny polling — wyrzuć pętlę while z `handleLanSync`**

Zamień `handleLanSync` — usuń polling while-loop (linie 198-213), bo `LanSyncCard` już polluje progress:

```typescript
const handleLanSync = useCallback(async (peer: LanPeer, fullSync = false, force = false) => {
    setLanSyncing(true);
    setLanSyncResult(null);
    try {
      const state = loadLanSyncState();
      const since = (fullSync || force)
        ? '1970-01-01T00:00:00Z'
        : (state.peerSyncTimes?.[peer.device_id] || state.lastSyncAt || '1970-01-01T00:00:00Z');

      await lanSyncApi.runLanSync(peer.ip, peer.dashboard_port, since, force);
      // LanSyncCard already polls progress — no need to poll here.
      // Just record the sync and let the card handle completion detection.
      recordPeerSync(peer);
      const label = force ? 'Force sync' : fullSync ? 'Full sync' : 'Sync';
      setLanSyncResult({ text: `${label} — OK`, success: true });
      triggerRefresh('lan_sync_pull');
    } catch (e) {
      setLanSyncResult({ text: e instanceof Error ? e.message : String(e), success: false });
    } finally {
      setLanSyncing(false);
    }
  }, [triggerRefresh]); // FIXED: removed lanPeers from deps
```

- [ ] **Step 2: Napraw `loadLanSyncState()` w renderze — użyj `useMemo`**

```typescript
const lastSyncAt = useMemo(() => loadLanSyncState().lastSyncAt, [lanSyncing]);
```

Potem w JSX zamień `lastSyncAt={loadLanSyncState().lastSyncAt}` na `lastSyncAt={lastSyncAt}`.

- [ ] **Step 3: Wyodrębnij `syncPhaseLabels` do `useMemo`**

```typescript
const syncPhaseLabels = useMemo(() => ({
    sync_phase_idle: t('settings.lan_sync.sync_phase_idle'),
    sync_phase_starting: t('settings.lan_sync.sync_phase_starting'),
    sync_phase_negotiating: t('settings.lan_sync.sync_phase_negotiating'),
    sync_phase_negotiated: t('settings.lan_sync.sync_phase_negotiated'),
    sync_phase_freezing: t('settings.lan_sync.sync_phase_freezing'),
    sync_phase_downloading: t('settings.lan_sync.sync_phase_downloading'),
    sync_phase_received: t('settings.lan_sync.sync_phase_received'),
    sync_phase_backup: t('settings.lan_sync.sync_phase_backup'),
    sync_phase_merging: t('settings.lan_sync.sync_phase_merging'),
    sync_phase_verifying: t('settings.lan_sync.sync_phase_verifying'),
    sync_phase_uploading: t('settings.lan_sync.sync_phase_uploading'),
    sync_phase_slave_downloading: t('settings.lan_sync.sync_phase_slave_downloading'),
    sync_phase_completed: t('settings.lan_sync.sync_phase_completed'),
  }), [t]);
```

W JSX zamień inline obiekt na `syncPhaseLabels={syncPhaseLabels}`.

- [ ] **Step 4: Napraw `JSON.stringify` porównanie peerów**

```typescript
const poll = () => {
    lanSyncApi.getLanPeers().then((peers) => {
      setLanPeers((prev) => {
        if (prev.length !== peers.length) return peers;
        const changed = peers.some((p, i) =>
          p.device_id !== prev[i]?.device_id ||
          p.dashboard_running !== prev[i]?.dashboard_running ||
          p.ip !== prev[i]?.ip
        );
        return changed ? peers : prev;
      });
    }).catch(() => {});
  };
```

- [ ] **Step 5: Sprawdź TypeScript**

```bash
cd c:/_cloud/__cfab_demon/__client/dashboard && npx tsc --noEmit 2>&1
```

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/pages/Settings.tsx
git commit -m "fix: remove duplicate polling, fix React performance issues in Settings"
```

---

### Task 10: Napraw brakujące tłumaczenia w LanSyncCard [ŚREDNI — raport §7]

**Files:**
- Modify: `dashboard/src/locales/en/common.json`
- Modify: `dashboard/src/locales/pl/common.json`
- Modify: `dashboard/src/components/settings/LanSyncCard.tsx`
- Modify: `dashboard/src/pages/Settings.tsx`

- [ ] **Step 1: Dodaj klucze i18n**

W `en/common.json`, w sekcji `settings.lan_sync`:
```json
"slave_info": "This device is in slave mode — synchronization is initiated by the master.",
"show_log": "Show Log",
"hide_log": "Hide Log",
"no_log_entries": "(no log entries yet)",
"force_merge_tooltip": "Force merge — ignores hash comparison"
```

W `pl/common.json`, w sekcji `settings.lan_sync`:
```json
"slave_info": "To urządzenie jest w trybie slave — synchronizacja jest inicjowana przez mastera.",
"show_log": "Pokaż logi",
"hide_log": "Ukryj logi",
"no_log_entries": "(brak wpisów w logu)",
"force_merge_tooltip": "Wymuś scalanie — ignoruje porównanie hashy"
```

- [ ] **Step 2: Zaktualizuj `LanSyncCard.tsx` — dodaj nowe props i użyj ich**

Dodaj props: `slaveInfoText`, `showLogLabel`, `hideLogLabel`, `noLogEntriesText`, `forceMergeTooltip`.

Zamień hardcoded stringi:
- Linia 429-431: `<p ...>{slaveInfoText}</p>`
- Linia 546: `{showLog ? hideLogLabel : showLogLabel}`
- Linia 555: `{syncLog || noLogEntriesText}`
- Linia 503: `title={forceMergeTooltip}`

- [ ] **Step 3: W `Settings.tsx` przekaż nowe props**

```tsx
slaveInfoText={t('settings.lan_sync.slave_info')}
showLogLabel={t('settings.lan_sync.show_log')}
hideLogLabel={t('settings.lan_sync.hide_log')}
noLogEntriesText={t('settings.lan_sync.no_log_entries')}
forceMergeTooltip={t('settings.lan_sync.force_merge_tooltip')}
```

- [ ] **Step 4: Sprawdź TypeScript**

```bash
cd c:/_cloud/__cfab_demon/__client/dashboard && npx tsc --noEmit 2>&1
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/locales/en/common.json dashboard/src/locales/pl/common.json dashboard/src/components/settings/LanSyncCard.tsx dashboard/src/pages/Settings.tsx
git commit -m "fix(i18n): replace hardcoded strings in LanSyncCard with translation keys"
```

---

## Poza zakresem tego planu (wymagają osobnego podejścia)

Poniższe pozycje z raportu **NIE** są w tym planie, bo wymagają głębszych zmian architektonicznych lub osobnej decyzji:

| # | Problem | Powód pominięcia |
|---|---------|-----------------|
| §2.1 | Slave nie pobiera scalonych danych | Wymaga redesignu protokołu (push vs pull) — osobny plan |
| §2.2 | `DefaultHasher` nie jest deterministyczny cross-platform | Obecny system działa w obrębie jednego binary — problem pojawi się dopiero przy mieszanych wersjach Rust. Warto naprawić, ale nie jest krytyczny teraz |
| §2.3 | Race condition w elekcji | Rzadki edge case, wymaga testów integracyjnych |
| §2.6 | `handle_push`/`import_push_data` stub | Dead path, nie jest używany |
| §3.3 | Dwie implementacje merge | Daemon jest aktywna, Tauri jest dead_code — po naprawie §1.2 daemon ma poprawną logikę |
| §4.2 | `compute_table_hash` concatenuje wszystko | Wymaga redesignu cache/streaming |
| §4.3 | Pełny eksport przy delta sync | Powiązane z §2.1 |
| §4.6 | Brak kompresji transferu | Nice-to-have, osobny task |
| §4.7 | Nowe połączenie TCP per krok | Wymaga persistent connections |
| §5.1 | Role jako stringi zamiast enum | Duży refactor (3 pliki, wiele porównań) |
| §5.5 | Blokujący I/O w async Tauri | Wymaga `tokio::fs` + refactor |
| §9 | Dead code w Tauri lan_sync.rs | Osobny cleanup task |
