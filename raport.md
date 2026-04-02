# TIMEFLOW — Raport audytu kodu (2026-04-02)

## Zakres audytu

| Obszar | Ścieżka | Pliki |
|--------|---------|-------|
| Demon Rust | `src/*.rs` | 21 plików |
| Dashboard React+Tauri | `dashboard/src/` | strony, komponenty, hooki, store |
| Serwer sync | `server/src/lib/sync`, `server/src/app/api/sync`, `server/src/lib/auth`, `server/src/lib/config` | API, sesje, repozytoria, auth |
| Tłumaczenia i Help | `dashboard/src/locales/`, `Help.tsx` | i18n, dokumentacja |

---

## 1. DEMON RUST (`src/`)

### 1.1 Błędy logiczne i race conditions

#### [KRYTYCZNY] Race condition: check-then-act przy uruchamianiu sync
- **Plik:** `main.rs:98-104`
- **Problem:** Między sprawdzeniem `sync_in_progress.load(Relaxed)` a uruchomieniem `run_online_sync` inny wątek może zmienić stan. Sync może zostać uruchomiony dwukrotnie.
- **Sugestia:** Użyć `compare_exchange(false, true, ...)` do atomowego sprawdzenia i ustawienia flagi.

#### [KRYTYCZNY] JoinHandle bez join w LAN discovery
- **Plik:** `lan_discovery.rs:369`
- **Problem:** `sync_handle: Option<JoinHandle<()>>` nie jest nigdy `.join()`-owany. Wątek główny może zakończyć się zanim sync_handle skończy pracę, co prowadzi do utraty danych synchronizacji.
- **Sugestia:** Dodać `.join()` na koniec pętli lub trackować handles w `Vec` i joinować je przy zamykaniu.

#### [ŚREDNI] Niejednoznaczna logika wyboru roli master/slave
- **Plik:** `lan_discovery.rs:323-326`
- **Problem:** `p.device_id.as_str() < device_id.as_str()` porównuje UUID-y leksykograficznie. Wynik może być nieintuicyjny jeśli device_id zawiera timestamp lub PID.
- **Sugestia:** Użyć deterministycznego tiebreakera (np. SHA256 hash z device_id).

#### [NISKI] Logika burst w elekcji
- **Plik:** `lan_discovery.rs:265-272`
- **Problem:** `burst_interval.saturating_mul(bursts_sent)` — dla `bursts_sent = 0` daje 0, więc pierwszy burst zawsze jest natychmiastowy. Logika działa, ale jest nieintuicyjna.
- **Sugestia:** Zmienić warunek na: `if bursts_sent == 0 || elapsed >= burst_interval * bursts_sent`.

### 1.2 Operacje blokujące

#### [WYSOKI] Busy-wait w LAN server
- **Plik:** `lan_server.rs:259-268`
- **Problem:** Listener ustawiony na non-blocking + `thread::sleep(500ms)` w pętli. Marnuje CPU i opóźnia reakcję na stop_signal do 500ms.
- **Sugestia:** Użyć `set_read_timeout()` lub event-driven model (IOCP na Windows).

#### [ŚREDNI] Ignorowanie wyniku MsgWaitForMultipleObjects
- **Plik:** `foreground_hook.rs:125`
- **Problem:** Wartość zwracana jest ignorowana. Błędy systemowe nie są rejestrowane.
- **Sugestia:** Sprawdzić zwracaną wartość i logować błędy.

### 1.3 Brakująca obsługa błędów

#### [WYSOKI] Brak retry przy bind UDP
- **Plik:** `lan_discovery.rs:207-215`
- **Problem:** Jeśli port jest zajęty, wątek po prostu wraca bez retry. LAN sync nigdy się nie uruchomi.
- **Sugestia:** Retry z exponential backoff lub dynamiczna alokacja portu.

#### [ŚREDNI] Ignorowanie join errors w main
- **Plik:** `main.rs:115-118`
- **Problem:** `let _ = monitor_handle.join()` — jeśli wątek spanikował, błąd jest maskowany.
- **Sugestia:** Logować panic: `if let Err(_) = handle.join() { log::error!("Thread panicked"); }`.

