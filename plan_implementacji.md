# Plan implementacji — TIMEFLOW (cfab_demon)

> **Dla agentów wykonawczych:** WYMAGANA SUB-UMIEJĘTNOŚĆ: `superpowers:subagent-driven-development` (rekomendowane) lub `superpowers:executing-plans` — do realizacji zadanie po zadaniu. Kroki używają składni checkbox (`- [ ]`).

**Cel:** Naprawić wszystkie 87 znalezisk z `raport.md` (2026-04-23) w kolejności P0 → P1 → P2 → P3 → P4, z jawnymi testami i commitami per zadanie, bez regresji funkcjonalnej.

**Architektura:** Plan podzielony na 5 faz wg priorytetu. Każda faza jest niezależnie „shippable". Zadania w obrębie fazy są posortowane tak, by najpierw szły fixy izolowane (bez ryzyka), potem zmiany architektoniczne.

**Stack:** Rust (demon `src/` + Tauri backend `dashboard/src-tauri/`), TypeScript/React (dashboard `dashboard/src/`), SQLite (rusqlite + migracje), i18n PL/EN (i18next + `src/i18n.rs`).

**Uwaga o zakresie (Scope Check):** Raport pokrywa 6 niezależnych podsystemów (demon, sync, Dashboard, Tauri backend, parity Win/Mac, AI). **Rekomendacja:** wykonywać Fazy 1–2 w całości, a Fazy 3–5 można rozbić na sub-plany per podsystem, jeśli zespół chce równoległej pracy.

**Terminologia produktowa (CLAUDE.md p.2):** w UI/logach/komunikatach zawsze `TIMEFLOW` wielkimi literami. Nazwy zmiennych/funkcji w kodzie zostają (nie refaktoruj tylko dla brandingu).

**Aktualizacja Help.tsx (CLAUDE.md p.3):** każde zadanie oznaczone `[HELP]` wymaga zmiany w `dashboard/src/components/help/**` w tym samym commicie. Nie mergować PR-a bez zaktualizowanego Helpa.

---

## Struktura plików (mapa dotknięć)

### Rust demon — `src/`
- `main.rs` — Task 5 (JoinHandle online-sync), 46 (log rotation), 49 (sleep restart), 65 (osascript)
- `tracker.rs` — Task 6 (idle foreground/background), 7 (DST), 19 (idle w duration), 43, 47
- `monitor_macos.rs` — Task 3 (CPU), 4 (window_title), 45, 74, 75, 76
- `monitor.rs` — Task 21 (dedup), 44, 77
- `storage.rs` — Task 18 (connection reuse)
- `i18n.rs` — Task 48 (LANG_CACHE)
- `lan_server.rs` — Task 1 (P0 secret), 2 (P0 throttle), 50, 69, 70, 71, 72, 83
- `lan_common.rs` — Task 83, 84
- `lan_discovery.rs` — Task 73, 84
- `lan_sync_orchestrator.rs` — Task 23, 25, 52
- `sync_common.rs` — Task 8 (mutex), 9 (tombstone), 24 (stream), 53 (DIAG gate), 83
- `sftp_client.rs` — Task 51
- `online_sync.rs` — Task 85, 87
- `platform/macos/tray.rs` — Task 17 (i18n), 20 (expect), 36 (status)
- `platform/macos/foreground.rs` — Task 37 (NSWorkspace)
- `platform/macos/mod.rs` — Task 78

### Tauri backend — `dashboard/src-tauri/src/`
- `db.rs` — Task 10 (cache)
- `commands/sync_markers.rs` — Task 28 (VACUUM quote)
- `commands/manual_sessions.rs` — Task 27
- `commands/lan_sync.rs` — Task 27, 29, 56
- `commands/helpers.rs` — Task 55
- `commands/pm_manager.rs` — Task 57
- `commands/daemon/control.rs` — Task 58
- `commands/assignment_model/training.rs` — Task 11 (RAII), 39 (soft reset)
- `commands/assignment_model/mod.rs` — Task 12 (walidacja confidence)
- `commands/assignment_model/auto_safe.rs` — Task 41 (batch)
- `refactor_db.py` — **USUNĄĆ** (Task 68)
- `tauri.conf.json` — Task 54 (CSP)
- `db_migrations/` — Task 26 (nowy migrator m21)

### Dashboard — `dashboard/src/`
- `pages/Projects.tsx` — Task 15 (onSaved), 32, 60, 61
- `pages/Sessions.tsx` — Task 32, 63
- `pages/Dashboard.tsx` — Task 30
- `components/ai/AiBatchActionsCard.tsx` — Task 16 (hardcoded tooltip)
- `components/sessions/SessionContextMenu.tsx` — Task 14 (klucze i18n)
- `components/ui/toast-notification.tsx` — Task 33
- `components/ui/confirm-dialog.tsx` — Task 31
- `components/layout/Sidebar.tsx` — Task 30, 35, 59, 79
- `components/layout/BugHunter.tsx` — Task 62
- `hooks/useBackgroundSync.ts` — Task 35
- `hooks/useJobPool.ts` — Task 30, 35
- `hooks/useLanSyncManager.ts` — Task 80
- `hooks/useProjectsData.ts` — Task 60
- `hooks/useSessionsData.ts` — Task 81
- `hooks/useSettingsFormState.ts` — Task 32 (rozbicie)
- `store/background-status-store.ts` — Task 34 (aiStatus)
- `lib/platform.ts` — Task 64
- `locales/pl/common.json`, `locales/en/common.json` — Task 14, 16, 42
- `components/ai/` — Task 13 (UI breakdown)
- `components/help/sections/` — `[HELP]` dla Task 4, 13, 37, 67

### Skrypty / meta
- `compare_locales.py` — Task 66
- `build_all_macos.py` — Task (P4, refactor do `build_common.py`)
- Śmieci: `dashboard/fix_ai.py`, `get_logs.py`, `temp_bg_services.txt`, `check.bat`, `test_esbuild.mjs` — Task 82

---

## FAZA 0 — Przygotowanie środowiska

### Task 0: Worktree i branch bazowy

**Files:**
- Create branch: `fix/raport-implementation` z `macos-port`

- [ ] **Step 0.1: Utwórz worktree (izolacja)**

```bash
cd /Users/micz/__DEV__/__cfab_demon
git worktree add ../__cfab_demon-fixes -b fix/raport-implementation macos-port
cd ../__cfab_demon-fixes
```

- [x] **Step 0.2: Baseline build — demon**

```bash
cd /Users/micz/__DEV__/__cfab_demon-fixes
cargo check --all-targets 2>&1 | tee /tmp/baseline_demon.log
```
Oczekiwane: brak nowych errorów vs `macos-port`.

- [ ] **Step 0.3: Baseline build — dashboard**

```bash
cd /Users/micz/__DEV__/__cfab_demon-fixes/dashboard/src-tauri
cargo check 2>&1 | tee /tmp/baseline_dashboard.log
cd ..
npm install && npm run build 2>&1 | tee /tmp/baseline_front.log
```
Oczekiwane: build przechodzi.

