# TIMEFLOW — Plan naprawy synchronizacji

**Data:** 2026-04-04  
**Odniesienie:** `__logs/raport.md`

---

## Priorytet 1: Online sync nie widzi obu urządzeń (KRYTYCZNY)

### Problem

Serwer (`cfabserver-production.up.railway.app`) odpowiada `single_device` / `onlineDevices: 0` mimo że obie maszyny łączą się w tym samym oknie czasowym. Online sync jest de facto martwy — nigdy nie wykonuje push/pull.

### Przyczyna

Dashboard wysyła heartbeat (HTTP POST), serwer przetwarza go i natychmiast odpowiada. Nie ma persystencji obecności — serwer sprawdza "kto jest online w tym samym momencie", a nie "kto był online w ostatnich N sekund". Przy pollingu co 3–30s, szansa na jednoczesne połączenie dwóch urządzeń jest bliska zeru.

### Plan naprawy

**Strona serwera** (repozytorium `cfabserver`):
1. Dodać tabelę/cache `device_heartbeats(device_id, user_id, last_seen_at)`
2. Przy każdym heartbeat: upsert `last_seen_at = NOW()`
3. Przy obliczaniu `onlineDevices`: `SELECT COUNT(*) WHERE user_id = ? AND last_seen_at > NOW() - INTERVAL '60 seconds' AND device_id != ?`
4. Jeśli `onlineDevices >= 1` → zwrócić `push`/`pull` zamiast `idle`

**Strona klienta** — bez zmian (logika już obsługuje `push`/`pull` komendy).

### Pliki do zmiany

- Serwer: endpoint heartbeat — dodać persystencję `last_seen_at`
- Serwer: logika `onlineDevices` — okno czasowe zamiast strict-simultaneous

### Test

1. Uruchomić obie maszyny z dashboardem
2. Sprawdzić w logach, że serwer odpowiada `onlineDevices: 1` (nie 0)
3. Wywołać zmianę na jednej maszynie → sprawdzić, że druga dostaje `pull`

---

## Priorytet 2: Nadmierna częstotliwość online sync

### Problem

MICZ_NX: 25 sesji / 6 min (co ~15s). MICZ_: 15 sesji / 7 min (co ~30s). Każda kończy się `idle`. Zbędne obciążenie serwera i sieci.

### Przyczyna

Dashboard triggeruje sync przy wielu zdarzeniach UI (nawigacja, focus, timer). Brak debounce/backoff po `idle`.

### Plan naprawy

Plik: [sync-runner.ts](dashboard/src/lib/sync/sync-runner.ts)

1. **Dodać idle backoff** — po otrzymaniu `idle` od serwera, zwiększać interwał:

```typescript
// W sync-runner.ts, po linii ~530 (sekcja "IDLE: nothing to do")
// Dodać logikę:
const IDLE_BACKOFF_STEPS = [30_000, 60_000, 120_000, 300_000]; // 30s, 1m, 2m, 5m
let consecutiveIdles = 0;

// Po idle:
consecutiveIdles++;
const backoffMs = IDLE_BACKOFF_STEPS[Math.min(consecutiveIdles - 1, IDLE_BACKOFF_STEPS.length - 1)];
state.nextSyncAfter = Date.now() + backoffMs;

// Po każdym push/pull (nie-idle):
consecutiveIdles = 0;
```

2. **Debounce na triggerze** — w [sync-state.ts](dashboard/src/lib/sync/sync-state.ts) dodać min. 5s między kolejnymi wywołaniami sync:

```typescript
const MIN_SYNC_INTERVAL_MS = 5_000;
if (Date.now() - lastSyncTriggerAt < MIN_SYNC_INTERVAL_MS) return;
```

### Pliki do zmiany

| Plik | Zmiana |
|------|--------|
| `dashboard/src/lib/sync/sync-runner.ts:516-530` | Idle backoff logic |
| `dashboard/src/lib/sync/sync-state.ts` | Debounce na triggerze |
| `dashboard/src/lib/sync/sync-storage.ts:54` | Domyślny `autoSyncIntervalMinutes` (obecnie 30 — OK) |

### Test

