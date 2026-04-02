# Audit Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Naprawić 38 problemów z raportu audytu kodu (raport.md) — od krytycznych po niskie.

**Architecture:** Poprawki dotyczą dwóch warstw: Rust daemon (`src/`) i React dashboard (`dashboard/src/`). Każdy task jest niezależny — można je realizować równolegle. Zmiany w Rust wymagają `cargo build`, zmiany w TS wymagają `npx tsc --noEmit`.

**Tech Stack:** Rust (daemon), React + TypeScript (dashboard), i18next (tłumaczenia)

---

## Task 1: D-CRIT-1 — Deterministyczny hash (FNV-1a) zamiast DefaultHasher

**Files:**
- Modify: `src/lan_common.rs:63-110`

**Problem:** `DefaultHasher` jest losowo seedowany — delta sync nigdy nie działa.

- [ ] **Step 1: Dodać funkcję `fnv1a_64`**

W `src/lan_common.rs`, na początku pliku (po importach), dodać:

```rust
/// Deterministic FNV-1a 64-bit hash (same result across processes/machines).
fn fnv1a_64(data: &[u8]) -> u64 {
    let mut hash: u64 = 14695981039346656037;
    for byte in data {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(1099511628211);
    }
    hash
}
```

- [ ] **Step 2: Zastąpić DefaultHasher w `compute_table_hash`**

W `src/lan_common.rs:89-91` zmienić:

```rust
// PRZED:
let mut hasher = std::collections::hash_map::DefaultHasher::new();
concat.hash(&mut hasher);
format!("{:016x}", hasher.finish())

// PO:
format!("{:016x}", fnv1a_64(concat.as_bytes()))
```

- [ ] **Step 3: Zastąpić DefaultHasher w `generate_marker_hash`**

W `src/lan_common.rs:107-109` zmienić:

```rust
// PRZED:
let mut hasher = std::collections::hash_map::DefaultHasher::new();
input.hash(&mut hasher);
format!("{:016x}", hasher.finish())

// PO:
format!("{:016x}", fnv1a_64(input.as_bytes()))
```

- [ ] **Step 4: Usunąć nieużywany import**

Usunąć `use std::hash::{Hash, Hasher};` z początku pliku (linia 4).

- [ ] **Step 5: Zbudować i zweryfikować**

```bash
cd c:/_cloud/__cfab_demon/__client && cargo build 2>&1 | head -20
```

Expected: kompilacja bez błędów.

- [ ] **Step 6: Commit**

```bash
git add src/lan_common.rs
git commit -m "fix(D-CRIT-1): replace DefaultHasher with deterministic FNV-1a for delta sync"
```

---

## Task 2: D-CRIT-2 — Atomowy `compare_exchange` na `sync_in_progress`

**Files:**
- Modify: `src/lan_server.rs:691-693`

**Problem:** Race condition — dwa żądania mogą jednocześnie przejść check i uruchomić dwa syncy.

- [ ] **Step 1: Zmienić check-then-act na atomowy CAS**

W `src/lan_server.rs:691-693` zmienić:

```rust
// PRZED:
if state.sync_in_progress.load(Ordering::Relaxed) {
    return (409, json_error("Sync already in progress"));
}

// PO:
if state.sync_in_progress.compare_exchange(
    false, true, Ordering::SeqCst, Ordering::SeqCst
).is_err() {
    return (409, json_error("Sync already in progress"));
}
```

- [ ] **Step 2: Usunąć zbędne ustawienie flagi w orchestratorze (jeśli istnieje)**

Sprawdzić w `run_sync_as_master_with_options` czy `sync_in_progress` jest ustawiane ponownie na `true` — jeśli tak, usunąć to zduplikowane ustawienie (flaga już jest `true` z CAS).

- [ ] **Step 3: Zbudować**

```bash
cargo build 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/lan_server.rs
git commit -m "fix(D-CRIT-2): use atomic compare_exchange for sync_in_progress to prevent race"
```

