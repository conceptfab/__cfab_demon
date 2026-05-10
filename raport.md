# Raport przeglądu kodu — TIMEFLOW (cfab_demon)

**Data:** 2026-04-23
**Branch:** `macos-port`
**HEAD:** `356bae8e3a14aa5ba8e3619a49144a8b8778e1ae`
**Metoda:** 6 równoległych agentów (Rust demon, sync LAN/online, Dashboard React, Tauri backend, i18n/Help, parity Win/Mac + AI)

---

## Spis treści

1. [Podsumowanie wykonawcze (TL;DR)](#1-podsumowanie-wykonawcze-tldr)
2. [Rust demon — rdzeń](#2-rust-demon--rdze%C5%84)
3. [Synchronizacja danych (LAN + Online)](#3-synchronizacja-danych-lan--online)
4. [Dashboard — UI (React/TypeScript)](#4-dashboard--ui-reacttypescript)
5. [Tauri backend (dashboard/src-tauri)](#5-tauri-backend-dashboardsrc-tauri)
6. [Parity Windows / macOS](#6-parity-windows--macos)
7. [Moduł AI (assignment model)](#7-modu%C5%82-ai-assignment-model)
8. [i18n (PL/EN) i dokumentacja Help](#8-i18n-plen-i-dokumentacja-help)
9. [Plan działania — priorytetyzacja](#9-plan-dzia%C5%82ania--priorytetyzacja)

---

## 1. Podsumowanie wykonawcze (TL;DR)

**Kondycja ogólna:** kod jest dojrzały, dobrze poukładany (warstwa `platform/`, pooling DB, idempotentne migracje, RAII guardy dla syncu, 100% parity kluczy i18n PL/EN). Produkcyjnie można ruszać, ale z 14 pozycjami wymagającymi naprawy przed kolejnym wydaniem publicznym.

**Najważniejsze punkty:**

- 🚨 **Bezpieczeństwo LAN (P0):** endpoint `/lan/local-identity` oddaje pełen `secret` serwera każdemu w sieci bez autoryzacji. Dodatkowo `/lan/pair` nie ma per-IP throttle — kod 6-cyfrowy jest brute-force'owalny.
- 🐛 **Funkcjonalny regres na macOS (P1):** `measure_cpu_for_app` zwraca 0.0 w większości cykli → background-tracking praktycznie nie działa; `window_title` jest pusty → file-tracking i AI Layer 3 (token scoring) są dużo słabsze niż na Windows.
- 🧨 **Race & data-loss (P1):** merge LAN nie blokuje trackera; tombstone sesji po `start_time` usuwa sesje na WSZYSTKICH maszynach; cache `initialize_database_file_once` nie zauważa usunięcia pliku DB z dysku.
- 📝 **i18n regresja w EN (P1):** 3 klucze `sessions.menu.mode_*` używane w `SessionContextMenu.tsx` nie istnieją w żadnym locale — tryby menu po EN pokazują polskie fallbacki.
- 🏗️ **Architektoniczne:** shutdown demona nie czeka na thread online-sync (brak join-handle), tracker i CPU-background liczą idle niespójnie, `Sessions.tsx` (840 linii) i `Projects.tsx` (1134 linie) to god-components, useUIStore destrukturyzowane bez selektorów generuje nadmiarowe re-rendery.
- 🧹 **Martwy kod:** `src-tauri/src/refactor_db.py` (hardcoded Windows path), `handle_status`/`handle_verify_ack`/`handle_push` (410 endpoints), `CpuSnapshot.total_time` na macOS, `warm_path_detection_wmi` (no-op).

**Zakres audytu:** 100% plików Rust w `src/` (~17k LOC), 100% `dashboard/src-tauri/src/` (commands, db, migrations), reprezentatywny przegląd `dashboard/src/components`/`pages`/`hooks`/`store`, 100% locales, pełna inspekcja `src/platform/` + tauri configs.

---

## 2. Rust demon — rdzeń

Zakres: `src/main.rs`, `src/tracker.rs`, `src/monitor*.rs`, `src/monitor/**`, `src/activity.rs`, `src/storage.rs`, `src/config.rs`, `src/i18n.rs`, `src/platform/**`, `shared/**`.

### 2.1 Mocne strony
- Panic-recovery w wątku trackera ([src/tracker.rs:163](src/tracker.rs#L163) `catch_unwind`) i `install_panic_hook` w [src/main.rs:208](src/main.rs#L208) logują panic z lokalizacją.
- `ForegroundSignal` ([src/platform/foreground_signal.rs:9](src/platform/foreground_signal.rs#L9)) jest w pełni cross-platform — Win (`SetWinEventHook`) i macOS (polling 250 ms) wywołują identyczne `notify()`, tracker nie ma `#[cfg]`-switchy.
- Cache PID z re-walidacją przez `creation_time` ([src/monitor/pid_cache.rs:55](src/monitor/pid_cache.rs#L55)) chroni przed PID reuse; WMI-detection batchuje 16 PID-ów i cachuje per-wątek ([src/monitor/wmi_detection.rs:10](src/monitor/wmi_detection.rs#L10)).
- Nowy sleep-detection ([src/tracker.rs:512-546](src/tracker.rs#L512-L546)) na bazie delty wall-clock vs uptime — konceptualnie słuszny, bez osobnego API dla platform.
- `storage::prepare_daily_for_storage` tnie długie pola i deduplikuje `title_history` przed zapisem.
- `clamp_interval_secs` ([src/config.rs:404](src/config.rs#L404)) chroni pętlę przed błędnie zapisanym configiem.

### 2.2 Krytyczne (P1)

1. **macOS CPU measurement zwraca zera — background-tracking nie działa**
   - Plik: [src/monitor_macos.rs:225](src/monitor_macos.rs#L225), [:244-295](src/monitor_macos.rs#L244-L295)
   - Co źle: `measure_cpu_for_app` przy każdym ticku odświeża tylko bieżący zestaw PID-ów monitorowanych aplikacji, ale parametr `_prev: Option<&CpuSnapshot>` jest ignorowany. Sysinfo wymaga dwóch kolejnych refreshów tego samego PID-a w ramach `MINIMUM_CPU_UPDATE_INTERVAL`, by zwrócić niezerowe `cpu_usage()`. Przy zmiennym zbiorze PID-ów pomiar najczęściej daje 0.0 → próg `cpu_threshold=0.05` jest efektywnie martwy.
   - Jak naprawić: jedno wspólne `System` w `SYSINFO_STATE`, jeden `refresh_processes_specifics(All, cpu)` per tick; używać `accumulated_cpu_time()` i liczyć deltę od poprzedniego snapshotu — wzorem Windows.

2. **Thread auto-sync online nie ma join-handle — shutdown nieczysty**
   - Plik: [src/main.rs:119-145](src/main.rs#L119-L145)
   - Co źle: `std::thread::spawn` + bezwarunkowy `thread::sleep(10s)` przed sprawdzeniem `stop_signal`. Handle nie jest trzymany nigdzie. `TrayExitAction::Restart` odpala drugi proces gdy ten wątek wciąż żyje — kolejna instancja próbuje otworzyć DB i port LAN.
   - Jak naprawić: `Condvar::wait_timeout` albo pętla 1-s sleepów z check `stop_signal` (wzorzec z [src/tracker.rs:758-768](src/tracker.rs#L758-L768)); zapisz JoinHandle i czekaj w shutdown przed `drop(_guard)`.

3. **`record_app_activity` niespójnie liczy idle dla foreground vs background**
   - Plik: [src/tracker.rs:602-703](src/tracker.rs#L602-L703)
   - Co źle: przy idle→active transition foreground dostaje `effective_elapsed.max(1s)`, ale CPU-background używa pełnego `actual_elapsed` (~10 s). W efekcie apka w tle „zbiera" 10 s mimo że user był idle przez 9 z nich.
   - Jak naprawić: zastosuj ten sam `effective_elapsed` w pętli background.

4. **DST zegar → false-positive sleep-detection**
   - Plik: [src/tracker.rs:440-546](src/tracker.rs#L440-L546)
   - Co źle: `last_tracking_tick_wall = Local::now()`. Skok DST (02:00→03:00) = +3600 s bez realnego snu → sztuczne `save_daily` + zamknięcie sesji w środku pracy.
   - Jak naprawić: porównuj `SystemTime::now()` (UTC epoch bez skoków DST) albo traktuj delty będące wielokrotnością 3600 s jako DST i nie zamykaj sesji.

### 2.3 Ważne (P2)

1. **Brak `window_title` na macOS — file-tracking nie działa**
   - Plik: [src/monitor_macos.rs:191](src/monitor_macos.rs#L191), efekt w [src/tracker.rs:618](src/tracker.rs#L618)
   - Komentarz „Faza 3.1: AX API" → blok `// Update files` (tracker.rs:345-413) jest skippowany. Użytkownicy macOS mają tylko agregację aplikacji, bez podziału na pliki. To fundamentalna funkcja produktu.
   - Minimum: `CGWindowListCopyWindowInfo` + `kCGWindowName` dla frontmost-app; docelowo AX API + prompt o zgody. Komunikat w tray'u gdy brak uprawnień.

2. **Duplikacja `extract_file_from_title` i `classify_activity_type`**
   - Pliki: [src/monitor.rs:171](src/monitor.rs#L171), [src/monitor_macos.rs:70](src/monitor_macos.rs#L70), linie 161 w obu plikach.
   - Fix: wydziel do `src/monitor/title_parser.rs` lub do crate `timeflow_shared`; `collect_descendants` — to samo.

3. **`.expect()` w wątku głównym tray-a na macOS**
   - Plik: [src/platform/macos/tray.rs:34,86](src/platform/macos/tray.rs#L34) — `Icon::from_rgba(...).expect(...)` panikuje na uszkodzonym RGBA; `fallback_icon()` sam ma drugi `expect`.
   - Fix: zwróć `Result`, fallback powinien być bezpieczny.

4. **macOS `build_process_snapshot` + `measure_cpu_for_app` — podwójny skan procesów**
   - Pliki: [src/monitor_macos.rs:199](src/monitor_macos.rs#L199), [src/platform/macos/process_snapshot.rs:10](src/platform/macos/process_snapshot.rs#L10)
   - Koszt: ~50-100 ms CPU co 10 s. Unifikacja w jednym `SYSINFO_STATE`.

5. **Czas idle wliczany do `Session.duration_seconds`**
   - Plik: [src/tracker.rs:198,326-330](src/tracker.rs#L198)
   - Gdy `last_active < session_gap`, sesja nie zostaje zakończona przy idle — `duration_seconds = now - start` wlicza idle do sesji. Raport pokazuje „30 min" mimo 5 min pracy + 25 min idle.
   - Fix: powyżej `IDLE_THRESHOLD_MS` (np. 2 min) wymusić start nowej sesji, podobnie jak przy sleep-detection.

6. **`open_daily_store` otwiera nowe połączenie SQLite przy każdym `save_daily`**
   - Plik: [src/storage.rs:128](src/storage.rs#L128), wywoływane w tracker co 5 min + przy date-change + po sleep.
   - Fix: trzymaj `rusqlite::Connection` przez życie wątku trackera; opcjonalnie opakuj w `DailyStore { conn, ... }`.

### 2.4 Drobne / optymalizacje (P3)

- [src/tracker.rs:557-558](src/tracker.rs#L557-L558) `drain_switch_times()` alokuje `Vec` per tick — dodaj `take_last_switch_time() -> Option<Instant>`.
- [src/monitor.rs:218-226](src/monitor.rs#L218-L226) `GetTickCount()` DWORD rolluje co 49.7 dnia; sanity-check `idle_ms > 48h` → klamp do 0.
- [src/tracker.rs:26](src/tracker.rs#L26) `or_insert_with(HashMap::new)` → `or_default()`.
- [src/monitor_macos.rs:273-277](src/monitor_macos.rs#L273-L277) 10× refresh per tick — scal w jeden z unikalnymi PID-ami.
- [src/main.rs:261-272](src/main.rs#L261-L272) log-file bez rotacji: przy 1 MB truncate tracimy kontekst; dodaj `.log.1` przed truncate.
- [src/tracker.rs:441-450](src/tracker.rs#L441-L450) `last_save = Instant::now()` — pierwszy save po pełnych 5 min; pusty restart = utrata danych. Inicjalizuj jako `now - save_interval + 30s`.
- [src/i18n.rs:120-137](src/i18n.rs#L120) LANG_CACHE nie cachuje „brak pliku/parse fail" — powtórny odczyt per wywołanie.
- [src/main.rs:170-181](src/main.rs#L170-L181) restart: dodaj `thread::sleep(200ms)` między drop guard a spawn nowego procesu (flock cleanup na macOS).

### 2.5 Martwy kod

- [src/monitor_macos.rs:32](src/monitor_macos.rs#L32) `PidCacheEntry { creation_time, created_at, last_alive_check, path_detection_attempted }` → `#[allow(dead_code)]` pola nigdy nie czytane.
- [src/monitor_macos.rs:50](src/monitor_macos.rs#L50) `CpuSnapshot.total_time` — zapisywany, nigdy nie odczytywany (bug z CPU meas. #1).
- [src/monitor.rs:161-163](src/monitor.rs#L161-L163) `classify_activity_type` — wrapper bez wartości.
- [src/monitor/pid_cache.rs:17](src/monitor/pid_cache.rs#L17) `created_at` — „future eviction" od miesięcy.
- [src/monitor_macos.rs:100-102](src/monitor_macos.rs#L100-L102) `warm_path_detection_wmi` — no-op; `#[cfg(windows)]` wystarczy w miejscu wywołania.

### 2.6 Rekomendacje architektoniczne

1. **Trait `CpuMeter { fn tick(&mut self, snap: &ProcessSnapshot) -> HashMap<String, f64> }`** z dwiema implementacjami platformowymi; tracker konsumuje tylko wyniki. Izoluje bug #1 od logiki biznesowej.
2. **`IdleTracker` jako osobny moduł** z API `classify_tick(now, idle_ms, prev_idle) -> { Active, Idle, WakeFromIdle, WakeFromSleep }`. Obecnie logika idle jest rozrzucona między 4 miejsca w trackerze.
3. **Podział `tracker.rs` (~900 linii)** na `tracker/loop.rs`, `tracker/session.rs`, `tracker/file_index.rs`, `tracker/sleep_detection.rs`.
4. **Explicit shutdown protocol**: wszystkie wątki pomocnicze (online-sync, LAN-server) z JoinHandle, shutdown-log po tym jak wszystkie dołączyły.
5. **`PARITY.md`** deweloperski: jawna lista stubów macOS (`window_title=""`, `detected_path=None`, `measure_cpu` broken) — żeby nikt nie uznał produkcyjnej gotowości za fakt. (To dokumentacja developerska, poza Help.tsx.)

---

## 3. Synchronizacja danych (LAN + Online)

Zakres: `src/lan_*.rs`, `src/sync_*.rs`, `src/online_sync.rs`, `src/sftp_client.rs`, migracje m20.

### 3.1 Mocne strony
- Solidny protokół 13-kroków LAN z raportowaniem do UI i logów.
- Backup przed merge + automatyczny `restore_database_backup_typed` na błędzie (master i slave, LAN i online).
- TOFU SSH host ([src/sftp_client.rs:73-102](src/sftp_client.rs#L73-L102)), limit `MAX_DOWNLOAD_SIZE`, gzip-bomb guard 200 MB ([src/sync_encryption.rs:196](src/sync_encryption.rs#L196)).
- Atomowe zapisy sekretów (tmp+rename) — brak regeneracji przy transient I/O.
- RAII guardy (`SyncGuard`, `TempFileGuard`, `HeartbeatGuard`, `ConnectionGuard`).
- AES-256-GCM z losowym IV z `getrandom` ([src/sync_encryption.rs:140](src/sync_encryption.rs#L140)), klucze sesyjne przez HMAC-SHA256, brak nonce reuse.
- Migracja **m20** (`project_name` w `sessions`/`manual_sessions` + trigger sync/rename cascade) + `verify_merge_integrity` re-attach po nazwie — fix LAN sync unassigned sessions.
- Konflikty `last_writer_wins` z zapisem do `sync_merge_log`, normalizacją TS.
- Watermark w `build_delta_for_pull`: sesje filtrowane po `updated_at >= since_ref`.

### 3.2 Krytyczne (P0 / P1)

1. **🚨 `/lan/local-identity` oddaje sekret bez auth (P0)**
   - Plik: [src/lan_server.rs:484-488](src/lan_server.rs#L484-L488), [:1196-1207](src/lan_server.rs#L1196-L1207), whitelista [:422-427](src/lan_server.rs#L422-L427)
   - Co źle: endpoint otwarty; zwraca `{ device_id, secret, machine_name }` każdemu w LAN. Kompromituje cały model auth.
   - Fix: endpoint zwraca TYLKO `device_id` + `machine_name`; sekret przychodzi wyłącznie jako odpowiedź na `/lan/pair` po walidacji kodu.

2. **🚨 `/lan/pair` bez per-IP throttle (P0)**
   - Plik: [src/lan_server.rs:1178-1187](src/lan_server.rs#L1178-L1187)
   - Co źle: `MAX_PAIRING_ATTEMPTS=5` działa na kod, nie na IP. Atakujący może brute-force'ować 10⁶ kombinacji czekając na kolejne kody.
   - Fix: `HashMap<IpAddr, (count, Instant)>` z oknem 60 s, limit np. 10 prób, logowanie podejrzanych.

3. **Merge nie trzyma muteksu — race z trackerem (P1)**
   - Pliki: [src/sync_common.rs:266-850](src/sync_common.rs#L266-L850), [src/lan_common.rs:153-163](src/lan_common.rs#L153-L163)
   - Co źle: `open_dashboard_db` używa `SQLITE_OPEN_NO_MUTEX`; nie widać process-level muteksu na merge. Tracker w trakcie mergu (sekundy→minuty) może INSERT-ować sesje → triggery m20 + zmiana watermark w środku iteracji po sesjach peera.
   - `sync_state.db_frozen` istnieje, ale trzeba zweryfikować czy tracker rzeczywiście go honoruje przed INSERT.
   - Fix: `static MERGE_MUTEX: Mutex<()>` w `sync_common`; tracker sprawdza `db_frozen` przed każdym INSERT; kolejkowanie/retry jeśli frozen.

4. **Tombstone sesji po `start_time` kasuje cross-machine (P1)**
   - Plik: [src/sync_common.rs:797-808](src/sync_common.rs#L797-L808)
   - Co źle: fallback `DELETE FROM sessions WHERE start_time = ?` usuwa WSZYSTKIE sesje z tą sekundą — dwie aplikacje logujące w tej samej chwili skasują się na wszystkich hostach.
   - Fix: sync_key tombstone = `app_executable_name|start_time` zamiast `app_id|start_time`.

5. **Martwy fallback `get_local_marker_created_at_with_conn` (P2)**
   - Plik: [src/lan_sync_orchestrator.rs:723-725,738](src/lan_sync_orchestrator.rs#L723-L738)
   - Co źle: przy nieznajomym hashu używa `since` z ostatniego *lokalnego* markera (sync z innym peerem) — błędnie obcina deltę.
   - Fix: brak znaleziska = `"1970-01-01 00:00:00"` → full dump.

### 3.3 Ważne (P2)

1. **`build_delta_export` z `since="1970-01-01"` to full dump** — [src/sync_common.rs:210-215](src/sync_common.rs#L210-L215), [src/lan_server.rs:1261](src/lan_server.rs#L1261). Działa OK przy istniejącym indeksie — zweryfikuj: `CREATE INDEX idx_sessions_updated_at ON sessions(updated_at)` i `idx_manual_sessions_updated_at`. Migracja m20 zmieniła `updated_at` wszystkich sesji → pierwszy sync po m20 jest full-sized.

2. **Backoff + równoległe trigger-sync mogą odpalić dwa syncy master jednocześnie**
   - [src/lan_sync_orchestrator.rs:317-346](src/lan_sync_orchestrator.rs#L317-L346), [src/lan_server.rs:1068-1076](src/lan_server.rs#L1068-L1076)
   - Po nieudanej próbie `reset_progress` zostawia `sync_in_progress=true`. Drugi trigger widzi `phase=="idle"` → „auto-clear stale" czyści flagę → dwa wątki sync.
   - Fix: sprawdzaj też `sync_handle.is_finished()` lub trzymaj handle w shared state.

3. **Auto-unfreeze po 5 min vs. `SYNC_TIMEOUT=300s` — wyścig**
   - [src/lan_server.rs:253-269](src/lan_server.rs#L253-L269), [:323-327](src/lan_server.rs#L323-L327)
   - Granica zbieżna: auto-unfreeze może zresetować `sync_in_progress` gdy wątek wciąż pracuje.
   - Fix: `check_auto_unfreeze` zostawia progress jeśli `sync_in_progress && phase != completed/idle`; unfreeze-timeout = 10 min.

4. **Merge 200 MB JSON → 3× RAM (~600 MB)** — [src/sync_common.rs:267-290](src/sync_common.rs#L267-L290). Streamowanie per-tabela (`serde_json::StreamDeserializer`) albo redukcja limitu do 50 MB z chunk-owaniem.

5. **Duplikacja `open_dashboard_db*`** — 3 sposoby otwierania DB ([src/lan_server.rs:607-613](src/lan_server.rs#L607-L613), [src/lan_common.rs:153-163](src/lan_common.rs#L153-L163), `sync_common.rs`). Ujednolicić w `lan_common`.

6. **`http_post_with_progress` bez progressu przy wysyłaniu ciała** — [src/lan_sync_orchestrator.rs:141-172](src/lan_sync_orchestrator.rs#L141-L172). Progres tylko przy odbiorze odpowiedzi. 50 MB upload = 0% aż do końca. Chunked write + callback w pętli.

### 3.4 Drobne

- [src/lan_server.rs:935](src/lan_server.rs#L935) drugi `remove_file(&incoming_path)` to dead code (pierwszy usuwa na 865). Usunąć linię.
- [src/sftp_client.rs:24-33](src/sftp_client.rs#L24-L33) `SftpClient::Drop` nie zeruje `host`/`port` — spójność z `SftpCredentials::Drop`.
- [src/sync_common.rs:232-245](src/sync_common.rs#L232-L245) `normalize_ts` — doc-test na `2024-01-15T10:30:00Z`.
- [src/lan_common.rs:166](src/lan_common.rs#L166) komentarz o `DefaultHasher` nieaktualny — kod używa SHA-256.
- `AUTO_SYNC_COOLDOWN_SECS=60` vs `TRIGGER_SYNC_COOLDOWN_SECS=30` — niespójnie; ustal jedną stałą lub udokumentuj.
- `SftpClient::Drop` host/port (jw).
- Diag-logi `[DIAG]` w [src/sync_common.rs:356-361,598-602,894-898,911-916](src/sync_common.rs) spamują `lan_sync.log` w produkcji. Gate przez env var / `cfg!(debug_assertions)` / `log_settings.verbose`.

### 3.5 Martwy kod

- [src/lan_server.rs:701-725](src/lan_server.rs#L701-L725) `handle_status` + `StatusRequest`/`StatusResponse` — endpoint 410.
- [src/lan_server.rs:969-981](src/lan_server.rs#L969-L981) `handle_verify_ack`.
- [src/lan_server.rs:1029-1046](src/lan_server.rs#L1029-L1046) `handle_push` — 410.
- [src/lan_server.rs:948-967](src/lan_server.rs#L948-L967) `handle_download_db` — orchestrator go nie używa.
- [src/lan_sync_orchestrator.rs:723-725](src/lan_sync_orchestrator.rs#L723-L738) `get_local_marker_created_at_with_conn` (tylko w buggy fallbacku).
- `UploadAckResponse`, `StatusResponse` — `#[allow(dead_code)]`.
- `IPCONFIG_CACHE` w [src/lan_discovery.rs:22-43](src/lan_discovery.rs#L22-L43) — Windows-only logika niegatowana `#[cfg(windows)]`; na macOS `ipconfig` ma inny format → `get_subnet_broadcast_addresses` zwraca nic.

### 3.6 Rekomendacje
1. Endpoint `/lan/local-identity` — tylko device_id+machine_name.
2. Per-IP rate-limit na `/lan/pair`.
3. `MERGE_MUTEX` + tracker honorujący `db_frozen` przed INSERT.
4. Naprawa tombstone sync_key.
5. Gate `[DIAG]` logów.
6. Unifikacja `execute_online_sync` + `execute_online_sync_inner` (identyczne z parametrem `force_full`).
7. Indeks `updated_at` na obu tabelach sesji + tombstones.
8. Test integracyjny round-trip master→slave→master z 2 projektami i kilkoma sesjami (regresja m20).

---

## 4. Dashboard — UI (React/TypeScript)

Zakres: `dashboard/src/{App,main}.tsx`, `components/**`, `pages/**`, `hooks/**`, `store/**`, `lib/**` (bez `lib/sync/`), konfiguracja Vite/TS/ESLint.

### 4.1 Mocne strony
- Brak `any`, `@ts-ignore`, `@ts-expect-error` — dobra dyscyplina typów.
- `lazy()` + `Suspense` dla routingu + sensowny `manualChunks` ([dashboard/vite.config.ts:18-32](dashboard/vite.config.ts#L18-L32)).
- `ErrorBoundary` w [dashboard/src/App.tsx:122](dashboard/src/App.tsx#L122).
- `SessionRow` w `React.memo` ([dashboard/src/components/sessions/SessionRow.tsx:127](dashboard/src/components/sessions/SessionRow.tsx#L127)).
- `react-virtuoso` dla list sesji.
- Idempotentne guardy w store (`background-status-store.ts`: `diagnosticsInFlight`, `aiStatusInFlight`, `databaseSettingsInFlight`, `lanPeerPollInFlight`).
- Porządny throttle/dedupe refreshy w `useDataStore` ([dashboard/src/store/data-store.ts:85-149](dashboard/src/store/data-store.ts#L85-L149)).
- Rozbite hooki Sessions (`useSessionsFilters`, `useSessionsData`, `useSessionActions`).

### 4.2 Krytyczne (bugi UX, wycieki)

1. **`onSaved={triggerRefresh}` niezgodny z kontraktem** — [dashboard/src/pages/Projects.tsx:1128](dashboard/src/pages/Projects.tsx#L1128). `triggerRefresh(reason?: string)` a `onSaved` może przekazać obiekt event/argumentowy jako pierwszy arg. Fix: `onSaved={() => triggerRefresh('projects_manual_session_saved')}` (jak w `Dashboard.tsx:634`).

2. **Double-update `aiStatus`** — `background-status-store.ts`. `refreshDiagnostics` modyfikuje `aiStatus` obok ścieżki `refreshAiStatus`. Dwa źródła prawdy + per-ścieżka guard (nie per-pole) → kolizje w równoległych pollach.

3. **`setTimeout` bez cleanup — wycieki i race**
   - [dashboard/src/hooks/useBackgroundSync.ts:40](dashboard/src/hooks/useBackgroundSync.ts#L40) (SSE `setTimeout(..., 5000)`) — odpali po `disconnectSSE()`.
   - [dashboard/src/hooks/useJobPool.ts:211](dashboard/src/hooks/useJobPool.ts#L211) — `runSync` timers nakładają się.
   - [dashboard/src/components/layout/Sidebar.tsx:194,205](dashboard/src/components/layout/Sidebar.tsx#L194) — `lanSyncStatus`/`Message` cleanup (8/10 s) bez ref.
   - Fix: useRef + clearTimeout w cleanup.

4. **Toast Provider tworzy świeży obiekt value per render** — [dashboard/src/components/ui/toast-notification.tsx:58](dashboard/src/components/ui/toast-notification.tsx#L58). Opakuj `useMemo(() => ({showError, showInfo}), [showError, showInfo])`.

5. **`online` zmienna przypisana i niewykorzystana** — [dashboard/src/components/layout/Sidebar.tsx:219-222](dashboard/src/components/layout/Sidebar.tsx#L219-L222). `handleLanScan` robi tylko `refreshLanPeers()` — `online` to zapomniana logika (pewnie display peer-a).

### 4.3 Ważne (architektura, perf)

1. **Destrukturyzacja całego storu bez selektora** — trigger re-rendera na KAŻDĄ zmianę dowolnego pola.
   Miejsca: [dashboard/src/components/layout/Sidebar.tsx:126-127](dashboard/src/components/layout/Sidebar.tsx#L126-L127), [dashboard/src/hooks/useSessionsFilters.ts:26-33](dashboard/src/hooks/useSessionsFilters.ts#L26-L33), [dashboard/src/hooks/useJobPool.ts:32](dashboard/src/hooks/useJobPool.ts#L32), [dashboard/src/hooks/useBackgroundStartup.ts:19,102](dashboard/src/hooks/useBackgroundStartup.ts#L19), [dashboard/src/pages/Dashboard.tsx:186,194](dashboard/src/pages/Dashboard.tsx#L186), [dashboard/src/pages/Projects.tsx:138-140](dashboard/src/pages/Projects.tsx#L138-L140), [dashboard/src/pages/ProjectPage.tsx:142-144](dashboard/src/pages/ProjectPage.tsx#L142), [dashboard/src/pages/Estimates.tsx:41-50](dashboard/src/pages/Estimates.tsx#L41-L50), [dashboard/src/pages/Sessions.tsx:82-89](dashboard/src/pages/Sessions.tsx#L82-L89).
   Wzorzec już stosowany w App.tsx:65,171 — przenieść wszędzie: `useUIStore((s) => s.currentPage)`.

2. **`ConfirmDialog` jako komponent zwrócony z `useCallback`** — [dashboard/src/components/ui/confirm-dialog.tsx:39-59](dashboard/src/components/ui/confirm-dialog.tsx#L39-L59). Odbiega od idiomu; każdy hook ma własny state, może rozrzucić UX między stronami. Zamień na normalny komponent `<ConfirmDialog open message onConfirm onCancel>`.

3. **God-components**
   - [dashboard/src/pages/Sessions.tsx](dashboard/src/pages/Sessions.tsx) — 840 linii, 7-8 koncernów (context menu, filter modes, auto-sort, assignProjectSections, routing menu, split modal). Wyciągnij `useSessionsContextMenu` i `useAssignProjectSections`.
   - [dashboard/src/pages/Projects.tsx](dashboard/src/pages/Projects.tsx) — 1134 linie; `renderProjectList`/`renderProjectCard` to de facto komponenty → zmień na `React.FC` + `memo`.
   - [dashboard/src/hooks/useSettingsFormState.ts](dashboard/src/hooks/useSettingsFormState.ts) — 27 KB, 12 parametrów wejścia. Rozbij per kategoria ustawień.

4. **Trzy osobne `useEffect` z prawie identycznym wzorcem `Promise.allSettled + cancelled`** — [dashboard/src/hooks/useProjectsData.ts:175-200,202-217,219-235](dashboard/src/hooks/useProjectsData.ts#L175-L235). Przy szybkich zmianach refreshKeys trzy liczniki współbieżnie → skonsoliduj.

5. **Focus/visibility listener bez dep-check** — [dashboard/src/hooks/useSessionsData.ts:114-129](dashboard/src/hooks/useSessionsData.ts#L114-L129). Szybkie focus/blur → wiele `loadFirstSessionsPage`; `isLoadingRef` nie chroni przed race z `loadMore`.

6. **`hooks/useLanSyncManager.ts:184`** `refreshPairedDevices` deps `[pairingCode]` → `setInterval(5s)` resetuje się za każdą zmianą kodu parowania.

7. **`MainLayout.tsx:20-26`** autofocus bez `preventScroll` → drobne a11y (niechciane skroli).

### 4.4 Drobne / optymalizacje

- [dashboard/src/components/dashboard/TopAppsChart.tsx:27](dashboard/src/components/dashboard/TopAppsChart.tsx#L27) `key={\`${app.name}-${i}\`}` — index w key, przy reorderze klucz wędruje. Lepiej sama nazwa.
- [dashboard/src/pages/Dashboard.tsx:420-426](dashboard/src/pages/Dashboard.tsx#L420-L426) deps w `useEffect` zawiera stałe literały (`PROJECT_TIMELINE_SERIES_LIMIT`) — usuń z deps.
- [dashboard/src/pages/Sessions.tsx:221-240](dashboard/src/pages/Sessions.tsx#L221-L240) `querySelector('main')` w `requestAnimationFrame` — przenieś scroll parent jako ref z `MainLayout`.
- [dashboard/src/pages/Projects.tsx:222-229](dashboard/src/pages/Projects.tsx#L222-L229) localStorage persist kopiowany 3× — pomocnik `usePersistedState(key, init)`.
- [dashboard/src/components/layout/Sidebar.tsx:244-248](dashboard/src/components/layout/Sidebar.tsx#L244-L248) `setInterval(5s)` dla `refreshLanPeers` nawet gdy `document.hidden` — sprawdzaj `visibilityState`.
- TODO w [dashboard/src/pages/Sessions.tsx:252,311](dashboard/src/pages/Sessions.tsx#L252) click-outside + Escape — zrób `useClickOutsideDismiss(ref, onClose)`.
- [dashboard/src/pages/Projects.tsx:545-556](dashboard/src/pages/Projects.tsx#L545-L556) reset paginacji per jednej zmianie w dowolnej liście — warunkowo per-lista.

### 4.5 Martwy kod / nadmiar

- [dashboard/src/hooks/useLanSyncManager.ts:15](dashboard/src/hooks/useLanSyncManager.ts#L15) `import { usePageRefreshListener }` — nieużywane.
- [dashboard/src/components/layout/Sidebar.tsx:219-220](dashboard/src/components/layout/Sidebar.tsx#L219-L220) `online` bezużywane.
- [dashboard/src/hooks/useSessionsData.ts:157](dashboard/src/hooks/useSessionsData.ts#L157) `loadFirstSessionsPage` zwracane ale Sessions.tsx nie używa.
- [dashboard/src/components/layout/BugHunter.tsx:4,45,96](dashboard/src/components/layout/BugHunter.tsx#L4) — `invoke()` z `@tauri-apps/api/core` zamiast `lib/tauri.ts` + `alert()` natywne (zamiast `useToast`).
- Artefakty w repo: `dashboard/fix_ai.py`, `dashboard/get_logs.py`, `dashboard/temp_bg_services.txt`, `dashboard/check.bat`, `dashboard/test_esbuild.mjs` — zweryfikować czy są potrzebne.
- TODO w [dashboard/src/pages/Sessions.tsx:623-627](dashboard/src/pages/Sessions.tsx#L623-L627).

### 4.6 Rekomendacje (skrót)
1. Reguła: **zawsze selektor** w `useXStore(s => s.pole)` + lint-rule blokująca destrukturyzację.
2. `useMemo` na `ToastContext.Provider value` + refaktor `ConfirmDialog`.
3. Fix `onSaved={triggerRefresh}` w `Projects.tsx:1128`.
4. Unifikuj `aiStatus` updates (jedna ścieżka + guard).
5. Cleanup wszystkich `setTimeout`.
6. Zastąp `alert()` i bezpośredni `invoke()` w BugHunter.
7. Rozbij `Sessions.tsx`, `Projects.tsx`, `useSettingsFormState.ts`.
8. Virtual list też dla projektów (przy dużych portfolio).
9. Ujednolić `logTauriError` vs `console.error`.

---

## 5. Tauri backend (dashboard/src-tauri)

Zakres: `dashboard/src-tauri/src/main.rs`, `lib.rs`, `db*`, `db_migrations/**`, `commands/**`, `capabilities/**`, `tauri*.json`, `Cargo.toml`, `build.rs`.

### 5.1 Mocne strony
- Spójny kontrakt `Result<T, String>` we ~130 handlerach; brak `unwrap()` w ścieżce produkcyjnej.
- Pooling DB ([dashboard/src-tauri/src/db/pool.rs](dashboard/src-tauri/src/db/pool.rs)) — 4 idle, WAL, `busy_timeout=5000`, rozdzielone `ActiveDbPool`/`PrimaryDbPool`, `autoCommit` restore przy release.
- Migracje: jedna transakcja `unchecked_transaction()`, VACUUM odroczony; `pragma_table_info` guard przed każdym ALTER (m01, m12, m13, m17–m20). Fix f8b16e0 poprawnie chroni świeżą bazę.
- `run_db_blocking`/`run_app_blocking`/`run_db_primary_blocking` używane konsekwentnie w ciężkich handlerach ([dashboard/src-tauri/src/commands/helpers.rs:164-205](dashboard/src-tauri/src/commands/helpers.rs#L164-L205)).
- Migracja m20 — idempotentna (column-existence + DROP TRIGGER IF EXISTS + CREATE TRIGGER bez IF NOT EXISTS, celowo dla świeżej definicji).
- Restore DB ([dashboard/src-tauri/src/commands/database.rs:235+](dashboard/src-tauri/src/commands/database.rs#L235)) — `PRAGMA integrity_check(1)`, column-aware INSERT (schema drift safe), FK off/on, no-clobber.
- WAL checkpoint przed każdym VACUUM INTO.
- Testy jednostkowe z `open_in_memory` dla analysis/estimates/dashboard/import_data/sessions.

### 5.2 Krytyczne (P1)

1. **Bomba zegarowa w `initialize_database_file_once` cache** — [dashboard/src-tauri/src/db.rs:22-25](dashboard/src-tauri/src/db.rs#L22-L25), używana z `set_demo_mode` (`lib.rs`). `OnceLock<Mutex<HashSet<String>>>` nie weryfikuje, czy plik DB dalej istnieje. Użytkownik usuwa plik ręcznie → cache hit → brak migracji → stan rozjechany.
   - Fix: sprawdzaj `path.exists()` przed cache hitem lub inwalidacja przy błędzie read/write.

2. **`format!("VACUUM INTO '{}'")` z ręcznym escape** — [dashboard/src-tauri/src/commands/sync_markers.rs:94-115](dashboard/src-tauri/src/commands/sync_markers.rs#L94-L115). Duplikat `db::perform_backup_internal`. Wzorcowo zrobione w [dashboard/src-tauri/src/commands/settings.rs:348-350](dashboard/src-tauri/src/commands/settings.rs#L348-L350) — `SELECT quote(?1)`.

### 5.3 Ważne (P2)

1. **Niespójność async/blocking w niektórych handlerach**
   - Sync `pub fn` dotykające DB uruchamiane na wątku runtime Tauri:
     - [dashboard/src-tauri/src/commands/manual_sessions.rs:17,84,141,181,189](dashboard/src-tauri/src/commands/manual_sessions.rs#L17)
     - [dashboard/src-tauri/src/commands/sync_markers.rs:35,66,93,143](dashboard/src-tauri/src/commands/sync_markers.rs#L35) (+ VACUUM INTO)
     - [dashboard/src-tauri/src/commands/lan_sync.rs:290](dashboard/src-tauri/src/commands/lan_sync.rs#L290) `build_table_hashes_only` — `group_concat` po wszystkich sesjach.
   - Tauri 2 obsługuje sync commands na osobnej puli, ale pod obciążeniem UI + syncu to ogonowa latencja.
   - Fix: konsekwentnie `run_db_blocking`.

2. **`build_http_client` silent fallback** — [dashboard/src-tauri/src/commands/lan_sync.rs:552-557](dashboard/src-tauri/src/commands/lan_sync.rs#L552-L557) `.unwrap_or_else(|_| Client::new())`. Może paniekować przy braku TLS rootów; zwróć `Result`.

3. **CSP w `tauri.conf.json:26`** restrykcyjne, ale brakuje `base-uri 'self'` i `form-action 'self'` (hardening).

4. **Capabilities** — `default.json` minimum + okno + dialog + `$APPDATA/TimeFlow/**` (fs read-text + exists) jest dobrze zeskrołowane. Pliki typu `lan_peers.json` pisane przez Rust (`std::fs::write`) nie potrzebują capability. Dodaj komentarz wyjaśniający, by devowie nie dodawali zbędnych permissionów.

5. **`compute_table_hash`** — [dashboard/src-tauri/src/commands/helpers.rs:94-127](dashboard/src-tauri/src/commands/helpers.rs#L94-L127) `group_concat` bez limitu; przy >30k sesji uderzy w `SQLITE_MAX_LENGTH` → `unwrap_or_else(|_| "")` da pusty hash i `mismatch` w syncu. Loguj warn.

6. **`scan_lan_subnet`** — [dashboard/src-tauri/src/commands/lan_sync.rs:197](dashboard/src-tauri/src/commands/lan_sync.rs#L197). 254 tasków tokio równolegle, brak rate-limit/deduplikacji, brak check że IP jest w prywatnym zakresie przed pingiem. VPN/publiczne interfejsy mogą dostać ping.

7. **Duplikaty `get_lan_sync_log`** — [dashboard/src-tauri/src/commands/lan_sync.rs:129-136](dashboard/src-tauri/src/commands/lan_sync.rs#L129-L136) legacy fallback bez daty wycofania.

8. **Triggery retrainingu AI** — [dashboard/src-tauri/src/commands/monitored.rs:187,270,294](dashboard/src-tauri/src/commands/monitored.rs#L187) wywołują `retrain_model_sync` po `tx.commit()`. Retrain failuje → tylko warn. Jeśli atomowość z main transaction jest wymagana, wszystko w jednej transakcji.

### 5.4 Drobne / optymalizacje

- [dashboard/src-tauri/src/commands/pm_manager.rs:93](dashboard/src-tauri/src/commands/pm_manager.rs#L93) `path.parent().unwrap()` — `ok_or` + komunikat.
- Duplikacja SCHEMA vs migracje — sprawdź czy `resources/sql/schema.sql` na końcu `INSERT INTO schema_version VALUES (LATEST)` — inaczej świeża baza przelatuje wszystkie migracje bez potrzeby.
- [dashboard/src-tauri/src/commands/daemon/control.rs:195-205](dashboard/src-tauri/src/commands/daemon/control.rs#L195-L205) — ręczny JSON; użyj `serde_json::json!`.
- [dashboard/src-tauri/src/commands/daemon/control.rs:165,183](dashboard/src-tauri/src/commands/daemon/control.rs#L165) `tokio::time::sleep(1000ms)` między kill a start — lepszy `retry-until-port-free`.
- [dashboard/src-tauri/src/commands/dashboard.rs:34-44](dashboard/src-tauri/src/commands/dashboard.rs#L34-L44) `{ACTIVE_SESSION_FILTER_S}` format — OK, stałe SQL.
- [dashboard/src-tauri/src/db.rs:362-387](dashboard/src-tauri/src/db.rs#L362-L387) `optimize_database_internal` — próg `freelist/page ratio ≥ 0.20` do stałej nazwanej.
- `lan_peers.json` i `paired_devices` poza DB → restore DB nie trzyma peerów spójnie. Udokumentuj.

### 5.5 Martwy kod

- **[dashboard/src-tauri/src/refactor_db.py](dashboard/src-tauri/src/refactor_db.py)** — Python skrypt jednorazowy z hardcoded Windows path (`f:\\___APPS\\__TimeFlow\\...`). **Do usunięcia.**
- `LEGACY_*` w [dashboard/src-tauri/src/db.rs:17-19](dashboard/src-tauri/src/db.rs#L17-L19) + migracja `cfab_dashboard.db → timeflow_dashboard.db` — jeśli dystrybucja była wewnętrzna, ogranicz w czasie (np. do końca 2026) i usuń.
- `TODO: implement /online/cancel-sync endpoint` — [src/online_sync.rs:117](src/online_sync.rs#L117). Realny gap funkcjonalny.
- [dashboard/src-tauri/src/commands/types.rs](dashboard/src-tauri/src/commands/types.rs) 583 linie, `projects.rs` 1855 linii — kosmetyka, podziel.

### 5.6 Rekomendacje
1. Fix cache `initialize_database_file_once` — check existence.
2. Ujednolicić DB-async wzorzec (`run_db_blocking` wszędzie).
3. Usunąć `refactor_db.py`.
4. Test integracyjny „fresh DB po `initialize`" weryfikujący `schema_version == LATEST_SCHEMA_VERSION`.
5. `SELECT quote(?1)` wzorzec wszędzie gdzie VACUUM INTO.
6. `build_http_client` → `Result`.
7. CSP: dodaj `base-uri 'self'`, `form-action 'self'`.
8. Komentarz w `capabilities/default.json` — brak `fs:allow-write-text-file` celowy.

---

## 6. Parity Windows / macOS

Zakres: `src/platform/**`, `src/monitor*.rs`, `shared/**` z `#[cfg(target_os=...)]`, `build_all*.py`, `tauri.conf.json` vs `tauri.macos.conf.json`, `dashboard/src/lib/platform.ts`.

### 6.1 Mocne strony
- Symetryczna warstwa `src/platform/` z identycznymi modułami per-OS: `firewall`, `foreground`, `process_snapshot`, `single_instance`, `tray` ([src/platform/mod.rs:5-17](src/platform/mod.rs#L5-L17)).
- Wspólne typy (`process_info.rs`, `foreground_signal.rs`, `tray_common.rs`) izolują kontrakt cross-platform.
- `ForegroundSignal` (Condvar + VecDeque) — cross-platform, brak `#[cfg]` w trackerze.
- `monitor_macos.rs:17-62` eksponuje te same typy (`ProcessInfo`, `PidCacheEntry`, `PidCache`, `CpuSnapshot`, `ProcessSnapshot`).
- Sleep-detection wall-clock vs Instant — działa na obu bez OS-specific callbacków.
- Single instance: Named Mutex (Win) vs flock (Mac), oba z RAII + `TrayText::AlreadyRunning`.
- `build_all_macos.py` (commit 7304a9d) ma parytetowy app-kill + dist cleanup; graceful-quit przez AppleScript bardziej zaawansowany niż Windows.

### 6.2 Krytyczne braki funkcji (P1)

1. **`window_title = String::new()` na macOS** — [src/monitor_macos.rs:191](src/monitor_macos.rs#L191). Łamie AI (Layer 3 tokeny w [dashboard/src-tauri/src/commands/assignment_model/training.rs:360-369](dashboard/src-tauri/src/commands/assignment_model/training.rs#L360-L369)) i file-tracking. Priorytet P1: zaimplementować przez AX API + prompt o zgody. Minimum: `CGWindowListCopyWindowInfo` + `kCGWindowName` dla frontmost-app.

2. **`detected_path = None` na macOS** — [src/monitor_macos.rs:183](src/monitor_macos.rs#L183) stub. Osłabia AI Layer 0 (file_project_weights) i Layer 3b (folder tokens). Windows ma pełen `wmi_detection.rs` (332 linie). Rekomendacja: `lsof -p PID` albo `ps -p PID -o command=` (VSCode, Sublime argv).

3. **Brak `monitor/wmi_detection.rs` odpowiednika dla macOS** — nie ma ścieżki do czytania command-line/argv procesu.

4. **Foreground watcher polling 250 ms na macOS vs event-driven `SetWinEventHook` Windows** — [src/platform/macos/foreground.rs:16](src/platform/macos/foreground.rs#L16). Zużywa CPU w idle, gorsza reakcja przy szybkich przełączeniach. Lepszy: `NSWorkspace.didActivateApplicationNotification` (NSRunLoop już jest w tray-loop).

5. **Tray UI macOS nie używa i18n (regresja CLAUDE.md p.2)** — [src/platform/macos/tray.rs:108-112](src/platform/macos/tray.rs#L108-L112). Menuitemy hardcoded po angielsku: „Open Dashboard", „Sync Now (delta)", „Quit TIMEFLOW Demon". Windows `tray.rs` używa `TrayText::*` i dynamicznie przełącza język. Fix: zastosuj `TrayText::*`.

### 6.3 Ważne (P2)

1. **Brak sync-status w tray macOS** — Windows ma `update_tray_appearance`, `menu_sync_status`, `was_syncing`, powiadomienia + `query_unassigned_attention_count` tooltip ([src/platform/windows/tray.rs:170-330](src/platform/windows/tray.rs#L170-L330)). Mac ma tylko „Sync Now" bez statusu. Użytkownik Maca nie wie ile sesji czeka na klasyfikację.

2. **`tauri.macos.conf.json` bez `security.csp`** — zweryfikować, że merge Tauri dziedziczy `security.csp` z bazowego (Tauri robi shallow merge `app.windows[0]` — globalny CSP powinien zostać). Udokumentować.

3. **`isMacOS()` na `navigator.platform`** (deprecated) — [dashboard/src/lib/platform.ts:4](dashboard/src/lib/platform.ts#L4). Fallback na `userAgent`. W Tauri v2 dostępne `@tauri-apps/api/os` — użyj runtime check z fallbackiem UA dla dev/browser.

4. **`build_all_macos.py` 534 linie vs `build_all.py` 97 linii** — podwojenie logiki. Windows deleguje do `build_common.py`/`build_demon.py`; Mac ma wszystko inline. Ryzyko driftu, m.in. weryfikacja locales (`compare_locales.py` w `build_all.py:57-79`) — sprawdź czy jest w macOS.

### 6.4 Drobne (P3)

- [src/main.rs:184-199](src/main.rs#L184-L199) `#[cfg(windows)]` version-mismatch MessageBox — na macOS brak alertu, tylko log. Dodaj `osascript -e 'display dialog ...'`.
- [src/main.rs:105-129](src/main.rs#L105-L129) `#[cfg(not(windows))] { let _ = ...; let _ = ...; }` drop-only bloki — niepotrzebne.
- Komentarz [src/platform/macos/mod.rs:2](src/platform/macos/mod.rs#L2) „Faza 1: stuby..." nieaktualny; Fazy 3 już zastąpiły implementacje (oprócz `firewall.rs`, celowo no-op).
- [dashboard/src/components/layout/TopBar.tsx:88](dashboard/src/components/layout/TopBar.tsx#L88) `tauriRuntime && !onMac` — udokumentować w Help.

### 6.5 Rekomendacje
1. **P1:** AX API dla `window_title` na macOS.
2. **P1:** i18n menu tray macOS przez `TrayText::*`.
3. **P2:** sync status + attention counter w tray macOS (skopiuj kontrakt z Windows).
4. **P3:** NSWorkspace notifications zamiast pollingu 250 ms.
5. **P4:** unifikacja `build_all*.py` — `kill_running_processes()`, `dist_clean()` do `build_common.py`.
6. **P4:** `isMacOS()` przez `@tauri-apps/api/os`.

---

## 7. Moduł AI (assignment model)

Zakres: `dashboard/src-tauri/src/commands/assignment_model/**`, `dashboard/src/components/ai/**`, `dashboard/src/pages/AI.tsx`.

### 7.1 Mocne strony
- Czytelna architektura multi-layer scoring ([dashboard/src-tauri/src/commands/assignment_model/scoring.rs:132-150](dashboard/src-tauri/src/commands/assignment_model/scoring.rs#L132-L150)): Layer 0 (file→project), 1 (app), 2 (time/weekday), 3 (file/title tokens), 3b (folder tokens). Deterministyczne, tłumaczalne.
- Decay exponential z half-life matematycznie poprawny ([training.rs:86](dashboard/src-tauri/src/commands/assignment_model/training.rs#L86) `86=ln(2)/half_life`), parametryzowalne 14-365 dni.
- Feedback weighting ([training.rs:229-251](dashboard/src-tauri/src/commands/assignment_model/training.rs#L229-L251)) — accept vs reject-change, penalty na `from_project_id`, split feedback z testami jednostkowymi (`tests` w [training.rs:574-697](dashboard/src-tauri/src/commands/assignment_model/training.rs#L574-L697)).
- Atomic `is_training` guard przez `UPDATE ... WHERE value='false'` ([training.rs:50-53](dashboard/src-tauri/src/commands/assignment_model/training.rs#L50-L53)).
- S21 fix `handleSaveMode` — bezpośredni fetch status zamiast `refreshAiStatus` z in-flight guardem ([dashboard/src/pages/AI.tsx:348-354](dashboard/src/pages/AI.tsx#L348-L354)).
- Rollback dla Auto-Safe ([auto_safe.rs](dashboard/src-tauri/src/commands/assignment_model/auto_safe.rs)).
- Migracje m08 (weight), m11 (session_project_cache), m20 (project_name) — czysta separacja.
- Clamp + default na wejściu API ([mod.rs:487-512,540-551,553-564](dashboard/src-tauri/src/commands/assignment_model/mod.rs#L487)).

### 7.2 Krytyczne (P1)

1. **Zombie `is_training` przy panice** — [training.rs:50-64,404](dashboard/src-tauri/src/commands/assignment_model/training.rs#L50). `upsert_state(conn, "is_training", "false")` wykonuje się tylko po powrocie z closure. Panic w środku batcha → flaga zostaje `true` na zawsze, kolejny retrain blokowany.
   - Fix: RAII guard `IsTrainingGuard` z `Drop` resetującym flagę, albo `catch_unwind`.

2. **Brak walidacji `min_confidence_auto >= min_confidence_suggest`** — UI pozwala ustawić suggest=0.95 i auto=0.50. `set_assignment_mode` klampuje niezależnie do 0..1 ([mod.rs:495-498](dashboard/src-tauri/src/commands/assignment_model/mod.rs#L495-L498)). Semantyka wtedy bzdurna: sugestie od 0.95, auto-przypis od 0.50.
   - Fix: `set_assignment_mode` zwraca Err lub auto-podbija suggest.

3. **Brak wyjaśnienia „dlaczego AI sugeruje X" w UI** — `SuggestionBreakdown` + `get_session_score_breakdown` już istnieją w Rust ([mod.rs:60-67,686-694](dashboard/src-tauri/src/commands/assignment_model/mod.rs#L60-L67)), ale w `components/ai/*.tsx` nie ma komponentu renderującego per-layer score. `AiSessionIndicatorsCard` ma klucz `showScoreBreakdown`, sama logika brakuje. Zgodnie z CLAUDE.md p.3 (Help powinno tłumaczyć „co to robi, kiedy użyć, ograniczenia") — należy dodać UI + opis.

### 7.3 Ważne (P2)

1. **`DEFAULT_TRAINING_HORIZON_DAYS=730`** (2 lata) default ([config.rs:11](dashboard/src-tauri/src/commands/assignment_model/config.rs#L11)) dla użytkownika z 3-miesięczną historią = niepotrzebny koszt I/O. Zmień na `min(730, actual_data_span)`.

2. **Full DELETE + REINSERT** wszystkich `_app`/`_time`/`_token` per retrain. Brak incremental training. `feedback_since_train < 30` guard pomaga, ale przy dużych DB retrain trwa sekundy. Rekomendacja: `last_train_at` + delta.

3. **`run_auto_safe_assignment` w jednej transakcji** ([auto_safe.rs:102](dashboard/src-tauri/src/commands/assignment_model/auto_safe.rs#L102)) — 10k sesji = minuty blokady WAL. Batchuj po 500.

4. **S21 fix nie w pełni uniwersalny** — [dashboard/src/pages/AI.tsx:300,307,170-175](dashboard/src/pages/AI.tsx#L300) `usePageRefreshListener` + `handleVisibilityChange` wywołują `refreshModelData(true)` przed zmianami formularza. `dirtyRef` chroni, ale po save gdy dirty=false kolejny visibility event może cofnąć stan. Dodaj test e2e.

5. **`feedback_weight` osobny endpoint** — `getFeedbackWeight` ([ai.ts:89](dashboard/src/lib/tauri/ai.ts#L89)) poza `AssignmentModelStatus`. Po `handleSaveMode` trzeba osobno `await aiApi.getFeedbackWeight()`. Ryzyko desynchronizacji — dołącz do `AssignmentModelStatus`.

6. **`reset_assignment_model_knowledge` wyciera `assignment_feedback`** — [training.rs:16-46](dashboard/src-tauri/src/commands/assignment_model/training.rs#L16-L46), linia 24. Feedback kosztował user manual effort — to GOLD. Normalnie chce się wyczyścić derived counts, zachować korekcje.
   - Fix: split na „Reset model" (tylko `_app/_time/_token`) vs „Full reset" (+feedback).

7. **Braki macOS pchają Layer 3 w dół** — brak `window_title` i `detected_path` na macOS (patrz sekcja 6). Użytkownik tego nie wie — jakość predykcji skokowo niższa.

8. **Brak metryk quality per-project** — `AssignmentModelMetrics` ([mod.rs:94-125](dashboard/src-tauri/src/commands/assignment_model/mod.rs#L94-L125)) agreguje precision globalnie. Brak drill-down — user nie wie który projekt ma konflikt klas.

### 7.4 Drobne

- String-based KV w `assignment_model_state` — wszystko TEXT (`format!("{:.4}")`), koszt parse/format per status fetch.
- `MAX_TRAINING_HORIZON_DAYS=730` hardcoded — 5-letnia historia odpada.
- `AUTO_SAFE_MIN_MARGIN=0.20` stała — advanced user mógłby chcieć wyższej.
- Tokenizacja ścieżek (`context.rs`) — różne tokeny dla `\\` vs `/` separatorów → cross-platform zweryfikować.
- `create_scalar_function("exp", ...)` ([training.rs:99-108](dashboard/src-tauri/src/commands/assignment_model/training.rs#L99-L108)) registrowana co retrain — design-smell, nie problem.
- `apply_deterministic_assignment` ([mod.rs:652-661](dashboard/src-tauri/src/commands/assignment_model/mod.rs#L652-L661)) — alternatywna ścieżka obok `auto_safe`? Do weryfikacji, czy nie duplikat.
- `get_session_score_breakdown` komenda eksponowana, ale brak odwołania w React — martwa albo używana z SessionDetails.

### 7.5 Rekomendacje
1. **P1:** RAII guard `is_training`.
2. **P1:** Walidacja `auto >= suggest`.
3. **P1:** UI breakdown per layer (backend kontrakt gotowy).
4. **P2:** Split reset na soft/hard (zachowuj feedback).
5. **P2:** `feedback_weight` w `AssignmentModelStatus`.
6. **P2:** Help.tsx — pełny opis AI (confidence, tryby, kiedy auto_safe, training horizon, limity). CLAUDE.md p.3 obligatoryjne.
7. **P3:** Incremental retraining (delta od `last_train_at`).
8. **P3:** Per-project precision.
9. **P4:** Konfigurowalny `AUTO_SAFE_MIN_MARGIN`.

---

## 8. i18n (PL/EN) i dokumentacja Help

### 8.1 Parity kluczy PL/EN — **100%**
- **1778 kluczy w PL = 1778 w EN.** 0 brakujących w obu kierunkach. 0 pustych/null.
- 35 kluczy ma wartość identyczną w PL i EN — większość to nazwy własne (Dashboard, BugHunter, LAN Sync, Master, Slave, VS Code), nie wymagają tłumaczenia.
- Jedyny realnie podejrzany: `settings.lan_sync.force_sync = "Force Sync"` (PL = EN) — kandydat na „Wymuś synchronizację".

### 8.2 🔴 Krytyczna regresja w EN — brakujące klucze używane w kodzie

W [dashboard/src/components/sessions/SessionContextMenu.tsx](dashboard/src/components/sessions/SessionContextMenu.tsx) używane są 3 klucze, których **nie ma w żadnym locale**. Działa tylko fallback (drugi argument `t()`) z twardym polskim tekstem — w EN-UI tooltipy są po polsku.

| Plik:linia | Klucz | Fallback (PL) | Proponowane EN |
|---|---|---|---|
| `SessionContextMenu.tsx:178` | `sessions.menu.mode_alpha` | „Aktywne alfabetycznie (A-Z)" | „Active alphabetically (A-Z)" |
| `SessionContextMenu.tsx:196` | `sessions.menu.mode_new_top` | „Najnowsze → Top → Reszta (A-Z)" | „Newest → Top → Rest (A-Z)" |
| `SessionContextMenu.tsx:214` | `sessions.menu.mode_top_new` | „Top → Najnowsze → Reszta (A-Z)" | „Top → Newest → Rest (A-Z)" |

**Fix:** dodać klucze do `dashboard/src/locales/pl/common.json` i `dashboard/src/locales/en/common.json`.

### 8.3 Hardcoded stringi bez `t()`

- 🔴 [dashboard/src/components/ai/AiBatchActionsCard.tsx:65](dashboard/src/components/ai/AiBatchActionsCard.tsx#L65) — `content={!modeIsAutoSafe ? 'Set mode to "auto safe" first' : undefined}`. Dodaj klucz `ai_page.batch.tooltip_requires_auto_safe` w PL/EN.
- Drobne (placeholders — OK zostawić):
  - [dashboard/src/components/pm/PmCreateProjectDialog.tsx:92](dashboard/src/components/pm/PmCreateProjectDialog.tsx#L92) `placeholder="ACME"`
  - [dashboard/src/components/pm/PmCreateProjectDialog.tsx:103](dashboard/src/components/pm/PmCreateProjectDialog.tsx#L103) `placeholder="Website"`
  - numeryczne placeholders w Estimates — OK.
- `alt="TIMEFLOW"`, `alt="CONCEPTFAB"` w Help.tsx — literały brand, OK.

**71/104 komponentów** używa `useTranslation`; pozostałe to prezentacyjne wrappery przyjmujące stringi z propsów (`settings/*Card.tsx`, `ai/AiBatchActionsCard.tsx`, etc.) — wzorzec poprawny. Grep po polskich znakach `ąćęłńóśżźĄĆĘŁŃÓŚŻŹ` w JSX zwrócił 0 wyników.

### 8.4 Pokrycie Help — wszystkie ostatnie feature'y opisane

| Feature (ostatnie 3 tygodnie) | Key i18n | Sekcja Help | Status |
|---|---|---|---|
| Native macOS traffic lights + logo po prawej | `help_page.dashboard_macos_native_window_controls` | Dashboard (`HelpSimpleSections.tsx:36`) | ✅ PL+EN |
| System Sleep Detection (pauza trackera) | `help_page.daemon_sleep_pause` | Daemon (`HelpSimpleSections.tsx:138`) | ✅ PL+EN |
| Persistent `project_name` (LAN sync) | `help_page.lan_sync_project_name_persist` | LAN Sync (`HelpLanSyncSection.tsx:20`) | ✅ PL+EN |
| AI settings save flow fix (S21) | n/d (wewnętrzny, bez UX change) | n/d | OK — changelog, nie Help |

Sekcje Help pokrywają wszystkie zakładki UI: **Quick Start, Dashboard, Sessions, Projects, Estimates, Applications, Time Analysis, AI Model, Data, Reports, PM, Daemon, Online Sync, LAN Sync, BugHunter, Settings**.

### 8.5 Funkcje do uzupełnienia w Help (P3)

- **PM Template Manager** (`pm_template_manager`) — wspomniany, ale brak szczegółów how-to (placeholders, podmiany).
- **Sleep Pause** — opisane w Daemon, ale mogłoby być też krótkie zdanie w Quick Start / Dashboard (tłumaczy dlaczego sesja kończy się po wybudzeniu).
- **AI breakdown „dlaczego sugeruje X"** — po dodaniu komponentu breakdown w UI (P1 z sekcji 7) dopisz opis do Help AI.

### 8.6 `compare_locales.py` — hardcoded Windows paths

Skrypt ma ścieżki typu `c:\_cloud\…`. Na macOS/Linux nie działa bez patcha. Fix: ścieżki relatywne od `__file__` (`Path(__file__).parent / "dashboard/src/locales"`).

### 8.7 Rekomendacje
1. **P1:** Dodać 3 brakujące klucze `sessions.menu.mode_alpha|mode_new_top|mode_top_new` do PL/EN.
2. **P1:** Zastąpić hardcoded tooltip w `AiBatchActionsCard.tsx:65` wywołaniem `t()`.
3. **P2:** Przetłumaczyć „Force Sync" → „Wymuś synchronizację" w PL.
4. **P3:** Naprawić `compare_locales.py` (ścieżki relatywne).
5. **P3:** Dopisać krótkie wzmianki do Help (Sleep Pause w Quick Start, AI breakdown po dodaniu UI).

---

## 9. Plan działania — priorytetyzacja

### P0 — bezpieczeństwo (do naprawy natychmiast)

| # | Obszar | Problem | Plik |
|---|---|---|---|
| 1 | LAN security | `/lan/local-identity` oddaje secret bez auth | [src/lan_server.rs:484-488,1196-1207](src/lan_server.rs#L484) |
| 2 | LAN security | `/lan/pair` bez per-IP rate-limit — brute-force | [src/lan_server.rs:1178-1187](src/lan_server.rs#L1178) |

### P1 — krytyczne bugi / regresje (przed następnym wydaniem)

| # | Obszar | Problem | Plik |
|---|---|---|---|
| 3 | Demon macOS | `measure_cpu_for_app` zwraca 0 — background tracking nie działa | [src/monitor_macos.rs:225,244-295](src/monitor_macos.rs#L225) |
| 4 | Demon macOS | `window_title = ""` — AI Layer 3 + file-tracking zepsute | [src/monitor_macos.rs:191](src/monitor_macos.rs#L191) |
| 5 | Demon | Shutdown nie czeka na thread online-sync (brak JoinHandle) | [src/main.rs:119-145](src/main.rs#L119) |
| 6 | Demon | Idle liczone niespójnie dla foreground vs background CPU | [src/tracker.rs:602-703](src/tracker.rs#L602) |
| 7 | Demon | DST → false-positive sleep detection | [src/tracker.rs:440-546](src/tracker.rs#L440) |
| 8 | Sync | Merge bez muteksu — race z trackerem | [src/sync_common.rs:266-850](src/sync_common.rs#L266) |
| 9 | Sync | Tombstone po `start_time` kasuje cross-machine | [src/sync_common.rs:797-808](src/sync_common.rs#L797) |
| 10 | Tauri | `initialize_database_file_once` cache nie widzi usunięcia pliku | [dashboard/src-tauri/src/db.rs:22-25](dashboard/src-tauri/src/db.rs#L22) |
| 11 | AI | Zombie `is_training` przy panice | [dashboard/src-tauri/src/commands/assignment_model/training.rs:50-64,404](dashboard/src-tauri/src/commands/assignment_model/training.rs#L50) |
| 12 | AI | Brak walidacji `min_confidence_auto >= min_confidence_suggest` | [dashboard/src-tauri/src/commands/assignment_model/mod.rs:495-498](dashboard/src-tauri/src/commands/assignment_model/mod.rs#L495) |
| 13 | AI/UI | Brak UI dla „dlaczego AI sugeruje X" (backend gotowy) | [dashboard/src/components/ai/](dashboard/src/components/ai/) |
| 14 | i18n EN | Brakujące klucze `sessions.menu.mode_*` — EN pokazuje PL fallbacki | [dashboard/src/locales/en/common.json](dashboard/src/locales/en/common.json) |
| 15 | UI | `onSaved={triggerRefresh}` niezgodny z kontraktem | [dashboard/src/pages/Projects.tsx:1128](dashboard/src/pages/Projects.tsx#L1128) |
| 16 | UI | Hardcoded angielski tooltip w `AiBatchActionsCard.tsx:65` | [dashboard/src/components/ai/AiBatchActionsCard.tsx:65](dashboard/src/components/ai/AiBatchActionsCard.tsx#L65) |
| 17 | Parity mac | Tray macOS menu hardcoded po angielsku (regresja CLAUDE.md p.2) | [src/platform/macos/tray.rs:108-112](src/platform/macos/tray.rs#L108) |

### P2 — ważne (architektura, perf, hardening)

| # | Obszar | Problem | Plik |
|---|---|---|---|
| 18 | Demon | `open_daily_store` otwiera nowe połączenie co `save_daily` | [src/storage.rs:128](src/storage.rs#L128) |
| 19 | Demon | Idle wliczany do `Session.duration_seconds` | [src/tracker.rs:198,326-330](src/tracker.rs#L198) |
| 20 | Demon | `.expect()` w tray macOS (panic w wątku głównym) | [src/platform/macos/tray.rs:34,86](src/platform/macos/tray.rs#L34) |
| 21 | Demon | Duplikacja `extract_file_from_title`, `classify_activity_type`, `collect_descendants` | [src/monitor.rs](src/monitor.rs), [src/monitor_macos.rs](src/monitor_macos.rs) |
| 22 | Sync | Auto-unfreeze kolizja z SYNC_TIMEOUT | [src/lan_server.rs:253-269,323-327](src/lan_server.rs#L253) |
| 23 | Sync | Martwy `get_local_marker_created_at_with_conn` fallback | [src/lan_sync_orchestrator.rs:723-725,738](src/lan_sync_orchestrator.rs#L723) |
| 24 | Sync | Merge 200 MB JSON = 3× RAM | [src/sync_common.rs:267-290](src/sync_common.rs#L267) |
| 25 | Sync | Progress upload bez callbacka podczas wysyłania body | [src/lan_sync_orchestrator.rs:141-172](src/lan_sync_orchestrator.rs#L141) |
| 26 | Sync | Indeks `updated_at` na obu tabelach sesji + tombstones | migracje |
| 27 | Tauri | Niespójność sync vs `run_db_blocking` w manual_sessions, sync_markers, lan_sync | [dashboard/src-tauri/src/commands/manual_sessions.rs:17](dashboard/src-tauri/src/commands/manual_sessions.rs#L17) |
| 28 | Tauri | `format!("VACUUM INTO '{}'")` zamiast `SELECT quote(?1)` | [dashboard/src-tauri/src/commands/sync_markers.rs:94-115](dashboard/src-tauri/src/commands/sync_markers.rs#L94) |
| 29 | Tauri | `build_http_client` silent fallback | [dashboard/src-tauri/src/commands/lan_sync.rs:552-557](dashboard/src-tauri/src/commands/lan_sync.rs#L552) |
| 30 | UI | Destrukturyzacja całego storu bez selektorów (>10 miejsc) | sekcja 4.3.1 |
| 31 | UI | `ConfirmDialog` zwrócony z `useCallback` — zmień na komponent | [dashboard/src/components/ui/confirm-dialog.tsx:39-59](dashboard/src/components/ui/confirm-dialog.tsx#L39) |
| 32 | UI | God-components: Sessions.tsx 840, Projects.tsx 1134, useSettingsFormState 27KB | sekcja 4.3.3 |
| 33 | UI | Toast Provider tworzy świeży value per render | [dashboard/src/components/ui/toast-notification.tsx:58](dashboard/src/components/ui/toast-notification.tsx#L58) |
| 34 | UI | Double-update `aiStatus` w dwóch ścieżkach store | `background-status-store.ts` |
| 35 | UI | `setTimeout` bez cleanup: useBackgroundSync, useJobPool, Sidebar | 4.2.3 |
| 36 | Parity mac | Brak sync-status + attention counter w tray | [src/platform/macos/tray.rs](src/platform/macos/tray.rs) |
| 37 | Parity mac | Polling 250 ms foreground — NSWorkspace notifications | [src/platform/macos/foreground.rs:16](src/platform/macos/foreground.rs#L16) |
| 38 | AI | Full DELETE + REINSERT per retrain; brak incremental | [training.rs](dashboard/src-tauri/src/commands/assignment_model/training.rs) |
| 39 | AI | Reset knowledge wyciera `assignment_feedback` (GOLD) | [training.rs:16-46](dashboard/src-tauri/src/commands/assignment_model/training.rs#L16) |
| 40 | AI | `feedback_weight` osobny endpoint — dołącz do `AssignmentModelStatus` | [ai.ts:89](dashboard/src/lib/tauri/ai.ts#L89) |
| 41 | AI | Auto-safe batch w jednej transakcji (10k sesji = minuty blokady WAL) | [auto_safe.rs:102](dashboard/src-tauri/src/commands/assignment_model/auto_safe.rs#L102) |
| 42 | i18n | „Force Sync" PL = EN — przetłumaczyć na „Wymuś synchronizację" | [settings.lan_sync.force_sync](dashboard/src/locales/pl/common.json) |

### P3 — drobne optymalizacje i porządki

| # | Obszar | Problem | Plik |
|---|---|---|---|
| 43 | Demon | `drain_switch_times()` alokacja Vec per tick | [src/tracker.rs:557-558](src/tracker.rs#L557) |
| 44 | Demon | `GetTickCount()` DWORD rollover 49.7 dnia — sanity clamp | [src/monitor.rs:218-226](src/monitor.rs#L218) |
| 45 | Demon | 10× refresh sysinfo per tick na macOS | [src/monitor_macos.rs:273-277](src/monitor_macos.rs#L273) |
| 46 | Demon | Log-file bez rotacji (1 MB truncate) | [src/main.rs:261-272](src/main.rs#L261) |
| 47 | Demon | `last_save = Instant::now()` — utrata danych przy pustym restarcie | [src/tracker.rs:441-450](src/tracker.rs#L441) |
| 48 | Demon | LANG_CACHE nie cachuje negatywnego wyniku | [src/i18n.rs:120-137](src/i18n.rs#L120) |
| 49 | Demon | Restart: `thread::sleep(200ms)` między drop a spawn | [src/main.rs:170-181](src/main.rs#L170) |
| 50 | Sync | Drugi `remove_file` na `lan_server.rs:935` — dead code | [src/lan_server.rs:935](src/lan_server.rs#L935) |
| 51 | Sync | `SftpClient::Drop` nie zeruje host/port | [src/sftp_client.rs:24-33](src/sftp_client.rs#L24) |
| 52 | Sync | Niespójny `AUTO_SYNC_COOLDOWN` (60s) vs `TRIGGER_SYNC_COOLDOWN` (30s) | `src/lan_sync_orchestrator.rs`, `src/lan_server.rs` |
| 53 | Sync | Gate `[DIAG]` logów — produkcyjnie spamują lan_sync.log | [src/sync_common.rs](src/sync_common.rs) |
| 54 | Tauri | CSP `base-uri 'self'` + `form-action 'self'` | [dashboard/src-tauri/tauri.conf.json:26](dashboard/src-tauri/tauri.conf.json#L26) |
| 55 | Tauri | `compute_table_hash` — limit `group_concat`, loguj warn | [dashboard/src-tauri/src/commands/helpers.rs:94-127](dashboard/src-tauri/src/commands/helpers.rs#L94) |
| 56 | Tauri | `scan_lan_subnet` bez rate-limit i private-IP guard | [dashboard/src-tauri/src/commands/lan_sync.rs:197](dashboard/src-tauri/src/commands/lan_sync.rs#L197) |
| 57 | Tauri | `pm_manager.rs:93` `path.parent().unwrap()` — `ok_or` | [dashboard/src-tauri/src/commands/pm_manager.rs:93](dashboard/src-tauri/src/commands/pm_manager.rs#L93) |
| 58 | Tauri | `daemon/control.rs:195-205` — `serde_json::json!` zamiast ręcznego JSON | [dashboard/src-tauri/src/commands/daemon/control.rs:195](dashboard/src-tauri/src/commands/daemon/control.rs#L195) |
| 59 | UI | `lanPeers` polling nawet gdy `document.hidden` | [dashboard/src/components/layout/Sidebar.tsx:244-248](dashboard/src/components/layout/Sidebar.tsx#L244) |
| 60 | UI | Trzy osobne `useEffect` `Promise.allSettled` → konsolidacja | [dashboard/src/hooks/useProjectsData.ts:175-235](dashboard/src/hooks/useProjectsData.ts#L175) |
| 61 | UI | `usePersistedState(key, init)` helper zamiast 3× kopia | [dashboard/src/pages/Projects.tsx:222-229](dashboard/src/pages/Projects.tsx#L222) |
| 62 | UI | BugHunter — `alert()` + bezpośrednie `invoke` | [dashboard/src/components/layout/BugHunter.tsx:4,45,96](dashboard/src/components/layout/BugHunter.tsx#L4) |
| 63 | UI | `useClickOutsideDismiss(ref, onClose)` — TODO | [dashboard/src/pages/Sessions.tsx:252,311](dashboard/src/pages/Sessions.tsx#L252) |
| 64 | Parity mac | `isMacOS()` przez `@tauri-apps/api/os` | [dashboard/src/lib/platform.ts:4](dashboard/src/lib/platform.ts#L4) |
| 65 | Parity | `osascript` dialog dla wersji na macOS | [src/main.rs:184-199](src/main.rs#L184) |
| 66 | i18n | Napraw `compare_locales.py` — ścieżki relatywne | [compare_locales.py](compare_locales.py) |
| 67 | Help | PM Template Manager + Sleep Pause w Quick Start | [dashboard/src/components/help/sections/](dashboard/src/components/help/sections/) |

### P4 — martwy kod / porządki

| # | Co usunąć / uporządkować | Plik |
|---|---|---|
| 68 | Windows refactor script (hardcoded `f:\\___APPS\\...`) | [dashboard/src-tauri/src/refactor_db.py](dashboard/src-tauri/src/refactor_db.py) |
| 69 | `handle_status`, `StatusRequest/Response` (410) | [src/lan_server.rs:701-725](src/lan_server.rs#L701) |
| 70 | `handle_verify_ack` | [src/lan_server.rs:969-981](src/lan_server.rs#L969) |
| 71 | `handle_push` (410) | [src/lan_server.rs:1029-1046](src/lan_server.rs#L1029) |
| 72 | `handle_download_db` (nie wywoływane) | [src/lan_server.rs:948-967](src/lan_server.rs#L948) |
| 73 | `IPCONFIG_CACHE` niegatowane `#[cfg(windows)]` | [src/lan_discovery.rs:22-43](src/lan_discovery.rs#L22) |
| 74 | `PidCacheEntry` pola `#[allow(dead_code)]` nigdy nie czytane | [src/monitor_macos.rs:32](src/monitor_macos.rs#L32) |
| 75 | `CpuSnapshot.total_time` — nigdy odczytane | [src/monitor_macos.rs:50](src/monitor_macos.rs#L50) |
| 76 | `warm_path_detection_wmi` no-op | [src/monitor_macos.rs:100-102](src/monitor_macos.rs#L100) |
| 77 | `classify_activity_type` wrapper | [src/monitor.rs:161-163](src/monitor.rs#L161) |
| 78 | Nieaktualny komentarz „Faza 1: stuby" | [src/platform/macos/mod.rs:2](src/platform/macos/mod.rs#L2) |
| 79 | `online` zmienna przypisana ale nieużyta | [dashboard/src/components/layout/Sidebar.tsx:219-222](dashboard/src/components/layout/Sidebar.tsx#L219) |
| 80 | `import usePageRefreshListener` nieużyty | [dashboard/src/hooks/useLanSyncManager.ts:15](dashboard/src/hooks/useLanSyncManager.ts#L15) |
| 81 | `loadFirstSessionsPage` zwracane, nieużywane | [dashboard/src/hooks/useSessionsData.ts:157](dashboard/src/hooks/useSessionsData.ts#L157) |
| 82 | Artefakty w repo | `dashboard/fix_ai.py`, `dashboard/get_logs.py`, `dashboard/temp_bg_services.txt`, `dashboard/check.bat`, `dashboard/test_esbuild.mjs` |
| 83 | Duplikacja `open_dashboard_db*` (3 sposoby) | `src/lan_server.rs`, `src/lan_common.rs`, `src/sync_common.rs` |
| 84 | Duplikat `get_machine_name` | [src/lan_discovery.rs:128-130](src/lan_discovery.rs#L128) vs [src/lan_common.rs:85-87](src/lan_common.rs#L85) |
| 85 | `execute_online_sync` + `execute_online_sync_inner` identyczne | [src/online_sync.rs](src/online_sync.rs) |
| 86 | `LEGACY_*` migracja `cfab_dashboard.db` → usuń po Q4 2026 | [dashboard/src-tauri/src/db.rs:17-19](dashboard/src-tauri/src/db.rs#L17) |
| 87 | `TODO: /online/cancel-sync` endpoint | [src/online_sync.rs:117](src/online_sync.rs#L117) |

---

## 10. Rekomendacje procesowe

1. **Testy integracyjne syncu** — round-trip master→slave→master z 2 projektami i kilkoma sesjami; weryfikacja że `project_name` zachowane po 2 rundach (regresja m20).
2. **Test „fresh DB po `initialize`"** — weryfikuje `schema_version == LATEST_SCHEMA_VERSION` i brak brakujących kolumn. Chroni przed regresją f8b16e0.
3. **`PARITY.md`** deweloperski (poza Help.tsx) — jawna lista stubów macOS: `window_title=""`, `detected_path=None`, `measure_cpu` broken, tray-menu hardcoded EN.
4. **Lint-rule przeciw destrukturyzacji całego storu** — `no-destructure-store` lub custom eslint dla `useUIStore()`, `useDataStore()`, `useBackgroundStatusStore()`.
5. **Changelog**: opis fixa S21 (AI settings save), m20 (persistent project_name), sleep pause, macOS traffic lights — wartościowe dla użytkowników po upgrade.
6. **Audit security okresowy**: endpointy LAN HTTP z otwartą whitelistą → co release przegląd, co tam leci bez auth.
