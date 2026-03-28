# TIMEFLOW — LAN Sync: Dokumentacja techniczna

**Data:** 2026-03-28
**Status:** Projekt / Do implementacji
**Wersja docelowa:** dashboard 0.1.540+, demon 0.3.0+

---

## 1. Cel funkcji

Synchronizacja między dwoma instancjami TIMEFLOW działającymi w tej samej sieci lokalnej (LAN/Wi-Fi) **bez serwera pośredniego**. Obie maszyny mają po zakończeniu sync identyczną bazę zawierającą wpisy z obu urządzeń.

Scenariusz: dwa komputery (np. stacjonarny + laptop) — po uruchomieniu TIMEFLOW, użytkownik widzi powiadomienie „znaleziono TIMEFLOW na [nazwa-maszyny]" i jednym kliknięciem synchronizuje dane.

---

## 2. Stan obecny — co już istnieje

### 2.1 Infrastruktura danych (gotowa do ponownego użycia)

| Komponent | Plik | Uwaga |
|---|---|---|
| Delta export | `commands/delta_export.rs` | Buduje `DeltaArchive` z SHA256 per tabela, zmiany od `since` |
| Delta import | `commands/import_data.rs` | `import_data_archive` — merge z konflikt-resolucją |
| Tombstones | `db_migrations/m12_delta_sync.rs` | Rekordy usunięte śledzone per tabela |
| Table hashes | `delta_export.rs::TableHashes` | SHA256 po `id|updated_at`, deterministyczny |
| Sync log | `commands/sync_log.rs` | Append/rotate 2 MB |
| Online sync runner | `src/lib/sync/sync-runner.ts` | Logika push/pull/ack — można zreplikować dla LAN |
| Import TS wrapper | `src/lib/tauri/` | `importDataArchive()` wywołuje Rust command |

### 2.2 Czego brakuje

- Mechanizm **discovery** (znajdowanie peerów w sieci)
- Embedded **HTTP server** w procesie dashboard (do obsługi żądań od peera)
- **Daemon → Dashboard** notyfikacja o znalezieniu peera
- **UI**: powiadomienie, panel LAN sync w Settings
- **Rust commands** do zarządzania LAN sync (start server, list peers, trigger sync)

---

## 3. Architektura

```
  Maszyna A                                        Maszyna B
  ─────────────────────────────────────────────────────────────

  ┌─────────────────┐   UDP broadcast :47892   ┌───────────────┐
  │  demon-A        │◄────────────────────────►│  demon-B      │
  │  (discovery)    │      beacon co 30s        │  (discovery)  │
  └────────┬────────┘                           └───────┬───────┘
           │ zapisuje                                   │ zapisuje
           ▼                                           ▼
  %APPDATA%/TimeFlow/                         %APPDATA%/TimeFlow/
  lan_peers.json                              lan_peers.json

           │ polling / fs-watch                        │
           ▼                                           ▼
  ┌──────────────────────────────┐   ┌──────────────────────────────┐
  │  Dashboard A                 │   │  Dashboard B                 │
  │  (Tauri/Rust backend)        │   │  (Tauri/Rust backend)        │
  │                              │   │                              │
  │  LAN HTTP Server :47891      │◄──┤  run_lan_sync()              │
  │  POST /lan/pull              │   │    │                         │
  │  POST /lan/push              │───►│  import_data_archive()      │
  │  GET  /lan/ping              │   │                              │
  │                              │   │                              │
  │  build_delta_archive()       │   │  build_delta_archive()       │
  │  import_data_archive()       │   │  import_data_archive()       │
  └──────────────────────────────┘   └──────────────────────────────┘

  Demon = discovery + sygnalizacja obecności (always-on)
  Dashboard = sync server + klient HTTP (tylko gdy dashboard otwarty)
  Sync działa tylko gdy oba dashboardy są uruchomione.
```

---

## 4. Discovery — protokół rozgłaszania

### 4.1 Gdzie zaimplementować

**Tylko w demonie.** Demon działa zawsze w tle (systemowy tray), więc discovery jest aktywne niezależnie od tego czy dashboard jest otwarty. Gdy demon nie działa → brak discovery → LAN sync niedostępny (co jest akceptowalne, bo demon jest wymagany do normalnego działania TIMEFLOW).

### 4.2 Protokół UDP broadcast

