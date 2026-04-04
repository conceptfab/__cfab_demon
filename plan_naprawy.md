# TIMEFLOW — Plan naprawy synchronizacji

**Data:** 2026-04-04  
**Bazuje na:** sync_raport.md  
**Cel:** Przywrócenie pełnej funkcjonalności synchronizacji LAN i online

---

## ETAP 1 — LAN SYNC: Naprawa krytyczna

> **Priorytet:** KRYTYCZNY  
> **Blokuje:** Całą synchronizację LAN  
> **Bugi:** BUG-1, BUG-10, BUG-9, BUG-6

### 1.1 Slave pobiera i importuje scalone dane (BUG-1)

**Plik:** `src/lan_server.rs` — `handle_db_ready()`

**Obecny stan:** `handle_db_ready()` (linia 606) tylko ustawia progress i zwraca `{ok: true}`. Slave nigdy nie pobiera scalonych danych od mastera.

**Zmiany:**

1. W `handle_db_ready()` — po ustawieniu progress, dodać pełen flow importu:

```rust
// Pseudokod zmian w handle_db_ready():
async fn handle_db_ready(state: &LanSyncState, master_addr: &str) -> Result<...> {
    // 1. Pobranie scalonych danych z mastera
    let merged_data = http_get(&format!("http://{}/lan/download-db", master_addr))?;
    
    // 2. Backup bazy przed merge
    let backup_path = backup_database(&db_path)?;
    
    // 3. Merge danych do lokalnej bazy
    match merge_incoming_data(&db_path, &merged_data) {
        Ok(_) => {},
        Err(e) => {
            // Restore backupu przy błędzie
            restore_database_backup(&backup_path, &db_path)?;
            return Err(e);
        }
    }
    
    // 4. Verify integralności
    match verify_merge_integrity(&db_path) {
        Ok(_) => {},
        Err(e) => {
            restore_database_backup(&backup_path, &db_path)?;
            return Err(e);
        }
    }
    
    // 5. Wstawienie tego samego markera co master
    insert_sync_marker_db(&db_path, &marker_hash)?;
    
    // 6. Ustawienie statusu "slave_import_done"
    state.set_progress("slave_import_done");
    
    // 7. Zwrot OK do mastera
    Ok(json!({"ok": true, "status": "import_complete"}))
}
```

**Kluczowe:** Master musi przekazać `marker_hash` w żądaniu `/lan/db-ready` (dodać do body JSON), żeby slave zapisał **ten sam** marker.

**Wzorzec:** Logika slave'a powinna być analogiczna do `online_sync.rs` linie 1131-1186 (sesyjny online sync slave flow).

---

### 1.2 Master czeka na potwierdzenie od slave'a (BUG-10)

**Plik:** `src/lan_sync_orchestrator.rs` — krok 12-13 (linie 395-401)

**Obecny stan:** Po wysłaniu `db-ready`, master natychmiast przechodzi do unfreeze (krok 13) bez czekania.

**Zmiany:**

1. Krok 11 (`db-ready`) — zmienić na synchroniczne żądanie z timeoutem:

```rust
// Krok 11: Wysłanie db-ready i oczekiwanie na import slave'a
let response = http_post_with_timeout(
    &format!("http://{}/lan/db-ready", slave_addr),
    json!({
        "marker_hash": marker_hash,
        // opcjonalnie: URL do pobrania lub dane inline
    }),
    Duration::from_secs(120) // timeout na import slave'a
)?;

// Sprawdzenie czy slave zakończył import
if response["status"] != "import_complete" {
    // Rollback na masterze
    restore_database_backup(&backup_path, &db_path)?;
    return Err("Slave nie zakończył importu".into());
}
```

2. Krok 12 — zmienić z no-op na weryfikację spójności:

```rust
// Krok 12: Weryfikacja — porównanie haszy tabel
let master_hash = compute_table_hash(&db_path)?;
let slave_hash = http_get_json(
    &format!("http://{}/lan/ping", slave_addr)
)?["tables_hash"];

if master_hash != slave_hash {
    sync_log("WARN: Hasze tabel nie zgadzają się po synchronizacji");
    // Nie rollback — dane są scalone, ale komunikat ostrzegawczy
}
```

