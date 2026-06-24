# Async store-and-forward online sync — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zamienić 13-krokowy handshake master/slave (czekanie na peera) na asynchroniczny store-and-forward: każde urządzenie samodzielnie pushuje własne zmiany i dociąga cudze, bez czekania na drugie urządzenie.

**Architecture:** Serwer = wersjonowany blob store (jeden snapshot per użytkownik + licznik rewizji + CAS). Klient na swoim interwale liczy lokalnie decyzję (push/pull/idle) z `(clientRevision, serverRevision, localHash, serverHash)`, pobiera snapshot serwera, merge'uje go lokalnie istniejącym silnikiem `sync_common`, i odsyła wynik pod ochroną compare-and-swap. Faza 2 przenosi merge na kopię-cień bazy + atomowy swap, żeby nagrywanie nie było zatrzymywane.

**Tech Stack:** Rust (daemon, rusqlite, ureq), Next.js/TypeScript (serwer `__cfab_server`, Prisma + FS), React (dashboard), SQLite (rusqlite Backup API).

**Repozytoria:**
- Klient: `/Users/micz/__DEV__/__cfab_demon`
- Serwer: `/Users/micz/__DEV__/__cfab_server`

**Spec:** `docs/superpowers/specs/2026-06-24-online-sync-store-and-forward-design.md`

---

## Mapa plików

### Serwer (`__cfab_server`)
- Modify: `src/lib/sync/direct-sync.ts` — dodać CAS w `handlePushInner` (użyć ignorowanego dziś `knownServerRevision`).
- Test: `src/lib/sync/__tests__/direct-sync-cas.test.ts` (nowy) — test CAS.

### Klient daemon (`__cfab_demon`)
- Create: `src/online_store_forward.rs` — nowy moduł: decyzja sync + pętla store-and-forward + wrappery HTTP direct-sync.
- Modify: `src/online_sync.rs` — `run_online_sync` deleguje do nowego flow; usunięcie `wait_for_peer`, ról master/slave, `classify_create_status` (Faza 1).
- Modify: `src/lan_server.rs:1217-1309` — `handle_online_trigger_sync`: uproszczenie dispatchu (jeden flow zamiast session/async).
- Modify: `src/sync_common.rs` — Faza 2: `merge_incoming_nonblocking()` (shadow copy + merge + fold + swap) + helper `shadow_db_path()`.
- Test: `src/online_store_forward.rs` (inline `#[cfg(test)]`) — testy decyzji.
- Test: `src/sync_common.rs` (inline `#[cfg(test)]`) — rozszerzyć `LanSyncSimulator` o asercję zbieżności store-and-forward + test shadow-merge.

### Dashboard (`__cfab_demon/dashboard`)
- Modify: `dashboard/src/components/sync/DaemonSyncOverlay.tsx`, `SyncProgressOverlay.tsx` — usunąć notice „recording paused/frozen", pokazać dyskretne „synchronizacja…".
- Modify: `dashboard/src/components/.../Help.tsx` — opis nowego modelu (wymóg CLAUDE.md).

---

## FAZA 1 — Async store-and-forward (rdzeń, bez peer-wait)

Cel fazy: po Fazie 1 sync działa asynchronicznie i nikt nie czeka na peera. Merge nadal pod krótkim freeze (sekundy zamiast minut) — Faza 2 usunie freeze. **Faza 1 jest samodzielnie wdrażalna i testowalna.**

---

### Task 1: Serwer — CAS na `/sync/push`

Dziś `handlePushInner` (`src/lib/sync/direct-sync.ts:388-461`) **ignoruje** `knownServerRevision`. Dodajemy odrzucanie nieaktualnego pushu, żeby równoczesne pushe nie zamazywały się.

**Files:**
- Modify: `src/lib/sync/direct-sync.ts` (funkcja `handlePushInner`, ok. linii 388-461)
- Test: `src/lib/sync/__tests__/direct-sync-cas.test.ts`

- [ ] **Step 1: Napisz failing test CAS**

Utwórz `src/lib/sync/__tests__/direct-sync-cas.test.ts`. Dostosuj import i setup do istniejącego wzorca testów w repo (sprawdź, czy są inne `__tests__` w `src/lib/sync/`; jeśli używają `vitest`/`jest`, użyj tego samego). Szkielet:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { handlePush } from "../direct-sync"; // dostosuj eksportowaną nazwę do realnej
import { makeTmpUserStore, seedMeta } from "./helpers"; // dostosuj/utwórz helper do tmp data dir

describe("push CAS", () => {
  it("odrzuca push gdy knownServerRevision != serverRevision", async () => {
    const userId = "u1";
    await seedMeta(userId, { revision: 5, payloadSha256: "abc" });
    const res = await handlePush({
      userId, deviceId: "d2", knownServerRevision: 3, // nieaktualne (serwer ma 5)
      archive: { data: { projects: [{ id: 1, name: "X" }] } },
    });
    expect(res.accepted).toBe(false);
    expect(res.reason).toBe("stale_revision");
    expect(res.revision).toBe(5); // serwer informuje o aktualnej rewizji
  });

  it("przyjmuje push gdy knownServerRevision == serverRevision", async () => {
    const userId = "u2";
    await seedMeta(userId, { revision: 5, payloadSha256: "abc" });
    const res = await handlePush({
      userId, deviceId: "d2", knownServerRevision: 5,
      archive: { data: { projects: [{ id: 1, name: "Y" }] } },
    });
    expect(res.accepted).toBe(true);
    expect(res.revision).toBe(6);
  });

  it("przyjmuje push gdy knownServerRevision == null (initial / bootstrap)", async () => {
    const userId = "u3"; // brak meta.json
    const res = await handlePush({
      userId, deviceId: "d2", knownServerRevision: null,
      archive: { data: { projects: [] } },
    });
    expect(res.accepted).toBe(true);
  });
});
```

- [ ] **Step 2: Uruchom test — ma FAIL**

Run: `cd /Users/micz/__DEV__/__cfab_server && npx vitest run src/lib/sync/__tests__/direct-sync-cas.test.ts`
Expected: FAIL (pierwszy test — dziś push z `knownServerRevision: 3` jest akceptowany, bo CAS ignorowany).

- [ ] **Step 3: Dodaj CAS w `handlePushInner`**

W `src/lib/sync/direct-sync.ts`, w `handlePushInner`, PO odczycie `currentRevision` z `meta.json` a PRZED liczeniem hash/zapisem, wstaw:

```typescript
// CAS: odrzuć push zbudowany na nieaktualnej rewizji.
// knownServerRevision === null => bootstrap (brak danych serwera) — przepuść.
if (body.knownServerRevision !== null && body.knownServerRevision !== currentRevision) {
  return {
    ok: true,
    accepted: false,
    noOp: false,
    revision: currentRevision,
    payloadSha256: existingMeta?.payloadSha256 ?? "",
    receivedAt: new Date().toISOString(),
    reason: "stale_revision",
  };
}
```

Uwaga: jeśli `meta.json` nie istnieje, `currentRevision` to wartość początkowa (0 lub brak). Dla bootstrapu `knownServerRevision` z klienta będzie `null` (klient nie zna rewizji) → przepuszczamy. Upewnij się, że gałąź „no meta" nadal działa (initial `send_full`).

- [ ] **Step 4: Uruchom testy — PASS**

Run: `cd /Users/micz/__DEV__/__cfab_server && npx vitest run src/lib/sync/__tests__/direct-sync-cas.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Pełny lint/test serwera**