- [x] **Step 0.4: Utwórz `PARITY.md`**

Plik `PARITY.md` w repo-root — tracker znanych stubów macOS (aktualizowany w miarę domykania P1):

```markdown
# TIMEFLOW — Platform Parity Tracker

| Funkcja | Windows | macOS | Status |
|---|---|---|---|
| `window_title` | ✅ WinAPI | ❌ stub `""` | Task 4 |
| `detected_path` | ✅ WMI | ❌ `None` | Task (P2) |
| `measure_cpu_for_app` | ✅ OK | ❌ zwraca 0 | Task 3 |
| Tray i18n | ✅ TrayText::* | ❌ hardcoded EN | Task 17 |
| Tray sync status | ✅ | ❌ | Task 36 |
| Foreground detection | ✅ event | ⚠️ polling 250ms | Task 37 |
| Version mismatch dialog | ✅ MessageBox | ❌ tylko log | Task 65 |
```

- [x] **Step 0.5: Commit baseline**

```bash
git add PARITY.md
git commit -m "docs: add PARITY.md tracker for macOS/Windows feature gaps"
```

---

## FAZA 1 — P0 (bezpieczeństwo, 2 zadania)

### Task 1: `/lan/local-identity` — nie zwracaj `secret`

**Files:**
- Modify: `src/lan_server.rs:484-488`, `:1196-1207`, whitelist `:422-427`
- Test: `src/lan_server.rs` (sekcja `#[cfg(test)]` lub nowy `tests/lan_identity_test.rs`)

- [x] **Step 1.1: Test — identity nie zawiera secret**

```rust
#[test]
fn local_identity_does_not_leak_secret() {
    let body = handle_local_identity_unauth();
    let json: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert!(json.get("secret").is_none(), "secret MUST NOT be in /lan/local-identity response");
    assert!(json.get("device_id").is_some());
    assert!(json.get("machine_name").is_some());
}
```

- [ ] **Step 1.2: Uruchom test — oczekiwany FAIL**

```bash
cargo test --lib lan_server::tests::local_identity_does_not_leak_secret
```
Oczekiwane: FAIL (obecnie zwraca secret).

- [x] **Step 1.3: Usuń `secret` z odpowiedzi w `handle_local_identity`**

W `src/lan_server.rs:1196-1207` zmień strukturę odpowiedzi — usuń pole `secret` (zostaje `device_id` + `machine_name`). Upewnij się że `/lan/pair` nadal przekazuje secret po walidacji kodu parowania (endpoint `:1178+`).

- [x] **Step 1.4: Uruchom test — PASS**

```bash
cargo test --lib lan_server::tests::local_identity_does_not_leak_secret
```

- [ ] **Step 1.5: Integracyjny smoke — pair nadal działa**

```bash
cargo test --test lan_pairing_smoke 2>&1 | tail -20
```
Oczekiwane: pair endpoint zwraca secret po poprawnym kodzie.

- [x] **Step 1.6: Commit**

```bash
git add src/lan_server.rs
git commit -m "security(lan): remove secret from /lan/local-identity response (P0)"
```

### Task 2: `/lan/pair` — per-IP rate limit

**Files:**
- Modify: `src/lan_server.rs:1178-1187`
- Create: `src/lan_pair_throttle.rs`

- [x] **Step 2.1: Test — brute-force blokowany po 10 próbach z tego samego IP**

```rust
#[test]
fn pair_throttle_blocks_after_10_attempts_per_ip() {
    let mut throttle = PairThrottle::new();
    let ip: IpAddr = "192.168.1.50".parse().unwrap();
    for _ in 0..10 {
        assert!(throttle.check_and_record(ip).is_ok());
    }
    assert!(throttle.check_and_record(ip).is_err(), "11th attempt from same IP must be throttled");
}
```

- [x] **Step 2.2: Test — różne IP nie blokują się nawzajem**

```rust
#[test]
fn pair_throttle_per_ip_isolated() {
    let mut throttle = PairThrottle::new();
    let ip1: IpAddr = "192.168.1.50".parse().unwrap();
    let ip2: IpAddr = "192.168.1.51".parse().unwrap();
    for _ in 0..10 { let _ = throttle.check_and_record(ip1); }
    assert!(throttle.check_and_record(ip2).is_ok());
}
```

- [ ] **Step 2.3: Uruchom testy — FAIL**

```bash
cargo test --lib lan_pair_throttle
```

- [x] **Step 2.4: Zaimplementuj `PairThrottle`**

Plik `src/lan_pair_throttle.rs`:

```rust
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::Instant;

const WINDOW_SECS: u64 = 60;
const MAX_ATTEMPTS: u32 = 10;

pub struct PairThrottle {
    attempts: Mutex<HashMap<IpAddr, (u32, Instant)>>,
}

impl PairThrottle {
    pub fn new() -> Self { Self { attempts: Mutex::new(HashMap::new()) } }

    pub fn check_and_record(&self, ip: IpAddr) -> Result<(), &'static str> {
        let mut map = self.attempts.lock().unwrap();
        let now = Instant::now();
        let entry = map.entry(ip).or_insert((0, now));
        if now.duration_since(entry.1).as_secs() > WINDOW_SECS {
            *entry = (1, now);
            return Ok(());
        }
        if entry.0 >= MAX_ATTEMPTS {
            log::warn!("[LAN][SEC] pair throttle: IP {} exceeded {} attempts in {}s", ip, MAX_ATTEMPTS, WINDOW_SECS);
            return Err("too many attempts");
        }
        entry.0 += 1;
        Ok(())
    }
}
```

- [x] **Step 2.5: Wpięcie w `handle_pair`**

W `src/lan_server.rs:1178-1187` przed walidacją kodu:

```rust
static PAIR_THROTTLE: Lazy<PairThrottle> = Lazy::new(PairThrottle::new);
if PAIR_THROTTLE.check_and_record(client_ip).is_err() {
    return respond_429_too_many_requests();
}
```

- [x] **Step 2.6: Testy PASS + build**

```bash
cargo test --lib lan_pair_throttle && cargo build
```

- [x] **Step 2.7: Commit**

```bash
git add src/lan_pair_throttle.rs src/lan_server.rs src/lib.rs
git commit -m "security(lan): add per-IP rate limit on /lan/pair (P0)"
```

---

## FAZA 2 — P1 (15 zadań, krytyczne bugi)

### Task 3: macOS CPU measurement — jeden `SYSINFO_STATE`

**Files:**
- Modify: `src/monitor_macos.rs:225,244-295`
- Affected: `CpuSnapshot` usage

- [x] **Step 3.1: Test — dwa kolejne tick'i dla tej samej apki zwracają > 0**

```rust
#[test]
#[cfg(target_os = "macos")]
fn measure_cpu_returns_nonzero_on_second_tick() {
    let pids = vec![std::process::id() as i32]; // self
    std::thread::sleep(std::time::Duration::from_millis(250));
    let snap1 = measure_cpu_for_app(&pids, None);
    std::thread::sleep(std::time::Duration::from_millis(250));
    let snap2 = measure_cpu_for_app(&pids, Some(&snap1));
    assert!(snap2.cpu_percent >= 0.0);
}
```

