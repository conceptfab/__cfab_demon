# TIMEFLOW — Analiza kodu i plan refaktoryzacji

Data analizy: 2026-03-17

---

## 1. Procesy i logika

### 1.1 Architektura procesow

**Daemon (Rust)** — 3 watki + main thread:
1. **Main thread** — `tray::run()` — petla zdarzen NWG, menu kontekstowe, double-click na dashboard
2. **Tracker thread** — `tracker::start()` — polling co 10s, zapis co 5min, reload konfigu co 30s
3. **Foreground Hook thread** — `foreground_hook::start()` — `SetWinEventHook` budzi tracker przy zmianie okna
4. **WMI warm** (jednorazowy) — rozgrzewka WMI w `monitor.rs`

**Dashboard (Tauri/React):**
- **BackgroundServices** — centralny job pool z jednym `setInterval` (1s tick), obsluguje: diagnostics, refresh, file signature check, auto-split, online sync
- **Zustand stores** — `data-store`, `background-status-store`, `ui-store`, `settings-store`, `projects-cache-store`

**Komunikacja daemon <-> dashboard:**
- Jednokierunkowa przez SQLite (WAL mode)
- Daemon pisze do `%APPDATA%/TimeFlow/data/*.db` (daily stores)
- Dashboard importuje dane z daily stores do `timeflow_dashboard.db`
- Daemon czyta z `timeflow_dashboard.db` w trybie READ_ONLY (monitored_apps, sessions)
- Brak mechanizmu push — daemon reaguje na zmiany dashboardu z opoznieniem ~30s (config reload)

### 1.2 Znalezione problemy

#### 🟡 Race condition przy odczycie daily store
**Pliki:** `src/storage.rs`, `dashboard/src-tauri/src/commands/daemon/status.rs`

Daemon zapisuje daily store co 5 minut. Dashboard moze importowac dane z tego samego pliku jednoczesnie. WAL mode minimalizuje ryzyko, ale daemon nie ustawia jawnego `busy_timeout`.

**Propozycja:** Dodac `conn.busy_timeout(Duration::from_millis(2000))` w `storage::save_daily()` i `storage::load_daily()`.

#### 🟡 Nieatomatyczny odczyt konfiguracji
**Plik:** `src/config.rs:180` (funkcja `load()`)

Funkcja czyta JSON (interwaly) a potem DB (monitorowane aplikacje). Miedzy tymi odczytami dashboard moze zmienic dane — daemon dostaje niespojny stan.

**Propozycja:** Odczytac oba zrodla, potem zlozyc `Config` atomowo. Ryzyko niskie (interwaly prawie nigdy sie nie zmieniaja).

#### 🟢 Duplikacja logiki normalizacji exe_name
**Plik:** `src/config.rs` — linie 130, 172, 205

`.trim().to_lowercase()` powtarza sie 3 razy. Warto wydzielic helper `fn normalize_exe(s: &str) -> String`.

#### 🟢 Duplikacja sprawdzania tabeli w SQLite
**Pliki:** `src/tray.rs:65-76`, `src/config.rs:139-150`

Ten sam wzorzec `SELECT name FROM sqlite_master WHERE type='table' AND name=?`. Warto wydzielic `fn table_exists(conn, name) -> bool`.

---

## 2. Wydajnosc i wielowatkowosc

### 2.1 Rust Daemon — wielowatkowosc

**Architektura jest poprawna.** Daemon nie uzywa tokio — jest czysto synchroniczny:
- `AtomicBool` (stop_signal) z `Ordering::SeqCst`/`Relaxed` — uzyte prawidlowo
- `ForegroundSignal` (Mutex + Condvar) — poprawna implementacja
- Brak wspoldzielonych danych miedzy watkami poza sygnalami
- Brak tokio, brak `Arc<Mutex<data>>` — eliminuje klasy bledow

### 2.2 Znalezione problemy wydajnosciowe