3. Krok 13 — unfreeze dopiero po potwierdzeniu:

```rust
// Krok 13: Unfreeze — wysłanie do slave'a
http_post(&format!("http://{}/lan/unfreeze", slave_addr), json!({}))?;
state.set_db_frozen(false);
state.set_progress("completed");
```

**Wzorzec:** Analogicznie do `online_sync.rs` `wait_for_step()` — linie 1364-1374.

---

### 1.3 Restore backupu przy błędzie verify (BUG-9)

**Plik:** `src/lan_sync_orchestrator.rs` — krok 9-10 (linie 340-358)

**Obecny stan:** Krok 8 tworzy backup, krok 10 verify — ale przy błędzie verify backup NIE jest przywracany.

**Zmiany:**

```rust
// Krok 8: Backup
let backup_path = backup_database(&db_path)?;

// Krok 9: Merge
match merge_incoming_data(&db_path, &incoming_data) {
    Err(e) => {
        restore_database_backup(&backup_path, &db_path)?;  // ← DODAĆ
        return Err(e);
    }
    Ok(_) => {}
}

// Krok 10: Verify
match verify_merge_integrity(&db_path) {
    Err(e) => {
        restore_database_backup(&backup_path, &db_path)?;  // ← DODAĆ (brakuje!)
        return Err(e);
    }
    Ok(_) => {}
}
```

**Wzorzec:** Identyczny jak `online_sync.rs` linie 1161-1168 i 1292-1297.

---

### 1.4 Spójność markerów po sync (BUG-6)

**Plik:** `src/lan_sync_orchestrator.rs` — krok 11 (linia 364)

**Obecny stan:** Master generuje marker z `tables_hash + timestamp + device_id`. Slave nigdy nie otrzymuje tego markera (BUG-1). Następna synchronizacja zawsze widzi różne markery → negotiate mówi "full" zamiast "delta".

**Zmiany:**

Po naprawie BUG-1 (slave importuje dane + otrzymuje marker od mastera), ten bug powinien zniknąć automatycznie:
- Master generuje marker → zapisuje do swojej bazy
- Master przekazuje `marker_hash` do slave'a w `/lan/db-ready`
- Slave zapisuje **ten sam** marker do swojej bazy
- Następna negotiate porównuje identyczne markery → "delta"

**Weryfikacja:** Po implementacji 1.1-1.3, uruchomić dwa sync pod rząd. Drugi sync powinien zwrócić negotiate mode = "delta".

---

### 1.5 Testy Etapu 1

| # | Scenariusz | Oczekiwany wynik |
|---|-----------|-----------------|
| T1 | LAN sync delta: dwa klienty, różne wpisy od ostatniego markera | Obie bazy identyczne po sync. Marker identyczny. |
| T2 | LAN sync force: dwa klienty | Obie bazy identyczne. Nowy marker. |
| T3 | Drugi sync po T1 | Negotiate zwraca "delta". Sync kończy się szybko. |
| T4 | Merge fail (uszkodzone dane) | Backup przywrócony. Bazy nienaruszone. Komunikat błędu. |
| T5 | Slave timeout (symulacja: slave wyłączony po db-ready) | Master rollback po timeout. Komunikat błędu. |
| T6 | Porównanie haszy po sync | `compute_table_hash` identyczny na obu maszynach. |

---

## ETAP 2 — UI freeze + online async + hash fix

> **Priorytet:** KRYTYCZNY / WYSOKI  
> **Bugi:** BUG-2, BUG-3, BUG-8

### 2.1 Fullscreen overlay blokujący UI (BUG-2)

**Pliki:**
- `dashboard/src/components/sync/SyncProgressOverlay.tsx` — modyfikacja
- `dashboard/src/components/sync/DaemonSyncOverlay.tsx` — modyfikacja
- (opcjonalnie) nowy komponent `SyncBlockingOverlay.tsx`

