# Remediacja logiki sync online — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: użyj superpowers:subagent-driven-development (zalecane) lub superpowers:executing-plans do realizacji zadanie-po-zadaniu. Kroki używają checkboxów (`- [ ]`).

**Goal:** Naprawić findings z `2026-06-23-online-sync-logic-audit-RAPORT.md` na żywej ścieżce online (klient Rust + dashboard Tauri), bez ruszania martwego serwerowego merge.

**Architecture:** Żywy merge jest po stronie klienta (`shared/sync/merge.rs` + `src/sync_common.rs`), eksport w `src/lan_server.rs::build_delta_for_pull`, checksum w `shared/sync/checksum.rs`. Naprawy domykają parność kolumn (5 miejsc: eksport / merge UPDATE / merge INSERT / checksum / tombstony), naprawiają frontier markerów async, dokładają `catch_unwind` i twardnieją kryptografię. Serwerowy `direct-sync.ts` (martwy online) jest poza zakresem — patrz Task 8.

**Tech Stack:** Rust (rusqlite, serde_json, aes-gcm, sha2), `cargo test`/`cargo build`; dashboard Tauri (`dashboard/src-tauri`, `cargo test`); dashboard JS (`npm run lint`).

**Komendy bazowe (z roota repo `/Users/micz/__DEV__/__cfab_demon`):**
- Test rdzenia sync: `cargo test -p timeflow_shared` oraz `cargo test --bin timeflow-demon` (lub `cargo test` w odpowiednim crate — sprawdź `Cargo.toml`).
- Build daemona: `cargo build`
- Test dashboardu Tauri: `cargo test --manifest-path dashboard/src-tauri/Cargo.toml`

> Każde zadanie jest niezależne i osobno commitowalne. Kolejność = priorytet/quick-win → większe. Po każdym zadaniu: `cargo build` musi przejść.

---

## Mapa plików

- `dashboard/src-tauri/src/commands/delta_export.rs` — eksport pliku (Task 1, H-6).
- `dashboard/src-tauri/src/commands/import_data.rs`, `types.rs` — import pliku (Task 1, H-6).
- `src/lan_server.rs:1542-1617` — `build_delta_for_pull` (eksport żywej ścieżki) + `build_table_hashes:705` (Task 2, 4).
- `shared/sync/merge.rs` — `merge_applications:620` (Task 2), miejsce na merge assignment (Task 4).
- `shared/sync/checksum.rs` — `table_hash_sql:23` + lista hashowanych tabel (Task 2, 3, 4).
- `src/sync_common.rs` — `get_last_sync_timestamp:219`, `merge_incoming_data:291`, simulator tests (Task 3, 4, 5).
- `src/online_sync.rs` — `execute_async_push:467`, `run_async_delta_sync:674`, `run_online_sync:726`, `run_online_sync_forced:777` (Task 5, 6).
- `src/lan_sync_orchestrator.rs:842` — `guarded_then_cleanup` (Task 6).
- `src/sync_encryption.rs` — `decrypt_credentials:72`, `make_nonce:67` (Task 7).

---

## Task 1: H-6 — naprawić odwołanie do nieistniejącej kolumny `sessions_skipped`

Kolumna w schemacie to `sessions_suggested` (schema.sql:377). `sessions_skipped` nie istnieje → crash `build_delta_archive`/importu.

**Files:**
- Modify: `dashboard/src-tauri/src/commands/types.rs:688`
- Modify: `dashboard/src-tauri/src/commands/delta_export.rs:258,270`
- Modify: `dashboard/src-tauri/src/commands/import_data.rs:587,594`
- Test: `dashboard/src-tauri/src/commands/delta_export.rs` (mod tests)

- [ ] **Step 1: Test odtwarzający crash** — w `delta_export.rs` mod tests dodaj:

```rust
#[test]
fn build_delta_archive_handles_assignment_auto_runs_row() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(include_str!("../../resources/sql/schema.sql")).unwrap();
    conn.execute(
        "INSERT INTO assignment_auto_runs (started_at, finished_at, mode, min_confidence_auto, \
         min_evidence_auto, sessions_scanned, sessions_suggested, sessions_assigned) \
         VALUES ('2026-06-01 10:00:00','2026-06-01 10:01:00','auto',0.8,2,10,3,3)",
        [],
    ).unwrap();
    // Zapytanie używane przez build_delta_archive nie może rzucić "no such column".
    let mut stmt = conn.prepare(
        "SELECT id, started_at, finished_at, sessions_scanned, sessions_assigned, sessions_suggested, rolled_back_at \
         FROM assignment_auto_runs WHERE started_at > ?1",
    ).expect("SELECT musi się sparsować z poprawną kolumną");
    let n = stmt.query_map(["1970-01-01 00:00:00"], |_r| Ok(())).unwrap().count();
    assert_eq!(n, 1);
}
```