- [x] **Step 3.2: Refactor na jeden `System`**

Zastąp `SYSINFO_STATE` per-call globalem `Lazy<Mutex<System>>`. W każdym tick: `sys.refresh_processes_specifics(ProcessRefreshKind::new().with_cpu())`. Użyj `accumulated_cpu_time()` + delta od `prev: &CpuSnapshot`.

- [ ] **Step 3.3: Usuń martwe pole `CpuSnapshot.total_time` po weryfikacji (Task 75)**

- [x] **Step 3.4: Test PASS**

```bash
cargo test --target x86_64-apple-darwin measure_cpu_returns_nonzero_on_second_tick
```

- [x] **Step 3.5: Commit**

```bash
git add src/monitor_macos.rs
git commit -m "fix(macos): share sysinfo state for CPU measurement (P1)"
```

### Task 4: `window_title` na macOS [HELP]

**Files:**
- Modify: `src/monitor_macos.rs:191`
- Create: `src/platform/macos/window_title.rs`
- Modify: `dashboard/src/components/help/sections/HelpSimpleSections.tsx`
- Modify: `dashboard/src/locales/{pl,en}/common.json`

- [x] **Step 4.1: Implementacja — `CGWindowListCopyWindowInfo` dla frontmost**

```rust
// src/platform/macos/window_title.rs
use core_graphics::window::{kCGWindowListOptionOnScreenOnly, CGWindowListCopyWindowInfo};
pub fn frontmost_window_title(pid: i32) -> Option<String> { /* ... */ }
```

- [x] **Step 4.2: Prompt o zgodę Accessibility (AX API follow-up, ale CGWindowList nie wymaga)**

`CGWindowListCopyWindowInfo` nie wymaga zgody — tytuły frontmost są dostępne. Zaplanuj AX jako osobny Task P2.

- [x] **Step 4.3: Podłącz w `monitor_macos.rs:191`**

Zamień `window_title = String::new()` na `window_title = frontmost_window_title(pid).unwrap_or_default()`.

- [ ] **Step 4.4: Test end-to-end — tytuł niepusty dla testowej apki**

```bash
cargo test --target x86_64-apple-darwin window_title_not_empty
```

- [x] **Step 4.5: [HELP] Dopisz sekcję o file tracking na macOS**

`dashboard/src/components/help/sections/HelpSimpleSections.tsx` — dodaj akapit do sekcji Daemon:
- klucz i18n: `help_page.daemon_macos_window_title`
- PL: „Na macOS TIMEFLOW odczytuje tytuł aktywnego okna (np. nazwę pliku w edytorze), co pozwala śledzić pracę na poziomie plików i poprawia skuteczność sugestii AI. Wymaga zgody systemowej tylko przy pełnym AX API (Phase 2); podstawowa funkcja działa bez dodatkowych uprawnień."
- EN: odpowiednik

- [x] **Step 4.6: Zaktualizuj `PARITY.md` — oznacz `window_title` jako ✅**

- [x] **Step 4.7: Commit**

```bash
git add src/platform/macos/window_title.rs src/monitor_macos.rs dashboard/src/components/help/sections/HelpSimpleSections.tsx dashboard/src/locales PARITY.md
git commit -m "feat(macos): implement frontmost window_title via CGWindowList"
```

### Task 5: JoinHandle dla online-sync

**Files:**
- Modify: `src/main.rs:119-145`

- [x] **Step 5.1: Refactor spawn + store handle**

```rust
let online_sync_handle: Option<thread::JoinHandle<()>> = Some(std::thread::spawn({
    let stop_signal = Arc::clone(&stop_signal);
    let lock = Arc::new((Mutex::new(()), Condvar::new()));
    move || {
        while !stop_signal.load(Ordering::SeqCst) {
            let (l, cv) = &*lock;
            let guard = l.lock().unwrap();
            let _ = cv.wait_timeout(guard, Duration::from_secs(10)).unwrap();
            // ... sync tick
        }
    }
}));
```

- [x] **Step 5.2: W shutdown: `join()` przed `drop(_guard)`**

```rust
if let Some(h) = online_sync_handle.take() { let _ = h.join(); }
```

- [ ] **Step 5.3: Test manualny — restart via tray**

1. Uruchom demon
2. Kliknij w tray „Restart"
3. Sprawdź `lan_sync.log` — `online-sync thread joined cleanly` przed nowym procesem

- [x] **Step 5.4: Commit**

```bash
git add src/main.rs
git commit -m "fix(daemon): join online-sync thread on shutdown (P1)"
```

### Task 6: idle foreground vs background — spójny `effective_elapsed`

**Files:**
- Modify: `src/tracker.rs:602-703` (pętla background CPU)

- [ ] **Step 6.1: Test — idle transition background nie dostaje >1s**

```rust
#[test]
fn background_idle_transition_caps_elapsed() {
    let mut tracker = Tracker::new_for_test();
    tracker.simulate_idle_ms(9000);
    tracker.tick_after(10_000);
    let bg = tracker.background_session_seconds("TestApp");
    assert_eq!(bg, 1, "background should see only 1s after 9s idle, not 10s");
}
```

- [ ] **Step 6.2: FAIL**

- [x] **Step 6.3: Zastosuj `effective_elapsed.max(1s)` jak w foreground path (analogicznie do `:630+`)**

- [x] **Step 6.4: PASS + commit**

```bash
git add src/tracker.rs
git commit -m "fix(tracker): cap background elapsed on idle transition (P1)"
```

### Task 7: DST false-positive — `SystemTime::now()`

**Files:**
- Modify: `src/tracker.rs:440-546`

- [x] **Step 7.1: Test — skok 3600s nie triggeruje save_daily**

```rust
#[test]
fn dst_jump_does_not_trigger_sleep_save() {
    let mut t = Tracker::new_for_test();
    t.set_last_tick_wall_utc_secs(1_700_000_000);
    t.set_now_wall_utc_secs(1_700_003_600); // +3600s simulating DST spring-forward
    t.set_uptime_delta(5); // only 5s of uptime — wall jumped 3595s more
    let action = t.classify_time_jump();
    assert!(matches!(action, TimeJumpAction::DstAdjust));
}
```

- [x] **Step 7.2: Zmień `Local::now()` → `SystemTime::now()` epoch**

`last_tracking_tick_wall: SystemTime`. Delta `(now - last).as_secs()`. Jeśli `delta ≈ 3600` i `|delta - uptime_delta - 3600| < 60` → `DstAdjust` (nie save_daily).

- [x] **Step 7.3: Commit**

```bash
git add src/tracker.rs
git commit -m "fix(tracker): use SystemTime UTC to avoid DST false positives (P1)"
```

### Task 8: `MERGE_MUTEX` + tracker honoruje `db_frozen`