Run: `cd /Users/micz/__DEV__/__cfab_server && npm run lint && npx vitest run`
Expected: brak nowych błędów.

- [ ] **Step 6: Commit (repo serwera)**

```bash
cd /Users/micz/__DEV__/__cfab_server
git add src/lib/sync/direct-sync.ts src/lib/sync/__tests__/direct-sync-cas.test.ts
git commit -m "feat(sync): add compare-and-swap on /sync/push (reject stale knownServerRevision)"
```

---

### Task 2: Klient — czysta funkcja decyzji sync

Decyzja push/pull/idle ma być testowalną funkcją bez sieci i bez DB.

**Files:**
- Create: `src/online_store_forward.rs`
- Modify: `src/main.rs` (lub `lib.rs`) — dodać `mod online_store_forward;`
- Test: inline w `src/online_store_forward.rs`

- [ ] **Step 1: Zarejestruj moduł**

W `src/main.rs` (lub tam gdzie są deklaracje `mod`), dodaj obok `mod online_sync;`:
```rust
mod online_store_forward;
```

- [ ] **Step 2: Napisz failing test decyzji**

W `src/online_store_forward.rs`:
```rust
/// Stan widziany przez klienta przed decyzją.
#[derive(Debug, Clone)]
pub struct SyncView {
    pub client_revision: i64,
    pub server_revision: i64,
    pub local_hash: String,
    pub server_hash: Option<String>,
    /// czy lokalna baza ma niezsynchronizowane zmiany (local_hash != hash z ostatniego sync)
    pub local_dirty: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SyncDecision {
    Idle,
    Pull,            // serwer ma nowszą rewizję — pobierz + merge
    Push,            // mamy lokalne zmiany do wypchnięcia
    PullThenPush,    // jesteśmy w tyle i mamy lokalne zmiany — najpierw pull+merge, potem push unii
}

/// Czysta decyzja, bez sieci. Reguły:
/// - server_revision > client_revision => musimy pull (i jeśli local_dirty, potem push).
/// - server_revision == client_revision && local_dirty => push.
/// - inaczej => idle.
pub fn decide(view: &SyncView) -> SyncDecision {
    if view.server_revision > view.client_revision {
        if view.local_dirty { SyncDecision::PullThenPush } else { SyncDecision::Pull }
    } else if view.local_dirty {
        SyncDecision::Push
    } else {
        SyncDecision::Idle
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn v(cr: i64, sr: i64, dirty: bool) -> SyncView {
        SyncView { client_revision: cr, server_revision: sr,
            local_hash: "h".into(), server_hash: Some("s".into()), local_dirty: dirty }
    }
    #[test] fn idle_when_in_sync_and_clean() { assert_eq!(decide(&v(5,5,false)), SyncDecision::Idle); }
    #[test] fn push_when_clean_behind_false_but_dirty() { assert_eq!(decide(&v(5,5,true)), SyncDecision::Push); }
    #[test] fn pull_when_behind_and_clean() { assert_eq!(decide(&v(4,5,false)), SyncDecision::Pull); }
    #[test] fn pull_then_push_when_behind_and_dirty() { assert_eq!(decide(&v(4,5,true)), SyncDecision::PullThenPush); }
}
```

- [ ] **Step 3: Uruchom testy — PASS (funkcja już zaimplementowana minimalnie)**

Run: `cd /Users/micz/__DEV__/__cfab_demon && cargo test online_store_forward::tests -- --nocapture`
Expected: PASS (4/4). (To celowo minimalny krok — logika decyzji jest trywialna, testy ją blokują na przyszłość.)

- [ ] **Step 4: Commit**

```bash
cd /Users/micz/__DEV__/__cfab_demon
git add src/online_store_forward.rs src/main.rs
git commit -m "feat(online-sync): add pure SyncDecision logic (store-and-forward)"
```

---

### Task 3: Klient — wrappery HTTP direct-sync

Reużywamy istniejące `server_post`/`server_get` z `online_sync.rs` (ureq, Bearer). Dodajemy typy odpowiedzi direct-sync i 4 wrappery.

**Files:**
- Modify: `src/online_sync.rs` — zmień widoczność `server_post`/`server_get` na `pub(crate)` (są dziś prywatne, linie ok. 154-192).
- Modify: `src/online_store_forward.rs` — dodać typy + wrappery.

- [ ] **Step 1: Udostępnij helpery HTTP**

W `src/online_sync.rs`, zmień:
```rust
fn server_post(server_url: &str, path: &str, token: &str, body: &str) -> Result<String, String>
fn server_get(server_url: &str, path: &str, token: &str) -> Result<String, String>
```
na `pub(crate) fn server_post(...)` i `pub(crate) fn server_get(...)`.

- [ ] **Step 2: Dodaj typy direct-sync w `online_store_forward.rs`**