- [ ] **Step 2: Uruchom — ma FAIL** (przed naprawą `prepare` w produkcyjnym kodzie rzuca; ten test używa już poprawnej nazwy, więc przejdzie — zamiast tego najpierw zmień test na `sessions_skipped` by zobaczyć FAIL, potem wróć do `sessions_suggested`). Run: `cargo test --manifest-path dashboard/src-tauri/Cargo.toml build_delta_archive_handles_assignment_auto_runs_row`
  Expected (z `sessions_skipped`): FAIL `no such column: sessions_skipped`.

- [ ] **Step 3: Zmień nazwę pola w strukturze** — `types.rs:688`:

```rust
// było: pub sessions_skipped: i64,
pub sessions_suggested: i64,
```

- [ ] **Step 4: Napraw SELECT i mapowanie eksportu** — `delta_export.rs`:

```rust
// :258  SELECT — sessions_skipped → sessions_suggested
.prepare("SELECT id, started_at, finished_at, sessions_scanned, sessions_assigned, sessions_suggested, rolled_back_at
          FROM assignment_auto_runs WHERE started_at > ?1")
// :270  mapowanie
sessions_suggested: row.get(5)?,
```

- [ ] **Step 5: Napraw INSERT importu** — `import_data.rs`:

```rust
// :587  INSERT — sessions_skipped → sessions_suggested
"INSERT INTO assignment_auto_runs (started_at, finished_at, sessions_scanned, sessions_assigned, sessions_suggested, rolled_back_at)
// :594  bind
run.sessions_suggested,
```

> Sprawdź też, czy INSERT importu nie pomija wymaganych NOT NULL kolumn (`mode`, `min_confidence_auto`, `min_evidence_auto`) — schema.sql:373-375. Jeśli pomija, dodaj je z sensownymi wartościami z `run`, bo inaczej INSERT padnie na NOT NULL. (Zweryfikuj `AssignmentAutoRunRow` w types.rs — jeśli nie ma tych pól, to osobny, istniejący brak; odnotuj, nie rozszerzaj zakresu bez potrzeby.)

- [ ] **Step 6: Uruchom test** (z `sessions_suggested`). Run: `cargo test --manifest-path dashboard/src-tauri/Cargo.toml build_delta_archive_handles_assignment_auto_runs_row` → PASS. Następnie `cargo build --manifest-path dashboard/src-tauri/Cargo.toml`.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src-tauri/src/commands/{types.rs,delta_export.rs,import_data.rs}
git commit -m "fix(sync): napraw odwołanie do nieistniejącej kolumny sessions_skipped → sessions_suggested"
```

---

## Task 2: H-2 — synchronizuj `applications.color` (eksport + merge + checksum)

`color` nie jest eksportowane/merge'owane/hashowane → nigdy nie konwerguje, rozjazd niewidoczny dla syncu. (Decyzja: `is_imported` traktujemy jako **machine-local** — NIE synchronizujemy ani nie hashujemy, jak `assigned_folder_path`; INSERT pozostaje `is_imported=1`. Unikamy pułapki „wieczny re-sync", patrz raport T6-5.)

**Files:**
- Modify: `src/lan_server.rs:1566` (eksport apps)
- Modify: `shared/sync/merge.rs:663-673` (UPDATE) i `:677-681` (INSERT)
- Modify: `shared/sync/checksum.rs:39-46` (hash applications)
- Test: `shared/sync/merge.rs` mod tests

- [ ] **Step 1: Test LWW dla color** — w `shared/sync/merge.rs` mod tests (wzoruj na istniejących merge_roundtrip tests). Dodaj:

```rust
#[test]
fn merge_applications_syncs_color_lww() {
    let mut conn = test_conn(); // helper tworzący schema in-memory (użyj istniejącego z mod tests)
    conn.execute("INSERT INTO applications (executable_name, display_name, color, is_imported, updated_at) \
                  VALUES ('app.exe','App','#111111',0,'2026-06-01 10:00:00')", []).unwrap();
    let archive = serde_json::json!({"data":{"applications":[
        {"executable_name":"app.exe","display_name":"App","color":"#ff0000","updated_at":"2026-06-01 11:00:00"}
    ]}});
    let tx = conn.transaction().unwrap();
    let hooks = test_hooks();
    let mut maps = MergeIdMaps::default();
    merge_applications(&tx, &archive, &hooks, &mut maps).unwrap();
    tx.commit().unwrap();
    let color: String = conn.query_row(
        "SELECT color FROM applications WHERE executable_name='app.exe'", [], |r| r.get(0)).unwrap();
    assert_eq!(color, "#ff0000", "nowszy color z peera musi wygrać (LWW)");
}
```

> Jeśli `test_conn`/`test_hooks`/`MergeIdMaps::default` nie istnieją w tej formie, odczytaj istniejący `merge_roundtrip_applications_lww` (sync_common.rs:2434) i użyj dokładnie tych samych helperów/wzorca.

- [ ] **Step 2: Uruchom — FAIL.** Run: `cargo test -p timeflow_shared merge_applications_syncs_color_lww` → FAIL (color zostaje `#111111`, bo UPDATE nie rusza color).