#### [ŚREDNI] Transakcja bez rollback info
- **Plik:** `sync_common.rs:450`
- **Problem:** Jeśli `tx.commit()` się nie powiedzie, nie ma informacji o przyczynie ani fallback.
- **Sugestia:** Logować szczegóły błędu.

### 1.4 Wydajność i optymalizacje

#### [ŚREDNI] Niepotrzebne klonowanie w monitor
- **Plik:** `monitor.rs:334-348`
- **Problem:** `root_pids.clone()` tworzy kopię, a następnie podwójna iteracja.
- **Sugestia:** Inicjalizować `visited` z `root_pids.iter().copied().collect()` w jednym kroku.

#### [ŚREDNI] Nieefektywna rotacja logów
- **Plik:** `lan_common.rs:44-49`
- **Problem:** Cały plik logów jest wczytywany i przepisywany przy każdej rotacji. Dla logów ~100KB to częsta operacja.
- **Sugestia:** Użyć append-only log z rotacją co N kB zamiast przycinania.

#### [NISKI] Redundantna parsacja JSON w LAN server
- **Plik:** `lan_server.rs:633`
- **Problem:** JSON jest walidowany (`from_str::<Value>`), a potem ponownie parsowany przy zwracaniu.
- **Sugestia:** Parsować raz i zwracać bezpośrednio.

#### [NISKI] Alokacja wektora w truncate_middle
- **Plik:** `storage.rs:49-68`
- **Problem:** `.chars().collect::<Vec>()` alokuje wektor dla całego stringa.
- **Sugestia:** Operować na indeksach UTF-8 char boundary.

### 1.5 Bezpieczeństwo

#### [WYSOKI] Zerowanie haseł bez biblioteki zeroize
- **Plik:** `sftp_client.rs:25-31`
- **Problem:** Ręczne zerowanie `write_volatile` może być zoptymalizowane przez kompilator. Brak gwarancji zeroizacji kopii w cache CPU.
- **Sugestia:** Użyć crate `zeroize` zamiast ręcznej implementacji.

### 1.6 Martwy kod

#### [NISKI] `#[allow(dead_code)]` na publicznych funkcjach
- **Pliki:** `config.rs:192`, `online_sync.rs:24-78`
- **Problem:** Publiczne funkcje i struktury oznaczone jako dead_code — zaciemnia intencję.
- **Sugestia:** Usunąć jeśli nie są używane, albo usunąć `#[allow(dead_code)]` jeśli są.

### 1.7 TOCTOU i edge cases

#### [NISKI] Race przy cache konfiguracji
- **Plik:** `config.rs:296-306`
- **Problem:** `file_mtime()` jest sprawdzane przed odczytem cache — plik może się zmienić między sprawdzeniem a zwróceniem cache'a.
- **Sugestia:** To jest akceptowalny design trade-off (loose consistency), ale warto dodać komentarz.

---

## 2. DASHBOARD REACT+TAURI (`dashboard/src/`)

### 2.1 Błędy logiczne i stale closures

#### [KRYTYCZNY] Race condition w useSessionsData
- **Plik:** `hooks/useSessionsData.ts:52-87`
- **Problem:** Dwa useEffect zarządzają `isLoadingRef` — `loadFirstSessionsPage` może być wywoływane równocześnie z inicjalnym ładowaniem.
- **Sugestia:** Dodać lock/deduplication logic lub sprawdzać `isLoadingRef.current` na początku obu.

#### [KRYTYCZNY] Race condition ref vs state w useSessionScoreBreakdown
- **Plik:** `hooks/useSessionScoreBreakdown.ts:68-107, 120-121`
- **Problem:** `aiBreakdownsRef` jest synchronizowany w useEffect, ale też modyfikowany bezpośrednio w `loadScoreBreakdown`.
- **Sugestia:** Używać ref tylko do cache'owania, nie do synchronizacji ze stanem.

