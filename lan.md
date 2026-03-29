# LAN Sync — Analiza i Plan Implementacji

## 1. ANALIZA OBECNEGO STANU

### 1.1 Architektura obecna

Obecny system LAN sync dziala w modelu **peer-to-peer bez ról MASTER/SLAVE**:

- **Demon (Rust)** — `src/lan_discovery.rs`:
  - UDP broadcast na porcie 47892 co 30s (beacon)
  - Wykrywanie peerów, zapis do `lan_peers.json`
  - Expiry peerów po 120s bez beacona
  - **Brak** logiki MASTER/SLAVE
  - **Brak** zmiany ikony tray na `icon_sync.ico` podczas synchronizacji

- **Dashboard (Tauri)** — `dashboard/src-tauri/src/commands/`:
  - `lan_server.rs` — wbudowany serwer HTTP na porcie 47891 (TcpListener)
    - Endpointy: `/lan/ping`, `/lan/status`, `/lan/pull`, `/lan/push`
  - `lan_sync.rs` — klient sync (Tauri commands)
    - `get_lan_peers` — czyta `lan_peers.json`
    - `build_table_hashes_only` — SHA256 hasze tabel
    - `run_lan_sync` — ping → status → pull/push

- **Frontend (React)** — `dashboard/src/`:
  - `LanPeerNotification.tsx` — toast z przyciskiem sync (poll co 5s)
  - `LanSyncCard.tsx` — karta ustawien w Settings
  - `lan-sync.ts` / `lan-sync-types.ts` — ustawienia w localStorage

### 1.2 Zidentyfikowane problemy

| # | Problem | Lokalizacja |
|---|---------|-------------|
| 1 | **Serwer LAN startuje TYLKO gdy dashboard jest otwarty** — `start_lan_server` to Tauri command wywoływany z frontendu. Demon sam nie startuje serwera HTTP. | `lan_server.rs` — Tauri-only |
| 2 | **Brak ról MASTER/SLAVE** — oba peery uznają się za równorzędnych, decyzja push/pull oparta na porównaniu haszy tabel (symetryczna). Nie ma koordynacji kto scala. | `lan_server.rs:281-284` |
| 3 | **Brak znacznika synchronizacji w bazie** — stan sync trzymany w `localStorage` (JS), nie w SQLite. Po reinstalacji dashboardu stan ginie. | `lan-sync.ts`, brak tabeli `sync_markers` |
| 4 | **Brak interwału automatycznej synchronizacji** — LAN sync odpala się tylko na: auto-sync-on-peer-found (jednorazowo) lub ręczny przycisk. Nie ma cyklicznego harmonogramu. | `LanPeerNotification.tsx` |
| 5 | **Brak blokady bazy podczas sync** — oba peery mogą dodawać rekordy w trakcie transferu, co grozi niespójnością. | `lan_sync.rs`, `lan_server.rs` |
| 6 | **Brak kopii zapasowej przed scaleniem** — merge nadpisuje dane bez backupu. | `import_delta_into_db` |
| 7 | **Ikona `icon_sync.ico` istnieje ale nie jest używana** — tray ma tylko `icon` i `icon_attention`, brak stanu "sync in progress". | `tray.rs` |
| 8 | **Merge jest uproszczony** — last-writer-wins po `updated_at`, brak weryfikacji integralności po scaleniu. | `import_delta_into_db` |
| 9 | **Brak konfiguracji częstotliwości** — nie ma ustawienia "co ile godzin/dni synchronizować". | `LanSyncSettings` — brak pola |
| 10 | **Discovery działa ciągle** — demon broadcastuje co 30s niezależnie od tego czy sync jest potrzebny. Powinien rozgłaszać tylko gdy zbliża się czas sync lub sync manualny. | `lan_discovery.rs` |

### 1.3 Przepływ danych (obecny, niekompletny)

```
Demon A (UDP broadcast)  ←→  Demon B (UDP broadcast)
      ↓                              ↓
lan_peers.json                lan_peers.json
      ↓                              ↓
Dashboard A (poll 5s)         Dashboard B (poll 5s)
      ↓
LanPeerNotification
      ↓ (auto lub manual)
run_lan_sync →  HTTP GET /lan/ping → Dashboard B LAN Server
             →  HTTP POST /lan/status
             →  HTTP POST /lan/pull  (pobierz dane peera)
             →  HTTP POST /lan/push  (wyślij swoje dane)
```

**Problem kluczowy:** Sync wymaga obu dashboardów otwartych jednocześnie (serwer HTTP żyje tylko w procesie Tauri).