#### 🟡 Config reload otwiera SQLite co 30s bez change detection
**Plik:** `src/config.rs:180`

Kazdy reload konfiguracji (co 30s) otwiera polaczenie SQLite + czyta JSON. Brak cache/porownania z poprzednia wersja.

**Propozycja:** Sprawdzac mtime pliku JSON i porownywac z poprzednim — pominac parsowanie gdy sie nie zmienil.

#### 🟡 Tray otwiera DB co 30s bez cache polaczenia
**Plik:** `src/tray.rs:49-88`

`query_unassigned_attention_count()` otwiera read-only polaczenie SQLite na kazdym timer tick.

**Propozycja:** Utrzymywac polaczenie miedzy odswiezeniami.

#### 🟡 `load_language()` czyta plik z dysku co 5s
**Plik:** `src/i18n.rs:77`

Plik `language.json` jest czytany co 5s przez timer w tray.

**Propozycja:** Cachowac wynik i sprawdzac mtime pliku zamiast pelnego odczytu.

#### 🟡 Process snapshot alokuje nowe HashMapy co 30s
**Plik:** `src/monitor.rs:256-274`

`build_process_snapshot()` tworzy nowe HashMapy za kazdym razem.

**Propozycja:** Reuzywac istniejace HashMapy (clear + repopulate) zamiast tworzyc nowe.

#### 🟡 Per-app CPU measurement alokuje buffers per tick
**Plik:** `src/monitor.rs:323-371`

Dla kazdej monitorowanej aplikacji, na kazdym 10s ticku: `root_pids.clone()`, `HashSet::new()`, sort + dedup.

**Propozycja:** Preallocate buffers na poziomie petli i czyscic/reuzywac.

### 2.3 React — wycieki pamieci i re-rendery

#### 🔴 Race condition w `loadMore` — brak in-flight guard
**Plik:** `dashboard/src/hooks/useSessionsData.ts:109-123`

`loadMore` nie ma flagi `isLoadingRef` — wielokrotne klikniecia moga spowodowac zduplikowane sesje. Oba rownolegle wywolania uzyja tego samego offsetu (`sessionsRef.current.length`).

**Propozycja:** Dodac guard na poczatku `loadMore`:
```typescript
const loadMore = useCallback(() => {
  if (isLoadingRef.current) return;  // <-- DODAC
  isLoadingRef.current = true;       // <-- DODAC
  sessionsApi
    .getSessions(buildFetchParams(sessionsRef.current.length))
    .then((data) => {
      setSessions((prev) => {
        const next = [...prev, ...data];
        sessionsRef.current = next;
        return next;
      });
      const nextHasMore = data.length >= SESSION_PAGE_SIZE;
      hasMoreRef.current = nextHasMore;
      setHasMore(nextHasMore);
    })
    .catch(console.error)
    .finally(() => { isLoadingRef.current = false; });  // <-- DODAC
}, [buildFetchParams, sessionsRef, setSessions]);
```

#### 🟡 Unbounded cache w `scoreBreakdownCacheRef`
**Plik:** `dashboard/src/hooks/useSessionScoreBreakdown.ts:51`

`scoreBreakdownCacheRef` (Map<number, CachedBreakdownEntry>) rosnie nieograniczenie. TTL sprawdzany tylko przy odczycie (lazy eviction), ale stare wpisy nigdy nie sa usuwane.

**Propozycja:** Dodac limit rozmiaru mapy (np. 200 wpisow) lub czyscic przy zmianie date range.

#### 🟡 Unbounded cache w `splitEligibilityCacheRef`
**Plik:** `dashboard/src/hooks/useSessionSplitAnalysis.ts:36`

Mapa `Map<number, string>` nie jest nigdy czyszczona (poza jawnym `clearSplitCaches`).

**Propozycja:** Czyscic przy zmianie date range lub po przekroczeniu limitu.