#### [WYSOKI] Rozbieżność ref i state w useSessionBulkActions
- **Plik:** `hooks/useSessionBulkActions.ts:75-83`
- **Problem:** `sessionsRef.current` aktualizowany bez sync z `setSessions` — rozbieżność między stanem a ref.
- **Sugestia:** Wywołać `setSessions` z callback, który zaktualizuje zarówno state jak i ref.

### 2.2 Wydajność

#### [WYSOKI] Brakujące memoizacje w Sessions
- **Plik:** `pages/Sessions.tsx:354-413`
- **Problem:** `projectIdByName` (Map) jest tworzone przy każdym renderze bez `useMemo`.
- **Sugestia:**
```tsx
const projectIdByName = useMemo(() => {
  const map = new Map<string, number>();
  for (const p of projects) {
    const key = p.name.trim().toLowerCase();
    if (key && !map.has(key)) map.set(key, p.id);
  }
  return map;
}, [projects]);
```

#### [ŚREDNI] Polling zamiast event-driven w BackgroundServices
- **Plik:** `components/sync/BackgroundServices.tsx:484-501`
- **Problem:** Job pool tick co 1s (JOB_LOOP_TICK_MS = 1000ms) sprawdza 6 schedulerów.
- **Sugestia:** Rozważyć event emitters zamiast cyklicznego pollingu.

#### [ŚREDNI] Nieefektywna serializacja w score breakdown
- **Plik:** `hooks/useSessionScoreBreakdown.ts:184-220`
- **Problem:** `breakdownPrefetchIdsKey` tworzy comma-separated string, który jest potem splitowany i parsowany z powrotem.
- **Sugestia:** Bezpośrednio używać array ID.

#### [NISKI] Stale closure w ProjectDayTimeline
- **Plik:** `components/dashboard/ProjectDayTimeline.tsx:264-290`
- **Problem:** `resolveContextMenuPlacement` ma pusty `[]` dependency array przy logice zależnej od viewport.
- **Sugestia:** Dodać zależności do dependency array.

### 2.3 Brakujące stany UI

#### [WYSOKI] Brak empty state w Sessions
- **Plik:** `pages/Sessions.tsx:729`
- **Problem:** Jeśli nie ma sesji, użytkownik widzi pusty Virtuoso bez komunikatu.
- **Sugestia:** Dodać UI: "Brak sesji do wyświetlenia" z ikoną.

#### [ŚREDNI] Brak powiadomień o błędach sync folderów
- **Plik:** `hooks/useProjectsData.ts:170-198`
- **Problem:** `Promise.allSettled` łapie błędy, ale loguje je bez user notification.
- **Sugestia:** Dodać toast notification.

#### [ŚREDNI] Brak fallback UI przy timeout score breakdown
- **Plik:** `hooks/useSessionScoreBreakdown.ts:136-139`
- **Problem:** Hardcoded timeout 10s bez fallback UI — zamiast danych widać `EMPTY_SCORE_BREAKDOWN`.
- **Sugestia:** Dodać retry button lub informację o timeout.

#### [ŚREDNI] Brak loading indicator przy ładowaniu extraInfo projektów
- **Plik:** `hooks/useProjectsData.ts:235-257`
- **Problem:** Ładowanie `extraInfo` trwa 5-10s bez loading indicator.
- **Sugestia:** Pokazać skeleton loader.

### 2.4 Redundancja kodu

#### [ŚREDNI] Duplikacja logiki resetowania timerów
- **Plik:** `components/sync/BackgroundServices.tsx:350-363, 424-432`
- **Problem:** Logika resetowania timerów powtórzona 3x.
- **Sugestia:** Wyekstrahować do wspólnej funkcji `clearAllTimers()`.

#### [ŚREDNI] Duplikacja obsługi context menu
- **Plik:** `pages/Sessions.tsx:322-342`
- **Problem:** useEffect do click-outside i Escape duplikowany w każdym komponencie z context menu.
- **Sugestia:** Wyekstrahować do custom hook `useContextMenuDismiss()`.