Port: **47892** (UDP)
Adres: `255.255.255.255` (broadcast) lub `224.0.0.251` (multicast mDNS-like)

**Beacon packet** (JSON, wysyłany co 30s):
```json
{
  "type": "timeflow_beacon",
  "version": 1,
  "device_id": "abc123",
  "machine_name": "DESKTOP-XYZ",
  "dashboard_port": 47891,
  "dashboard_running": true,
  "timeflow_version": "0.1.539"
}
```

**Discovery packet** (wysyłany przy starcie, oczekuje na beacon response):
```json
{
  "type": "timeflow_discover",
  "version": 1,
  "device_id": "abc123"
}
```

### 4.3 Implementacja w demonie (Rust)

Nowy moduł: `src/lan_discovery.rs`

Demon używa raw `std::net::UdpSocket` (std lib) — **zero nowych zależności**. Architektura zgodna z istniejącym wzorcem demona: osobny `std::thread` kontrolowany przez `Arc<AtomicBool>` (taki sam jak `tracker::start()` i `foreground_hook::start()`).

```rust
// Pseudokod struktury
pub struct LanDiscovery {
    device_id: String,
    machine_name: String,
    dashboard_port: u16,
    peer_file_path: PathBuf,   // %APPDATA%/TimeFlow/lan_peers.json
}

pub struct PeerInfo {
    device_id: String,
    machine_name: String,
    ip: String,
    dashboard_port: u16,
    last_seen: String,         // ISO timestamp (chrono — już w Cargo.toml)
    dashboard_running: bool,
}

// Uruchamianie — w main.rs analogicznie do tracker::start()
pub fn start(stop_signal: Arc<AtomicBool>) -> JoinHandle<()>
```

**Przepływ wątku:**

1. Bind `UdpSocket` na `0.0.0.0:47892`, `set_broadcast(true)`, receive timeout 1s
2. Loop:
   - Co 30s wysyła beacon na `255.255.255.255:47892`
   - Odczytuje pakiety w pętli (timeout 1s, nieblokujące)
   - Filtruje własne pakiety (porównuje `device_id`)
   - Aktualizuje mapę peerów, usuwa niewidzianych > 120s
   - Zapisuje `lan_peers.json` przy każdej zmianie
   - Sprawdza `stop_signal.load(Ordering::SeqCst)` → exit

**Device ID**: `COMPUTERNAME` env var + skrót MAC adresu lub losowy UUID zapisany raz do `%APPDATA%/TimeFlow/device_id.txt` (ten sam co dashboard używa — TODO: ujednolicić z `sync-storage.ts`).

**Dashboard czyta `lan_peers.json`** — polling co 5s przez Tauri command `get_lan_peers()`.

### 4.4 Komunikacja demon → dashboard

Plik: `%APPDATA%/TimeFlow/lan_peers.json`
```json
{
  "updated_at": "2026-03-28T10:00:00Z",
  "peers": [
    {
      "device_id": "peer-device-id",
      "machine_name": "LAPTOP-ABC",
      "ip": "192.168.1.42",
      "dashboard_port": 47891,
      "last_seen": "2026-03-28T10:00:00Z",
      "dashboard_running": true
    }
  ]
}
```

Dashboard polling: nowy Tauri command `get_lan_peers()` czyta ten plik.
Alternatywnie: daemon zapisuje plik → filesystem watcher w Tauri (tauri-plugin-fs watch).

---

## 5. Sync Server (embedded HTTP w dashboard)

### 5.1 Stos techniczny

**Opcja A: `tiny_http`** — minimalna zależność (~50 KB), brak async
**Opcja B: `axum` + tokio** — duże, ale tokio już jest w Cargo.toml
**Opcja C: raw `TcpListener`** — std lib, bez zależności, wystarczy dla 2 endpointów

**Decyzja: Opcja C** — raw TcpListener z HTTP/1.1 ręcznym parserem. Zero nowych zależności. Tylko 2 endpointy, prosty JSON in/out.

Alternatywnie: `warp` lub `axum` jeśli tokio już jest — dodaje ~3 MB do binary.

### 5.2 Endpointy serwera

```
GET  /lan/ping
     → { "ok": true, "version": "0.1.539", "device_id": "...", "machine_name": "..." }

POST /lan/status
     Body: { "device_id": "...", "table_hashes": { projects, apps, sessions, manual_sessions } }
     → { "needs_push": bool, "needs_pull": bool, "their_hashes": TableHashes }

POST /lan/pull
     Body: { "device_id": "...", "since": "ISO timestamp" }
     → DeltaArchive (JSON)

POST /lan/push
     Body: DeltaArchive
     → { "ok": true, "imported": ImportSummary }
```