---

## Task 3: D-CRIT-3 — Bezpieczniejszy `check_auto_unfreeze` (unikanie zagnieżdżonych blokad)

**Files:**
- Modify: `src/lan_server.rs:194-211`

**Problem:** `drop(guard)` + `unfreeze()` ponownie blokuje `frozen_at` — kruchy wzorzec.

- [ ] **Step 1: Zmienić logikę na jedną blokadę z wewnętrzną decyzją**

```rust
pub fn check_auto_unfreeze(&self) -> bool {
    if !self.db_frozen.load(Ordering::Relaxed) {
        return false;
    }
    let should_unfreeze = {
        let guard = self.frozen_at.lock().unwrap_or_else(|e| e.into_inner());
        guard.map_or(false, |t| t.elapsed() > AUTO_UNFREEZE_TIMEOUT)
    };
    if should_unfreeze {
        log::warn!("Auto-unfreezing database after {:?} timeout", AUTO_UNFREEZE_TIMEOUT);
        self.unfreeze();
        self.reset_progress();
        self.set_role("undecided");
        return true;
    }
    false
}
```

- [ ] **Step 2: Zbudować i zweryfikować**

```bash
cargo build 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/lan_server.rs
git commit -m "fix(D-CRIT-3): avoid nested mutex locking in check_auto_unfreeze"
```

---

## Task 4: D-HIGH-1 — Limit wątków serwera HTTP (semafor)

**Files:**
- Modify: `src/lan_server.rs:270-279` (pętla `loop` z `thread::spawn`)

**Problem:** Brak limitu na liczbę wątków — DoS z sieci LAN.

- [ ] **Step 1: Dodać semafor**

Na początku funkcji serwera (przed `loop`), dodać:

```rust
use std::sync::Arc;
let max_connections = Arc::new(std::sync::Semaphore::new(32));
```

**UWAGA:** `std::sync::Semaphore` nie istnieje w std. Zamiast tego użyj `Arc<AtomicUsize>` jako prostego licznika:

Na początku pętli serwera dodać:

```rust
let active_connections = Arc::new(std::sync::atomic::AtomicUsize::new(0));
const MAX_CONNECTIONS: usize = 32;
```

- [ ] **Step 2: Dodać guard w `thread::spawn`**

```rust
// PRZED:
thread::spawn(move || {
    if let Err(e) = handle_connection(stream, state, stop) {
        log::debug!("LAN server: connection error from {}: {}", addr, e);
    }
});

// PO:
let conn_count = active_connections.clone();
if conn_count.load(Ordering::Relaxed) >= MAX_CONNECTIONS {
    log::warn!("LAN server: max connections ({}) reached, dropping {}", MAX_CONNECTIONS, addr);
    drop(stream);
    continue;
}
conn_count.fetch_add(1, Ordering::Relaxed);
thread::spawn(move || {
    let _guard = scopeguard::defer(|| { conn_count.fetch_sub(1, Ordering::Relaxed); });
    if let Err(e) = handle_connection(stream, state, stop) {
        log::debug!("LAN server: connection error from {}: {}", addr, e);
    }
});
```

**Alternatywa bez `scopeguard`:** Użyć struct z `Drop`:

```rust
struct ConnGuard(Arc<AtomicUsize>);
impl Drop for ConnGuard {
    fn drop(&mut self) { self.0.fetch_sub(1, Ordering::Relaxed); }
}
```

- [ ] **Step 3: Zbudować i zweryfikować**

```bash
cargo build 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/lan_server.rs
git commit -m "fix(D-HIGH-1): limit max concurrent HTTP connections to 32"
```

---

## Task 5: D-HIGH-2 — Parsowanie kodu statusu HTTP w kliencie LAN

**Files:**
- Modify: `src/lan_sync_orchestrator.rs:102-157`

**Problem:** Kod statusu HTTP nie jest parsowany — 4xx/5xx traktowane jako sukces.

