# TIMEFLOW — Raport analizy synchronizacji

**Data:** 2026-04-04
**Status:** KRYTYCZNE BŁĘDY — synchronizacja nie działa zgodnie z założeniami

---

## Podsumowanie

Przeanalizowano cały stos synchronizacji: daemon Rust (LAN discovery, LAN server, LAN sync orchestrator, online sync, SFTP client, sync_common), komendy Tauri (lan_sync, lan_server, online_sync) oraz frontend React (BackgroundServices, DaemonSyncOverlay, SyncProgressOverlay, LanPeerNotification, LanSyncCard).

Zidentyfikowano **3 błędy krytyczne**, **4 błędy wysokie** i **kilka problemów średnich**.

---

## KRYTYCZNE BŁĘDY

### BUG-1: SLAVE NIE POBIERA SCALONYCH DANYCH W LAN SYNC

**Pliki:** `src/lan_sync_orchestrator.rs`, `src/lan_server.rs`

**Opis:** W protokole 13-krokowym LAN sync, master po scaleniu danych (krok 9-10):
1. Zapisuje scalone dane do `lan_sync_merged.json` (linia 382)
2. Wysyła POST `/lan/db-ready` do slave'a (linia 390)
3. Ustawia progress na "slave_downloading" (krok 12, linia 395)
4. **Natychmiast przechodzi do odmrożenia** (krok 13, linia 399-401)

**Problem:** Slave w `handle_db_ready()` (lan_server.rs:606) **tylko ustawia progress** i zwraca `{ok: true}`. Nikt nigdy nie wywołuje:
- `GET /lan/download-db` (endpoint istnieje w lan_server.rs:384, zwraca dane z `lan_sync_merged.json`)
- Żadnej operacji merge/import na slave'ie po otrzymaniu scalonych danych

**Skutek:** Slave NIGDY nie otrzymuje scalonych danych. Master scalił dane, ale slave nadal ma starą bazę. Po odmrożeniu bazy się rozjeżdżają.

**Porównanie z online sync:** W online_sync.rs slave poprawnie:
1. Czeka na krok 11 (master upload) — linia 1131
2. Pobiera z SFTP — linia 1143-1153
3. Deszyfruje i merguje — linia 1154-1169
4. Tworzy marker — linia 1172-1186

**Fix wymagany:** Po `handle_db_ready()` slave musi:
1. Wywołać wewnętrznie `GET /lan/download-db` (lub pobrać dane inline w db-ready)
2. Wykonać backup
3. Wywołać `sync_common::merge_incoming_data()`
4. Zweryfikować integralność
5. Wstawić nowy sync marker
6. Dopiero potem odpowiedzieć masterowi OK

---

### BUG-2: BRAK BLOKADY UI DASHBOARDU PODCZAS SYNCHRONIZACJI

**Pliki:** `dashboard/src/components/sync/SyncProgressOverlay.tsx`, `dashboard/src/components/sync/DaemonSyncOverlay.tsx`

**Opis:** Wymaganie mówi jasno: "wszystkie operacje na bazach danych mają się odbywać przy zatrzymanym rejestrowaniu nowych wpisów do bazy klientów, **UI ma być zablokowany** i wyświetlać odpowiednie komunikaty."

**Aktualny stan:**
- `SyncProgressOverlay.tsx` renderuje się jako `fixed bottom-20 right-6 z-50 w-80` — mały widget w prawym dolnym rogu
- NIE blokuje interakcji z resztą UI
- Użytkownik może normalnie klikać, nawigować, edytować podczas synchronizacji
- Brak overlay/modal blokującego
- Brak `pointer-events: none` na reszcie aplikacji

**Wymagane:**
- Fullscreen overlay z `pointer-events: none` na reszcie UI
- Komunikat "Synchronizacja w toku — proszę czekać"
- Zablokowanie nawigacji (router)
- Zablokowanie formularzy i przycisków akcji

**Częściowe rozwiązanie w daemon:** `db_frozen` w `LanSyncState` poprawnie blokuje zapis danych z trackera (tracker.rs:604), ale dashboard nie sprawdza tego flagi.

---

### BUG-3: ONLINE SYNC — KLIENT NIE POBIERA PACZKI Z FTP (SCENARIUSZ ASYNC)

**Plik:** `src/online_sync.rs` — `execute_async_pull()` (linia 585)