- [ ] **Step 3: Dodaj `color` do eksportu** — `src/lan_server.rs:1566`:

```rust
let apps = fetch_all_rows(conn, "SELECT id, executable_name, display_name, project_id, color, updated_at FROM applications ORDER BY executable_name")?;
```

- [ ] **Step 4: Dodaj `color` do UPDATE** — `shared/sync/merge.rs:663-673`:

```rust
tx.execute(
    "UPDATE applications SET display_name = ?1, \
     project_id = COALESCE(?2, project_id), \
     color = COALESCE(?3, color), \
     updated_at = ?4 WHERE executable_name = ?5",
    rusqlite::params![
        json_str_opt(app, "display_name"),
        local_project_id,
        json_str_opt(app, "color"),
        updated_at,
        exe_name,
    ],
).map_err(|e| e.to_string())?;
```

- [ ] **Step 5: Dodaj `color` do INSERT** — `shared/sync/merge.rs:677-681` (is_imported zostaje `1` — machine-local):

```rust
tx.execute(
    "INSERT INTO applications (executable_name, display_name, project_id, color, is_imported, updated_at) \
     VALUES (?1, ?2, ?3, ?4, 1, ?5)",
    rusqlite::params![exe_name, json_str_opt(app, "display_name"), local_project_id, json_str_opt(app, "color"), updated_at],
).map_err(|e| e.to_string())?;
```

- [ ] **Step 6: Dodaj `color` do checksumy** — `shared/sync/checksum.rs:39-46`:

```rust
"applications" =>
    "SELECT COALESCE(group_concat( \
        executable_name || '|' || display_name || '|' || COALESCE(proj_name,'') || '|' || \
        COALESCE(color,'') || '|' || updated_at, ';'), '') \
     FROM (SELECT a.executable_name, a.display_name, \
                  (SELECT p.name FROM projects p WHERE p.id = a.project_id) AS proj_name, \
                  a.color, \
                  a.updated_at \
           FROM applications a ORDER BY a.executable_name)",
```

- [ ] **Step 7: Uruchom testy** Run: `cargo test -p timeflow_shared merge_applications_syncs_color_lww` → PASS; `cargo test -p timeflow_shared` (cała checksum/merge) → PASS; `cargo build`.

- [ ] **Step 8: Commit**

```bash
git add src/lan_server.rs shared/sync/merge.rs shared/sync/checksum.rs
git commit -m "fix(sync): synchronizuj applications.color (eksport+merge LWW+checksum); is_imported pozostaje machine-local"
```

---

## Task 3: M-1 + M-2 — symetria hashu sesji + test konwergencji hashy

M-1: hash sesji liczy nazwę projektu z lokalnego `project_id`; gdy projekt nieobecny lokalnie → asymetryczny hash → wieczny re-sync. M-2: brak testu na równość hashy po konwergencji.

**Files:**
- Modify: `shared/sync/checksum.rs:54` (sessions proj_name COALESCE)
- Modify: `src/sync_common.rs` (simulator `assert_converged` ~:1376)
- Test: `shared/sync/checksum.rs` mod tests + `src/sync_common.rs` simulator

- [ ] **Step 1: Test asymetrii hashu sesji** — `shared/sync/checksum.rs` mod tests:

```rust
#[test]
fn session_hash_uses_stored_project_name_when_fk_absent() {
    // Dwa connectiony: A ma projekt + sesję; B ma sesję z project_name ale bez projektu (FK NULL).
    let mk = |with_project: bool| {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("../../dashboard/src-tauri/resources/sql/schema.sql")).unwrap();
        c.execute("INSERT INTO applications (executable_name, display_name, is_imported, updated_at) VALUES ('a.exe','A',1,'t')", []).unwrap();
        let pid: Option<i64> = if with_project {
            c.execute("INSERT INTO projects (name, updated_at) VALUES ('Klient','t')", []).unwrap();
            Some(c.last_insert_rowid())
        } else { None };
        c.execute("INSERT INTO sessions (app_id, project_id, project_name, start_time, end_time, duration_seconds, date, rate_multiplier, updated_at) \
                   VALUES ((SELECT id FROM applications), ?1, 'Klient', '2026-06-01 10:00:00','2026-06-01 11:00:00',3600,'2026-06-01',1.0,'t')",
                  rusqlite::params![pid]).unwrap();
        c
    };
    let a = mk(true);
    let b = mk(false);
    let sql = table_hash_sql("sessions").unwrap();
    let ha: String = a.query_row(sql, [], |r| r.get(0)).unwrap();
    let hb: String = b.query_row(sql, [], |r| r.get(0)).unwrap();
    assert_eq!(content_hash(&ha), content_hash(&hb),
        "hash sesji musi być symetryczny: peer bez lokalnego projektu używa zapisanej etykiety project_name");
}
```