### 5.3 Inicjalizacja serwera

Nowy Rust command: `start_lan_server(port: u16)` — uruchamia server w osobnym thread.
Wywoływany z frontendu przy starcie dashboard gdy LAN sync włączony.

Port domyślny: **47891** (konfigurowalny w ustawieniach).

---

## 6. Protokół synchronizacji (client-to-client)

### 6.1 Inicjator (strona wywołująca sync)

```
1. GET http://[peer_ip]:47891/lan/ping
   → weryfikacja że peer jest TIMEFLOW i odpowiada

2. POST http://[peer_ip]:47891/lan/status
   Body: { device_id, table_hashes: build_table_hashes_only() }
   → { needs_push, needs_pull, their_hashes }

3a. Jeśli needs_push (mamy nowsze dane):
    Build delta od `last_lan_sync_at` (lub epoch 0 jeśli pierwsze sync)
    POST http://[peer_ip]:47891/lan/push { delta_archive }

3b. Jeśli needs_pull (peer ma nowsze dane):
    POST http://[peer_ip]:47891/lan/pull { since: last_lan_sync_at }
    → DeltaArchive → import_data_archive()

4. Jeśli needs_push AND needs_pull:
   Najpierw pull → import → potem push zaktualizowanego delta
   (kolejność: merge obcego najpierw, potem wyślij aktualne)

5. Zapisz last_lan_sync_at = now, peer_device_id
```

### 6.2 Merge logic (istniejący `import_data_archive`)

Istniejąca funkcja `import_data_archive` już implementuje:
- Merge projektów (upsert po `id`)
- Merge sesji (upsert po `id`, unique constraint `app_id + start_time`)
- Tombstones (usuwanie rekordów oznaczonych jako deleted)
- Conflict resolution: `updated_at` timestamp wins

**Nie trzeba zmieniać logiki merge** — ta sama co online sync.

### 6.3 Stan synchronizacji LAN

Nowy klucz localStorage: `timeflow.settings.lan-sync`
```typescript
interface LanSyncSettings {
  enabled: boolean;
  serverPort: number;            // default: 47891
  autoSyncOnPeerFound: boolean;  // automatycznie sync gdy peer się pojawia
}

interface LanSyncState {
  peers: LanPeer[];
  lastSyncAt: string | null;     // ISO timestamp ostatniego sync
  lastSyncPeerId: string | null;
}

interface LanPeer {
  deviceId: string;
  machineName: string;
  ip: string;
  port: number;
  lastSeen: string;
  dashboardRunning: boolean;
}
```

---

## 7. Nowe Tauri commands (Rust)

| Command | Opis |
|---|---|
| `start_lan_server(port)` | Uruchamia embedded HTTP server |
| `stop_lan_server()` | Zatrzymuje server |
| `get_lan_server_status()` | Czy działa, na którym porcie |
| `get_lan_peers()` | Czyta `lan_peers.json` (plik od demona) |
| `run_lan_sync(peer_ip, peer_port, since)` | Wykonuje pełny sync z peerem |
| `build_table_hashes()` | Tylko hasze tabel (bez danych, do statusu) |

`run_lan_sync` wywołuje istniejące:
- `build_delta_archive(since)` — eksport delta
- `import_data_archive(archive)` — import od peera

---

## 8. Nowe komponenty UI

### 8.1 LanSyncCard (Settings)

Nowy komponent w `components/settings/LanSyncCard.tsx`:
- Toggle "Synchronizacja LAN"
- Port serwera (input, default 47891)
- Toggle "Automatyczna synchronizacja po znalezieniu peera"
- Lista wykrytych urządzeń z przyciskiem "Synchronizuj"
- Status ostatniej synchronizacji

### 8.2 LanPeerNotification (TopBar lub overlay)

Gdy peer pojawi się w sieci → małe powiadomienie inline (nie toast systemowy):
```
⬡ Znaleziono TIMEFLOW na LAPTOP-ABC  [Synchronizuj]  [Zignoruj]
```

### 8.3 LanSyncStatus (BackgroundServices)