---

## 2. DOCELOWA ARCHITEKTURA

### 2.1 Role

| Rola | Kto | Kiedy |
|------|-----|-------|
| **MASTER** | Pierwszy demon który nie znalazł żadnego peera | Automatycznie po starcie discovery |
| **SLAVE** | Demon który wykrył istniejącego MASTERA | Automatycznie po odebraniu beacona MASTER |

### 2.2 Znacznik synchronizacji (Sync Marker)

Nowa tabela w SQLite:

```sql
CREATE TABLE IF NOT EXISTS sync_markers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    marker_hash TEXT    NOT NULL,       -- SHA256(concat(table_hashes + timestamp))
    created_at  TEXT    NOT NULL,       -- ISO 8601
    device_id   TEXT    NOT NULL,       -- kto wykonał scalenie (MASTER)
    peer_id     TEXT,                   -- z kim synchronizowano
    tables_hash TEXT    NOT NULL,       -- SHA256 wszystkich tabel po scaleniu
    full_sync   INTEGER NOT NULL DEFAULT 0  -- 1 = pełna sync, 0 = delta
);
```

**Logika znacznika:**
- Po każdym scaleniu MASTER generuje `marker_hash = SHA256(tables_hash + ISO_timestamp + device_id)`
- Obie bazy (MASTER i SLAVE) po udanej sync mają identyczny najnowszy `marker_hash`
- Przy następnej sync: jeśli oba peery mają ten sam najnowszy `marker_hash` → delta sync (dane od `created_at` znacznika)
- Jeśli znaczniki się różnią lub brak znacznika → full sync

### 2.3 Docelowy przepływ synchronizacji (13 kroków)

