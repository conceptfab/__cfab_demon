# Audyt logiki procesu synchronizacji online — RAPORT

| | |
|---|---|
| **Data** | 2026-06-23 |
| **Plan** | `docs/superpowers/plans/2026-06-23-online-sync-logic-audit.md` |
| **Repo klient** | `__cfab_demon` (Rust + dashboard Tauri) — commit `stable_1.6` |
| **Repo serwer** | `__cfab_server` (Next.js/TS) — commit `ea04935` |
| **Metoda** | Statyczny przegląd + 10 równoległych agentów (T0–T10), dwie fale; synteza ręczna z weryfikacją kluczowych zarzutów. Bez uruchamiania pełnego sync runtime. |
| **Powiązane** | Audyt bezpieczeństwa serwera: `__cfab_server/audyt_synchronizacji_online_2026-06-23.md` |

---

## 0. Ustalenie fundamentalne (zmienia całą interpretację)

**W trybie online merge robi KLIENT, nie serwer. Dane lecą szyfrowane przez SFTP/S3, omijając serwer aplikacyjny.**

- Klient (daemon, `src/online_sync.rs`) woła wyłącznie `/api/sync/session/*` (default `sync_mode="session"`) i `/api/sync/async/*`. **Nigdy** nie woła `/api/sync/delta-push|delta-pull|status|push|ack`.
- Serwer jest **koordynatorem kroków** (`session-service.ts`) i **ślepym relayem/blob-store** zaszyfrowanych paczek (`async-delta.ts`, `online-sync-repository.ts`). Nie deszyfruje, nie scala, nie interpretuje kolumn.
- Cały merge wykonuje klient przez `sync_common::merge_incoming_data` (= współdzielony `shared/sync/merge.rs`): master scala dane slave'a, slave scala pełny snapshot mastera, w async odbiorca scala pobraną paczkę.

**Konsekwencja dla audytu bezpieczeństwa:** serwerowy merge `direct-sync.ts::handleDeltaPushInner` (kolaps po `lowercase(name)`, string-LWW, nietrwałe tombstony → resurrection) jest **MARTWY w trybie online** — to **ryzyko latentne/regresji** (gdyby aktywowano direct-sync albo dodano klienta web), NIE czynna utrata danych w obecnym kliencie. Findings T2/T3 z planu zostały odpowiednio przeważone.

**Korekta wcześniejszego agenta:** żywy eksporter online to **`sync_common::build_delta_export`/`build_full_export`** (online_sync.rs:482/1079/1319), a NIE dashboardowy `build_delta_archive`. Ten ostatni to komenda Tauri obsługująca ręczny eksport/import pliku JSON i diagnostykę `test-roundtrip` — poza żywą ścieżką sync.

---

## 1. Streszczenie

Rdzeń logiki klienta jest **solidny**: merge jest tombstone-aware, idempotentny, LWW po znormalizowanym UTC, atomowy (transakcja + backup/restore), pokryty ~30 testami; szyfrowanie poprawne (AES-256-GCM, losowy IV per-payload, weryfikacja tagu). Realne problemy leżą na **obrzeżach żywej ścieżki**:

1. **Luki parności eksportu (cicha utrata na żywej ścieżce online).** Daemonowy eksporter pomija `assignment_feedback`, `assignment_auto_runs`, `applications.color`, `applications.is_imported`, `projects.unfreeze_reason`, `sessions.split_source_session_id`. Część z nich jest dodatkowo **niewidoczna dla checksumy**, więc sync zgłasza „done" mimo rozjazdu.
2. **Utrata przez przedwczesny marker w trybie async.** Marker push przesuwany po samym uploadzie (bez potwierdzenia odbioru) oraz współdzielony marker pull/push cofający „push-frontier" — oba gubią lokalne zmiany do następnego pełnego sync sesyjnego.
3. **Brak `catch_unwind` wokół online sync.** Panic w merge zostawia bazę zamrożoną na 20 min (auto-unfreeze) — regresja parzystości względem LAN, które ma `guarded_then_cleanup`.
4. **Bug kolumny w ścieżce ręcznego eksportu/importu.** `sessions_skipped` nie istnieje w schemacie → crash ręcznego eksportu/importu i diagnostyki test-roundtrip.