```rust
use serde::{Deserialize, Serialize};
use crate::online_sync::{server_post};

#[derive(Serialize)]
struct StatusReq<'a> {
    #[serde(rename = "userId")] user_id: &'a str,
    #[serde(rename = "deviceId")] device_id: &'a str,
    #[serde(rename = "clientRevision")] client_revision: i64,
    #[serde(rename = "clientHash")] client_hash: &'a str,
}
#[derive(Deserialize)]
pub struct StatusResp {
    #[serde(rename = "serverRevision")] pub server_revision: i64,
    #[serde(rename = "serverHash")] pub server_hash: Option<String>,
}

#[derive(Serialize)]
struct PushReq<'a> {
    #[serde(rename = "userId")] user_id: &'a str,
    #[serde(rename = "deviceId")] device_id: &'a str,
    #[serde(rename = "knownServerRevision")] known_server_revision: Option<i64>,
    archive: serde_json::Value,
}
#[derive(Deserialize)]
pub struct PushResp {
    pub accepted: bool,
    #[serde(rename = "noOp", default)] pub no_op: bool,
    pub revision: i64,
    #[serde(default)] pub reason: String,
}

#[derive(Serialize)]
struct PullReq<'a> {
    #[serde(rename = "userId")] user_id: &'a str,
    #[serde(rename = "deviceId")] device_id: &'a str,
    #[serde(rename = "clientRevision")] client_revision: i64,
}
#[derive(Deserialize)]
pub struct PullResp {
    #[serde(rename = "hasUpdate")] pub has_update: bool,
    pub revision: Option<i64>,
    #[serde(rename = "payloadSha256")] pub payload_sha256: Option<String>,
    pub archive: Option<serde_json::Value>,
}
```

- [ ] **Step 3: Dodaj wrappery**

```rust
pub(crate) fn fetch_status(server: &str, token: &str, user: &str, device: &str,
                           client_rev: i64, client_hash: &str) -> Result<StatusResp, String> {
    let body = serde_json::to_string(&StatusReq {
        user_id: user, device_id: device, client_revision: client_rev, client_hash,
    }).map_err(|e| e.to_string())?;
    let raw = server_post(server, "/api/sync/status", token, &body)?;
    serde_json::from_str(&raw).map_err(|e| format!("status parse: {e}"))
}

pub(crate) fn push_snapshot(server: &str, token: &str, user: &str, device: &str,
                            known_rev: Option<i64>, archive: serde_json::Value) -> Result<PushResp, String> {
    let body = serde_json::to_string(&PushReq {
        user_id: user, device_id: device, known_server_revision: known_rev, archive,
    }).map_err(|e| e.to_string())?;
    let raw = server_post(server, "/api/sync/push", token, &body)?;
    serde_json::from_str(&raw).map_err(|e| format!("push parse: {e}"))
}

pub(crate) fn pull_snapshot(server: &str, token: &str, user: &str, device: &str,
                            client_rev: i64) -> Result<PullResp, String> {
    let body = serde_json::to_string(&PullReq {
        user_id: user, device_id: device, client_revision: client_rev,
    }).map_err(|e| e.to_string())?;
    let raw = server_post(server, "/api/sync/delta-pull", token, &body)?;
    serde_json::from_str(&raw).map_err(|e| format!("pull parse: {e}"))
}
```

- [ ] **Step 4: Kompilacja**

Run: `cd /Users/micz/__DEV__/__cfab_demon && cargo build`
Expected: kompiluje się (brak użycia wrapperów jeszcze — `#[allow(dead_code)]` jeśli warning blokuje; usuniemy w Task 4).

- [ ] **Step 5: Commit**

```bash
git add src/online_sync.rs src/online_store_forward.rs
git commit -m "feat(online-sync): direct-sync HTTP wrappers (status/push/pull)"
```

---

### Task 4: Klient — pętla store-and-forward (rdzeń)

Łączy decyzję + wrappery + istniejący merge w jeden przebieg `sync_once`. Reużywa: `open_dashboard_db()` (`src/lan_common.rs:160`), `sync_common::build_full_export(&conn)`, `sync_common::merge_incoming_data(&mut conn, &str)`, `sync_common::verify_merge_integrity(&conn)`, `sync_common::backup_database_typed(&conn, "online")`, hash przez `compute_tables_hash_string_conn(&conn)` (helper z testów sync_common — udostępnij jako `pub(crate)`), oraz `LanSyncState::{freeze,unfreeze,set_progress,reset_progress}`.

**Files:**
- Modify: `src/sync_common.rs` — udostępnić `pub(crate) fn compute_tables_hash_string_conn(conn: &rusqlite::Connection) -> String` (dziś helper testowy/wewnętrzny).
- Modify: `src/online_store_forward.rs` — dodać `run_store_forward_sync(...)` + persystencję `clientRevision`/`lastSyncedHash`.
- Modify: `src/config.rs` — dodać get/set trwałego `clientRevision` i `lastSyncedHash` (pliki `online_sync_revision.txt`, `online_sync_synced_hash.txt` w `config_dir()`), wzorowane na `online_sync_last_completed`.

- [ ] **Step 1: Persystencja rewizji i hash w config.rs**

Wzorując się na `save_online_sync_completed`/`online_sync_last_completed` (`src/config.rs:79-127`), dodaj:
```rust
fn online_sync_revision_path() -> Result<PathBuf> { Ok(config_dir()?.join("online_sync_revision.txt")) }
pub fn load_online_sync_revision() -> i64 {
    online_sync_revision_path().ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}
pub fn save_online_sync_revision(rev: i64) {
    if let Ok(p) = online_sync_revision_path() { let _ = std::fs::write(p, rev.to_string()); }
}
fn online_sync_synced_hash_path() -> Result<PathBuf> { Ok(config_dir()?.join("online_sync_synced_hash.txt")) }
pub fn load_online_sync_synced_hash() -> Option<String> {
    online_sync_synced_hash_path().ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}
pub fn save_online_sync_synced_hash(hash: &str) {
    if let Ok(p) = online_sync_synced_hash_path() { let _ = std::fs::write(p, hash); }
}
```

- [ ] **Step 2: Udostępnij hash bazy**

W `src/sync_common.rs`, znajdź `compute_tables_hash_string_conn` (używane w `assert_converged`). Jeśli jest prywatne/testowe — wynieś poza `#[cfg(test)]` i oznacz `pub(crate)`. Sygnatura docelowa:
```rust
pub(crate) fn compute_tables_hash_string_conn(conn: &rusqlite::Connection) -> String
```

- [ ] **Step 3: Napisz `run_store_forward_sync` (przebieg pojedynczy)**