```
┌─────────────────────────────────────────────────────────────────────┐
│ FAZA 1: DISCOVERY & ROLE ASSIGNMENT                                 │
│                                                                     │
│ 1. Demon startuje discovery (broadcast/listen) wg harmonogramu     │
│    - Częstotliwość ustawiana w Settings (np. co 4h/12h/24h)        │
│    - Poza harmonogramem: discovery wyłączone (oszczędność zasobów) │
│    - Wyjątek: ręczny przycisk "Synchronizuj teraz"                 │
│                                                                     │
│ 2. Jeśli demon znajdzie peera:                                      │
│    - Pierwszy (istniejący) → MASTER                                 │
│    - Drugi (nowo wykryty) → SLAVE                                   │
│    - Oba zmieniają ikonę tray na icon_sync.ico                      │
└─────────────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────────────┐
│ FAZA 2: NEGOCJACJA                                                  │
│                                                                     │
│ 3. MASTER wysyła do SLAVE: RequestDatabase {                        │
│      master_device_id, master_marker_hash (lub null)               │
│    }                                                                │
│                                                                     │
│ 4. SLAVE weryfikuje:                                                │
│    - Porównuje marker_hash (swój vs MASTER)                         │
│    - Jeśli oba mają ten sam marker → odpowiada DeltaReady           │
│    - Jeśli różne lub brak → odpowiada FullSyncReady                 │
│    - Uzgadniają tryb transferu                                      │
└─────────────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────────────┐
│ FAZA 3: FREEZE & TRANSFER                                           │
│                                                                     │
│ 5. Oba klienty BLOKUJĄ zapisy do bazy (freeze)                     │
│    - Demon wstrzymuje dodawanie nowych sesji/rekordów               │
│    - Dashboard wyświetla "Synchronizacja w toku..."                 │
│                                                                     │
│ 6. SLAVE wysyła bazę do MASTER:                                     │
│    - Full sync: cała baza (dump wszystkich tabel)                   │
│    - Delta sync: rekordy od ostatniego marker.created_at            │
│                                                                     │
│ 7. MASTER potwierdza odbiór (ACK)                                   │
└─────────────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────────────┐
│ FAZA 4: MERGE & VERIFY                                              │
│                                                                     │
│ 8. Oba klienty robią BACKUP swoich baz                              │
│    - Kopia do: timeflow_backup_YYYY-MM-DD_HH-MM-SS.db              │
│                                                                     │
│ 9. MASTER scala bazę:                                               │
│    - Merge SLAVE data → MASTER db (last-writer-wins + tombstones)  │
│    - Nowy marker_hash generowany                                    │
│    - Marker zapisany do tabeli sync_markers                         │
│                                                                     │
│ 10. MASTER weryfikuje scalenie:                                     │
│    - Sprawdza integralność FK                                       │
│    - Usuwa osierocone rekordy (sessions bez app, apps bez project)  │
│    - Przelicza table_hashes                                         │
│    - Zapisuje finalny marker                                        │
└─────────────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────────────┐
│ FAZA 5: DISTRIBUTE & RESUME                                         │
│                                                                     │
│ 11. MASTER informuje SLAVE że baza gotowa:                          │
│    - Wysyła DatabaseReady { marker_hash, transfer_mode }            │
│    - SLAVE potwierdza gotowość do odbioru                           │
│    - MASTER wysyła scaloną bazę do SLAVE                            │
│                                                                     │
│ 12. SLAVE odbiera, weryfikuje bazę:                                 │
│    - Sprawdza marker_hash                                           │
│    - Przelicza table_hashes i porównuje                             │
│    - Podmienia swoją bazę na otrzymaną                              │
│    - Wysyła do MASTER sygnał OK                                    │
│                                                                     │
│ 13. Oba klienty ODBLOKOWUJĄ bazy:                                   │
│    - Wznawiają rejestrację aktywności                               │
│    - Ikona tray wraca do normalnej                                  │
│    - Oba pracują na lokalnych kopiach identycznej bazy              │
│    - Discovery wyłącza się do następnego harmonogramu               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. PLAN IMPLEMENTACJI

### Faza A: Infrastruktura bazodanowa i konfiguracja

#### A1. Nowa tabela `sync_markers` w SQLite
- **Plik:** `dashboard/src-tauri/src/db.rs` (lub odpowiednik z migracjami)
- **Co:** Dodać tabelę `sync_markers` (schemat powyżej)
- **Co:** Funkcje CRUD: `insert_sync_marker()`, `get_latest_sync_marker()`, `markers_match(local, remote) -> bool`

#### A2. Rozszerzenie `LanSyncSettings`
- **Pliki:** `dashboard/src/lib/lan-sync-types.ts`, `dashboard/src/lib/lan-sync.ts`
- **Nowe pola:**
  ```typescript
  interface LanSyncSettings {
    enabled: boolean;
    serverPort: number;
    autoSyncOnPeerFound: boolean;
    // NOWE:
    syncIntervalHours: number;     // np. 4, 8, 12, 24 (0 = tylko manualnie)
    discoveryDurationMinutes: number; // jak długo szukać peera (np. 5 min)
  }
  ```
- **UI:** Rozszerzyć `LanSyncCard.tsx` o pole "Interwał synchronizacji" (select/input)

#### A3. Backup bazy przed sync
- **Plik:** nowy Tauri command `backup_database` w `dashboard/src-tauri/src/commands/`
- **Co:** Kopiuje plik `.db` do `timeflow_backup_<timestamp>.db`
- **Co:** Rotacja: max 5 ostatnich backupów (usuwanie starszych)

### Faza B: Role MASTER/SLAVE w demonie

#### B1. Rozszerzenie protokołu discovery
- **Plik:** `src/lan_discovery.rs`
- **Nowe pola w `BeaconPacket`:**
  ```rust
  struct BeaconPacket {
      // ... istniejące pola ...
      role: String,              // "master", "slave", "undecided"
      sync_marker_hash: Option<String>,  // aktualny znacznik
      sync_ready: bool,          // czy gotowy do sync
  }
  ```
- **Logika roli:**
  - Start → `undecided`, po 2 cyklach beacon (60s) bez peera → `master`
  - Gdy `undecided` odbierze beacon od `master` → staje się `slave`
  - Gdy `undecided` odbierze beacon od `undecided` → ten z niższym device_id = `master`

#### B2. Harmonogram discovery (broadcast/listen)
- **Plik:** `src/lan_discovery.rs`
- **Co:** Discovery nie działa ciągle — aktywuje się:
  - Co `syncIntervalHours` (czyta z pliku konfiguracyjnego)
  - Na żądanie (sygnał od dashboardu przez plik/IPC)
- **Tryb aktywny:** broadcast+listen przez `discoveryDurationMinutes` minut
- **Tryb uśpiony:** brak broadcastu, nasłuchiwanie minimalne (reaguje na discover packet)

#### B3. Zmiana ikony tray na `icon_sync.ico`
- **Plik:** `src/tray.rs`
- **Co:**
  - Dodać trzeci stan ikony: `icon_sync` (załadowany z `APP_ICON_SYNC` w zasobach exe)
  - Nowy `AtomicBool` lub enum `TrayIconState { Normal, Attention, Syncing }`
  - Discovery ustawia stan na `Syncing` gdy peer znaleziony
  - Po zakończeniu sync — wraca do `Normal`
- **Plik:** `assets/icon_sync.ico` — już istnieje, trzeba dodać do zasobów exe (`.rc` file)

### Faza C: Nowy protokół synchronizacji

#### C1. Serwer HTTP w demonie (nie w Tauri!)
- **Plik:** nowy `src/lan_server.rs` (w demonie, nie w dashboard)
- **Co:** Przenieść/zduplikować logikę serwera HTTP z `dashboard/src-tauri/src/commands/lan_server.rs` do demona
- **Dlaczego:** Serwer musi działać nawet gdy dashboard jest zamknięty
- **Endpointy (nowe):**

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/lan/ping` | GET | Ping + rola + marker_hash |
| `/lan/request-db` | POST | MASTER prosi SLAVE o bazę (krok 3) |
| `/lan/negotiate` | POST | SLAVE odpowiada trybem sync (krok 4) |
| `/lan/freeze-ack` | POST | Potwierdzenie zamrożenia bazy (krok 5) |
| `/lan/upload-db` | POST | SLAVE wysyła bazę do MASTER (krok 6) |
| `/lan/upload-ack` | POST | MASTER potwierdza odbiór (krok 7) |
| `/lan/db-ready` | POST | MASTER informuje o gotowości scalonej bazy (krok 11) |
| `/lan/download-db` | GET | SLAVE pobiera scaloną bazę (krok 11) |
| `/lan/verify-ack` | POST | SLAVE potwierdza poprawność (krok 12) |
| `/lan/unfreeze` | POST | Sygnał odblokowania bazy (krok 13) |

