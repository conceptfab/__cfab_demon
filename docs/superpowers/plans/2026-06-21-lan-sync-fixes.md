# LAN Sync — poprawki z audytu (master/slave) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Usunąć zweryfikowane błędy logiczne i nieścisłości w synchronizacji LAN (12-/13-krokowy protokół master↔slave) wykryte w audycie z 2026-06-21, bez zmiany kontraktu sieciowego (wstecznie kompatybilnie ze starszymi peerami).

**Architecture:** Demon TIMEFLOW (Rust, `timeflow-demon`) trzyma sync w trzech plikach: orchestrator mastera [`src/lan_sync_orchestrator.rs`](../../../src/lan_sync_orchestrator.rs), serwer/handlery slave'a [`src/lan_server.rs`](../../../src/lan_server.rs) i wspólny rdzeń merge [`src/sync_common.rs`](../../../src/sync_common.rs). Każdą poprawkę izolujemy do czystej, testowalnej jednostki (funkcja pure albo metoda `LanSyncState`), a glue sieciowy/DB pokrywamy testem ręcznym tam, gdzie unit-test jest niewykonalny (handlery wołają `open_dashboard_db`).

**Tech Stack:** Rust, `rusqlite` (SQLite, FK wyłączone w ścieżce merge), `serde_json`, testy `cargo test` (testy jednostkowe w crate binarnym `timeflow-demon`, baza in-memory przez helpery `open_test_db`/`gc_test_db`).

**Komenda testów (zawsze z roota repo):** `cargo test <nazwa_testu>` (jeden bin → wystarczy nazwa). Pełny zestaw modułu: `cargo test sync_common`, `cargo test --bin timeflow-demon`.

---

## Kontekst i priorytety (zweryfikowane w kodzie)

Kolejność = ryzyko dla danych użytkownika, potem robustność, potem kosmetyka.

| Task | Finding audytu | Severity | Plik(i) | Test |
|------|----------------|----------|---------|------|
| 1 | #2 manual_sessions sentinel | 🔴 | sync_common.rs | unit (merge) |
| 2 | #1 próg delty `since` cross-clock | 🔴 | lan_server.rs, lan_sync_orchestrator.rs | unit (pure) + manualny |
| 3 | #3 `db-ready` idempotencja retry | 🟡 | lan_server.rs | unit (LanSyncState) |
| 4 | #6 stop-signal liczony jako sukces breakera | 🟡 | lan_sync_orchestrator.rs | unit (pure) |
| 5 | #5 niespójne timeouty + komentarze | 🟡 | lan_server.rs, lan_sync_orchestrator.rs | unit (invariant) |
| 6 | #8 GC: normalizacja `deleted_at` (defensywnie) | 🟢 (opcjonalnie) | sync_common.rs | unit (merge) |

**Odłożone do osobnego planu** (wymagają brainstormu, dotykają discovery / semantyki wielu peerów): #4 per-peer circuit breaker, #7 ujednolicenie tiebreaku (uptime vs device_id), persistencja backoffu po restarcie, optymalizacja zapisu snapshotu na dysk w kroku 11, wstawianie markera mastera przed potwierdzeniem slave'a (krok 10b). Uzasadnienie na końcu dokumentu.

### ⚠️ Korekta względem raportu audytu (Task 1)
Audyt opisał finding #2 jako „cichy flip `0 → NULL`". Weryfikacja [`schema.sql:413-428`](../../../dashboard/src-tauri/resources/sql/schema.sql) pokazuje, że `manual_sessions.project_id` to **`INTEGER NOT NULL`** (sentinel `0` = nieprzypisane, FK `ON DELETE CASCADE`, `UNIQUE(project_id,start_time,title)`). Eksport wysyła surowe `project_id` (więc `0` dla nieprzypisanych). W [`src/sync_common.rs:975-978`](../../../src/sync_common.rs#L975-L978) `remote_project_id_to_name.get(0)` zwraca `None` → `local_project_id = None` → bind `NULL` do kolumny `NOT NULL` → **cały `merge_incoming_data` zwraca `Err` → restore backupu → sync pada przy każdej próbie**, gdy peer ma choć jedną nieprzypisaną sesję manualną. To poważniejsze niż w raporcie i jest #1 priorytetem.

---

## Task 1: manual_sessions — mapuj nierozwiązany `project_id` na sentinel `0` (nie `NULL`)

**Files:**
- Modify: `src/sync_common.rs:974-1033` (gałąź merge manual_sessions)
- Test: `src/sync_common.rs` (moduł `#[cfg(test)] mod tests`, ~linia 1302; helpery `open_test_db`, `build_full_export`, `merge_incoming_data` już istnieją)

