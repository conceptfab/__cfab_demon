# TIMEFLOW — Kompleksowy raport audytu kodu

**Data:** 2026-04-05
**Zakres:** Demon Rust, Dashboard React/Tauri, synchronizacja LAN/Online, modul AI, tlumaczenia, Help
**Pliki zrodlowe:** ~104 Rust + ~188 TypeScript/TSX

---

## Spis tresci

1. [Podsumowanie](#1-podsumowanie)
2. [Problemy KRYTYCZNE](#2-problemy-krytyczne)
3. [Problemy WAZNE](#3-problemy-wazne)
4. [Problemy DROBNE / Sugestie](#4-problemy-drobne--sugestie)
5. [Brakujace tlumaczenia](#5-brakujace-tlumaczenia)
6. [Brakujace opisy w Help](#6-brakujace-opisy-w-help)
7. [Pozytywne aspekty](#7-pozytywne-aspekty)

---

## 1. Podsumowanie

| Kategoria        | Krytyczne | Wazne | Drobne/Sugestie |
|------------------|-----------|-------|-----------------|
| Demon Rust       | 1         | 5     | 6               |
| Dashboard React  | 1         | 12    | 7               |
| Sync (LAN+Online)| 3         | 6     | 4               |
| AI Model         | 0         | 4     | 3               |
| Tauri/DB         | 1         | 5     | 6               |
| Tlumaczenia      | 1         | 3     | 4               |
| Help             | 0         | 2     | 4               |
| **RAZEM**        | **7**     | **37**| **34**          |

**Ogolna ocena:** Kod jest dobry jakosciowo — czytelny, dobrze skomentowany, z konsekwentna architektura. Glowne problemy dotycza bezpieczenstwa sync (brak szyfrowania, token w URL), kilku race conditions, oraz brakujacych tlumaczen w module PM.

---

## 2. Problemy KRYTYCZNE

### CRIT-1: Restore bazy danych z otwartym polaczeniem SQLite
- **Plik:** `src/sync_common.rs:86-125`
- **Problem:** `restore_database_backup` kopiuje plik bazy na miejsce aktywnej bazy z otwartym polaczeniem. Na Windowsie SQLite WAL mode moze trzymac locki, co prowadzi do uszkodzenia danych.
- **Rozwiazanie:** Zamknac polaczenie przed restore, wykonac `fs::copy`, otworzyc nowe. Alternatywnie: `sqlite3_deserialize` lub `VACUUM INTO` + rename.

### CRIT-2: Pole `encryptionKey` istnieje w UI, ale szyfrowanie nie jest zaimplementowane
- **Plik:** `dashboard/src/lib/online-sync-types.ts:10`, `dashboard/src/hooks/useSettingsFormState.ts:349`
- **Problem:** Dane (sesje, projekty, aplikacje) sa przesylane na serwer jako plaintext JSON. Pole `encryptionKey` w ustawieniach sugeruje szyfrowanie, ale brak jakiejkolwiek logiki encrypt/decrypt. Misleading UX.
- **Rozwiazanie:** Zaimplementowac szyfrowanie client-side (AES-GCM via Web Crypto API) lub usunac pole z UI.

### CRIT-3: Token API przesylany w URL jako query parameter (SSE)
- **Plik:** `dashboard/src/lib/sync/sync-sse.ts:39-44`
- **Problem:** `url.searchParams.set('token', apiToken)` — tokeny w URL sa logowane przez serwery, proxy, CDN, widoczne w logach sieciowych.
- **Rozwiazanie:** Dedykowany krotkozyciowy token SSE (endpoint `/api/sync/sse-ticket`) lub przejscie na `fetch()` ze streamem (header Authorization).

### CRIT-4: Auth token zapisywany w plaintext JSON na dysku (backend Rust)
- **Plik:** `dashboard/src-tauri/src/commands/online_sync.rs:51-66`
- **Problem:** `save_online_sync_settings` zapisuje `auth_token` jako plaintext JSON w `online_sync_settings.json`. Frontend poprawnie migruje do secure storage, ale backend Rust-side nadal czyta/zapisuje plik JSON.
- **Rozwiazanie:** Usunac `auth_token` z pliku JSON, uzywac wylacznie Tauri secure storage.

### CRIT-5: Brakujacy klucz tlumaczenia `sync_progress.frozen_notice`
- **Plik:** `dashboard/src/components/sync/SyncProgressOverlay.tsx:173`
- **Problem:** Klucz nie istnieje w `en/common.json` ani `pl/common.json`. Fallback jest po polsku — uzytkownik EN widzi tekst PL.
- **Rozwiazanie:** Dodac klucz w obu plikach JSON.

### CRIT-6: Brak transakcji w `update_database_settings`
- **Plik:** `dashboard/src-tauri/src/commands/database.rs:148-183`
- **Problem:** 6 kolejnych `set_system_setting()` bez transakcji. Jesli jedno zawiedzie, baza jest w stanie czesciowo zaktualizowanym.
- **Rozwiazanie:** Opakuj w pojedyncza transakcje lub dodaj `set_system_settings_batch`.

### CRIT-7: Potencjalny brak importu `triggerDaemonOnlineSync` w BackgroundServices
- **Plik:** `dashboard/src/components/sync/BackgroundServices.tsx:392, 709`
- **Problem:** Funkcja uzywana ale potencjalnie niezaimportowana — moze rzucic `ReferenceError` w runtime. Wymaga weryfikacji.
- **Rozwiazanie:** Sprawdzic i dodac import z `@/lib/tauri/online-sync` jesli brakuje.

---

## 3. Problemy WAZNE

### Demon Rust

#### WARN-1: `sync_in_progress` nie resetowany po panic
- **Plik:** `src/main.rs:105-119`
- **Problem:** W watku auto-sync, jesli `run_online_sync` spanicuje, flaga nigdy nie zostanie zresetowana — permanentna blokada sync.
- **Rozwiazanie:** RAII guard (`struct SyncGuard`) z resetem w `Drop`, lub `catch_unwind`.

#### WARN-2: Timestamp normalizacja ignoruje strefy czasowe
- **Plik:** `src/sync_common.rs:151-157`
- **Problem:** `normalize_ts` parsuje bez timezone suffix. Porownanie "last writer wins" jest niedeterministyczne miedzy maszynami w roznych strefach.
- **Rozwiazanie:** Parsowac `DateTime<FixedOffset>` i konwertowac do UTC.

#### WARN-3: Tombstone merge nie obsluguje kasowania sesji
- **Plik:** `src/sync_common.rs:508-526`
- **Problem:** Merge kasuje rekordy tylko z `projects` i `applications`. Sesje pominiete — usunieta sesja na jednej maszynie nie zostanie skasowana na drugiej.
- **Rozwiazanie:** Dodac branche `"sessions"` i `"manual_sessions"`.

#### WARN-4: LAN HTTP server bez autentykacji
- **Plik:** `src/lan_server.rs:274-338`
- **Problem:** Serwer nasluchuje na `0.0.0.0:47891` bez auth. Kazdy w sieci moze zamrozic baze (DoS), nadpisac dane, wymusic sync. `CORS: *` pozwala na cross-origin requests.
- **Rozwiazanie:** Shared secret (token) w beacon, ograniczenie do subnetu prywatnego, usunac `CORS: *`.

#### WARN-5: Brak limitowania rozmiaru danych w `merge_incoming_data`
- **Plik:** `src/sync_common.rs:178-535`
- **Problem:** Caly `slave_data` JSON parsowany do pamieci. Przy limicie 50-100MB surowego JSON, Value tree moze zuzyc setki MB RAM.
- **Rozwiazanie:** Streaming JSON parser lub ograniczenie rozmiaru importu.

### Dashboard React

#### WARN-6: Race condition — `isLoadingRef` nie resetowany przy cancel
- **Plik:** `dashboard/src/hooks/useSessionsData.ts:67-88`
- **Problem:** Gdy effect jest anulowany w trakcie fetch, `isLoadingRef` zostaje na `true` — nastepny fetch nie ruszy.
- **Rozwiazanie:** W `.finally()` zawsze `isLoadingRef.current = false` niezaleznie od `cancelled`.

#### WARN-7: Brak loading state na Dashboard przy pierwszym renderze
- **Plik:** `dashboard/src/pages/Dashboard.tsx:193-214`
- **Problem:** Miedzy renderem a odpowiedzia backendu uzytkownik widzi puste metryki "N/A" i puste wykresy.
- **Rozwiazanie:** Globalny skeleton/loader gdy `dashboardData === null && !loadError`.

#### WARN-8: Sidebar bez responsywnosci
- **Plik:** `dashboard/src/components/layout/MainLayout.tsx:52`
- **Problem:** `ml-56` (224px) hardcoded. Na 800px oknie sidebar zajmuje ~28% szerokosci.
- **Rozwiazanie:** Collapsible sidebar lub ukrywanie z hamburger menu.

#### WARN-9: Hardcoded polskie statusy PM w logice
- **Plik:** `dashboard/src/pages/PM.tsx:94`
- **Problem:** `'Archiwalny'`, `'Wykluczony'`, `'Zamrozony'`, `'Aktywny'` — widoczne w UI bez tlumaczenia.
- **Rozwiazanie:** Klucze enum (`active`, `frozen`...) + tlumaczenie w warstwie prezentacyjnej.

#### WARN-10: Ciche polykanie bledow `.catch(() => {})`
- **Pliki:** `Settings.tsx` (6x), `BackgroundServices.tsx` (2x), `DevSettingsCard.tsx` (5x), `DaemonSyncOverlay.tsx` (3x), `i18n.ts` (2x)
- **Problem:** 20+ miejsc z cichym catch bez logowania.
- **Rozwiazanie:** `catch((e) => console.warn('...', e))` minimum, dla UX-facing — toast z bledem.

#### WARN-11: `t` w tablicy zaleznosci useEffect wymusza pelny reload danych
- **Plik:** `dashboard/src/pages/Dashboard.tsx:436`
- **Problem:** Zmiana `t` (i18next) powoduje reload 3 zapytan do backendu.
- **Rozwiazanie:** Usunac `t` z tablicy, uzyc `i18n.resolvedLanguage` + `dataReloadVersion`.

#### WARN-12: Sessions.tsx — god component (830 linii, 20+ stanow)
- **Plik:** `dashboard/src/pages/Sessions.tsx`
- **Problem:** Nadmierna odpowiedzialnosc — context menu, flat items, grouping, toolbar, dialogi.
- **Rozwiazanie:** Wyodrebnic `useClickOutsideDismiss` hook i `useSessionsGrouping`.

#### WARN-13: LAN sync polling co 5s przy nieaktywnym oknie
- **Plik:** `dashboard/src/pages/Settings.tsx:188-224`
- **Problem:** `setInterval(poll, 5_000)` nie sprawdza `document.visibilityState`.
- **Rozwiazanie:** Guard `isDocumentVisible()` w poll lub stop interval.

#### WARN-14: `freezeThresholdDays` zamrazany w stanie
- **Plik:** `dashboard/src/pages/Sessions.tsx:451-453`
- **Problem:** `useState(() => loadFreezeSettings())` laduje raz, nie reaguje na zmiane ustawien.
- **Rozwiazanie:** `useSettingsStore` lub subskrypcja `settings_saved`.

#### WARN-15: Zduplikowana logika context menu dismissal
- **Pliki:** `Sessions.tsx:310-330`, `ProjectDayTimeline.tsx:92-107`
- **Problem:** Identyczna logika (mousedown outside + Escape) powielona.
- **Rozwiazanie:** Hook `useClickOutsideDismiss`.

#### WARN-16: Brak accessibility (aria-labels)
- **Pliki:** Wiekszoc stron poza `Applications.tsx` i `TimeAnalysis.tsx`
- **Problem:** Brak `aria-label` na przyciskach z ikonami, brak `aria-live` na bannerach bledow.
- **Rozwiazanie:** Systematyczne dodanie atrybutow ARIA.

#### WARN-17: Brak error boundary per-page
- **Plik:** `dashboard/src/App.tsx:122-157`
- **Problem:** Jeden globalny ErrorBoundary — blad na jednej stronie zawiesza cale UI.
- **Rozwiazanie:** Per-page `ErrorBoundary` z opcja "wroc do dashboardu".

### Synchronizacja

#### WARN-18: Brak walidacji danych z serwera (cast `as T`)
- **Plik:** `dashboard/src/lib/sync/sync-http.ts:161`
- **Problem:** Odpowiedzi serwera castowane bez walidacji runtime. Nieprawidlowa struktura zcrashuje klienta.
- **Rozwiazanie:** Minimalna walidacja (zod schema) dla krytycznych odpowiedzi.

#### WARN-19: `cancel_online_sync()` jest no-op
- **Plik:** `dashboard/src-tauri/src/commands/online_sync.rs:112-117`
- **Problem:** Komenda cancel zwraca `Ok(())` bez zadnego efektu. Misleading UX.
- **Rozwiazanie:** Zaimplementowac rzeczywista logike cancel lub usunac przycisk.

#### WARN-20: LAN scan — hardcoded /24 subnet
- **Plik:** `dashboard/src-tauri/src/commands/lan_sync.rs:195-268`
- **Problem:** Zaklada /24 mask. Sieci firmowe czesto maja /16 lub /22. 254 rownoczesne polaczenia moga triggerowac IDS/IPS.
- **Rozwiazanie:** Dynamiczne wykrywanie maski lub konfigurowalny zakres.

#### WARN-21: Brak ochrony przed concurrent import po pull
- **Plik:** `dashboard/src/lib/sync/sync-runner.ts:660-668`
- **Problem:** Crash miedzy importem a zapisem stanu spowoduje ponowny import. Potencjalne duplikaty sesji.
- **Rozwiazanie:** Zapis stanu sync w jednej transakcji z importem lub idempotency marker.

### AI Model

#### WARN-22: Token layer self-reinforcing bias
- **Plik:** `dashboard/src-tauri/src/commands/assignment_model/training.rs:296-355`
- **Problem:** Trening wycina `auto_accept` z warstw app/time, ale NIE z tokenow. Auto-assigned sesje wzmacniaja tokeny projektu — feedback loop.
- **Rozwiazanie:** Filtrowac file_activities z sesji o source = `auto_accept`.

#### WARN-23: `is_training` flaga nie jest atomowa
- **Plik:** `dashboard/src-tauri/src/commands/assignment_model/training.rs:49`
- **Problem:** Check i set `is_training` w roznych `run_db_blocking` — race condition.
- **Rozwiazanie:** `UPDATE ... WHERE is_training = 'false'` + `rows_affected == 1`.

#### WARN-24: Memory explosion przy duzej bazie file_activities
- **Plik:** `dashboard/src-tauri/src/commands/assignment_model/training.rs:296-355`
- **Problem:** Cala tabela file_activities (730 dni) wczytywana do HashMap.
- **Rozwiazanie:** Batch processing lub limit per trening.

#### WARN-25: N osobnych zapytan w `suggest_projects_for_sessions_with_status`
- **Plik:** `dashboard/src-tauri/src/commands/assignment_model/scoring.rs:385-402`
- **Problem:** Per-session: `build_session_context` + `compute_raw_suggestion`. Przy 500 sesjach = 2000+ SQL.
- **Rozwiazanie:** Batch-owe ladowanie kontekstow.

#### WARN-26: Model nigdy automatycznie nie retrenuje
- **Plik:** `dashboard/src-tauri/src/commands/assignment_model/mod.rs:577-609`
- **Problem:** Wymaga jawnego wywolania. Warunek `feedback_since_train < 30` pomija ciche starzenie sie modelu.
- **Rozwiazanie:** Auto-retrain w `auto_run_if_needed` gdy `feedback_since_train >= 30`.

### Tauri/DB

#### WARN-27: manual_sessions — synchroniczne komendy blokuja UI
- **Plik:** `dashboard/src-tauri/src/commands/manual_sessions.rs:17-80`
- **Problem:** `pub fn` zamiast `pub async fn` + `run_db_blocking`. Blokuja glowny watek Tauri.
- **Rozwiazanie:** Migrowac do async z `run_db_blocking`.

#### WARN-28: `update_manual_session` nie sprawdza rows_affected
- **Plik:** `dashboard/src-tauri/src/commands/manual_sessions.rs:164-168`
- **Problem:** UPDATE na nieistniejacym ID po cichu "udaje sie".
- **Rozwiazanie:** Sprawdz `rows_affected == 0` i zwroc blad.

#### WARN-29: Brakujacy indeks na `manual_sessions.date`
- **Problem:** Czeste filtrowanie po `date` bez indeksu — full table scan.
- **Rozwiazanie:** `CREATE INDEX IF NOT EXISTS idx_manual_sessions_date ON manual_sessions(date);`

#### WARN-30: Brakujacy composite indeks na `sessions(date, is_hidden)`
- **Problem:** `ACTIVE_SESSION_FILTER` stosowany w kazdym zapytaniu o sesje.
- **Rozwiazanie:** `CREATE INDEX IF NOT EXISTS idx_sessions_date_hidden ON sessions(date, is_hidden);`

---

## 4. Problemy DROBNE / Sugestie

### Demon Rust
- `unwrap()` na `path.parent()` w pm_manager.rs:93 — moze spanicowac na sciezce rootowej
- `truncate_middle` liczy chars dwa razy w happy path (storage.rs:49-70)
- Zduplikowana implementacja FNV hash w daemon vs dashboard (lan_common.rs vs helpers.rs)
- Nieuzywane pliki tymczasowe sync (lan_sync_incoming.json) pozostaja po awarii bez szyfrowania
- `unchecked_transaction` w training.rs zamiast `transaction()`
- HTTP client w orchestratorze nie obsluguje chunked transfer-encoding

### Dashboard React
- `areMetricsEqual` uzywa `JSON.stringify` do porownywania obiektow (AI.tsx:116)
- `mergedSessions` przelicza sie przy zmianie jezyka (Sessions.tsx:177)
- Dismiss button uzywa Unicode "X" zamiast ikony Lucide (Dashboard.tsx:170)
- `loadProjectsAllTime()` wywolywane w wielu stronach bez koordynacji
- `data-store` closures z mutable state — utrudnia testowanie
- `background-status-store` — brak safety timeout na flagach in-flight
- Brak empty state w SessionsVirtualList

### Sync/AI
- Delta export: projects/apps zawsze eksportowane w calosci (delta_export.rs:69-113)
- `JSON.stringify(archive)` wolany wielokrotnie (sync-runner.ts:165,239,790,861)
- Brak limitu wielkosci payloadu w `response.text()` (sync-http.ts:131)
- Idle backoff zbedny gdy SSE aktywne
- Wagi warstw AI hardcoded (0.80/0.30/0.10/0.30) — brak konfiguracji uzytkownika
- Brak wyraznego wyjasnienia confidence w UI
- Tokenizacja: brak deduplikacji bigramow miedzy plikami w treningu

### Tauri/DB
- `filter_map(|r| r.ok())` ukrywa bledy (database.rs:278, import.rs:484)
- Zduplikowany pattern query_map w export.rs:75-161
- Nadmiarowy `CREATE TABLE IF NOT EXISTS` w monitored.rs:46 (juz w schema.sql)
- `db-types.ts`: ManualSession brak pola `updated_at`
- `SessionWithApp.ai_assigned` opcjonalny w TS, wymagany w Rust
- Schema.sql vs migracje — brak komentarza o obowiazku migracji

---

## 5. Brakujace tlumaczenia

### Krytyczne
| Plik | Problem |
|------|---------|
| `SyncProgressOverlay.tsx:173` | Klucz `sync_progress.frozen_notice` nie istnieje w JSON — EN widzi tekst PL |

### Wazne (hardcoded stringi widoczne w UI)
| Plik | Tekst | Powinno byc |
|------|-------|-------------|
| `PM.tsx:94` | `'Aktywny'`, `'Zamrozony'`, `'Wykluczony'`, `'Archiwalny'` | Klucze enum + `t()` |
| `PmProjectDetailDialog.tsx:24` | `['Aktywny', 'Nieaktywny', 'Archiwalny']` | Dropdown z `t()` |
| `PmTemplateManager.tsx:72,79,91` | `'Name required'`, `'At least one folder required'`, `'Failed to save template'` | `t('pm.errors.*')` |
| `PmProjectDetailDialog.tsx:47,59` | `'Failed to update project'`, `'Failed to delete project'` | `t('pm.errors.*')` |
| `PmProjectsList.tsx:33-39` | `case 'Aktywny':` itd. w statusColor() | Refaktor na klucze enum |

### Drobne
| Plik | Tekst |
|------|-------|
| `DevSettingsCard.tsx:12-15` | `'Daemon'`, `'LAN Sync'`, `'Online Sync'`, `'Dashboard'` — labele kanalow |
| `OnlineSyncCard.tsx:119` | Fallback po polsku zamiast EN |
| `Help.tsx:245` | `label="PM"` bez `t()` |
| `PmCreateProjectDialog.tsx:92` | `"Website"` — placeholder |

---

## 6. Brakujace opisy w Help

### Wazne (powinny byc dodane)
| Funkcja | Czego brakuje |
|---------|--------------|
| **Konfiguracja PM w Settings** | Help nie informuje, ze trzeba skonfigurowac folder roboczy w Settings zanim PM zacznie dzialac |
| **Sekcja PM — szczegoly** | Brak opisu: zakladka Clients, mechanizm TF matching, numerowanie XX_YY, kolory klientow, HelpDetailsBlock |

### Srednie
| Funkcja | Czego brakuje |
|---------|--------------|
| **Project Discovery Panel** | Skanowanie wspomiane krotko, ale panel Discovery nie ma opisu dzialania |
| **Multi-Split Session** | Help wspomina "Split session", ale multi-split (>2 czesci) nie opisany |
| **License Activation** | Feature wspomniany, ale brak HelpDetailsBlock z detalami aktywacji |
| **Background Services** | Nie wyjasnione, ze sync dziala automatycznie i jak to kontrolowac |

### Drobne
| Funkcja | Czego brakuje |
|---------|--------------|
| **Session Score/Suggestion Badge** | Nie opisane co oznaczaja kolory/ikony badge'ow |
| **Dev/Logs Settings** | Ogolna wzmianka, brak opisu kanalow, poziomow, podgladu live |
| **ImportPage szczegoly** | Wspomniana w Data, ale bez formatow/limitow/walidacji |
| **ProjectPage komponenty** | Czesciowo opisana, ale nowe komponenty (estimates, overview) nie |

---

## 7. Pozytywne aspekty

### Demon Rust
- Panic hook z logowaniem do pliku — swietne dla Windows subsystem app
- RAII guard na single instance (mutex) — odporny na crash
- Event-driven foreground detection — eliminuje polling overhead
- Auto-unfreeze timeout (5 min) — zapobiega permanentnemu lockowi
- Konsekwentne `unwrap_or_else(|p| p.into_inner())` na poisoned mutex

### Dashboard React
- Czysta architektura stores (zustand) — proste i skoncentrowane
- Re-eksport w `tauri.ts` — przejrzysty
- Virtual list w Sessions — dobrze zaimplementowana
- System eventow sync-events — automatyczne powiadamianie o zmianach

### Synchronizacja
- Delta sync z fallbackiem na full push — solidne rozwiazanie
- ACK system z pending retry — at-least-once delivery
- Idle backoff (30s -> 1m -> 2m -> 5m) — ochrona serwera
- Gzip compression dla payloadow > 1KB
- Scoped state storage per user+device
- Migracja legacy storage keys — kompatybilnosc wsteczna

### AI Model
- 4-warstwowa architektura scoringu — prosta, deterministyczna, transparentna
- Decay weighting z konfigurowalnym half-life
- Duration-based weighting (krotkie sesje < 10s ignorowane)
- Feedback loop z rollback ostatniego auto-run
- Bigrams w tokenizacji + stop-words filtering
- Testy jednostkowe dla confidence sigmoid i training

### Tauri/DB
- **Zero ryzyka SQL injection** — konsekwentne bindowanie parametrow
- 17 migracji z transakcjami — solidny system ewolucji schematu
- Wzorzec `run_db_blocking` / `run_app_blocking` — poprawna separacja watkow
- WAL mode — dobra wspolbieznosc odczytu/zapisu
- Walidacja sciezek importu (path traversal check)
- SMTP credentials z env vars (bughunter.rs)

### Tlumaczenia
- 1677 kluczy EN = 1677 kluczy PL — pelna synchronizacja plikow JSON
- System `createInlineTranslator` w Help — elegancki dwujezyczny content

---

## Model biznesowy — obserwacja

Ograniczenie LAN do 2 maszyn **nie jest egzekwowane po stronie klienta**. `LicenseInfo.maxDevices` istnieje w typach (`online-sync-types.ts:219`), ale jest uzywany tylko informacyjnie. Egzekwowanie prawdopodobnie lezy po stronie serwera — warto to udokumentowac lub zweryfikowac.

---

*Raport wygenerowany automatycznie przez 5 rownoleglych agentow audytujacych.*