**Obecny stan:** `SyncProgressOverlay.tsx` to mały widget `fixed bottom-20 right-6 w-80` — nie blokuje UI.

**Zmiany:**

1. **Nowy komponent blokujący** (lub modyfikacja istniejącego):

```tsx
// SyncBlockingOverlay.tsx — fullscreen overlay
export function SyncBlockingOverlay({ phase, progress, step, totalSteps }) {
  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center">
      {/* Blokada kliknięć na resztę UI */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-8 max-w-md w-full mx-4 shadow-2xl">
        <h2 className="text-xl font-bold mb-4">
          Synchronizacja w toku
        </h2>
        <p className="text-gray-600 dark:text-gray-300 mb-6">
          {phase}
        </p>
        
        {/* Progress bar */}
        <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
          <div 
            className="bg-blue-600 h-3 rounded-full transition-all duration-300"
            style={{ width: `${(step / totalSteps) * 100}%` }}
          />
        </div>
        <p className="text-sm text-gray-500">
          Krok {step} z {totalSteps}
        </p>
        
        <p className="text-xs text-gray-400 mt-4">
          Proszę nie zamykać aplikacji. Rejestrowanie wpisów jest wstrzymane.
        </p>
      </div>
    </div>
  );
}
```

2. **W `DaemonSyncOverlay.tsx`** — gdy sync jest aktywny, renderować `SyncBlockingOverlay` zamiast `SyncProgressOverlay`:

```tsx
// Zamiast:
return <SyncProgressOverlay ... />;
// Renderować:
return <SyncBlockingOverlay phase={...} progress={...} step={...} totalSteps={...} />;
```

3. **Blokada nawigacji** — dodać `beforeunload` event i zablokować router:

```tsx
useEffect(() => {
  if (isSyncing) {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }
}, [isSyncing]);
```

4. **Sprawdzenie `db_frozen` w dashboardzie** — dashboard powinien pollować status daemon'a i blokować formularze gdy `db_frozen === true`.

---

### 2.2 Online async pull — automatyczny trigger (BUG-3)

**Pliki:**
- `dashboard/src/components/sync/BackgroundServices.tsx` — modyfikacja
- `dashboard/src/lib/online-sync.ts` — weryfikacja

**Obecny stan:** `runOnlineSyncOnce()` uruchamia tryb sesyjny, nie async delta. Background job nie obsługuje async pull. SSE handler też wywołuje sesyjny sync.

**Zmiany:**

1. **W `BackgroundServices.tsx`** — zmienić `runSync()` żeby triggerował daemon endpoint:

```tsx
// Zamiast bezpośredniego wywołania runOnlineSyncOnce():
async function runSync() {
  // Triggerowanie demona — on wie czy użyć async czy session
  await invoke('run_online_sync');  // Tauri command → POST /online/trigger-sync
}
```

2. **W SSE handler** — analogiczna zmiana:

```tsx
// SSE handler (linia ~668)
// Zamiast: await runOnlineSyncOnce()
// Użyć: await invoke('run_online_sync')
```

3. **Periodic async pull** — dodać w daemon background loop odpytywanie serwera co `async_poll_interval`:

```rust
// W online_sync.rs lub osobnym module:
async fn background_async_poll(state: &SyncState) {
    loop {
        if state.online_config.sync_mode == "async" {
            match check_pending_packages(&state.server_url, &state.license_key).await {
                Ok(packages) if !packages.is_empty() => {
                    execute_async_pull(state, packages).await;
                }
                _ => {}
            }
        }
        sleep(Duration::from_secs(60)).await; // co 60s
    }
}
```

---

### 2.3 Ujednolicenie algorytmu hashowania (BUG-8)

**Plik:** `dashboard/src-tauri/src/commands/helpers.rs` — linia 74

**Obecny stan:** Dashboard używa `std::collections::hash_map::DefaultHasher` (SipHash, niedeterministyczny), daemon używa FNV-1a.

**Zmiana:**