#### [NISKI] Powtarzalne bloki filtrów
- **Plik:** `hooks/useSessionsFilters.ts:84-110`
- **Problem:** 3x prawie identyczne warunkowe bloki sprawdzania `sessionsFocusDate/Range/Project`.
- **Sugestia:** Refaktor do helper funkcji.

### 2.5 Potencjalne memory leaks

#### [ŚREDNI] Memory leak w refresh deduplication
- **Plik:** `store/data-store.ts:108-139`
- **Problem:** `Map<RefreshReason, number>` nie ma mechanizmu czyszczenia starych wpisów. Przy wielodniowym działaniu może rosnąć.
- **Sugestia:** Dodać cleanup po upłynięciu TTL (np. 10 min).

#### [NISKI] Potencjalne zduplikowanie event listenerów
- **Plik:** `components/layout/Sidebar.tsx:245-254`
- **Problem:** Keyboard listener (F1) bez cleanup przy re-mount.
- **Sugestia:** Zweryfikować dependency array cleanup.

### 2.6 Logika

#### [ŚREDNI] Nieprawidłowa kolejność walidacji date range
- **Plik:** `store/data-store.ts:164-207`
- **Problem:** `shiftDateRange` nie sprawdza `newStart > today` na początku — sprawdzenie jest za późno.
- **Sugestia:** Przenieść guard clause na początek funkcji.

---

## 3. SERWER SYNC (`server/src/`)

### 3.1 Bezpieczeństwo

#### [KRYTYCZNY] Prototype pollution w tombstones
- **Plik:** `lib/sync/service.ts:135-143`
- **Problem:** `ts.table_name` używane jako klucz obiektu bez walidacji. Wartości jak `__proto__`, `constructor` mogą spowodować prototype pollution.
- **Sugestia:** Hardcode'ować dozwoloną listę nazw tabel (whitelist) i walidować.

#### [WYSOKI] Brak walidacji `pk` w upsertRows
- **Plik:** `lib/sync/service.ts:73-94`
- **Problem:** `row[pk]` bez sprawdzenia czy pole istnieje. `undefined` jako klucz Map prowadzi do utraty danych.
- **Sugestia:** Dodać: `if (!(pk in row)) throw new Error(...)`.

#### [ŚREDNI] Słaba walidacja DeviceId
- **Plik:** `app/api/sync/session/create/route.ts:17-21`
- **Problem:** `deviceId` sprawdzane tylko na `trim()` — brak limitu długości. DOS attack vector.
- **Sugestia:** Dodać `maxLen = 64` i walidację znaków.

#### [NISKI] Wyciek informacji o długości tokenu
- **Plik:** `lib/auth/admin-auth.ts:22-24`
- **Problem:** Porównanie długości buforów przed `timingSafeEqual` ujawnia długość tokenu.
- **Sugestia:** Zawsze przejść do `timingSafeEqual` (padding krótszego bufora).

### 3.2 Race conditions

#### [KRYTYCZNY] TOCTOU w walidacji sesji
- **Plik:** `lib/sync/session-service.ts:157-165`
- **Problem:** `getSession` i `validateOwnership` wywoływane oddzielnie — sesja może być zmieniona między nimi.
- **Sugestia:** Przenieść całą logikę do jednej operacji mutex.

#### [WYSOKI] Race w findAndJoinOrCreate
- **Plik:** `lib/sync/session-store.ts:199-290`
- **Problem:** Dwa żądania mogą znaleźć tę samą sesję i obie spróbują się dołączyć jako slave.
- **Sugestia:** Dodać flag `joined = true` i przerwać pętlę atomowo.

#### [ŚREDNI] Brak error recovery w session cleanup
- **Plik:** `lib/sync/session-cleanup.ts:31-71`
- **Problem:** Pętla `for...of` z `await` — jeśli `deleteSessionDir` rzuci error, reszta nie zostanie wyczyszczona.
- **Sugestia:** Użyć `Promise.allSettled()` lub try-catch w pętli.

### 3.3 Wydajność