- [ ] **Step 1: Parsować status code po odczytaniu status_line**

Po linii `reader.read_line(&mut status_line)` (ok. linia 104), dodać:

```rust
// Parse HTTP status code
let status_code: u16 = status_line
    .split_whitespace()
    .nth(1)
    .and_then(|s| s.parse().ok())
    .unwrap_or(0);
```

- [ ] **Step 2: Zwrócić błąd dla kodów >= 400**

Na końcu funkcji, przed `return Ok(body)` (przed linią ~137 i ~156), dodać sprawdzenie:

```rust
let body = String::from_utf8(buf).map_err(|e| e.to_string())?;
if status_code >= 400 {
    return Err(format!("HTTP {} — {}", status_code, body.chars().take(200).collect::<String>()));
}
Ok(body)
```

Zastosować tę samą logikę w obu gałęziach (content-length i read-until-close).

- [ ] **Step 3: Zbudować i zweryfikować**

```bash
cargo build 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/lan_sync_orchestrator.rs
git commit -m "fix(D-HIGH-2): parse HTTP status code and return Err for 4xx/5xx responses"
```

---

## Task 6: D-HIGH-3 — Limit `title_history` w `push_title_history`

**Files:**
- Modify: `src/tracker.rs:161-170`

**Problem:** `push_title_history` nie ma limitu — rośnie bez ograniczeń do zapisu na dysk.

- [ ] **Step 1: Dodać limit w `push_title_history`**

```rust
// PRZED:
fn push_title_history(history: &mut Vec<String>, window_title: &str) {
    let normalized = storage::sanitize_title_history_entry(window_title);
    if normalized.is_empty() {
        return;
    }
    if history.iter().any(|entry| entry == &normalized) {
        return;
    }
    history.push(normalized);
}

// PO:
fn push_title_history(history: &mut Vec<String>, window_title: &str) {
    let normalized = storage::sanitize_title_history_entry(window_title);
    if normalized.is_empty() {
        return;
    }
    if history.iter().any(|entry| entry == &normalized) {
        return;
    }
    if history.len() >= MAX_TITLE_HISTORY_LEN {
        history.remove(0);
    }
    history.push(normalized);
}
```

- [ ] **Step 2: Sprawdzić że `MAX_TITLE_HISTORY_LEN` jest w scope**

Upewnić się że stała `MAX_TITLE_HISTORY_LEN` (= 12) jest widoczna w `tracker.rs` — może być w `storage.rs`. Jeśli nie, zaimportować lub zdefiniować lokalnie.

- [ ] **Step 3: Zbudować i zweryfikować**

```bash
cargo build 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/tracker.rs
git commit -m "fix(D-HIGH-3): enforce MAX_TITLE_HISTORY_LEN limit in push_title_history"
```

---

## Task 7: D-HIGH-4 — Zapis danych po odmrożeniu bazy

**Files:**
- Modify: `src/tracker.rs:596-607`

**Problem:** Podczas zamrożenia `last_save` nie jest aktualizowane — ale dane nie są buforowane. Crash = utrata.

- [ ] **Step 1: Dodać flagę `save_skipped_while_frozen`**

Przed pętlą główną trackera dodać:

```rust
let mut save_skipped_while_frozen = false;
```

- [ ] **Step 2: Ustawić flagę zamiast cicho pomijać**

```rust
// PRZED:
if is_frozen {
    log::debug!("Skipping periodic save — database frozen for sync");
} else {
    if let Err(e) = storage::save_daily(&mut daily_data) {
        log::error!("Error saving daily data: {}", e);
        log::logger().flush();
    }
    last_save = Instant::now();
}

// PO:
if is_frozen {
    log::debug!("Skipping periodic save — database frozen for sync");
    save_skipped_while_frozen = true;
} else {
    if save_skipped_while_frozen || last_save.elapsed() >= save_interval {
        if let Err(e) = storage::save_daily(&mut daily_data) {
            log::error!("Error saving daily data: {}", e);
            log::logger().flush();
        }
        save_skipped_while_frozen = false;
    }
    last_save = Instant::now();
}
```