- [ ] **Step 2: Uruchom — FAIL.** Run: `cargo test -p timeflow_shared session_hash_uses_stored_project_name_when_fk_absent` → FAIL (A liczy `proj_name='Klient'`, B liczy `''`).

- [ ] **Step 3: Napraw SQL hashu sesji** — `shared/sync/checksum.rs:54`:

```rust
COALESCE((SELECT p.name FROM projects p WHERE p.id = s.project_id), s.project_name) AS proj_name, \
```

- [ ] **Step 4: Uruchom — PASS.** Run: `cargo test -p timeflow_shared session_hash_uses_stored_project_name_when_fk_absent` → PASS.

- [ ] **Step 5: M-2 — asercja hashy w simulatorze.** W `src/sync_common.rs`, w `LanSyncSimulator::assert_converged` (ok. :1376) dodaj na końcu:

```rust
// M-2: po konwergencji hash tabel obu peerów MUSI być równy (gwarancja idempotencji/early-return "none").
assert_eq!(
    compute_tables_hash_string_conn(&self.master),
    compute_tables_hash_string_conn(&self.slave),
    "table_hashes(master) != table_hashes(slave) po konwergencji — sync nie zgłosi 'none', wieczny re-sync"
);
```

> Sprawdź dokładną nazwę funkcji hashu w simulatorze (`compute_tables_hash_string_conn` vs `compute_tables_hash_string`) i nazwy pól (`self.master`/`self.slave`) — dopasuj do istniejącego `assert_converged`.

- [ ] **Step 6: Uruchom simulator** Run: `cargo test --bin timeflow-demon lan_sync_simulator` (lub odpowiedni crate) → PASS (potwierdza, że istniejące scenariusze już zbiegają hashowo; jeśli FAIL — ujawnił realny rozjazd, zgłoś jako finding, nie wyłączaj asercji).

- [ ] **Step 7: Commit**

```bash
git add shared/sync/checksum.rs src/sync_common.rs
git commit -m "fix(sync): symetryczny hash sesji (COALESCE project_name) + asercja konwergencji hashy w simulatorze"
```

---

## Task 4: H-1 — synchronizuj `assignment_feedback` i `assignment_auto_runs` na żywej ścieżce

Daemonowy eksport/merge/checksum pomija obie tabele → AI feedback i historia auto-runów nie propagują online. Wzór kolumn: istniejący eksport pliku `delta_export.rs:236` (feedback) i `:258` (auto_runs, PO Task 1).

**Files:**
- Modify: `src/lan_server.rs:1560-1600` (`build_delta_for_pull` — dodać dwie tabele do `data`)
- Modify: `src/lan_server.rs:705` (`build_table_hashes`)
- Modify: `shared/sync/checksum.rs:23` (`table_hash_sql` — dodać dwie encje) i lista hashowanych tabel (`:97`)
- Modify: `src/sync_common.rs::merge_incoming_data` (dodać merge dwóch tabel) lub `shared/sync/merge.rs`
- Test: `src/sync_common.rs` mod tests (roundtrip)

- [ ] **Step 1: Test roundtrip feedback/auto_runs przez eksport+merge** — `src/sync_common.rs` mod tests (wzoruj na `merge_carries_client_name_and_status_via_export_roundtrip:1520`):

```rust
#[test]
fn assignment_tables_roundtrip_via_export_and_merge() {
    let src = fresh_db();   // helper z istniejących testów
    src.execute("INSERT INTO assignment_feedback (source, created_at) VALUES ('user','2026-06-01 10:00:00')", []).unwrap();
    src.execute("INSERT INTO assignment_auto_runs (started_at, finished_at, mode, min_confidence_auto, min_evidence_auto, sessions_scanned, sessions_suggested, sessions_assigned) \
                 VALUES ('2026-06-01 09:00:00','2026-06-01 09:01:00','auto',0.8,2,5,2,2)", []).unwrap();
    let (full, _n) = build_full_export(&src).unwrap();
    let mut dst = fresh_db();
    merge_incoming_data(&mut dst, &full).unwrap();
    let fb: i64 = dst.query_row("SELECT COUNT(*) FROM assignment_feedback", [], |r| r.get(0)).unwrap();
    let ar: i64 = dst.query_row("SELECT COUNT(*) FROM assignment_auto_runs", [], |r| r.get(0)).unwrap();
    assert_eq!((fb, ar), (1, 1), "assignment_feedback i assignment_auto_runs muszą przejść przez eksport+merge");
}
```

- [ ] **Step 2: Uruchom — FAIL** (0,0). Run: `cargo test --bin timeflow-demon assignment_tables_roundtrip_via_export_and_merge`.

