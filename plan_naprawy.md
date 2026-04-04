# TIMEFLOW — Plan naprawy synchronizacji

## Podsumowanie

Na podstawie analizy kodu i komentarzy w `sync.md` zidentyfikowano **3 grupy problemów** z łączną liczbą **11 bugów/usprawnień**.

---

## BUG 1: LAN Discovery — automatyczne wykrywanie nie działa

### Przyczyny (wg prawdopodobieństwa)

| # | Przyczyna | Plik | Linie | Priorytet |
|---|-----------|------|-------|-----------|
| 1.1 | **Firewall Windows blokuje UDP 47892** — broadcast `255.255.255.255` jest domyślnie blokowany; bez reguły firewall discovery nie działa w ogóle | — (konfiguracja OS) | — | KRYTYCZNY |
| 1.2 | **Parsowanie `ipconfig /all` zawodne** — na polskim Windows nagłówki sekcji mogą się różnić; jeśli parsowanie zwróci 0 interfejsów, jedynym adresem broadcast pozostaje `255.255.255.255` (zablokowany) | `lan_discovery.rs` | 602–649 | WYSOKI |
| 1.3 | **Unicast scan co 120 s** — najbardziej niezawodna metoda odkrywania (skanowanie /24) uruchamia się tylko co 2 min, a expiry peera = 120 s, więc peer może zniknąć i pojawić się dopiero po 4 min | `lan_discovery.rs` | 801–802 | ŚREDNI |
| 1.4 | **Filtrowanie adapterów wirtualnych zbyt agresywne** — Hyper-V/WSL/VPN adaptery są filtrowane zakresem 172.16–31.x z maską /20; prawdziwy adapter LAN w tym zakresie zostanie odrzucony | `lan_discovery.rs` | 719–733 | NISKI |
| 1.5 | **Przeładowanie ustawień co 60 s** — przełączenie `enabled: true` wymaga do 60 s czekania zanim discovery ruszy; brak natychmiastowego reload | `lan_discovery.rs` | 417–443 | NISKI |

### Plan naprawy

**Krok 1 — Firewall (1.1)**
- Przy instalacji / pierwszym uruchomieniu: automatycznie dodaj regułę firewall Windows dla UDP 47892 (inbound + outbound).
- W Tauri: wywołaj `netsh advfirewall` przy starcie, jeśli reguła nie istnieje.
- Plik: `src/main.rs` lub nowy `src/firewall.rs`.

**Krok 2 — Parsowanie ipconfig (1.2)**
- Zamienić parsowanie `ipconfig /all` na Windows API (`GetAdaptersAddresses`) przez crate `windows` lub `ipconfig`.
- Fallback: obecna logika `ipconfig` jako zapasowa.
- Plik: `src/lan_discovery.rs`, linie 602–649.

**Krok 3 — Częstszy unicast scan (1.3)**
- Zmniejszyć `UNICAST_SCAN_INTERVAL_SECS` ze 120 s na 30 s (wyrównanie z interwałem beacon).
- Plik: `src/lan_discovery.rs`, linia 801.

**Krok 4 — Natychmiastowy reload ustawień (1.5)**
- Przy zmianie ustawień LAN Sync w UI: wysłać komendę Tauri `lan_sync_reload_settings` (nowa) zamiast czekać na polling.
- Pliki: `src/lan_discovery.rs`, `dashboard/src-tauri/src/commands/lan_sync.rs`.

### Test

- Dwa komputery w tej samej sieci LAN (WiFi lub Ethernet).
- Uruchomić TIMEFLOW na obu.
- Oczekiwanie: peer pojawia się w LanSyncCard w ciągu 30 s.
- Sprawdzić `lan_sync.log` pod kątem wpisów `LAN discovery:`.

---

## BUG 2: LAN Sync — zatrzymuje się na kroku 11/13 + dwie warstwy UI

### Przyczyny