#### 🟡 Sync disk read wewnatrz useMemo hot path
**Plik:** `dashboard/src/pages/Sessions.tsx:464`

`loadFreezeSettings()` wewnatrz `useMemo` — czyta z localStorage synchronicznie na kazdym renderze gdy zmienia sie `projects` lub `t`.

**Propozycja:** Wyniesc do stanu i odswiezac na event `settings_saved`.

### 2.4 Dobre wzorce (juz zaimplementowane)

- **Zustand stores** — change detection guards (`areDaemonStatusesEqual`, `areAssignmentStatusesEqual`, `areDatabaseSettingsEqual`), in-flight flags
- **Data store** — `scheduleThrottledRefresh` z 250ms throttle + per-reason dedupe 1s
- **BackgroundServices** — centralny job pool zamiast rozproszonych setInterval
- **useSessionsData** — `isLoadingRef` w `loadFirstSessionsPage`, `cancelled` flag w useEffect
- **SessionRow** — juz opakowany w `memo`

---

## 3. Obsluga bledow i bezpieczenstwo danych

### 3.1 Niebezpieczne `unwrap()`/`expect()`

#### 🔴 `tracker.rs:466` — kruchy `expect()`
**Plik:** `src/tracker.rs:466`
```rust
.expect("process snapshot cache should be populated before background tracking")
```
Warunek na liniach 457-462 gwarantuje ze cache jest ustawiony, ale zaleznosc jest krucha — zmiana logiki warunkowej = panic.

**Propozycja:** Zamienic na `let Some(proc_snap) = process_snapshot_cache.as_ref() else { continue; };`

#### 🔴 `db.rs:97` — `expect()` na app_data_dir
**Plik:** `dashboard/src-tauri/src/db.rs:97`
```rust
.expect("Failed to get app data dir")
```
Na nietypowych konfiguracjach systemowych `app.path().app_data_dir()` moze byc `Err`.

**Propozycja:** Zamienic na `.map_err(|e| e.to_string())?` z propagacja bledu.

#### 🟡 `tray.rs:235+` — seria `expect()` w NWG init
**Plik:** `src/tray.rs:235-326`

16 wywolan `.expect()` przy inicjalizacji NWG tray. Jesli NWG nie moze sie zainicjalizowac, panic trace ukazuje sie w tle.

**Propozycja:** Lepsze byloby wyswietlenie bledu uzytkownikowi i graceful exit, ale panic tu jest czesciowo uzasadniony (bez tray aplikacja nie ma sensu).

#### 🟢 Bezpieczne `expect()` na stalych
- `bughunter.rs:59` — staly MIME literal — nie moze fail
- `sessions/split.rs:247` — staly regex — nie moze fail
- Testy (`#[cfg(test)]`) — wszystkie `unwrap()` sa prawidlowe

### 3.2 Odpornosc na bledy I/O
🟢 **Poprawna.** Demon obsluguje:
- Brak polaczenia z DB — `storage::load_daily` loguje warning i zwraca pusta strukture
- Pelny dysk — bledy zapisu logowane z `log::error!`, nie panic
- Uszkodzone JSON — `serde_json::from_str` z fallback na `Config::default()`
- Migracja legacy JSON — bledy skippowane z `log::warn`

### 3.3 Backup/Export
🟢 **Poprawny.**
- Backup (`db.rs:324-349`) uzywa `VACUUM INTO` — atomowe
- Przed backupem flushowany jest WAL
- Auto-backup sprawdza interwal dni i loguje bledy
- Export poprawnie buduje archiwum z transakcja implicita (SQLite WAL + read lock)

### 3.4 Ryzyko migracji danych

#### 🟡 Migracja daily_files schema bez transakcji
**Plik:** `shared/daily_store/schema.rs:87-202`

Migracja `daily_files` (zmiana PK) uzywa `CREATE TABLE... INSERT SELECT... DROP... RENAME` pattern. Jesli aplikacja padnie w srodku migracji, dane moga byc utracone — nie jest opakowane w transakcje.