1. Uruchomić dashboard, otworzyć `online_sync.log`
2. Sprawdzić, że po 3 kolejnych `idle` interwał rośnie do 2 min
3. Wywołać zmianę danych → interwał wraca do normalnego

---

## Priorytet 3: Garbage collection tombstones

### Problem

39 512 tombstones przesyłanych przy każdym full sync (~5.7 MB). Brak mechanizmu usuwania starych tombstones. Liczba rośnie monotonnicznie.

### Przyczyna

Tombstones są tworzone w [sync_common.rs:519](src/sync_common.rs) przy `INSERT OR IGNORE INTO tombstones`, ale nigdy nie są usuwane.

### Plan naprawy

Plik: [sync_common.rs](src/sync_common.rs)

1. **Dodać funkcję GC tombstones:**

```rust
// src/sync_common.rs — nowa funkcja
pub fn gc_tombstones(conn: &rusqlite::Connection, max_age_days: u32) -> rusqlite::Result<usize> {
    let cutoff = chrono::Utc::now() - chrono::Duration::days(max_age_days as i64);
    let cutoff_str = cutoff.format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "DELETE FROM tombstones WHERE deleted_at < ?1",
        rusqlite::params![cutoff_str],
    )
}
```

2. **Wywołać GC po udanym full sync** (obie strony zsynchronizowane):

Plik: [lan_server.rs](src/lan_server.rs) — po kroku 13/13 (unfreeze):

```rust
// Po udanym full sync, GC tombstones starszych niż 90 dni
if mode == "full" {
    if let Ok(conn) = open_dashboard_db() {
        match sync_common::gc_tombstones(&conn, 90) {
            Ok(deleted) if deleted > 0 => sync_log(&format!("GC: usunięto {} starych tombstones", deleted)),
            _ => {}
        }
    }
}
```

3. **Dodać ustawienie** w [config.rs](src/config.rs):

```rust
pub tombstone_max_age_days: u32,  // default: 90
```

### Pliki do zmiany

| Plik | Zmiana |
|------|--------|
| `src/sync_common.rs` (po linii ~530) | Nowa funkcja `gc_tombstones()` |
| `src/lan_sync_orchestrator.rs` | Wywołanie GC po full sync (master) |
| `src/lan_server.rs` (~linia 650) | Wywołanie GC po full sync (slave import) |
| `src/config.rs` | Ustawienie `tombstone_max_age_days` |

### Test

1. Sprawdzić liczbę tombstones: `SELECT COUNT(*) FROM tombstones`
2. Uruchomić full sync
3. Sprawdzić, że tombstones starsze niż 90 dni zostały usunięte
4. Sprawdzić w logu: `GC: usunięto N starych tombstones`

---

## Priorytet 4: Podwójny LAN sync (brak cooldownu po ręcznym sync)

### Problem