W `src/online_store_forward.rs`:
```rust
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use crate::lan_server::LanSyncState;
use crate::{config, sync_common, lan_common};

const MAX_PUSH_RETRY: u32 = 3;

pub fn run_store_forward_sync(
    settings: config::OnlineSyncSettings,
    sync_state: Arc<LanSyncState>,
    _stop_signal: Arc<AtomicBool>,
) {
    sync_state.set_sync_type("online");
    let result = crate::lan_sync_orchestrator::guarded_then_cleanup(
        std::panic::AssertUnwindSafe(|| {
            match execute_store_forward(&settings, &sync_state) {
                Ok(()) => { config::save_online_sync_completed(); true }
                Err(e) => { crate::online_sync::sync_log(&format!("[store-forward] błąd: {e}"));
                            config::record_online_sync_failure(); false }
            }
        }),
        move |_ok| { sync_state.unfreeze(); sync_state.reset_progress(); },
    );
    let _ = result;
}

fn execute_store_forward(
    settings: &config::OnlineSyncSettings,
    sync_state: &LanSyncState,
) -> Result<(), String> {
    let server = &settings.server_url;
    let token = &settings.auth_token;
    let user = &settings.user_id;     // patrz Task 5 — pole user_id w settings
    let device = &settings.device_id;

    // 1) policz lokalny hash bez mrożenia (tylko odczyt)
    let local_hash = {
        let conn = lan_common::open_dashboard_db()?;
        sync_common::compute_tables_hash_string_conn(&conn)
    };
    let client_rev = config::load_online_sync_revision();
    let last_synced = config::load_online_sync_synced_hash();
    let local_dirty = last_synced.as_deref() != Some(local_hash.as_str());

    // 2) zapytaj serwer o stan
    sync_state.set_progress(1, "checking", "idle");
    let status = fetch_status(server, token, user, device, client_rev, &local_hash)?;

    let view = SyncView {
        client_revision: client_rev,
        server_revision: status.server_revision,
        local_hash: local_hash.clone(),
        server_hash: status.server_hash.clone(),
        local_dirty,
    };
    match decide(&view) {
        SyncDecision::Idle => { sync_state.set_progress(13, "completed", "idle"); Ok(()) }
        SyncDecision::Pull => { do_pull_merge(settings, sync_state)?; Ok(()) }
        SyncDecision::Push => { do_push(settings, sync_state, client_rev)?; Ok(()) }
        SyncDecision::PullThenPush => {
            do_pull_merge(settings, sync_state)?;
            let new_base = config::load_online_sync_revision();
            do_push(settings, sync_state, new_base)?;
            Ok(())
        }
    }
}
```

- [ ] **Step 4: `do_pull_merge` — pobierz, MERGE (Faza 1: pod freeze), zapisz rewizję**

```rust
fn do_pull_merge(settings: &config::OnlineSyncSettings, sync_state: &LanSyncState) -> Result<(), String> {
    let server = &settings.server_url; let token = &settings.auth_token;
    let user = &settings.user_id; let device = &settings.device_id;
    let client_rev = config::load_online_sync_revision();

    sync_state.set_progress(5, "pulling", "download");
    let pull = pull_snapshot(server, token, user, device, client_rev)?;
    if !pull.has_update { return Ok(()); }
    let archive = pull.archive.ok_or("pull: hasUpdate ale brak archive")?;
    let server_rev = pull.revision.ok_or("pull: brak revision")?;
    // archive ma kształt { data: {...} } — merge_incoming_data oczekuje JSON snapshotu.
    let slave_data = serde_json::to_string(&archive).map_err(|e| e.to_string())?;

    // FAZA 1: krótki freeze na czas lokalnego merge (Faza 2 to usunie).
    sync_state.freeze();
    let merge_res = (|| -> Result<String, String> {
        let mut conn = lan_common::open_dashboard_db()?;
        sync_common::backup_database_typed(&conn, "online")?;
        sync_common::merge_incoming_data(&mut conn, &slave_data)?;
        sync_common::verify_merge_integrity(&conn)?;
        Ok(sync_common::compute_tables_hash_string_conn(&conn))
    })();
    sync_state.unfreeze();
    let merged_hash = merge_res?;

    config::save_online_sync_revision(server_rev);
    config::save_online_sync_synced_hash(&merged_hash);
    sync_state.set_progress(13, "completed", "local");
    Ok(())
}
```

Uwaga: format `archive` z serwera to `{ data: {...} }` (patrz `SnapshotArchive`). Jeśli `merge_incoming_data` oczekuje surowego snapshotu (bez opakowania `data`), wyłuskaj `archive["data"]` zanim zserializujesz. **Zweryfikuj kształt eksportu** porównując z `build_full_export` w teście Task 6 — to jest punkt integracji, który musi się zgadzać.

- [ ] **Step 5: `do_push` — eksport + push z CAS + retry**

```rust
fn do_push(settings: &config::OnlineSyncSettings, sync_state: &LanSyncState, base_rev: i64) -> Result<(), String> {
    let server = &settings.server_url; let token = &settings.auth_token;
    let user = &settings.user_id; let device = &settings.device_id;

    let mut base = base_rev;
    for attempt in 0..MAX_PUSH_RETRY {
        sync_state.set_progress(11, "pushing", "upload");
        let export_json = {
            let conn = lan_common::open_dashboard_db()?;
            sync_common::build_full_export(&conn)?
        };
        let archive: serde_json::Value =
            serde_json::json!({ "data": serde_json::from_str::<serde_json::Value>(&export_json)
                .map_err(|e| e.to_string())? });
        let known = if base == 0 { None } else { Some(base) };
        let resp = push_snapshot(server, token, user, device, known, archive)?;
        if resp.accepted || resp.no_op {
            config::save_online_sync_revision(resp.revision);
            let conn = lan_common::open_dashboard_db()?;
            config::save_online_sync_synced_hash(&sync_common::compute_tables_hash_string_conn(&conn));
            sync_state.set_progress(13, "completed", "upload");
            return Ok(());
        }
        if resp.reason == "stale_revision" {
            crate::online_sync::sync_log(&format!("[store-forward] push stale (próba {}), pull+merge i retry", attempt + 1));
            do_pull_merge(settings, sync_state)?;
            base = config::load_online_sync_revision();
            continue;
        }
        return Err(format!("push odrzucony: {}", resp.reason));
    }
    Err("push: przekroczono limit retry CAS".into())
}
```