**Opis:** W trybie async delta:
1. Klient A pushuje deltę na SFTP (linia 491-582) — **to działa** (potwierdzają testy)
2. Klient B sprawdza pending packages (linia 601)
3. Klient B żąda kredencjali SFTP (linia 641)
4. Klient B pobiera z SFTP i deszyfruje (linia 652-660)
5. Klient B merguje (linia 668)

**Potencjalny problem:** Flow async pull wymaga, żeby klient B **aktywnie odpytywał** serwer (`async_pending`). Ten polling nie jest zaimplementowany jako background job w daemon — musi go wyzwolić dashboard lub tray.

**W `BackgroundServices.tsx`** (linia 432-468): `runSync` wywołuje `runOnlineSyncOnce()`, ale to idzie przez stary tryb sesji, NIE przez async delta. Tryb async jest wywoływany tylko przez `handle_online_trigger_sync` w lan_server.rs:772 gdy `sync_mode == "async"`.

**Problem:** Jeśli klient A wyśle deltę, klient B jej nie odbierze, bo:
- Background job w dashboardzie nie obsługuje trybu async
- Jedyny trigger to SSE (BackgroundServices.tsx:668) lub ręczne kliknięcie
- SSE wywołuje `runOnlineSyncOnce()` który NIE uruchamia async pull
- `runOnlineSyncOnce()` (z `lib/online-sync.ts`) prawdopodobnie uruchamia sesyjny sync, nie async

**Fix:** Dashboard `runOnlineSyncOnce` musi triggerować daemon endpoint `/online/trigger-sync`, który poprawnie rozróżnia tryb async vs sesyjny. Albo dodać dedykowany endpoint `/online/trigger-async-pull`.

---

## BŁĘDY WYSOKIE

### BUG-4: DETECT PEERA LAN — FIREWALL WYMAGA ADMIN

**Plik:** `src/firewall.rs`

**Opis:** `ensure_firewall_rules()` (linia 77) próbuje dodać reguły firewall przez `netsh advfirewall`. Wymaga to uprawnień administratora. Jeśli daemon nie jest uruchomiony jako admin:
- Logi pokazują warning (linia 99-101)
- Reguły **NIE są dodawane**
- UDP broadcast na porcie 47892 jest **blokowany przez Windows Firewall**
- Discovery nie działa

**Objaw:** Peery w sieci LAN nie są wykrywane mimo poprawnego kodu discovery.

**Fix:** Jednorazowe uruchomienie demona jako admin, lub instrukcja w UI jak ręcznie dodać reguły.

---

### BUG-5: DUPLIKACJA LOGIKI MERGE

**Pliki:** `src/sync_common.rs::merge_incoming_data()` vs `dashboard/src-tauri/src/commands/lan_sync.rs::import_delta_into_db()`

**Opis:** Istnieją DWIE niezależne implementacje merge:
1. **sync_common.rs** (linia 185-542) — używana przez daemon (LAN orchestrator + online sync)
2. **lan_sync.rs** (linia 392-739, `#[allow(dead_code)]`) — stara wersja w Tauri commands

Różnice:
- sync_common.rs merguje `assigned_folder_path` w projektach (linia 226)
- lan_sync.rs **celowo pomija** `assigned_folder_path` (linia 427-428, 446-447) bo "folder paths are machine-specific"
- Różne strategie rozwiązywania FK (sync_common.rs: auto-cleanup, lan_sync.rs: verify_and_cleanup_after_merge)

`import_delta_into_db` jest oznaczona `#[allow(dead_code)]` — jest nieużywana ale obecna. To mina na przyszłość.

---

### BUG-6: NEGOTIATE ODPOWIADA "FULL" ZAMIAST "DELTA" PRAWIE ZAWSZE

**Plik:** `src/lan_server.rs` — `handle_negotiate()` (linia 541)

**Opis:** Negotiate decyduje o trybie delta/full porównując markery:
```rust
let mode = match (&local_marker, &req.master_marker_hash) {
    (Some(local), Some(remote)) if local == remote => "delta",
    _ => "full",
};
```

Problem: Po każdej synchronizacji master generuje **nowy marker** (lan_sync_orchestrator.rs:364), ale slave **nie dostaje tego markera** (BUG-1). Następna sync zawsze widzi różne markery → zawsze "full".

Nawet gdyby BUG-1 był naprawiony: marker jest generowany z `tables_hash + timestamp + device_id` (lan_common.rs:118). Timestamp jest inny na każdej maszynie → markery nigdy nie będą identyczne, chyba że obie strony użyją tego samego markera (master wstawia go do obu baz w jednym kroku — ale slave go jeszcze nie ma w momencie negotiate).