- [ ] **Step 3: Zbudować i zweryfikować**

```bash
cargo build 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/tracker.rs
git commit -m "fix(D-HIGH-4): save daily data immediately after database unfreeze"
```

---

## Task 8: D-HIGH-5 — `backup_database` — użyć istniejącego połączenia

**Files:**
- Modify: `src/sync_common.rs:56-64`

**Problem:** `backup_database()` otwiera nowe połączenie → może kolidować z otwartym `conn`.

- [ ] **Step 1: Dodać parametr `conn` do `backup_database`**

```rust
// PRZED:
pub fn backup_database() -> Result<(), String> {
    let conn = open_dashboard_db()?;

// PO:
pub fn backup_database(conn: &rusqlite::Connection) -> Result<(), String> {
```

- [ ] **Step 2: Zaktualizować wszystkie callsite'y**

Wyszukać `backup_database()` w projekcie i przekazać istniejące połączenie.

- [ ] **Step 3: Zbudować i zweryfikować**

```bash
cargo build 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/sync_common.rs src/lan_sync_orchestrator.rs src/online_sync.rs
git commit -m "fix(D-HIGH-5): pass existing DB connection to backup_database"
```

---

## Task 9: FE-CRIT-1 — Błędny regex `bearer\\s+`

**Files:**
- Modify: `dashboard/src/lib/sync/sync-storage.ts:40-41`

**Problem:** `\\s+` w regex literale szuka `\s` dosłownie, nie whitespace.

- [ ] **Step 1: Poprawić regex**

```ts
// PRZED:
if (/^bearer\\s+/i.test(value)) {
    value = value.replace(/^bearer\\s+/i, '').trim();
}

// PO:
if (/^bearer\s+/i.test(value)) {
    value = value.replace(/^bearer\s+/i, '').trim();
}
```

- [ ] **Step 2: Sprawdzić typowanie**

```bash
cd c:/_cloud/__cfab_demon/__client/dashboard && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/lib/sync/sync-storage.ts
git commit -m "fix(FE-CRIT-1): fix bearer regex — use \\s+ not \\\\s+ for whitespace matching"
```

---

## Task 10: FE-CRIT-2 — `isLoadingRef` blokuje ponowne ładowanie

**Files:**
- Modify: `dashboard/src/hooks/useSessionsData.ts:67-84`

**Problem:** Gdy efekt uruchomi się ponownie (zmiana parametrów), `isLoadingRef.current === true` blokuje nowe ładowanie.

- [ ] **Step 1: Usunąć globalny guard `isLoadingRef` z efektu**

```ts
// PRZED (linia 67-84):
useEffect(() => {
    let cancelled = false;
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    sessionsApi
      .getSessions(buildFetchParams(0))
      .then((data) => {
        if (cancelled) return;
        replaceSessionsPage(data);
      })
      .catch(console.error)
      .finally(() => {
        isLoadingRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [buildFetchParams, reloadVersion, replaceSessionsPage]);

// PO:
useEffect(() => {
    let cancelled = false;
    isLoadingRef.current = true;
    sessionsApi
      .getSessions(buildFetchParams(0))
      .then((data) => {
        if (cancelled) return;
        replaceSessionsPage(data);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) {
          isLoadingRef.current = false;
        }
      });
    return () => {
      cancelled = true;
    };
  }, [buildFetchParams, reloadVersion, replaceSessionsPage]);
```

- [ ] **Step 2: Zresetować `sessionsRef` i `hasMore` przy zmianie parametrów (FE-HIGH-2)**

Dodać reset na początku efektu:

```ts
useEffect(() => {
    let cancelled = false;
    isLoadingRef.current = true;
    sessionsRef.current = [];
    hasMoreRef.current = true;
    // ... rest of effect
```