```rust
// W helpers.rs — USUNĄĆ:
use std::collections::hash_map::DefaultHasher;

// DODAĆ:
use crate::lan_common::fnv1a_64;
// LUB skopiować implementację FNV-1a z lan_common.rs:

fn fnv1a_64(data: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for &byte in data {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

// W compute_table_hash():
// Zamienić: let mut hasher = DefaultHasher::new(); + hasher.finish()
// Na:       fnv1a_64(concatenated_data.as_bytes())
```

**Najlepiej:** Przenieść `fnv1a_64` do współdzielonego modułu, importować w obu miejscach.

---

### 2.4 Testy Etapu 2

| # | Scenariusz | Oczekiwany wynik |
|---|-----------|-----------------|
| T7 | Uruchomienie sync → UI | Fullscreen overlay, brak interakcji z UI |
| T8 | Próba nawigacji podczas sync | Zablokowana / komunikat ostrzegawczy |
| T9 | Sync zakończony → UI | Overlay znika, UI odblokowany |
| T10 | Online async: klient A pushuje deltę | Klient B automatycznie pobiera w ciągu 60s |
| T11 | SSE trigger sync | Daemon uruchamia poprawny tryb (async/session) |
| T12 | `compute_table_hash` daemon vs dashboard | Identyczny wynik dla tych samych danych |

---

## ETAP 3 — Polerowanie i optymalizacje

> **Priorytet:** WYSOKI / ŚREDNI  
> **Bugi:** BUG-7, BUG-4, BUG-5, ISSUE-12, ISSUE-8, ISSUE-9, ISSUE-9a, ISSUE-10, ISSUE-11

### 3.1 Nie nadpisywać `assigned_folder_path` (BUG-7)

**Plik:** `src/sync_common.rs` — linia 220-230

**Zmiana:** Usunąć `assigned_folder_path` z UPDATE w merge projektów:

```rust
// PRZED:
"UPDATE projects SET color = ?1, hourly_rate = ?2, excluded_at = ?3, \
 frozen_at = ?4, assigned_folder_path = ?5, updated_at = ?6 WHERE name = ?7"

// PO:
"UPDATE projects SET color = ?1, hourly_rate = ?2, excluded_at = ?3, \
 frozen_at = ?4, updated_at = ?5 WHERE name = ?6"
```

Usunąć odpowiedni parametr z `params![]`.

---

### 3.2 Firewall — komunikat w UI (BUG-4)

**Pliki:**
- `src/firewall.rs` — bez zmian
- Dashboard UI (np. `LanSyncCard.tsx` lub nowy komponent)

**Zmiany:**

1. Daemon endpoint (np. `/lan/firewall-status`) zwracający czy reguły są aktywne
2. W UI — jeśli firewall nie jest skonfigurowany, wyświetlić banner:

```
⚠️ Reguły zapory sieciowej nie zostały dodane.
LAN discovery może nie działać.
[Instrukcja konfiguracji]
```

3. Instrukcja: uruchom raz jako administrator, lub ręcznie dodaj reguły:
```
netsh advfirewall firewall add rule name="TIMEFLOW LAN Discovery" dir=in action=allow protocol=UDP localport=47892
netsh advfirewall firewall add rule name="TIMEFLOW LAN Server" dir=in action=allow protocol=TCP localport=47891
```

---

### 3.3 Usunięcie martwego kodu merge (BUG-5)

**Plik:** `dashboard/src-tauri/src/commands/lan_sync.rs`

**Zmiana:** Usunąć `import_delta_into_db()` (linia 392-739) — martwy kod oznaczony `#[allow(dead_code)]`. Cała logika merge jest w `sync_common.rs`.

Jeśli `import_delta_into_db` zawiera poprawkę pomijania `assigned_folder_path` — przenieść tę poprawkę do `sync_common.rs` (punkt 3.1) i dopiero usunąć dead code.

---

### 3.4 Context menu delta/force sync (ISSUE-12)

**Plik:** `dashboard/src/components/settings/LanSyncCard.tsx`

**Zmiana:** Zamienić osobne przyciski "Sync" i "Force" na context menu (right-click):