**Propozycja:** Dodac jawna transakcje wokol bloku migracji `migrate_daily_files_schema`.

---

## 4. Refaktoryzacja i modularyzacja

### 4.1 Zduplikowane wzorce

#### 🟡 Duplicate query patterns w export.rs
**Plik:** `dashboard/src-tauri/src/commands/export.rs:82-159`

Dwa identyczne bloki `query_map` dla `projects` (z `project_id` i bez). Ten sam wzorzec dla `applications`.

**Propozycja:** Wyekstrahowac generyczna funkcje `query_all_or_filtered<T>()`.

#### 🟢 Normalizacja exe_name (juz wymieniona w §1)
#### 🟢 Table exists check (juz wymieniony w §1)

### 4.2 Modularyzowalny kod

#### 🟢 `tracker.rs` (560+ linii)
`record_app_activity` moglby byc w osobnym `src/recording.rs`, ale obecna struktura jest czytelna. Brak pilnosci.

#### 🟢 `export.rs` (416 linii)
Monotonna ale linearna. Podzial nie jest pilny.

### 4.3 Brak pluginow dla activity_classification

#### 🟡 Hardcoded lista exe -> ActivityType
**Plik:** `shared/activity_classification.rs`

`classify_activity_type` przyjmuje `overrides: Option<&HashMap<String, String>>`, ale demon zawsze wywoluje go z `None`.

**Propozycja:** Wczytywac overrides z pliku konfiguracyjnego (np. `activity_overrides.json` w katalogu TimeFlow) aby uzytkownik mogl definiowac wlasne klasyfikacje bez rekompilacji.

---

## 5. Tlumaczenia i Help

### 5.1 Pliki tlumaczen
🟢 **Kompletne.**
- `dashboard/src/locales/en/common.json` i `pl/common.json` — identyczna struktura, ta sama liczba linii, te same klucze.
- Daemon `src/i18n.rs` — wszystkie teksty tray maja odpowiedniki PL i EN.

### 5.2 Help / Pomoc
🟢 **Pelna parzytosc.**
- `dashboard/src/pages/Help.tsx` korzysta z kluczy `help_page.*`
- Sekcje: Tracking, Sessions, Projects, Statistics, Reports, Settings, Unique Files, Import/Export, AI, Background services, Keyboard shortcuts, Troubleshooting
- Kazdy klucz EN ma odpowiednik PL.

### 5.3 Drobne uwagi

#### 🟢 "Demon" vs "Daemon"
**Plik:** `src/main.rs:23` — `pub const APP_NAME: &str = "TIMEFLOW Demon";`

"Demon" to polski wariant. W EN powinno byc "Daemon", ale to nazwa produktu — moze pozostac.

---

## 6. Unique Files — analiza mechanizmu

### 6.1 Pelny flow danych

**Krok 1: Zbieranie (daemon)**
- `src/tracker.rs` — `record_app_activity()` pobiera tytul okna z `monitor::get_foreground_info()`
- `src/activity.rs` — `extract_file_from_title(title)` parsuje tytul i wyodrebnia nazwe pliku (np. "main.rs - Visual Studio Code" -> "main.rs")
- Wyciagniete dane trafiaja do `FileEntry` w strukturze `DailyData.files`

**Krok 2: Przechowywanie (daemon)**
- `src/storage.rs` — `save_daily()` — `FileEntry` zapisywany do daily SQLite store w `%APPDATA%/TimeFlow/data/`

**Krok 3: Import (dashboard/Tauri)**
- Dashboard importuje dane z daily stores do tabeli `file_activities` w `timeflow_dashboard.db`
- Kolumny: `file_name`, `file_path`, `exe_name`, `start_time`, `end_time`

