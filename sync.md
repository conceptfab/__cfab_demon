# TIMEFLOW — Synchronizacja (LAN & Online)

## Spis treści
1. [LAN Sync](#lan-sync)
2. [Online Sync](#online-sync)
3. [Wspólne elementy](#wspólne-elementy)
4. [Porównanie](#porównanie)

---

## LAN Sync

### Odkrywanie peerów (Discovery) - automatyczne wykrywanie nie działa!

- **Protokół**: UDP broadcast na porcie **47892**
- **Beacon** wysyłany co **30 s** — zawiera: `device_id`, `machine_name`, `role`, `uptime`, `sync_marker_hash`, status dashboardu
- **Pakiety**: `timeflow_beacon` (ogłoszenie) i `timeflow_discover` (zapytanie)
- **Probe**: przy starcie daemon natychmiast pinguje poprzednio znane IP (szybkie ponowne wykrywanie)
- **Subnet scan**: opcjonalnie skanuje cały /24 unicast
- **Expiry**: peer usuwany po **120 s** bez beaconu
- **Persystencja**: `/lan_peers.json`

### Identyfikacja urządzenia

- `device_id` w `%APPDATA%/TimeFlow/device_id.txt`
- Format: `{machine_name}-{timestamp_hex}-{pid_hex}`
- Fallback: zmienna `COMPUTERNAME`

### Elekcja ról (Master / Slave)

1. **Wymuszona rola** — ustawienie `forcedRole`: `"master"` / `"slave"` / `"auto"`
2. **Okno startuowe (5 s)** — 3 burst-y discover (0 s, 1 s, 2 s)
3. **Wykrycie istniejącego mastera** → urządzenie staje się Slave
4. **Brak mastera** → wygrywa najdłuższy `uptime_secs` (cap 30 dni); przy remisie — leksykograficzne porównanie `device_id`

### Protokół synchronizacji — 13 kroków (state machine) - nie działa, na kliencie zatrzumuje się na 11/13, w dodaktu wuidac ze w UI sa dwie warstwy komunikacji o tym procesie - jedna zasłania drugą!

| Krok | Faza | Opis |
|------|------|------|
| 1 | Start | Master inicjuje sync |
| 3 | Negocjacja | Master wysyła `device_id` + `marker_hash` do Slave'a |
| 4 | Tryb | Delta (markery zgodne) lub Full (różne) |
| 5 | Zamrożenie | Obie bazy danych zamrożone (zapis wstrzymany) | - 
| 6 | Pull | Master pobiera dane od Slave'a (z progress) |
| 7 | Odbiór | Dane od Slave'a odebrane |
| 8 | Backup | Master tworzy backup swojej bazy |
| 9 | Merge | Scalenie danych Slave'a (LWW — Last Writer Wins) |
| 10 | Weryfikacja | Sprawdzenie integralności; wygenerowanie nowego markera |
| 11 | Upload | Master wysyła scalone dane do Slave'a |
| 12 | Import Slave | Slave wykonuje merge, blokuje aż zakończy |
| 13 | Odmrożenie | Obie bazy odmrożone |

**Transport**: HTTP/1.1 na porcie **47891**, JSON body.

**Timeouty**:
- Connect / HTTP: 30 s
- DB-ready (merge Slave): 120 s
- Cały sync: 300 s (5 min)

**Retry**: 3 próby, exponential backoff (5 s → 15 s → 45 s)

### Zamrożenie bazy (Freeze)

- Tracker sprawdza `db_frozen` i pomija zapis do DB
- Zbieranie aktywności kontynuowane w pamięci (bufor)
- **Auto-unfreeze**: jeśli zamrożenie > 5 min → automatyczne odmrożenie (safety net)

### Rozwiązywanie konfliktów (LWW)

- **Porównanie timestamps**: `YYYY-MM-DD HH:MM:SS` (bez sub-sekund i timezone)
- `remote_ts > local_ts` → wygrywa remote; równe → wygrywa local
- **Per-tabela**:
  - `projects` — klucz: name; nadpisuje color, hourly_rate, excluded_at, frozen_at (NIE assigned_folder_path — specyficzne dla maszyny)
  - `applications` — klucz: executable_name; nadpisuje display_name
  - `sessions` — rozwiązywane przez mapowanie app_id (remote → local)
  - `manual_sessions` — klucz: title
- **Tombstones**: soft-delete
- **Log**: tabela `sync_merge_log` + plik `/lan_sync.log` (rotating, max 100 KB)

### Sync Marker

- Hash: **FNV-1a 64-bit**
- `marker = hash(tables_hash + timestamp + device_id)`
- Tabela `sync_markers`: `marker_hash` (PK), `created_at`, `device_id`, `peer_id`, `tables_hash`, `full_sync`
- Porównanie: identyczny marker → Delta, różny → Full

### UI (Dashboard)

- **LanSyncCard** — lista peerów, przyciski Delta/Full/Force, progress bar (step n/13 + bytes)
- **LanPeerNotification** — powiadomienie o nowym peerze (co 5 s), auto-sync jeśli włączony
- **Polling**: co 600 ms (podczas sync), co 3 s (idle)
- **Ustawienia**: enable/disable, auto-sync, interwał (0/4/8/12/24/48 h), wymuszona rola

### Endpointy HTTP (daemon)

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/lan/ping` | GET | Heartbeat + wersja + rola |
| `/lan/sync-progress` | GET | Snapshot postępu |
| `/lan/negotiate` | POST | Negocjacja delta/full |
| `/lan/freeze-ack` | POST | Zamrożenie bazy Slave |
| `/lan/upload-db` | POST | Wysyłka scalonych danych do Slave |
| `/lan/db-ready` | POST | Trigger merge na Slave (blokuje) |
| `/lan/unfreeze` | POST | Odmrożenie Slave |
| `/lan/trigger-sync` | POST | Dashboard → Daemon: start sync |

---

## Online Sync

### Autentykacja

- **Bearer Token** — `Authorization: Bearer {token}`
- Tokeny w mapie `SYNC_API_TOKENS` (userId → token)
- **Timing-safe comparison** (ochrona przed timing attacks)
- Fallback dev: `SYNC_ALLOW_INSECURE_DEV_USERID_FALLBACK`

### Rejestracja urządzeń i licencje

| Plan | Max urządzeń | Max DB | Min interwał sync |
|------|-------------|--------|-------------------|
| Free | 2 | 50 MB | 24 h |
| Starter | 5 | 200 MB | 8 h |
| Pro | 20 | 1024 MB | 1 h |
| Enterprise | 9999 | 10240 MB | 15 min |

**Walidacja**: status licencji (`active`/`trial`), expiry, limit urządzeń, częstotliwość sync, rozmiar DB.

### Sesja synchronizacji - pliki są tylko wysyłane na serwer, nie są odbierane przez drugiego klienta! Testy przechodzą, ale to nie działa!

**Stany sesji**: `awaiting_peer → negotiating → in_progress → completed / failed / expired / cancelled`

**TTL**: 30 min (przedłużany heartbeatami co 10 s, +2 min za każdy heartbeat)

**Tworzenie sesji** (`POST /api/sync/session/create`):
1. **Pierwsze urządzenie (Master)**: tworzy sesję → `status: "awaiting_peer"`
2. **Drugie urządzenie (Slave)**: dołącza atomowo → porównanie markerów → tryb delta/full → `status: "negotiating"` → provisionowanie storage → zaszyfrowane credentials zwrócone

**Rola Master**: pierwsze urządzenie LUB urządzenie z `fixedMasterDeviceId` w grupie.

### Szyfrowanie (dwupoziomowe)

1. **Credential Encryption** (AES-256-GCM):
   - Klucz: `HMAC-SHA256(masterKey=SYNC_ENCRYPTION_KEY, sessionId)`
   - IV: random 96-bit
   - Zwraca: `{encryptedPayload, iv, tag}` (base64)

2. **File Encryption Key**:
   - `HMAC-SHA256(SYNC_ENCRYPTION_KEY, sessionId, "file-encryption")`
   - Dane szyfrowane przed uploadem do storage

### Storage backend

**Obsługiwane typy**:
- **SFTP** (SSH2) — katalogi, upload/download, health check
- **FTP/FTPS** — stream-based, ensureDir()
- **AWS S3** — key prefixes, batch delete, presigned URLs

**Layout**:
```
basePath/
  {sessionId}/
    slave-upload/        ← slave uploaduje tutaj
    master-merged/       ← master umieszcza wyniki
```

**Rozwiązanie backendu**: per-grupa (`ClientGroup.storageBackendId`) → fallback na globalny SFTP (env vars)

### Protokół synchronizacji — 13 kroków

| Krok | Master | Slave |
|------|--------|-------|
| 1 | Tworzy sesję | — |
| 2 | — | Dołącza do sesji, tryb ustalony |
| 3 | Czeka na storage | — |
| 4 | — | Deszyfruje credentials storage |
| 5 | Generuje delta/full (serializacja) | — |
| 6 | Szyfruje payload | — |
| 7 | Upload do SFTP/S3 | — |
| 8 | — | Download z SFTP/S3 |
| 9 | — | Deszyfruje + waliduje hash |
| 10 | — | Aplikuje do lokalnej bazy |
| 11 | Zapisuje metadata merge | — |
| 12 | Raportuje completion + marker | Raportuje final state + marker |
| 13 | Potwierdza zakończenie | Potwierdza zakończenie |

**Polling**: `GET /api/sync/session/{id}/status?deviceId=X` co ~3 s z heartbeatem

**Retry**: 3 próby, exponential backoff (5 s → 15 s → 45 s)

### Async Delta Packages (store-and-forward)

Dla synchronizacji grupowej gdy urządzenia offline.

- **Push** (`POST /api/sync/async/push`): rejestruje paczkę, tworzy katalog na storage, zwraca zaszyfrowane credentials
- **Pending** (`POST /api/sync/async/pending`): lista paczek czekających dla grupy (bez bieżącego urządzenia)
- **Ack** (`POST /api/sync/async/ack`): potwierdza dostarczenie, czyści storage
- **Reject** (`POST /api/sync/async/reject`): niezgodność markerów, czyści storage
- **Credentials** (`GET /api/sync/async/credentials/{packageId}`): ponowne pobranie credentials
- **TTL paczki**: 72 h
- **Stany**: `pending → delivered / rejected / expired`

### Direct Sync (uproszczony, single-device)

- `POST /api/sync/status` — sprawdza rewizję
- `POST /api/sync/push` — upload archiwum
- `POST /api/sync/pull` — download archiwum
- `POST /api/sync/ack` — potwierdza
- Storage: system plików serwera (`DATA_DIR/online-sync/{userId}/`)
- Bez storage backend

### Cleanup (co 15 min)

1. Oznaczanie wygasłych sesji
2. Usuwanie katalogów SFTP/S3 dla zakończonych sesji
3. Usuwanie starych rekordów sesji (> 24 h)
4. Wykrywanie orphan directories
5. Expiracja async packages (72 h)

### Endpointy API serwera

| Grupa | Endpoint | Metoda | Opis |
|-------|----------|--------|------|
| **Sesje** | `/api/sync/session/create` | POST | Inicjacja sync |
| | `/api/sync/session/{id}/status` | GET | Polling postępu |
| | `/api/sync/session/{id}/report` | POST | Raport kroku |
| | `/api/sync/session/{id}/heartbeat` | POST | Przedłużenie TTL |
| | `/api/sync/session/{id}/cancel` | POST | Anulowanie |
| **Async** | `/api/sync/async/push` | POST | Rejestracja paczki |
| | `/api/sync/async/pending` | POST | Lista oczekujących |
| | `/api/sync/async/ack` | POST | Potwierdzenie |
| | `/api/sync/async/reject` | POST | Odrzucenie |
| | `/api/sync/async/credentials/{id}` | GET | Credentials |
| **Direct** | `/api/sync/status` | POST | Sprawdź rewizję |
| | `/api/sync/push` | POST | Upload |
| | `/api/sync/pull` | POST | Download |
| | `/api/sync/ack` | POST | Potwierdź |
| **Inne** | `/api/sync/devices` | GET | Lista urządzeń |
| | `/api/sync/history` | GET | Historia sync |
| | `/api/sync/health` | GET | Health check storage |

---

## Wspólne elementy

### Sync Marker
- Obie ścieżki używają markera (hash stanu tabel) do decyzji delta vs full
- LAN: FNV-1a 64-bit
- Online: hash przechowywany na serwerze + w bazie lokalnej

### Dane synchronizowane
- `projects` (nazwa, kolor, stawka, wykluczenie, zamrożenie)
- `applications` (executable_name, display_name)
- `sessions` (sesje monitorowane)
- `manual_sessions` (sesje ręczne)
- `tombstones` (soft-delete)

### Rozwiązywanie konfliktów
- **LWW (Last Writer Wins)** w obu ścieżkach
- Porównanie timestamp: nowszy wygrywa, przy równości → local wygrywa

### Backup & Recovery
- Pre-merge backup (SQLite VACUUM INTO)
- Max 5 backupów rotacyjnych
- Restore przy niepowodzeniu merge

---

## Porównanie

| Cecha | LAN Sync | Online Sync |
|-------|----------|-------------|
| **Transport** | HTTP bezpośrednio peer-to-peer (port 47891) | Serwer centralny + SFTP/S3 storage |
| **Discovery** | UDP broadcast (port 47892) | Serwer paruje urządzenia po userId |
| **Autentykacja** | Brak (weryfikacja wersji) | Bearer Token + licencja |
| **Szyfrowanie** | Brak (sieć lokalna) | AES-256-GCM (credentials + pliki) |
| **Elekcja Master** | Automatyczna (uptime) lub wymuszona | Pierwsze urządzenie lub fixedMasterDeviceId |
| **Merge** | Master wykonuje merge, wysyła wynik do Slave | Slave pobiera i aplikuje lokalnie |
| **Freeze DB** | Tak (obie strony) | Nie wymagane (serwer pośredniczy) |
| **Tryb offline** | Nie dotyczy | Async Delta Packages (store-and-forward, TTL 72h) |
| **Licencjonowanie** | Darmowy (do 2 maszyn) | Płatny (plany: free/starter/pro/enterprise) |
| **Max urządzeń** | 2 (peer-to-peer) | Do 9999 (enterprise) |
| **Retry** | 3x, backoff 5/15/45 s | 3x, backoff 5/15/45 s |
| **Timeout** | 300 s (cały sync) | 30 min TTL sesji (heartbeat) |
| **Storage** | Brak (bezpośredni transfer) | SFTP / FTP / S3 / filesystem |

---

## Kluczowe pliki

### Client (Rust daemon)
- `src/lan_common.rs` — hashing, device ID, logging
- `src/lan_discovery.rs` — UDP broadcast, elekcja ról
- `src/lan_server.rs` — endpointy HTTP, freeze/unfreeze
- `src/lan_sync_orchestrator.rs` — 13-krokowy state machine LAN
- `src/online_sync.rs` — 13-krokowy state machine Online
- `src/sync_common.rs` — merge, konflikty, backup/restore
- `src/sync_encryption.rs` — deszyfrowanie AES-256-GCM

### Client (Dashboard React/TypeScript)
- `dashboard/src/components/settings/LanSyncCard.tsx` — UI LAN sync
- `dashboard/src/components/settings/OnlineSyncCard.tsx` — UI Online sync
- `dashboard/src/components/sync/LanPeerNotification.tsx` — powiadomienia peer
- `dashboard/src/lib/lan-sync-types.ts` — typy LAN
- `dashboard/src/lib/online-sync-types.ts` — typy Online
- `dashboard/src/lib/sync/sync-runner.ts` — orkiestracja sync
- `dashboard/src/lib/sync/sync-indicator.ts` — wskaźnik statusu
- `dashboard/src-tauri/src/commands/lan_sync.rs` — komendy Tauri

### Server (Next.js)
- `src/lib/auth/server-auth.ts` — autentykacja tokenowa
- `src/lib/sync/session-service.ts` — logika biznesowa sesji
- `src/lib/sync/session-contracts.ts` — kontrakty/typy
- `src/lib/sync/license-contracts.ts` — licencje i plany
- `src/lib/sync/sftp-manager.ts` — adaptery storage
- `src/lib/sync/storage-encryption.ts` — szyfrowanie AES-256-GCM
- `src/lib/sync/async-delta.ts` — store-and-forward
- `src/lib/sync/direct-sync.ts` — uproszczony sync single-device
- `src/lib/sync/session-cleanup.ts` — cleanup co 15 min
- `src/app/api/sync/` — endpointy API