- [ ] **Step 6: Kompilacja**

Run: `cd /Users/micz/__DEV__/__cfab_demon && cargo build`
Expected: kompiluje się. Popraw realne sygnatury, jeśli się różnią (np. `sync_log` widoczność — udostępnij `pub(crate)` w `online_sync.rs`).

- [ ] **Step 7: Commit**

```bash
git add src/online_store_forward.rs src/config.rs src/sync_common.rs src/online_sync.rs
git commit -m "feat(online-sync): store-and-forward sync loop (pull/merge/push + CAS retry)"
```

---

### Task 5: Klient — pole `user_id` w ustawieniach

Direct-sync wymaga `userId` w body. Dodajemy je do `OnlineSyncSettings` (opcjonalne; jeśli puste, serwer rozwiązuje z device-tokena — patrz Task 5 Step 3).

**Files:**
- Modify: `src/config.rs` — struktura `OnlineSyncSettings`: dodać `pub user_id: String` (z `#[serde(default)]`).
- Modify: dashboard ustawienia online sync (`dashboard/src/.../OnlineSyncCard.tsx` lub odpowiedni store) — pole na user_id, jeśli nie da się go wyprowadzić.

- [ ] **Step 1: Dodaj pole**

W `src/config.rs`, w `OnlineSyncSettings`:
```rust
#[serde(default)]
pub user_id: String,
```

- [ ] **Step 2: Kompilacja**

Run: `cd /Users/micz/__DEV__/__cfab_demon && cargo build`
Expected: PASS (pole z default nie psuje deserializacji istniejących plików).

- [ ] **Step 3: Zweryfikuj rozwiązywanie userId na serwerze (decyzja integracyjna)**

Sprawdź w `__cfab_server/src/lib/auth/server-auth.ts:78-122`, czy direct-sync handlery używają **token-resolved userId** (group.ownerId) niezależnie od `body.userId`. Jeśli tak — klient może wysyłać `userId: ""` i serwer go nadpisze. Jeśli handler WYMAGA niepustego `body.userId` zgodnego z tokenem, dodaj mały serwerowy fallback: gdy `body.userId` puste, użyj `authenticatedUserId`. Wybierz wariant zależnie od realnego kodu i odnotuj w commit message. Test: ręczny przebieg w Task 9.

- [ ] **Step 4: Commit**

```bash
git add src/config.rs
git commit -m "feat(online-sync): add optional user_id to OnlineSyncSettings"
```

---

### Task 6: Test zbieżności store-and-forward (rozszerz LanSyncSimulator)

Reużyj `LanSyncSimulator` (`src/sync_common.rs:1457`) — symuluje dwie bazy in-memory i merge. Dodaj test 3 urządzeń w pętli ping-pong z content-hash jako warunkiem stopu, sprawdzający zbieżność do unii.

**Files:**
- Test: `src/sync_common.rs` (`#[cfg(test)]`)

- [ ] **Step 1: Napisz failing test 3-device convergence**

```rust
#[test]
fn store_forward_three_devices_converge_to_union() {
    // Trzy bazy z rozłącznymi danymi, "serwer" = wspólny snapshot (String JSON).
    let mut a = seeded_conn_with_prefix("A");
    let mut b = seeded_conn_with_prefix("B");
    let mut c = seeded_conn_with_prefix("C");
    let pre: usize = [&a, &b, &c].iter().map(|cn| count_projects(cn)).sum();

    // serwer trzyma snapshot najnowszego pełnego eksportu
    let mut server_snapshot: Option<String> = None;

    // Każde urządzenie: jeśli serwer ma snapshot -> merge go u siebie; potem push swojego eksportu.
    // Pętla aż dwie rundy z rzędu bez zmiany hash serwera (warunek stopu = content-hash).
    let devices: [&mut rusqlite::Connection; 3] = [&mut a, &mut b, &mut c];
    let mut last_server_hash = String::new();
    let mut stable_rounds = 0;
    let mut guard = 0;
    while stable_rounds < 2 && guard < 20 {
        guard += 1;
        for conn in devices_iter(&devices) { // pseudo: iteruj po urządzeniach
            if let Some(snap) = &server_snapshot {
                merge_incoming_data(conn, snap).unwrap();
                verify_merge_integrity(conn).unwrap();
            }
            let export = build_full_export(conn).unwrap();
            server_snapshot = Some(export);
        }
        let h = content_hash_of(server_snapshot.as_ref().unwrap());
        if h == last_server_hash { stable_rounds += 1; } else { stable_rounds = 0; last_server_hash = h; }
    }

    // Po zbieżności każde urządzenie musi mieć unię (suma projektów).
    for conn in [&a, &b, &c] { assert_eq!(count_projects(conn), pre); }
    assert_eq!(
        compute_tables_hash_string_conn(&a),
        compute_tables_hash_string_conn(&c),
        "urządzenia nie zbiegły do identycznego stanu"
    );
}
```

Uwaga: dostosuj do realnego API symulatora. Jeśli `LanSyncSimulator` operuje na 2 połączeniach, rozszerz go o trzecie lub napisz pomocnicze `seeded_conn_with_prefix`, `count_projects`, `content_hash_of` na wzór istniejących `counts`/`content_hash`. Iteracja po `&mut` połączeniach: użyj indeksów zamiast pseudo-`devices_iter`.

- [ ] **Step 2: Uruchom — najpierw FAIL (helpery nie istnieją), potem dopisz helpery, aż PASS**

Run: `cd /Users/micz/__DEV__/__cfab_demon && cargo test store_forward_three_devices_converge_to_union -- --nocapture`
Expected po dopisaniu helperów: PASS — wszystkie 3 bazy mają sumę projektów, identyczne hash.

- [ ] **Step 3: Test stopu (idempotencja)**

Dodaj asercję, że po zbieżności kolejny merge nie zmienia hash (warunek stopu działa):
```rust
let h_before = compute_tables_hash_string_conn(&a);
let snap = build_full_export(&a).unwrap();
merge_incoming_data(&mut a, &snap).unwrap();
assert_eq!(compute_tables_hash_string_conn(&a), h_before, "merge własnego snapshotu zmienił stan");
```

- [ ] **Step 4: Commit**

```bash
git add src/sync_common.rs
git commit -m "test(online-sync): 3-device store-and-forward convergence + content-hash stop"
```