**Krok 4: Agregacja (SQL)**
- `dashboard/src-tauri/src/commands/projects.rs` — zapytanie SQL:
```sql
COUNT(DISTINCT LOWER(COALESCE(NULLIF(TRIM(fa.file_path),''), NULLIF(TRIM(fa.file_name),''))))
```
- Join z `sessions` przez nakladanie przedzialow czasowych
- Wpisy `(background)` sa wykluczane

**Krok 5: Wyswietlanie (React)**
- Wynik trafia do `ProjectCard` i `ProjectEstimatesSection`

### 6.2 Ocena poprawnosci

🟢 **Logika SQL jest poprawna:**
- `LOWER()` zapewnia normalizacje wielkosci liter
- `COALESCE(NULLIF(TRIM(file_path),''), NULLIF(TRIM(file_name),''))` — preferuje file_path, fallback na file_name
- Wykluczenie `(background)` prawidlowe
- Join czasowy (nakladanie przedzialow) logicznie poprawny

#### 🟡 Ograniczenie: zaleznosc od formatu tytulu okna
**Plik:** `src/activity.rs`

Ekstrakcja pliku zalezy od formatu tytulu konkretnej aplikacji. Rozne edytory maja rozne formaty. Jesli aplikacja nie ma standardowego separatora, ekstrakcja moze sie nie udac — ale to ograniczenie, nie blad.

#### 🟢 Brak deduplikacji plikow na poziomie zapisu
Daemon zapisuje kazde wystapienie pliku jako osobny `FileEntry`. Deduplikacja nastepuje dopiero w SQL (`COUNT(DISTINCT ...)`). Poprawne, ale generuje wiecej danych w daily store.

---

## 7. Raport PDF — diagnoza i poprawki

### 7.1 PDF obcina zawartosc do jednej strony

🔴 **Przyczyna zdiagnozowana.**

**Plik:** `dashboard/src/pages/ReportView.tsx:95`
```tsx
<div className="flex flex-col h-screen bg-background pt-8 print:pt-0 print:bg-white">
```

Klasa `h-screen` wymusza `height: 100vh` na kontenerze glownym. W trybie drukowania przegladarka interpretuje `100vh` jako wysokosc jednej strony drukowanej. Cala zawartosc jest skompresowana do tej jednej strony.

Linia 119:
```tsx
<div className="flex-1 overflow-y-auto px-4 pt-4 print:px-0 print:pt-0 print:overflow-visible ...">
```
`flex-1` wewnatrz `h-screen` flex containera ogranicza wysokosc tresci. `print:overflow-visible` jest ustawione, ale `h-screen` na rodzicu nadal blokuje.

**Poprawka:**
1. Linia 95 — zamienic `h-screen` na `h-screen print:h-auto`:
```tsx
<div className="flex flex-col h-screen print:h-auto bg-background pt-8 print:pt-0 print:bg-white">
```
2. Dodac `@page` do `dashboard/src/index.css`:
```css
@page {
  margin: 15mm;
  size: A4;
}
```
3. Dodac `print:break-inside-avoid` do sekcji raportu (tabele, stats, financials).

### 7.2 Nazwa pliku PDF

🔴 **Brak kontroli nad nazwa pliku.**

**Plik:** `dashboard/src/pages/ReportView.tsx:110`
```tsx
onClick={() => window.print()}
```

Przegladarka/WebView generuje nazwe z `document.title`. Brak dynamicznego ustawiania tytulu.

**Poprawka:** Przed `window.print()` ustawic `document.title`:
```tsx
onClick={() => {
  const originalTitle = document.title;
  const safeName = report.project.name.replace(/[^a-zA-Z0-9_\-\s]/g, '_');
  document.title = `timeflow_raport_${safeName}`;
  window.print();
  document.title = originalTitle;
}}
```

### 7.3 Limit 50 sesji w raporcie

🟡 **Plik:** `dashboard/src/pages/ReportView.tsx:335`
```tsx
{report.sessions.slice(0, 50).map((s) => (
```