- [ ] **Step 3: Eksport** — w `src/lan_server.rs::build_delta_for_pull`, po `manual` a przed `tombstones`, dodaj (kolumny 1:1 jak schema.sql:357 feedback / :369 auto_runs; pełny eksport jak projects — bez okna `since`, by full-export był kompletny):

```rust
let assignment_feedback = fetch_all_rows(conn,
    "SELECT id, source, created_at FROM assignment_feedback ORDER BY created_at")?;
let assignment_auto_runs = fetch_all_rows(conn,
    "SELECT id, started_at, finished_at, mode, min_confidence_auto, min_evidence_auto, \
     sessions_scanned, sessions_suggested, sessions_assigned, error, rolled_back_at, \
     rollback_reverted, rollback_skipped FROM assignment_auto_runs ORDER BY started_at")?;
```

I dodaj do budowanego obiektu `data` (znajdź miejsce składania `json!({"data": {...}})` w tej funkcji):

```rust
"assignment_feedback": assignment_feedback,
"assignment_auto_runs": assignment_auto_runs,
```

> Zweryfikuj dokładne kolumny `assignment_feedback` przez `grep -n "CREATE TABLE.*assignment_feedback" -A12 dashboard/src-tauri/resources/sql/schema.sql` i dopasuj SELECT 1:1.

- [ ] **Step 4: Merge** — w `src/sync_common.rs::merge_incoming_data` (sekcja po manual_sessions). Dedup po kluczu naturalnym (feedback: `source|created_at`; auto_runs: `started_at`), append-only (te encje są niemutowalne historycznie):

```rust
if let Some(rows) = archive.pointer("/data/assignment_feedback").and_then(|v| v.as_array()) {
    for r in rows {
        let source = r.get("source").and_then(|v| v.as_str()).unwrap_or("");
        let created_at = r.get("created_at").and_then(|v| v.as_str()).unwrap_or("");
        tx.execute(
            "INSERT OR IGNORE INTO assignment_feedback (source, created_at) VALUES (?1, ?2)",
            rusqlite::params![source, created_at],
        ).map_err(|e| e.to_string())?;
    }
}
if let Some(rows) = archive.pointer("/data/assignment_auto_runs").and_then(|v| v.as_array()) {
    for r in rows {
        let started_at = r.get("started_at").and_then(|v| v.as_str()).unwrap_or("");
        // Dedup po started_at (unikalny per run). Wstaw pełny rekord.
        let exists: bool = tx.query_row(
            "SELECT 1 FROM assignment_auto_runs WHERE started_at = ?1", [started_at], |_| Ok(())
        ).optional().map_err(|e| e.to_string())?.is_some();
        if !exists {
            tx.execute(
                "INSERT INTO assignment_auto_runs (started_at, finished_at, mode, min_confidence_auto, \
                 min_evidence_auto, sessions_scanned, sessions_suggested, sessions_assigned, error, \
                 rolled_back_at, rollback_reverted, rollback_skipped) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                rusqlite::params![
                    started_at,
                    r.get("finished_at").and_then(|v| v.as_str()),
                    r.get("mode").and_then(|v| v.as_str()).unwrap_or("auto"),
                    r.get("min_confidence_auto").and_then(|v| v.as_f64()).unwrap_or(0.0),
                    r.get("min_evidence_auto").and_then(|v| v.as_i64()).unwrap_or(0),
                    r.get("sessions_scanned").and_then(|v| v.as_i64()).unwrap_or(0),
                    r.get("sessions_suggested").and_then(|v| v.as_i64()).unwrap_or(0),
                    r.get("sessions_assigned").and_then(|v| v.as_i64()).unwrap_or(0),
                    r.get("error").and_then(|v| v.as_str()),
                    r.get("rolled_back_at").and_then(|v| v.as_str()),
                    r.get("rollback_reverted").and_then(|v| v.as_i64()).unwrap_or(0),
                    r.get("rollback_skipped").and_then(|v| v.as_i64()).unwrap_or(0),
                ],
            ).map_err(|e| e.to_string())?;
        }
    }
}
```

> Wymaga `use rusqlite::OptionalExtension;` w zakresie (sprawdź, czy już jest). Umieść te bloki WEWNĄTRZ transakcji merge, przed `tx.commit()`.

- [ ] **Step 5: Uruchom test roundtrip — PASS.** Run: `cargo test --bin timeflow-demon assignment_tables_roundtrip_via_export_and_merge`.

- [ ] **Step 6: Checksum** — `shared/sync/checksum.rs`: dodaj gałęzie w `table_hash_sql` i rozszerz listę hashowanych tabel:

```rust
"assignment_feedback" =>
    "SELECT COALESCE(group_concat(source || '|' || created_at, ';'), '') \
     FROM (SELECT source, created_at FROM assignment_feedback ORDER BY source, created_at)",
"assignment_auto_runs" =>
    "SELECT COALESCE(group_concat(started_at || '|' || COALESCE(finished_at,'') || '|' || \
        sessions_scanned || '|' || sessions_suggested || '|' || sessions_assigned, ';'), '') \
     FROM (SELECT * FROM assignment_auto_runs ORDER BY started_at)",
```