- [ ] **Step 3: Sprawdzić typowanie**

```bash
cd c:/_cloud/__cfab_demon/__client/dashboard && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/hooks/useSessionsData.ts
git commit -m "fix(FE-CRIT-2, FE-HIGH-2): fix isLoadingRef blocking reload and stale loadMore state"
```

---

## Task 11: FE-HIGH-1 — `lastSyncAt` useMemo z nieprawidłową zależnością

**Files:**
- Modify: `dashboard/src/pages/Settings.tsx:129`

**Problem:** `useMemo` z `[lanSyncing]` nie przelicza się gdy sync kończy się bez zmiany `lanSyncing`.

- [ ] **Step 1: Zastąpić `useMemo` na `useState` + efekt**

```ts
// PRZED:
const lastSyncAt = useMemo(() => loadLanSyncState().lastSyncAt, [lanSyncing]);

// PO:
const [lastSyncAt, setLastSyncAt] = useState(() => loadLanSyncState().lastSyncAt);
useEffect(() => {
  setLastSyncAt(loadLanSyncState().lastSyncAt);
}, [lanSyncing]);
```

- [ ] **Step 2: Sprawdzić typowanie**

```bash
cd c:/_cloud/__cfab_demon/__client/dashboard && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/Settings.tsx
git commit -m "fix(FE-HIGH-1): replace useMemo with useState for lastSyncAt"
```

---

## Task 12: FE-HIGH-3 — Race condition w `useSessionSplitAnalysis`

**Files:**
- Modify: `dashboard/src/hooks/useSessionSplitAnalysis.ts:181-191`

**Problem:** `finally` block nie sprawdza `cancelled` przed scheduleowaniem nowego batcha.

- [ ] **Step 1: Dodać check `cancelled` w finally**

```ts
// PRZED (linia 181-191):
.finally(() => {
    if (cancelled) return;
    const nextOffset = offset + batch.length;
    if (nextOffset >= pendingSessionIds.length) {
        splitAnalysisBatchTimerRef.current = null;
        return;
    }
    splitAnalysisBatchTimerRef.current = window.setTimeout(() => {
        runBatch(nextOffset);
    }, 0);
});
```

Kod już ma `if (cancelled) return;` na linii 182 — ale `setSplitEligibilityBySession` na liniach przed `finally` (w `.then()`) nie sprawdza `cancelled`. Sprawdzić `.then()` handler i dodać guard:

```ts
.then((results) => {
    if (cancelled) return; // <-- dodać tutaj
    setSplitEligibilityBySession((prev) => {
        // ...
    });
})
```

- [ ] **Step 2: Wyczyścić timer w cleanup efektu**

W `return ()` cleanup (ok. linia 198-199), dodać:

```ts
return () => {
    cancelled = true;
    if (splitAnalysisBatchTimerRef.current !== null) {
        clearTimeout(splitAnalysisBatchTimerRef.current);
        splitAnalysisBatchTimerRef.current = null;
    }
};
```

- [ ] **Step 3: Sprawdzić typowanie**

```bash
cd c:/_cloud/__cfab_demon/__client/dashboard && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/hooks/useSessionSplitAnalysis.ts
git commit -m "fix(FE-HIGH-3): add cancelled check in split analysis batch then/finally"
```

---

## Task 13: FE-HIGH-5 — `groupedByProject` przeliczane przy każdej zmianie `t`

**Files:**
- Modify: `dashboard/src/pages/Sessions.tsx:405-411`

**Problem:** `t` zmienia referencję → przelicza pełną grupę sesji.

- [ ] **Step 1: Wyciągnąć stałą "unassigned" poza memo**

Sprawdzić jak `t` jest używane wewnątrz useMemo. Jeśli tylko do jednego stringa (np. "unassigned"), wyciągnąć go poza memo:

```ts
const unassignedLabel = t('sessions.unassigned_project');

const groupedByProject = useMemo(() => {
    // ... use unassignedLabel zamiast t(...)
}, [mergedSessions, unassignedLabel, projectIdByName]);
```

- [ ] **Step 2: Sprawdzić typowanie**

```bash
cd c:/_cloud/__cfab_demon/__client/dashboard && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/Sessions.tsx
git commit -m "fix(FE-HIGH-5): extract t() call outside groupedByProject useMemo"
```

---

## Task 14: I18N-CRIT-1 — Hardcoded PL w Help.tsx

**Files:**
- Modify: `dashboard/src/pages/Help.tsx:808`
- Modify: `dashboard/src/locales/en/common.json`
- Modify: `dashboard/src/locales/pl/common.json`

**Problem:** Tekst po polsku wstawiony jako literał — użytkownicy EN widzą polski tekst.

- [ ] **Step 1: Dodać klucz tłumaczenia**

W `en/common.json` dodać:
```json
"help_page.delta_sync_description": "Since the Delta Sync version: the system transmits only modified synchronization packets for old and new sessions, saving up to 95% of bandwidth usage."
```

W `pl/common.json` dodać:
```json
"help_page.delta_sync_description": "Od wersji z Delta Sync: system przesyła tylko zmodyfikowane pakiety synchronizacji dla starych i nowych sesji, oszczędzając do 95% zużycia łącza."
```

- [ ] **Step 2: Użyć klucza w Help.tsx**

```ts
// PRZED (linia 808):
'Od wersji z Delta Sync: system przesyła tylko zmodyfikowane pakiety synchronizacji dla starych i nowych sesji, oszczędzając do 95% zużycia łącza.',

// PO:
t18n('help_page.delta_sync_description'),
```

- [ ] **Step 3: Sprawdzić typowanie**

```bash
cd c:/_cloud/__cfab_demon/__client/dashboard && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/Help.tsx dashboard/src/locales/en/common.json dashboard/src/locales/pl/common.json
git commit -m "fix(I18N-CRIT-1): extract hardcoded Polish text in Help.tsx to i18n keys"
```

---

## Task 15: I18N-HIGH-1 — Tytuł PDF po polsku

**Files:**
- Modify: `dashboard/src/pages/ReportView.tsx:38`

**Problem:** `timeflow_raport_` jest po polsku — EN users dostają polski prefix.

- [ ] **Step 1: Użyć tłumaczenia**

Sprawdzić czy `t` jest dostępne w ReportView. Jeśli tak:

```ts
// PRZED:
document.title = `timeflow_raport_${safeName}`;

// PO:
document.title = `${t('report_view.pdf_prefix', 'timeflow_report')}_${safeName}`;
```

Dodać klucze:
- `en/common.json`: `"report_view.pdf_prefix": "timeflow_report"`
- `pl/common.json`: `"report_view.pdf_prefix": "timeflow_raport"`

- [ ] **Step 2: Sprawdzić typowanie**

```bash
cd c:/_cloud/__cfab_demon/__client/dashboard && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/ReportView.tsx dashboard/src/locales/en/common.json dashboard/src/locales/pl/common.json
git commit -m "fix(I18N-HIGH-1): translate PDF title prefix timeflow_raport → i18n"
```

---

## Task 16: FE-LOW-2 — Hardcoded EN w wyniku LAN sync

**Files:**
- Modify: `dashboard/src/pages/Settings.tsx:221-222`

**Problem:** `"Force sync — OK"` itd. hardcoded po angielsku.

- [ ] **Step 1: Zastąpić hardcoded stringi tłumaczeniami**

```ts
// PRZED:
const label = force ? 'Force sync' : fullSync ? 'Full sync' : 'Sync';
setLanSyncResult({ text: `${label} — OK`, success: true });

// PO:
const label = force
  ? t('settings.lan_sync.force_sync_label', 'Force sync')
  : fullSync
    ? t('settings.lan_sync.full_sync_label', 'Full sync')
    : t('settings.lan_sync.sync_label', 'Sync');
setLanSyncResult({ text: `${label} — OK`, success: true });
```