Po naprawieniu wielostronicowosci (7.1) warto zwiekszyc lub usunac ten limit.

### 7.4 Wskaznik nieprzypisanych sesji nie odswierza sie po przypisaniu

🔴 **Root cause zdiagnozowany.**

**Sciezka mutacji:**
1. Uzytkownik przypisuje sesje w `Sessions.tsx`
2. `useSessionActions.ts:30` — po sukcesie wywoluje `onAfterMutation()`
3. `Sessions.tsx` — `onAfterMutation` to `() => triggerRefresh('sessions_mutation')`
4. `data-store.ts` — `triggerRefresh('sessions_mutation')` inkrementuje `refreshKey` i emituje `APP_REFRESH_EVENT`

**Co sie odswierza:** Lista sesji na stronie Sessions (bo nasluchuje na `refreshKey`).

**Co sie NIE odswierza:** Badge w Sidebar czyta z `background-status-store` (`todayUnassigned`, `allUnassigned`). `refreshDiagnostics()` jest wywoływane TYLKO przez:
- Periodyczny timer w job pool (co ~60s)
- `visibilitychange` event
- `LOCAL_DATA_CHANGED_EVENT`

`sessions_mutation` emituje `APP_REFRESH_EVENT`, ale NIE emituje `LOCAL_DATA_CHANGED_EVENT`. Sidebar badge nie reaguje.

**Poprawka (1 linia):** W `dashboard/src/hooks/useSessionActions.ts:30`, po `onAfterMutation?.()` dodac:
```typescript
import { useBackgroundStatusStore } from '@/store/background-status-store';

// W runMutation, po onAfterMutation?.():
useBackgroundStatusStore.getState().refreshDiagnostics();
```

Alternatywnie (czystsze architektonicznie): emitowac `LOCAL_DATA_CHANGED_EVENT` obok `APP_REFRESH_EVENT` w `data-store.ts` dla reason `sessions_mutation`.

**Dla daemon tray badge:** Brak realnego fix — daemon nie ma kanalu push. 30-sekundowy polling to rozsadny kompromis.

---

## 8. Sugestie funkcjonalne

### 🟡 8.1 Brak obslugi Communication jako ActivityType
**Plik:** `shared/activity_classification.rs`

3 typy: Coding, Browsing, Design. Slack, Teams, Discord nie sa klasyfikowane — trafiaja do `None`. Dodanie `Communication` ulatwiloby filtrowanie raportow.

### 🟡 8.2 Idle threshold jest hardcoded
**Plik:** `src/tracker.rs:356`
```rust
const IDLE_THRESHOLD_MS: u64 = 120_000;
```
2 minuty bezczynnosci moga byc za krotkie przy czytaniu dokumentacji.

**Propozycja:** Dodac `idle_threshold_ms` do `Intervals` w konfiguracji.

### 🟢 8.3 Log truncation zamiast rotacji
**Plik:** `src/main.rs:114-122`

Log jest obcinany gdy przekroczy 1MB — caly plik czyszczony (truncate). Utrata kontekstu.

**Propozycja:** Rotacja logow (rename na `.log.old` + nowy plik).

### 🟢 8.4 Limit 50 sesji i 25 komentarzy w raporcie
**Pliki:** `dashboard/src/pages/ReportView.tsx:335, 372`

Po naprawieniu wielostronicowosci warto zwiekszyc lub usunac te limity.

---

## 9. Plan prac (priorytetyzowany)

### Faza 1 — Krytyczne (bugi, UX)

| # | Zadanie | Pliki | Zaleznosci |
|---|---------|-------|------------|
| 1.1 | PDF: dodac `print:h-auto` i `@page` | `ReportView.tsx:95`, `index.css` | Brak |
| 1.2 | PDF: dynamiczny `document.title` dla nazwy pliku | `ReportView.tsx:110` | Brak |
| 1.3 | Sidebar badge: odswiezanie po mutacji sesji | `useSessionActions.ts:30` | Brak |
| 1.4 | Race condition w `loadMore` | `useSessionsData.ts:109` | Brak |
| 1.5 | `expect()` w `tracker.rs:466` -> `else { continue }` | `src/tracker.rs:466` | Brak |
| 1.6 | `expect()` w `db.rs:97` -> propagacja bledu | `dashboard/src-tauri/src/db.rs:97` | Brak |