Po ręcznym sync z dashboard (runda #1, 3.5s), obie maszyny natychmiast inicjują kolejne synce (runda 2a + 2b), przesyłając ~11.5 MB zbędnych danych.

### Przyczyna

Ręczny trigger (`/lan/trigger-sync`) nie aktualizuje `last_sync_attempt` w discovery thread. Discovery thread ma własny timer, niezależny od ręcznych syncow. Ponadto slave nie ma żadnego cooldownu — po przyjęciu synca natychmiast może zostać triggernięty ponownie.

### Plan naprawy

1. **Współdzielony timestamp ostatniego sync** — dodać `AtomicU64` do `LanSyncState`:

Plik: [lan_server.rs:131](src/lan_server.rs)

```rust
pub last_sync_completed: AtomicU64,  // unix timestamp sekundy
```

2. **Aktualizacja po każdym sync** (niezależnie od źródła trigger):

Plik: [lan_sync_orchestrator.rs](src/lan_sync_orchestrator.rs) — na końcu `run_sync_as_master`:

```rust
state.last_sync_completed.store(
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
    Ordering::Relaxed,
);
```

Plik: [lan_server.rs](src/lan_server.rs) — na końcu `handle_db_ready` (slave import done):

```rust
state.last_sync_completed.store(/* jw */);
```

3. **Cooldown w discovery** — sprawdzać `last_sync_completed` oprócz `last_sync_attempt`:

Plik: [lan_discovery.rs:475](src/lan_discovery.rs)

```rust
let last_completed = state.last_sync_completed.load(Ordering::Relaxed);
let since_last = SystemTime::now()
    .duration_since(UNIX_EPOCH).unwrap().as_secs() - last_completed;
let min_cooldown = 60; // minimum 60s po jakimkolwiek sync
if since_last < min_cooldown {
    continue; // skip auto-trigger
}
```

4. **Cooldown na trigger-sync** — odrzucać ręczne triggery jeśli sync był < 30s temu:

Plik: [lan_server.rs:794](src/lan_server.rs) — `handle_trigger_sync`:

```rust
let last = state.last_sync_completed.load(Ordering::Relaxed);
let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
if !req.force && now - last < 30 {
    return (429, json_error("Sync completed recently, wait before retrying"));
}
```

### Pliki do zmiany

| Plik | Zmiana |
|------|--------|
| `src/lan_server.rs:131` | Dodać `last_sync_completed: AtomicU64` do `LanSyncState` |
| `src/lan_server.rs:794` | Cooldown check w `handle_trigger_sync` |
| `src/lan_server.rs` (handle_db_ready) | Update timestamp po slave import |
| `src/lan_sync_orchestrator.rs` (koniec sync) | Update timestamp po master sync |
| `src/lan_discovery.rs:475` | Sprawdzanie `last_sync_completed` |

### Test

1. Triggernąć sync z dashboard maszyny NX
2. Sprawdzić, że MICZ_ nie inicjuje natychmiastowego counter-sync
3. Sprawdzić, że ponowny trigger w ciągu 30s zwraca 429
4. Po 60s — auto-sync powinien być ponownie dozwolony

---

## Priorytet 5: Race condition w loggerze LAN

### Problem

`lan_sync.log` na obu maszynach zawiera zepsute linie (podwójne timestampy, złamane brackety). Linia 5 w `logs/lan_sync.log`:

```
[[2026-04-04 19:26:112026-04-04 19:26:11] [3/13] Negocjacja z peerem...
```

### Przyczyna

Funkcja `sync_log()` w [lan_common.rs:46-77](src/lan_common.rs) otwiera plik, pisze i zamyka bez synchronizacji. Na Windows `append(true)` nie gwarantuje atomowych zapisów. Dodatkowo rotacja logu (linie 62-70) nie jest chroniona — dwa wątki mogą rotować jednocześnie.

### Plan naprawy

Plik: [lan_common.rs:46](src/lan_common.rs)

```rust
use std::sync::Mutex;
use once_cell::sync::Lazy;  // lub std::sync::LazyLock na Rust 1.80+

static SYNC_LOG_MUTEX: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

pub fn sync_log(msg: &str) {
    log::info!("{}", msg);

    let _guard = match SYNC_LOG_MUTEX.lock() {
        Ok(g) => g,
        Err(_) => return,  // poisoned mutex — skip log write
    };

    let path = match config::logs_dir() {
        // ... reszta kodu bez zmian, ale teraz pod mutexem
    };
}
```

### Pliki do zmiany

| Plik | Zmiana |
|------|--------|
| `src/lan_common.rs:46-77` | Owinąć ciało `sync_log()` w `SYNC_LOG_MUTEX.lock()` |

### Test

1. Triggernąć sync z obu maszyn jednocześnie
2. Sprawdzić `lan_sync.log` — brak zepsutych linii
3. Sprawdzić, że rotacja działa poprawnie pod obciążeniem

---

## Priorytet 6: Optymalizacja LAN discovery scan

### Problem

Discovery skanuje 253 hosty (unicast probe) co ~30s, nawet gdy peer jest znany i odpowiada.

### Przyczyna

Brak rozróżnienia między "peer discovery" a "peer health check". Każda runda to pełny scan.

### Plan naprawy

Plik: [lan_discovery.rs](src/lan_discovery.rs)

1. **Rozdzielić scan na dwa tryby:**

```rust
enum ScanMode {
    HealthCheck,  // tylko znane peery (1-2 probes)
    FullScan,     // pełna podsieć (253 probes)
}
```

2. **Logika wyboru:**

```rust
let scan_mode = if !peers.is_empty() && last_full_scan.elapsed() < Duration::from_secs(300) {
    ScanMode::HealthCheck  // peer znany, pełny scan < 5 min temu
} else {
    ScanMode::FullScan
};
```

3. **Health check**: HTTP GET `/lan/ping` tylko do znanych peerów.

### Pliki do zmiany

| Plik | Zmiana |
|------|--------|
| `src/lan_discovery.rs` (~linia 420-440) | Dodać `ScanMode`, `last_full_scan` timer |
| `src/lan_discovery.rs` (unicast scan) | Warunkowy scan: known peers vs full |

### Test

1. Uruchomić demona, poczekać na odkrycie peera
2. Sprawdzić w logach, że kolejne rundy to "health check" (1 probe), nie "253 probes"
3. Po 5 min — pełny scan ponownie

---

## Priorytet 7: Full sync zamiast delta przy różnych markerach

### Problem

Runda #1 była `full` (since=1970-01-01) mimo że obu stronach istniały markery (tylko różne wartości).

### Przyczyna

Logika w [lan_server.rs:547-549](src/lan_server.rs):

```rust
let mode = match (&local_marker, &req.master_marker_hash) {
    (Some(local), Some(remote)) if local == remote => "delta",
    _ => "full",
};
```

Każda różnica markerów = full sync od epoch. Nie ma próby znalezienia wspólnego przodka.

### Plan naprawy (opcjonalna optymalizacja)

1. **Przechowywać historię markerów** (ostatnie N):

```sql
-- Tabela sync_markers już istnieje, ma kolumnę created_at
-- Wystarczy sprawdzić, czy remote marker jest w historii
SELECT created_at FROM sync_markers WHERE marker_hash = ?1 LIMIT 1
```

2. **Logika negocjacji:**

```rust
let mode = match (&local_marker, &req.master_marker_hash) {
    (Some(local), Some(remote)) if local == remote => "delta",
    (_, Some(remote)) => {
        // Sprawdź czy remote marker jest w naszej historii
        if let Some(ts) = find_marker_timestamp(conn, remote) {
            "delta"  // delta od tego markera
        } else {
            "full"
        }
    }
    _ => "full",
};
```

**Uwaga:** To optymalizacja, nie naprawa buga. Obecne zachowanie jest bezpieczne (full sync = zawsze poprawne dane). Wdrożyć po stabilizacji priorytetów 1-6.

### Pliki do zmiany

| Plik | Zmiana |
|------|--------|
| `src/lan_server.rs:537-550` | Rozszerzyć logikę negocjacji o historię markerów |
| `src/lan_server.rs:867` | Delta export: `since` = timestamp znalezionego markera |

---

## Kolejność wdrożenia

```
Faza 1 (krytyczne — online sync nie działa):
  [1] Serwer: persystencja heartbeat + okno obecności

Faza 2 (wydajność + stabilność):
  [5] Mutex w sync_log()                    ← 10 min, zero ryzyka
  [4] Cooldown po sync (LanSyncState)       ← 30 min, niskie ryzyko
  [2] Idle backoff w online sync            ← 30 min, niskie ryzyko

Faza 3 (utrzymanie):
  [3] GC tombstones                         ← 30 min, niskie ryzyko
  [6] Optymalizacja discovery scan          ← 45 min, średnie ryzyko

Faza 4 (optymalizacja):
  [7] Delta z historii markerów             ← 1-2h, średnie ryzyko
```

---

## Podsumowanie zmian w plikach

| Plik | Priorytety | Typ zmiany |
|------|-----------|------------|
| `src/lan_common.rs` | 5 | Mutex na sync_log |
| `src/lan_server.rs` | 4, 7 | Cooldown state + negocjacja markerów |
| `src/lan_sync_orchestrator.rs` | 4 | Update last_sync_completed |
| `src/lan_discovery.rs` | 4, 6 | Cooldown check + scan mode |
| `src/sync_common.rs` | 3 | gc_tombstones() |
| `src/config.rs` | 3 | tombstone_max_age_days setting |
| `dashboard/src/lib/sync/sync-runner.ts` | 2 | Idle backoff |
| `dashboard/src/lib/sync/sync-state.ts` | 2 | Debounce |
| Serwer (cfabserver) | 1 | Heartbeat persistence |