---

### Task 7: Przełącz trigger na nowy flow; usuń peer-wait

**Files:**
- Modify: `src/lan_server.rs:1288-1306` — dispatch na `run_store_forward_sync`.
- Modify: `src/online_sync.rs` — `run_online_sync` deleguje do nowego flow (zachowaj nazwę dla kompatybilności wywołań) ALBO podmień wywołania w trigger. Usuń `wait_for_peer`, `classify_create_status`, `CreateOutcome`, role master/slave z czynnej ścieżki.

- [ ] **Step 1: Podmień dispatch w trigger handlerze**

W `src/lan_server.rs`, w `handle_online_trigger_sync`, zamień blok spawn (linie ~1288-1306):
```rust
std::thread::spawn(move || {
    crate::online_store_forward::run_store_forward_sync(settings, state_clone.clone(), stop_clone);
    state_clone.sync_in_progress.store(false, std::sync::atomic::Ordering::SeqCst);
});
```
(usuwając gałęzie `match settings.sync_mode` — jeden flow).

- [ ] **Step 2: Usuń martwy kod peer-wait**

W `src/online_sync.rs` usuń: `wait_for_peer`, `classify_create_status`, enum `CreateOutcome`, `PEER_WAIT_ATTEMPTS`, oraz nieużywane już `create_session`/`poll_status`/`report_step`/`send_heartbeat`/`cancel_session` i struktury sesyjne — TYLKO jeśli nie są używane przez inne ścieżki (sprawdź `cargo build` po usunięciu). Zostaw `server_post`/`server_get`/`sync_log` (używane przez nowy moduł).

- [ ] **Step 3: Kompilacja + clippy**

Run: `cd /Users/micz/__DEV__/__cfab_demon && cargo build && cargo clippy -- -D warnings 2>&1 | head -40`
Expected: kompiluje się; usuń pozostałe `dead_code`.

- [ ] **Step 4: Pełne testy Rust**

Run: `cd /Users/micz/__DEV__/__cfab_demon && cargo test`
Expected: PASS (w tym testy z Task 2 i Task 6, oraz istniejące roundtrip merge).

- [ ] **Step 5: Commit**

```bash
git add src/lan_server.rs src/online_sync.rs
git commit -m "refactor(online-sync): route trigger to store-and-forward, remove peer-wait/master-slave"
```

---

### Task 8: UI overlay — bez „recording paused"; Help.tsx

**Files:**
- Modify: `dashboard/src/components/sync/DaemonSyncOverlay.tsx`, `dashboard/src/components/sync/SyncProgressOverlay.tsx`
- Modify: `dashboard/src/.../Help.tsx`

- [ ] **Step 1: Overlay — komunikat „synchronizacja…"**

W `SyncProgressOverlay.tsx` usuń wywołanie/wyświetlanie `shouldShowFrozenNotice` (notice „recording paused/frozen"). Faza 1 nadal krótko mrozi, ale komunikat ma być neutralny: pokaż „Synchronizacja w tle…" dla faz aktywnych, bez ostrzeżenia o zatrzymaniu nagrywania. (Faza 2 i tak usunie freeze.) Zachowaj stany loading/empty/error.

- [ ] **Step 2: Help.tsx — opis nowego modelu (wymóg CLAUDE.md)**

W sekcji o synchronizacji online dodaj/zmień tekst (krótki, dla użytkownika końcowego):
- **Co robi:** „Synchronizacja online działa w tle. Każde urządzenie wysyła swoje zmiany na serwer i pobiera zmiany z innych urządzeń — bez czekania, aż drugie urządzenie będzie włączone."
- **Kiedy użyć:** „Włącz, gdy używasz TIMEFLOW na kilku komputerach i chcesz mieć wszędzie te same dane."
- **Ograniczenia:** „Dane na drugim urządzeniu pojawią się przy jego najbliższej synchronizacji (co kilka–kilkanaście minut). Jeśli tę samą rzecz zmienisz na dwóch urządzeniach naraz, zachowana zostanie najnowsza zmiana."

Zachowaj spójną nazwę funkcji w UI/Help/logach (TIMEFLOW).

- [ ] **Step 3: Lint dashboard**

Run: `cd /Users/micz/__DEV__/__cfab_demon/dashboard && npm run lint`
Expected: brak nowych błędów.

- [ ] **Step 4: Commit**

```bash
cd /Users/micz/__DEV__/__cfab_demon
git add dashboard/src/components/sync/ dashboard/src
git commit -m "feat(online-sync): neutral sync overlay + Help.tsx update for store-and-forward"
```

---

### Task 9: Weryfikacja manualna Fazy 1 (dwa urządzenia / dwa profile)

**Files:** brak (test manualny — patrz memory `feedback_ui_verify_render_not_just_build`).

- [ ] **Step 1: Scenariusz offline-forward**

1. Urządzenie A: dodaj projekt „TestA", odczekaj na sync (lub kliknij „Synchronizuj"). W logach demona: `push accepted, revision=N`.
2. Urządzenie B WYŁĄCZONE w trakcie. Włącz B później.
3. B przy starcie: log `pull ... revision=N`, merge, „TestA" widoczny w UI B. **Bez komunikatu o czekaniu na peera.**

- [ ] **Step 2: Scenariusz równoczesnej edycji (CAS)**

1. A i B online, oba dodają różne projekty „X" (A) i „Y" (B) niemal równocześnie.
2. Jeden push przejdzie (rev N+1), drugi dostanie `stale_revision` → log `push stale ... pull+merge i retry` → przejdzie jako rev N+2.
3. Po kilku interwałach oba urządzenia mają i „X", i „Y". Zero utraty.

- [ ] **Step 3: Potwierdź brak zawieszania**

Sprawdź, że gdy drugie urządzenie jest offline, sync A kończy się szybko (push) — żadnego 60s czekania, żadnego overlaya „recording paused".

- [ ] **Step 4: Jeśli OK — tag/commit notatki weryfikacyjnej (opcjonalnie)**

---

## FAZA 2 — Merge bezprzerwowy (shadow copy + atomowy swap)