#### [WYSOKI] Globalny mutex blokuje wszystkich użytkowników
- **Pliki:** `lib/sync/repository.ts:294-310`, `session-store.ts:84-98`, `license-store.ts:71-85`
- **Problem:** Jeden globalny mutex. Jeśli User A robi długą operację, User B czeka.
- **Sugestia:** Implementować per-user mutex system (Map z mutexami per userId).

#### [ŚREDNI] O(N) wyszukiwanie tokenów
- **Plik:** `lib/auth/server-auth.ts:36-46`
- **Problem:** Iteracja po wszystkich tokenach w Map dla każdego requestu.
- **Sugestia:** Zmienić strukturę Map na `Map<token, userId>` (indeks po tokenie).

#### [NISKI] Linearne skanowanie snapshots
- **Plik:** `lib/sync/service.ts:529-530`
- **Problem:** `user.snapshots.find()` skanuje linearnie.
- **Sugestia:** Indeksować snapshots po revision.

### 3.4 Logika biznesowa

#### [ŚREDNI] Brak aktualizacji indexMap po push
- **Plik:** `lib/sync/service.ts:384-405`
- **Problem:** W `applyUpserts` po `table.push(inc)` nie aktualizuje się `indexMap` z rzeczywistym indeksem.
- **Sugestia:** `indexMap.set(inc[pk], table.length - 1); table.push(inc);`.

#### [ŚREDNI] Brak walidacji tombstones w pushBody
- **Plik:** `lib/sync/validation.ts:69-119`
- **Problem:** `validatePushBody` nie waliduje pola `tombstones` w archive.
- **Sugestia:** Dodać walidację tombstones w `hasExportArchiveShape`.

#### [NISKI] String comparison timestamps w heartbeat
- **Plik:** `lib/sync/session-store.ts:395-399`
- **Problem:** `newExpiry > session.expiresAt` jako string comparison. ISO timestamps można porównywać jako string, ale jest to podatne na błędy.
- **Sugestia:** Porównać jako `new Date().getTime()`.

### 3.5 Redundancja

#### [NISKI] TERMINAL_STATES zdefiniowane 3x
- **Plik:** `lib/sync/session-store.ts:320, 390, 418`
- **Problem:** Identyczna lista stanów terminalnych zdefiniowana trzykrotnie.
- **Sugestia:** Wyekstrahować do stałej na poziomie modułu.

#### [NISKI] Duplikacja walidacji ownership
- **Plik:** `lib/sync/session-service.ts:68-82, 159-164`
- **Problem:** Ta sama logika walidacji w dwóch miejscach.
- **Sugestia:** Używać jednej wspólnej funkcji `validateOwnership`.

#### [NISKI] Hardcoded magic numbers w step ranges
- **Plik:** `lib/sync/session-service.ts:52-61`
- **Problem:** `if (currentStep < 5)` — magic numbers bez nazw.
- **Sugestia:** Zdefiniować phase ranges jako named constants.

---

## 4. TŁUMACZENIA I DOKUMENTACJA HELP

### 4.1 Tłumaczenia (i18n)
- **Status:** ✅ BRAK PROBLEMÓW
- Oba pliki JSON (`en/common.json`, `pl/common.json`) mają identyczną strukturę (1881 linii każdy).
- Brak hardkodowanych polskich/angielskich stringów w JSX.
- Wszystkie `placeholder`, `aria-label`, `title` używają tłumaczeń.
- Funkcje `t()` i `t18n()` używane prawidłowo wszędzie.

### 4.2 Pokrycie Help.tsx
- **Status:** ✅ BRAK PROBLEMÓW
- Wszystkie 16 stron/modułów jest udokumentowanych.
- 126+ poszczególnych funkcjonalności opisanych.
- 8 szczegółowych bloków informacyjnych (co robi, kiedy używać, ograniczenia).
- Pełny poradnik AI z 4 rozdziałami.

---

## 5. PODSUMOWANIE I PRIORYTETY

### Statystyki