Rozszerzenie `BackgroundServices.tsx` o LAN sync orchestrator:
- Polling `get_lan_peers()` co 5s
- Auto-sync gdy `autoSyncOnPeerFound = true` i peer ma `dashboardRunning = true`

---

## 9. Zmiany w demonie (timeflow-demon v0.3)

Nowy moduł: `src/lan_discovery.rs`

**Nowe zależności Cargo.toml demona:**
```toml
# Opcja bez nowych zależności: raw std::net::UdpSocket (already in std)
# Opcja z mDNS: mdns-sd = "0.10"  (jeśli chcemy proper mDNS)
```

**Preferowane: raw UDP broadcast** — bez nowych zależności, std::net::UdpSocket.

**Nowy wątek w `main.rs`:**
```rust
let discovery = LanDiscovery::new(device_id, machine_name, dashboard_port);
std::thread::spawn(move || discovery.run());
```

**`run()` loop:**
1. Bind UDP socket na 0.0.0.0:47892
2. SO_BROADCAST = true
3. Set receive timeout = 1s
4. Loop:
   - Wyślij beacon co 30s
   - Odbierz pakiety → filtruj type=timeflow_beacon → zapisz/aktualizuj peers
   - Usuń peers niewidzianych > 120s
   - Zapisz `lan_peers.json`

---

## 10. Bezpieczeństwo

### 10.1 Brak uwierzytelnienia (MVP)

W pierwszej wersji: brak auth na LAN HTTP serverze. Uzasadnienie:
- LAN sync działa tylko w sieci lokalnej
- Użytkownik musi manualnie włączyć funkcję
- Dane nie zawierają wrażliwych informacji (tylko wpisy czasu)

### 10.2 Opcjonalnie (v2): shared secret

Ustawienie: `lan_sync_secret` — prosty shared token wpisywany na obu maszynach.
Nagłówek HTTP: `X-LAN-Sync-Token: <sha256(secret)>`

### 10.3 Tauri CSP

Obecny CSP pozwala tylko na `https://cfabserver-production.up.railway.app`.
Wymagana zmiana w `tauri.conf.json`:
```json
"connect-src": "'self' https://cfabserver-production.up.railway.app http://192.168.*.*:47891"
```

**Uwaga:** CSP w Tauri dotyczy WebView (frontend → fetch). Embedded HTTP server w Rust backend nie przechodzi przez WebView, więc Tauri commands (invoke) są OK bez CSP. Tylko jeśli frontend będzie robić `fetch()` bezpośrednio do IP peera, trzeba rozluźnić CSP.

**Rekomendacja:** komunikacja frontend → peer przechodzi przez Tauri command `run_lan_sync()` w Rust. Brak zmiany CSP.

---

## 11. Pliki do stworzenia / zmodyfikowania

### Demon (`src/`)
| Plik | Akcja | Opis |
|---|---|---|
| `src/lan_discovery.rs` | **Nowy** | UDP broadcast discovery loop |
| `src/main.rs` | Modyfikacja | Uruchomienie `LanDiscovery` thread |
| `Cargo.toml` | Bez zmian | raw std::net::UdpSocket, brak nowych deps |

### Dashboard backend (`dashboard/src-tauri/src/`)
| Plik | Akcja | Opis |
|---|---|---|
| `commands/lan_server.rs` | **Nowy** | Embedded HTTP server (TcpListener) + endpointy |
| `commands/lan_sync.rs` | **Nowy** | `run_lan_sync`, `get_lan_peers`, `build_table_hashes` |
| `commands/mod.rs` | Modyfikacja | Eksport nowych modułów |
| `lib.rs` | Modyfikacja | Rejestracja nowych commands w invoke_handler |

### Dashboard frontend (`dashboard/src/`)
| Plik | Akcja | Opis |
|---|---|---|
| `lib/lan-sync-types.ts` | **Nowy** | Typy LanSyncSettings, LanPeer, LanSyncState |
| `lib/lan-sync.ts` | **Nowy** | Load/save settings, run sync wrapper |
| `lib/tauri/lanSyncApi.ts` | **Nowy** | Tauri invoke wrappers |
| `components/settings/LanSyncCard.tsx` | **Nowy** | UI konfiguracji LAN sync |
| `components/sync/LanPeerNotification.tsx` | **Nowy** | Inline powiadomienie o peerze |
| `components/sync/BackgroundServices.tsx` | Modyfikacja | Dodanie LAN sync orchestratora |
| `pages/Settings.tsx` | Modyfikacja | Dodanie `<LanSyncCard />` |
| `pages/Help.tsx` | Modyfikacja | Sekcja LAN sync |

