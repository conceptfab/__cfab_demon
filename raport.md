# TIMEFLOW — Raport audytu kodu (2026-04-10)

> Kompleksowa analiza demona Rust, dashboardu React/TypeScript i serwera synchronizacji.
> Aplikacja dziala poprawnie — raport skupia sie na potencjalnych ulepszeniach.

---

## Spis tresci

1. [Podsumowanie](#1-podsumowanie)
2. [Rust Daemon — KRYTYCZNE](#2-rust-daemon--krytyczne)
3. [Rust Daemon — WAZNE](#3-rust-daemon--wazne)
4. [Rust Daemon — SUGESTIE](#4-rust-daemon--sugestie)
5. [Dashboard React — KRYTYCZNE](#5-dashboard-react--krytyczne)
6. [Dashboard React — WAZNE](#6-dashboard-react--wazne)
7. [Dashboard React — SUGESTIE](#7-dashboard-react--sugestie)
8. [Serwer Sync — KRYTYCZNE](#8-serwer-sync--krytyczne)
9. [Serwer Sync — WAZNE](#9-serwer-sync--wazne)
10. [Serwer Sync — SUGESTIE](#10-serwer-sync--sugestie)
11. [Brakujace tlumaczenia i18n](#11-brakujace-tlumaczenia-i18n)
12. [Brakujaca dokumentacja Help](#12-brakujaca-dokumentacja-help)
13. [Plan napraw — priorytety](#13-plan-napraw--priorytety)

---

## 1. Podsumowanie

| Obszar | Krytyczne | Wazne | Sugestie |
|--------|-----------|-------|----------|
| Rust Daemon | 4 | 10 | 8 |
| Dashboard React | 5 | 7 | 7 |
| Serwer Sync | 5 | 9 | 10 |
| **RAZEM** | **14** | **26** | **25** |

**Ogolna ocena:** Kod jest dobrze zorganizowany, z solidnym protokolem synchronizacji (13-krokowy LAN i online), poprawna obsluga bledow w wiekszosci miejsc (backup+restore przy bledzie merge, SyncGuard, auto-unfreeze po timeout). Glowne ryzyka dotycza bezpieczenstwa (SSH MITM, gzip bomb, SQL injection, CORS admin API) oraz brakujacych tlumaczen i18n.

---

## 2. Rust Daemon — KRYTYCZNE

### RD-K1. SQL Injection w `create_pre_sync_backup_to_destination`
- **Plik:** `src/sync_common.rs`, linia ~121
- **Problem:** Sciezka `dest_path` jest escapowana reczne (`replace('\'', "''")`) i wstawiana do `VACUUM INTO '...'` przez `format!()`. Walidacja path traversal (linia 107) sprawdza tylko `..` — nie chroni przed SQL injection przez specjalne znaki w nazwie katalogu.
- **Porownanie:** Funkcja `backup_database()` (linia 56) poprawnie uzywa API `rusqlite::backup::Backup`.
- **Rekomendacja:** Zamienic na `rusqlite::backup::Backup` API (jak `backup_database`), lub walidowac sciezke bardziej rygorystycznie.

### RD-K2. Brak weryfikacji host key SSH
- **Plik:** `src/sftp_client.rs`, linia 55-58
- **Problem:** Fingerprint SSH jest logowany, ale **nigdy nie weryfikowany** — klient akceptuje dowolny klucz serwera SFTP. Umozliwia atak MITM na transfer zaszyfrowanych danych synchronizacji.
- **Rekomendacja:** Przechowywac znany fingerprint i porownywac przy kolejnych polaczeniach (trust-on-first-use), lub weryfikowac z wartoscia dostarczona przez serwer.

### RD-K3. LAN Server nasluchuje na 0.0.0.0 z lekka autentykacja
- **Plik:** `src/lan_server.rs`, linia 297, 419
- **Problem:** Endpointy `/lan/ping` i `/lan/sync-progress` nie wymagaja autentykacji. Ping ujawnia `device_id`, `machine_name`, `version`, `role` i `sync_marker_hash` kazdemu w sieci. Ponadto `lan_secret.txt` to plik plaintext na dysku.
- **Rekomendacja:** Wymagac autentykacji na `/lan/ping` (przynajmniej base-level), rozwazyc szyfrowanie sekretu na dysku.

### RD-K4. Podwojne resetowanie `sync_in_progress` — race condition
- **Plik:** `src/online_sync.rs`, linia 770 + `src/lan_server.rs`, linia 1012
- **Problem:** Jesli `run_online_sync` jest wywolywany przez `handle_online_trigger_sync`, flaga `sync_in_progress` jest resetowana dwukrotnie. Koliduje z `SyncGuard` w `tray.rs` (linia 382-404). Niespojny kontrakt: kto jest odpowiedzialny za reset?
- **Rekomendacja:** Ustanowic jednoznaczna wlasnosc flagi — albo SyncGuard, albo funkcja wywolujaca.

---

## 3. Rust Daemon — WAZNE

### RD-W1. Niestabilny hash DefaultHasher
- **Plik:** `src/lan_common.rs`, linia 14-26
- **Problem:** `std::collections::hash_map::DefaultHasher` **nie gwarantuje stabilnosci** miedzy wersjami kompilatora. Dwa demony skompilowane roznymi wersjami Rust moga wyliczyc rozne hashe, co spowoduje niepotrzebne pelne synce (zamiast delta).
- **Rekomendacja:** Uzyc SHA-256 (juz jest w dependencies) lub `siphasher` crate z ustalonymi parametrami.

### RD-W2. Duza alokacja pamieci przy merge
- **Plik:** `src/sync_common.rs`, linia ~257
- **Problem:** Caly payload sync (potencjalnie 50-100 MB) jest parsowany do `serde_json::Value` w pamieci. Brak zabezpieczenia przed OOM.
- **Rekomendacja:** Dodac limit rozmiaru przed parsowaniem lub uzyc streaming JSON parser.

### RD-W3. Brak limitu rozmiaru gzip decompression — gzip bomb
- **Plik:** `src/sync_encryption.rs`, linia 196-200
- **Problem:** `GzDecoder::read_to_end()` bez limitu. Atakujacy moglby wyslac "gzip bomb" powodujac OOM.
- **Rekomendacja:** Czytac w petli z limitem (np. `MAX_DECOMPRESSED_SIZE = 200 * 1024 * 1024`).

### RD-W4. Brak timeout na WMI query
- **Plik:** `src/monitor/wmi_detection.rs`, linia 136-152
- **Problem:** Zapytanie WMI moze sie zawiesic na przeciazonym systemie. Brak timeout moze zablokowac watek monitorujacy.
- **Rekomendacja:** Dodac timeout na zapytanie WMI.

### RD-W5. Duplikacja logiki device_id (5 miejsc)
- **Plik:** `src/online_sync.rs`
- **Problem:** Ten sam wzorzec `if settings.device_id.is_empty() { lan_common::get_device_id() } else { settings.device_id.clone() }` powtarza sie w 5 miejscach.
- **Rekomendacja:** Wyekstrahowac do `OnlineSyncSettings::effective_device_id(&self) -> String`.

### RD-W6. Plik tymczasowy z danymi sync nie jest kasowany przy panicu
- **Plik:** `src/lan_sync_orchestrator.rs`, linia 427
- **Problem:** `lan_sync_incoming_{ts}.json` jest zapisywany na dysk, ale kasowany dopiero na koncu (linia 554). Przy panicu plik z pelnymi danymi bazy zostaje na dysku.
- **Rekomendacja:** Uzyc RAII guard (Drop impl) do czyszczenia pliku tymczasowego.

### RD-W7. Hardcoded CORS origin
- **Plik:** `src/lan_server.rs`, linia 481
- **Problem:** `Access-Control-Allow-Origin: http://localhost` — nie zadziala dla dashboardu na `https://localhost` lub `http://127.0.0.1`.
- **Rekomendacja:** Dynamicznie ustawiac origin na podstawie hosta requestu, lub wspierac oba warianty.

### RD-W8. `pid_cache.rs` — semantyka `cached_at` jest mylaca
- **Plik:** `src/monitor/pid_cache.rs`, linia 78-79
- **Problem:** `cached_at` jest nadpisywany przy kazdym cache hit, co zmienia semantyke z "kiedy wpis zostal dodany" na "kiedy ostatnio uzyty". Wpis nigdy nie wygasnie dopoki proces jest na pierwszym planie.
- **Rekomendacja:** Rozdzielic na `created_at` i `last_accessed_at`.

### RD-W9. `config.rs` — poisoned mutex blokuje cache na stale
- **Plik:** `src/config.rs`, linia 323-357
- **Problem:** Przy poisoned mutex (`lock()` zwraca `Err`) cache nigdy nie zostanie zaktualizowany — konfiguracja bedzie ladowana z dysku przy kazdym wywolaniu.
- **Rekomendacja:** Uzyc `mutex.lock().unwrap_or_else(|e| e.into_inner())` dla recovery z poisoned state.

### RD-W10. `tracker.rs` — SeqCst na failure ordering
- **Plik:** `src/tracker.rs`, linia 92
- **Problem:** `compare_exchange` z `Ordering::SeqCst` na failure path jest niepotrzebnie drogi — `Relaxed` wystarczy.
- **Rekomendacja:** Zmienic failure ordering na `Ordering::Relaxed`.

---

## 4. Rust Daemon — SUGESTIE

### RD-S1. i18n — niespojnosc jezykowa w logach sync
- **Problem:** `sync_log` wiadomosci mieszaja PL i EN: `"SKIP sesja (brak lokalnego app_id)"` (PL) vs `"Merge failed"` (EN).
- **Rekomendacja:** Ujednolicic jezyk logow (preferowany EN dla logow technicznych).

### RD-S2. Martwy kod — `status_text()` brak kodu 413
- **Plik:** `src/lan_server.rs`, linia 492
- **Problem:** Brak obslugui kodu 413 w match, mimo uzycia w `handle_connection`. Zwroci `"Unknown"`.
- **Rekomendacja:** Dodac `413 => "Payload Too Large"`.

### RD-S3. `storage.rs` — `truncate_middle` alokuje niepotrzebnie
- **Plik:** `src/storage.rs`, linia 55-58
- **Problem:** Dla krotkiego stringa (najczestszy przypadek) `to_string()` alokuje nowy String.
- **Rekomendacja:** Zwracac `Cow<str>`.

### RD-S4. `online_sync.rs` — retry backoff rosnie szybko
- **Problem:** `RETRY_BASE_DELAY * 3^attempt` daje 5s, 15s, 45s. Brak komentarza uzasadniajacego.
- **Rekomendacja:** Dodac komentarz z maksymalnym czasem oczekiwania.

### RD-S5. `foreground_hook.rs` — brak komentarza SAFETY
- **Problem:** Callback `win_event_proc` jest `unsafe extern "system"`, ale wewnatrz uzywa `RefCell`. Brak komentarza Safety.
- **Rekomendacja:** Dodac `// SAFETY: thread_local! gwarantuje...`.

### RD-S6. `sync_common.rs` — `RestoreResult` jest nieuzywany
- **Problem:** Struct `RestoreResult` (linia 147) jest zdefiniowany ale nigdy nie czytany.
- **Rekomendacja:** Zamienic na `()` lub usunac.

### RD-S7. `single_instance.rs` — brak cleanup przy panicu
- **Problem:** Named mutex nie jest zwalniany przy panicu. W praktyce OS zwalnia przy zakonczeniu procesu, ale warto to udokumentowac.

### RD-S8. `lan_discovery.rs` — nieuzywana stala `DASHBOARD_PORT_DEFAULT`
- **Problem:** Stala jest zdefiniowana ale uzywana tylko w jednym miejscu jako wartosc domyslna.
- **Rekomendacja:** Inline'owac lub udokumentowac cel.

---

## 5. Dashboard React — KRYTYCZNE

### DB-K1. Zahardkodowany polski tekst jako fallback i18n
- **Plik:** `dashboard/src/components/sync/SyncProgressOverlay.tsx`, linia 173
- **Problem:** `t('sync_progress.frozen_notice', 'Rejestrowanie wpisow jest wstrzymane...')` — fallback jest po polsku, klucz nie istnieje w zadnym pliku locale. Uzytkownicy anglojezyczni zobacza polski tekst.
- **Naprawa:** Dodac klucz do obu plikow locale, fallback ustawic po angielsku.

### DB-K2. Zahardkodowany angielski tekst bez i18n
- **Plik:** `dashboard/src/components/sync/DaemonSyncOverlay.tsx`, linia 146
- **Problem:** `"Dismiss — sync may still be running"` — bezposredni string bez `t()`. Polskojezyczni uzytkownicy zobacza angielski tekst.
- **Naprawa:** Opakowac w `t('daemon_sync.dismiss_warning')`.

### DB-K3. 9 brakujacych kluczy i18n w sync components
- **Pliki:** `SyncProgressOverlay.tsx`, `BackgroundServices.tsx`
- **Brakujace klucze:**
  - `sync_progress.online_title`
  - `sync_progress.title`
  - `sync_progress.retry`
  - `sync_progress.dismiss`
  - `sync_progress.frozen_notice`
  - `background.ai_assigned_sessions`
  - `background.online_sync_pulled`
  - `background.online_sync_pushed`
  - `background.lan_sync_done`
- **Efekt:** Wyswietlaja sie angielskie fallbacki lub (w DB-K1) polski tekst.

### DB-K4. Stale closure w useEffect — handleSync
- **Plik:** `dashboard/src/components/sync/LanPeerNotification.tsx`, linia 76-106
- **Problem:** `useEffect` z pusta tablica zaleznosci `[]` wywoluje `handleSync`, ktory jest `const` zdefiniowany nizej jako `useCallback` — w momencie mountu `handleSync` jest `undefined`.
- **Efekt:** Jesli `autoSyncOnPeerFound` jest wlaczone, sync nie zadziala przy pierwszym pollingu.
- **Naprawa:** Przeniesc logike handleSync wewnatrz useEffect lub dodac do tablicy zaleznosci.

### DB-K5. Brak walidacji JSON.parse z localStorage
- **Plik:** `dashboard/src/components/sync/LanPeerNotification.tsx`, linia 24-30
- **Problem:** `JSON.parse(raw)` bez try/catch. Uszkodzony localStorage spowoduje crash komponentu.
- **Naprawa:** Dodac try/catch wokol `JSON.parse`.

---

## 6. Dashboard React — WAZNE

### DB-W1. Token API w URL (SSE)
- **Plik:** `dashboard/src/lib/sync/sync-sse.ts`, linia 40-46
- **Problem:** Token autoryzacyjny jako query parameter URL — logowany przez proxy, CDN i access logi serwera.
- **Rekomendacja:** Migrowac na krotkotrwaly SSE ticket lub `fetch()` streaming z headerem Authorization.

### DB-W2. Brakujaca zaleznosc `onRetry` w useEffect
- **Plik:** `dashboard/src/components/sync/SyncProgressOverlay.tsx`, linia 98
- **Problem:** `onRetry` jest uzywany wewnatrz useEffect ale nie jest w tablicy zaleznosci `[active, onFinished, syncType]`.
- **Naprawa:** Dodac `onRetry` do tablicy zaleznosci.

### DB-W3. Zahardkodowany aria-label
- **Plik:** `dashboard/src/components/sync/LanPeerNotification.tsx`, linia 209
- **Problem:** `aria-label="Dismiss"` — brak i18n, niedostepne dla polskich czytnikow ekranowych.
- **Naprawa:** `aria-label={t('common.dismiss')}`.

### DB-W4. 73 wywolania console.log/warn/error w produkcji
- **Pliki:** 30 plikow (m.in. `ProjectPage.tsx` — 11, `AI.tsx` — 8, `Projects.tsx` — 7)
- **Problem:** Brak zunifikowanego loggera z kontrola poziomu. W trybie produkcyjnym zanieczyszcza konsole i potencjalnie ujawnia dane.
- **Naprawa:** Przeniesc na istniejacy `logTauriError` lub dedykowany logger z flaga `isDev`.

### DB-W5. Duplikacja logiki context menu
- **Plik:** `dashboard/src/pages/Sessions.tsx`, linia 251, 310
- **Problem:** Komentarze TODO wskazuja na powtorzona logike placement i click-outside dismiss, wspoldzielona z `ProjectDayTimeline`.
- **Naprawa:** Wyekstrahowac do wspolnego hooka `useContextMenuPlacement`.

### DB-W6. Brak sekcji Help dla recznych sesji i session split
- **Problem:** Help.tsx nie dokumentuje tworzenia/edycji recznych sesji, mechanizmu podzialu sesji i jego parametrow, ani widoku session merge.
- **Naprawa:** Rozszerzyc `HelpSessionsSection` o te podsekcje.

### DB-W7. Brak dokumentacji Help dla Reports templates i PM matching
- **Problem:** Sekcje `HelpReportsSection` i `HelpPmSection` moga nie opisywac nowych funkcji (template drag-and-drop w Reports, TF matching w PM).
- **Naprawa:** Zweryfikowac i uzupelnic zgodnie z CLAUDE.md.

---

## 7. Dashboard React — SUGESTIE

### DB-S1. Duze pliki — kandydaci do dekompozycji
- `Sessions.tsx` ~830 linii, `Projects.tsx` ~1134 linii, `ProjectPage.tsx` duzy
- Czesc logiki juz wyekstrahowana do hookow — kontynuowac ten wzorzec.

### DB-S2. Deep equality checks w background-status-store.ts
- **Problem:** ~80 linii recznych porownan pole-po-polu. Przy zmianie interfejsu trzeba aktualizowac oba miejsca (typ + comparator).
- **Sugestia:** `fast-deep-equal` (~400 bajtow) lub `JSON.stringify` dla prostych obiektow.

### DB-S3. Throttle refresh — magiczne liczby
- **Plik:** `dashboard/src/store/data-store.ts`
- **Problem:** Throttle 150ms i dedup 1s to zahardkodowane wartosci bez komentarza.
- **Sugestia:** Wyekstrahowac do nazwanych stalych z komentarzem.

### DB-S4. SSE reconnect — brak limitu prob
- **Plik:** `dashboard/src/lib/sync/sync-sse.ts`
- **Problem:** Exponential backoff bez maksymalnego limitu prob. Przy dlugotrwalej awarii serwera proby nigdy nie ustana.
- **Sugestia:** Dodac `MAX_RECONNECT_ATTEMPTS` z powiadomieniem uzytkownika.

### DB-S5. useSettingsFormState — 8 wywolan console.error
- **Problem:** Nadmierna ilosc console.error dla operacji ktore moga regularnie failowac (np. brak polaczenia).
- **Sugestia:** Zastapic `logTauriError` z odpowiednim poziomem logowania.

### DB-S6. Niespojnosc terminologii UI — "Synchronizacja" vs "Sync"
- **Problem:** W kodzie i UI mieszane uzycie "sync", "synchronization" i polskich odpowiednikow.
- **Sugestia:** Ustandaryzowac w plikach locale (jedno slowo na jedno pojecie).

### DB-S7. Brakujace memoizacje
- **Problem:** Warto sprawdzic komponenty z duzymi listami (SessionsVirtualList, ProjectsList) pod katem brakujacych `useMemo`/`useCallback`.
- **Sugestia:** Profilowac z React DevTools Profiler i dodac memoizacje tam, gdzie re-rendery sa kosztowne.

---

## 8. Serwer Sync — KRYTYCZNE

### SV-K1. Race condition w `direct-sync.ts` — brak mutexu per-user
- **Plik:** `__cfab_server/src/lib/sync/direct-sync.ts`, linia 352-426, 504-802
- **Problem:** `license-store.ts` ma mutex (`withMutex`), ale `direct-sync.ts` wykonuje read-modify-write na plikach (`meta.json`, `snapshot.json.gz`) bez blokady. Dwa rownolegle requesty `handlePush/handleDeltaPush` dla tego samego userId moga spowodowac:
  - Utrate danych (nadpisanie snapshot przez starszy request)
  - Niespojnosc miedzy `meta.json` a `snapshot.json.gz`
  - Obciecie rewizji (revision counter nie jest atomowy)
- **Rekomendacja:** Dodac per-user mutex analogiczny do `license-store.ts`.

### SV-K2. Brak autoryzacji przy async-delta ack/reject
- **Plik:** `__cfab_server/src/lib/sync/async-delta.ts`, linia 172-241
- **Problem:** Parametr `userId` jest przyjmowany ale nigdy nie weryfikowany przeciwko `pkg.groupId` ani `pkg.fromDeviceId`. Dowolny uwierzytelniony uzytkownik moze potwierdzic/odrzucic pakiet innego uzytkownika znajac `packageId`.
- **Rekomendacja:** Dodac walidacje `group.ownerId === userId` przed zmiana statusu.

### SV-K3. Credential leakage w async-delta
- **Plik:** `__cfab_server/src/lib/sync/async-delta.ts`, linia 252-292
- **Problem:** `handleAsyncCredentials` zwraca zaszyfrowane kredencjaly SFTP/S3 dla dowolnego `packageId` bez weryfikacji czy `userId` nalezy do grupy. Atakujacy z waznym tokenem moze uzyskac dostep do storage innego uzytkownika.
- **Rekomendacja:** Dodac walidacje `group.ownerId === userId`.

### SV-K4. Token SSE w query string
- **Plik:** `__cfab_server/src/app/api/sync/events/route.ts`, linia 29-35
- **Problem:** Token API przesylany jako `?token=xxx`. Tokeny w query string sa logowane przez proxy, load balancery, access logi.
- **Rekomendacja:** Jednorazowy ticket (short-lived token wymieniany na sesje SSE).

### SV-K5. Admin API CORS `access-control-allow-origin: *`
- **Plik:** `__cfab_server/src/lib/sync/admin-http.ts`, linia 16
- **Problem:** Admin API (tworzenie licencji, usuwanie urzadzen) zwraca wildcard CORS. W polaczeniu z cookie-based auth stanowi wektor CSRF.
- **Rekomendacja:** Ograniczyc origin do domeny dashboardu.

---

## 9. Serwer Sync — WAZNE

### SV-W1. `handleDeltaPush` ignoruje `baseRevision`
- **Plik:** `__cfab_server/src/lib/sync/direct-sync.ts`, linia 504-512
- **Problem:** Klient wysyla `baseRevision` ale serwer go ignoruje. Delta jest aplikowana nawet jesli nie odpowiada aktualnej rewizji — Last Write Wins bez ostrzezenia.
- **Rekomendacja:** Porownac `body.baseRevision` z `currentRevision` i odrzucic delta jesli `baseRevision < currentRevision`.

### SV-W2. Delta merge jest additive-only — brak conflict resolution
- **Plik:** `__cfab_server/src/lib/sync/direct-sync.ts`, linia 549-722
- **Problem:** Merge delta nadpisuje istniejace rekordy bez porownania timestampow (`updated_at`). Dwa urzadzenia modyfikujace ten sam rekord — wygrywa ostatni push.
- **Rekomendacja:** Porownywac `updated_at` i brac nowszy rekord lub logowac konflikt.

### SV-W3. `license/activate` — brak rate limitingu
- **Plik:** `__cfab_server/src/app/api/license/activate/route.ts`
- **Problem:** Endpoint nie ma rate limitu. Umozliwia brute-force kluczy licencyjnych.
- **Rekomendacja:** Rate limiting per IP (np. 5 prob/min).

### SV-W4. `license/activate` — enumeration attack
- **Problem:** Rozne komunikaty bledow dla "Invalid license key format" vs "License key not found" pozwalaja rozroznic wadliwy format od nieistniejacego klucza.
- **Rekomendacja:** Jednolity blad "Invalid or unknown license key".

### SV-W5. Device token pozwala override userId
- **Plik:** `__cfab_server/src/lib/auth/server-auth.ts`, linia 103-109
- **Problem:** `userId: bodyUserId || deviceUserId` — klient moze podac dowolne `bodyUserId` i uzyskac dostep do danych innego uzytkownika.
- **Rekomendacja:** Zawsze uzywac `deviceUserId` (z grupy licencyjnej).

### SV-W6. SSE — brak obslugi `request.signal` (abort)
- **Plik:** `__cfab_server/src/app/api/sync/events/route.ts`, linia 60-92
- **Problem:** Strumien SSE nie slucha `request.signal`. Listener pozostaje w `event-bus` do restartu serwera — memory leak przy wielu reconnectach.
- **Rekomendacja:** Dodac `request.signal.addEventListener('abort', cleanup)`.

### SV-W7. File-based license store bez WAL
- **Plik:** `__cfab_server/src/lib/sync/license-store.ts`, linia 79
- **Problem:** Zapis calego store do pliku (`writeFile`) nie jest atomowy. Awaria serwera podczas zapisu moze uszkodzic plik.
- **Rekomendacja:** Atomic write (write to temp + rename) lub migracja do bazy danych.

### SV-W8. Event bus in-memory — brak dystrybucji
- **Plik:** `__cfab_server/src/lib/sync/event-bus.ts`
- **Problem:** Przy skalowaniu do wiecej niz jednej instancji klienci nie dostana notyfikacji SSE.
- **Rekomendacja:** Redis Pub/Sub lub polling fallback.

### SV-W9. `forceFullSync` nie zapisuje zmiany do bazy
- **Plik:** `__cfab_server/src/lib/sync/session-service.ts`, linia 137-139
- **Problem:** `session.syncMode = "full"` modyfikuje obiekt lokalnie ale NIE jest zapisywana do bazy. Kolejne pollowanie zwroci stary `syncMode`.
- **Rekomendacja:** Wykonac update w bazie po zmianie syncMode.

---

## 10. Serwer Sync — SUGESTIE

### SV-S1. N+1 query pattern w dashboard data
- **Plik:** `__cfab_server/src/lib/sync/dashboard.ts`, linia 22-27
- `getDevicesForLicense` wolane w petli per licencja. Lepiej pobrac wszystkie devices jednorazowo.

### SV-S2. Bledny rozmiar snapshota — sprawdza `snapshot.json` zamiast `.json.gz`
- **Plik:** `__cfab_server/src/lib/sync/online-sync-repository.ts`, linia 88
- Zawsze zwroci 0 (plik nie istnieje).

### SV-S3. History append bez atomowosci
- **Plik:** `__cfab_server/src/lib/sync/direct-sync.ts`, linia 222-236
- Rownolegle requesty moga nadpisac historie.

### SV-S4. `resolveLicenseContext` — uzytkownik z wieloma grupami dostaje zla grupe
- **Plik:** `__cfab_server/src/lib/sync/session-service.ts`, linia 36-48
- `groups.find(g => g.ownerId === userId)` zwraca pierwsza grupe.

### SV-S5. `touchDeviceLastSeen` czyta/zapisuje caly store na kazdym request
- Potencjalne waskie gardlo I/O przy duzym ruchu.

### SV-S6. FTP adapter zwraca `protocol: "sftp"` zamiast `"ftp"`
- **Plik:** `__cfab_server/src/lib/sync/sftp-manager.ts`, linia 518

### SV-S7. Brak paginacji listy licencji/grup w admin API
- Wszystkie licencje zwracane bez limitu.

### SV-S8. `handleTestRoundtrip` ujawnia sciezke serwera w odpowiedzi
- **Plik:** `__cfab_server/src/lib/sync/direct-sync.ts`, linia 859
- Zwraca pelna sciezke systemowa serwera.

### SV-S9. Niespojny format odpowiedzi bledow
- `license/activate/route.ts` uzywa wlasnego formatu vs `isAppError()` + `responseFromError()` w innych endpointach.

### SV-S10. Bias w generowaniu kluczy licencyjnych
- **Plik:** `__cfab_server/src/lib/sync/license-keygen.ts`, linia 9
- `bytes[b] % CHARSET.length` (29 znakow, 256 wartosci) — bias ~3%. Warto zastosowac rejection sampling.

---

## 11. Brakujace tlumaczenia i18n

### Dashboard — brakujace klucze

| Klucz | Plik | Linia | Obecny fallback |
|-------|------|-------|-----------------|
| `sync_progress.online_title` | SyncProgressOverlay.tsx | 130 | EN |
| `sync_progress.title` | SyncProgressOverlay.tsx | 131 | EN |
| `sync_progress.retry` | SyncProgressOverlay.tsx | 159 | EN |
| `sync_progress.dismiss` | SyncProgressOverlay.tsx | 165 | EN |
| `sync_progress.frozen_notice` | SyncProgressOverlay.tsx | 173 | **PL** |
| `background.ai_assigned_sessions` | BackgroundServices.tsx | 38 | EN |
| `background.online_sync_pulled` | BackgroundServices.tsx | 43 | EN |
| `background.online_sync_pushed` | BackgroundServices.tsx | 45 | EN |
| `background.lan_sync_done` | BackgroundServices.tsx | 50 | EN |
| `daemon_sync.dismiss_warning` | DaemonSyncOverlay.tsx | 146 | EN (brak t()) |
| `common.dismiss` | LanPeerNotification.tsx | 209 | EN (aria-label) |

### Rust Daemon — niespojnosc jezykowa logow
- Wiadomosci `sync_log` mieszaja PL i EN. Logowanie nie wymaga i18n, ale niespojnosc jest mylaca.

---

## 12. Brakujaca dokumentacja Help

Nastepujace funkcjonalnosci nie sa opisane w sekcjach Help (`dashboard/src/components/help/`):

| Funkcja | Istniejaca sekcja Help | Status |
|---------|----------------------|--------|
| Reczne sesje (manual sessions) | HelpSessionsSection | **BRAK opisu** |
| Podzial sesji (session split) i parametry | HelpSessionsSection | **BRAK opisu** |
| Laczenie sesji (session merge) | HelpSessionsSection | **BRAK opisu** |
| Template drag-and-drop w Reports | HelpReportsSection | **Do weryfikacji** |
| TF matching w PM | HelpPmSection | **Do weryfikacji** |
| Background Services (startup) | HelpSettingsSection | **Do weryfikacji** |
| DaemonControl (status demona) | Brak sekcji | **BRAK opisu** |
| Import/Export danych | HelpDataSection | **Do weryfikacji** |

---

## 13. Plan napraw — priorytety

### Faza 1 — Bezpieczenstwo (priorytet najwyzszy)
1. **SV-K2/K3** — Dodac walidacje wlasciciela w async-delta (ack/reject/credentials)
2. **SV-K5** — Ograniczyc CORS w admin API
3. **SV-W5** — Naprawic override userId przy device token auth
4. **RD-K1** — Zamienic SQL injection na rusqlite::backup API
5. **RD-K2** — Wdrozyc trust-on-first-use dla SSH host key
6. **RD-W3** — Dodac limit decompression (gzip bomb protection)
7. **SV-S8** — Usunac ujawnianie sciezki serwera w testRoundtrip

### Faza 2 — Integralnosc danych
8. **SV-K1** — Per-user mutex w direct-sync.ts
9. **SV-W1** — Weryfikacja baseRevision przy delta push
10. **SV-W2** — Conflict resolution z porownaniem updated_at
11. **SV-W9** — Zapis forceFullSync do bazy danych
12. **RD-W1** — Stabilny hash zamiast DefaultHasher
13. **SV-W7** — Atomic write dla license-store

### Faza 3 — UX i i18n
14. **DB-K1/K2/K3** — Dodac brakujace 11 kluczy i18n
15. **DB-K4** — Naprawic stale closure w LanPeerNotification
16. **DB-K5** — try/catch wokol JSON.parse
17. **DB-W6/W7** — Uzupelnic brakujace sekcje Help
18. **DB-W4** — Zunifikowac logowanie (console.* -> logger)

### Faza 4 — Wydajnosc i refactoring
19. **RD-W5** — Wyekstrahowac `effective_device_id()`
20. **SV-W6** — Obsluga abort signal w SSE
21. **SV-W3** — Rate limiting na license/activate
22. **RD-W2** — Limit rozmiaru payload sync
23. **DB-S1** — Dekompozycja duzych komponentow

---

*Raport wygenerowany automatycznie na podstawie analizy 3 warstw: Rust daemon (22 pliki .rs), React dashboard (~100 plikow .tsx/.ts), serwer sync (Next.js API routes).*