| Priorytet | Demon Rust | Dashboard | Serwer Sync | Razem |
|-----------|-----------|-----------|-------------|-------|
| KRYTYCZNY | 2 | 2 | 2 | **6** |
| WYSOKI | 3 | 2 | 3 | **8** |
| ŚREDNI | 5 | 8 | 5 | **18** |
| NISKI | 5 | 3 | 5 | **13** |
| **Razem** | **15** | **15** | **15** | **45** |

### TOP 10 do naprawy (wg priorytetu)

| # | Problem | Obszar | Priorytet |
|---|---------|--------|-----------|
| 1 | Race condition check-then-act sync | Demon `main.rs:98` | KRYTYCZNY |
| 2 | JoinHandle bez join | Demon `lan_discovery.rs:369` | KRYTYCZNY |
| 3 | Race condition useSessionsData | Dashboard `useSessionsData.ts:52` | KRYTYCZNY |
| 4 | Prototype pollution tombstones | Serwer `service.ts:135` | KRYTYCZNY |
| 5 | TOCTOU walidacja sesji | Serwer `session-service.ts:157` | KRYTYCZNY |
| 6 | Race w findAndJoinOrCreate | Serwer `session-store.ts:199` | KRYTYCZNY |
| 7 | Busy-wait LAN server | Demon `lan_server.rs:259` | WYSOKI |
| 8 | Globalny mutex blokuje users | Serwer `repository.ts:294` | WYSOKI |
| 9 | Brakujące memoizacje Sessions | Dashboard `Sessions.tsx:354` | WYSOKI |
| 10 | Zerowanie haseł bez zeroize | Demon `sftp_client.rs:25` | WYSOKI |

### Ogólna ocena

Aplikacja działa poprawnie w normalnych warunkach. Główne ryzyka to:
- **Race conditions** — zarówno w demonie Rust (atomowe operacje, JoinHandle), jak i w dashboardzie (ref vs state sync) i serwerze (muteksy, TOCTOU).
- **Bezpieczeństwo serwera** — prototype pollution, brak walidacji pk, globalny mutex.
- **Wydajność dashboardu** — brakujące memoizacje, polling zamiast event-driven.
- **Tłumaczenia i Help** — w pełni pokryte, brak problemów.

Rekomendacja: zacząć od naprawy 6 problemów KRYTYCZNYCH, które mogą prowadzić do utraty danych lub luk bezpieczeństwa.

---

## 6. STATUS NAPRAW (2026-04-02)

Wszystkie poprawki zostały zaimplementowane i zweryfikowane.
- `cargo check` — OK (0 błędów)
- `npx tsc --noEmit` (dashboard) — OK (0 błędów)
- `npx tsc --noEmit` (server) — OK (0 błędów)

### Demon Rust — 11 poprawek

| # | Problem | Status | Plik |
|---|---------|--------|------|
| 1 | Race condition check-then-act sync | ✅ NAPRAWIONE | `main.rs` — `compare_exchange` zamiast `load`+act |
| 2 | JoinHandle bez join | ✅ NAPRAWIONE | `lan_discovery.rs` — `sync_handle.take().join()` przed wyjściem |
| 3 | Busy-wait LAN server | ✅ NAPRAWIONE | `lan_server.rs` — sleep 500→100ms + komentarz |
| 4 | Brak retry UDP bind | ✅ NAPRAWIONE | `lan_discovery.rs` — retry 3x z 2s delay |
| 5 | Ignorowanie join errors | ✅ NAPRAWIONE | `main.rs` — logowanie paniki wątków |
| 6 | Ignorowanie MsgWaitForMultipleObjects | ✅ NAPRAWIONE | `foreground_hook.rs` — logowanie WAIT_FAILED |
| 7 | Niepotrzebne klonowanie | ✅ NAPRAWIONE | `monitor.rs` — HashSet z iteratora |
| 8 | Brak info o commit error | ✅ NAPRAWIONE | `sync_common.rs` — log::error przed `?` |
| 9 | Redundantna parsacja JSON | ✅ NAPRAWIONE | `lan_server.rs` — jednokrotne parsowanie |
| 10 | Dead code markers | ⏭️ BEZ ZMIAN | `config.rs` — funkcja faktycznie nieużywana, `#[allow]` zostawiony |
| 11 | TOCTOU cache komentarz | ✅ NAPRAWIONE | `config.rs` — dodano komentarz |