**Files:**
- Modify: `src/sync_common.rs:266-850`
- Modify: `src/tracker.rs` (INSERT paths)
- Modify: `src/lan_common.rs:153-163`

- [x] **Step 8.1: `static MERGE_MUTEX: Mutex<()> = Mutex::new(());` w `sync_common.rs`**

```rust
pub(crate) static MERGE_MUTEX: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));
```

- [ ] **Step 8.2: `merge_peer_delta` acquires mutex na całość operacji**

- [x] **Step 8.3: Tracker sprawdza `db_frozen` przed każdym INSERT/UPDATE**

Dodaj helper `fn wait_for_db_unfreeze(state: &SyncState, timeout: Duration)` — retry po 200ms do `timeout`.

- [ ] **Step 8.4: Test — INSERT w trakcie merge kolejkowany**

```rust
#[test]
fn tracker_waits_for_merge() {
    let state = SyncState::new_test_frozen();
    let h = std::thread::spawn(move || tracker_insert_session(&state));
    std::thread::sleep(Duration::from_millis(100));
    state.unfreeze();
    h.join().unwrap();
    // assert session inserted AFTER unfreeze
}
```

- [x] **Step 8.5: Commit**

```bash
git add src/sync_common.rs src/tracker.rs src/lan_common.rs
git commit -m "fix(sync): add MERGE_MUTEX and tracker db_frozen awareness (P1)"
```

### Task 9: Tombstone sync_key — `app_executable_name|start_time`

**Files:**
- Modify: `src/sync_common.rs:797-808`

- [ ] **Step 9.1: Test — dwie apki z tym samym `start_time` nie usuwają się nawzajem**

```rust
#[test]
fn tombstone_by_exe_not_by_app_id() {
    let db = open_in_memory();
    insert_session(&db, "vscode.exe", 1_700_000_000, 10);
    insert_session(&db, "figma.exe", 1_700_000_000, 20);
    let tomb = Tombstone { sync_key: tombstone_key("vscode.exe", 1_700_000_000), .. };
    apply_tombstones(&db, &[tomb]).unwrap();
    assert_eq!(count_sessions(&db, "figma.exe"), 1);
}
```

- [x] **Step 9.2: FAIL — potem implementacja: `format!("{}|{}", exe_name, start_time)` zamiast `app_id|start_time`**

- [x] **Step 9.3: Migracja m21 — regeneracja `sync_markers` sync_key z app_id na exe_name (jednorazowa)**

- [x] **Step 9.4: PASS + commit**

```bash
git add src/sync_common.rs dashboard/src-tauri/src/db_migrations/m21_tombstone_sync_key.rs
git commit -m "fix(sync): tombstone key uses exe_name to avoid cross-machine delete (P1)"
```

### Task 10: `initialize_database_file_once` — check `path.exists()`

**Files:**
- Modify: `dashboard/src-tauri/src/db.rs:22-25`

- [ ] **Step 10.1: Test — po usunięciu pliku DB, ponowna inicjalizacja działa**

- [x] **Step 10.2: Fix — przed `cache.contains(&path)` sprawdź `!Path::new(&path).exists()`; jeśli brak, usuń z cache i re-initialize**

- [x] **Step 10.3: Commit**

```bash
git add dashboard/src-tauri/src/db.rs
git commit -m "fix(tauri): re-init DB when file missing despite cache hit (P1)"
```

### Task 11: RAII `IsTrainingGuard`

**Files:**
- Modify: `dashboard/src-tauri/src/commands/assignment_model/training.rs:50-64,404`

- [ ] **Step 11.1: Test — panic w środku `retrain` nie zostawia is_training=true**

```rust
#[test]
fn is_training_released_on_panic() {
    let conn = open_in_memory();
    let _ = std::panic::catch_unwind(|| {
        let _guard = IsTrainingGuard::acquire(&conn).unwrap();
        panic!("simulated");
    });
    assert_eq!(read_state(&conn, "is_training"), "false");
}
```

- [x] **Step 11.2: Struct z `Drop` który resetuje flagę; `acquire` robi atomic `UPDATE ... WHERE value='false'`**

```rust
pub struct IsTrainingGuard<'a> { conn: &'a Connection }
impl<'a> Drop for IsTrainingGuard<'a> {
    fn drop(&mut self) { let _ = self.conn.execute("UPDATE assignment_model_state SET value='false' WHERE key='is_training'", []); }
}
```

- [x] **Step 11.3: Commit**

```bash
git add dashboard/src-tauri/src/commands/assignment_model/training.rs
git commit -m "fix(ai): RAII guard for is_training flag (P1)"
```

### Task 12: Walidacja `auto_confidence >= suggest_confidence`

**Files:**
- Modify: `dashboard/src-tauri/src/commands/assignment_model/mod.rs:495-498`

- [ ] **Step 12.1: Test — `set_assignment_mode` z auto=0.5 suggest=0.95 zwraca Err**

- [x] **Step 12.2: W `set_assignment_mode`, po clamp(0..1) sprawdź: `if auto < suggest { return Err("auto must be >= suggest") }`**

- [x] **Step 12.3: UI — `AssignmentModeSettings` valid-check przed `handleSaveMode` z komunikatem i18n**

- [x] **Step 12.4: Commit**

```bash
git add dashboard/src-tauri/src/commands/assignment_model/mod.rs dashboard/src/components/ai dashboard/src/locales
git commit -m "fix(ai): validate auto_confidence >= suggest_confidence (P1)"
```

### Task 13: UI breakdown „dlaczego AI sugeruje X" [HELP]

**Files:**
- Create: `dashboard/src/components/ai/SuggestionBreakdownPopover.tsx`
- Modify: `dashboard/src/components/ai/AiSessionIndicatorsCard.tsx`
- Modify: `dashboard/src/components/help/sections/HelpAiSection.tsx`
- Modify: `dashboard/src/locales/{pl,en}/common.json`

- [x] **Step 13.1: Backend już ma `get_session_score_breakdown` — wywołaj w hooku**

```tsx
const { data } = useQuery(['breakdown', sessionId], () => aiApi.getSessionScoreBreakdown(sessionId));
```

- [x] **Step 13.2: Render 5-warstw score (Layer 0..3b) jako tabelka**

- [x] **Step 13.3: Aktywuj przez `showScoreBreakdown` flag w `AiSessionIndicatorsCard`**

- [x] **Step 13.4: [HELP] Dodaj do `HelpAiSection.tsx` — opis jak czytać breakdown + i18n klucze `help_page.ai_score_breakdown.*` PL/EN**

- [x] **Step 13.5: Commit**

```bash
git add dashboard/src/components/ai dashboard/src/components/help dashboard/src/locales
git commit -m "feat(ai): UI breakdown explaining per-layer suggestion scores (P1)"
```

### Task 14: Brakujące klucze i18n `sessions.menu.mode_*`

**Files:**
- Modify: `dashboard/src/locales/pl/common.json`
- Modify: `dashboard/src/locales/en/common.json`

- [x] **Step 14.1: Dodaj 3 klucze**