#### C2. Orkiestrator synchronizacji
- **Plik:** nowy `src/lan_sync_orchestrator.rs`
- **Co:** Automat stanów (state machine) realizujący 13 kroków:

```rust
enum SyncState {
    Idle,
    Discovering,          // szukam peera
    RoleAssigned,         // MASTER lub SLAVE
    RequestingDatabase,   // MASTER: krok 3
    Negotiating,          // krok 4
    Frozen,               // krok 5 — baza zablokowana
    TransferringToMaster, // krok 6
    AckReceived,          // krok 7
    BackingUp,            // krok 8
    Merging,              // krok 9
    Verifying,            // krok 10
    DistributingToSlave,  // krok 11
    SlaveVerifying,       // krok 12
    Completed,            // krok 13
    Error(String),
}
```

#### C3. Mechanizm freeze/unfreeze bazy
- **Pliki:** `src/tracker.rs`, `src/storage.rs` (demon), nowy Tauri command (dashboard)
- **Co:**
  - Globalny `AtomicBool` `DB_FROZEN` w demonie
  - Gdy `true` — tracker buforuje sesje w pamięci zamiast pisać do SQLite
  - Gdy `false` — bufor flushowany do bazy
  - Dashboard: disable przyciski mutacji, wyświetlić overlay "Synchronizacja..."
  - **Timeout:** auto-unfreeze po 5 minutach (safety net)

#### C4. Scalanie baz (merge)
- **Plik:** rozszerzenie `lan_sync.rs` lub nowy `src/lan_merge.rs`
- **Co:** Rozszerzyć istniejący `import_delta_into_db`:
  - Przed merge: backup (`A3`)
  - Po merge: weryfikacja FK, usunięcie orphanów
  - Generowanie nowego `sync_marker`
  - Przeliczenie `table_hashes` i zapisanie w marker

#### C5. Transfer pełnej bazy
- **Plik:** nowy endpoint + logika
- **Co:**
  - Full sync: SLAVE serializuje całą bazę (wszystkie tabele) jako JSON
  - Delta sync: tylko rekordy z `updated_at > marker.created_at` + tombstones
  - Transfer chunked (dla dużych baz): Content-Length + streaming
  - MASTER odsyła scaloną bazę: SLAVE zastępuje swoją bazę nową

### Faza D: Integracja z UI

#### D1. Rozszerzenie ustawień
- **Plik:** `dashboard/src/components/settings/LanSyncCard.tsx`
- **Nowe elementy:**
  - Select: "Synchronizuj co: 4h / 8h / 12h / 24h / 48h / ręcznie"
  - Info: "Następna synchronizacja: za Xh Xm"
  - Info: "Ostatni znacznik: `abc123...` z 2026-03-28 14:30"
  - Przycisk "Synchronizuj teraz" (triggeruje discovery natychmiast)