**Fix:** Po naprawie BUG-1, slave powinien otrzymać i zapisać TEN SAM marker co master. Negotiate powinno porównywać markery z sync_markers table.

---

### BUG-7: `sync_common.rs` — merge NADPISUJE `assigned_folder_path`

**Plik:** `src/sync_common.rs` (linia 220-230)

**Opis:** Merge projektów:
```rust
"UPDATE projects SET color = ?1, hourly_rate = ?2, excluded_at = ?3, \
 frozen_at = ?4, assigned_folder_path = ?5, updated_at = ?6 WHERE name = ?7",
```

`assigned_folder_path` jest ścieżką do folderu na **lokalnej maszynie** (np. `C:\Users\Jan\Projects\Web`). Merge nadpisuje ją ścieżką z remote'a. Na drugiej maszynie ta ścieżka nie istnieje.

W `lan_sync.rs::import_delta_into_db()` to jest poprawnie obsłużone — pomija `assigned_folder_path`.

**Fix:** W sync_common.rs NIE nadpisywać `assigned_folder_path` z remote'a.

---

### BUG-8: RÓŻNE ALGORYTMY HASHOWANIA W DASHBOARDZIE VS DAEMON

**Pliki:** `dashboard/src-tauri/src/commands/helpers.rs:100` vs `src/lan_common.rs:6`

**Opis:** `compute_table_hash` istnieje w dwóch wersjach:
- **Daemon** (`lan_common.rs:78`): używa FNV-1a 64-bit (deterministyczny, custom impl)
- **Dashboard** (`helpers.rs:74`): używa `std::collections::hash_map::DefaultHasher` (SipHash)

SQL queries są identyczne, ale algorytmy dają **różne wyniki** dla tych samych danych. SipHash może nawet zwracać różne wyniki między uruchomieniami procesu (random seed).

**Skutek:** Porównanie haszy tabel między dashboardem a daemonem zawsze pokaże różnicę, nawet gdy dane są identyczne. Może powodować fałszywe triggery synchronizacji.

**Fix:** Dashboard `helpers.rs` powinien używać tego samego FNV-1a co daemon.

---

### BUG-9: BRAK RESTORE BACKUPU PRZY BŁĘDZIE VERIFY W LAN SYNC

**Plik:** `src/lan_sync_orchestrator.rs` (linia 340-358)

**Opis:** W LAN orchestratorze:
- Krok 8: `backup_database()` tworzy backup (linia 340)
- Krok 9: `merge_incoming_data()` — jeśli fail, zwraca Err (OK)
- Krok 10: `verify_merge_integrity()` — jeśli fail, zwraca Err, ale **NIE przywraca backupu**

**Porównanie:** Online sync (`online_sync.rs:1161-1168, 1292-1297`) poprawnie wywołuje `restore_database_backup()` przy każdym błędzie merge/verify.

**Skutek:** Po nieudanym verify baza pozostaje w niespójnym stanie z częściowo scalonym danymi.

---

### BUG-10: KROK 12 LAN SYNC NIE CZEKA NA SLAVE

**Plik:** `src/lan_sync_orchestrator.rs` (linia 395-401)

**Opis:** Master po `db-ready` natychmiast przechodzi do unfreeze (krok 13). Nie czeka na potwierdzenie, że slave pobrał i zaimportował dane. Nawet po naprawie BUG-1, master odmroziłby bazę zanim slave skończy import.

**Porównanie:** Online sync (`online_sync.rs:1364-1374`) poprawnie czeka: `wait_for_step(... 12 ...)`.

**Fix:** Dodać polling/oczekiwanie na potwierdzenie od slave'a przed unfreeze.

---

## PROBLEMY ŚREDNIE

### ISSUE-8: Podwójne parsowanie ipconfig + masowy unicast scan

**Plik:** `src/lan_discovery.rs`

`get_subnet_broadcast_addresses()` (linia 629) i `get_local_interfaces()` (linia 767) obie parsują wyjście `ipconfig` — dwa spawny procesów co 30s beacona. Dodatkowo unicast scan (linia 826) wysyła ~254 pakietów UDP co 2 minuty (~7600/h).

**Fix:** Jedna funkcja parsująca z cache wyników. Zmniejszyć częstotliwość unicast scan.

---

### ISSUE-9: Redundancja `set_nonblocking` + sleep-based accept loop