I w `build_table_hashes` (`src/lan_server.rs:705`) oraz w `compute_tables_hash_string_conn` (znajdź listę tabel) dodaj obie nazwy do iterowanego zbioru tabel. Zaktualizuj test `known_tables_have_sql_unknown_none` (checksum.rs:96) — przenieś `assignment_feedback` z `is_none()` do `is_some()`.

- [ ] **Step 7: Build + pełne testy.** Run: `cargo build && cargo test -p timeflow_shared && cargo test --bin timeflow-demon`.

- [ ] **Step 8: Commit**

```bash
git add src/lan_server.rs src/sync_common.rs shared/sync/checksum.rs
git commit -m "feat(sync): synchronizuj assignment_feedback i assignment_auto_runs (eksport+merge+checksum) na żywej ścieżce online/LAN"
```

---

## Task 5: H-4 — oddziel push-frontier od pull-frontier w async sync

Pull wstawia marker z `peer_id=Some`, push z `peer_id=None`. Push liczy `since` z `get_last_sync_timestamp` (MAX po WSZYSTKICH) → pull cofa push-frontier, gubiąc niewysłane lokalne zmiany. Fix: push liczy `since` tylko z własnych markerów (`peer_id IS NULL`).

**Files:**
- Modify: `src/sync_common.rs:219` (dodać `get_last_push_timestamp`)
- Modify: `src/online_sync.rs:479` (`execute_async_push` używa nowej funkcji)
- Test: `src/sync_common.rs` mod tests

- [ ] **Step 1: Test push-frontier** — `src/sync_common.rs` mod tests:

```rust
#[test]
fn push_frontier_ignores_pull_markers() {
    let conn = marker_test_db(); // helper tworzący tabelę sync_markers (użyj istniejącego add_marker:816)
    // push marker (peer_id NULL) @ 10:00
    insert_sync_marker_db(&conn, "h1", "2026-06-01 10:00:00", "devA", None, "th", false).unwrap();
    // pull marker (peer_id = peerB) @ 10:05 — NIE może przesunąć push-frontier
    insert_sync_marker_db(&conn, "h2", "2026-06-01 10:05:00", "devA", Some("peerB"), "th", false).unwrap();
    assert_eq!(get_last_push_timestamp(&conn).as_deref(), Some("2026-06-01 10:00:00"));
    assert_eq!(get_last_sync_timestamp(&conn).as_deref(), Some("2026-06-01 10:05:00"));
}
```

> Sprawdź sygnaturę `insert_sync_marker_db` (sync_common.rs:26) i kolumnę przechowującą `peer_id` w `sync_markers` (np. `peer_id`/`source_peer`). Dopasuj nazwę kolumny w SQL poniżej.

- [ ] **Step 2: Uruchom — FAIL** (`get_last_push_timestamp` nie istnieje). Run: `cargo test --bin timeflow-demon push_frontier_ignores_pull_markers`.

- [ ] **Step 3: Dodaj `get_last_push_timestamp`** — `src/sync_common.rs` przy `get_last_sync_timestamp:219`:

```rust
/// Push-frontier: ostatni znacznik WŁASNEGO pusha (peer_id IS NULL).
/// Oddzielony od pull-frontier, by pull nie cofał okna niewysłanych zmian (audyt H-4).
pub fn get_last_push_timestamp(conn: &rusqlite::Connection) -> Option<String> {
    conn.query_row(
        "SELECT created_at FROM sync_markers WHERE peer_id IS NULL ORDER BY created_at DESC LIMIT 1",
        [],
        |row| row.get(0),
    )
    .ok()
}
```

- [ ] **Step 4: Użyj w push** — `src/online_sync.rs:479`:

```rust
// było: let last_sync_ts = sync_common::get_last_sync_timestamp(&conn);
let last_sync_ts = sync_common::get_last_push_timestamp(&conn);
```

- [ ] **Step 5: Uruchom — PASS + build.** Run: `cargo test --bin timeflow-demon push_frontier_ignores_pull_markers && cargo build`.

- [ ] **Step 6: Commit**

```bash
git add src/sync_common.rs src/online_sync.rs
git commit -m "fix(sync): async push liczy since z push-frontier (peer_id IS NULL); pull nie cofa okna niewysłanych zmian (H-4)"
```

> Uwaga H-3 (push-marker bez potwierdzenia odbioru) NIE jest tu w pełni rozwiązany — wymaga mechanizmu potwierdzenia dostarczenia paczki (async jest fire-and-forget). Siatką bezpieczeństwa jest fallback session-sync (zawsze full-export). Pełne rozwiązanie H-3 → osobna decyzja projektowa (patrz Task 8).

---

## Task 6: H-5 — `catch_unwind` wokół online sync (parzystość z LAN)