### Faza 2 — Wazne (wydajnosc, stabilnosc)

| # | Zadanie | Pliki | Zaleznosci |
|---|---------|-------|------------|
| 2.1 | Transakcja w migracji daily_files schema | `shared/daily_store/schema.rs:87-202` | Brak |
| 2.2 | `busy_timeout` w daemon storage | `src/storage.rs` | Brak |
| 2.3 | Cache polaczenia DB w tray | `src/tray.rs:49-88` | Brak |
| 2.4 | Cache mtime dla `load_language()` | `src/i18n.rs:77` | Brak |
| 2.5 | Cache mtime dla config reload | `src/config.rs:180` | Brak |
| 2.6 | Bounded cache w `scoreBreakdownCacheRef` | `useSessionScoreBreakdown.ts:51` | Brak |
| 2.7 | Bounded cache w `splitEligibilityCacheRef` | `useSessionSplitAnalysis.ts:36` | Brak |
| 2.8 | `loadFreezeSettings()` z useMemo do stanu | `Sessions.tsx:464` | Brak |
| 2.9 | PDF: usunac limit 50 sesji (po naprawie 1.1) | `ReportView.tsx:335` | Wymaga 1.1 |
| 2.10 | PDF: `print:break-inside-avoid` na sekcjach | `ReportView.tsx` | Wymaga 1.1 |

### Faza 3 — Nice-to-have (czystosc kodu)

| # | Zadanie | Pliki | Zaleznosci |
|---|---------|-------|------------|
| 3.1 | Helper `normalize_exe()` | `src/config.rs` | Brak |
| 3.2 | Helper `table_exists()` | `src/tray.rs`, `src/config.rs` | Brak |
| 3.3 | Generyczna `query_all_or_filtered` w export | `export.rs` | Brak |
| 3.4 | Preallocate buffers w `monitor.rs` | `src/monitor.rs:256-371` | Brak |
| 3.5 | `Communication` jako ActivityType | `shared/activity_classification.rs` | Brak |
| 3.6 | Konfigurowalny idle_threshold_ms | `src/tracker.rs:356` | Brak |
| 3.7 | Rotacja logow zamiast truncation | `src/main.rs:114-122` | Brak |
| 3.8 | Activity overrides z pliku config | `shared/activity_classification.rs` | Brak |

---

## 10. Wskazowki dla kolejnego modelu

### 10.1 Architektura i kluczowe decyzje

**Daemon (Rust):**
- Czysto synchroniczny — 3 watki, brak async runtime
- Komunikacja z dashboardem wylacznie przez SQLite (WAL)
- Daemon jest read-only wzgledem `timeflow_dashboard.db`
- Daily stores w `%APPDATA%/TimeFlow/data/` — kazdy dzien osobna baza SQLite
- Shared crate (`shared/`) zawiera typy i logike wspolna daemon+dashboard

**Dashboard (Tauri v2 + React):**
- Tauri backend w `dashboard/src-tauri/src/commands/` — kazdy plik = grupa komend
- React frontend z Zustand stores, i18n (react-i18next), Tailwind CSS
- `BackgroundServices.tsx` — centralny job pool (1 setInterval, 1s tick)
- Event system: `APP_REFRESH_EVENT` (wewn. odswiezanie stron) + `LOCAL_DATA_CHANGED_EVENT` (sync + diagnostics)
- `data-store.ts` zarzadza `refreshKey` + `lastRefreshReason` — kazda strona sprawdza reason i decyduje czy sie odswiezyc