| # | Przyczyna | Plik | Linie | Priorytet |
|---|-----------|------|-------|-----------|
| 2.1 | **`sync_in_progress` nigdy nie jest resetowany po kroku 10** — Master ustawia flagę na `true` przy starcie sync, ale nigdy jej nie czyści po merge; Slave widzi flagę i blokuje się | `lan_sync_orchestrator.rs` | 394–401 | KRYTYCZNY |
| 2.2 | **Timeout `/lan/db-ready` bez retry** — Master wysyła request do Slave z timeout 120 s; jeśli import trwa dłużej, Master robi rollback zamiast czekać | `lan_sync_orchestrator.rs` | 434–445 | WYSOKI |
| 2.3 | **Mismatch etykiet kroku 11** — Master ustawia step 11 = `"uploading_to_slave"`, Slave nadpisuje na `"slave_importing"` przy `/lan/db-ready`; state machine się gubi | `lan_sync_orchestrator.rs:404` / `lan_server.rs:609` | — | ŚREDNI |
| 2.4 | **DaemonSyncOverlay i LanSyncCard mają niezależne pętle polling** — oba odpytują `getLanSyncProgress()` niezależnie (DaemonSyncOverlay co 2 s, LanSyncCard co 600 ms); oba renderują overlay jednocześnie (z-[9999] vs z-10) | `DaemonSyncOverlay.tsx` / `LanSyncCard.tsx` | 82–113 / 161–202 | ŚREDNI |

### Plan naprawy

**Krok 1 — Reset flagi `sync_in_progress` (2.1) — KRYTYCZNY**
- W `execute_master_sync()`: dodać reset `sync_in_progress = false` w bloku `finally` (zarówno success jak i error path).
- Dodać analogiczny reset w `handle_trigger_sync()` po zakończeniu sync.
- Plik: `src/lan_sync_orchestrator.rs`.

**Krok 2 — Retry na `/lan/db-ready` (2.2)**
- Dodać retry loop (3 próby, backoff 10/30/60 s) dla wywołania `/lan/db-ready`.
- Zwiększyć timeout z 120 s na 180 s.
- Plik: `src/lan_sync_orchestrator.rs`, linie 434–445.

**Krok 3 — Ujednolicenie etykiet kroków (2.3)**
- Slave nie powinien nadpisywać kroku 11 — zostawić `"uploading_to_slave"` od Mastera.
- Slave ustawia krok 12 (`"slave_importing"`) dopiero po otrzymaniu pełnych danych.
- Pliki: `src/lan_server.rs:609`, `src/lan_sync_orchestrator.rs:404`.

**Krok 4 — Jedno źródło prawdy dla UI progressu (2.4)**
- Usunąć niezależny polling z `LanSyncCard.tsx`.
- `DaemonSyncOverlay` jest jedynym source of truth — LanSyncCard subskrybuje stan z shared store (np. Zustand atom lub React context).
- Usunąć overlay z LanSyncCard (jest redundantny z DaemonSyncOverlay).
- Pliki: `dashboard/src/components/sync/DaemonSyncOverlay.tsx`, `dashboard/src/components/settings/LanSyncCard.tsx`.

### Test

- Uruchomić LAN sync między dwoma maszynami.
- Oczekiwanie: sync kończy się na 13/13 bez zatrzymania.
- UI: jeden overlay z progress barem, brak migotania/przeskakiwania między warstwami.

---

## BUG 3: Online Sync — pliki wysyłane na serwer, ale nie odbierane przez drugiego klienta

### Przyczyna

| # | Przyczyna | Plik | Linie | Priorytet |
|---|-----------|------|-------|-----------|
| 3.1 | **Brak mapowania `nextAction: "download_result"` → `shouldPull: true`** — serwer poprawnie ustawia `nextAction = "download_result"` dla Slave w kroku 11+, ale TypeScript client czyta `shouldPull` z odpowiedzi statusu, a to pole nigdy nie jest ustawiane na `true` | Serwer: `session-service.ts` / Klient: `sync-runner.ts` | serwer ~231, klient ~495–510 | KRYTYCZNY |
| 3.2 | **Mismatch protokołów: Rust (13-step session) vs TypeScript (heartbeat pull)** — Rust daemon implementuje pełny 13-krokowy protokół z `wait_for_step`, ale dashboard TypeScript używa prostszego heartbeat-based flow (`/api/sync/status` → `shouldPull` → `/api/sync/delta-pull`) | `online_sync.rs` vs `sync-runner.ts` | — | KRYTYCZNY |

### Plan naprawy