---

## 12. Plan implementacji (fazy)

### Faza 1 — Discovery (demon) ⏱ ~1 dzień
- `lan_discovery.rs` w demonie: UDP broadcast, zapis `lan_peers.json`
- Testowanie: uruchomić demon na 2 maszynach, sprawdzić czy plik powstaje

### Faza 2 — HTTP Server (dashboard backend) ⏱ ~1-2 dni
- `lan_server.rs`: TcpListener na porcie 47891, obsługa `/lan/ping`, `/lan/pull`, `/lan/push`
- `lan_sync.rs`: `get_lan_peers()`, `run_lan_sync()`
- Rejestracja commands w `lib.rs`

### Faza 3 — UI podstawowe ⏱ ~1 dzień
- `LanSyncCard.tsx`: toggle, port, lista peerów, przycisk sync
- `get_lan_peers()` polling w BackgroundServices
- Wpięcie do Settings.tsx

### Faza 4 — Automatyzacja ⏱ ~0.5 dnia
- `LanPeerNotification.tsx`: powiadomienie inline
- Auto-sync przy `autoSyncOnPeerFound = true`
- Zapis/odczyt `LanSyncState` z localStorage

### Faza 5 — Help + polish ⏱ ~0.5 dnia
- Aktualizacja `Help.tsx`
- Status indicator w TopBar
- Testy manualne: sync dwukierunkowy, konflikty, peer znika

---

## 13. Pytania otwarte

1. **Port konflikty**: co jeśli port 47891 jest zajęty? → fallback do 47892, 47893, lub user konfiguruje.
2. **Wiele instancji**: czy sync działa gdy demon nie działa (tylko dashboard)? → dashboard musi też broadcastować/nasłuchiwać.
3. **Demon vs dashboard discovery**: jeśli demon jest wyłączony, discovery spada na dashboard. Czy to wymagane w MVP?
4. **Format UUID vs integer ID**: sesje używają `id INTEGER`. Czy przy merge z 2 urządzeń może być kolizja ID? → sprawdzić logikę `import_data_archive`.
5. **Co synchronizujemy**: tylko sesje i projekty, czy też aplikacje, ustawienia? → analogicznie do online sync (projekty + sesje + manual_sessions + applications + tombstones).

---

## 14. Diagram przepływu — pełny sync

```
Maszyna A (inicjator)           Maszyna B (serwer LAN)
─────────────────────           ──────────────────────

[User klika "Synchronizuj"]

GET /lan/ping ──────────────────► zwróć { ok, version, device_id }

POST /lan/status ───────────────►
  { device_id, table_hashes_A }
                  ◄───────────── { needs_push=true, needs_pull=true, hashes_B }

(Oba mają nowe dane)

POST /lan/pull ─────────────────►
  { since: A.last_lan_sync_at }
                  ◄───────────── DeltaArchive_B (zmiany od last_sync)

import_data_archive(DeltaArchive_B)  // merge danych B do A

build_delta_archive(since: A.last_lan_sync_at) → DeltaArchive_A

POST /lan/push ─────────────────►
  DeltaArchive_A
                  import_data_archive(DeltaArchive_A)  // merge A do B
                  ◄───────────── { ok: true, imported: { sessions: 42 } }

Zapisz last_lan_sync_at = now (obie strony)
```

---

## 15. Analogia z istniejącym online sync

| Online Sync | LAN Sync |
|---|---|
| Server URL (Railway) | IP:port peera (LAN HTTP server) |
| Bearer token | Brak (MVP) / shared secret (v2) |
| `/api/sync/status` | `POST /lan/status` |
| `/api/sync/delta-push` | `POST /lan/push` |
| `/api/sync/delta-pull` | `POST /lan/pull` |
| `build_delta_archive()` | Ta sama funkcja |
| `import_data_archive()` | Ta sama funkcja |
| Serwer przechowuje snapshot | Brak snapshotu — peer-to-peer |
| `serverRevision` tracking | `last_lan_sync_at` timestamp |

Kluczowa różnica: online sync jest asymetryczny (serwer jako arbiter revision). LAN sync jest symetryczny (peer-to-peer, oba pull + push).