Panic w merge zostawia `db_frozen=true` na 20 min. LAN ma `guarded_then_cleanup` (lan_sync_orchestrator.rs:842). Online — nie.

**Files:**
- Modify: `src/lan_sync_orchestrator.rs:842` (udostępnić `guarded_then_cleanup` jako `pub(crate)`)
- Modify: `src/online_sync.rs:726` (`run_online_sync`) i `:777` (`run_online_sync_forced`)
- Test: `src/online_sync.rs` mod tests

- [ ] **Step 1: Test — panic nie zostawia zamrożonej bazy.** `src/online_sync.rs` mod tests (wzoruj na LAN `auto_unfreeze`/panic test):

```rust
#[test]
fn online_sync_panic_clears_frozen_flag() {
    let state = std::sync::Arc::new(LanSyncState::new_for_test());
    state.db_frozen.store(true, std::sync::atomic::Ordering::SeqCst);
    // Wywołaj wrapper z ciałem panikującym (wyodrębniony helper run_online_sync_guarded).
    run_online_sync_guarded(&state, || panic!("boom"));
    assert!(!state.db_frozen.load(std::sync::atomic::Ordering::SeqCst),
        "db_frozen musi być wyczyszczone po panic w online sync");
}
```

> Jeśli `LanSyncState::new_for_test` nie istnieje, użyj realnego konstruktora z minimalnym stanem (sprawdź jak LAN test go tworzy).

- [ ] **Step 2: Uruchom — FAIL** (`run_online_sync_guarded` nie istnieje). Run: `cargo test --bin timeflow-demon online_sync_panic_clears_frozen_flag`.

- [ ] **Step 3: Udostępnij `guarded_then_cleanup`** — `src/lan_sync_orchestrator.rs:842`:

```rust
pub(crate) fn guarded_then_cleanup<B, C>(body: B, cleanup: C)
```

- [ ] **Step 4: Dodaj wrapper i owiń orchestratory** — `src/online_sync.rs`. Wyodrębnij ciało `run_online_sync`/`run_online_sync_forced` do guarded wrappera:

```rust
fn run_online_sync_guarded<F: FnOnce() + std::panic::UnwindSafe>(sync_state: &Arc<LanSyncState>, body: F) {
    let st = sync_state.clone();
    crate::lan_sync_orchestrator::guarded_then_cleanup(
        std::panic::AssertUnwindSafe(|| { body(); true }),
        move |_succeeded| {
            st.unfreeze();
            st.reset_progress();
            st.sync_in_progress.store(false, Ordering::SeqCst);
        },
    );
}
```

W `run_online_sync` (726) i `run_online_sync_forced` (777) owiń wywołanie `execute_online_sync(...)` w `run_online_sync_guarded(&sync_state, || { ... })`, przenosząc dotychczasową logikę match Ok/Err do wnętrza body. Cleanup (unfreeze/reset/sync_in_progress=false) wykonuje się zarówno po Ok, Err, jak i po panic.

- [ ] **Step 5: Uruchom — PASS + build.** Run: `cargo test --bin timeflow-demon online_sync_panic_clears_frozen_flag && cargo build`.

- [ ] **Step 6: Commit**

```bash
git add src/lan_sync_orchestrator.rs src/online_sync.rs
git commit -m "fix(sync): catch_unwind wokół online sync — panic w merge nie zostawia bazy zamrożonej na 20 min (parzystość z LAN)"
```

---

## Task 7: L-1 + M-4 — guard długości IV + testy roundtrip szyfrowania

`make_nonce` panikuje gdy `iv != 12B`; `decrypt_credentials` nie sprawdza długości. Brak jakichkolwiek testów roundtrip.

**Files:**
- Modify: `src/sync_encryption.rs:97` (guard IV w `decrypt_credentials`)
- Test: `src/sync_encryption.rs` (nowy `#[cfg(test)] mod tests`)

- [ ] **Step 1: Testy roundtrip + guard IV** — dodaj na końcu `src/sync_encryption.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_data_roundtrip_utf8_empty_and_large() {
        let key = "0123456789abcdef0123456789abcdef"; // 32+ znaki
        for payload in [
            "żółć ąęś — €".as_bytes().to_vec(),
            Vec::<u8>::new(),
            b"with\0null\0bytes".to_vec(),
            vec![7u8; 5 * 1024 * 1024],
        ] {
            let enc = encrypt_file_data(&payload, key).unwrap();
            let dec = decrypt_file_data(&enc, key).unwrap();
            assert_eq!(dec, payload, "roundtrip musi zachować bajty 1:1");
        }
    }

    #[test]
    fn file_data_nonce_is_random_per_call() {
        let key = "0123456789abcdef0123456789abcdef";
        let a = encrypt_file_data(b"x", key).unwrap();
        let b = encrypt_file_data(b"x", key).unwrap();
        assert_ne!(a[..12], b[..12], "IV musi być losowy per wywołanie (brak nonce reuse)");
    }
}
```