#### D2. Status synchronizacji w tray
- **Plik:** `src/tray.rs`
- **Co:**
  - Menu kontekstowe: "Stan sync: MASTER / SLAVE / idle"
  - Tooltip: aktualizacja z postępem sync

#### D3. Powiadomienia i overlay
- **Plik:** `dashboard/src/components/sync/LanPeerNotification.tsx`
- **Co:**
  - Podczas sync: overlay/banner "Synchronizacja w toku... (krok X/13)"
  - Po sync: toast "Zsynchronizowano z [machine_name]"
  - Przy błędzie: toast z informacją + przyciskiem "Przywróć backup"

#### D4. Aktualizacja Help.tsx
- **Plik:** `dashboard/src/pages/Help.tsx`
- **Co:** Opis nowej procedury sync, ustawień interwału, ról MASTER/SLAVE

### Faza E: Testy i hardening

#### E1. Scenariusze testowe
1. Dwa demony w tej samej sieci — auto-discovery + auto-sync
2. Jeden demon offline podczas planowanej sync → retry przy następnym interwale
3. Sync przerwany w trakcie (kill procesu) → auto-unfreeze + rollback z backupu
4. Delta sync: identyczne markery, mała paczka danych
5. Full sync: brak markerów, pełny transfer + merge
6. Konflikt: ten sam rekord zmodyfikowany na obu maszynach → last-writer-wins
7. Tombstone propagacja: usunięcie na A propaguje się na B

#### E2. Safety nets
- Auto-unfreeze po timeout (5 min)
- Walidacja integralności bazy po merge (FK check)
- Rotacja backupów (max 5)
- Logi sync do osobnego pliku (`timeflow_sync.log`)
- Retry z backoff przy błędach sieciowych

---

## 4. KOLEJNOŚĆ IMPLEMENTACJI (priorytety)

| Priorytet | Zadanie | Zależności |
|-----------|---------|-----------|
| **P0** | A1 — tabela `sync_markers` | brak |
| **P0** | C1 — serwer HTTP w demonie | brak |
| **P1** | B1 — role MASTER/SLAVE w discovery | C1 |
| **P1** | A2 — ustawienia interwału | brak |
| **P1** | A3 — backup bazy | brak |
| **P2** | C2 — orkiestrator (state machine) | B1, C1 |
| **P2** | C3 — freeze/unfreeze | C2 |
| **P2** | B2 — harmonogram discovery | A2 |
| **P3** | C4 — rozszerzony merge + marker | A1, C3 |
| **P3** | C5 — transfer pełnej bazy | C4 |
| **P3** | B3 — ikona sync w tray | B1 |
| **P4** | D1–D4 — integracja UI | C2, C4 |
| **P4** | E1–E2 — testy + hardening | wszystko |

---

## 5. SZACOWANY ZAKRES ZMIAN

| Warstwa | Nowe pliki | Zmodyfikowane pliki |
|---------|-----------|-------------------|
| Demon (Rust) | `src/lan_server.rs`, `src/lan_sync_orchestrator.rs`, `src/lan_merge.rs` | `src/lan_discovery.rs`, `src/tray.rs`, `src/tracker.rs`, `src/main.rs`, `src/storage.rs` |
| Dashboard Tauri (Rust) | — | `commands/lan_sync.rs`, `commands/lan_server.rs`, `db.rs` (migracja) |
| Dashboard Frontend (TS/React) | — | `lan-sync-types.ts`, `lan-sync.ts`, `LanSyncCard.tsx`, `LanPeerNotification.tsx`, `Help.tsx` |
| Assets | — | `.rc` file (dodanie `ICON_SYNC`) |

---

## 6. RYZYKA I MITYGACJA

| Ryzyko | Prawdopodobieństwo | Mitygacja |
|--------|-------------------|-----------|
| Freeze bazy blokuje użytkownika na zbyt długo | Średnie | Timeout 5 min + auto-unfreeze + buforowanie w pamięci |
| Merge tworzy niespójne dane | Niskie | FK check po merge + backup + rollback |
| Dwa MASTERY w sieci (split brain) | Niskie | Deterministyczny tie-break po device_id |
| Duża baza (>50MB) powoduje timeout transferu | Średnie | Chunked transfer + zwiększony timeout |
| Demon crashuje podczas merge | Niskie | Backup przed merge + WAL mode SQLite |
| Firewall blokuje UDP broadcast | Średnie | Fallback: manual IP peer w ustawieniach |