```tsx
// Opcja 1: Native context menu
<button 
  onContextMenu={(e) => {
    e.preventDefault();
    showContextMenu([
      { label: 'Delta sync', onClick: () => triggerSync(peer, 'delta') },
      { label: 'Force sync', onClick: () => triggerSync(peer, 'force') },
    ]);
  }}
>
  <SyncIcon />
</button>
```

Dodać analogiczne context menu na ikonach sync w głównym widoku dashboardu (sidebar/topbar).

---

### 3.5 Optymalizacje (ISSUE-8, ISSUE-9, ISSUE-9a, ISSUE-10, ISSUE-11)

| Issue | Zmiana | Plik |
|-------|--------|------|
| ISSUE-8 | Jedna funkcja parsująca `ipconfig` z cache | `lan_discovery.rs` |
| ISSUE-9 | Usunąć `set_nonblocking(false)` (martwy kod) | `lan_server.rs:261` |
| ISSUE-9a | Typowane struktury zamiast `serde_json::Value` w merge | `sync_common.rs` |
| ISSUE-10 | Usunąć lokalne `sync_log()` wrappery, użyć `use crate::lan_common::sync_log` | Wiele plików |
| ISSUE-11 | Ujednolicić `get_device_id()` — jedna funkcja `get_or_create_device_id()` | `lan_common.rs`, `lan_discovery.rs` |

---

### 3.6 Testy Etapu 3

| # | Scenariusz | Oczekiwany wynik |
|---|-----------|-----------------|
| T13 | Sync projektów z różnymi `assigned_folder_path` | Lokalne ścieżki zachowane |
| T14 | Daemon bez uprawnień admin + banner w UI | Banner widoczny z instrukcją |
| T15 | Right-click na ikonie sync | Context menu z opcjami delta/force |
| T16 | Build po usunięciu dead code | Kompilacja bez błędów |

---

## Harmonogram implementacji

```
Etap 1 — LAN SYNC CRITICAL
├── 1.1 handle_db_ready() → pełny import flow
├── 1.2 Master czeka na slave (timeout + rollback)
├── 1.3 Restore backupu przy verify error
├── 1.4 Weryfikacja spójności markerów
└── 1.5 Testy T1-T6

Etap 2 — UI + ONLINE + HASH
├── 2.1 SyncBlockingOverlay (fullscreen)
├── 2.2 Background async pull + SSE fix
├── 2.3 FNV-1a w dashboard helpers.rs
└── 2.4 Testy T7-T12

Etap 3 — POLEROWANIE
├── 3.1 assigned_folder_path fix
├── 3.2 Firewall banner w UI
├── 3.3 Usunięcie dead code merge
├── 3.4 Context menu delta/force
├── 3.5 Optymalizacje
└── 3.6 Testy T13-T16
```

---

## Pliki do modyfikacji — podsumowanie

| Plik | Etap | Bugi |
|------|------|------|
| `src/lan_server.rs` | 1 | BUG-1 |
| `src/lan_sync_orchestrator.rs` | 1 | BUG-9, BUG-10 |
| `src/sync_common.rs` | 3 | BUG-7 |
| `src/online_sync.rs` | 2 | BUG-3 |
| `dashboard/src-tauri/src/commands/helpers.rs` | 2 | BUG-8 |
| `dashboard/src-tauri/src/commands/lan_sync.rs` | 3 | BUG-5 |
| `dashboard/src/components/sync/SyncProgressOverlay.tsx` | 2 | BUG-2 |
| `dashboard/src/components/sync/DaemonSyncOverlay.tsx` | 2 | BUG-2 |
| `dashboard/src/components/sync/BackgroundServices.tsx` | 2 | BUG-3 |
| `dashboard/src/components/settings/LanSyncCard.tsx` | 3 | ISSUE-12 |
| `src/firewall.rs` | 3 | BUG-4 (bez zmian, UI banner) |
| `src/lan_discovery.rs` | 3 | ISSUE-8, ISSUE-11 |
| `src/lan_common.rs` | 3 | ISSUE-10, ISSUE-11 |
