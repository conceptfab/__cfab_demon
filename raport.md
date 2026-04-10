# TIMEFLOW — Raport audytu kodu

**Data:** 2026-04-10  
**Zakres:** Demon Rust (`src/`) + Dashboard React/Tauri (`dashboard/src/`)  
**Status aplikacji:** Działa poprawnie — raport dotyczy optymalizacji, bezpieczeństwa i jakości kodu

---

## Spis treści

1. [Krytyczne — wymagają natychmiastowej uwagi](#1-krytyczne)
2. [Demon Rust — poprawność i logika](#2-demon-rust--poprawność-i-logika)
3. [Demon Rust — wielowątkowość](#3-demon-rust--wielowątkowość)
4. [Demon Rust — wydajność](#4-demon-rust--wydajność)
5. [Demon Rust — synchronizacja LAN](#5-demon-rust--synchronizacja-lan)
6. [Demon Rust — synchronizacja Online](#6-demon-rust--synchronizacja-online)
7. [Demon Rust — nadmiarowy kod](#7-demon-rust--nadmiarowy-kod)
8. [Dashboard — UI/UX](#8-dashboard--uiux)
9. [Dashboard — wydajność](#9-dashboard--wydajność)
10. [Dashboard — zarządzanie stanem](#10-dashboard--zarządzanie-stanem)
11. [Dashboard — brakujące tłumaczenia](#11-dashboard--brakujące-tłumaczenia)
12. [Dashboard — nadmiarowy kod](#12-dashboard--nadmiarowy-kod)
13. [Dashboard — AI](#13-dashboard--ai)
14. [Dashboard — Sync UI](#14-dashboard--sync-ui)
15. [Help/Pomoc — brakująca dokumentacja](#15-helppomoc--brakująca-dokumentacja)
16. [Help/Pomoc — niekompletne sekcje](#16-helppomoc--niekompletne-sekcje)
17. [Help/Pomoc — niespójności terminologiczne](#17-helppomoc--niespójności-terminologiczne)
18. [Podsumowanie statystyczne](#18-podsumowanie-statystyczne)

---

## 1. Krytyczne

### 1.1 [HIGH] Pusty LAN secret = brak auth na wszystkich chronionych endpointach

**Plik:** `src/lan_server.rs` ~531-552  
**Problem:** Gdy `getrandom::getrandom()` zawiedzie (rzadkie, ale możliwe w VM), `get_or_create_lan_secret()` zwraca pusty `String`. Warunek auth:
```rust
if !expected.is_empty() && auth_secret != expected {
```
...oznacza, że pusty sekret **wyłącza auth** na wszystkich chronionych endpointach.  
**Fix:** Zwracać `Err` gdy getrandom zawiedzie. Odrzucać żądania wymagające auth gdy sekret jest pusty.

---

### 1.2 [HIGH] `/lan/local-identity` zwraca sekret bez uwierzytelnienia

**Plik:** `src/lan_server.rs` ~1071-1078, routing ~419-424  
**Problem:** Endpoint `/lan/local-identity` jest w grupie `requires_auth = false`. Zwraca `lan_secret.txt` — dowolna maszyna w sieci może go pobrać, a następnie użyć do uwierzytelnienia na chronionych endpointach.  
**Fix:** Przenieść `/lan/local-identity` do grupy wymagającej auth, albo usunąć `secret` z odpowiedzi (przekazywać go innym kanałem, np. przez Tauri command).

---

### 1.3 [HIGH] `return` przy stop_signal w backoff omija cleanup — deadlock stanu sync

**Plik:** `src/lan_sync_orchestrator.rs` ~323-329  
**Problem:** Gdy `stop_signal` jest ustawiony podczas backoff retry, wątek wykonuje `return` z wnętrza pętli `for attempt`, omijając blok cleanup na liniach 342-348. `sync_in_progress` pozostaje `true` na stałe — następne synchronizacje nigdy się nie rozpoczną.  
**Fix:** Użyć RAII guard (`SyncGuard` z `Drop` implementacją) zamiast manualnego resetu, analogicznie do wzorca z `main.rs`.

---

### 1.4 [HIGH] Token API w URL dla SSE — logowany przez proxy/CDN

**Plik:** `dashboard/src/lib/sync/sync-sse.ts` ~41-44  
**Problem:** Komentarz `SECURITY TODO` w kodzie. Token API trafia do `url.searchParams`, co oznacza logowanie przez serwery proxy, CDN i access logi.  
**Fix:** Migracja do short-lived SSE ticket (jednorazowy token wymieniany na sesję SSE).

---

### 1.5 [HIGH] Race condition na pliku wskaźnikowym upload-db

**Plik:** `src/lan_server.rs` ~726-730  
**Problem:** `handle_upload_db` zapisuje ścieżkę do `lan_sync_incoming_latest.txt`. Przy dwóch równoczesnych uploadach (MAX_CONNECTIONS = 32) jeden może nadpisać wskaźnik drugiego. `handle_db_ready` odczyta złe dane.  
**Fix:** Przekazywać ścieżkę pliku w żądaniu `db-ready` zamiast przez plik wskaźnikowy, lub chronić operację mutexem.

---

## 2. Demon Rust — poprawność i logika

### 2.1 [MEDIUM] Błąd logiki idle→active transition w tracker

**Plik:** `src/tracker.rs` ~545-556  
**Problem:** Przy przejściu z idle do active, `idle_ms` jest bliskie 0 (tuż po input), więc `active_portion_ms = idle_ms.min(elapsed_ms)` daje ~0. Zawsze zapisuje 1s (fallback `max(Duration::from_secs(1))`), zamiast pełnego `effective_elapsed`.  
**Fix:** Gdy `was_idle && !is_idle`, przypisać pełny `effective_elapsed` jako czas aktywny.

### 2.2 [MEDIUM] `handle_status` — `needs_pull == needs_push` zawsze (tautologia)

**Plik:** `src/lan_server.rs` ~648-660  
**Problem:** `needs_pull = needs_push` — informacja nie mówi która strona powinna nadpisać drugą. Endpoint wydaje się nieużywany w obecnym 13-krokowym protokole.  
**Fix:** Usunąć endpoint lub zaimplementować asymetryczne porównanie hashów.

### 2.3 [MEDIUM] TOCTOU w cache konfiguracji

**Plik:** `src/config.rs` ~334-341  
**Problem:** Odczyt mtime bez locka, potem lock i sprawdzenie cache. Między tymi operacjami plik może się zmienić. Komentarz w kodzie to dokumentuje (`Loose consistency`).  
**Fix:** Akceptowalne przy `config_reload_interval = 30s`, ale lock przed odczytem mtime eliminuje problem.

### 2.4 [LOW] `continue` pomija heartbeat/save/cache eviction

**Plik:** `src/tracker.rs` ~596-599  
**Problem:** Gdy `process_snapshot_cache` jest `None`, `continue` pomija heartbeat, zapis i czyszczenie cache. Sytuacja niemożliwa w normalnym działaniu.  
**Fix:** Zamienić `continue` na logowanie ostrzeżenia i fallback.

---

## 3. Demon Rust — wielowątkowość

### 3.1 [MEDIUM] `ACTIVE_PAIRING_CODE.lock().unwrap()` bez odtruwania

**Plik:** `src/lan_pairing.rs` ~31  
**Problem:** `generate_code()` i `validate_code()` używają `.unwrap()` zamiast `.unwrap_or_else(|e| e.into_inner())` (wzorzec stosowany w reszcie bazy). Panika w sekcji krytycznej zatruwa mutex — pairing przestaje działać.  
**Fix:** Użyć `unwrap_or_else(|e| e.into_inner())` jak w `config.rs`.

### 3.2 [MEDIUM] Fałszywy `stop_signal` przy fallback do session sync

**Plik:** `src/online_sync.rs` ~688  
**Problem:** `run_online_sync(settings, sync_state, Arc::new(AtomicBool::new(false)))` — nowy, niezwiązany `stop_signal`. Daemon nie może zatrzymać tego synca przy zamknięciu.  
**Fix:** Przekazywać oryginalny `stop_signal`.

### 3.3 [MEDIUM] Dwa globalne Muteksy z potencjalnym zagnieżdżeniem

**Plik:** `src/lan_common.rs` ~7-8  
**Problem:** `SYNC_LOG_MUTEX` lockuje, a wewnątrz lockuje `LOG_SETTINGS_CACHE`. Jeśli inny kod lockuje w odwrotnej kolejności — deadlock. Aktualnie bezpieczne, ale kruche.  
**Fix:** Udokumentować porządek lockowania. Rozważyć połączenie w jeden Mutex.

### 3.4 [LOW] `run_online_sync_forced` z fake stop_signal

**Plik:** `src/online_sync.rs` ~800-810  
**Problem:** Sync wymuszony z tray nie może być zatrzymany sygnałem stop demona.  
**Fix:** Analogicznie do 3.2 — przekazywać prawdziwy `stop_signal`.

---

## 4. Demon Rust — wydajność

### 4.1 [MEDIUM] Parsowanie dużego JSON (do 200MB) bez streamingu

**Plik:** `src/sync_common.rs` ~256-268  
**Problem:** `merge_incoming_data` parsuje cały payload do `serde_json::Value`. Przy 200MB = ~400-600MB RAM pik.  
**Fix:** Dla typowych baz (kilka MB) OK. Przy dużych: rozważyć `serde_json::StreamDeserializer` lub chunked processing.

### 4.2 [MEDIUM] Upload DB trzymany jako String zamiast Vec<u8>

**Plik:** `src/lan_server.rs` ~439-448  
**Problem:** `MAX_REQUEST_BODY = 50MB` jako `String` (UTF-8 konwersja + kopiowanie). Niepotrzebny overhead.  
**Fix:** Trzymać jako `Vec<u8>`, deserializować bezpośrednio.

### 4.3 [LOW] `monitored_exe_names` tworzy HashSet przy każdym load()

**Plik:** `src/config.rs` ~388-390  
**Problem:** Nowy `HashSet` co 30s. Koszt zaniedbywalny, ale cache HashSet w `ConfigCache` wyeliminowałby alokację.

### 4.4 [LOW] Master zawsze wysyła full export nawet w trybie delta

**Plik:** `src/lan_sync_orchestrator.rs` ~511-521  
**Problem:** Niezależnie od `transfer_mode`, master buduje i wysyła pełny eksport do slave'a. Marnotrawstwo transferu przy delta.  
**Fix:** W trybie delta wysyłać tylko zmienione dane.

---

## 5. Demon Rust — synchronizacja LAN

### 5.1 [HIGH] Endpointy mutujące bez auth (→ patrz 1.2)

`/lan/trigger-sync`, `/lan/store-paired-device`, `/lan/remove-paired-device` — dowolna maszyna w sieci może wymuszać sync lub modyfikować listę sparowanych urządzeń.

### 5.2 [MEDIUM] `ipconfig` subprocess zamiast WinAPI

**Plik:** `src/lan_discovery.rs`  
**Problem:** `get_ipconfig_output()` uruchamia `ipconfig` co 30s. Parsowanie outputu jest locale-dependent — na maszynach z nieangielskim systemem wyniki mogą być niepoprawne.  
**Fix:** Użyć WinAPI `GetAdaptersAddresses` (crate `windows` lub `ipconfig`).

### 5.3 [MEDIUM] Plik wskaźnikowy upload-db bez synchronizacji (→ patrz 1.5)

### 5.4 [MEDIUM] Komentarz `TODO(security)` w kodzie produkcyjnym

**Plik:** `src/lan_server.rs` ~292-295  
**Problem:** Znane zadanie bezpieczeństwa bez trackingu w systemie zarządzania. Ryzyko zapomnienia.  
**Fix:** Przenieść do issue trackera z priorytetem.

### 5.5 [LOW] `verify-ack` endpoint oznaczony DEPRECATED ale nadal w routerze

**Plik:** `src/lan_server.rs` ~871-882  
**Problem:** Endpoint `POST /lan/verify-ack` jest zarejestrowany ale według komentarza nie jest wywoływany. Kod cleanup (unfreeze, usuwanie plików) nadal aktywny.  
**Fix:** Usunąć endpoint lub zwrócić 410 Gone.

---

## 6. Demon Rust — synchronizacja Online

### 6.1 [MEDIUM] Jitter oparty na `subsec_millis`

**Plik:** `src/online_sync.rs` ~66-71  
**Problem:** `subsec_millis()` daje podobne wartości przy szybkich retries. Nie jest prawdziwie losowy.  
**Fix:** Użyć `getrandom` lub `thread_rng()` z `rand` crate.

### 6.2 [MEDIUM] TOFU host key bez ochrony integralności

**Plik:** `src/sftp_client.rs` ~70-98  
**Problem:** `known_sftp_hosts.json` w katalogu użytkownika bez podpisu. Atakujący z dostępem do `%APPDATA%/TimeFlow/` może podmienić plik i przeprowadzić MITM.  
**Fix:** Podpisywać plik hashem wiązanym z kluczem szyfrowania, lub przechowywać w Windows Credential Store.

### 6.3 [LOW] `expect()` w `derive_session_key`

**Plik:** `src/sync_encryption.rs` ~53-65  
**Problem:** `expect("HMAC accepts any key length")` — poprawne (HMAC SHA-256 akceptuje każdą długość), ale niespójne z resztą kodu która propaguje błędy.

---

## 7. Demon Rust — nadmiarowy kod

### 7.1 [LOW] `handle_pull` / `handle_push` jako legacy bez zabezpieczeń

**Plik:** `src/lan_server.rs` ~899-946  
**Problem:** Stare endpointy "backward compat" — `handle_push` nie zamraża DB i nie tworzy backupu. Luka bezpieczeństwa jeśli stary klient je wywołuje.

### 7.2 [LOW] Dwie osobne funkcje na jedno zapytanie SQL

**Plik:** `src/lan_sync_orchestrator.rs` ~622-630  
**Problem:** `get_local_marker_created_at_with_conn` i `get_local_marker_hash_with_conn` robią identyczne `SELECT ... FROM sync_markers ORDER BY created_at DESC LIMIT 1`.  
**Fix:** Jedna funkcja zwracająca `Option<(String, String)>`.

### 7.3 [LOW] Master zapisuje `slave_data` do pliku bez potrzeby

**Plik:** `src/lan_sync_orchestrator.rs` ~473-474  
**Problem:** Dane slave'a zapisywane do pliku tymczasowego, ale potem i tak przekazywane w pamięci do `merge_incoming_data`. Plik jest zbędny (pozostałość).

### 7.4 [LOW] `classify_activity_type` — cienka delegacja

**Plik:** `src/monitor.rs` ~161-163  
**Problem:** Jednolinijkowy wrapper na `timeflow_shared::activity_classification::classify_activity_type`. Można wywołać bezpośrednio.

---

## 8. Dashboard — UI/UX

### 8.1 [HIGH] Sesje — brak wyświetlenia błędu ładowania

**Plik:** `dashboard/src/pages/Sessions.tsx` ~144-157  
**Problem:** Hook `useSessionsData` zwraca `error: string | null`, ale `Sessions.tsx` nie destrukturyzuje go — żaden komunikat błędu nie jest pokazywany. Przy wyjątku z `getSessions()` interfejs pozostaje "pusty" bez informacji.  
**Fix:** Dodać `error` do destrukturyzacji i wyrenderować baner błędu.

### 8.2 [HIGH] ImportPanel — błędy walidacji i importu nie trafiają do UI

**Plik:** `dashboard/src/components/data/ImportPanel.tsx` ~45-70  
**Problem:** 3 bloki `catch` logują tylko `console.error`. Użytkownik nie widzi żadnego komunikatu.  
**Fix:** Dodać lokalny stan `error` lub `useToast().showError()`.

### 8.3 [MEDIUM] DatabaseManagement — brak wizualnego feedbacku przy błędzie loadAll

**Plik:** `dashboard/src/components/data/DatabaseManagement.tsx` ~39-52  
**Problem:** `loadAll()` łapie błąd przez `logTauriError` (konsola) bez stanu błędu w UI.

### 8.4 [MEDIUM] DaemonControl — błąd start/stop/restart bez UI feedback

**Plik:** `dashboard/src/pages/DaemonControl.tsx` ~158-173  
**Problem:** `catch (e) { console.error(e); }` — loading reset ale brak komunikatu.

### 8.5 [MEDIUM] Brak `role="tab"` / `aria-selected` w Settings i PM

**Pliki:** `dashboard/src/pages/Settings.tsx` ~435-449, `dashboard/src/pages/PM.tsx` ~202-218  
**Problem:** Własna tab-navigation bez atrybutów ARIA. Screen readery nie rozpoznają tych elementów.

### 8.6 [LOW] ExportPanel — błąd wczytywania projektów ignorowany

**Plik:** `dashboard/src/components/data/ExportPanel.tsx` ~27-29  
**Problem:** `loadProjectsAllTime().then(setProjects).catch(console.error)`.

---

## 9. Dashboard — wydajność

### 9.1 [HIGH] `Settings.tsx` — god component 837 linii

**Plik:** `dashboard/src/pages/Settings.tsx`  
**Problem:** Zarządza jednocześnie: stanem formularza, cyklem życia LAN sync (polling co 5s), UI tabów. 12 `useEffect`, 10+ lokalnych `useState`. Przy polling callbackach kaskadowe re-rendery.  
**Fix:** Wydzielić logikę LAN do osobnego hooka `useLanSyncManager`.

### 9.2 [MEDIUM] Inline arrow functions jako props do LanSyncCard

**Plik:** `dashboard/src/pages/Settings.tsx` ~621-763  
**Problem:** Dziesiątki inline handler-ów tworzonych na nowo przy każdym renderze (co 5s przez LAN polling).  
**Fix:** Wynieść do `useCallback` lub osobnego komponentu.

### 9.3 [MEDIUM] AI.tsx — 7 niezapamiętanych async handlerów

**Plik:** `dashboard/src/pages/AI.tsx` ~311-482  
**Problem:** Handlery bez `useCallback` tworzone na nowo przy re-renderze.

### 9.4 [LOW] DatabaseManagement — `loadAll` bez `useCallback`

**Plik:** `dashboard/src/components/data/DatabaseManagement.tsx` ~39  
**Problem:** Wywoływana w 8 miejscach, tworzona na nowo przy każdym renderze.

---

## 10. Dashboard — zarządzanie stanem

### 10.1 [MEDIUM] AI.tsx — `useBackgroundStatusStore.getState()` poza reactive context

**Plik:** `dashboard/src/pages/AI.tsx` ~342  
**Problem:** `.getState()` omija reaktywność Zustand. Wartość może być nieaktualna między `await` a odczytem.  
**Fix:** Użyć wartości zwróconej z `refreshAiStatus()`.

### 10.2 [LOW] `freezeThresholdDays` w Sessions nie reaguje na zmianę ustawień

**Plik:** `dashboard/src/pages/Sessions.tsx` ~452-454  
**Problem:** `useState(() => loadFreezeSettings().thresholdDays)` — one-time load. Zmiana w Settings wymaga przeładowania strony.

### 10.3 [LOW] `useSessionsData` — dwa systemy ładowania danych

**Plik:** `dashboard/src/hooks/useSessionsData.ts` ~53-69, 78-106  
**Problem:** `loadFirstSessionsPage` i `useEffect` oba wywołują `getSessions(buildFetchParams(0))`. Potencjalnie mogą się uruchomić jednocześnie.

---

## 11. Dashboard — brakujące tłumaczenia

### 11.1 [HIGH] PL fallback w OnlineSyncCard

**Plik:** `dashboard/src/components/settings/OnlineSyncCard.tsx` ~119  
```typescript
{t('settings.license.deactivate', 'Zmien licencje')}
```
**Problem:** Klucz istnieje w obu locale, ale fallback jest po polsku bez polskich znaków. Użytkownik EN zobaczy polski tekst przy braku klucza.  
**Fix:** Zmienić fallback na `'Change license'` lub usunąć.

### 11.2 [MEDIUM] PL fallback w SyncProgressOverlay

**Plik:** `dashboard/src/components/sync/SyncProgressOverlay.tsx` ~173  
```typescript
{t('sync_progress.frozen_notice', 'Rejestrowanie wpisów jest wstrzymane...')}
```
**Problem:** Fallback po polsku. Analogiczny problem jak 11.1.

### 11.3 [LOW] Mieszane PL/EN fallbacki w Sessions.tsx

**Plik:** `dashboard/src/pages/Sessions.tsx` ~508, 532  
**Problem:** Większość fallbacków jest EN, ale `sessions.menu.active_projects_az` ma PL fallback `'Aktywne projekty (A-Z)'`.

---

## 12. Dashboard — nadmiarowy kod

### 12.1 [MEDIUM] Duplikacja logiki context menu placement

**Plik:** `dashboard/src/pages/Sessions.tsx` ~251-310  
**Problem:** Komentarze TODO w kodzie: identyczna logika pozycjonowania menu kontekstowego i zamykania (Escape + mousedown) w co najmniej 2 miejscach.  
**Fix:** Wydzielić do `useContextMenuPlacement` hook.

### 12.2 [LOW] `renderDuration` duplikuje `getDurationParts` z utils

**Plik:** `dashboard/src/pages/Projects.tsx` ~96-134  
**Problem:** Logika podziału na hours/minutes/seconds duplikuje istniejącą funkcję.

---

## 13. Dashboard — AI

### 13.1 [MEDIUM] AiMetricsCharts — brak stanu "brak danych"

**Plik:** `dashboard/src/components/ai/AiMetricsCharts.tsx` ~56-60  
**Problem:** Gdy `loading = false` i `metrics = null`, wykresy renderują się z pustymi osiami. Brak informacji "brak danych / błąd".  
**Fix:** Dodać gałąź `!metrics && !loading` z komunikatem.

### 13.2 [LOW] AiBatchActionsCard — brak tooltipa na disabled przycisku

**Plik:** `dashboard/src/components/ai/AiBatchActionsCard.tsx` ~62-71  
**Problem:** "Run auto safe" jest `disabled` bez wyjaśnienia. Użytkownik nie wie, że musi najpierw ustawić tryb `auto_safe`.

### 13.3 [LOW] AI.tsx — brak loading state dla całej strony

**Plik:** `dashboard/src/pages/AI.tsx` ~564  
**Problem:** Gdy `status === null` (ładowanie), wszystkie karty wyświetlają null-guarded wartości bez widocznego skeleton/loading.

---

## 14. Dashboard — Sync UI

### 14.1 [MEDIUM] DaemonSyncOverlay — retry robi full sync

**Plik:** `dashboard/src/components/sync/DaemonSyncOverlay.tsx` ~72-79  
**Problem:** `lanSyncApi.runLanSync(peer.ip, peer.dashboard_port, '', false)` — pusty `since` = full sync od początku.  
**Fix:** Przekazywać last known marker jako `since`.

### 14.2 [LOW] SSE reconnect milcząco się zatrzymuje po 20 próbach

**Plik:** `dashboard/src/lib/sync/sync-sse.ts` ~20  
**Problem:** Po ~40 min SSE przestaje próbować, ale UI nie informuje użytkownika. Status sync w sidebarze może być nieaktualny.

### 14.3 [LOW] SyncProgressOverlay — brak timeout/retry counter

**Plik:** `dashboard/src/components/sync/SyncProgressOverlay.tsx` ~90-92  
**Problem:** Gdy daemon niedostępny, overlay pokazuje stary `progress` bez zmian aż do timeout (5 min) lub ręcznego dismiss.

---

## 15. Help/Pomoc — brakująca dokumentacja

Poniższe funkcje **istnieją** w aplikacji ale **nie mają** opisu w Help:

| # | Funkcja | Lokalizacja w kodzie |
|---|---------|---------------------|
| 15.1 | **Skrót F1** — kontekstowy Help | `Sidebar.tsx` ~246-255 |
| 15.2 | **PM Template Manager** — tworzenie/edycja szablonów folderów | `PmTemplateManager.tsx` |
| 15.3 | **PM PmProjectDetailDialog** — dialog edycji projektu (pola, akcje, TF Match) | `PmProjectDetailDialog.tsx` |
| 15.4 | **License section** w Online Sync — plan, group, device count, deaktywacja | `OnlineSyncCard.tsx` |
| 15.5 | **Sidebar Backup indicator** — co oznacza ShieldCheck, kiedy zielony/szary | `Sidebar.tsx` ~443-468 |
| 15.6 | **DevSettingsCard** — 4 kanały logów, poziomy logowania, auto-scroll | `DevSettingsCard.tsx` |
| 15.7 | **Data eksport selektywny** — jak wybrać projekty, co zawiera ZIP | `ExportPanel.tsx` |
| 15.8 | **DatabaseManagement vacuum** — co robi, kiedy uruchomić, konsekwencje | `DatabaseManagement.tsx` |
| 15.9 | **MultiSplitSessionModal** — szczegóły podziału na wiele projektów | `MultiSplitSessionModal.tsx` |
| 15.10 | **SessionsProjectContextMenu** — batch unassign, rozwinięcie/zwijanie grup | `SessionsProjectContextMenu.tsx` |
| 15.11 | **PM Clients** — kolory klientów, usuwanie, wpływ na projekty | `PmClientsList.tsx` |
| 15.12 | **LanPeerNotification** — szczegóły powiadomienia (przyciski, czas wyświetlania) | `LanPeerNotification.tsx` |

---

## 16. Help/Pomoc — niekompletne sekcje

| # | Sekcja | Problem |
|---|--------|---------|
| 16.1 | **HelpBughunterSection** | Praktycznie pusta — 3 pozycje powtarzające Settings. Brak: limit załącznika, formaty, adres zgłoszeń, status |
| 16.2 | **HelpOnlineSyncSection** | Brak opisu gdzie w UI wpisać klucz szyfrowania SFTP, jak go wygenerować |
| 16.3 | **HelpSettingsSection** | Zduplikowany `HelpDetailsBlock` "Online Sync setup" (też w HelpOnlineSyncSection) |
| 16.4 | **HelpDataSection** | `DataHistory` — jednozdaniowy opis, brak info co jest logowane, jak długo przechowywane |
| 16.5 | **HelpAiSection** | `Training Blacklists` — brak opisu jak skonfigurować w UI |
| 16.6 | **HelpQuickStartSection** | Brak info co się stanie przy ponownym uruchomieniu Quick Start |
| 16.7 | **HelpDaemonSection** | `Windows Autostart` — brak info o uprawnieniach, mechanizmie, co przy przeniesieniu .exe |
| 16.8 | **HelpReportsSection** | Brak opisu jak otworzyć ReportView (ścieżka użytkownika niekompletna) |

---

## 17. Help/Pomoc — niespójności terminologiczne

| # | Termin | Problem |
|---|--------|---------|
| 17.1 | **Freeze** | 3 polskie formy: "mrożenie", "zamrożenie", "mrożone" — w różnych kontekstach Help |
| 17.2 | **Quick Start** | 3 zapisy: "Quick Start", "Szybki start" (małe s), "SZYBKI START" (wielkie) |
| 17.3 | **BugHunter** | `HelpBughunterSection` używa `bughunter_detail_title` zamiast `bughunter` jako tytuł — niespójne z innymi sekcjami |
| 17.4 | **PM title** | `HelpPmSection` używa `t18n('pm.title')` zamiast `t18n('help_page.pm')` — jedyna sekcja z inną przestrzenią nazw |
| 17.5 | **LAN Sync tab vs sekcja** | Tab: `lan_sync_title` = "LAN Sync", sekcja: `lan_sync_setup_title` = "First LAN Sync setup" — różne tytuły |

---

## 18. Podsumowanie statystyczne

| Priorytet | Demon Rust | Dashboard | Help | Razem |
|-----------|-----------|-----------|------|-------|
| **HIGH** | 5 | 4 | — | **9** |
| **MEDIUM** | 12 | 8 | 8 | **28** |
| **LOW** | 10 | 10 | 5 | **25** |
| **Razem** | **27** | **22** | **13** | **62** |

### TOP 10 — rekomendowane do naprawy w pierwszej kolejności

| # | Opis | Plik | Priorytet |
|---|------|------|-----------|
| 1 | Pusty LAN secret wyłącza auth | `lan_server.rs` | HIGH/Security |
| 2 | `/lan/local-identity` zwraca sekret bez auth | `lan_server.rs` | HIGH/Security |
| 3 | `return` w backoff omija cleanup sync | `lan_sync_orchestrator.rs` | HIGH/Bug |
| 4 | Token API w URL SSE | `sync-sse.ts` | HIGH/Security |
| 5 | Race condition upload-db | `lan_server.rs` | HIGH/Bug |
| 6 | Sessions.tsx — brak wyświetlania błędów | `Sessions.tsx` | HIGH/UX |
| 7 | ImportPanel — błędy w catch bez UI | `ImportPanel.tsx` | HIGH/UX |
| 8 | Settings.tsx — god component 837 linii | `Settings.tsx` | HIGH/Perf |
| 9 | `ipconfig` subprocess locale-dependent | `lan_discovery.rs` | MEDIUM/Bug |
| 10 | Fake stop_signal w online sync fallback | `online_sync.rs` | MEDIUM/Bug |

---

*Raport wygenerowany automatycznie na podstawie analizy kodu źródłowego.*