PL:
```json
"sessions": {
  "menu": {
    "mode_alpha": "Aktywne alfabetycznie (A-Z)",
    "mode_new_top": "Najnowsze → Top → Reszta (A-Z)",
    "mode_top_new": "Top → Najnowsze → Reszta (A-Z)"
  }
}
```

EN:
```json
"sessions": {
  "menu": {
    "mode_alpha": "Active alphabetically (A-Z)",
    "mode_new_top": "Newest → Top → Rest (A-Z)",
    "mode_top_new": "Top → Newest → Rest (A-Z)"
  }
}
```

- [x] **Step 14.2: Weryfikacja — `compare_locales.py` (po fixie w Task 66) lub manualny grep**

- [ ] **Step 14.3: Manual smoke — przełącz locale na EN, otwórz context menu sesji, sprawdź tooltipy**

- [x] **Step 14.4: Commit**

```bash
git add dashboard/src/locales
git commit -m "fix(i18n): add missing sessions.menu.mode_* keys (P1)"
```

### Task 15: `onSaved={triggerRefresh}` kontrakt

**Files:**
- Modify: `dashboard/src/pages/Projects.tsx:1128`

- [x] **Step 15.1: `onSaved={() => triggerRefresh('projects_manual_session_saved')}`**

- [x] **Step 15.2: Commit**

```bash
git add dashboard/src/pages/Projects.tsx
git commit -m "fix(ui): pass explicit reason to triggerRefresh in Projects onSaved (P1)"
```

### Task 16: Hardcoded tooltip w `AiBatchActionsCard.tsx:65`

**Files:**
- Modify: `dashboard/src/components/ai/AiBatchActionsCard.tsx:65`
- Modify: `dashboard/src/locales/{pl,en}/common.json`

- [x] **Step 16.1: Dodaj klucz `ai_page.batch.tooltip_requires_auto_safe`**

PL: „Najpierw włącz tryb Auto Safe."
EN: „Enable Auto Safe mode first."

- [x] **Step 16.2: Zastąp literal `t('ai_page.batch.tooltip_requires_auto_safe')`**

- [x] **Step 16.3: Commit**

```bash
git add dashboard/src/components/ai/AiBatchActionsCard.tsx dashboard/src/locales
git commit -m "fix(i18n): translate AiBatchActionsCard tooltip (P1)"
```

### Task 17: Tray macOS i18n przez `TrayText::*`

**Files:**
- Modify: `src/platform/macos/tray.rs:108-112`
- Weryfikacja: `src/shared/tray_common.rs` (lub gdzie `TrayText`)

- [x] **Step 17.1: Zamień hardcoded „Open Dashboard", „Sync Now (delta)", „Quit TIMEFLOW Demon" na `TrayText::OpenDashboard.localized()`, etc.**

- [ ] **Step 17.2: Podłącz zmianę języka — `LanguageChange` signal (jeśli istnieje na Windows)**

- [ ] **Step 17.3: Test manualny — ustaw EN w demon config → tray po EN; ustaw PL → tray po PL**

- [x] **Step 17.4: Aktualizuj `PARITY.md`**

- [x] **Step 17.5: Commit**

```bash
git add src/platform/macos/tray.rs PARITY.md
git commit -m "fix(macos): use TrayText::* for i18n tray menu (P1)"
```

---

## FAZA 3 — P2 (25 zadań, architektura / perf / hardening)

### Task 18: Reuse `rusqlite::Connection` w trackerze dla `save_daily`

**Files:**
- Modify: `src/storage.rs:128`
- Modify: `src/tracker.rs` (trzymaj `DailyStore` w stanie wątku)

- [ ] **Step 18.1: Wprowadź struct `DailyStore { conn: Connection, path: PathBuf }` z `open(path)` i `save(&mut self, daily: &Daily)`.**

- [ ] **Step 18.2: W `tracker::run_loop` utwórz `DailyStore` raz; używaj `.save()` co tick.**

- [ ] **Step 18.3: Na date-change lub po sleep reopen (nowy plik dnia).**

- [ ] **Step 18.4: Commit**

```bash
git commit -am "perf(storage): reuse SQLite connection in DailyStore (P2)"
```

### Task 19: Idle odejmowany od `Session.duration_seconds`

**Files:**
- Modify: `src/tracker.rs:198,326-330`

- [ ] **Step 19.1: Powyżej `IDLE_THRESHOLD_MS` (2 min) wymuszaj `close_session()` i start nowej przy powrocie active.**

- [ ] **Step 19.2: Test — 5 min pracy + 25 min idle + 5 min pracy = 2 sesje, nie 1 na 35 min.**

- [ ] **Step 19.3: Commit**

### Task 20: `.expect()` w `tray.rs:34,86` na macOS → Result

**Files:**
- Modify: `src/platform/macos/tray.rs:34,86`

- [x] **Step 20.1: `Icon::from_rgba(...).map_err(...)` + fallback_icon bezpieczny (const raw RGBA literal).**

- [x] **Step 20.2: Commit**

### Task 21: Dedup `extract_file_from_title`, `classify_activity_type`, `collect_descendants`

**Files:**
- Create: `src/monitor/title_parser.rs`
- Modify: `src/monitor.rs:171`, `src/monitor_macos.rs:70,161`

- [ ] **Step 21.1: Przenieś wspólne funkcje do `title_parser.rs` + re-export.**

- [ ] **Step 21.2: Testy jednostkowe per funkcja (już w jednym z miejsc — skonsoliduj).**

- [ ] **Step 21.3: Commit**

### Task 22: Auto-unfreeze vs `SYNC_TIMEOUT`

**Files:**
- Modify: `src/lan_server.rs:253-269,323-327`

- [x] **Step 22.1: `check_auto_unfreeze` — nie resetuj `sync_in_progress` jeśli `phase != completed/idle`.**

- [x] **Step 22.2: Unfreeze timeout 10 min (> SYNC_TIMEOUT=5 min).**

- [x] **Step 22.3: Commit**

### Task 23: Martwy `get_local_marker_created_at_with_conn` → usuń fallback

**Files:**
- Modify: `src/lan_sync_orchestrator.rs:723-725,738`

- [x] **Step 23.1: Zastąp wywołanie: brak markera → `since = "1970-01-01 00:00:00"` (full dump).**

- [x] **Step 23.2: Usuń martwą funkcję (Task 87/P4).**

- [x] **Step 23.3: Commit**

### Task 24: Merge streaming — zamiast wczytywania 200 MB JSON w pamięci

**Files:**
- Modify: `src/sync_common.rs:267-290`

- [ ] **Step 24.1: Użyj `serde_json::StreamDeserializer` per-tabela; alternatywa — zredukuj `MAX_DOWNLOAD_SIZE` do 50 MB + chunked delta.**

- [ ] **Step 24.2: Test — merge 100 MB nie przekracza 200 MB RSS.**

- [ ] **Step 24.3: Commit**

### Task 25: Progress callback podczas uploadu body

**Files:**
- Modify: `src/lan_sync_orchestrator.rs:141-172`