**Plik:** `src/lan_server.rs` (linia 260-268)

```rust
listener.set_nonblocking(false)  // linia 261 — martwy kod
listener.set_nonblocking(true)   // linia 267 — nadpisuje powyższe
```

Accept loop używa `sleep(100ms)` — CPU budzi się 10x/s w idle. Latencja akceptacji ~50ms.

---

### ISSUE-9a: Peak RAM ~200MB+ na merge dużych baz

**Plik:** `src/sync_common.rs` (linia 186)

Merge parsuje cały JSON payload do `serde_json::Value` (generyczny DOM). Dla 50MB payloadu:
- 50MB String body + 50MB zapis do pliku + 100-150MB DOM = ~200-250MB peak RAM
- Tablice applications i projects iterowane dwukrotnie (merge + budowa map ID)

**Fix:** Typowane struktury (Deserialize) zamiast Value. Budować mapy w jednym przejściu.

---

### ISSUE-10: `sync_log()` zduplikowana w wielu plikach

**Pliki:** `lan_common.rs:37`, `sync_common.rs:25`, `lan_sync_orchestrator.rs:16`, `lan_server.rs:473`

Każdy moduł definiuje własny `sync_log()` wrapper. Wszystkie delegują do `lan_common::sync_log()`, ale to niepotrzebna indirekcja. Wystarczy `use crate::lan_common::sync_log;`.

---

### ISSUE-11: `get_device_id()` vs `get_or_create_device_id()`

**Pliki:** `lan_common.rs:16` vs `lan_discovery.rs:101`

- `lan_common::get_device_id()` — czyta z pliku, fallback na COMPUTERNAME
- `lan_discovery::get_or_create_device_id()` — czyta z pliku, **tworzy** jeśli nie istnieje, fallback na COMPUTERNAME

Inconsistency: jeśli plik `device_id.txt` nie istnieje, orchestrator i serwer używają COMPUTERNAME (z lan_common), a discovery generuje unikalny ID i zapisuje do pliku. Po restarcie discovery i reszta modułów będą mieć różne ID.

W praktyce: po pierwszym uruchomieniu discovery plik istnieje, więc wszyscy czytają to samo. Ale pierwsza sesja może mieć niespójność.

---

### ISSUE-12: Brak context menu na ikonach sync w dashboardzie

**Wymaganie:** "w UI dashboard muszą być w obu przypadkach — przyciskach ikonach pod prawym przyciskiem opcje delta sync i force sync"

**Stan:** `LanSyncCard.tsx` ma przyciski "Sync" i "Force" per peer (linie 502-524), ale:
- Są to zwykłe `<Button>` elementy, NIE context menu pod prawym przyciskiem myszy
- Brak context menu (right-click) na ikonach synchronizacji w głównym UI
- Brak ikon synchronizacji w sidebar / topbar z opcjami sync

**Fix:** Dodać context menu (React ContextMenu) z opcjami "Delta sync" i "Force sync" na ikonach/przyciskach peer sync.

---

## ARCHITEKTURA — OCENA ZGODNOŚCI Z ZAŁOŻENIAMI

### A. Funkcje demona

| Funkcja | Status | Uwagi |
|---------|--------|-------|
| LAN: rozgłasza obecność | ✅ OK | UDP broadcast + unicast scan (lan_discovery.rs) |
| LAN: odbiera sygnał master/slave | ✅ OK | Beacon handling z election (lan_discovery.rs) |
| LAN: sygnalizuje gotowość do sync | ⚠️ CZĘŚCIOWO | `sync_ready: true` w beacon, ale brak dedykowanej ikony w UI |
| LAN: sygnalizuje proces sync | ⚠️ CZĘŚCIOWO | Progress overlay istnieje, ale nie blokuje UI (BUG-2) |
| Online: zgłasza gotowość serwerowi | ✅ OK | `create_session()` w online_sync.rs |
| Online: odbiera komunikaty od serwera | ✅ OK | Poll-based + SSE |
| Online: sygnalizuje gotowość | ⚠️ CZĘŚCIOWO | Brak dedykowanej ikony |
| Online: sygnalizuje proces | ⚠️ CZĘŚCIOWO | Overlay nie blokuje UI |

### C. Logika synchronizacji