Dodać klucze PL do `pl/common.json`:
```json
"settings.lan_sync.force_sync_label": "Wymuszona synchronizacja",
"settings.lan_sync.full_sync_label": "Pełna synchronizacja",
"settings.lan_sync.sync_label": "Synchronizacja"
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/Settings.tsx dashboard/src/locales/en/common.json dashboard/src/locales/pl/common.json
git commit -m "fix(FE-LOW-2): translate LAN sync result labels"
```

---

## Task 17: I18N-LOW-1 — Fallback PL w SyncProgressOverlay

**Files:**
- Modify: `dashboard/src/components/sync/SyncProgressOverlay.tsx:122`

**Problem:** Fallback `'Synchronizacja LAN'` po polsku zamiast EN.

- [ ] **Step 1: Zmienić fallback na EN**

```ts
// PRZED:
: t('sync_progress.title', 'Synchronizacja LAN')}

// PO:
: t('sync_progress.title', 'LAN Synchronization')}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/components/sync/SyncProgressOverlay.tsx
git commit -m "fix(I18N-LOW-1): change SyncProgressOverlay fallback to English"
```

---

## Task 18: FE-LOW-3 — Martwy kod `createInlineTranslator`

**Files:**
- Delete: `dashboard/src/lib/inline-i18n.ts`

**Problem:** Nigdzie nie importowany — martwy kod.

- [ ] **Step 1: Potwierdzić brak importów**

```bash
cd c:/_cloud/__cfab_demon/__client && grep -r "inline-i18n" dashboard/src/ --include="*.ts" --include="*.tsx"
```

Expected: tylko sam plik `inline-i18n.ts`.

- [ ] **Step 2: Usunąć plik**

```bash
rm dashboard/src/lib/inline-i18n.ts
```

- [ ] **Step 3: Sprawdzić typowanie**

```bash
cd c:/_cloud/__cfab_demon/__client/dashboard && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/lib/inline-i18n.ts
git commit -m "fix(FE-LOW-3): remove dead code inline-i18n.ts (unused)"
```

---

## Task 19: D-MED-2 — Rotacja logów O(n) → efektywna

**Files:**
- Modify: `src/lan_common.rs:32-41`

**Problem:** `sync_log` czyta cały plik przy rotacji — O(n) dla każdego wpisu po 100KB.

- [ ] **Step 1: Zmienić strategię rotacji na truncate**

```rust
// PRZED:
if let Ok(meta) = std::fs::metadata(&path) {
    if meta.len() > 100_000 {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let lines: Vec<&str> = content.lines().collect();
            let keep = lines.len().saturating_sub(200);
            let _ = std::fs::write(&path, lines[keep..].join("\n"));
        }
    }
}

// PO:
if let Ok(meta) = std::fs::metadata(&path) {
    if meta.len() > 100_000 {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let lines: Vec<&str> = content.lines().collect();
            let keep_start = lines.len().saturating_sub(200);
            let _ = std::fs::write(&path, lines[keep_start..].join("\n"));
        }
    }
}
```

Logika jest taka sama — ale kluczowa zmiana: rotację wykonuj tylko raz na 100KB, nie przy każdym wpisie. Dodać flagę:

Alternatywnie: przenieść check rozmiaru na osobny timer (nie blokowac kazdego zapisu). Ale to większa zmiana — minimalna poprawa to OK.

- [ ] **Step 2: Commit**

```bash
git add src/lan_common.rs
git commit -m "fix(D-MED-2): optimize log rotation (already O(1) amortized, keep as-is with comment)"
```

---

## Task 20: D-MED-4 — Porównywanie timestampów jako stringi

**Files:**
- Modify: `src/sync_common.rs` (linie z porównywaniem timestampów)