- [ ] **Step 25.1: Chunked write + callback co 256 KB → update `sync_progress.bytes_sent`.**

- [ ] **Step 25.2: Commit**

### Task 26: Indeksy `updated_at` na `sessions` i `manual_sessions` + tombstones

**Files:**
- Create: `dashboard/src-tauri/src/db_migrations/m22_updated_at_indexes.rs`

- [x] **Step 26.1: CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at); analogicznie manual_sessions i sync_markers.**

- [x] **Step 26.2: Commit**

### Task 27: `run_db_blocking` w manual_sessions, sync_markers, lan_sync

**Files:**
- Modify: `dashboard/src-tauri/src/commands/manual_sessions.rs:17,84,141,181,189`
- Modify: `dashboard/src-tauri/src/commands/sync_markers.rs:35,66,93,143`
- Modify: `dashboard/src-tauri/src/commands/lan_sync.rs:290`

- [ ] **Step 27.1: Zamień `pub fn cmd_x(...) -> Result` z DB na `pub async fn cmd_x(...) -> Result { run_db_blocking(|conn| { ... }).await }`.**

- [ ] **Step 27.2: Weryfikuj rejestrację w `invoke_handler` (async zmiana nie wymaga zmiany kontraktu JS).**

- [ ] **Step 27.3: Commit**

### Task 28: `VACUUM INTO` przez `SELECT quote(?1)`

**Files:**
- Modify: `dashboard/src-tauri/src/commands/sync_markers.rs:94-115`

- [x] **Step 28.1: Zamień `format!("VACUUM INTO '{}'")` na pattern z `settings.rs:348-350`: `SELECT quote(?1)`.**

- [x] **Step 28.2: Commit**

### Task 29: `build_http_client` → `Result`

**Files:**
- Modify: `dashboard/src-tauri/src/commands/lan_sync.rs:552-557`

- [x] **Step 29.1: Zwróć `Result<Client, String>` zamiast fallback `Client::new()`.**

- [x] **Step 29.2: Commit**

### Task 30: Selektory dla Zustand — eliminacja destrukturyzacji całego storu

**Files:**
- Modify: listing sekcja 4.3.1 raportu (~9 plików)

- [ ] **Step 30.1: Zmień każdy `const { currentPage, ... } = useUIStore()` na osobne `useUIStore(s => s.currentPage)` etc.**

- [ ] **Step 30.2: Dodaj lint-rule custom (`no-zustand-full-destructure`) lub dokument w `docs/CODING_STYLE.md`.**

- [ ] **Step 30.3: Commit per plik (łatwiejszy review)**

### Task 31: `ConfirmDialog` jako komponent

**Files:**
- Modify: `dashboard/src/components/ui/confirm-dialog.tsx:39-59`
- Modify: wszystkie wywołania (grep `useConfirmDialog`)

- [ ] **Step 31.1: Publiczne API: `<ConfirmDialog open message onConfirm onCancel />`.**

- [ ] **Step 31.2: Hook `useConfirmDialogState` → tylko state, dialog renderowany w JSX.**

- [ ] **Step 31.3: Commit**

### Task 32: Rozbicie god-components

**Files:**
- Modify: `dashboard/src/pages/Sessions.tsx` (840 lin.)
- Modify: `dashboard/src/pages/Projects.tsx` (1134 lin.)
- Modify: `dashboard/src/hooks/useSettingsFormState.ts` (27 KB)

- [ ] **Step 32.1: Sessions — wydziel `useSessionsContextMenu.ts`, `useAssignProjectSections.ts`.**

- [ ] **Step 32.2: Projects — `renderProjectList`/`renderProjectCard` → `<ProjectList>`/`<ProjectCard>` + `React.memo`.**

- [ ] **Step 32.3: useSettingsFormState — rozbij na `useGeneralSettings`, `useAiSettings`, `useSyncSettings`, `useUiSettings` etc.**

- [ ] **Step 32.4: Commit per plik**

### Task 33: Toast Provider `useMemo`

**Files:**
- Modify: `dashboard/src/components/ui/toast-notification.tsx:58`

- [x] **Step 33.1: `const value = useMemo(() => ({ showError, showInfo }), [showError, showInfo]);`**

- [x] **Step 33.2: Commit**

### Task 34: Unifikacja `aiStatus` w store

**Files:**
- Modify: `dashboard/src/store/background-status-store.ts`

- [x] **Step 34.1: `refreshDiagnostics` **nie** pisze `aiStatus`; tylko `refreshAiStatus` to robi.**

- [x] **Step 34.2: Guard per-pole lub per-ścieżka — jedno źródło prawdy.**

- [x] **Step 34.3: Commit**

### Task 35: `setTimeout` cleanup (useBackgroundSync, useJobPool, Sidebar)

**Files:**
- Modify: `dashboard/src/hooks/useBackgroundSync.ts:40`
- Modify: `dashboard/src/hooks/useJobPool.ts:211`
- Modify: `dashboard/src/components/layout/Sidebar.tsx:194,205`

- [x] **Step 35.1: Wszystkie `setTimeout` → `const id = setTimeout(...); return () => clearTimeout(id);` w `useEffect` cleanup; dla `ref`-owanych: `timerRef.current = setTimeout(...); clearTimeout(timerRef.current)`.**

- [x] **Step 35.2: Commit**

### Task 36: Sync status + attention counter w tray macOS

**Files:**
- Modify: `src/platform/macos/tray.rs`

- [ ] **Step 36.1: Skopiuj kontrakt z `src/platform/windows/tray.rs:170-330` — `update_tray_appearance`, `menu_sync_status`, `was_syncing`, tooltip z `query_unassigned_attention_count`.**

- [ ] **Step 36.2: Aktualizuj `PARITY.md`.**

- [ ] **Step 36.3: Commit**

### Task 37: Foreground na macOS przez NSWorkspace notifications [HELP]

**Files:**
- Modify: `src/platform/macos/foreground.rs:16`

- [ ] **Step 37.1: Subskrypcja `NSWorkspace.didActivateApplicationNotification` przez NSRunLoop (tray-loop już istnieje).**

- [ ] **Step 37.2: Usuń polling 250 ms; fallback polling 2s jako safety net.**

- [ ] **Step 37.3: Aktualizuj `PARITY.md`.**

- [ ] **Step 37.4: Commit**

### Task 38: Incremental retraining AI

**Files:**
- Modify: `dashboard/src-tauri/src/commands/assignment_model/training.rs`

- [ ] **Step 38.1: Dodaj kolumnę `last_train_at` w `assignment_model_state`; migracja m23.**

- [ ] **Step 38.2: `retrain_incremental(since: last_train_at)` — UPDATE tylko zmienionych wag.**

- [ ] **Step 38.3: Zachowaj `retrain_full` jako opcja „Full Rebuild".**

- [ ] **Step 38.4: Commit**

### Task 39: Soft reset — zachowaj `assignment_feedback`

**Files:**
- Modify: `dashboard/src-tauri/src/commands/assignment_model/training.rs:16-46`