- [ ] **Step 1: Napisz failujący test (regresja)**

Dodaj na końcu modułu testów w `src/sync_common.rs` (przed zamykającym `}` modułu):

```rust
    #[test]
    fn merge_keeps_unassigned_manual_session_sentinel_zero() {
        // Regresja: peer z nieprzypisaną sesją manualną (sentinel project_id = 0).
        // manual_sessions.project_id jest NOT NULL — nierozwiązany id MUSI zmapować
        // się na 0, nie NULL, inaczej cały merge pada (NOT NULL constraint) i robi restore.
        let mut master = open_test_db();
        let slave = open_test_db();
        slave
            .execute(
                "INSERT INTO manual_sessions \
                 (title, session_type, project_id, start_time, end_time, duration_seconds, date, created_at, updated_at) \
                 VALUES ('Unassigned task', 'work', 0, '2026-04-21 09:00:00', '2026-04-21 09:30:00', 1800, '2026-04-21', '2026-04-21 09:00:00', '2026-04-21 09:00:00')",
                [],
            )
            .unwrap();

        let export = build_full_export(&slave).expect("export slave");
        merge_incoming_data(&mut master, &export)
            .expect("merge nie może paść na nieprzypisanej sesji manualnej");

        let pid: i64 = master
            .query_row(
                "SELECT project_id FROM manual_sessions WHERE title = 'Unassigned task'",
                [],
                |r| r.get(0),
            )
            .expect("sesja manualna obecna na masterze");
        assert_eq!(pid, 0, "nieprzypisana sesja manualna zachowuje sentinel 0");
    }
```

- [ ] **Step 2: Uruchom test — musi failować**

Run: `cargo test merge_keeps_unassigned_manual_session_sentinel_zero -- --nocapture`
Expected: FAIL — panic z `.expect("merge nie może paść...")`, komunikat zawiera `NOT NULL constraint failed: manual_sessions.project_id`.

- [ ] **Step 3: Popraw merge — `Option<i64>` → `i64` z `unwrap_or(0)`**

