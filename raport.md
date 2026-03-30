# TIMEFLOW — Raport analizy kodu (2026-03-30)

Analiza obejmuje daemon Rust, komendy Tauri i dashboard React/TypeScript ze szczegolnym uwzglednieniem systemu synchronizacji LAN.

---

## Spis tresci

1. [Problemy krytyczne (bezpieczenstwo i utrata danych)](#1-problemy-krytyczne)
2. [Problemy logiki synchronizacji](#2-problemy-logiki-synchronizacji)
3. [Duplikacja kodu (DRY)](#3-duplikacja-kodu)
4. [Wydajnosc i optymalizacje](#4-wydajnosc-i-optymalizacje)
5. [Jakosc kodu (Rust)](#5-jakosc-kodu-rust)
6. [Jakosc kodu (React/TypeScript)](#6-jakosc-kodu-react-typescript)
7. [Brakujace tlumaczenia](#7-brakujace-tlumaczenia)
8. [Braki w dokumentacji Help](#8-braki-w-dokumentacji-help)
9. [Dead code](#9-dead-code)
10. [Podsumowanie priorytetow](#10-podsumowanie-priorytetow)

---

## 1. Problemy krytyczne

### 1.1 SQL Injection w `build_delta_for_pull` [KRYTYCZNY]

**Plik:** `src/lan_server.rs:776-796`

Funkcja buduje zapytania SQL przez `format!()` z parametrem `since`, ktory pochodzi bezposrednio z HTTP request body od peera w sieci LAN:

```rust
let sessions = fetch_all_rows(conn, &format!(
    "SELECT ... FROM sessions s WHERE s.updated_at >= '{}' ORDER BY s.start_time",
    since_ref
))?;
```

Ten sam wzorzec powtarza sie dla `manual_sessions` (linia 784) i `tombstones` (linia 792).

Atakujacy w sieci LAN moze wstrzyknac dowolny SQL. Dla porownania — dashboardowa wersja w `delta_export.rs` poprawnie uzywa parametryzowanych zapytan (`?1`).

**Rozwiazanie:** Zamienic `format!()` na `rusqlite::params![]` z `?1`.

### 1.2 Merge sesji uzywa bezposrednich `app_id` z peera [KRYTYCZNY — utrata danych]

**Plik:** `src/lan_sync_orchestrator.rs:596-609`

Daemon kopiuje `app_id` z peera i uzywa go bezposrednio w zapytaniach:

```rust
let app_id = sess.get("app_id").and_then(|v| v.as_i64()).unwrap_or(0);
// ...
"SELECT id, updated_at FROM sessions WHERE app_id = ?1 AND start_time = ?2",
```

Problem: `app_id` to autoincrement — na roznych maszynach ta sama aplikacja ma rozne ID. Sesje albo wskaza na zla aplikacje, albo `INSERT` nie powiedzie sie przez FK constraint i zostana skasowane przez `verify_merge_integrity` (linia 780-785).

**To jest scenariusz utraty danych!**

Tauri wersja (`dashboard/src-tauri/src/commands/lan_sync.rs:454`) poprawnie uzywa `app_id_map` do mapowania zdalnych ID na lokalne. Daemon tego nie robi.

Ten sam problem dotyczy `project_id` (linia 636) — daemon wstawia zdalne `project_id` bez mapowania.

**Rozwiazanie:** Zaimplementowac mapowanie ID (jak w wersji Tauri) lub ujednolicic obie implementacje merge.

---

## 2. Problemy logiki synchronizacji

### 2.1 Slave nigdy nie pobiera scalonych danych [WYSOKI]

**Plik:** `src/lan_sync_orchestrator.rs:356-384`

Master buduje pelny eksport (`build_full_export`), zapisuje go do `lan_sync_merged.json` (linia 364), wysyla `db-ready` do slave'a (linia 372). Ale slave w `handle_db_ready` (`lan_server.rs:625-642`) jedynie ustawia progress na "slave_downloading" — **nie inicjuje zadnego pobierania danych**.

Master tez nie pushuje danych do slave'a — jedynie informuje go ze sa "gotowe". Slave jest pasywny (reaguje na HTTP) i nie ma kodu, ktory aktywnie pobiera scalone dane.

**Rozwiazanie:** Slave powinien po `db-ready` aktywnie pobrac dane z mastera (GET `/lan/download-db`), albo master powinien pushowac dane bezposrednio w ramach `db-ready`.

### 2.2 `DefaultHasher` nie jest deterministyczny cross-platform [WYSOKI]

**Pliki:** `src/lan_server.rs:441-443`, `src/lan_sync_orchestrator.rs:821-823`, `dashboard/src-tauri/src/commands/helpers.rs:100-102`

`std::collections::hash_map::DefaultHasher` nie gwarantuje stabilnosci miedzy wersjami Rust ani platformami. Uzycie go do porownywania hashow miedzy maszynami moze powodowac false-positive roznice (niepotrzebne synce), nawet gdy dane sa identyczne.

**Rozwiazanie:** Uzyc deterministycznego hashu (np. SHA-256 z crate `sha2`, albo chociaz `xxhash` / `fnv`).

### 2.3 Race condition w elekcji master/slave [SREDNI]

**Plik:** `src/lan_discovery.rs:310-329`

Dwa wezly startujace jednoczesnie (np. po awarii zasilania) oba maja `uptime_secs=0` i `peers.is_empty()=true`, wiec oba staja sie MASTER. Obsluga konfliktu (linia 671-685) wymaga odebrania beaconu od drugiego mastera (broadcast co 30s) — w tym oknie oba moga zainicjowac sync.

Tie-breaker po `device_id` (linia 314) dziala tylko gdy peer jest juz w tabeli `peers`.

**Rozwiazanie:** Wydluzyc okno nasluchu elekcji, albo dodac randomowy jitter przed deklaracja roli.

### 2.4 Brak atomowosci freeze/unfreeze [SREDNI]

**Plik:** `src/lan_sync_orchestrator.rs:287-289`

Jesli freeze mastera sie powiedzie, ale freeze slave'a nie (timeout sieci), master jest zamrozony ale slave kontynuuje prace. Auto-unfreeze po 5 min przywraca mastera, ale przez ten czas tracker bufferuje dane bez zapisu na dysk.

**Rozwiazanie:** Dodac rollback — jesli freeze slave'a nie powiedzie sie, natychmiast odmrozic mastera.

### 2.5 Port w UI jest fikcyjny [SREDNI]

**Pliki:** `dashboard/src/components/settings/LanSyncCard.tsx:298-314` vs `src/lan_server.rs:15`

UI pozwala na zmiane portu, ale daemon hardkoduje `DEFAULT_LAN_PORT = 47891`. Zmiana portu w UI nie ma efektu na dzialanie serwera ani discovery.

**Rozwiazanie:** Albo usunac pole portu z UI, albo zaimplementowac odczyt portu z konfiguracji w daemonie.

### 2.6 `handle_push` / `import_push_data` nie importuje danych [NISKI]

**Plik:** `src/lan_server.rs:850-864`

Funkcja parsuje JSON ale jedynie zapisuje go do `lan_sync_push_pending.json`. Nie ma kodu przetwarzajacego ten plik.

---

## 3. Duplikacja kodu

### 3.1 Funkcje zduplikowane 3 razy (daemon)

| Funkcja | Plik 1 | Plik 2 | Plik 3 |
|---------|--------|--------|--------|
| `get_device_id()` | `lan_discovery.rs:94` | `lan_server.rs:455` | `lan_sync_orchestrator.rs:401` |
| `get_machine_name()` | `lan_discovery.rs:124` | `lan_server.rs:470` | `lan_sync_orchestrator.rs:416` |
| `sync_log()` | `lan_server.rs:484` | `lan_sync_orchestrator.rs:16` | Tauri `lan_sync.rs:12` |
| `compute_table_hash()` | `lan_server.rs:416` | `lan_sync_orchestrator.rs:811` | Tauri `helpers.rs:74` |

**Rozwiazanie:** Wyodrebnic do wspolnego modulu `lan_common.rs` lub do `config.rs`.

### 3.2 Funkcje zduplikowane 2 razy

| Funkcja | Plik 1 | Plik 2 |
|---------|--------|--------|
| `open_dashboard_db()` | `lan_server.rs:400` | `lan_sync_orchestrator.rs:440` |
| `build_table_hashes()` | `lan_server.rs:446` | Tauri `helpers.rs:105` |
| `backup_database()` | `lan_sync_orchestrator.rs:449` | Tauri `sync_markers.rs:94` |
| `generate_marker_hash()` | `lan_sync_orchestrator.rs:826` | Tauri `sync_markers.rs:22` |

### 3.3 Dwie niezalezne implementacje merge [KRYTYCZNA duplikacja]

| Aspekt | Daemon (`lan_sync_orchestrator.rs:487-760`) | Tauri (`lan_sync.rs:314-661`) |
|--------|----------------------------------------------|-------------------------------|
| Typ danych | `serde_json::Value` | Typowane struktury |
| Mapowanie ID | **Brak** (uzywa zdalnych ID) | `resolve_project_id_cached()` |
| Tombstone manual_sessions | **Brak** | Obsluguje |
| Tombstone sessions po sync_key | **Brak** | Obsluguje |
| Status | Aktywna | `#[allow(dead_code)]` |

Bugi naprawione w jednej implementacji nie sa przenoszone do drugiej. Logika tombstone juz teraz jest niespojana.

### 3.4 Polling progressu sync w TypeScript — 2 identyczne kopie

Identyczna petla (`deadline = 300_000`, `setTimeout(r, 800)`, sprawdzenie `phase === 'completed'`):
- `dashboard/src/pages/Settings.tsx:198-213`
- `dashboard/src/components/layout/Sidebar.tsx:162-175`

**Rozwiazanie:** Wyodrebnic do wspolnej funkcji w `lib/tauri/lan-sync.ts`.

### 3.5 `is_dashboard_running()` — 2 rozne implementacje

- `src/tray.rs:502-514` — sprawdza procesy systemowe
- `src/lan_discovery.rs:155-172` — czyta `heartbeat.txt`

---

## 4. Wydajnosc i optymalizacje

### 4.1 8 oddzielnych polaczen DB w jednym sync flow [WYSOKI]

**Plik:** `src/lan_sync_orchestrator.rs`

W jednej sesji sync otwieranych jest 8 polaczen SQLite sekwencyjnie:
- `get_local_marker_hash()` (linia 421)
- `get_local_marker_created_at()` (linia 430)
- `backup_database()` (linia 449)
- `merge_incoming_data()` (linia 487)
- `verify_merge_integrity()` (linia 762)
- `compute_tables_hash_string()` (linia 800)
- `insert_sync_marker_db()` (linia 834)
- `build_full_export()` (linia 852)

Kazde otwarcie = syscall + SQLite init.

**Rozwiazanie:** Otworzyc jedno polaczenie na poczatku `execute_master_sync()` i przekazac `&Connection` do funkcji.

### 4.2 `compute_table_hash` concatenuje WSZYSTKIE rekordy [WYSOKI]

**Plik:** `src/lan_server.rs:416-444`

```sql
SELECT COALESCE(group_concat(app_name || '|' || start_time || '|' || updated_at, ';'), '')
FROM (SELECT ... FROM sessions s JOIN applications a ...)
```

Dla bazy z 50K sesji tworzy ogromny string w pamieci SQLite i Rust, tylko po to zeby go zhashowac. Wywolywane przy kazdym `/lan/status`, `/lan/ping`.

**Rozwiazanie:** Hashowac wiersz-po-wierszu (streaming hash) lub cache'owac hash z invalidacja po zmianach.

### 4.3 Pelny eksport nawet przy "delta" sync [WYSOKI]

**Plik:** `src/lan_sync_orchestrator.rs:358-359`

```rust
let merged_export = build_full_export()?;
```

Po scaleniu master buduje pelny eksport (od `1970-01-01`) niezaleznie od trybu. To neguje korzysc trybu delta.

### 4.4 Podwojny polling progressu z React [SREDNI]

Gdy sync jest aktywny, daemon dostaje zapytania:
- Co 600ms/3000ms z `LanSyncCard.tsx` (linia 147-188)
- Co 800ms z `Settings.tsx:handleLanSync` (linia 198-213)

Lacznie 2-3 requesty/s zamiast 1.

**Rozwiazanie:** Usunac polling z `handleLanSync` — `LanSyncCard` juz monitoruje progress.

### 4.5 Czytanie calego log-pliku co 500ms [SREDNI]

**Plik:** `dashboard/src/components/settings/LanSyncCard.tsx:191-205`

`getLanSyncLog(50)` czyta caly `lan_sync.log` z dysku (moze rosnac bez limitu), splituje na linie i zwraca 50 ostatnich. Powtarzane co 500ms.

**Rozwiazanie:** Ring buffer w pamieci lub `seek` do konca pliku.

### 4.6 Brak kompresji transferu sieciowego [SREDNI]

Caly protokol LAN sync przesyla dane jako raw JSON bez kompresji. JSON z danymi sesji jest bardzo powtarzalny — gzip daje typowo 80-90% redukcje.

### 4.7 Nowe polaczenie TCP dla kazdego kroku sync [NISKI]

`execute_master_sync` otwiera 5+ nowych polaczen TCP (negotiate, freeze-ack, pull, db-ready, unfreeze). Kazde z `Connection: close`.

### 4.8 `loadLanSyncState()` wywolywane w kazdym renderze [NISKI]

**Plik:** `dashboard/src/pages/Settings.tsx:408`

```tsx
lastSyncAt={loadLanSyncState().lastSyncAt}
```

Czyta z `localStorage` i parsuje JSON przy kazdym renderze.

### 4.9 `JSON.stringify` jako deep-compare peerow [NISKI]

**Plik:** `dashboard/src/pages/Settings.tsx:148-156`

```typescript
JSON.stringify(prev) !== JSON.stringify(peers) ? peers : prev
```

Co 5s serializuje dwie tablice do JSON tylko po to, zeby sprawdzic zmiane.

---

## 5. Jakosc kodu (Rust)

### 5.1 Role jako surowe stringi zamiast enum [SREDNI]

**Plik:** `src/lan_server.rs:121`

```rust
pub role: std::sync::Mutex<String>, // "master", "slave", "undecided"
```

Porownania stringow rozrzucone po calym kodzie (`lan_discovery.rs`, `lan_server.rs`, `lan_sync_orchestrator.rs`). Literowka nie zostanie wykryta w compile time.

To samo dotyczy faz synchronizacji (`phase: String` z 13 roznymi wartosciami) i trybu transferu (`mode: String` — "delta"/"full").

**Rozwiazanie:** Zdefiniowac enum z `#[derive(Serialize)]`.

### 5.2 Brak timeout na backoff sleep [SREDNI]

**Plik:** `src/lan_sync_orchestrator.rs:213-214`

```rust
let backoff = Duration::from_secs(5 * 3u64.pow(attempt - 1));
thread::sleep(backoff);
```

Przy `attempt=3`: 45 sekund sleepu bez sprawdzania `stop_signal`. Daemon nie moze byc zatrzymany.

### 5.3 Plik `lan_sync.log` rosnie bez limitu [SREDNI]

**Pliki:** `src/lan_server.rs:484-494`, `src/lan_sync_orchestrator.rs:16-26`

`sync_log` otwiera plik w trybie `append` bez rotacji.

**Rozwiazanie:** Rotacja logu (np. max 100KB, trim przy starcie sync).

### 5.4 Nieuzywany parametr `_device_id` [NISKI]

**Plik:** `src/lan_server.rs:760`

```rust
pub fn build_delta_for_pull_public(conn: &rusqlite::Connection, since: &str, _device_id: &str)
```

### 5.5 Blokujacy I/O w `async` Tauri commands [NISKI]

**Plik:** `dashboard/src-tauri/src/commands/lan_sync.rs:104-113`

```rust
pub async fn get_lan_peers() -> Result<Vec<LanPeer>, String> {
    let content = std::fs::read_to_string(&path) // blocking in async
```

`get_lan_peers`, `upsert_lan_peer`, `get_lan_sync_log` — wszystkie uzywaja blokujacego `std::fs` w async kontekscie.

---

## 6. Jakosc kodu (React/TypeScript)

### 6.1 `lanPeers` w dependency array bez uzycia [SREDNI]

**Plik:** `dashboard/src/pages/Settings.tsx:224`

```typescript
}, [lanPeers, triggerRefresh]);
```

`lanPeers` jest w zaleznosci `useCallback` ale nie jest uzywany w ciele callbacka `handleLanSync`. Powoduje niepotrzebne odtwarzanie referencji przy kazdej zmianie listy peerow (co 5s).

### 6.2 `syncPhaseLabels` tworzony inline w renderze [NISKI]

**Plik:** `dashboard/src/pages/Settings.tsx:465-478`

Obiekt z 13 kluczami tlumaczebnymi tworzony przy kazdym renderze. Powoduje niepotrzebny re-render `LanSyncCard`.

**Rozwiazanie:** Wyodrebnic do `useMemo` z zaleznoscia od `t`.

---

## 7. Brakujace tlumaczenia

### 7.1 Hardcoded polski tekst — slave info

**Plik:** `dashboard/src/components/settings/LanSyncCard.tsx:429-431`

```tsx
<p className="text-xs text-muted-foreground italic">
  To urządzenie jest w trybie slave — synchronizacja jest inicjowana przez mastera.
</p>
```

Brak klucza i18n — nie uzywa `t()`.

### 7.2 Hardcoded angielski tekst — Show/Hide Log

**Plik:** `dashboard/src/components/settings/LanSyncCard.tsx:546`

```tsx
{showLog ? 'Hide Log' : 'Show Log'}
```

### 7.3 Hardcoded angielski tekst — no log entries

**Plik:** `dashboard/src/components/settings/LanSyncCard.tsx:555`

```tsx
{syncLog || '(no log entries yet)'}
```

### 7.4 Hardcoded angielski tekst — force merge tooltip

**Plik:** `dashboard/src/components/settings/LanSyncCard.tsx:503`

```tsx
title="Force merge — ignores hash comparison"
```

**Rozwiazanie:** Dodac klucze do `en/common.json` i `pl/common.json`, uzyc `t()`.

Uwaga: Sekcje `settings.lan_sync` oraz `help_page.lan_sync_*` w obu plikach tlumaczebnowych sa **kompletne** (42 + 22 klucze, identyczne zestawy w EN i PL).

---

## 8. Braki w dokumentacji Help

### 8.1 Discovery Duration Minutes

Ustawienie `discoveryDurationMinutes` jest w `LanSyncSettings` i persystowane do pliku, ale Help.tsx nie wspomina o konfiguracji czasu okna discovery.

### 8.2 Sync Log viewer

Przycisk "Show Log" w `LanSyncCard` nie jest opisany w Help.tsx. Uzytkownik moze nie wiedziec, ze moze przegladac logi synchronizacji.

---

## 9. Dead code

### 9.1 `import_delta_into_db` — 350 linii z `#[allow(dead_code)]`

**Plik:** `dashboard/src-tauri/src/commands/lan_sync.rs:313-661`

Cala rozbudowana funkcja importu z lepsza logika mapowania ID (patrz punkt 1.2). Paradoksalnie ta wersja jest poprawniejsza niz aktywna wersja w daemonie.

### 9.2 `verify_and_cleanup_after_merge` — dead code

**Plik:** `dashboard/src-tauri/src/commands/lan_sync.rs:664-698`

### 9.3 Wiele nieuzywanych typow w `lan_sync.rs`

**Plik:** `dashboard/src-tauri/src/commands/lan_sync.rs` — linie 61, 68, 76, 704, 727

---

## 10. Podsumowanie priorytetow

### Krytyczne (natychmiastowa naprawa)

| # | Problem | Plik | Wplyw |
|---|---------|------|-------|
| 1 | SQL Injection w `build_delta_for_pull` | `lan_server.rs:776-796` | Bezpieczenstwo — wykonanie dowolnego SQL z sieci LAN |
| 2 | Merge uzywa zdalnych `app_id`/`project_id` bez mapowania | `lan_sync_orchestrator.rs:596` | Utrata danych — sesje przypisane do zlych apps/projektow lub kasowane |

### Wysokie (powinny byc naprawione przed release)

| # | Problem | Plik | Wplyw |
|---|---------|------|-------|
| 3 | Slave nigdy nie pobiera scalonych danych | `lan_sync_orchestrator.rs:372` | Sync jest jednostronny — slave nie otrzymuje danych |
| 4 | `DefaultHasher` niestabilny cross-platform | 3 pliki | Niepotrzebne synce, bledne porownania hashow |
| 5 | 8 polaczen DB w jednym sync flow | `lan_sync_orchestrator.rs` | Wydajnosc sync |
| 6 | `compute_table_hash` — `group_concat` calej tabeli | `lan_server.rs:416` | Pamiec/CPU przy duzych bazach |
| 7 | Pelny eksport nawet przy delta sync | `lan_sync_orchestrator.rs:359` | Transfer sieciowy |

### Srednie (plan naprawy)

| # | Problem | Wplyw |
|---|---------|-------|
| 8 | 3x duplikacja `get_device_id`, `get_machine_name`, `sync_log`, `compute_table_hash` | Utrzymywalnosc |
| 9 | 2 niezalezne implementacje merge (z niespojana logika tombstone) | Spojnosc danych |
| 10 | Race condition w elekcji (jednoczesny start) | Podwojna elekcja master |
| 11 | Brak atomowosci freeze/unfreeze | Buforowanie danych do 5 min |
| 12 | Port w UI fikcyjny (daemon hardkoduje) | UX — zmiana bez efektu |
| 13 | Podwojny polling progressu | Nadmiarowe requesty |
| 14 | `lan_sync.log` bez rotacji | Zuzycie dysku |
| 15 | Brak kompresji transferu | Predkosc sync |
| 16 | Role/fazy jako stringi zamiast enum | Bezpieczenstwo typow |
| 17 | 4 hardcoded stringi w LanSyncCard (brak i18n) | Lokalizacja |

### Niskie (nice-to-have)

| # | Problem | Wplyw |
|---|---------|-------|
| 18 | `loadLanSyncState()` w kazdym renderze | Drobna nieefektywnosc |
| 19 | `syncPhaseLabels` inline w renderze | React re-render |
| 20 | `lanPeers` w dependency array bez uzycia | Niepotrzebne re-tworzenie callbacka |
| 21 | `JSON.stringify` jako deep-compare | Drobna nieefektywnosc |
| 22 | Blokujacy I/O w async Tauri commands | Anti-pattern |
| 23 | 350 linii dead code (`import_delta_into_db`) | Czytelnosc |
| 24 | Brakujace opisy w Help (discovery duration, sync log) | Dokumentacja |

---

*Raport wygenerowany automatycznie na podstawie analizy 3 agentow (Code Reuse, Code Quality, Efficiency).*