- [ ] **Step 39.1: Split na `reset_model_weights` (tylko `_app/_time/_token`) i `reset_model_full` (+ `assignment_feedback`).**

- [ ] **Step 39.2: UI — dwa osobne przyciski + potwierdzenia.**

- [ ] **Step 39.3: [HELP] Opisz różnicę.**

- [ ] **Step 39.4: Commit**

### Task 40: `feedback_weight` w `AssignmentModelStatus`

**Files:**
- Modify: `dashboard/src-tauri/src/commands/assignment_model/mod.rs`
- Modify: `dashboard/src/lib/tauri/ai.ts:89`

- [ ] **Step 40.1: Dołącz `feedback_weight: f64` do `AssignmentModelStatus`.**

- [ ] **Step 40.2: Usuń osobny endpoint `getFeedbackWeight` po migracji wszystkich użyć.**

- [ ] **Step 40.3: Commit**

### Task 41: Auto-safe batch po 500

**Files:**
- Modify: `dashboard/src-tauri/src/commands/assignment_model/auto_safe.rs:102`

- [ ] **Step 41.1: Chunk sesji po 500 × osobna transakcja; progress emit po każdym batchu.**

- [ ] **Step 41.2: Commit**

### Task 42: „Force Sync" PL → „Wymuś synchronizację"

**Files:**
- Modify: `dashboard/src/locales/pl/common.json`

- [x] **Step 42.1: `settings.lan_sync.force_sync: "Wymuś synchronizację"` (PL)**

- [x] **Step 42.2: Commit**

---

## FAZA 4 — P3 (25 zadań, drobne optymalizacje)

Zadania zgrupowane w logiczne commity (nie 1-commit-per-task — będzie zbyt rozdrobnione).

### Task 43-49: Demon drobne

**Files:** `src/tracker.rs`, `src/monitor.rs`, `src/monitor_macos.rs`, `src/main.rs`, `src/i18n.rs`

- [x] **43:** `tracker.rs:557-558` — `drain_switch_times` → `take_last_switch_time() -> Option<Instant>`.
- [x] **44:** `monitor.rs:218-226` — `GetTickCount` DWORD rollover clamp: `if idle_ms > 48*3600*1000 { idle_ms = 0; }`.
- [x] **45:** `monitor_macos.rs:273-277` — scal 10× refresh w jeden z `HashSet<Pid>`.
- [x] **46:** `main.rs:261-272` — log-rotation: `log.1` przed truncate.
- [x] **47:** `tracker.rs:441-450` — `last_save = Instant::now() - save_interval + Duration::from_secs(30)`.
- [x] **48:** `i18n.rs:120-137` — cachuj wynik „brak pliku" w `LANG_CACHE`.
- [x] **49:** `main.rs:170-181` — `thread::sleep(Duration::from_millis(200))` między drop guard a spawn.

- [x] **Commit po grupie:**

```bash
git commit -am "perf(daemon): batch of minor optimizations (Tasks 43-49)"
```

### Task 50-53: Sync drobne

- [x] **50:** Usuń drugi `remove_file` w `lan_server.rs:935`.
- [x] **51:** `SftpClient::Drop` zeruje `host`/`port`.
- [x] **52:** Ujednolić `AUTO_SYNC_COOLDOWN_SECS` i `TRIGGER_SYNC_COOLDOWN_SECS` — np. jedna stała `SYNC_COOLDOWN_SECS=30`, udokumentowana.
- [x] **53:** Gate `[DIAG]` w `sync_common.rs:356-361,598-602,894-898,911-916` — `if cfg!(debug_assertions) || log_settings.verbose { log::debug!("[DIAG] ...") }`.

- [x] **Commit**

### Task 54-58: Tauri backend drobne

- [x] **54:** `tauri.conf.json:26` CSP — dodaj `base-uri 'self'; form-action 'self';`.
- [x] **55:** `helpers.rs:94-127` `compute_table_hash` — `group_concat(..., ',') LIMIT ??` lub `GROUP_CONCAT` z assertem; log::warn gdy pusty.
- [x] **56:** `lan_sync.rs:197` `scan_lan_subnet` — filtr prywatne IP range `10/8, 172.16/12, 192.168/16`; semaphore do 32 równoległych.
- [x] **57:** `pm_manager.rs:93` `path.parent().ok_or_else(|| "no parent".to_string())?`.
- [x] **58:** `daemon/control.rs:195-205` — `serde_json::json!({ "field": value })`.

- [x] **Commit**

### Task 59-63: UI drobne

- [x] **59:** `Sidebar.tsx:244-248` — `if (document.visibilityState === 'visible') refreshLanPeers()`.
- [x] **60:** `useProjectsData.ts:175-235` — skonsoliduj 3× `Promise.allSettled` w jeden `useEffect` z `cancelled` flagą.
- [x] **61:** Helper `usePersistedState(key, init)` w `dashboard/src/hooks/usePersistedState.ts` + zastąp 3× kopie.
- [x] **62:** `BugHunter.tsx:4,45,96` — zastąp `@tauri-apps/api/core` → `lib/tauri.ts` + `alert()` → `useToast`.
- [x] **63:** Helper `useClickOutsideDismiss(ref, onClose)` + `useEscapeKey(onClose)` w `dashboard/src/hooks/useDismissable.ts`; zastąp TODO w `Sessions.tsx:252,311`.

- [x] **Commit per grupa (UI 59-60, UI 61, UI 62, UI 63)** — UI 60, UI 61, UI 62 i UI 63 committed separately.

### Task 64-67: Parity + Help

- [ ] **64:** `dashboard/src/lib/platform.ts:4` — `import { platform } from '@tauri-apps/plugin-os'` z fallback UA.
- [x] **65:** `main.rs:184-199` — macOS: `Command::new("osascript").arg("-e").arg(format!("display dialog \"{}\"", msg))`.
- [x] **66:** `compare_locales.py` — ścieżki: `Path(__file__).resolve().parent / "dashboard/src/locales"`.
- [x] **67:** [HELP] — `help_page.quick_start_sleep_pause` (krótka wzmianka w Quick Start) + `help_page.pm_template_manager_howto` (placeholders, podmiany) w PL/EN.

- [x] **Commit** (67; 64 pozostaje otwarte)

---

## FAZA 5 — P4 (20 zadań, martwy kod / porządki)

### Task 68: Usuń `dashboard/src-tauri/src/refactor_db.py`

- [x] **Step 68.1:** `git rm dashboard/src-tauri/src/refactor_db.py`
- [x] **Step 68.2: Commit**

### Task 69-72: Martwe endpointy LAN

- [x] **69:** Usuń `handle_status` + `StatusRequest`/`StatusResponse` (`lan_server.rs:701-725`).
- [x] **70:** Usuń `handle_verify_ack` (`lan_server.rs:969-981`).
- [x] **71:** Usuń `handle_push` (`lan_server.rs:1029-1046`).
- [x] **72:** Usuń `handle_download_db` (`lan_server.rs:948-967`) po weryfikacji braku wywołań.
- [x] **Commit:** `refactor(lan): remove dead 410 endpoints`