Cel: usunąć krótki freeze z Fazy 1. Merge liczony na kopii-cieniu bazy; nagrywanie pisze dalej do żywej bazy; na końcu pogodzenie zapisów z okna merge + restore wyniku do żywej bazy (rusqlite Backup API, ten sam mechanizm co `restore_database_backup_typed`). **Ryzyko techniczne: atomowość restore względem otwartych połączeń nagrywania — twardo testowane poniżej.**

---

### Task 10: `shadow_db_path` + `merge_incoming_nonblocking`

**Files:**
- Modify: `src/sync_common.rs` — dodać `shadow_db_path()` i `merge_incoming_nonblocking(...)`.
- Test: `src/sync_common.rs` (`#[cfg(test)]`)

- [ ] **Step 1: Helper ścieżki cienia**

```rust
fn shadow_db_path() -> Result<std::path::PathBuf, String> {
    let main = crate::config::dashboard_db_path().map_err(|e| e.to_string())?;
    Ok(main.with_file_name("timeflow_dashboard-shadow.db"))
}
```

- [ ] **Step 2: Napisz failing test równoważności shadow vs direct**

Test: dwie identyczne bazy na dysku (tmp). Na jednej zrób `merge_incoming_data` bezpośrednio; na drugiej `merge_incoming_nonblocking`. Wynikowe `compute_tables_hash_string_conn` muszą być równe.
```rust
#[test]
fn nonblocking_merge_matches_direct_merge() {
    let tmp = tempdir().unwrap();
    let direct_path = tmp.path().join("direct.db");
    let live_path = tmp.path().join("live.db");
    seed_db_file(&direct_path); // ta sama treść w obu
    seed_db_file(&live_path);
    let incoming = build_full_export(&open_seeded_other()).unwrap(); // dane do wmergowania

    // direct
    let mut d = open_rw(&direct_path);
    merge_incoming_data(&mut d, &incoming).unwrap();
    verify_merge_integrity(&d).unwrap();
    let hd = compute_tables_hash_string_conn(&d);

    // nonblocking (na kopii live_path -> swap do live_path)
    merge_incoming_nonblocking(&live_path, &incoming).unwrap();
    let l = open_rw(&live_path);
    let hl = compute_tables_hash_string_conn(&l);

    assert_eq!(hd, hl, "shadow merge dał inny wynik niż direct merge");
}
```
(Dostosuj helpery `seed_db_file`, `open_rw`, `open_seeded_other` do realnego schematu — wzoruj na istniejących test helperach sync_common.)

- [ ] **Step 3: Implementuj `merge_incoming_nonblocking`**

```rust
/// Merge danych do bazy pod `live_path` BEZ trzymania write-locka na czas merge:
/// 1) backup live -> shadow (online, bezpieczne przy współbieżnych zapisach),
/// 2) merge incoming do shadow + verify,
/// 3) fold świeżych zapisów z żywej bazy do shadow (drugi merge pełnego eksportu live),
/// 4) restore shadow -> live (rusqlite Backup, krótki write-lock ~ rozmiar bazy).
pub fn merge_incoming_nonblocking(live_path: &std::path::Path, incoming: &str) -> Result<(), String> {
    let shadow = shadow_db_path()?;
    let _ = std::fs::remove_file(&shadow);

    // 1) snapshot live -> shadow
    {
        let live = rusqlite::Connection::open_with_flags(
            live_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ).map_err(|e| e.to_string())?;
        live.busy_timeout(std::time::Duration::from_millis(5000)).map_err(|e| e.to_string())?;
        let mut shadow_conn = rusqlite::Connection::open(&shadow).map_err(|e| e.to_string())?;
        let b = rusqlite::backup::Backup::new(&live, &mut shadow_conn).map_err(|e| e.to_string())?;
        b.run_to_completion(100, std::time::Duration::from_millis(50), None).map_err(|e| e.to_string())?;
    }

    // 2) merge incoming do shadow + verify (FK OFF)
    {
        let mut shadow_conn = rusqlite::Connection::open(&shadow).map_err(|e| e.to_string())?;
        timeflow_shared::sync::connection::set_merge_pragmas(&shadow_conn)?;
        merge_incoming_data(&mut shadow_conn, incoming)?;
        verify_merge_integrity(&shadow_conn)?;
    }

    // 3) fold świeżych zapisów żywej bazy do shadow (zapisy z okna merge)
    {
        let live = open_rw_path(live_path)?;          // helper otwierający z merge pragmas
        let live_export = build_full_export(&live)?;
        let mut shadow_conn = open_rw_path(&shadow)?;
        merge_incoming_data(&mut shadow_conn, &live_export)?;
        verify_merge_integrity(&shadow_conn)?;
        shadow_conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").map_err(|e| e.to_string())?;
    }

    // 4) restore shadow -> live (krótki write-lock)
    {
        let src = rusqlite::Connection::open(&shadow).map_err(|e| e.to_string())?;
        let mut live = rusqlite::Connection::open_with_flags(
            live_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE,
        ).map_err(|e| e.to_string())?;
        live.busy_timeout(std::time::Duration::from_millis(10000)).map_err(|e| e.to_string())?;
        let b = rusqlite::backup::Backup::new(&src, &mut live).map_err(|e| e.to_string())?;
        b.run_to_completion(200, std::time::Duration::from_millis(25), None).map_err(|e| e.to_string())?;
    }
    let _ = std::fs::remove_file(&shadow);
    Ok(())
}
```
Dodaj helper `open_rw_path(path) -> Result<Connection,String>` (open RW + `set_merge_pragmas`).

- [ ] **Step 4: Uruchom test równoważności — PASS**

Run: `cd /Users/micz/__DEV__/__cfab_demon && cargo test nonblocking_merge_matches_direct_merge -- --nocapture`
Expected: PASS (hash identyczny).

- [ ] **Step 5: Commit**

```bash
git add src/sync_common.rs
git commit -m "feat(online-sync): non-blocking shadow merge + atomic restore-swap"
```

---

### Task 11: Test okna zapisu (zapis w trakcie merge nie ginie)

**Files:**
- Test: `src/sync_common.rs` (`#[cfg(test)]`)

- [ ] **Step 1: Napisz test współbieżnego zapisu**