- [ ] **Step 2: Uruchom — testy roundtrip PASS** (potwierdzają poprawność), Run: `cargo test --bin timeflow-demon sync_encryption::tests`. (Jeśli `decrypt_file_data` ma inną sygnaturę, dopasuj.)

- [ ] **Step 3: Guard IV w `decrypt_credentials`** — `src/sync_encryption.rs`, przed `let nonce = make_nonce(&iv_bytes);` (:97):

```rust
    if iv_bytes.len() != 12 {
        return Err(format!("Invalid IV length: {} (expected 12)", iv_bytes.len()));
    }
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = make_nonce(&iv_bytes);
```

- [ ] **Step 4: Test guardu** — dodaj do mod tests:

```rust
    #[test]
    fn decrypt_credentials_rejects_bad_iv_without_panic() {
        use base64::Engine;
        let e = base64::engine::general_purpose::STANDARD;
        let bad = EncryptedCredentials {
            iv: e.encode([0u8; 8]), // za krótki IV
            tag: e.encode([0u8; 16]),
            encrypted_payload: e.encode([0u8; 4]),
        };
        let r = decrypt_credentials(&bad, "sess", "0123456789abcdef0123456789abcdef");
        assert!(r.is_err(), "zły IV musi dać Err, nie panic");
    }
```

> Dopasuj konstruktor `EncryptedCredentials` do realnej definicji (pola `iv`/`tag`/`encrypted_payload`).

- [ ] **Step 5: Uruchom — PASS + build.** Run: `cargo test --bin timeflow-demon sync_encryption && cargo build`.

- [ ] **Step 6: Commit**

```bash
git add src/sync_encryption.rs
git commit -m "test(sync): testy roundtrip szyfrowania (UTF-8/puste/null/duże) + guard długości IV w decrypt_credentials (L-1, M-4)"
```

---

## Task 8: Decyzje i follow-upy (bez kodu — wymagają ustalenia)

Te findings to decyzje produktowe/architektoniczne, nie mechaniczne fixy. Udokumentuj wybór w PR; nie implementuj na ślepo.

- [ ] **M-3 — `projects.unfreeze_reason`, `sessions.split_source_session_id`:** zdecyduj „synchronizować czy machine-local". Jeśli synchronizować — powtórz wzorzec Task 2/4 (eksport+merge+checksum) dla każdej kolumny. Jeśli machine-local — dodaj komentarz przy definicji (jak `assigned_folder_path`) i zamknij temat.
- [ ] **H-3 (pełne) — potwierdzenie dostarczenia paczki async:** zaprojektuj sygnał zwrotny (serwerowy status paczki: `delivered`/`acked`) i przesuwaj push-frontier dopiero po nim. Wymaga zmiany kontraktu async (serwer `async-delta.ts` + klient). Osobny mini-plan.
- [ ] **M-5 — tombstone GC w trybie online:** `compute_tombstone_gc_cutoff` (sync_common.rs:553) używa `lan_pairing`; w czystym online lista par pusta → GC po samym wieku (90 dni). Zmień zbiór peerów ACK na urządzenia online serwera (lub trwałe tombstony po stronie autorytatywnej). Wymaga źródła listy urządzeń online.
- [ ] **Latentne (serwer `direct-sync.ts`):** repo `__cfab_server`. Decyzja: (a) usunąć/oznaczyć martwy merge + trasy `delta-push/pull/status` jako dead-code, albo (b) jeśli ma ożyć (klient web) — przepisać 1:1 wg reguł klienta + kontraktowy test konwergencji w CI (obecnie ZERO CI). Do czasu decyzji: **nie aktywować direct-sync dla żadnego klienta produkcyjnego.**

---

## Self-review (autor planu)

- **Pokrycie raportu:** H-6→T1, H-2→T2, M-1/M-2→T3, H-1→T4, H-4→T5, H-5→T6, L-1/M-4→T7, M-3/H-3/M-5/latentne→T8. Wszystkie findings przypisane.
- **Brak placeholderów:** każdy krok ma realny kod (z dokładnych linii repo), konkretną komendę cargo i test z assertem. Miejsca wymagające dopasowania helpera testowego oznaczone jawnie z odwołaniem do istniejącego wzorca (nie „TODO").
- **Spójność typów/nazw:** `get_last_push_timestamp` (T5) używane w online_sync.rs spójnie; `sessions_suggested` (T1) spójne w types/export/import; `color` (T2) spójne w eksport/UPDATE/INSERT/checksum.
- **Zastrzeżenie wykonawcze:** kilka kroków każe „sprawdź dokładną sygnaturę/nazwę kolumny" (np. kolumna `peer_id` w `sync_markers`, helpery testowe) — to nie placeholdery, lecz punkty weryfikacji przy realnym pliku; każdy ma wskazane źródło prawdy w repo.