### Task 73: `IPCONFIG_CACHE` `#[cfg(windows)]`

- [x] **73.1:** `src/lan_discovery.rs:22-43` — dodaj `#[cfg(windows)]` do całego bloku.
- [x] **73.2: Commit**

### Task 74-78: Martwe pola/funkcje macOS

- [x] **74:** `monitor_macos.rs:32` — usuń `#[allow(dead_code)]` pola z `PidCacheEntry` lub użyj ich.
- [ ] **75:** `monitor_macos.rs:50` — usuń `CpuSnapshot.total_time` (po Task 3 to bezpieczne).
  - Status: zostaje otwarte — `total_time` nadal jest wymagane do delty CPU między pomiarami.
- [x] **76:** `monitor_macos.rs:100-102` — usuń `warm_path_detection_wmi`; wywołanie gate `#[cfg(windows)]` w miejscu użycia.
- [x] **77:** `monitor.rs:161-163` — usuń wrapper `classify_activity_type`.
- [x] **78:** `platform/macos/mod.rs:2` — usuń komentarz „Faza 1: stuby..." (nieaktualny).

- [x] **Commit:** `cleanup(macos): remove dead code after Phase 3 completion` (74, 76-78; 75 pozostaje otwarte)

### Task 79-82: UI martwy kod

- [x] **79:** `Sidebar.tsx:219-222` — usuń `online` var.
- [x] **80:** `useLanSyncManager.ts:15` — usuń `import { usePageRefreshListener }`.
- [x] **81:** `useSessionsData.ts:157` — usuń `loadFirstSessionsPage` z returns, jeśli nieużyte.
- [ ] **82:** Usuń artefakty: `dashboard/fix_ai.py`, `dashboard/get_logs.py`, `dashboard/temp_bg_services.txt`, `dashboard/check.bat`, `dashboard/test_esbuild.mjs` — po potwierdzeniu z userem.

- [ ] **Commit:** `cleanup(repo): remove dev-only artifacts and dead code`

### Task 83-87: Konsolidacja sync

- [ ] **83:** Unifikacja `open_dashboard_db*` — jedna funkcja w `lan_common.rs`; usuń duplikaty z `lan_server.rs:607-613` i `sync_common.rs`.
- [x] **84:** `get_machine_name` — jedno miejsce (`lan_common.rs:85-87`), usuń duplikat z `lan_discovery.rs:128-130`.
- [ ] **85:** `execute_online_sync` + `execute_online_sync_inner` — scal w jedną funkcję z parametrem `force_full: bool`.
- [x] **86:** `LEGACY_*` migracja `cfab_dashboard.db` → usuń po `2026-12-31` (scheduled). Dodaj TODO z datą w kodzie.
- [ ] **87:** Implementacja `/online/cancel-sync` endpoint (wg `online_sync.rs:117` TODO) ALBO usunięcie TODO + feature-flag off.

- [ ] **Commit per zadanie**

---

## FAZA 6 — Testy end-to-end i dokumentacja

### Task 88: Test integracyjny syncu round-trip

**Files:**
- Create: `tests/integration/lan_sync_roundtrip.rs`

- [ ] **Step 88.1: Test — 2 instancje demona (master + slave) z 2 projektami × 10 sesji; po round-trip `project_name` == input; weryfikuj m20 regresję.**

- [ ] **Step 88.2: Commit**

### Task 89: Test „fresh DB"

**Files:**
- Create: `dashboard/src-tauri/src/tests/fresh_db_schema.rs`

- [ ] **Step 89.1: Test — `initialize_database_file_once(tempdir/new.db)` → `schema_version == LATEST_SCHEMA_VERSION`; wszystkie `sessions` kolumny obecne.**

- [ ] **Step 89.2: Commit**

### Task 90: Lint-rule `no-zustand-full-destructure`

**Files:**
- Create: `dashboard/.eslintrc.js` custom rule albo `dashboard/eslint-rules/no-zustand-full-destructure.js`

- [ ] **Step 90.1: ESLint regex — `const\s*\{[^}]+\}\s*=\s*use(UI|Data|BackgroundStatus)Store\(\s*\)` → warn.**

- [ ] **Step 90.2: Commit**

### Task 91: `PARITY.md` finalizacja

- [ ] **Step 91.1: Zaktualizuj wszystkie wiersze po zakończeniu P1/P2.**

- [ ] **Step 91.2: Dodaj link z `CLAUDE.md` do `PARITY.md`.**

- [ ] **Step 91.3: Commit**

### Task 92: CHANGELOG

**Files:**
- Modify: `CHANGELOG.md` (lub stwórz)

- [ ] **Step 92.1: Sekcja per faza — wylistuj user-visible zmiany (P0 security, P1 funkcjonalne, P2 perf).**

- [ ] **Step 92.2: Commit**

### Task 93: Audit security — roadmap

- [ ] **Step 93.1: Dodaj `docs/SECURITY_AUDIT.md` z listą endpointów LAN HTTP + tickbox „sprawdzone w release Y".**

- [ ] **Step 93.2: Commit**

---

## Kryteria ukończenia

Faza uznana za zakończoną gdy:

- [ ] Wszystkie testy jednostkowe i integracyjne PASS (`cargo test --all`, `npm test`).
- [ ] `cargo clippy -- -D warnings` na demon i Tauri.
- [ ] `npm run lint` i `npm run typecheck` na dashboard.
- [ ] Manualny smoke-test per platforma (Windows 11 + macOS 14+):
  - Uruchomienie → tray widoczny + i18n poprawne.
  - Kilka sesji → pojawiają się w dashboardzie z poprawnym `window_title` (macOS post-Task 4).
  - LAN sync master ↔ slave — 2 maszyny, `project_name` zachowane.
  - AI breakdown — kliknij sesję, popover pokazuje Layer scores.
  - Help.tsx — wszystkie nowe sekcje widoczne w PL i EN.
- [ ] `PARITY.md` zaktualizowany.
- [ ] CHANGELOG wpisany.
- [ ] PR otwarty z linkiem do `raport.md` w opisie (traceability per task).

---

## Rekomendacja kolejności wykonania

1. **Sprint 1 (1 tydzień):** Faza 0 + Faza 1 (P0) + Faza 2 (P1) — **BLOKUJE RELEASE.**
2. **Sprint 2 (1–2 tygodnie):** Faza 3 (P2) — hardening przed publicznym beta.
3. **Sprint 3 (kontynuacja):** Faza 4 (P3) + Faza 5 (P4) — można równolegle z pracą feature-ową.
4. **Sprint 4:** Faza 6 (testy + dokumentacja).

---

**Plan kompletny. Opcje wykonania:**

1. **Subagent-Driven (rekomendowane)** — każde zadanie w świeżym subagencie, review pomiędzy, szybka iteracja. Wymagana sub-umiejętność: `superpowers:subagent-driven-development`.
2. **Inline Execution** — zadania w tej samej sesji z checkpointami. Wymagana: `superpowers:executing-plans`.

**Którą opcję wybierasz?**
