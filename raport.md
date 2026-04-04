# TIMEFLOW — Raport z przeglądu kodu (Code Review)

**Data:** 2026-04-04
**Zakres:** Dashboard (React/TypeScript) + Daemon (Rust) + Help/i18n
**Rewizja:** 293db18 (branch: stage_1.6)

---

## Spis treści

1. [Podsumowanie](#1-podsumowanie)
2. [Dashboard — logika i poprawność](#2-dashboard--logika-i-poprawność)
3. [Dashboard — wydajność](#3-dashboard--wydajność)
4. [Dashboard — kod nadmiarowy / martwy](#4-dashboard--kod-nadmiarowy--martwy)
5. [Dashboard — optymalizacje](#5-dashboard--optymalizacje)
6. [Daemon Rust — logika i poprawność](#6-daemon-rust--logika-i-poprawność)
7. [Daemon Rust — wydajność](#7-daemon-rust--wydajność)
8. [Daemon Rust — kod nadmiarowy / martwy](#8-daemon-rust--kod-nadmiarowy--martwy)
9. [Daemon Rust — optymalizacje](#9-daemon-rust--optymalizacje)
10. [Daemon Rust — bezpieczeństwo](#10-daemon-rust--bezpieczeństwo)
11. [Help.tsx — brakujące sekcje](#11-helptsx--brakujące-sekcje)
12. [Tłumaczenia — brakujące i18n](#12-tłumaczenia--brakujące-i18n)
13. [Co zrobiono dobrze](#13-co-zrobiono-dobrze)
14. [Tabela priorytetów](#14-tabela-priorytetów)

---

## 1. Podsumowanie

Przeanalizowano ~18 700 linii kodu (dashboard + daemon). Architektura jest solidna, z dobrą separacją odpowiedzialności. Znaleziono **7 problemów krytycznych**, **22 ważne** i **17 drobnych**. Najpoważniejsze dotyczą: race condition przy retry sync, korupcji bazy przy restore, niezresetowanej flagi `sync_in_progress`, błędnego delta since, błędów renderowania w `ReportView.tsx`, oraz braku i18n w `DevSettingsCard.tsx`.

---

## 2. Dashboard — logika i poprawność

### [Critical] D-L1: `ReportView.tsx` — `generatedAt` obliczany przy każdym renderze

**Plik:** `dashboard/src/pages/ReportView.tsx:54`

```ts
const generatedAt = format(new Date(), 'yyyy-MM-dd HH:mm');
```

Data generowania raportu zmienia się co każdą zmianę stanu (np. toggle `showAll`). Powinna być zapamiętana raz.

**Fix:** `useState(() => format(new Date(), 'yyyy-MM-dd HH:mm'))` lub `useMemo(() => ..., [report])`.

---

### [Critical] D-L2: `ReportView.tsx` — brak `t` w zależnościach `useCallback`

**Plik:** `dashboard/src/pages/ReportView.tsx:34-51`

```ts
const handlePrint = useCallback(() => {
    document.title = `${t('report_view.pdf_prefix', 'timeflow_report')}_${safeName}`;
}, [report]);  // brakuje `t`
```

Po zmianie języka callback użyje starej wersji `t`.

---

### [Important] D-L2b: `ProjectDayTimeline.tsx` — brak `t` w deps `handleEditComment`

**Plik:** `dashboard/src/components/dashboard/ProjectDayTimeline.tsx:310-333`

`handleEditComment` używa `t()` w liniach 318-321, ale `t` nie jest w dependency array (linia 333). Po zmianie języka callback użyje starego tłumaczenia. Identyczny bug jak D-L2 w ReportView.

```tsx
const handleEditComment = useCallback(async () => {
  setPromptConfig({
    title: t('project_day_timeline.text.session_comment'),        // ← używa t
    description: t('project_day_timeline.text.comment_applies_to_first'), // ← używa t
  });
}, [ctxMenu, onUpdateSessionComment]);  // ← brakuje: t
```

---

### [Important] D-L2c: `useProjectsData.ts` — race condition (brak cancelled flagi)

**Plik:** `dashboard/src/hooks/useProjectsData.ts:235-257`

Async `getProjectExtraInfo` nie sprawdza `cancelled` flagi — `setExtraInfo` i `setLoadingExtra` mogą być wywołane po zmianie `projectDialogId` lub unmount. Inne efekty w tym samym pliku (linie 210-232) poprawnie używają `let cancelled = false`.

```tsx
useEffect(() => {
  projectsApi.getProjectExtraInfo(projectDialogId, ALL_TIME_DATE_RANGE)
    .then((info) => { setExtraInfo(info); })  // ← brak if (!cancelled)
    .finally(() => setLoadingExtra(false));
  // ← brak return () => { cancelled = true; }
}, [projectDialogId, projectExtraInfoCacheVersion]);
```

---

### [Important] D-L3: `Estimates.tsx` — ręczna subskrypcja eventów zamiast `usePageRefreshListener`

**Plik:** `dashboard/src/pages/Estimates.tsx:89-124`

Jedyna strona, która ręcznie subskrybuje `LOCAL_DATA_CHANGED_EVENT` i `APP_REFRESH_EVENT` zamiast użyć wspólnego hooka `usePageRefreshListener`. Niespójność zwiększająca ryzyko błędów przy zmianach systemu odświeżania.

---

### [Important] D-L4: `Sessions.tsx` — `void promise.catch()` anty-wzorzec

**Plik:** `dashboard/src/pages/Sessions.tsx:254`

```ts
void loadProjectsAllTime().catch(console.error);
```

`void` ignoruje promise, ale `.catch()` zwraca nowy promise, który również jest ignorowany. Porównanie z `Dashboard.tsx:332` — podejścia niespójne.

---

### [Important] D-L5: `Applications.tsx` — async handler w `onKeyDown` bez `void`

**Plik:** `dashboard/src/pages/Applications.tsx:392, 402`

```ts
onKeyDown={(e) => e.key === 'Enter' && handleAddApp()}
```

`handleAddApp` jest async — wyrażenie `condition && asyncFn()` cicho zwraca nieobsłużony promise.

---

## 3. Dashboard — wydajność

### [Important] D-P1: `Estimates.tsx` — `Intl.NumberFormat` nie reaguje na zmianę języka

**Plik:** `dashboard/src/pages/Estimates.tsx:80-86`

```ts
const decimal = useMemo(() => new Intl.NumberFormat(undefined, {...}), []);
```

`undefined` = domyślny język przeglądarki. Po zmianie `i18n.language` formatowanie się nie zmieni. Brakuje `i18n.resolvedLanguage` jako zależności.

---

### [Important] D-P2: `Dashboard.tsx` — `t` w tablicy zależności useEffect

**Plik:** `dashboard/src/pages/Dashboard.tsx:436`

Funkcja `t` zmienia referencję przy zmianie języka, powodując ponowne pobranie danych. Prawdopodobnie zamierzone, ale brak komentarza wyjaśniającego.

---

### [Minor] D-P3: `Sessions.tsx` — bardzo duży komponent (~843 linie)

Mimo wydzielenia logiki do hooków, komponent zawiera >20 wywołań `useState` i logikę context menu placement. Komentarz TODO w linii 322 potwierdza świadomość problemu.

---

### [Minor] D-P4: `ProjectPage.tsx` — `fetchAllSessions` bez limitu

**Plik:** `dashboard/src/pages/ProjectPage.tsx:341`

Ładowanie `ALL_TIME_DATE_RANGE` bez paginacji — dla projektów z wieloma sesjami może powodować duże zużycie pamięci.

---

## 4. Dashboard — kod nadmiarowy / martwy

### [Important] D-R1: `ProjectPage.tsx` — zbędny import `* as React`

**Plik:** `dashboard/src/pages/ProjectPage.tsx:1`

```ts
import * as React from 'react';
```

Hooki importowane z destrukturyzacją poniżej — namespace import niepotrzebny.

---

### [Important] D-R2: Zduplikowana konwersja `ManualSession → SessionWithApp`

Logika mapowania sesji manualnych zduplikowana w:
- `Sessions.tsx:178-194` (`mergedSessions` useMemo)
- `ProjectPage.tsx:189-202` (`toManualSessionRow`)

Obie robią to samo: `app_name: 'Manual Session'`, `executable_name: 'manual'`, `files: []`. Powinna powstać wspólna funkcja.

---

### [Minor] D-R3: `Projects.tsx` — `toggleFolders` nie zapisuje do `localStorage`

**Plik:** `dashboard/src/pages/Projects.tsx:575-578`

Przełączenie `useFolders` nie zapisuje wartości do `localStorage` (dopiero `handleSaveDefaults`). Niespójne z `handleSortChange`, który zapisuje natychmiast.

---

### [Minor] D-R4: `ImportPage.tsx` — `loadImportData` bez `useCallback`

**Plik:** `dashboard/src/pages/ImportPage.tsx:19`

Funkcja tworzona na nowo przy każdym renderze. Dla spójności z resztą codebase powinna być opakowana w `useCallback`.

---

## 5. Dashboard — optymalizacje

### [Important] D-O1: Niespójny wzorzec obsługi błędów async w event handlerach

Trzy różne wzorce w codebase:
1. `void handleSyncMonitored();` — poprawny
2. `condition && asyncFn()` — promise leak
3. `.catch(() => {})` — ciche ignorowanie błędów

**Rekomendacja:** Ustandaryzować na `void fn()` i/lub centralny error handler.

---

### [Important] D-O2: `Settings.tsx` — 50+ propsów przekazywanych do `OnlineSyncCard`

**Plik:** `dashboard/src/pages/Settings.tsx:541-657`

Większość to przetłumaczone labele. Rozwiązania:
- Przenieść `useTranslation()` do komponentów-dzieci
- Stworzyć obiekt `labels` i przekazać jako jeden prop

---

### [Minor] D-O3: `AI.tsx` — ręczna komparacja `areMetricsEqual` (30+ pól)

**Plik:** `dashboard/src/pages/AI.tsx:111-157`

Każde dodanie nowego pola wymaga edycji tej funkcji. `JSON.stringify` lub biblioteka porównania byłyby bardziej odporne.

---

## 6. Daemon Rust — logika i poprawność

### [Critical] R-L0a: Race condition — `sync_in_progress` resetowane między retry'ami

**Plik:** `src/lan_sync_orchestrator.rs:230-252`

W pętli retry po nieudanym `execute_master_sync` wywoływane jest `sync_state.unfreeze()` (linia 230), które ustawia `sync_in_progress = false`. Następna próba w tej samej pętli startuje bez ponownego ustawienia `sync_in_progress = true`. Podczas backoff'u (linia 243-249, 5-45s) inny wątek (np. `handle_trigger_sync`) może przejść przez `compare_exchange(false, true)` i wystartować **drugi równoległy sync**, prowadząc do korupcji danych.

**Rekomendacja:** Nie resetować `sync_in_progress` w pętli retry. Utrzymywać `sync_in_progress = true` do końca pętli, resetować dopiero w cleanup (linia 262).

---

### [Critical] R-L0b: Delta sync — użycie daty LOKALNEGO markera zamiast SLAVE'a

**Plik:** `src/lan_sync_orchestrator.rs:344-347`

Wartość `since` przy pobieraniu danych od SLAVE jest obliczana z **lokalnego** markera master'a (`get_local_marker_created_at_with_conn`), a nie z markera slave'a. Jeśli slave miał ostatni sync 2 dni temu a master 1 dzień temu — slave wyśle tylko dane z ostatniego dnia zamiast z dwóch. Delta zostaje niekompletna.

```rust
let since = match transfer_mode.as_str() {
    "delta" => neg.slave_marker_hash.as_deref()
        .and_then(|_| get_local_marker_created_at_with_conn(&conn))  // ← lokalna data!
        .unwrap_or_else(|| "1970-01-01 00:00:00".to_string()),
    _ => "1970-01-01 00:00:00".to_string(),
};
```

**Rekomendacja:** Pobrać `created_at` markera odpowiadającego `slave_marker_hash` z odpowiedzi negocjacji, lub żądać daty od slave'a w trakcie negotiation.

---

### [Important] R-L1: `sync_common.rs` — `restore_database_backup` kopiuje plik przez aktywne połączenie SQLite

**Plik:** `src/sync_common.rs:91-124`

Funkcja otrzymuje `&rusqlite::Connection`, wykonuje `cache_flush()`, a następnie kopiuje backup nadpisując aktywną bazę. Na Windows plik WAL i dziennik mogą być zablokowane. Po skopiowaniu istniejące połączenie pracuje na niespójnym stanie.

**Rekomendacja:** Zamknąć połączenie przed operacją copy (brać ownership zamiast `&Connection`) lub zwrócić sygnał wymuszający re-open.

---

### [Important] R-L2: `online_sync.rs` — `sync_in_progress` nie resetowane po async delta sync

**Plik:** `src/online_sync.rs:703-741`

Po udanym push+pull, `sync_state.reset_progress()` jest wywoływane, ale NIE resetuje `sync_in_progress`. Flaga jest resetowana tylko przez `unfreeze()`. Jeśli async sync zakończy się sukcesem bez wejścia w error path, `sync_in_progress` zostaje na `true` na zawsze, blokując przyszłe synchronizacje.

**Rekomendacja:** Dodać jawne `sync_state.sync_in_progress.store(false, Ordering::SeqCst)` po zakończeniu `run_async_delta_sync`.

---

### [Important] R-L3: `config.rs` — wyścig TOCTOU w konfiguracji cache

**Plik:** `src/config.rs:316-353`

Mutex zwalniany między sprawdzeniem mtime a ponownym zapisem do cache. Przy jednoczesnym zapisie z dashboardu i odczycie z demona, można odczytać niekompletny plik.

**Rekomendacja:** Dodać sprawdzenie `serde_json::from_str` error z fallbackiem na poprzednią wartość cache zamiast `unwrap_or_default()`.

---

### [Minor] R-L4: `lan_server.rs` — `handle_verify_ack` resetuje `sync_in_progress` bez odmrożenia bazy

**Plik:** `src/lan_server.rs:774`

`sync_in_progress.store(false, ...)` bez resetowania `db_frozen`. Jeśli endpoint wywołany zamiast `/lan/unfreeze`, baza pozostanie zamrożona.

---

### [Minor] R-L5: `online_sync.rs` — `sync_in_progress` na `true` po błędzie przed krokiem freeze

Jeśli sync zakończy się błędem przed krokiem 5 (freeze), `sync_in_progress` zostaje na `true` (resetowane tylko przez `unfreeze()`).

---

## 7. Daemon Rust — wydajność

### [Important] R-P1: `lan_discovery.rs` — podwójne wywołanie `ipconfig` przy każdym beaconie

`broadcast_to_all` (co 30s) wywołuje `get_subnet_broadcast_addresses()` i `get_local_interfaces()` — obie parsują output `ipconfig`. Spawn procesu co 30s to zbędny overhead.

**Rekomendacja:** Cache wynik `ipconfig` z TTL 60-120s.

---

### [Important] R-P2: `lan_discovery.rs` — `http_scan_subnet` tworzy do 253 wątków

**Plik:** `src/lan_discovery.rs:1175-1183`

Na podsieci /24 tworzy 253 wątków jednocześnie. Min. ~8KB stack × 253 = ~2MB spike.

**Rekomendacja:** Batching po 32-64 wątki lub prosty thread pool.

---

### [Important] R-P2b: `storage.rs` — zbędna alokacja Vec<char> w truncate_middle

**Plik:** `src/storage.rs:49-57`

Każde wywołanie alokuje `Vec<char>` nawet gdy string nie przekracza limitu (dominujący scenariusz). Funkcja wywoływana co ~10s w tracking loop dla każdego aktywnego pliku.

```rust
let chars: Vec<char> = value.chars().collect();  // ← alokacja nawet dla "Notepad.exe"
if chars.len() <= max_chars {
    return value.to_string();  // ← zwraca bez truncacji
}
```

**Rekomendacja:** Sprawdzić `value.chars().count() <= max_chars` bez alokacji; alokować `Vec<char>` tylko jeśli truncacja potrzebna.

---

### [Important] R-P2c: `lan_discovery.rs` — `is_dashboard_running()` błędna semantyka

**Plik:** `src/lan_discovery.rs:153-170`

Funkcja czyta `heartbeat.txt`, który jest pisany przez **tracker.rs** (demon), nie przez dashboard. W efekcie LAN beacon zawiera `dashboard_running: true` zawsze gdy demon jest aktywny — nawet gdy dashboard jest zamknięty.

**Rekomendacja:** Dashboard powinien pisać własny heartbeat (np. `dashboard_heartbeat.txt`), lub demon powinien wykrywać proces dashboardu inną metodą.

---

### [Minor] R-P3: `lan_common.rs` — `sync_log` ładuje `LogSettings` z dysku przy każdym wywołaniu

**Plik:** `src/lan_common.rs:69`

Przy intensywnym logowaniu sync (kilkadziesiąt wywołań w jednym cyklu) — niepotrzebny odczyt JSON z dysku.

---

## 8. Daemon Rust — kod nadmiarowy / martwy

### [Minor] R-R1: `online_sync.rs` — dead code `STEP_TIMEOUT` i `check_step_timeout`

**Plik:** `src/online_sync.rs:17, 267-272`

```rust
#[allow(dead_code)]
const STEP_TIMEOUT: Duration = Duration::from_secs(600);
```

Zadeklarowane ale nigdzie nie używane. `#[allow(dead_code)]` maskuje ostrzeżenie.

---

### [Minor] R-R2: `online_sync.rs` — liczne `#[allow(dead_code)]` na polach struktur deserializacji

Struktury `SessionCreateResponse`, `HeartbeatResponse`, `AsyncPushResponse` itp. mają pola deserializowane ale nigdy odczytywane.

---

### [Minor] R-R3: `sync_common.rs` — wrappery `open_dashboard_db` i `get_device_id`

**Plik:** `src/sync_common.rs:9-19`

Cienkie wrappery nad `lan_common` bez dodanej logiki — zbędna warstwa indirekcji.

---

## 9. Daemon Rust — optymalizacje

### [Important] R-O1: `sync_common.rs` — merge na dynamic JSON zamiast typów

**Plik:** `src/sync_common.rs:181-538`

Logika merge parsuje dane do `serde_json::Value` i ręcznie wyciąga pola przez `.get("key")`. Literówka w nazwie pola = cichy null. Wolniejsze niż deserializacja do typowanych struktur.

**Rekomendacja:** Zdefiniować dedykowane struktury dla formatu sync archive i deserializować raz — błędy złapane w compile-time.

---

### [Minor] R-O2: `sync_common.rs` — `normalize_ts` ręczne parsowanie zamiast chrono

**Plik:** `src/sync_common.rs:151-160`

Ręczna logika parsowania. Chrono ma natywne parsowanie ISO timestamps, co byłoby bardziej robustne.

---

### [Minor] R-O3: `lan_discovery.rs` — `iter_hosts` alokuje cały wektor

Dla /24 podsieci tworzy Vec z 253 elementami. Mógłby zwracać iterator.

---

## 10. Daemon Rust — bezpieczeństwo

### [Important] R-S0a: Brak limitu Content-Length w odpowiedzi HTTP — ryzyko OOM

**Plik:** `src/lan_sync_orchestrator.rs:146`

`response_content_length` pochodzi z nagłówka odpowiedzi peer'a bez weryfikacji. Złośliwy lub buggy peer może wysłać `Content-Length: 1073741824` (1 GB), powodując natychmiastową alokację 1 GB:

```rust
let mut buf = vec![0u8; response_content_length];  // ← bez limitu!
```

**Rekomendacja:** Dodać górny limit: `const MAX_RESPONSE_BODY: usize = 100 * 1024 * 1024;` i zwracać błąd przy przekroczeniu.

---

### [Minor] R-S0b: `Host: localhost` — stały nagłówek niezależnie od adresu docelowego

**Plik:** `src/lan_sync_orchestrator.rs:104`

Nagłówek HTTP `Host: localhost` jest wysyłany we wszystkich żądaniach, nawet do `192.168.1.50:47891`. Przy reverse-proxy na LAN żądania mogą być kierowane do innego hosta.

**Rekomendacja:** Parsować host z URL i użyć go w nagłówku `Host`.

---

### [Important] R-S1: `config.rs` — tokeny w plaintext JSON

**Plik:** `src/config.rs:163`

`auth_token` i `encryption_key` przechowywane w `%APPDATA%/TimeFlow/online_sync_settings.json` jako plaintext. Standardowy pattern dla desktopowych aplikacji, ale warto udokumentować w Help.

---

### [Important] R-S2: `sftp_client.rs` — zerowanie pamięci hasła niegwarantowane

**Plik:** `src/sftp_client.rs:21-33`

Użycie `unsafe` + `write_volatile` nie jest gwarantowane kryptograficznie. `zeroize` crate byłby lepszym rozwiązaniem.

---

### [Minor] R-S3: `lan_common.rs` — FNV-1a hash nie jest kryptograficzny

**Plik:** `src/lan_common.rs:9-16`

`generate_marker_hash` używa FNV-1a (64-bit). Kolizje łatwe do wygenerowania. Dla LAN sync w trusted environment akceptowalne, ale online sync powinien używać SHA-256.

---

### [Minor] R-S4: `lan_server.rs` — brak walidacji `device_id` w payloadach HTTP

Endpointy HTTP deserializują `device_id` bez walidacji. Trust model zakłada bezpieczną sieć LAN — akceptowalne, ale warto mieć świadomość.

---

### [Minor] R-S5: `sync_common.rs` — `VACUUM INTO` z dynamicznym stringiem

**Plik:** `src/sync_common.rs:65`

```rust
conn.execute_batch(&format!("VACUUM INTO '{}'", escaped))
```

Ścieżka jest konstruowana z timestampa (bezpieczna w praktyce), ale `VACUUM INTO` nie wspiera parametrów. Obecny escaping wystarczający — warto dodać komentarz.

---

## 11. Help.tsx — brakujące sekcje

### [Important] H-0: Brak sekcji Help — ProjectPage (szczegóły projektu)

**Plik:** `dashboard/src/pages/ProjectPage.tsx`

Strona ProjectPage (dostępna po kliknięciu projektu) oferuje: przegląd projektu (Overview), timeline z wizualizacją aktywności, edycję komentarzy sesji, modyfikację mnożników czasu (rate multiplier), generowanie raportów, dodawanie sesji manualnych. Żadna z tych funkcji nie jest opisana w Help.tsx.

**Rekomendacja:** Dodać sekcję z opisem funkcjonalności ProjectPage.

---

### [Critical] H-1: Brak sekcji "Dev Settings / Log Management"

**Plik:** `dashboard/src/components/settings/DevSettingsCard.tsx`

Funkcjonalność: zarządzanie logami (Daemon, LAN Sync, Online Sync, Dashboard), konfiguracja poziomów logów, podgląd i rotacja plików, zmiana max rozmiaru log file. Widoczna w UI na zakładce "Dev" w Settings, ale nieudokumentowana w Help.tsx.

---

### [Important] H-2: Klucz `training_blacklists` zdefiniowany w i18n, ale nieużywany w Help.tsx

Klucz `help_page.training_blacklists_exclude_selected_applications_and_fo` istnieje w `en/common.json` i `pl/common.json` (linia 1605), ale nie pojawia się w Help.tsx sekcji AI.

---

## 12. Tłumaczenia — brakujące i18n

### [Critical] T-1: `DevSettingsCard.tsx` — cały komponent bez jakichkolwiek tłumaczeń

**Plik:** `dashboard/src/components/settings/DevSettingsCard.tsx`

Hardcoded stringi angielskie (nie owijane w `t()`):
- `"DEV — Log Management"` (linia 112)
- `"Centralized log viewer and configuration..."` (linia 115-116)
- `"Log Levels"` (linia 122)
- `"Max log file size"` (linia 152)
- `"Per file, auto-rotated when exceeded"` (linia 153)
- `"Log Files"` (linia 174)
- `"Open Folder"` (linia 183)
- `"empty"` (linia 207)
- `"Clear log"` (linia 220)
- `"Auto-scroll"` (linia 245)
- `"Refresh"` (linia 260)
- `"(empty)"` (linia 268)

**To jedyny komponent bez wsparcia i18n.**

---

### [Critical] T-2: `tray.rs` — hardcoded stringi sync statusu

- Linia 552: `"Sync: idle"` — nie tłumaczony przez `i18n::Lang::t()`
- Linie 266-269: `format!("Sync: {} (frozen={})", role, frozen)` — prefiks "Sync:" nie lokalizowany
- Linia 188: `format!("{} - LAN Sync...", APP_NAME)` — nie tłumaczony

**Rekomendacja:** Dodać warianty `SyncIdle`, `SyncInProgress` do enum `TrayText` w `i18n.rs`.

---

### [Minor] T-2b: `BackgroundServices.tsx` — hardcoded polskie defaultValue

**Plik:** `dashboard/src/components/sync/BackgroundServices.tsx:751-758`

Trzy `defaultValue` zawierają polski tekst zamiast angielskiego fallbacku:
- Linia 751: `{ defaultValue: 'Dane zsynchronizowane z serwera' }` ← PL
- Linia 753: `{ defaultValue: 'Dane wysłane na serwer' }` ← PL
- Linia 758: `{ defaultValue: 'LAN sync z ${peerName} zakończony' }` ← PL

**Rekomendacja:** Zmienić defaultValue na angielski (EN fallback).

---

### [Minor] T-3: Fallbacki w `t()` w jednym języku

Kilka miejsc używa `t('key', 'fallback')` z fallbackiem tylko po angielsku:
- `Sessions.tsx:185, 520, 544`
- `Settings.tsx:255-258`

Klucze mogą być nowe i nie mieć wpisów w `common.json`. Warto zweryfikować.

---

### [Minor] T-4: Duplikat klucza `language_hint` w plikach locale

Klucz `language_hint` pojawia się dwukrotnie w EN i PL `common.json` (linia 1263 i 1266). Potencjalny konflikt.

---

## 13. Co zrobiono dobrze

### Dashboard:
- **Wydzielenie logiki do hooków** — `useSessionActions`, `useSessionsData`, `useSettingsFormState`, `useTimeAnalysisData`, `useProjectsData` etc. znacznie redukują złożoność stron
- **Spójne użycie `usePageRefreshListener`** — z wyjątkiem Estimates.tsx
- **Poprawny cancel pattern** — `let cancelled = false` z cleanup w useEffect
- **Lazy loading** — `React.lazy` z named exports i `Suspense` fallback
- **Error boundary** — globalny `ErrorBoundary` z tłumaczeniami i przyciskiem reload
- **Dostępność** — `aria-label`, `aria-live`, `role="alert"`, `role="status"` konsekwentnie stosowane

### Daemon:
- **Panic handling** — `catch_unwind` z logowaniem na wszystkich wątkach, panic hook do pliku
- **Auto-unfreeze safety net** — 5-minutowy timeout zapobiega permanentnemu zamrożeniu bazy
- **Mutex poison recovery** — konsekwentne `into_inner()` w `LanSyncState`
- **HeartbeatGuard z RAII drop** — czyste rozwiązanie lifecycle w online_sync
- **PID cache z walidacją creation_time** — zabezpiecza przed PID reuse na Windows
- **Szyfrowanie** — poprawne AES-256-GCM z random IV, HMAC-based KDF, gzip kompresja
- **Testy** — pokrycie kluczowych ścieżek w `tracker.rs`, `storage.rs`, `monitor.rs`

### i18n:
- **Pliki EN/PL mają identyczną strukturę kluczy** (1909 linii każdy) — brak brakujących kluczy między językami

---

## 14. Tabela priorytetów

| # | Waga | Plik | Problem |
|---|------|------|---------|
| R-L0a | **Critical** | lan_sync_orchestrator.rs | Race condition — sync_in_progress resetowane między retry'ami |
| R-L0b | **Critical** | lan_sync_orchestrator.rs | Delta sync — użycie daty LOKALNEGO markera zamiast SLAVE'a |
| D-L1 | **Critical** | ReportView.tsx | `generatedAt` obliczany przy każdym renderze |
| D-L2 | **Critical** | ReportView.tsx | `handlePrint` — brak `t` w deps useCallback |
| T-1 | **Critical** | DevSettingsCard.tsx | Cały komponent bez i18n |
| T-2 | **Critical** | tray.rs + i18n.rs | Hardcoded stringi sync statusu |
| H-1 | **Critical** | Help.tsx | Brak sekcji Dev Settings / Log Management |
| D-L2b | Important | ProjectDayTimeline.tsx | `handleEditComment` — brak `t` w deps useCallback |
| D-L2c | Important | useProjectsData.ts | Race condition — brak cancelled flagi |
| D-L3 | Important | Estimates.tsx | Ręczna subskrypcja eventów zamiast hooka |
| D-L4 | Important | Sessions.tsx | `void promise.catch()` anty-wzorzec |
| D-L5 | Important | Applications.tsx | Async handler bez void |
| D-P1 | Important | Estimates.tsx | NumberFormat nie reaguje na zmianę języka |
| D-R1 | Important | ProjectPage.tsx | Zbędny import `* as React` |
| D-R2 | Important | Sessions.tsx, ProjectPage.tsx | Zduplikowana konwersja ManualSession |
| D-O1 | Important | Wiele plików | Niespójny async error handling |
| D-O2 | Important | Settings.tsx | 50+ propsów do OnlineSyncCard |
| R-L1 | Important | sync_common.rs | restore_database_backup na aktywnym połączeniu |
| R-L2 | Important | online_sync.rs | sync_in_progress nie resetowane po async sync |
| R-L3 | Important | config.rs | TOCTOU w config cache |
| R-P1 | Important | lan_discovery.rs | ipconfig co 30s |
| R-P2 | Important | lan_discovery.rs | 253 wątków w http_scan_subnet |
| R-P2b | Important | storage.rs | Zbędna alokacja Vec<char> w truncate_middle |
| R-P2c | Important | lan_discovery.rs | is_dashboard_running() — błędna semantyka |
| R-O1 | Important | sync_common.rs | Merge na dynamic JSON zamiast typów |
| R-S0a | Important | lan_sync_orchestrator.rs | Brak limitu Content-Length — ryzyko OOM |
| R-S1 | Important | config.rs | Tokeny w plaintext (do udokumentowania) |
| R-S2 | Important | sftp_client.rs | Zerowanie pamięci niegwarantowane |
| H-0 | Important | Help.tsx | Brak sekcji Help — ProjectPage |
| H-2 | Important | Help.tsx | Klucz training_blacklists nieużywany |
| D-P2 | Important | Dashboard.tsx | `t` w deps useEffect — brak komentarza |
| D-P3 | Minor | Sessions.tsx | Duży komponent (843 linie) |
| D-P4 | Minor | ProjectPage.tsx | fetchAllSessions bez limitu |
| D-R3 | Minor | Projects.tsx | toggleFolders nie zapisuje do localStorage |
| D-R4 | Minor | ImportPage.tsx | loadImportData bez useCallback |
| D-O3 | Minor | AI.tsx | Ręczna komparacja 30+ pól |
| R-L4 | Minor | lan_server.rs | verify_ack nie odmraża bazy |
| R-L5 | Minor | online_sync.rs | sync_in_progress po pre-freeze error |
| R-P3 | Minor | lan_common.rs | sync_log czyta settings z dysku |
| R-R1 | Minor | online_sync.rs | Dead code: STEP_TIMEOUT |
| R-R2 | Minor | online_sync.rs | #[allow(dead_code)] na polach struktur |
| R-R3 | Minor | sync_common.rs | Zbędne wrappery |
| R-O2 | Minor | sync_common.rs | normalize_ts ręczne parsowanie |
| R-O3 | Minor | lan_discovery.rs | iter_hosts alokuje wektor |
| R-S0b | Minor | lan_sync_orchestrator.rs | Host: localhost zamiast rzeczywistego hosta |
| R-S3 | Minor | lan_common.rs | FNV-1a nie kryptograficzny |
| R-S4 | Minor | lan_server.rs | Brak walidacji device_id |
| R-S5 | Minor | sync_common.rs | VACUUM INTO z dynamicznym stringiem |
| T-2b | Minor | BackgroundServices.tsx | Hardcoded polskie defaultValue w i18n |
| T-3 | Minor | Sessions.tsx, Settings.tsx | Fallbacki tłumaczeń do weryfikacji |
| T-4 | Minor | locales/*.json | Duplikat klucza language_hint |

---

**Łącznie:** 7 Critical, 24 Important, 19 Minor

**Priorytet napraw:**

### Natychmiast (ryzyko utraty danych / korupcji):
1. **R-L0a** — Race condition w retry sync (drugi sync podczas backoff)
2. **R-L0b** — Delta sync z błędną datą `since` (niekompletne synchronizacje)
3. **R-L1** — restore_database_backup na otwartym połączeniu SQLite
4. **R-L2** — sync_in_progress nie resetowane po async sync

### Wkrótce (błędy logiki / UX / bezpieczeństwo):
5. **T-1** — DevSettingsCard.tsx — dodać i18n
6. **H-1** — Help.tsx — dodać sekcję Dev Settings / Log Management
7. **D-L1/D-L2** — ReportView.tsx — naprawić `generatedAt` i deps `useCallback`
8. **T-2** — tray.rs / i18n.rs — dodać tłumaczenia statusów sync
9. **R-S0a** — Brak limitu Content-Length (DoS)
10. **D-L2c** — Race condition w useProjectsData

### Planowo (jakość / wydajność):
11. Reszta Important i Minor — w kolejności od tabeli powyżej