Symuluj zapis nagrywania w trakcie merge: po kroku 1 (snapshot), a przed krokiem 4 (restore), wstaw do żywej bazy nową sesję; po `merge_incoming_nonblocking` sesja musi istnieć w wyniku. Najprościej testem deterministycznym: rozbij `merge_incoming_nonblocking` tak, by przyjmował opcjonalny callback `after_snapshot: FnOnce()` (test wstawia wiersz do live), albo napisz wariant testowy. Asercja:
```rust
#[test]
fn writes_during_merge_window_survive() {
    // ... setup live + incoming ...
    // hook: po snapshot wstaw sesję S do live
    merge_incoming_nonblocking_with_hook(&live_path, &incoming, || insert_session(&live_path, "S"));
    let l = open_rw(&live_path);
    assert!(session_exists(&l, "S"), "zapis z okna merge zaginął po swapie");
    assert!(project_exists(&l, "incoming_project"), "dane incoming nie wmergowane");
}
```

- [ ] **Step 2: Uruchom — PASS**

Run: `cd /Users/micz/__DEV__/__cfab_demon && cargo test writes_during_merge_window_survive -- --nocapture`
Expected: PASS (fold z kroku 3 zachowuje zapis S).

- [ ] **Step 3: Commit**

```bash
git add src/sync_common.rs
git commit -m "test(online-sync): writes during merge window survive shadow swap"
```

---

### Task 12: Podłącz non-blocking merge; usuń freeze z pętli

**Files:**
- Modify: `src/online_store_forward.rs` — `do_pull_merge` używa `merge_incoming_nonblocking` zamiast freeze + `merge_incoming_data`.

- [ ] **Step 1: Zamień ciało merge w `do_pull_merge`**

Usuń `sync_state.freeze()/unfreeze()` i blok `open_dashboard_db + merge_incoming_data`, zastąp:
```rust
    let live_path = config::dashboard_db_path().map_err(|e| e.to_string())?;
    // backup bezpieczeństwa przed swapem
    { let conn = lan_common::open_dashboard_db()?; sync_common::backup_database_typed(&conn, "online")?; }
    sync_common::merge_incoming_nonblocking(&live_path, &slave_data)?;
    let merged_hash = { let conn = lan_common::open_dashboard_db()?;
        sync_common::compute_tables_hash_string_conn(&conn) };
```
(`dashboard_db_path` jest `pub(crate)` — jeśli nie, udostępnij.)

- [ ] **Step 2: Kompilacja + testy**

Run: `cd /Users/micz/__DEV__/__cfab_demon && cargo build && cargo test`
Expected: PASS.

- [ ] **Step 3: Usuń resztki freeze z overlaya**

Jeśli `db_frozen` nie jest już nigdzie ustawiane w ścieżce online sync, upewnij się, że overlay nie polega na nim dla online. (LAN sync może nadal używać freeze — nie ruszaj LAN.)

- [ ] **Step 4: Commit**

```bash
git add src/online_store_forward.rs
git commit -m "feat(online-sync): use non-blocking shadow merge in sync loop (no recording freeze)"
```

---

### Task 13: Weryfikacja manualna Fazy 2 — zero pauzy nagrywania

**Files:** brak (manualny).

- [ ] **Step 1: Nagrywanie podczas dużego merge**

1. Urządzenie B z aktywnym nagrywaniem (śledzenie aplikacji włączone).
2. Urządzenie A wypycha sporą zmianę.
3. B robi pull+merge — obserwuj, że licznik czasu/nagrywanie **nie zatrzymuje się** (brak luki w sesjach), a po sync widać dane z A.

- [ ] **Step 2: Sprawdź brak osieroconej kopii**

Po sync nie ma pliku `timeflow_dashboard-shadow.db` (sprzątany). Brak `frozen` w logach online.

- [ ] **Step 3: Stress — sync w pętli + ciągłe nagrywanie**

Wymuś kilka syncy pod rząd przy aktywnym nagrywaniu; sprawdź integralność (brak zdublowanych/utraconych sesji), `cargo test` nadal zielone.

---

## Self-review pokrycia spec

| Wymóg spec | Task |
|---|---|
| §2.1 brak peer-wait | Task 7 (usunięcie), Task 9 Step 3 (weryfikacja) |
| §2.2 offline-forward (B odbiera dane offline A) | Task 4 (pull), Task 9 Step 1 |
| §2.3 nagrywanie się nie zatrzymuje | Faza 2 (Task 10-12), Task 13 |
| §2.4 żaden push nie ginie (CAS) | Task 1 (serwer CAS), Task 5 (retry), Task 6/9 Step 2 |
| §2.5 brak frozen DB przy błędzie | `guarded_then_cleanup` w Task 4; Faza 2 merge na kopii (live nietknięte) |
| §4.1 serwer reuse direct-sync + CAS | Task 1 |
| §4.2 klient: pętla status→pull→merge→push | Task 2,3,4 |
| §5 CAS + content-hash stop, 3+ devices | Task 1, Task 6 |
| §6 shadow merge + swap <100ms | Task 10-12 |
| §8 stan: clientRevision + lastSyncedHash | Task 4 Step 1 |
| §9 overlay + Help.tsx | Task 8 |
| §11 testy (roundtrip, CAS, okno merge, stop) | Task 1,6,11 |

**Świadomie wykreślone z spec (po odkryciach z kodu):** per-device `lastSeenRevision` na serwerze (§4.1) — niepotrzebne, klient zna własną rewizję lokalnie; serwer śledzi tylko wspólną rewizję. Klient ignoruje `command` z `/sync/status` i liczy decyzję sam (omija sprzężenie z liczbą online).

## Ryzyka / punkty do twardej weryfikacji w trakcie
1. **Kształt `archive` vs `build_full_export`** (Task 4 Step 4/5) — opakowanie `{ data: {...} }` musi pasować do tego, czego oczekuje `merge_incoming_data`. Zweryfikuj integracyjnie zanim pójdziesz dalej.
2. **userId w body direct-sync** (Task 5 Step 3) — rozstrzygnij, czy serwer nadpisuje z tokena, czy trzeba serwerowego fallbacku.
3. **Atomowość restore-swap** (Task 10/11) — Backup API restore vs otwarte połączenia nagrywania; testy Task 11 to bramka. Jeśli restore okaże się zawodny przy współbieżności, alternatywa: krótki write-lock przez `BEGIN IMMEDIATE` na live na czas restore.
4. **Czas swapu skaluje się z rozmiarem bazy** — „<100ms" dotyczy realnych rozmiarów TIMEFLOW (kilka–kilkadziesiąt MB). Odnotuj w razie dużych baz.