**Dane uzytkownika:**
- SQLite baza `timeflow_dashboard.db` — glowna baza dashboardu
- SQLite daily stores w `%APPDATA%/TimeFlow/data/` — surowe dane z daemona
- JSON config w `%APPDATA%/TimeFlow/timeflow_intervals.json`
- localStorage dla ustawien UI (session settings, freeze settings, sync meta)

### 10.2 Lista zmian z konkretnymi plikami

**1.1 PDF print:h-auto**
- `dashboard/src/pages/ReportView.tsx:95` — dodac `print:h-auto` do klasy
- `dashboard/src/index.css` — dodac regule `@page { margin: 15mm; size: A4; }`

**1.2 PDF document.title**
- `dashboard/src/pages/ReportView.tsx:110` — zamienic `onClick={() => window.print()}` na:
```tsx
onClick={() => {
  const orig = document.title;
  const safe = report.project.name.replace(/[^a-zA-Z0-9_\-\s]/g, '_');
  document.title = `timeflow_raport_${safe}`;
  window.print();
  document.title = orig;
}}
```

**1.3 Sidebar badge refresh**
- `dashboard/src/hooks/useSessionActions.ts:28-31` — po `onAfterMutation?.()` dodac:
```typescript
void useBackgroundStatusStore.getState().refreshDiagnostics();
```
- Dodac import: `import { useBackgroundStatusStore } from '@/store/background-status-store';`

**1.4 loadMore race condition**
- `dashboard/src/hooks/useSessionsData.ts:109-123` — dodac `isLoadingRef` guard (patrz §2 powyzej)

**1.5 tracker.rs expect**
- `src/tracker.rs:466` — zamienic `.expect(...)` na:
```rust
let Some(proc_snap) = process_snapshot_cache.as_ref() else { continue; };
```

**1.6 db.rs expect**
- `dashboard/src-tauri/src/db.rs:97` — zamienic `.expect(...)` na `.map_err(|e| format!("Failed to get app data dir: {e}"))?`

### 10.3 Ostrzezenia

- **PRIORYTET ABSOLUTNY:** Zachowanie danych uzytkownika. Zadna zmiana nie moze usunac ani zmodyfikowac istniejacych plikow danych bez mechanizmu migracji.
- **Migracja daily_files schema (2.1):** Zmiana wymaga ostroznnosci — opakowanie w transakcje jest bezpieczne, ale nalezy przetestowac na kopii danych.
- **PDF fix (1.1):** Po dodaniu `print:h-auto` sprawdzic czy toolbar (`print:hidden`) nadal jest ukryty. Przetestowac z dlugimi raportami (>100 sesji).
- **loadMore fix (1.4):** Upewnic sie ze `isLoadingRef.current = false` jest w `finally` — inaczej po bledzie loadMore zostanie permanentnie zablokowany.
- **Sidebar badge (1.3):** `refreshDiagnostics()` jest async i ma in-flight guard — bezpieczne do wywolania wielokrotnie.
- **Nie modyfikowac** struktury tabel SQLite bez dodania migracji w `dashboard/src-tauri/src/db_migrations/`.
- **Testy:** Projekt ma testy w `useSessionActions.test.ts`, `session-utils.test.ts`, `page-refresh-reasons.test.ts`, `projects-all-time.test.ts`, `sessions/tests.rs`. Uruchomic je po zmianach.

### 10.4 Instrukcja

Na podstawie tego `refactor.md` sporzadz szczegolowy `plan_implementacji.md` z krokami do wykonania. Kazdy krok powinien zawierac:
1. Numer z tego dokumentu (np. 1.1, 1.2)
2. Dokladna sciezke pliku i numery linii
3. Kod PRZED i PO zmianie
4. Kryteria akceptacji (jak sprawdzic ze dziala)
5. Kolejnosc implementacji — Faza 1 najpierw, potem Faza 2, na koncu Faza 3