W `src/sync_common.rs` w gałęzi manual_sessions zmień deklarację `local_project_id`. Obecnie ([`:975-978`](../../../src/sync_common.rs#L975-L978)):

```rust
            let local_project_id: Option<i64> = ms.get("project_id").and_then(|v| v.as_i64())
                .and_then(|rid| remote_project_id_to_name.get(&rid))
                .and_then(|name| project_name_to_local_id.get(name))
                .copied();
```

na:

```rust
            // Sentinel 0 = nieprzypisane. manual_sessions.project_id jest NOT NULL,
            // więc nierozwiązany remote project_id (w tym jego własny sentinel 0)
            // MUSI zmapować się na 0 — bind NULL przerwałby cały merge i wymusił restore.
            let local_project_id: i64 = ms.get("project_id").and_then(|v| v.as_i64())
                .and_then(|rid| remote_project_id_to_name.get(&rid))
                .and_then(|name| project_name_to_local_id.get(name))
                .copied()
                .unwrap_or(0);
```

Gałęzie `UPDATE` ([`:998-1012`](../../../src/sync_common.rs#L998-L1012)) i `INSERT` ([`:1016-1032`](../../../src/sync_common.rs#L1016-L1032)) już bindują `local_project_id` w `rusqlite::params![...]` — zmiana typu z `Option<i64>` na `i64` działa bez zmian w samych zapytaniach (rusqlite zbinduje `i64`).

- [ ] **Step 4: Uruchom test — musi przejść**

Run: `cargo test merge_keeps_unassigned_manual_session_sentinel_zero -- --nocapture`
Expected: PASS (`test result: ok. 1 passed`).

- [ ] **Step 5: Uruchom istniejące testy sync, żeby nie było regresji**

Run: `cargo test sync_common`
Expected: PASS — w tym `lan_sync_simulator_delta_and_full_converge_disjoint_data` i `lan_sync_simulator_newer_update_wins_on_both_peers`.

- [ ] **Step 6: Commit**

```bash
git add src/sync_common.rs
git commit -m "fix(sync): map unresolved manual_sessions project_id to sentinel 0, not NULL"
```

---

## Task 2: próg delty `since` liczony zegarem slave'a (eliminacja cross-clock skew)

**Problem:** master liczy `since` z `created_at` markera slave'a zapisanego w **swojej** historii (zegar mastera), a slave filtruje `updated_at >= since` swoim zegarem. Skew zegarów po cichu pomija świeże wiersze i tombstony → dywergencja / resurekcja usuniętych rekordów.

**Podejście:** slave zna swój najnowszy marker i jego `created_at` we **własnej** bazie. Zwraca ten `created_at` w odpowiedzi `negotiate`; master używa go jako `since`. Stary peer (brak pola) → fallback do dotychczasowego zachowania. Logikę decyzji izolujemy do czystej funkcji `resolve_pull_since` (testowalnej), a plumbing protokołu pokrywa test ręczny.

**Files:**
- Modify: `src/lan_server.rs:72-77` (`NegotiateResponse`) i `src/lan_server.rs:777-803` (`handle_negotiate`)
- Modify: `src/lan_sync_orchestrator.rs:517-522` (`NegResp`), `:558-565` (obliczenie `since`), dodanie `resolve_pull_since` + `EPOCH`
- Test: `src/lan_sync_orchestrator.rs` (moduł `#[cfg(test)] mod tests`, ~linia 810)

- [ ] **Step 1: Napisz failujące testy czystej funkcji**

W `src/lan_sync_orchestrator.rs`, w module testów (po `use super::version_compat_error;` na ~linii 812) dodaj import i testy:

```rust
    use super::resolve_pull_since;

    #[test]
    fn pull_since_prefers_slave_clock() {
        // delta: created_at zgłoszony przez slave (jego zegar) wygrywa z lookupem mastera.
        assert_eq!(
            resolve_pull_since("delta", Some("2026-06-01 10:00:00"), Some("2026-06-01 10:00:09".to_string())),
            "2026-06-01 10:00:00"
        );
    }

    #[test]
    fn pull_since_falls_back_to_master_lookup_for_old_peers() {
        assert_eq!(
            resolve_pull_since("delta", None, Some("2026-05-01 08:00:00".to_string())),
            "2026-05-01 08:00:00"
        );
    }

    #[test]
    fn pull_since_epoch_when_nothing_known() {
        assert_eq!(resolve_pull_since("delta", None, None), "1970-01-01 00:00:00");
    }

    #[test]
    fn pull_since_full_is_always_epoch() {
        assert_eq!(
            resolve_pull_since("full", Some("2026-06-01 10:00:00"), None),
            "1970-01-01 00:00:00"
        );
    }
```

- [ ] **Step 2: Uruchom — musi failować (funkcja nie istnieje)**

Run: `cargo test pull_since -- --nocapture`
Expected: FAIL kompilacji: `cannot find function resolve_pull_since`.

- [ ] **Step 3: Dodaj czystą funkcję `resolve_pull_since` + stałą `EPOCH`**

W `src/lan_sync_orchestrator.rs` obok innych stałych na górze pliku (przy `const SYNC_TIMEOUT` ~linia 14) dodaj:

```rust
const EPOCH: &str = "1970-01-01 00:00:00";
```

I dodaj funkcję obok `get_marker_created_at_by_hash` (~linia 808):

```rust
/// Ustal próg `since` dla delta-pull. Preferuj `created_at` markera zgłoszony
/// przez slave'a (jego zegar) — wtedy próg i `updated_at` wierszy slave'a
/// dzielą ten sam zegar, co eliminuje pomijanie wierszy przy rozjeździe zegarów.
/// Dla starszych peerów (brak pola) wracamy do lookupu po stronie mastera.
fn resolve_pull_since(
    transfer_mode: &str,
    slave_reported_created_at: Option<&str>,
    master_side_lookup: Option<String>,
) -> String {
    if transfer_mode != "delta" {
        return EPOCH.to_string();
    }
    slave_reported_created_at
        .map(|s| s.to_string())
        .or(master_side_lookup)
        .unwrap_or_else(|| EPOCH.to_string())
}
```

- [ ] **Step 4: Uruchom — testy czystej funkcji przechodzą**

Run: `cargo test pull_since -- --nocapture`
Expected: PASS (4 passed).

- [ ] **Step 5: Rozszerz protokół — `NegotiateResponse` (slave) zwraca `created_at` swojego markera**

W `src/lan_server.rs` zmień `NegotiateResponse` ([`:72-77`](../../../src/lan_server.rs#L72-L77)):

```rust
#[derive(Serialize)]
struct NegotiateResponse {
    ok: bool,
    mode: String, // "delta" or "full"
    slave_marker_hash: Option<String>,
    /// created_at naszego najnowszego markera w NASZEJ bazie (zegar slave'a).
    /// Master użyje go jako `since`, by uniknąć cross-clock skew.
    slave_marker_created_at: Option<String>,
}
```

W `handle_negotiate` ([`:777-803`](../../../src/lan_server.rs#L777-L803)) po wyliczeniu `local_marker` dolicz jego `created_at` i włóż do odpowiedzi:

```rust
    let db = lan_common::open_dashboard_db_readonly().ok();
    let local_marker = db.as_ref().and_then(|conn| get_latest_marker_hash(conn));
    let local_marker_created_at = local_marker
        .as_deref()
        .and_then(|h| db.as_ref().and_then(|conn| find_marker_timestamp(conn, h)));
```

…i w budowaniu `resp`:

```rust
    let resp = NegotiateResponse {
        ok: true,
        mode: mode.to_string(),
        slave_marker_hash: local_marker,
        slave_marker_created_at: local_marker_created_at,
    };
```

(`find_marker_timestamp(conn, hash) -> Option<String>` już istnieje w `lan_server.rs` i jest używana w tym samym handlerze na [`:784`](../../../src/lan_server.rs#L784).)

- [ ] **Step 6: Odbierz nowe pole na masterze i użyj `resolve_pull_since`**

W `src/lan_sync_orchestrator.rs` rozszerz `NegResp` ([`:517-522`](../../../src/lan_sync_orchestrator.rs#L517-L522)) o pole z `#[serde(default)]` (wsteczna kompatybilność ze starym slave'em):

```rust
    #[derive(Deserialize)]
    struct NegResp {
        ok: bool,
        mode: String,
        slave_marker_hash: Option<String>,
        #[serde(default)]
        slave_marker_created_at: Option<String>,
    }
```

Zamień obliczenie `since` ([`:560-565`](../../../src/lan_sync_orchestrator.rs#L560-L565)):

```rust
    let since = match transfer_mode.as_str() {
        "delta" => neg.slave_marker_hash.as_deref()
            .and_then(|hash| get_marker_created_at_by_hash(&conn, hash))
            .unwrap_or_else(|| "1970-01-01 00:00:00".to_string()),
        _ => "1970-01-01 00:00:00".to_string(),
    };
```

na:

```rust
    let master_side_lookup = neg.slave_marker_hash.as_deref()
        .and_then(|hash| get_marker_created_at_by_hash(&conn, hash));
    let since = resolve_pull_since(
        &transfer_mode,
        neg.slave_marker_created_at.as_deref(),
        master_side_lookup,
    );
```

- [ ] **Step 7: Zbuduj i przejdź cały zestaw sync**

Run: `cargo test --bin timeflow-demon`
Expected: PASS (kompilacja OK; nowe i istniejące testy zielone).

- [ ] **Step 8: Test ręczny (plumbing handlera — nie pokrywalny unitem, bo `open_dashboard_db`)**

Scenariusz na 2 maszynach (master M, slave S):
1. Sparuj M i S, wykonaj 1 pełny sync (powstaje wspólny marker → kolejne sync = delta).
2. Cofnij zegar systemowy S o ~10 min (albo przyspiesz zegar M) — symulacja skew.
3. Na S dodaj nową sesję/manual entry.
4. Uruchom sync z M (auto albo manualnie).
5. **Oczekiwane:** nowy wpis z S pojawia się na M po jednym delta-syncu.
   - Weryfikacja w logu demona M: linia `[6/13] Pobieranie danych z peera (since=...)` — `since` ma odpowiadać czasowi ostatniego sync **wg zegara S**, nie M.
   - Przed poprawką (dla porównania, jeśli chcesz potwierdzić regresję): przy skew wpis bywał pomijany do następnej edycji lub pełnego sync.

- [ ] **Step 9: Commit**

```bash
git add src/lan_server.rs src/lan_sync_orchestrator.rs
git commit -m "fix(sync): derive delta since from slave's own clock to avoid cross-clock skip"
```

---

## Task 3: `db-ready` idempotentny przy zgubionej odpowiedzi

**Problem:** gdy slave zaimportuje poprawnie, ale odpowiedź zginie (timeout), retry kroku 12 trafia w usunięty plik tymczasowy → `500 No incoming data file` → cała sekwencja leci od nowa (pełny re-pull) i liczy się jako porażka breakera.

**Podejście:** zapamiętaj w `LanSyncState` ostatni ukończony `db-ready` jako `(master_marker_hash, own_marker)`. Przy ponowieniu z tym samym `master_marker_hash` zwróć od razu zapisany `own_marker` (replay), bez ponownego czytania pliku/merge. W pamięci procesu — to wystarcza na okno retry jednego sync.

**Files:**
- Modify: `src/lan_server.rs:127-145` (pola `LanSyncState`), `:160-173` (`new`), nowe metody w `impl LanSyncState`, `handle_db_ready` `:861-976`
- Test: `src/lan_server.rs` (moduł testów, ~linia 1581)

- [ ] **Step 1: Napisz failujący test metody stanu**

W `src/lan_server.rs` w module testów dodaj test (oraz `LanSyncState` jest już w `use super::{...}`):

```rust
    #[test]
    fn db_ready_replay_is_idempotent_per_master_marker() {
        let state = LanSyncState::new();
        assert_eq!(state.completed_db_ready_for("m1"), None, "świeży stan: brak zapisu");
        state.record_db_ready("m1", "own-1");
        assert_eq!(state.completed_db_ready_for("m1"), Some("own-1".to_string()));
        // Inny marker mastera → brak replayu (to nowy import).
        assert_eq!(state.completed_db_ready_for("m2"), None);
    }
```

- [ ] **Step 2: Uruchom — musi failować**

Run: `cargo test db_ready_replay_is_idempotent_per_master_marker -- --nocapture`
Expected: FAIL kompilacji: `no method named completed_db_ready_for`.

- [ ] **Step 3: Dodaj pole + metody do `LanSyncState`**

W `src/lan_server.rs` w definicji `struct LanSyncState` (po `sync_backoff_until: AtomicU64,` ~linia 144) dodaj pole:

```rust
    /// Ostatni ukończony db-ready: (marker_hash mastera, wygenerowany własny marker).
    /// Pozwala na idempotentny replay retry, gdy odpowiedź na db-ready zginęła.
    pub last_db_ready: std::sync::Mutex<Option<(String, String)>>,
```

W `LanSyncState::new()` ([`:160-173`](../../../src/lan_server.rs#L160-L173)) dodaj inicjalizację (po `sync_backoff_until: AtomicU64::new(0),`):

```rust
            last_db_ready: std::sync::Mutex::new(None),
```

Dodaj metody w `impl LanSyncState` (np. obok `mark_sync_completed`):

```rust
    /// Zwróć własny marker z poprzednio ukończonego db-ready dla danego markera
    /// mastera (jeśli istnieje) — replay przy ponowionym db-ready.
    pub fn completed_db_ready_for(&self, master_marker: &str) -> Option<String> {
        let guard = self.last_db_ready.lock().unwrap_or_else(|e| e.into_inner());
        guard
            .as_ref()
            .filter(|(m, _)| m == master_marker)
            .map(|(_, own)| own.clone())
    }

    /// Zapamiętaj ukończony db-ready, by retry mógł go odtworzyć.
    pub fn record_db_ready(&self, master_marker: &str, own_marker: &str) {
        let mut guard = self.last_db_ready.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some((master_marker.to_string(), own_marker.to_string()));
    }
```

- [ ] **Step 4: Uruchom — test metody przechodzi**

Run: `cargo test db_ready_replay_is_idempotent_per_master_marker -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Podłącz replay w `handle_db_ready`**

W `src/lan_server.rs` w `handle_db_ready`, zaraz po sparsowaniu `req` (po [`:864`](../../../src/lan_server.rs#L864), przed `set_progress(12, ...)`) dodaj wczesny replay:

```rust
    // Idempotentny replay: jeśli ten sam db-ready (po marker_hash mastera) już
    // się powiódł, zwróć zapisany własny marker — retry po zgubionej odpowiedzi
    // nie powtarza merge ani nie pada na usuniętym pliku tymczasowym.
    if !req.marker_hash.is_empty() {
        if let Some(own) = state.completed_db_ready_for(&req.marker_hash) {
            sync_log("[SLAVE] db-ready replay — import juz wykonany, zwracam zapisany marker");
            let resp = DbReadyResponse {
                ok: true,
                marker_hash: own,
                transfer_mode: req.transfer_mode,
            };
            return (200, serde_json::to_string(&resp).unwrap_or_default());
        }
    }
```

Po udanym imporcie, tuż przed zbudowaniem końcowej odpowiedzi `DbReadyResponse` ([`:971-976`](../../../src/lan_server.rs#L971-L976)), zapamiętaj wynik:

```rust
    if !req.marker_hash.is_empty() {
        state.record_db_ready(&req.marker_hash, &own_marker);
    }
```

- [ ] **Step 6: Zbuduj i przejdź testy serwera**

Run: `cargo test --bin timeflow-demon`
Expected: PASS (kompilacja OK; wszystkie testy zielone).

- [ ] **Step 7: Commit**

```bash
git add src/lan_server.rs
git commit -m "fix(sync): make db-ready idempotent on retry via cached own-marker replay"
```

---

## Task 4: stop-signal neutralny dla circuit breakera

**Problem:** przerwanie przez `stop_signal` w 1. próbie zostawia `last_err` puste → `note_sync_outcome(true)` **resetuje breaker**, mimo że nic się nie zsynchronizowało.

**Files:**
- Modify: `src/lan_sync_orchestrator.rs:398` (wywołanie `note_sync_outcome`) + nowa funkcja `breaker_outcome`
- Test: `src/lan_sync_orchestrator.rs` (moduł testów)

- [ ] **Step 1: Napisz failujące testy czystej funkcji**

W module testów `src/lan_sync_orchestrator.rs` dodaj:

```rust
    use super::breaker_outcome;

    #[test]
    fn breaker_records_success_when_clean() {
        assert_eq!(breaker_outcome(false, true), Some(true));
    }

    #[test]
    fn breaker_records_failure_on_error() {
        assert_eq!(breaker_outcome(false, false), Some(false));
    }

    #[test]
    fn breaker_ignores_stop_abort() {
        // Przerwanie stopem to ani sukces, ani porażka — nie ruszamy breakera.
        assert_eq!(breaker_outcome(true, false), None);
        assert_eq!(breaker_outcome(true, true), None);
    }
```

- [ ] **Step 2: Uruchom — musi failować**

Run: `cargo test breaker_ -- --nocapture`
Expected: FAIL kompilacji: `cannot find function breaker_outcome`.

- [ ] **Step 3: Dodaj funkcję `breaker_outcome`**

W `src/lan_sync_orchestrator.rs` (obok `resolve_pull_since`/`version_compat_error`) dodaj:

```rust
/// Co podać circuit breakerowi po cyklu sync.
/// `None` = nie ruszaj breakera (cykl przerwany stopem — to nie porażka).
fn breaker_outcome(stopped: bool, last_err_empty: bool) -> Option<bool> {
    if stopped {
        return None;
    }
    Some(last_err_empty)
}
```

- [ ] **Step 4: Uruchom — testy przechodzą**

Run: `cargo test breaker_ -- --nocapture`
Expected: PASS (3 passed).

- [ ] **Step 5: Użyj funkcji w pętli retry**

W `src/lan_sync_orchestrator.rs` zamień ([`:396-398`](../../../src/lan_sync_orchestrator.rs#L396-L398)):

```rust
        // Feed this cycle's outcome to the circuit breaker (success resets it,
        // repeated failures open the backoff window checked at thread entry).
        sync_state.note_sync_outcome(last_err.is_empty());
```

na:

```rust
        // Feed this cycle's outcome to the circuit breaker. A stop-signal abort is
        // neither success nor failure — leave the breaker untouched in that case.
        if let Some(success) =
            breaker_outcome(stop_signal.load(Ordering::Relaxed), last_err.is_empty())
        {
            sync_state.note_sync_outcome(success);
        }
```

- [ ] **Step 6: Zbuduj i przejdź testy**

Run: `cargo test --bin timeflow-demon`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lan_sync_orchestrator.rs
git commit -m "fix(sync): do not count stop-signal abort as a circuit-breaker outcome"
```

---

## Task 5: spójne timeouty (auto-unfreeze > budżet db-ready) + naprawa komentarzy

**Problem:** `AUTO_UNFREEZE_TIMEOUT = 600s` jest niebezpiecznie blisko realnego budżetu `db-ready` (3×180s + backoff ≈ 570s + czas merge). `SYNC_TIMEOUT = 300s` ("5 min max") nie jest egzekwowany w pętli db-ready. Komentarz [`:361`](../../../src/lan_sync_orchestrator.rs#L361) mówi „5 min", a faktycznie auto-unfreeze to 10 min.

**Podejście:** wyodrębnij budżet db-ready jako `pub(crate)` stałe w orchestratorze, podnieś `AUTO_UNFREEZE_TIMEOUT` znacząco ponad ten budżet i dodaj test-invariant pilnujący tej relacji. Napraw mylące komentarze.

**Files:**
- Modify: `src/lan_sync_orchestrator.rs:693` (tablica timeoutów → stałe), `:361` (komentarz)
- Modify: `src/lan_server.rs:157` (`AUTO_UNFREEZE_TIMEOUT`)
- Test: `src/lan_server.rs` (moduł testów)

- [ ] **Step 1: Wyodrębnij budżet db-ready jako stałe (crate-wide)**

W `src/lan_sync_orchestrator.rs` przy stałych na górze pliku dodaj:

```rust
/// Pojedyncza próba db-ready (slave importuje — może trwać przy dużej bazie).
pub(crate) const DB_READY_ATTEMPT_SECS: u64 = 180;
/// Liczba prób db-ready.
pub(crate) const DB_READY_ATTEMPTS: u64 = 3;
/// Górny budżet czasu kroku db-ready: próby + backoffy między nimi (10s, 20s).
pub(crate) const DB_READY_BUDGET_SECS: u64 =
    DB_READY_ATTEMPT_SECS * DB_READY_ATTEMPTS + 10 + 20;
```

Zamień lokalną tablicę w kroku 12 ([`:693`](../../../src/lan_sync_orchestrator.rs#L693)):

```rust
    let db_ready_timeouts = [180u64, 180, 180]; // 3 attempts × 180s each
```

na:

```rust
    let db_ready_timeouts = [DB_READY_ATTEMPT_SECS; DB_READY_ATTEMPTS as usize];
```

- [ ] **Step 2: Podnieś `AUTO_UNFREEZE_TIMEOUT` ponad budżet db-ready**

W `src/lan_server.rs` zmień ([`:157`](../../../src/lan_server.rs#L157)):

```rust
const AUTO_UNFREEZE_TIMEOUT: Duration = Duration::from_secs(600); // 10 minutes
```

na:

```rust
// Musi z zapasem przekraczać budżet kroku db-ready
// (crate::lan_sync_orchestrator::DB_READY_BUDGET_SECS ≈ 570s) + czas merge na slave,
// inaczej slave odmraża bazę w trakcie trwającego sync. Patrz test
// auto_unfreeze_exceeds_db_ready_budget.
const AUTO_UNFREEZE_TIMEOUT: Duration = Duration::from_secs(1200); // 20 minutes
```

- [ ] **Step 3: Napisz test-invariant relacji stałych**

W `src/lan_server.rs` w module testów dodaj:

```rust
    #[test]
    fn auto_unfreeze_exceeds_db_ready_budget() {
        // Slave nie może auto-odmrozić bazy przed końcem najdłuższego okna db-ready.
        let budget = crate::lan_sync_orchestrator::DB_READY_BUDGET_SECS;
        assert!(
            AUTO_UNFREEZE_TIMEOUT.as_secs() > budget + 300,
            "auto-unfreeze ({}s) musi przekraczać budżet db-ready ({}s) z zapasem na merge",
            AUTO_UNFREEZE_TIMEOUT.as_secs(),
            budget
        );
    }
```

- [ ] **Step 4: Napraw mylący komentarz w pętli retry**

W `src/lan_sync_orchestrator.rs` ([`:361`](../../../src/lan_sync_orchestrator.rs#L361)) zmień fragment komentarza:

```rust
                    // Unfreeze slave too — otherwise slave stays frozen until auto-unfreeze (5 min).
```

na:

```rust
                    // Unfreeze slave too — otherwise slave stays frozen until auto-unfreeze (AUTO_UNFREEZE_TIMEOUT).
```

- [ ] **Step 5: Uruchom test i całość**

Run: `cargo test auto_unfreeze_exceeds_db_ready_budget -- --nocapture`
Expected: PASS.
Run: `cargo test --bin timeflow-demon`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lan_server.rs src/lan_sync_orchestrator.rs
git commit -m "fix(sync): raise auto-unfreeze above db-ready budget; lock invariant; fix comments"
```

---

## Task 6 (opcjonalny, 🟢): GC tombstonów — kanoniczny `deleted_at` przy merge

**Problem:** GC porównuje `deleted_at < cutoff` leksykalnie ([`src/sync_common.rs:1081`](../../../src/sync_common.rs#L1081)). Dziś OK (oba operandy to naiwny UTC), ale jeśli kiedykolwiek `deleted_at` zapisze się jako RFC3339, porównanie się wykrzaczy. Guardy `skip_tombstone` normalizują czas, GC nie — niespójność obronna.

**Podejście:** normalizuj `deleted_at` przy wstawianiu tombstone'a w merge, aby zapisane wartości były zawsze kanoniczne (`YYYY-MM-DD HH:MM:SS`).

> Uwaga zakresu (CLAUDE.md: minimalizuj zmiany): czysto defensywne, ryzyko realne jest niskie. Rób tylko jeśli zespół chce „pasa bezpieczeństwa". Inaczej pomiń.

**Files:**
- Modify: `src/sync_common.rs` (wszystkie `INSERT ... INTO tombstones ... deleted_at` w merge — `:468-472` i `:552-561`)
- Test: `src/sync_common.rs` (moduł testów)

- [ ] **Step 1: Napisz failujący test normalizacji**

```rust
    #[test]
    fn merge_normalizes_tombstone_deleted_at() {
        let mut conn = open_test_db();
        let archive = serde_json::json!({
            "data": {
                "tombstones": [
                    { "table_name": "sessions",
                      "sync_key": "x.exe|2026-04-20 10:00:00",
                      "deleted_at": "2026-04-20T10:00:00+02:00" }
                ]
            }
        })
        .to_string();
        merge_incoming_data(&mut conn, &archive).expect("merge");
        let stored: String = conn
            .query_row(
                "SELECT deleted_at FROM tombstones WHERE table_name = 'sessions'",
                [],
                |r| r.get(0),
            )
            .expect("tombstone zapisany");
        assert_eq!(stored, "2026-04-20 08:00:00", "RFC3339 +02:00 → kanoniczny UTC");
    }
```

- [ ] **Step 2: Uruchom — musi failować**

Run: `cargo test merge_normalizes_tombstone_deleted_at -- --nocapture`
Expected: FAIL — `stored` == `"2026-04-20T10:00:00+02:00"` (surowy string).

- [ ] **Step 3: Normalizuj `deleted_at` przed wstawieniem tombstone'a**

W `src/sync_common.rs`, w pętli merge tombstonów, tam gdzie powstaje `deleted_at_str` (po `let deleted_at_str = ts.get("deleted_at")...`), znormalizuj raz:

```rust
        let deleted_at_str = ts.get("deleted_at").and_then(|v| v.as_str()).unwrap_or("");
        let deleted_at_norm = normalize_ts(deleted_at_str);
```

…i w obu `INSERT OR IGNORE INTO tombstones (...) VALUES (...)` (gałąź `skip_tombstone` [`:468-472`](../../../src/sync_common.rs#L468-L472) oraz po DELETE [`:552-561`](../../../src/sync_common.rs#L552-L561)) zbinduj `deleted_at_norm` zamiast `deleted_at_str`. Pozostaw `deleted_at_str` w porównaniach `skip_tombstone` (te i tak wołają `normalize_ts`), albo użyj `deleted_at_norm` spójnie.

- [ ] **Step 4: Uruchom test i całość**

Run: `cargo test merge_normalizes_tombstone_deleted_at -- --nocapture`
Expected: PASS.
Run: `cargo test sync_common`
Expected: PASS (round-trip i GC zielone).

- [ ] **Step 5: Commit**

```bash
git add src/sync_common.rs
git commit -m "fix(sync): store canonical UTC deleted_at on tombstone merge (GC robustness)"
```

---

## Dokumentacja (Help.tsx)

Żadna z poprawek Task 1–6 nie zmienia UI ani odczuwalnego dla użytkownika zachowania (to korektność/robustność wewnętrznego sync). Wg [CLAUDE.md] definicji „nowej funkcji" — **aktualizacja Help.tsx nie jest wymagana**. Jeśli zespół utrzymuje changelog/notki wydania, warto wpisać: „Naprawiono synchronizację LAN: nieprzypisane wpisy manualne, pomijanie zmian przy rozjeździe zegarów, stabilność ponowień".

## Weryfikacja końcowa (po wszystkich taskach)

- [ ] `cargo test --bin timeflow-demon` — całość zielona.
- [ ] `cargo build --release` — kompiluje się (target macOS; Windows nie jest budowalny z maca, patrz [windows_target_unbuildable_on_macos]).
- [ ] Test ręczny 2-maszynowy: pełny sync → delta sync → usunięcie projektu z sesją manualną na jednej maszynie → sync → brak utraty danych, brak resurekcji, brak pętli porażek.

---

## Odłożone (osobny plan / brainstorm)

1. **Per-peer circuit breaker (audyt #4):** dziś `consecutive_sync_failures`/`sync_backoff_until` są globalne w `LanSyncState` — awaria z peerem A wycisza auto-sync ze wszystkimi. Dla ≤2 maszyn bez znaczenia; przy ≥3 peerach wymaga mapy `device_id → (failures, backoff)`. Refactor stanu + ścieżki wyzwalania.
2. **Ujednolicenie tiebreaku ról (audyt #7):** discovery wybiera mastera po uptime, `handle_negotiate` po `device_id`. Wymaga przeczytania `src/lan_discovery.rs` i decyzji o jednym kryterium.
3. **Persistencja backoffu po restarcie:** `sync_backoff_until` ginie przy restarcie demona; jeśli ma chronić przed „młóceniem", zapisać do pliku stanu.
4. **Optymalizacja kroku 11:** `lan_sync_merged.json` zapisywany na dysk tylko po to, by zaraz wysłać z pamięci — zbędny I/O przy dużych bazach.
5. **Marker mastera przed potwierdzeniem slave'a (krok 10b):** dziś nieszkodliwe dla GC (GC odpala tylko po sukcesie), ale kruche sprzężenie — rozważyć wstawianie po sukcesie db-ready.