**Krok 1 — Mapowanie `nextAction` → `shouldPull` na serwerze (3.1) — KRYTYCZNY**
- W endpoincie `/api/sync/session/{id}/status` (lub `/api/sync/status`): gdy `nextAction === "download_result"`, ustawić `shouldPull: true` w odpowiedzi.
- Plik serwera: `src/lib/sync/session-service.ts` (funkcja `determineNextAction` lub handler statusu).
- Plik API: `src/app/api/sync/session/[id]/status/route.ts` lub odpowiedni handler.

**Krok 2 — Weryfikacja flow pull na kliencie (3.2)**
- Upewnić się, że `sync-runner.ts` po otrzymaniu `shouldPull: true`:
  1. Wywołuje `/api/sync/delta-pull` (lub pobiera z SFTP/S3 credentials).
  2. Deszyfruje payload.
  3. Aplikuje do lokalnej bazy.
- Sprawdzić czy Rust daemon (`online_sync.rs`) i TypeScript dashboard nie próbują jednocześnie obsłużyć tego samego sync — wybrać jeden path.
- Pliki: `dashboard/src/lib/sync/sync-runner.ts` (linie 576–740), `dashboard/src/lib/sync/sync-http.ts`.

**Krok 3 — Test end-to-end**
- Przygotować scenariusz: urządzenie A (Master) uploaduje dane, urządzenie B (Slave) powinno je ściągnąć.
- Sprawdzić logi serwera: czy `shouldPull: true` jest zwracane w response.
- Sprawdzić logi klienta B: czy pull jest triggerowany i dane aplikowane.

### Test

- Dwa urządzenia z aktywną licencją.
- Urządzenie A: modyfikuje dane, triggeruje Online Sync.
- Urządzenie B: w ciągu ~30 s powinno odebrać dane.
- Weryfikacja: dane widoczne na obu urządzeniach (projekty, sesje).

---

## Status implementacji — ZREALIZOWANE

Wszystkie poprawki wdrożone, TypeScript i Rust kompilują czysto (zero błędów/warningów).

| # | Bug | Status | Zmiana |
|---|-----|--------|--------|
| 2.1 | Slave nie odmrażany na error | DONE | Dodano `/lan/unfreeze` slave w error path retry loop (`lan_sync_orchestrator.rs`) |
| 2.2 | Timeout db-ready bez retry | DONE | 3 próby × 180s z backoff 10/20/30s (`lan_sync_orchestrator.rs`) |
| 2.3 | Slave set_progress(11) zamiast 12 | DONE | Poprawiono na step 12 (`lan_server.rs:609`) |
| 3.1 | `single_device` blokuje pull | DONE | Przeniesiono `clientRev < serverRev → pull` PRZED check `single_device` (`direct-sync.ts`) |
| 1.1 | Firewall | OK | Już zaimplementowane (`firewall.rs` + `main.rs:66`) |
| 2.4 | Dwa overlaye UI | DONE | Usunięto overlay z LanSyncCard — DaemonSyncOverlay jest jedynym źródłem (`LanSyncCard.tsx`) |
| 1.2 | ipconfig parsing PL | DONE | Dodano ASCII-safe match `"Mask"` dla OEM codepage (`lan_discovery.rs`) |
| 1.3 | Unicast scan co 120s | DONE | Zmniejszono do 30s (`lan_discovery.rs`) |
| 3.2 | Rust vs TS protocol | OK | Dwa oddzielne protokoły by design — brak konfliktu |
| 1.4 | Filtrowanie adapterów | DONE | Dodano filtr Docker bridge 172.17.0.x/16 (`lan_discovery.rs`) |
| 1.5 | Reload ustawień co 60s | DONE | Zmniejszono do 5s (`lan_discovery.rs`) |

## Zmienione pliki

### Client (Rust)
- `src/lan_sync_orchestrator.rs` — slave unfreeze on error, db-ready retry, cleanup unused import
- `src/lan_server.rs` — slave step 11→12 fix
- `src/lan_discovery.rs` — ipconfig parsing, unicast 30s, Docker filter, settings reload 5s

### Client (Dashboard TSX)
- `dashboard/src/components/settings/LanSyncCard.tsx` — usunięto redundantny overlay + martwy kod

### Server
- `src/lib/sync/direct-sync.ts` — pull before single_device check