**Pozytywne sprostowania pamięci projektu:** rozbieżność checksumy SHA-256 vs FNV-1a (z audytu jakości 2026-06-23) jest **już naprawiona** — istnieje jeden współdzielony algorytm `timeflow_shared::sync::checksum`. Klientowy merge nie ma problemu resurrection (trwałe tombstony + guard).

---

## 2. Findings wg severity

### HIGH

**H-1 — `assignment_feedback` i `assignment_auto_runs` nie synchronizują się online (żywa ścieżka).**
`src/lan_server.rs:build_delta_for_pull:1560-1598` (= `sync_common::build_delta_export`/`build_full_export`) nie SELECT-uje tych tabel; `merge_incoming_data` ich nie scala; `build_table_hashes:705` ich nie hashuje. Feedback modelu przypisań i historia auto-runów **nigdy nie docierają** między urządzeniami przez online/LAN sync (mimo że serwerowy kontrakt i dashboardowy eksport pliku je znają).
*Fix:* dodać obie tabele w 5 miejscach (eksport A, merge UPDATE/INSERT, checksum, tombstony jeśli dotyczy).

**H-2 — `applications.color` i `applications.is_imported` nie konwergują i są niewidoczne dla checksumy.**
`lan_server.rs:1566` eksportuje aplikacje bez `color`/`is_imported`; `merge.rs::merge_applications:663-681` UPDATE ustawia tylko `display_name`+`project_id`, INSERT hardkoduje `is_imported=1`, `color` nigdy; `checksum.rs:39-46` ich nie hashuje. Skutek: kolor aplikacji ustawiony na maszynie A nigdy nie dotrze do B, a rozjazd jest **niewidoczny dla konwergencji** (hash równy → sync „done").
*Fix:* dodać `color`/`is_imported` do eksportu A, gałęzi UPDATE/INSERT (COALESCE dla color) i do `table_hash_sql`.

**H-3 — Async push: marker przesuwany po uploadzie, bez potwierdzenia odbioru.** `src/online_sync.rs:541-550`
`execute_async_push` wstawia marker zaraz po uploadzie do storage; `since` następnego pusha = ten marker. Jeśli peer odrzuci paczkę (`base_marker_mismatch`/`merge_failed`), zmiany z okna [poprzedni_marker, teraz] **nigdy nie wrócą do delty**. Łagodzące: projects/clients/applications eksportowane zawsze w pełni; gubione są `sessions`/`manual_sessions`/`tombstones` do następnego pełnego sync sesyjnego.
*Fix:* przesuwać marker push dopiero po potwierdzonym odbiorze/merge, albo nie wstawiać markera w push (liczyć `since` tylko z markerów po udanym pull).

**H-4 — Async: współdzielony marker pull/push cofa „push-frontier".** `src/online_sync.rs:651-663 → 479-482`
`run_async_delta_sync` robi pull przed push; pull wstawia marker `Utc::now()`. Push liczy `since` z tego świeżego markera → lokalne zmiany użytkownika sprzed pulla, jeszcze niewysłane, **wypadają z delty na zawsze**.
*Fix:* rozdzielić push-frontier od pull-frontier (osobny `marker_kind`); push liczy `since` z markera sprzed całego cyklu.

**H-5 — Brak `catch_unwind` wokół `run_online_sync` → zamrożenie bazy na 20 min przy panic.** `src/online_sync.rs:751`, `sync_trigger.rs:28`, `lan_server.rs:1244`, `main.rs:133`
Unfreeze/reset są tylko w ramieniu `Err`; panic je omija (wątek umiera z `db_frozen=true`), ratuje dopiero `AUTO_UNFREEZE_TIMEOUT=1200s`. LAN ma analogiczny `guarded_then_cleanup` (z testem na panic) — online nie. Dane bezpieczne (transakcja + poison-as-Err), złamana dostępność.
*Fix:* owinąć ciało `run_online_sync`/`_forced` w `catch_unwind` z cleanup (unfreeze + reset + cancel_session).

**H-6 — `sessions_skipped`: odwołanie do nieistniejącej kolumny → crash ręcznego eksportu/importu + diagnostyki.** `dashboard/src-tauri/src/commands/delta_export.rs:258`, `import_data.rs:587`, `types.rs:688`
Schemat `assignment_auto_runs` (schema.sql:369-383) ma `sessions_suggested`, NIE `sessions_skipped`. SELECT/INSERT z `sessions_skipped` rzuca `no such column` przy każdym `build_delta_archive`/import gdy tabela istnieje. **Zweryfikowane.** Zakres: ręczny eksport (`export_data_archive`), import (`import_data_archive`), `test-roundtrip` — NIE żywy online sync (ten używa innego eksportera).
*Fix:* `sessions_skipped` → `sessions_suggested` w delta_export.rs, import_data.rs, types.rs + mapowania.

### MEDIUM

**M-1 — Hash sesji liczy nazwę projektu z lokalnego `project_id`, ignoruje przechowaną etykietę `project_name`.** `shared/sync/checksum.rs:47-57` vs `sync_common.rs:454`
Gdy projekt nieobecny lokalnie (np. po tombstonie rodzica), sesja ma `project_id=NULL` + `project_name='X'`; hash liczy puste, peer z projektem liczy 'X' → **asymetryczny hash → wieczny re-sync**. W steady-state zbiega (projekty merge'owane przed sesjami), ryzyko trwałe tylko przy sesji-sierocie z etykietą.
*Fix:* `COALESCE((SELECT p.name ...), s.project_name, '')` w `table_hash_sql` dla sesji.

**M-2 — Inwariant konwergencji hashy nie jest pokryty żadnym testem.** `src/sync_common.rs:1376`
Testy simulatora asertują równość **wierszy** (`user_data_snapshot`), nigdy `table_hashes(A)==table_hashes(B)`. Cała idempotencja (early-return „none") wisi na równości hashy — niezweryfikowanej. M-1 mógłby cicho złamać konwergencję bez czerwonego testu.
*Fix:* dodać `assert_eq!(compute_tables_hash_string(master), …(slave))` do `assert_converged`.

**M-3 — `projects.unfreeze_reason` i `sessions.split_source_session_id` nie synchronizują się nigdzie.** (m07/m08)
Brak w eksporcie/merge/checksum/tombstonach po obu stronach. Powód odmrożenia i link sesji-dziecka→źródło są lokalne.
*Fix:* decyzja — dodać do pełnej piątki albo udokumentować jako machine-local (jak `assigned_folder_path`).

**M-4 — Zero testów roundtrip szyfrowania.** `src/sync_encryption.rs` (brak `#[cfg(test)]`)
Najwrażliwszy moduł (utrata przy każdej niezgodności bajta) bez asercji; brak cross-check wektora z serwerem TS. Każda zmiana KDF/IV/kolejności tag/gzip przejdzie cicho.
*Fix:* testy roundtrip (PL/UTF-8, puste, `\0`, ~10 MB) + wektor zgodności Rust↔TS.

**M-5 — Tombstone GC może kasować przedwcześnie w trybie online.** `src/sync_common.rs:531-585`, `config.rs:120`
ACK-gate GC bierze peerów z `lan_pairing`, nie z urządzeń online serwera; w czystym deployi online lista par jest pusta → GC kasuje tombstony po samym wieku (90 dni — pamięć mówiła 120). Połączone z brakiem propagacji tombstonów przez serwer (gdyby direct-sync) → wektor resurrection.
*Fix:* w trybie online użyć listy urządzeń serwera jako zbioru ACK; docelowo tombstony trwałe po stronie autorytatywnej.

### LOW

**L-1 — `decrypt_credentials` bez walidacji długości IV → panic.** `src/sync_encryption.rs:67-69,97` (`make_nonce` panikuje przy `len != 12`; `decrypt_file_data` ma guard, credentials nie).
**L-2 — Brak guardu semantycznej niepustości pobranego snapshotu przed apply.** `src/online_sync.rs:1138` (kryptograficznie i strukturalnie OK; pusty `{"data":{}}` przeszedłby jako „zsynchronizowano").
**L-3 — Granica `since` jest `>=` (inclusive) — bezpieczna; realne ryzyko to timezone/clock-skew** między markerem (UTC) a `updated_at` wierszy (do potwierdzenia źródło). Nie off-by-one operatora.

### LATENTNE (martwy kod serwera — ryzyko regresji, NIE czynna utrata online)

`direct-sync.ts::handleDeltaPushInner` rozjeżdża się z klientem w 8 wymiarach: kolaps encji po `lowercase(name/executable_name)`, projekty/apps nadpisywane bezwarunkowo (last-push-wins, brak LWW), string-LWW bez normalizacji strefy (błędny zwycięzca), przeciwna polityka remisu, `clients` nieobecne w kontrakcie, manual_sessions po `sync_key` vs `(title,start_time)`, **tombstony nietrwałe → resurrection**, assignment_* jednostronne. Aktywne tylko jeśli klient zacznie wołać direct-sync delta-push lub dojdzie klient web.
*Rekomendacja:* albo usunąć/oznaczyć jako dead-code, albo (jeśli ma ożyć) przepisać 1:1 wg reguł klienta + kontraktowy test konwergencji w CI. **Do tego czasu nie aktywować direct-sync dla żadnego klienta produkcyjnego.**

---

## 3. Macierz parności (skrót — pełna w findings T10)

Kolumny gubione **na żywej ścieżce online (daemon)**: `applications.color`, `applications.is_imported`, `assignment_feedback.*`, `assignment_auto_runs.*`, `projects.unfreeze_reason`, `sessions.split_source_session_id`.
Gubione **zależnie od ścieżki** (ręczny eksport B vs żywy online A): `manual_sessions.project_name` (brak w B); `assignment_*`/`file_activities` (tylko w B, a B zepsuty bugiem H-6).
Niespójność kontraktu serwera (D): brak encji `clients` w `contracts.ts` (kosmetyczne — serwer i tak nie scala; `clients` synchronizują się poprawnie klient↔klient).

**Root cause przekrojowy:** trzy niezależne, ad-hoc utrzymywane listy kolumn (eksporter daemona, eksporter dashboardu, kontrakt serwera) zamiast jednego źródła. To „pułapka parności migracji" przeniesiona z poziomu jednej bazy na poziom trzech definicji.

---

## 4. Co działa dobrze (zweryfikowane)

- **Klientowy merge** (`merge_incoming_data` / `shared/sync/merge.rs`): tombstone-aware, trwałe tombstony + guard `local_tombstone_covers` (brak resurrection), LWW po `normalize_ts` UTC, atomowy (transakcja + backup→merge→verify→restore-on-error), ~30 testów (LWW/tombstone/konwergencja/simulator).
- **Checksum ujednolicony** — jeden `timeflow_shared::sync::checksum`; rozbieżność SHA-256/FNV-1a z pamięci jest **naprawiona** (nieaktualna).
- **Kryptografia**: AES-256-GCM, IV 12B losowy per-payload (brak nonce reuse), HKDF per-purpose, weryfikacja tagu, bezpieczna obsługa błędu decrypt (nie nadpisuje bazy śmieciem), klucz/algorytm spójny klient↔serwer (credentials) i klient↔klient (plik).
- **Serwer = ślepy relay/blob-store** — nigdy nie widzi plaintextu danych, więc błędy serwerowego merge nie dotykają żywych danych.
- **Async fallback**: `base_marker_mismatch` przełącza na pełny sync sesyjny (konwergujący).

---

## 5. Priorytety naprawcze

1. **Domknąć parność eksportu na żywej ścieżce (H-1, H-2, M-3):** `assignment_feedback`/`assignment_auto_runs` + `applications.color`/`is_imported` w eksporcie daemona + merge + checksum; decyzja o `unfreeze_reason`/`split_source_session_id`. Docelowo: jedno źródło listy kolumn dla wszystkich eksporterów.
2. **Naprawić frontier markerów async (H-3, H-4):** rozdzielić push/pull frontier; push-marker tylko po potwierdzonym odbiorze.
3. **`catch_unwind` + cleanup wokół online sync (H-5)** — parzystość z LAN.
4. **Fix `sessions_skipped`→`sessions_suggested` (H-6)** — odblokowuje ręczny eksport/import + diagnostykę.
5. **Symetria i pokrycie hashy (M-1, M-2):** `COALESCE` etykiety projektu w hashu sesji + test asercji konwergencji hashy.
6. **Testy roundtrip szyfrowania + guard IV (M-4, L-1).**
7. **Latentne:** rozstrzygnąć los serwerowego `direct-sync.ts` (usunąć vs przepisać wg reguł klienta + CI). Nie aktywować direct-sync produkcyjnie.

---

*Audyt statyczny; scenariusze repro opisane przy findings. Brak zmian w kodzie produkcyjnym (poza wdrożonym osobno fixem „respektuj 30 min" w dashboardzie, niezwiązanym z logiką merge).*