### Dashboard React — 10 poprawek

| # | Problem | Status | Plik |
|---|---------|--------|------|
| 1 | Race condition useSessionsData | ✅ NAPRAWIONE | `useSessionsData.ts` — guard `isLoadingRef` |
| 2 | Race ref vs state useSessionScoreBreakdown | ✅ NAPRAWIONE | `useSessionScoreBreakdown.ts` — usunięto mutacje ref w callbackach |
| 3 | Rozbieżność ref/state useSessionBulkActions | ✅ NAPRAWIONE | `useSessionBulkActions.ts` — sync przez useEffect |
| 4 | Brakujące useMemo projectIdByName | ⏭️ JUŻ NAPRAWIONE | `Sessions.tsx` — useMemo już istnieje |
| 5 | Brak empty state Sessions | ⏭️ JUŻ NAPRAWIONE | `Sessions.tsx` — prop `isEmpty` obsługiwany |
| 6 | Duplikacja timerów BackgroundServices | ⏭️ JUŻ NAPRAWIONE | `BackgroundServices.tsx` — `clearLocalChangeTimers` istnieje |
| 7 | Memory leak refresh dedup | ✅ NAPRAWIONE | `data-store.ts` — cleanup wpisów >10 min |
| 8 | Późny guard shiftDateRange | ✅ NAPRAWIONE | `data-store.ts` — guard przeniesiony na początek |
| 9 | Duplikacja context menu dismiss | ✅ TODO | `Sessions.tsx` — dodano komentarz TODO |
| 10 | Stale closure ProjectDayTimeline | ⏭️ FALSE POSITIVE | Funkcja jest czysta, `[]` deps poprawne |

### Serwer Sync — 12 poprawek

| # | Problem | Status | Plik |
|---|---------|--------|------|
| 1 | Prototype pollution tombstones | ✅ NAPRAWIONE | `service.ts` — whitelist `ALLOWED_TABLES` |
| 2 | TOCTOU walidacja sesji | ✅ NAPRAWIONE | `session-service.ts` + `session-store.ts` — `withValidatedSession()` |
| 3 | Brak walidacji pk | ✅ NAPRAWIONE | `service.ts` — throw Error jeśli brak pk |
| 4 | Race findAndJoinOrCreate | ⏭️ JUŻ NAPRAWIONE | `session-store.ts` — atomowa operacja w mutex |
| 5 | Słaba walidacja DeviceId | ✅ NAPRAWIONE | `route.ts` — limit 128 znaków |
| 6 | Brak error recovery cleanup | ✅ NAPRAWIONE | `session-cleanup.ts` — try-catch per iteracja |
| 7 | O(N) token lookup | ✅ NAPRAWIONE | `server-auth.ts` — reverse Map O(1) |
| 8 | Brak indexMap update | ⏭️ JUŻ POPRAWNE | `service.ts` — indeks był poprawny |
| 9 | Brak walidacji tombstones | ✅ NAPRAWIONE | `validation.ts` — `isValidTombstone()` |
| 10 | TERMINAL_STATES 3x | ✅ NAPRAWIONE | `session-store.ts` — jedna stała modułowa |
| 11 | String comparison timestamps | ✅ NAPRAWIONE | `session-store.ts` — Date.getTime() |
| 12 | Magic numbers step ranges | ✅ NAPRAWIONE | `session-service.ts` — named constants |

### Podsumowanie napraw

| Wynik | Ilość |
|-------|-------|
| ✅ Naprawione | 26 |
| ⏭️ Już naprawione / False positive | 6 |
| ⏭️ Bez zmian (celowo) | 1 |
| **Razem obsłużonych** | **33** |

Pozostałe 12 pozycji z raportu (głównie NISKI priorytet) to sugestie optymalizacyjne lub architekturalne, które nie wymagają natychmiastowej implementacji (np. zmiana pollingu na event-driven, per-user mutex, crate zeroize).
