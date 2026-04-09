# TIMEFLOW — Raport z audytu kodu
**Data:** 2026-04-09  
**Zakres:** Demon Rust (`src/`), Dashboard React/TS (`dashboard/src/`), Help.tsx vs funkcjonalnosc  
**Status aplikacji:** Dzialajaca poprawnie — raport dotyczy optymalizacji, bezpieczenstwa i jakosci kodu

---

## Spis tresci

1. [Demon Rust — problemy krytyczne](#1-demon-rust--problemy-krytyczne)
2. [Demon Rust — problemy wysokie](#2-demon-rust--problemy-wysokie)
3. [Demon Rust — problemy srednie](#3-demon-rust--problemy-srednie)
4. [Demon Rust — problemy niskie](#4-demon-rust--problemy-niskie)
5. [Dashboard — problemy krytyczne](#5-dashboard--problemy-krytyczne)
6. [Dashboard — problemy wysokie](#6-dashboard--problemy-wysokie)
7. [Dashboard — problemy srednie](#7-dashboard--problemy-srednie)
8. [Dashboard — problemy niskie](#8-dashboard--problemy-niskie)
9. [Brakujaca dokumentacja w Help.tsx](#9-brakujaca-dokumentacja-w-helptsx)
10. [Podsumowanie i priorytety](#10-podsumowanie-i-priorytety)

---

## 1. Demon Rust — problemy krytyczne

### C-R1. Undefined Behavior przy zerowaniu hasel w pamieci
**Pliki:** `src/sftp_client.rs:26-33`, `src/sync_encryption.rs:41-48`

`as_mut_vec()` na `String` narusza invarianty Rusta — po wyzerowaniu bajtow String zawiera nieprawidlowe UTF-8. Kompilator moze zoptymalizowac `write_volatile` gdy `String::drop` potem czyta metadane.

```rust
// PROBLEM:
unsafe {
    let pw_bytes = self.password.as_mut_vec();
    std::ptr::write_volatile(pw_bytes.as_mut_ptr(), 0); // zeruje TYLKO 1 bajt
    for b in pw_bytes.iter_mut() { std::ptr::write_volatile(b, 0); }
}
```

**Rozwiazanie:** Uzyc crate `zeroize` albo: `password.clear(); password.shrink_to_fit();`

---

### C-R2. Restore backupu przy otwartym polaczeniu SQLite
**Plik:** `src/sync_common.rs:144-184`

`fs::copy` nadpisuje plik DB podczas gdy `conn` jest nadal otwarty. Na Windowsie SQLite trzyma lock na pliku — moze spowodowac korupcje bazy.

```rust
// PROBLEM:
pub fn restore_database_backup(conn: &rusqlite::Connection) -> Result<RestoreResult, String> {
    std::fs::copy(&latest, &db_path) // conn wciaz otwarty!
}
```

**Rozwiazanie:** Zamknac polaczenie przed `fs::copy` lub uzyc SQLite backup API (`backup_init`).

---

### C-R3. Ciche odrzucanie duzych request body bez HTTP 413
**Plik:** `src/lan_server.rs:400-408`

Jesli `content_length > MAX_REQUEST_BODY` (50MB), cialo zadania jest ignorowane — handler dostaje pusty string. Dla `/lan/upload-db` oznacza to zapis pustych danych jako "incoming".

```rust
// PROBLEM:
let body = if content_length > 0 && content_length <= MAX_REQUEST_BODY {
    // read body...
} else {
    String::new() // puste dane zamiast bledu!
};
```

**Rozwiazanie:** Zwrocic HTTP 413 (Payload Too Large) i przerwac przetwarzanie.

---

## 2. Demon Rust — problemy wysokie

### H-R1. `trigger_sync` nie resetuje `sync_in_progress` przy online sync
**Plik:** `src/tray.rs:381-404`

Przy online sync, `sync_in_progress` ustawiany na `true`, ale brak `SyncGuard` jak w `main.rs:129`. Jesli watek spanikuje, flaga zostaje `true` na zawsze — blokujac kolejne synci.

**Rozwiazanie:** Dodac `SyncGuard` w `tray.rs` analogicznie do `main.rs`.

---

### H-R2. Stale dane w `lan_sync_incoming.json`
**Plik:** `src/lan_sync_orchestrator.rs:396-406`

Jesli sync nie powiedzie sie i plik nie zostanie usuniety, nastepny sync moze uzyc starych danych na slave'ie w `handle_db_ready` (linia 677).

**Rozwiazanie:** Usuwac plik `lan_sync_incoming.json` w bloku `finally`/cleanup niezaleznie od wyniku synca.

---

### H-R3. Race condition — `db_frozen` z `Ordering::Relaxed`
**Plik:** `src/tracker.rs:649-673`

Tracker i sync watki dzialaja na roznych watkach. Z `Relaxed` ordering, tracker moze nie zobaczyc zmiany flagi i zapisac dane w trakcie merge'a.

**Rozwiazanie:** `Ordering::Acquire` przy odczycie, `Ordering::Release` przy zapisie.

---

### H-R4. Parsowanie calego `slave_data` jako `serde_json::Value` w pamieci
**Plik:** `src/sync_common.rs:247-678`

Przy duzych bazach, `slave_data` moze miec dziesiatki MB. Parsowanie do `serde_json::Value` podwaja zuzycie pamieci.

**Rozwiazanie:** Uzyc `serde_json::StreamDeserializer` lub parsowac po sekcjach.

---

### H-R5. Log rotation nie jest atomowa
**Plik:** `src/lan_common.rs:91-99`

Miedzy `read_to_string` a `write`, inny watek moze dopisac dane do pliku — po `write` te dane zostana utracone.

**Rozwiazanie:** Uzyc mutex lub write do pliku tymczasowego + rename.

---

## 3. Demon Rust — problemy srednie

### M-R1. Brak uwierzytelniania LAN server (BEZPIECZENSTWO)
**Plik:** `src/lan_server.rs:283-293`

Server slucha na `0.0.0.0` bez tokenow/auth. Kazde urzadzenie w sieci LAN moze:
- Wyzwolic sync (`/lan/trigger-sync`)
- Nadpisac baze danych (`/lan/push`)
- Pobrac wszystkie dane (`/lan/pull`)

**Rozwiazanie:** Dodac przynajmniej shared secret lub `device_id` verification.

---

### M-R2. `Instant::now().checked_sub()` — odwrotna intencja
**Plik:** `src/lan_discovery.rs:428-433`

`checked_sub` zwraca `None` jesli system startowal mniej niz 600s temu. Wtedy `unwrap_or(Instant::now())` powoduje, ze pierwszy scan NIE wykona sie natychmiast (odwrotnosc intencji z komentarza).

**Rozwiazanie:** Uzyc flagi `first_run: bool`.

---

### M-R3. `GetTickCount64` vs `LASTINPUTINFO.dwTime` — rozne zrodla czasu
**Plik:** `src/monitor.rs:223-225`

`dwTime` to 32-bit DWORD (overflow po ~49 dniach). Jesli system dziala >49 dni, wynik `saturating_sub` moze byc nieprawidlowy.

**Rozwiazanie:** Uzyc `GetTickCount()` (32-bit) dla spojnosci z `dwTime`, lub obsluzyc wrap-around.

---

### M-R4. Timeout 30s hardcoded w `server_post`/`server_get`
**Plik:** `src/online_sync.rs:133-141`

Przy duzych eksportach na wolnym laczu 30s moze nie wystarczyc. `ureq` timeout obejmuje caly request.

**Rozwiazanie:** Dynamiczny timeout na podstawie rozmiaru danych, lub oddzielne connect/transfer timeout.

---

### M-R5. `url_to_addr` nie obsluguje IPv6
**Plik:** `src/lan_sync_orchestrator.rs:63-71`

IPv6 adresy z portem (`[::1]:47891`) nie sa poprawnie parsowane przez `split('/')`.

---

### M-R6. Tombstone usuwanie sesji po ID numerycznym jako string
**Plik:** `src/sync_common.rs:653`

`sync_key` dla sesji to string, a `id` w SQLite to integer. Dziala dzieki type affinity, ale to kruche rozwiazanie.

---

### M-R7. `truncate_middle` podwojna iteracja po znakach
**Plik:** `src/storage.rs:49-70`

`value.chars().count()` iteruje caly string, potem `chars().collect()` robi to ponownie.

**Rozwiazanie:** Od razu `let chars: Vec<char> = value.chars().collect(); if chars.len() <= max { ... }`

---

### M-R8. Firewall rules — kasowanie i tworzenie od nowa przy kazdym starcie
**Plik:** `src/firewall.rs:77-114`

Wymaga uprawnien administratora. Jesli brak uprawnien — loguje warning, kontynuuje bez regul.

---

### M-R9. Unicast scan — 254 pakiety UDP co 30s (komentarz mowi "2 minuty")
**Plik:** `src/lan_discovery.rs:867-884`

Niespojnosc dokumentacji z kodem: `UNICAST_SCAN_INTERVAL_SECS = 30`, komentarz mowi "every 2 minutes".

---

### M-R10. FNV-1a (64-bit) zamiast kryptograficznego hasha do sync markerow
**Plik:** `src/lan_common.rs:12-19`

Kolizje sa mozliwe i moga spowodowac pominiecie synchronizacji (dwie rozne bazy = ten sam hash).

---

## 4. Demon Rust — problemy niskie

### L-R1. `VERSION` z `env!()` — brak fallbacku
**Plik:** `src/main.rs:41`

Jesli zmienna srodowiskowa `TIMEFLOW_VERSION` nie jest ustawiona w build time, kompilacja sie nie powiedzie z niejasnym bledem.

**Rozwiazanie:** `option_env!("TIMEFLOW_VERSION").unwrap_or("dev")`

---

### L-R2. `#[allow(dead_code)]` na `save_online_sync_settings`
**Plik:** `src/config.rs:212`

Funkcja przygotowana na przyszlosc, ale jeszcze nie uzywana.

---

### L-R3. Brak testow dla modulow sync
**Pliki:** `lan_sync_orchestrator.rs`, `online_sync.rs`, `sync_common.rs`, `lan_server.rs`, `lan_discovery.rs`

Zaden z tych plikow nie ma `#[cfg(test)]` modulu. Krytyczna logika synchronizacji bez pokrycia testami.

---

### L-R4. `WARNING_SHOWN: AtomicBool` bez reset
**Plik:** `src/tracker.rs:81`

Jesli `dashboard_version.txt` zniknie, flaga pozostanie `true` do restartu demona.

---

### L-R5. Podwojne uzycie `sync_state_clone`
**Plik:** `src/main.rs:131-143`

`SyncGuard` i `run_async_delta_sync` oba resetuja `sync_in_progress = false`. Nieszkodliwe, ale niespojne.

---

## 5. Dashboard — problemy krytyczne

### C-D1. `useEffectEvent` — eksperymentalne API React
**Pliki:** `BackgroundServices.tsx`, `useSessionsData.ts`, `usePageRefreshListener.ts`

`useEffectEvent` nie jest czescia stabilnego React API. Moze powodowac runtime error po aktualizacji React.

**Rozwiazanie:** Zamienic na wzorzec z `useRef` + `useCallback` (event handler ref pattern).

---

### C-D2. `any[]` w typach sync — brak type safety
**Plik:** `lib/online-sync-types.ts:25-28`

```ts
projects: any[];
applications: any[];
sessions: any[];
manual_sessions: any[];
```

Dane synchronizacji typowane jako `any[]` — ciche runtime errors przy zmianach backendu.

**Rozwiazanie:** Zdefiniowac prawidlowe typy odpowiadajace ksztaltowi danych z serwera.

---

### C-D3. Zdublowany polling LAN w Sidebar vs BackgroundServices
**Plik:** `components/layout/Sidebar.tsx:238-271`

Sidebar uruchamia polling LAN peers co 5s — niezaleznie od BackgroundServices. Efekt: zdublowane zapytania, marnowanie zasobow. Dodatkowo Sidebar zawiera ~80 linii logiki biznesowej sync.

**Rozwiazanie:** Przeniesc logike LAN sync z Sidebar do store lub BackgroundServices.

---

## 6. Dashboard — problemy wysokie

### H-D1. Duze pliki komponentow
| Plik | Linie | Problem |
|------|-------|---------|
| `pages/ProjectPage.tsx` | 1232 | Wiele odpowiedzialnosci |
| `pages/Projects.tsx` | 1134 | Typy + logika + UI |
| `pages/Help.tsx` | 1087 | 16 sekcji w jednym pliku |
| `components/dashboard/ProjectDayTimeline.tsx` | 978 | Logika + rendering |
| `pages/Sessions.tsx` | 830 | Context menu + flatten + grouping |
| `hooks/useSettingsFormState.ts` | 808 | 30+ zmiennych stanu |
| `components/sync/BackgroundServices.tsx` | 769 | 6 hookow w jednym pliku |

**Rozwiazanie:** Podzielic na mniejsze moduly wedlug odpowiedzialnosci.

---

### H-D2. Prop drilling w Settings page
**Plik:** `pages/Settings.tsx`

50+ wartosci z `useSettingsFormState` przekazywanych do podkomponentow. `OnlineSyncCard` dostaje ~30 propsow, `LanSyncCard` ~35 propsow.

**Rozwiazanie:** Kazda karta jako samodzielny komponent z wlasnym hookiem, lub React Context.

---

### H-D3. Brak loading state dla Dashboard
**Plik:** `pages/Dashboard.tsx`

Gdy `dashboardData` jest `null`, wyswietlane sa metric cards z "N/A" — wyglada jak brak danych, nie ladowanie.

**Rozwiazanie:** Dodac skeleton UI / spinner gdy dane sie laduja.

---

### H-D4. Race condition w `useSessionsData`
**Plik:** `hooks/useSessionsData.ts:68`

Jesli `buildFetchParams` zmieni sie szybko 2x, drugi fetch jest ignorowany. Uzytkownik widzi stale dane.

**Rozwiazanie:** Cancel flag pattern zamiast ignorowania nowych requestow.

---

### H-D5. Memory leak — polling bez cleanup w Sidebar
**Plik:** `components/layout/Sidebar.tsx:268`

Effect z `[]` deps nigdy sie nie odswierza. Nawet po wylaczeniu LAN, polling nadal leci co 5s.

---

### H-D6. 20 `console.log` w BackgroundServices (produkcja)
**Plik:** `components/sync/BackgroundServices.tsx`

62 wywolan `console.log/warn/error` w calym projekcie. Spowalnia UI przy czestych sync operations.

**Rozwiazanie:** Centralny logger z poziomami i kontrola wlaczania w produkcji.

---

## 7. Dashboard — problemy srednie

### M-D1. Sidebar nie jest responsywny
**Plik:** `components/layout/MainLayout.tsx:52`

Staly `ml-56` (224px). Na mniejszych ekranach brak mechanizmu zwiniecia.

---

### M-D2. Powtorzona logika context menu placement
**Pliki:** `pages/Sessions.tsx:251-277`, `components/dashboard/ProjectDayTimeline.tsx`

`resolveContextMenuPlacement` zaimplementowana osobno w obu plikach. TODO w Sessions.tsx to potwierdza.

---

### M-D3. Duplikacja logiki AI mode label
**Pliki:** `pages/AI.tsx`, `components/ai/AiModelStatusCard.tsx:38-44`, `components/layout/Sidebar.tsx:288-295`

Trzy miejsca buduja label dla AI mode niezaleznie — moga sie rozejsc.

**Rozwiazanie:** Jedna utility function `getAiModeLabel(mode, t)`.

---

### M-D4. SplashScreen przyslanania toasty
**Plik:** `App.tsx`, `components/layout/SplashScreen.tsx`

SplashScreen (`z-[9999]`, 1.3s) przyslanania toasty generowane przez BackgroundServices ktore montuje sie pod nia.

---

### M-D5. DaemonSyncOverlay — brak timeout/escape
**Plik:** `components/sync/DaemonSyncOverlay.tsx`

Fullscreen blocking overlay (`z-[9998]`) bez timeout. Jesli daemon sie zawiesi, uzytkownik jest uwieziony.

**Rozwiazanie:** Timeout 5 min + przycisk "Dismiss/Cancel".

---

### M-D6. `JSON.stringify` do porownania metryk AI
**Plik:** `pages/AI.tsx:113`

Nieefektywne i kruche (zalezne od kolejnosci kluczy). Inne miejsca robia field-by-field poprawnie.

---

### M-D7. Brak walidacji granic `suggestConf`/`autoConf` na froncie
**Plik:** `components/ai/AiSettingsForm.tsx`

HTML `min/max` nie zapobiega wpisaniu wartosci spoza zakresu. Walidacja dopiero w `handleSaveMode`.

---

### M-D8. `handleAddApp` — brak ochrony przed podwojnym kliknieciem
**Plik:** `pages/Applications.tsx:148`

Brak disabled state podczas dodawania — szybkie 2x klik moze stworzyc duplikat.

---

## 8. Dashboard — problemy niskie

### L-D1. Tlumaczenia EN/PL — zsynchronizowane
Wszystkie klucze w `en/common.json` maja odpowiedniki w `pl/common.json`. Brak brakujacych tlumaczen.

---

### L-D2. `i18n.t()` zamiast `useTranslation().t`
**Pliki:** `App.tsx:115,143,149`, `Applications.tsx:659`

Nie reaguje na zmiane jezyka w runtime — tlumaczenie nie odswieza komponentu.

---

### L-D3. ErrorBoundary bez recovery path
**Plik:** `App.tsx:122`

Jedyna opcja to `window.location.reload()`. Brak logowania bledu do backendu.

---

### L-D4. Dead code w BackgroundServices
**Plik:** `components/sync/BackgroundServices.tsx`

- `dispatchOnlineSyncDone` (linia 645) — zdefiniowane, nigdzie nie wywolywane
- `shouldRefreshAfterOnlineSync` (linia 162) — dead code po refaktorze na daemon-based sync

**Rozwiazanie:** Usunac nieuzywany kod.

---

### L-D5. Hardcoded `projectTimelineSeriesLimit = 200`
**Plik:** `pages/Dashboard.tsx:257`

Limit wewnatrz komponentu — wymaga edycji kodu zeby zmienic.

---

## 9. Brakujaca dokumentacja w Help.tsx

### 9.1 Sekcja PM — niekompletna

| Brakujacy element | Priorytet |
|-------------------|-----------|
| Zakladka Klienci (PmClientsList) — grupowanie, kolory, statystyki | Wysoki |
| Kolory klientow (Client Colors) — paleta, inline picker | Wysoki |
| Dopasowanie TF Match — laczenie projektow PM z TIMEFLOW | Wysoki |
| Filtry w PM — rok, klient, status | Sredni |
| Rozmiar folderu projektu | Niski |
| Menedzer szablonow — tworzenie, usuwanie, duplikowanie | Sredni |
| Edycja projektu (Detail dialog) — opis, budzet, deadline | Sredni |

### 9.2 Sekcja Settings — niekompletna

| Brakujacy element | Priorytet |
|-------------------|-----------|
| Zakladka PM w Settings (PmSettingsCard) — folder roboczy, szablony | Wysoki |
| DevSettingsCard — 4 kanaly logow, poziomy, przegladarka, czyszczenie | Sredni |
| Backup interval (dni) | Sredni |
| Optimize interval (godziny) | Niski |
| Data folder cleanup | Niski |
| Vacuum on startup | Niski |
| Restore database from file | Sredni |

### 9.3 Sekcja Data — niekompletna

| Brakujacy element | Priorytet |
|-------------------|-----------|
| DataStats — kafelki podsumowania (sesje, projekty, aplikacje, czas) | Niski |
| Database Health panel — rozmiar, vacuum, optymalizacja | Sredni |
| Data folder stats — rozmiar, ilosc plikow | Niski |
| Data folder cleanup — usuwanie starych plikow | Niski |

### 9.4 QuickStart — brakujace tematy

| Brakujacy element | Priorytet |
|-------------------|-----------|
| Synchronizacja LAN/Online | Sredni |
| System raportow | Sredni |
| Modul PM | Sredni |
| Kosztorysy (Estimates) | Niski |
| Analiza czasu (TimeAnalysis) — heatmapy, wykresy | Niski |
| Backup/eksport danych | Sredni |

### 9.5 Problemy i18n w Help/Settings

| Problem | Plik | Priorytet |
|---------|------|-----------|
| Hardcoded `label="PM"` zamiast `t18n()` | Help.tsx:246 | Wysoki |
| Hardcoded `label: 'PM'` | Settings.tsx:143 | Wysoki |
| `lan_sync_title` bez PL tlumaczenia (EN w obu jezykach) | locales/pl/common.json | Sredni |

---

## 10. Podsumowanie i priorytety

### Statystyki

| Kategoria | CRITICAL | HIGH | MEDIUM | LOW |
|-----------|----------|------|--------|-----|
| Demon Rust | 3 | 5 | 10 | 5 |
| Dashboard React/TS | 3 | 6 | 8 | 5 |
| Help.tsx dokumentacja | — | 4 | 8 | 6 |
| **Razem** | **6** | **15** | **26** | **16** |

### Top 10 — najwazniejsze do naprawy

| # | Problem | Typ | Priorytet |
|---|---------|-----|-----------|
| 1 | Brak auth na LAN server — kazde urzadzenie w sieci ma pelny dostep | Bezpieczenstwo | CRITICAL |
| 2 | Restore backupu przy otwartym SQLite — korupcja bazy | Logika | CRITICAL |
| 3 | UB przy zerowaniu hasel w pamieci | Bezpieczenstwo | CRITICAL |
| 4 | `useEffectEvent` — niestabilne API React | Stabilnosc | CRITICAL |
| 5 | Ciche odrzucanie duzych payloadow LAN | Utrata danych | CRITICAL |
| 6 | `any[]` w typach sync — brak type safety | Stabilnosc | CRITICAL |
| 7 | `sync_in_progress` bez SyncGuard w tray.rs | Deadlock | HIGH |
| 8 | Race condition `db_frozen` z Relaxed ordering | Utrata danych | HIGH |
| 9 | DaemonSyncOverlay bez timeout — uwiezienie UI | UX | HIGH |
| 10 | Brak testow modulow synchronizacji | Jakosc | HIGH |

### Mocne strony projektu

- Dobrze ustrukturyzowane store'y Zustand z equality checking
- Lazy loading dla wszystkich stron dashboardu
- Tlumaczenia PL/EN w 100% zsynchronizowane (klucze)
- Poprawna obsluga cancel patterns w effect hooks (Dashboard, Estimates)
- Solidna obsluga empty/error/loading states w wiekszosci stron
- Skip-to-content link + aria-label/aria-live dla accessibility
- Job pool w BackgroundServices centralizuje timery
- Kompletny modul AI z trybami, treningiem, auto-assignment, metryki i batch actions