| Krok | LAN | Online |
|------|-----|--------|
| C.1: Sprawdzenie statusu baz | ✅ Negotiate | ✅ Session create |
| Identyczne bazy → komunikat | ⚠️ Negotiate "delta"→sync, brak "skip" | ✅ "not_needed" |
| Master żąda delty od slave | ✅ POST /lan/pull | ✅ Slave uploads to SFTP |
| Slave wysyła deltę | ✅ HTTP response | ✅ SFTP upload |
| Master odbiera | ✅ HTTP | ✅ SFTP download |
| Potwierdza odbiór | ⚠️ Implicit | ✅ Report step |
| Scala deltę | ✅ merge_incoming_data | ✅ merge_incoming_data |
| Wysyła scalone do slave | ❌ **BUG-1**: Zapisuje plik ale slave nie pobiera | ✅ SFTP upload |
| Slave scala | ❌ **BUG-1**: Nigdy nie otrzymuje danych | ✅ merge + verify |
| Porównuje bazy | ❌ Pomijane | ✅ Marker comparison |
| Komunikat o udanej sync | ⚠️ Progress "completed" ale bez porównania | ✅ OK |
| **UI zamrożone** | ❌ **BUG-2** | ❌ **BUG-2** |

### D. Force sync

| Aspekt | LAN | Online |
|--------|-----|--------|
| Wysłanie całej bazy | ✅ `since=1970-01-01` | ✅ `forceFullSync: true` |
| Połączenie z bazą master | ✅ merge_incoming_data | ✅ merge_incoming_data |
| Dodanie znacznika | ✅ insert_sync_marker_db | ✅ insert_sync_marker_db |
| Wysłanie do slave | ❌ **BUG-1** | ✅ SFTP |
| UI context menu | ⚠️ Przyciski, nie context menu | ⚠️ Przyciski |

---

## PRIORYTET NAPRAW

1. **BUG-1 + BUG-10** (KRYTYCZNY) — Slave LAN nie pobiera scalonych danych + master nie czeka na slave → LAN sync zepsuty
2. **BUG-2** (KRYTYCZNY) — UI nie jest blokowany podczas sync
3. **BUG-3** (KRYTYCZNY) — Async online sync pull nie jest triggerowany automatycznie
4. **BUG-9** (WYSOKI) — Brak restore backupu przy błędzie verify w LAN sync
5. **BUG-7** (WYSOKI) — Merge nadpisuje lokalne ścieżki folderów
6. **BUG-8** (WYSOKI) — Różne algorytmy hashowania (dashboard DefaultHasher vs daemon FNV-1a)
7. **BUG-4** (WYSOKI) — Firewall wymaga admin do dodania reguł
8. **BUG-6** (WYSOKI) — Negotiate zawsze "full" → brak delta sync
9. **ISSUE-12** (ŚREDNI) — Brak context menu delta/force w UI
10. **ISSUE-9a** (ŚREDNI) — Peak RAM ~200MB+ na merge dużych baz
11. Reszta — refaktory i optymalizacje

---

## REKOMENDACJA

### Etap 1 — LAN sync (naprawa krytyczna)

Naprawienie **BUG-1 + BUG-10** jest absolutnym priorytetem — bez niego **cały LAN sync jest bezużyteczny**. Wymagane zmiany:

1. Po `db-ready`, master musi wysłać scalone dane do slave (np. `POST /lan/upload-db` z ciałem = scalone JSON)
2. Slave w `handle_upload_db` (lub nowy handler) musi: backup → merge → verify → insert marker → confirm
3. Master musi czekać na potwierdzenie od slave'a (polling lub synchroniczny response)
4. Dopiero po potwierdzeniu → unfreeze obu baz
5. Dodać restore backupu przy błędzie verify (BUG-9)

Po naprawie BUG-1, BUG-6 prawdopodobnie zniknie (markery będą spójne na obu maszynach).

### Etap 2 — UI freeze + online async

1. **BUG-2**: Nowy fullscreen overlay blokujący interakcję (`pointer-events: none` na reszcie UI, modal z komunikatem)
2. **BUG-3**: Dashboard `runOnlineSyncOnce` musi triggerować `/online/trigger-sync` (daemon rozróżnia tryb async/session)
3. **BUG-8**: Ujednolicić algorytm hashowania (FNV-1a wszędzie)

### Etap 3 — Polerowanie

1. BUG-7: Nie nadpisywać `assigned_folder_path` w merge
2. BUG-4: Instrukcja/prompt w UI o regułach firewall
3. ISSUE-12: Context menu na ikonach sync
4. Optymalizacje pamięci i sieci