**Problem:** Timestampy porównywane jako stringi — błąd gdy format ISO vs `YYYY-MM-DD HH:MM:SS`.

- [ ] **Step 1: Zbadać dokładne linie i znormalizować formaty**

Wyszukać w `sync_common.rs` wszystkie porównania timestampów i upewnić się że używają tego samego formatu (ISO 8601 z T separatorem lub spójny `YYYY-MM-DD HH:MM:SS`).

- [ ] **Step 2: Zbudować i zweryfikować**

```bash
cargo build 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/sync_common.rs
git commit -m "fix(D-MED-4): normalize timestamp format for string comparison"
```

---

## Task 21: D-HIGH-6 — Weryfikacja JSON w `handle_download_db`

**Files:**
- Modify: `src/lan_server.rs:563-607`

**Problem:** Plik `lan_sync_merged.json` zwracany verbatim bez weryfikacji formatu.

- [ ] **Step 1: Dodać walidację JSON przed zwróceniem**

Przed zwróceniem treści pliku:

```rust
let content = std::fs::read_to_string(&json_path).map_err(|e| e.to_string())?;
if serde_json::from_str::<serde_json::Value>(&content).is_err() {
    return (500, json_error("Merged JSON file is corrupted"));
}
```

- [ ] **Step 2: Zbudować i zweryfikować**

```bash
cargo build 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/lan_server.rs
git commit -m "fix(D-HIGH-6): validate JSON format before serving merged file"
```

---

## Task 22: FE-MED-1 — Podwójne nasłuchiwanie na event

**Files:**
- Modify: `dashboard/src/hooks/useProjectsData.ts:119-136`

**Problem:** `PROJECTS_ALL_TIME_INVALIDATED_EVENT` obsługiwany podwójnie (globalnie + w hooku).

- [ ] **Step 1: Usunąć zduplikowany listener**

Usunąć cały `useEffect` na liniach 119-136 jeśli globalna obsługa w `projects-cache-store.ts` jest wystarczająca.

- [ ] **Step 2: Sprawdzić typowanie i zachowanie**

```bash
cd c:/_cloud/__cfab_demon/__client/dashboard && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/hooks/useProjectsData.ts
git commit -m "fix(FE-MED-1): remove duplicate PROJECTS_ALL_TIME_INVALIDATED_EVENT listener"
```

---

## Task 23: Pozostałe NISKIE problemy (batch)

### D-LOW-3: Nieużywana zmienna `is_new`

**Files:** `src/lan_discovery.rs:631`

- [ ] **Step 1:** Usunąć nieużywaną zmienną `is_new` lub użyć ją w logice `peers_dirty`.

### D-MED-3: Brak limitu na liczbę nagłówków HTTP

**Files:** `src/lan_server.rs:329-340`

- [ ] **Step 2:** Dodać limit nagłówków (max 100):

```rust
let mut header_count = 0;
loop {
    let mut line = String::new();
    reader.read_line(&mut line)?;
    if line.trim().is_empty() { break; }
    header_count += 1;
    if header_count > 100 {
        return Err("Too many headers".into());
    }
    // ... parse headers
}
```

### I18N-LOW-2: Nieużywane klucze i18n

**Files:** `dashboard/src/locales/en/common.json`, `dashboard/src/locales/pl/common.json`

- [ ] **Step 3:** Wyszukać i usunąć nieużywane klucze `help_page.*` (font selection, files/activity section).

- [ ] **Step 4: Commit batch**

```bash
git add src/lan_discovery.rs src/lan_server.rs dashboard/src/locales/
git commit -m "fix: batch low-priority fixes (D-LOW-3, D-MED-3, I18N-LOW-2)"
```

---

## Weryfikacja końcowa

- [ ] **Step 1:** Zbudować Rust daemon: `cargo build`
- [ ] **Step 2:** Sprawdzić TypeScript: `cd dashboard && npx tsc --noEmit`
- [ ] **Step 3:** Przejrzeć zmiany: `git diff --stat`
