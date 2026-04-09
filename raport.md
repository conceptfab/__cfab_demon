# TIMEFLOW — Raport analizy kodu (2026-04-09)

> Aplikacja działa poprawnie. Poniższy raport identyfikuje obszary do optymalizacji,
> potencjalne problemy i brakujące elementy — priorytetyzowane wg ważności.

---

## Spis treści

1. [Demon Rust — poprawność i logika](#1-demon-rust--poprawność-i-logika)
2. [Demon Rust — wydajność](#2-demon-rust--wydajność)
3. [Dashboard React — UI i logika](#3-dashboard-react--ui-i-logika)
4. [Dashboard — wydajność](#4-dashboard--wydajność)
5. [Synchronizacja LAN](#5-synchronizacja-lan)
6. [Synchronizacja Online](#6-synchronizacja-online)
7. [Bezpieczeństwo](#7-bezpieczeństwo)
8. [AI / Machine Learning](#8-ai--machine-learning)
9. [Brakujące tłumaczenia](#9-brakujące-tłumaczenia)
10. [Help — brakująca dokumentacja](#10-help--brakująca-dokumentacja)
11. [Nadmiarowy kod](#11-nadmiarowy-kod)
12. [Sugerowane usprawnienia](#12-sugerowane-usprawnienia)

---

## 1. Demon Rust — poprawność i logika

### 1.1 `hash_128()` w `lan_common.rs` — poprawne, ale ryzyko przyszłej regresji (NISKI)
**Plik:** `src/lan_common.rs:14-26`

`DefaultHasher::new()` tworzy SipHasher ze stałymi kluczami (0,0) — jest deterministyczny między procesami/maszynami. **Aktualnie poprawne.** Komentarz w kodzie to potwierdza.

**Uwaga:** Rust nie gwarantuje stabilności `DefaultHasher` między wersjami kompilatora. Przy aktualizacji Rust toolchain hash mógłby się zmienić, co zepsuje sync między maszynami z różnymi wersjami binariów.

**Sugestia:** Dla pewności długoterminowej rozważ jawny hasher (np. `siphasher` crate z fixed key) lub SHA-256 skrócone do 128 bitów — to da gwarancję stabilności niezależną od wersji Rust.

### 1.2 Duplikacja `SyncGuard` (NISKI)
**Pliki:** `src/main.rs:9-15` i `src/tray.rs:19-25`

`SyncGuard` jest zdefiniowany identycznie w dwóch plikach. Wystarczy jeden w `lan_server` lub `sync_common`.

### 1.3 `sync_common.rs` — `VACUUM INTO` z interpolacją ścieżki (ŚREDNI)
**Plik:** `src/sync_common.rs:56`

```rust
let escaped = dest.to_string_lossy().replace('\'', "''");
conn.execute_batch(&format!("VACUUM INTO '{}'", escaped))
```
Choć escaping apostrofów jest obecny, lepiej używać parametryzowanego zapytania lub `backup_to_path()` z rusqlite.

### 1.4 `sftp_client.rs` — brak weryfikacji klucza hosta SSH (ŚREDNI)
**Plik:** `src/sftp_client.rs:41-61`

Klient SSH łączy się bez weryfikacji fingerprint'u hosta:
```rust
session.handshake()?;
session.userauth_password(&self.username, &self.password)?;
```
Brak `session.host_key()` validation — podatny na MITM. Dla wewnętrznej synchro to akceptowalne, ale warto dodać logowanie fingerprint'u.

### 1.5 `online_sync.rs` — retry z exponential backoff 3^n (NISKI)
**Plik:** `src/online_sync.rs:65`

```rust
let delay = RETRY_BASE_DELAY * 3u32.pow(attempt); // 5s, 15s, 45s
```
Trzeci retry to 45s — OK, ale warto dodać jitter żeby uniknąć thundering herd przy wielu klientach.

### 1.6 Hazard na pliku `lan_sync_incoming.json` (WYSOKI)
**Pliki:** `src/lan_server.rs:660-663`, `src/lan_sync_orchestrator.rs:408-412`

Master zapisuje dane przychodzące do `lan_sync_incoming.json`, następnie slave czyta ten sam plik w `handle_db_ready`. Jeśli dwa procesy sync uruchomią się jednocześnie (np. tray trigger + auto-trigger), oba zapisują do tego samego pliku — data race.

**Poprawka:** Użyj unikalnej nazwy pliku (np. z session UUID) lub przekazuj dane bezpośrednio przez pamięć.

### 1.7 `execute_async_pull` — backup per-pakiet bez rollback całości (WYSOKI)
**Plik:** `src/online_sync.rs:572-660`

Pętla `for pkg in &pending.packages` wykonuje backup dla każdego pakietu z osobna. Jeśli pakiet #2 powiedzie się ale #3 nie — backup jest po #2, a restore nie cofa #2. Baza w niespójnym stanie.

**Poprawka:** Jeden backup przed pętlą, albo cała pętla w jednej transakcji SQLite.

### 1.8 Slave zapisuje marker hash mastera mimo potencjalnie innego stanu bazy (WYSOKI)
**Plik:** `src/lan_server.rs:739-748`

Slave w `handle_db_ready` oblicza własny `tables_hash` po merge, ale zapisuje `req.marker_hash` (przesłany przez mastera). Jeśli merge na slave przebiegł inaczej (np. konflikty), marker nie odzwierciedla faktycznego stanu bazy slave'a.

**Poprawka:** Slave powinien wygenerować własny marker hash po merge.

### 1.9 `config.rs` — cicha utrata konfiguracji przy błędnym JSON (ŚREDNI)
**Plik:** `src/config.rs:149, 207`

```rust
serde_json::from_str(&content).unwrap_or_default()
```
Gdy plik `lan_sync_settings.json` jest niepoprawny (np. częściowy zapis), błąd jest cicho ignorowany i zwracane są domyślne ustawienia.

**Poprawka:** Dodaj `log::warn!` przed `unwrap_or_default()`.

### 1.10 `handle_verify_ack` — potencjalnie martwy endpoint (NISKI)
**Plik:** `src/lan_server.rs:792-802`

Endpoint `/lan/verify-ack` usuwa pliki tymczasowe i odmraża bazę, ale nie jest wywoływany z orchestratora. Może być legacy endpoint — jeśli tak, oznaczyć jako deprecated.

---

## 2. Demon Rust — wydajność

### 2.1 `rebuild_file_index_cache()` — alokacje String na każdy wpis (NISKI)
**Plik:** `src/tracker.rs:21-38`

Tworzenie kluczy cache'a generuje nowy `String` na każdy wpis pliku. Przy dużych danych (setki plików dziennie) to wiele alokacji. Rozważ `SmallString` lub pre-alokowany bufor.

### 2.2 `truncate_middle()` — zbieranie chars do Vec (NISKI)
**Plik:** `src/storage.rs:55`

```rust
let chars: Vec<char> = value.chars().collect();
```
Dla typowych ścieżek (< 260 znaków ASCII) to niepotrzebna alokacja. `value.len()` wystarczy dla ASCII — dodaj fast-path:
```rust
if value.len() <= max_chars && value.is_ascii() {
    return value.to_string();
}
```

### 2.3 Ipconfig cache — `std::sync::Mutex` z `static` (OK)
**Plik:** `src/lan_discovery.rs:23-43`

Cache ipconfig z TTL 120s — dobrze zaprojektowany. Jedyna uwaga: klonowanie `String` przy każdym dostępie. Przy 30s beacon interval to marginalny koszt.

### 2.4 Brak `Vec::with_capacity()` w kilku miejscach (NISKI)
- `firewall.rs:56` — `args` vec budowany bez capacity (7-8 elementów)
- `sync_common.rs:60` — `backups` vec z `read_dir` bez capacity

### 2.5 `Cargo.toml` — optymalizacja zależności (NISKI)
```toml
ssh2 = "0.9"  # Ciągnie libssh2-sys — rozważ feature flags / minimalny zestaw
```
`ureq` jest poprawnie używane w `online_sync.rs` do HTTP/TLS komunikacji z serwerem (session create, status poll, heartbeat). `ssh2` do SFTP transferu plików. Obie zależności potrzebne.

---

## 3. Dashboard React — UI i logika

### 3.0 `Sidebar.tsx` — `setLanPeer` niezdefiniowane — bug runtime (KRYTYCZNY)
**Plik:** `dashboard/src/components/layout/Sidebar.tsx:197, 217`

`lanPeer` pochodzi z `useBackgroundStatusStore`, ale store **nie eksponuje** `setLanPeer`. Wywołania `setLanPeer(null)` w `handleLanSync`/`handleLanScan` odnoszą się do niezdefiniowanej zmiennej.

**Efekt:** Po nieudanej synchronizacji LAN, UI nie aktualizuje stanu peera lokalnie. Jedynym mechanizmem aktualizacji pozostaje polling co 5s.

**Poprawka:** Zamienić na `void refreshLanPeers()`.

### 3.0b Sessions — brak rozróżnienia loading vs empty (WYSOKI)
**Pliki:** `dashboard/src/hooks/useSessionsData.ts`, `dashboard/src/components/sessions/SessionsVirtualList.tsx`

`useSessionsData` zarządza `isLoadingRef` wewnętrznie przez ref, ale **nie eksponuje go** jako reactive state. `SessionsVirtualList` otrzymuje `isEmpty` i renderuje "brak aktywności" bez rozróżnienia "jeszcze ładuję" od "naprawdę pusto". Przy przełączeniu daty użytkownik widzi natychmiast pustą listę.

**Poprawka:** Dodać `isLoading` state i skeleton w VirtualList.

### 3.0c Sessions — brak error state (ŚREDNI)
**Plik:** `dashboard/src/hooks/useSessionsData.ts`

Hook ignoruje błędy (`catch(console.error)`) — nie ma eksponowanego `error` state. Gdy `getSessions()` rzuci błąd, użytkownik widzi pustą listę bez wyjaśnienia.

### 3.0d `AiMetricsCharts` — `<Line>` w `<BarChart>` zamiast `<ComposedChart>` (WYSOKI)
**Plik:** `dashboard/src/components/ai/AiMetricsCharts.tsx:169-218`

`<Line>` wewnątrz `<BarChart>` działa w starszych wersjach Recharts, ale nie jest gwarantowane w nowszych. Powinno być `<ComposedChart>`.

### 3.0e DaemonControl — brak `aria-label` na autostart toggle (ŚREDNI)
**Plik:** `dashboard/src/pages/DaemonControl.tsx:333-344`

Custom switch button bez `role="switch"`, `aria-checked`, ani `aria-label`. Czytniki ekranu nie opiszą tej kontrolki.

### 3.0f PM page — brak empty state gdy `work_folder` nie skonfigurowany (ŚREDNI)
**Plik:** `dashboard/src/pages/PM.tsx`

Gdy `settings.work_folder` jest puste, PM ładuje się bez projektów i bez informacji co zrobić. Brak CTA z linkiem do Settings → PM.

### 3.1 `useJobPool.ts` — złożoność i wielkość hooka (ŚREDNI)
**Plik:** `dashboard/src/hooks/useJobPool.ts` (393 linii)

Ten hook zarządza ~10 niezależnymi timerami/interwałami w jednym miejscu. Każdy `useCallback` ma swoje `ref`-y. To sprawia, że:
- Trudny do testowania
- Trudny do debugowania (który timer wywołał co?)
- Re-render jednego triggera odtwarza cały hook

**Sugestia:** Rozbić na mniejsze hooki per-concern:
- `useDiagnosticsPoller()` 
- `useFileSignatureChecker()`
- `useAutoSplitScheduler()`
- `useSyncScheduler()`

### 3.2 `BackgroundServices.tsx` — `defaultValue` zamiast kluczy i18n (NISKI)
**Plik:** `dashboard/src/components/sync/BackgroundServices.tsx:43-51`

```tsx
showInfoRef.current(tRef.current('background.online_sync_pulled', { defaultValue: 'Data synchronized from server' }));
```
Użyto `defaultValue` jako fallback — te klucze powinny istnieć w plikach tłumaczeń. Sprawdzić czy `background.online_sync_pulled`, `background.online_sync_pushed`, `background.lan_sync_done` są w `common.json`.

### 3.3 `useEffect` bez dependency array w `BackgroundServices.tsx` (NISKI)
**Plik:** `dashboard/src/components/sync/BackgroundServices.tsx:52-61`

```tsx
useEffect(() => {
    window.addEventListener(AI_ASSIGNMENT_DONE_EVENT, handleAiAssignmentDone);
    // ...
    return () => { /* cleanup */ };
}, []); // pusta tablica — ale handlery są z useCallback([]) więc OK
```
Technicznie poprawne dzięki `useCallback` bez deps, ale ESLint może narzekać.

### 3.4 PageRouter — brak `React.memo` na ciężkich stronach (NISKI)
**Plik:** `dashboard/src/App.tsx:64-80`

`PageRouter` renderuje stronę na podstawie `currentPage`. Lazy loading jest obecny (dobrze!), ale zmiana `currentPage` re-tworzy komponent — warto rozważyć `key` lub cache dla stron z dużym stanem.

### 3.5 `localStorage` jako store sync settings (ŚREDNI)
**Pliki:** `dashboard/src/lib/lan-sync.ts`, `dashboard/src/lib/online-sync.ts`

Ustawienia LAN/Online sync trzymane w `localStorage`. Problem:
- Brak atomowości (race condition przy szybkich zapisach)
- `JSON.parse` przy każdym odczycie w tick loop (co 1s)
- Brak walidacji schematu po parse

**Sugestia:** Cache w pamięci (Zustand store) + zapis do localStorage tylko przy zmianie.

---

## 4. Dashboard — wydajność

### 4.1 Job pool tick co 1 sekundę (ŚREDNI)
**Plik:** `dashboard/src/hooks/useJobPool.ts:313`

```tsx
loopRef.current = window.setInterval(() => { ... }, JOB_LOOP_TICK_MS);
```
Co sekundę uruchamia się callback sprawdzający ~10 warunków `now >= next*Ref.current`. To niepotrzebne CPU. Lepiej:
- Użyć `setTimeout` z dynamicznym delay do najbliższego next* timestamp
- Lub zwiększyć tick do 5s (większość jobów ma interwały 30-60s)

### 4.2 `background-status-store.ts` — ręczne equality checks (NISKI)
**Plik:** `dashboard/src/store/background-status-store.ts:22-98`

5 ręcznych funkcji porównujących (`areDaemonStatusesEqual`, `areAssignmentStatusesEqual`, itd.). Zustand wspiera `shallow` selector albo `immer` middleware. Ręczne porównania są poprawne, ale trudne w utrzymaniu.

### 4.3 Brak virtualizacji w listach projektów (NISKI)
Sesje używają `SessionsVirtualList` (dobrze!), ale listy projektów (`ProjectsList`, `ExcludedProjectsList`) nie mają virtualizacji. Przy >100 projektach może to wpłynąć na wydajność.

---

## 5. Synchronizacja LAN

### 5.1 Hash stabilność — ryzyko przy aktualizacji Rust (NISKI, patrz 1.1)
`hash_128()` używa `DefaultHasher::new()` ze stałymi kluczami — **aktualnie deterministyczny i poprawny**. Delta sync działa prawidłowo.

**Ryzyko:** Przy aktualizacji Rust toolchain hash output mógłby się zmienić (Rust nie gwarantuje stabilności `DefaultHasher`). Sugerowane rozwiązanie: jawny hasher z gwarancją stabilności.

### 5.2 `MAX_RESPONSE_BODY` = 100MB (ŚREDNI)
**Plik:** `src/lan_sync_orchestrator.rs:16`

Ograniczenie body HTTP na 100MB zapobiega OOM, ale brak walidacji faktycznego content-type. Malicious peer mógłby wysłać dane innego formatu.

### 5.3 Ręczny HTTP server/client bez TLS (NISKI)
**Pliki:** `src/lan_server.rs`, `src/lan_sync_orchestrator.rs`

LAN sync używa plain HTTP na TCP 47891. To zrozumiałe dla LAN (wydajność), ale dane transferowane bez szyfrowania w sieci lokalnej. Warto udokumentować to ograniczenie w Help.

### 5.4 DB freeze timeout = 5 min (ŚREDNI)
**Plik:** `src/lan_server.rs:148`

```rust
const AUTO_UNFREEZE_TIMEOUT: Duration = Duration::from_secs(300);
```
Jeśli sync zawiesie się, tracker nie zapisze danych przez 5 minut. To akceptowalne, ale warto logować warning gdy unfreeze timeout triggers.

### 5.5 Master election by uptime (OK)
**Plik:** `src/lan_discovery.rs:74-75`

`uptime_secs` capped at 30 days — dobra ochrona przed spoofingiem. Tiebreaker przez `device_id` (lexicographic) — poprawne.

### 5.6 Tombstone `sync_key` używa lokalnych integer ID dla sesji — KRYTYCZNY BUG
**Plik:** `src/sync_common.rs` (merge tombstones)

Tombstones dla `sessions` i `manual_sessions` używają auto-increment integer ID jako `sync_key`:
```sql
WHERE id = CAST(?1 AS INTEGER)
```
Integer ID jest **lokalny i nie przenośny** między maszynami. Jeśli device A usunie sesję ID=42 i wyśle tombstone, device B może mieć **zupełnie inną sesję** pod ID=42 — i usunie ją błędnie.

**Poprawka:** Użyj composite natural key `(app_executable_name, start_time)` jako sync_key dla sesji, analogicznie do merge logic.

### 5.7 Tombstone guard "updated after deletion" tylko dla `projects` (WYSOKI)
**Plik:** `src/sync_common.rs` (merge_incoming_data)

Guard "skip tombstone if record was updated after deletion" jest zaimplementowany **tylko dla `projects`**. Dla `applications`, `sessions`, `manual_sessions` tombstone od peera **bezwarunkowo usunie** rekord, nawet jeśli lokalnie został zaktualizowany po deletion timestamp.

**Poprawka:** Rozszerzyć guard na wszystkie tabele.

### 5.8 Step 11 — master zawsze wysyła pełny export do slave (ŚREDNI)
**Plik:** `src/lan_sync_orchestrator.rs` (step 11)

Nawet w trybie delta, master wywołuje `build_full_export` (eksport od "1970-01-01") w step 11. Dla bazy z wieloletnimi danymi to mogą być dziesiątki MB przy **każdej** synchronizacji.

**Poprawka:** W step 11 wysyłaj tylko delta (rekordy zmienione od markera slave'a). Full export tylko gdy marker nie znaleziony.

### 5.9 `restore_database_backup` — brak re-open connection (ŚREDNI)
**Plik:** `src/lan_sync_orchestrator.rs` (step 12 error path)

Po `restore_database_backup` komentarz mówi "Caller MUST re-open connection", ale `execute_master_sync` w error path step 12 **nie otwiera nowego połączenia**. Stale connection może dawać błędy.

### 5.10 Brak wersji schematu w sync payload (ŚREDNI)
Eksportowany JSON nie ma pola schema version. Jeśli dwa endpointy mają różne wersje aplikacji (typowe przy aktualizacji), merge code cicho pominie nieznane pola lub użyje zero-defaults dla brakujących.

---

## 6. Synchronizacja Online

### 6.1 SSE token w URL — udokumentowane TODO (ŚREDNI)
**Plik:** `dashboard/src/lib/sync/sync-sse.ts:39-41`

```ts
// SECURITY TODO: Token in URL is logged by proxies/CDN/server access logs.
```
Jest `SECURITY TODO` — dobrze że zidentyfikowane. Priorytet: przed produkcyjnym wdrożeniem. Rozwiązanie opisane w komentarzu (SSE ticket lub fetch streaming).

### 6.2 SFTP — brak connection pooling + brak retry per-operacja (ŚREDNI)
**Plik:** `src/sftp_client.rs`

`upload_data` i `download_data` wywołują `self.connect()` za każdym razem — pełne TCP connect + SSH handshake + auth. W jednym cyklu sync to minimum 4 połączenia. Brak connection reuse.

Retry jest na poziomie `online_sync.rs:with_retry()`, ale obejmuje cały cykl — nie operację SFTP.

**Poprawka:** Otwierać jedno SSH session per sync i reuse'ować dla upload/download.

### 6.3 Dual sync path — dashboard + daemon (ŚREDNI)
**Pliki:** `hooks/useJobPool.ts`, `hooks/useBackgroundSync.ts`

Dashboard triggeruje sync na dwa sposoby:
1. `triggerDaemonOnlineSync()` — deleguje do demona
2. SSE event → `triggerDaemonOnlineSync()` — też deleguje

Ale `useJobPool` ma też `runSync()` który wywołuje `triggerDaemonOnlineSync()`. Potencjalnie dwa triggery mogą się nałożyć (SSE event + periodic interval). Guard `isSyncingRef` chroni, ale race condition jest możliwy przy rapid events.

### 6.4 Hardcoded timeout 2000ms na refresh po sync (NISKI)
**Pliki:** `useJobPool.ts:206`, `useBackgroundSync.ts:39`

```ts
setTimeout(() => { triggerRefresh(...) }, 2_000);
```
Zakłada że daemon przetworzy sync w <2s. Dla dużych baz danych to może być za mało.

---

## 7. Bezpieczeństwo

### 7.1 SSE token w URL (patrz 6.1) — ŚREDNI
### 7.2 Brak host key verification SSH (patrz 1.4) — ŚREDNI

### 7.3 SftpCredentials zerowanie w Drop (DOBRZE)
**Pliki:** `src/sync_encryption.rs:39-48`, `src/sftp_client.rs:20-29`

Implementacja `Drop` dla `SftpCredentials` i `SftpClient` zeruje hasła — dobra praktyka.

### 7.4 Szyfrowanie AES-256-GCM (DOBRZE)
**Plik:** `src/sync_encryption.rs`

Poprawne użycie:
- Losowy 12-byte IV z `getrandom`
- Poprawna konkatenacja ciphertext+tag
- HMAC-based key derivation z session-scoped purpose

### 7.5 Firewall rules — brak elevation check (NISKI)
**Plik:** `src/firewall.rs`

Jeśli demon nie ma uprawnień admina, reguły nie zostaną dodane — jest logowane jako warning. OK, ale warto informować użytkownika w UI (np. toast przy starcie).

### 7.6 LAN server — brak autoryzacji endpointów (WYSOKI)
**Plik:** `src/lan_server.rs:283-287`

LAN server nasłuchuje na `0.0.0.0:47891` bez żadnej autoryzacji. Każde urządzenie w sieci LAN może wywołać `/lan/trigger-sync`, `/lan/upload-db`, `/lan/db-ready` — potencjalnie nadpisując lokalną bazę.

**Poprawka:** Wygeneruj shared secret przy pierwszym uruchomieniu (`lan_secret.txt`), wymagaj nagłówka `X-TimeFlow-Secret` i odrzucaj bez niego z HTTP 401.

### 7.7 CORS `Access-Control-Allow-Origin: *` na LAN server (ŚREDNI)
**Plik:** `src/lan_server.rs:452`

```
Access-Control-Allow-Origin: *
```
Każda strona internetowa otwarta w przeglądarce może wykonać cross-origin request do `http://localhost:47891/lan/trigger-sync`. To wektor CSRF.

**Poprawka:** Ogranicz do `http://localhost` lub dodaj CSRF token.

### 7.8 Token/klucz szyfrowania w plaintext JSON (ŚREDNI)
**Plik:** `src/config.rs:163`

`auth_token` i `encryption_key` z `online_sync_settings.json` są w plaintext. Każda aplikacja z dostępem do `%APPDATA%/TimeFlow/` może je odczytać.

**Sugestia:** Rozważ Windows Credential Manager (`wincred` crate) lub DPAPI.

### 7.9 `backup_path` z bazy danych bez walidacji ścieżki (ŚREDNI)
**Plik:** `src/sync_common.rs:89-97`

Ścieżka backupu czytana z SQLite (`system_settings`) i używana bezpośrednio do zapisu. Brak walidacji `..` traversal.

**Poprawka:** Waliduj ścieżkę — upewnij się że nie zawiera `..` i jest katalogiem.

### 7.10 `SYNC_ENCRYPTION_KEY` — statyczny master key bez key versioning (ŚREDNI)
**Serwer:** `src/lib/sync/storage-encryption.ts`

Jeden master key (`SYNC_ENCRYPTION_KEY` env var) dla wszystkich sesji i użytkowników. Key rotation wymaga restartu serwera i invaliduje in-flight sesje. Brak wersjonowania kluczy — jeśli klucz wycieknie, **wszystkie** historyczne credential blobs są skompromitowane.

### 7.11 Brak synchronizacji zegarów — clock drift wpływa na last-writer-wins (NISKI)
Conflict resolution opiera się na `updated_at` timestamp. Brak NTP enforcement ani clock drift detection. Jeśli zegar device A jest 5 minut do przodu, jego zmiany **zawsze** wygrywają.

---

## 8. AI / Machine Learning

### 8.1 Strona AI — dobrze zorganizowana (OK)
**Plik:** `dashboard/src/pages/AI.tsx`

Komponenty rozbite na 6 sub-komponentów (`AiModelStatusCard`, `AiSettingsForm`, `AiBatchActionsCard`, `AiMetricsCharts`, `AiSessionIndicatorsCard`, `AiHowToCard`). Architektura czytelna.

### 8.2 Brak opisu modelu ML w Help (ŚREDNI)
Help sekcja "AI" istnieje (`HelpAiSection`), ale sprawdzić czy opisuje:
- Jak działa model (decision tree? frequency-based?)
- Jakie dane są potrzebne do trenowania
- Jak interpretować `confidence` i `evidence` thresholds
- Co oznacza "rollback" auto-assignment

### 8.3 `FEEDBACK_TRIGGER = 30` i `RETRAIN_INTERVAL_HOURS = 24` — hardcoded (NISKI)
**Plik:** `dashboard/src/pages/AI.tsx:43-45`

Te wartości powinny być konfigurowalne przez użytkownika (w Settings lub AI Settings).

### 8.4 Deterministyczne przypisanie projektów (DOBRZE)
`runAutoAiAssignmentCycle()` + `hasPendingAssignmentModelTrainingData()` — sekwencja: import → deterministic assign → AI assign. To zapewnia że oczywiste mapowania (folder=projekt) nie wymagają ML.

---

## 9. Brakujące tłumaczenia

### 9.1 BRAKUJĄCY klucz: `sessions.menu.active_projects_az` (KRYTYCZNY)
**Plik:** `dashboard/src/pages/Sessions.tsx:465-467`

```tsx
label: t('sessions.menu.active_projects_az', 'Aktywne projekty (A-Z)')
```
Klucz **nie istnieje** w żadnym z plików locale. Fallback jest po polsku — użytkownik EN widzi polski tekst.

**Poprawka:** Dodać klucz do obu locales.

### 9.2 `OnlineSyncCard` — hardcoded "Zmien licencje" bez diakrytyków (WYSOKI)
**Plik:** `dashboard/src/components/settings/OnlineSyncCard.tsx:119`

```tsx
{t('settings.license.deactivate', 'Zmien licencje')}
```
Klucz istnieje w obu plikach, ale fallback ma literówkę (brak ą/ę/ó). PL locale prawdopodobnie też bez diakrytyków.

**Poprawka:** Zaktualizować PL locale: `"deactivate": "Zmień licencję"`. Usunąć hardcoded fallback.

### 9.3 Klucze z `defaultValue` w BackgroundServices (ŚREDNI)
**Plik:** `dashboard/src/components/sync/BackgroundServices.tsx`

Następujące klucze używają fallback `defaultValue` — sprawdzić czy istnieją w obu locale files:
- `background.online_sync_pulled`
- `background.online_sync_pushed`  
- `background.lan_sync_done`

### 9.4 `SyncProgressOverlay` — zbędny polski fallback (NISKI)
**Plik:** `dashboard/src/components/sync/SyncProgressOverlay.tsx:173`

```tsx
{t('sync_progress.frozen_notice', 'Rejestrowanie wpisów jest wstrzymane...')}
```
Klucz istnieje w obu locales — fallback jest zbędny i po polsku.

### 9.5 Pliki locale — symetryczność (DOBRZE)
Oba pliki mają 2069 linii — pełna symetria kluczy PL/EN. Audyt sekcji `help_page` (linie 1467-1814) potwierdził: **identyczny zestaw kluczy, brak pustych wartości** w obu językach.

### 9.6 Console.log zamiast logger w SSE (NISKI)
**Plik:** `dashboard/src/lib/sync/sync-sse.ts`

Używa `console.log`/`console.warn` zamiast `logger` (z `@/lib/logger`). Niespójne z resztą kodu.

---

## 10. Help — brakująca dokumentacja

### 10.1 Istniejące sekcje Help (16 zakładek)
| Zakładka | Sekcja Help | Status |
|----------|------------|--------|
| QuickStart | ✅ HelpQuickStartSection | OK |
| Dashboard | ✅ HelpDashboardSection | OK |
| Sessions | ✅ HelpSessionsSection | OK |
| Projects | ✅ HelpProjectsSection | OK |
| Estimates | ✅ HelpEstimatesSection | OK |
| Applications | ✅ HelpAppsSection | OK |
| Time Analysis | ✅ HelpAnalysisSection | OK |
| AI | ✅ HelpAiSection | OK |
| Data | ✅ HelpDataSection | OK |
| Reports | ✅ HelpReportsSection | OK |
| PM | ✅ HelpPmSection | OK |
| Daemon Control | ✅ HelpDaemonSection | OK |
| Online Sync | ✅ HelpOnlineSyncSection | OK |
| LAN Sync | ✅ HelpLanSyncSection | OK |
| BugHunter | ✅ HelpBughunterSection | OK |
| Settings | ✅ HelpSettingsSection | OK |

**Wniosek:** Wszystkie 16 stron/modułów ma sekcję Help. ✅

### 10.2 Strony bez dedykowanej zakładki — BRAK (wszystkie pokryte)
Wszystkie strony mają mapowanie w Help:
- ImportPage → zakładka `data`
- ProjectPage → zakładka `projects` (via `help-navigation.ts`)
- ReportView → zakładka `reports`

### 10.3 Problemy jakościowe w treści Help

#### BugHunter — duplikacja treści (WYSOKI)
**Plik:** `dashboard/src/components/help/sections/HelpBughunterSection.tsx`

Te same 3 klucze (`bughunter_detail_what_it_does`, `bughunter_detail_when_to_use`, `bughunter_detail_limitations`) użyte zarówno w `features[]` jak i w `HelpDetailsBlock` `children`. Użytkownik widzi identyczne 3 punkty dwa razy.

**Poprawka:** Lista `features` powinna zawierać inne cechy (typy załączników, limity, pola formularza), a `HelpDetailsBlock` — szczegółowy opis.

#### Settings — 10+ wpisów Online Sync powielone (WYSOKI)
**Plik:** `dashboard/src/components/help/sections/HelpSettingsSection.tsx`

Sekcja Settings zawiera te same klucze co `HelpOnlineSyncSection`: `device_id_a_device_identifier`, `sync_token_is_stored_in`, `sync_on_startup`, itd.

**Poprawka:** Settings powinno zawierać ogólny opis kart ustawień i odesłanie do dedykowanych sekcji Online Sync / LAN Sync.

#### Techniczna terminologia — żargon implementacyjny (ŚREDNI)
- **Online Sync:** `server_snapshot_pruned` — wewnętrzna nazwa stanu z kodu Rust. Użytkownik nie wie co to jest.
- **Online Sync:** "13-krokowy protokół sesji z transferem SFTP" — zbyt techniczne.
- **LAN Sync:** "znaczniki SHA256 w SQLite" — szczegół implementacyjny.

**Poprawka:** Zastąpić opisami zachowania zorientowanymi na użytkownika.

#### Brak ostrzeżeń "nieodwracalne" (ŚREDNI)
- **AI → Reset AI knowledge** — brak ostrzeżenia że operacja jest nieodwracalna.
- **Settings → Emergency Clear** — brak wyraźnego ostrzeżenia o nieodwracalności.

#### QuickStart Help nie opisuje samej strony (NISKI)
Zakładka QuickStart w Help jest intro z przyciskiem "Uruchom Quick Start" — nie opisuje ile kroków ma tutorial, co konkretnie zawiera, czy można go uruchomić wielokrotnie.

#### PM sekcja — inny wzorzec kluczy (NISKI)
`HelpSimpleSections.tsx:HelpPmSection` używa `t18n('pm.title')` zamiast `help_page.*` — jedyny wyjątek od wzorca.

### 10.4 Funkcje nieudokumentowane w Help
- **Background services lifecycle** — użytkownik nie wie co dzieje się przy starcie (autoImport, AI assign, session rebuild, SSE connect). Brak centralnego opisu.
- **File signature checking** — mechanizm wykrywania zmian
- **Version compatibility check** — co się dzieje gdy demon i dashboard mają różne wersje

---

## 11. Nadmiarowy kod

### 11.1 `SyncGuard` duplikacja (patrz 1.2)
**Pliki:** `main.rs` i `tray.rs` — identyczna struktura.

### 11.2 `sync_common.rs` — thin wrapper functions
**Plik:** `src/sync_common.rs:7-13`

```rust
pub fn compute_tables_hash_string_conn(conn: &Connection) -> String {
    lan_common::compute_tables_hash_string(conn)
}
pub fn generate_marker_hash_simple(...) -> String {
    lan_common::generate_marker_hash(...)
}
```
To są 1:1 wrappery bez dodatkowej logiki. Jeśli `online_sync` potrzebuje tych funkcji, powinien importować bezpośrednio z `lan_common`.

### 11.3 `activity.rs` — jednoliniowy re-export
**Plik:** `src/activity.rs` (1 linia)

```rust
pub use timeflow_shared::activity_classification::ActivityType;
```
Rozważ `pub use` bezpośrednio w `tracker.rs` zamiast osobnego modułu.

### 11.4 Dashboard — ręczne equality functions w store (patrz 4.2)
5 funkcji porównujących w `background-status-store.ts` — można zastąpić `zustand/shallow` lub `JSON.stringify` porównaniem.

### 11.5 `hkdf` dependency nieużywana
**Plik:** `Cargo.toml:53`

`hkdf = "0.12"` jest w dependencies, ale nigdzie nie importowana w `src/`. `sync_encryption.rs` używa własnej HMAC-based derivation, nie standardowego HKDF.

**Poprawka:** Usunąć `hkdf` z `Cargo.toml`.

### 11.6 `ReportResponse` — pusta struktura (NISKI)
**Plik:** `src/online_sync.rs:52-53`

```rust
#[derive(Deserialize)]
struct ReportResponse {}
```
Pusta struktura do parsowania pustego JSON body. Można zastąpić `serde_json::Value` lub zignorować body.

### 11.7 `#[allow(dead_code)]` na `SftpCredentials` (NISKI)
**Plik:** `src/sync_encryption.rs:26`

Atrybut `#[allow(dead_code)]` na całej strukturze wskazuje że pola `protocol`, `download_path` mogą nie być używane. Warto zweryfikować.

### 11.8 `get_device_id`/`get_machine_name` wrappery w `lan_server.rs` (NISKI)
**Plik:** `src/lan_server.rs:509-515`

Delegują 1:1 do `lan_common`. Można usunąć i importować bezpośrednio.

### 11.9 Zduplikowane LAN sync polling w Sidebar i Settings (WYSOKI)
**Pliki:** `dashboard/src/components/layout/Sidebar.tsx:146-224`, `dashboard/src/pages/Settings.tsx:253-278`

Dwa niezależne interwały pollują LAN peers co 5s — podwójny ruch IPC do daemona. Logika `handleLanSync` jest niemal identyczna w obu plikach.

**Poprawka:** Wyodrębnić `useLanSyncHandler()` hook. Settings powinien korzystać z `useBackgroundStatusStore`.

### 11.10 Zduplikowana logika context menu placement (ŚREDNI)
**Pliki:** `dashboard/src/pages/Sessions.tsx:251-276`, `dashboard/src/components/dashboard/ProjectDayTimeline.tsx`

Oznaczone TODO w kodzie (linia 250) — identyczna logika `resolveContextMenuPlacement`.

### 11.11 Zduplikowane `visibilitychange` + `focus` event listenery (ŚREDNI)
**Pliki:** `useSessionsData.ts`, `DaemonControl.tsx`, `AI.tsx`, `useJobPool.ts`

Każdy z tych plików dodaje własne `visibilitychange`/`focus` listenery. Brakuje wspólnego hooka `useVisibilityRefresh(callback)`.

---

## 12. Sugerowane usprawnienia

### 12.0 Priorytety (KRYTYCZNE — wymagają naprawy)

| # | Problem | Wpływ | Status |
|---|---------|-------|--------|
| 0 | Tombstone `sync_key` = local integer ID dla sesji | Usunięcie BŁĘDNEJ sesji na zdalnej maszynie | ✅ NAPRAWIONE — composite natural key z fallback |

### 12.1 Priorytety (WYSOKIE — warto naprawić)

| # | Usprawnienie | Zysk | Status |
|---|-------------|------|--------|
| 1 | LAN server autoryzacja (shared secret) | Bezpieczeństwo — dowolny host może nadpisać bazę | ✅ X-TimeFlow-Secret header + lan_secret.txt |
| 2 | SSE ticket zamiast token w URL | Bezpieczeństwo — token logowany przez proxy | ⏳ Wymaga zmian serwera |
| 3 | Hazard na `lan_sync_incoming.json` — unique filename | Stabilność sync | ✅ Unikalna nazwa z timestamp + pointer |
| 4 | `execute_async_pull` — jeden backup przed pętlą | Spójność danych online sync | ✅ Backup przeniesiony przed pętlę |
| 5 | Slave marker hash — generować własny po merge | Poprawność delta sync | ✅ Slave generuje own_marker po merge |
| 6 | CORS `*` → ograniczenie do localhost | Bezpieczeństwo (CSRF) | ✅ Zmienione na http://localhost |
| 7 | Rozbicie `useJobPool` na mniejsze hooki | Czytelność, testowalność | ⏳ Duża refaktoryzacja |
| 8 | Cache sync settings w pamięci | Wydajność (brak JSON.parse co 1s) | ⏳ |
| 9 | SSH host key verification (choćby logowanie) | Bezpieczeństwo | ✅ Logowanie fingerprint'u |
| 9a | Tombstone guard "updated after deletion" na wszystkie tabele | Poprawność sync | ✅ Guard na projects, applications, sessions, manual_sessions |
| 9b | Step 11 — delta zamiast full export do slave | Wydajność LAN sync | ⏳ |
| 9c | SFTP connection pooling (1 session per sync) | Wydajność online sync | ⏳ |

### 12.2 Priorytety (ŚREDNIE — nice to have)

| # | Usprawnienie | Zysk | Status |
|---|-------------|------|--------|
| 10 | Zwiększenie job pool tick z 1s do 5s | CPU dashboard | ✅ Już było 5s |
| 11 | Deduplikacja `SyncGuard` | Czystość kodu | ✅ Przeniesiony do lan_server.rs |
| 12 | Dokumentacja ImportPage/ProjectPage w Help | UX | ✅ Już pokryte |
| 13 | `console.log` → `logger` w sync-sse.ts | Spójność | ✅ |
| 14 | Parametryzowalne FEEDBACK_TRIGGER/RETRAIN_INTERVAL | Konfigurowalność AI | ⏳ |
| 15 | Usunięcie nieużywanej `hkdf` dependency | Mniejszy binary | ✅ |
| 16 | `backup_path` walidacja (brak `..` traversal) | Bezpieczeństwo | ✅ |
| 17 | `log::warn!` przy błędnym JSON config | Debugowalność | ✅ |
| 18 | Stabilny hasher zamiast `DefaultHasher` | Odporność na upgrade Rust | ⏳ |
| 19 | BugHunter Help — usunąć duplikację treści | Jakość Help | ✅ |
| 20 | Settings Help — wydzielić Online Sync do własnej sekcji | Jakość Help | ⏳ |
| 21 | Zamienić żargon techniczny w Help na opisy user-facing | UX dokumentacji | ⏳ |
| 22 | Dodać ostrzeżenia "nieodwracalne" przy Reset AI / Emergency Clear | Bezpieczeństwo UX | ⏳ |

### 12.3 Architektura — potencjalne przyszłe ulepszenia

1. **WebSocket zamiast SSE** — EventSource nie wspiera custom headers (stąd token w URL). Fetch streaming lub WebSocket rozwiązałby problem.

2. **Encrypted LAN sync** — plain HTTP na LAN to akceptowalne, ale TLS z self-signed cert podniósłby bezpieczeństwo.

3. **SQLite WAL mode verification** — upewnić się że oba procesy (daemon + dashboard) otwierają bazę z `PRAGMA journal_mode=WAL` i `PRAGMA busy_timeout`.

4. **Structured logging** — demon używa własnego `FileLogger`. Rozważ `tracing` crate dla structured logs z kontekstem (thread, module, span).

5. **Health endpoint** — daemon LAN server mógłby mieć `/health` endpoint zwracający wersję, uptime, status sync. Dashboard mógłby go używać zamiast sprawdzania heartbeat.txt.

---

## Podsumowanie

**Ogólna ocena: DOBRZE** — kod jest dobrze zorganizowany, modularny, z dobrymi praktykami (RAII guards, `Drop` na credential zerowanie, lazy loading, virtualized lists, error boundaries).

**Krytyczny bug NAPRAWIONY:** tombstone `sync_key` — teraz używa composite natural key z fallback na legacy integer.

Aplikacja jest stabilna. Hasher jest deterministyczny (stałe klucze SipHash). Sync działa poprawnie.

**Architektura jest solidna:** 
- Podział daemon/dashboard z komunikacją przez pliki + Tauri invoke
- 13-step sync FSM z freeze/unfreeze i atomic guards
- AES-256-GCM encryption z proper HMAC key derivation
- Background job pool z debouncing i backoff
- Kompletne Help (16/16 sekcji) z pełnymi tłumaczeniami PL/EN

**Zrealizowane poprawki (2026-04-09):**
1. ✅ **KRYTYCZNE:** Tombstone sync_key — composite natural key zamiast local integer ID
2. ✅ **Bezpieczeństwo:** LAN server shared secret (X-TimeFlow-Secret), CORS localhost, SSH fingerprint logging, backup_path validation
3. ✅ **Stabilność sync:** Tombstone guard na 4/4 tabel, unique temp filenames, slave own marker hash, single backup before loop
4. ✅ **Dashboard:** isLoading/error state w Sessions, ComposedChart, aria-label, brakujące tłumaczenia
5. ✅ **Czystość:** Usunięto hkdf dep, SyncGuard deduplikacja, ReportResponse, #[allow(dead_code)], wrapper functions

**Pozostałe do realizacji:**
- SSE ticket (wymaga serwera), useJobPool refaktor, SFTP connection pooling, stabilny hasher
