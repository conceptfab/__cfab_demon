# Audyt logiki procesu synchronizacji online — plan

> **For agentic workers:** REQUIRED SUB-SKILL: użyj superpowers:subagent-driven-development (zalecane) lub superpowers:executing-plans do realizacji zadanie-po-zadaniu. Kroki używają checkboxów (`- [ ]`).
>
> **To jest plan AUDYTU (dochodzenie poprawności), nie buildu.** Adaptacja formatu writing-plans: zamiast „failing test → implement → pass" każde zadanie ma: pliki do prześledzenia → inwariant/pytania → metoda weryfikacji (trace + konkretny scenariusz/test) → oczekiwane zachowanie → zapis findingu do raportu. „Commit" = dopisanie findingu do raportu audytu, nie zmiana kodu produkcyjnego. Zmiany kodu (naprawy) są POZA zakresem tego planu — wynikiem jest raport.

**Goal:** Ustalić, czy algorytm synchronizacji online jest poprawny end-to-end (klient ↔ serwer ↔ klient): czy nie gubi/duplikuje/zmartwychwstaje danych, czy zbiega do spójnego stanu i czy jest idempotentny.

**Architecture:** Audyt obejmuje DWA repo. Klient (`__cfab_demon`, Rust): liczenie delty/eksportu i merge w `src/sync_common.rs` (współdzielone z LAN), orkiestracja online w `src/online_sync.rs`. Serwer (`__cfab_server`, TS): osobny merge rewizyjny w `src/lib/sync/direct-sync.ts` + ścieżki async/sesyjne. Centralna hipoteza: istnieją DWIE niezależne implementacje merge (Rust klient vs TS serwer), które muszą zbiegać do tego samego stanu — i prawdopodobnie nie zbiegają.

**Tech Stack:** Rust + rusqlite (klient), Next.js 16 + TS, storage na FS/SFTP/S3 (serwer). Testy klienta: `cargo test` (wzorce w `src/sync_common.rs` mod tests). Raport audytu: markdown.

**Zakres referencyjny:** poprzedni audyt BEZPIECZEŃSTWA serwera: `__cfab_server/audyt_synchronizacji_online_2026-06-23.md` (findings H7 resurrection, H8 nieatomowy zapis, M9 merge po kluczach naturalnych, M1 limity). Ten plan rozszerza je o pełną LOGIKĘ/konwergencję.

**Wynik:** raport `__cfab_server/audyt_logiki_sync_online_2026-06-23.md` (albo w `__cfab_demon/docs/` — do ustalenia z userem). Każde zadanie dopisuje sekcję findings.

---

## Mapa plików (co audytujemy)

**Klient — `__cfab_demon`:**
- `src/sync_common.rs` — rdzeń: `build_full_export:44`, `build_delta_export:211`, `merge_incoming_data:291`, `gc_tombstones:531`, `verify_merge_integrity:602`, `generate_marker_hash_simple:20`, `insert_sync_marker_db:26`. Testy: `mod tests` od `:816`.
- `src/online_sync.rs` — orkiestracja online: `execute_online_sync:829`, `execute_sync_steps:1057`, `execute_async_push:467`, `execute_async_pull:557`, `run_online_sync:726`, `run_async_delta_sync:674`.
- `src/lan_server.rs` — `build_table_hashes:705`, `build_delta_for_pull:1542`, `find_marker_timestamp:728`.
- `src/sync_encryption.rs` — szyfrowanie payloadu (216 linii).
- `src/config.rs` — `default_tombstone_max_age_days:120`.

**Serwer — `__cfab_server`:**
- `src/lib/sync/direct-sync.ts` — `handleDeltaPushInner` (merge), `handleStatus`, `handleDeltaPull`, `handlePush`, `handleAck`.
- `src/lib/sync/async-delta.ts` — paczki delta.
- `src/lib/sync/contracts.ts` — `TableHashes`, `DeltaData` (kształt kontraktu).
- `src/lib/sync/session-service.ts` — protokół sesyjny master/slave.

---

## Task 0: Ustal ŻYWĄ ścieżkę danych online (fundament)

**Cel:** zanim audytujemy merge, ustalić KTÓRY protokół i KTÓRY merge realnie działa end-to-end w trybie online — bo serwer ma 3 protokoły, a klient wybiera po `sync_mode`.

**Files (trace):**
- `__cfab_demon/src/online_sync.rs:726-1057` (`run_online_sync` → `execute_online_sync` → `execute_sync_steps`)
- `__cfab_demon/src/online_sync.rs:674-726` (`run_async_delta_sync`)
- `__cfab_server/src/app/api/sync/*/route.ts` (które endpointy serwera są realnie wołane)

- [ ] **Step 1: Wypisz wszystkie wywołania HTTP klienta do serwera sync**

Run (w `__cfab_demon`): `grep -n "server_post\|server_get\|/api/sync\|/sync/" src/online_sync.rs`
Zanotuj każdą parę (funkcja klienta → ścieżka serwera).

- [ ] **Step 2: Zmapuj `sync_mode` → ścieżka**

W `execute_online_sync:829` i `run_online_sync_forced:777` prześledź rozgałęzienie po `settings.sync_mode` (`"async"` vs reszta). Ustal: czy tryb domyślny używa endpointów `direct-sync` (`/api/sync/delta-push`, `/api/sync/delta-pull`, `/api/sync/status`) czy protokołu SESYJNEGO przez storage (`/api/sync/session/*` + upload do SFTP/S3).

- [ ] **Step 3: Ustal który MERGE jest autorytatywny**

Dla żywej ścieżki odpowiedz jednoznacznie: merge robi SERWER (`direct-sync.ts::handleDeltaPushInner`) czy KLIENT (`sync_common.rs::merge_incoming_data`, gdy slave ściąga zmerge'owaną bazę ze storage)? To determinuje resztę audytu.

- [ ] **Step 4: Zapisz finding T0 do raportu**

Format: „Żywa ścieżka online (sync_mode=X): klient `fn` → serwer `endpoint` → merge w `plik:fn`. Endpointy direct-sync.ts są/NIE są używane przez klienta. Implikacja: …". Jeśli `direct-sync.ts` merge jest martwy w trybie online — odnotuj (zawęża audyt serwerowego merge do dead-code).

```bash
# „commit" = dopisanie sekcji do raportu
echo "## T0 — żywa ścieżka danych" >> <raport>.md
```

---

## Task 1: Kompletność delty (klient nie gubi zmian przy eksporcie)

**Inwariant:** `build_delta_export(since)` musi zawierać KAŻDĄ zmianę od `since`: nowe/zmienione wiersze WSZYSTKICH synchronizowanych tabel + tombstony. Pominięta kolumna/encja = cicha utrata (memory: „pułapka parności migracji m24/m25 — client_name/status/clients").

**Files:**
- `__cfab_demon/src/sync_common.rs:211` (`build_delta_export`), `:44` (`build_full_export`)
- `__cfab_server/src/lib/sync/contracts.ts` (`DeltaData`, `TableHashes` — kontrakt po stronie serwera)

- [ ] **Step 1: Wylistuj kolumny każdej synchronizowanej tabeli w schemacie klienta**

Run: `grep -n "CREATE TABLE\|ALTER TABLE\|ADD COLUMN" src/*.rs | grep -iE "projects|applications|sessions|manual_sessions|clients|assignment"` — zbuduj listę kolumn per tabela (ground truth).

- [ ] **Step 2: Skonfrontuj z SELECT-ami w `build_delta_export` i `build_full_export`**

Dla każdej tabeli sprawdź, że eksport SELECT-uje wszystkie kolumny z kroku 1 (szczególnie: `client_name`, `status`, encja `clients`, `assignment_feedback`, `assignment_auto_runs`). Każda brakująca kolumna = finding.

- [ ] **Step 3: Skonfrontuj z kontraktem serwera**

Sprawdź, że `DeltaData`/`TableHashes` w `contracts.ts` zawiera te same tabele/pola. Rozbieżność klient↔serwer (np. pole eksportowane przez klienta, ignorowane przez serwer) = finding.

- [ ] **Step 4: Scenariusz weryfikacyjny (test)**

Napisz test w stylu istniejących (`merge_carries_client_name_and_status_via_export_roundtrip:1520` to wzorzec): wstaw rekord z ustawionym `client_name`/`status`, zrób `build_delta_export(since)`, zparsuj JSON, **assert że pole jest obecne i niepuste**. Powtórz dla każdej „podejrzanej" kolumny.
Run: `cargo test --lib sync_common:: -- --nocapture`

- [ ] **Step 5: Zapisz findings T1** (lista kolumn/encji pominiętych w eksporcie lub kontrakcie).

---

## Task 2: Rozbieżność merge serwer (TS) vs klient (Rust) — HEADLINE

**Inwariant:** dla tego samego wejścia oba merge muszą dać identyczny stan końcowy. Hipoteza: nie dają — serwer kolapsuje po kluczach naturalnych (lowercase name/exe), nie persystuje tombstonów, robi string-LWW; klient ma tombstone-aware LWW po `sync_key`/`uuid`.

**Files:**
- `__cfab_server/src/lib/sync/direct-sync.ts` (`handleDeltaPushInner`, merge sekcje projektów/apps/sesji/manual/assignment + tombstony)
- `__cfab_demon/src/sync_common.rs:291` (`merge_incoming_data`)

- [ ] **Step 1: Spisz reguły identyczności obu merge (tabela porównawcza)**

Dla każdej tabeli zanotuj: po jakim kluczu serwer dopasowuje wiersz vs po jakim klient. Przykłady do potwierdzenia: projects → serwer `lowercase(name)`, klient `sync_key`? applications → serwer `lowercase(executable_name)`. sessions → serwer `app_id+start_time`. To źródło rozbieżności.

- [ ] **Step 2: Spisz reguły konfliktu (LWW)**

Serwer: `String(incoming.updated_at) >= String(existing.updated_at)` (porównanie leksykalne). Klient: sprawdź w `merge_incoming_data` jak porównuje (timestamp? `merge_roundtrip_sessions_lww:2518` pokazuje oczekiwane zachowanie). Odnotuj różnicę formatu/strefy → różny zwycięzca.

- [ ] **Step 3: Spisz obsługę tombstonów**

Serwer: tombstony aplikowane i ODRZUCANE (nie persystowane) — `direct-sync.ts` sekcja tombstones. Klient: tombstony trwałe + GC po `tombstone_max_age_days` (`gc_tombstones:531`). To rdzeń resurrection (Task 3).

- [ ] **Step 4: Scenariusz różnicowy (decydujący)**

Zbuduj jedno wejście testowe (np. dwa projekty „Foo" i „foo" o różnych ścieżkach + sesja na każdym). Przepuść przez merge klienta (test Rust, wzorzec `lan_sync_simulator_delta_and_full_converge_disjoint_data:1386`). Ręcznie/skryptem przepuść to samo przez logikę `handleDeltaPushInner`. **Diff stanu końcowego.** Kolaps „Foo"+„foo" w jeden po stronie serwera, a zachowanie obu po stronie klienta = potwierdzony finding.

- [ ] **Step 5: Zapisz findings T2** — tabela rozbieżności reguł + wynik scenariusza różnicowego. Oceń wpływ na realną żywą ścieżkę z T0.

---

## Task 3: Propagacja usunięć end-to-end (brak resurrection)

**Inwariant:** usunięcie na urządzeniu A musi dotrzeć do B i C i POZOSTAĆ usunięte; nieaktualne urządzenie nie może wskrzesić rekordu.

**Files:** `__cfab_demon/src/sync_common.rs` (tombstone apply/GC + testy `applying_tombstones_does_not_mint_fresh_tombstones:2160`, `application_tombstone_spares_app_with_fresh_sessions:2098`); `__cfab_server/src/lib/sync/direct-sync.ts` (tombstony nietrwałe).

- [ ] **Step 1: Prześledź cykl tombstona w żywej ścieżce (z T0)**

A usuwa projekt → tombstone w delcie → (serwer merge dropuje wiersz, czy zapisuje tombstone?) → B pobiera → C (offline, stara baza) wraca online i pushuje deltę zawierającą skasowany rekord jako żywy.

- [ ] **Step 2: Scenariusz 3-urządzeniowy**

Symuluj A,B,C. Test/skrypt: A del X → sync. C (nie widziało del) push X → sync. **Assert: X pozostaje usunięty** (serwer/klient odrzuca wskrzeszenie po tombstonie). Jeśli wraca → finding resurrection (potwierdza H7 z audytu bezpieczeństwa, ale tu w pełnym cyklu).

- [ ] **Step 3: Tombstone GC nie kasuje przedwcześnie**

Sprawdź `gc_tombstones:531` + `compute_tombstone_gc_cutoff:553`: czy tombstone jest usuwany tylko po ACK od wszystkich peerów / po max_age, nie wcześniej (wzorzec testu `gc_deletes_only_acked_tombstones:867`). Przedwczesny GC = resurrection przy wolnym peerze.

- [ ] **Step 4: Zapisz findings T3.**

---

## Task 4: Rozstrzyganie konfliktów (LWW spójne i poprawne)

**Inwariant:** równoczesna edycja tego samego rekordu na A i B → deterministyczny, ten sam zwycięzca po obu stronach, bez gubienia „przegranej" edycji innych pól.

**Files:** `__cfab_demon/src/sync_common.rs` (testy `merge_roundtrip_applications_lww:2434`, `merge_roundtrip_sessions_lww:2518`, `merge_roundtrip_manual_sessions_lww:2623`); `__cfab_server/src/lib/sync/direct-sync.ts` (string-LWW).

- [ ] **Step 1: Ustal źródło `updated_at`**

Sprawdź format `updated_at` zapisywany przez klienta (ISO-8601 UTC? lokalny? epoch?). String-LWW serwera działa POPRAWNIE tylko dla jednolitego ISO-8601 UTC z zerowym offsetem. Mieszane formaty/strefy → błędny zwycięzca.

- [ ] **Step 2: Scenariusz konfliktu**

A i B edytują ten sam projekt; A `updated_at` nowszy. Sync. **Assert: wersja A wygrywa po obu stronach.** Następnie: ties (równy `updated_at`) — sprawdź czy polityka jest deterministyczna (serwer `>=` faworyzuje incoming; klient?). Niedeterminizm = finding.

- [ ] **Step 3: Częściowy merge pól**

Czy LWW jest per-rekord (całość przegranej ginie) czy per-pole? Jeśli per-rekord — edycja innego pola na przegranej stronie jest tracona. Odnotuj politykę i jej konsekwencje.

- [ ] **Step 4: Zapisz findings T4.**

---

## Task 5: Tożsamość i remapowanie ID (brak duplikatów/kolapsu)

**Inwariant:** ten sam logiczny rekord ma stabilną tożsamość między urządzeniami; różne rekordy się nie zlewają; klucze obce (session→app→project) pozostają spójne po merge.

**Files:** `__cfab_server/src/lib/sync/direct-sync.ts` (projectIdMap/appIdMap remap); `__cfab_demon/src/sync_common.rs:291` (merge po `sync_key`/`uuid`).

- [ ] **Step 1: Spisz model tożsamości po obu stronach**

Serwer remapuje incoming id → snapshot id po nazwie naturalnej i przepina `project_id`/`app_id` w sesjach. Klient używa `sync_key`/`uuid`. Sprawdź czy to ten sam model — rozbieżność = duplikaty lub kolaps.

- [ ] **Step 2: Scenariusz FK-spójności**

Dwa urządzenia tworzą niezależnie projekt o tej samej nazwie + sesje. Sync. **Assert: sesje wskazują na właściwy projekt; brak osieroconych `project_id`/`app_id`** (`verify_merge_integrity:602` to klient-side weryfikator — uruchom go po merge).
Run: test wołający `verify_merge_integrity` po scenariuszu.

- [ ] **Step 3: Kolaps różnych encji o tej samej nazwie**

Scenariusz: dwa różne projekty „Klient X" (różne id, ta sama nazwa). Czy serwer je zlewa (M9)? Czy klient zachowuje oba? Odnotuj.

- [ ] **Step 4: Zapisz findings T5.**

---

## Task 6: Konwergencja i idempotencja

**Inwariant:** po pełnym cyklu sync obie strony mają identyczne `table_hashes`; ponowny sync bez zmian = no-op (brak bumpa rewizji, brak ruchu danych).

**Files:** `__cfab_demon/src/sync_common.rs` (testy konwergencji `lan_sync_simulator_delta_and_full_converge_disjoint_data:1386`); `__cfab_server/src/lib/sync/direct-sync.ts` (`handleStatus` table-hash compare, noop guards); `__cfab_demon/src/lan_server.rs:705` (`build_table_hashes`).

- [ ] **Step 1: Zgodność algorytmu `table_hash` klient↔serwer**

Klient liczy `compute_table_hash` (`lan_common.rs:192`, `lan_server.rs:701`); serwer porównuje `tableHashes` z meta. Sprawdź, że oba liczą hash po tym samym zbiorze kolumn i normalizacji — inaczej `handleStatus` nigdy nie zwróci „in_sync"/„idle" → wieczne pętle sync (powiązane z auto-startem klienta).

- [ ] **Step 2: Scenariusz konwergencji**

A i B z rozłącznymi danymi → sync w obie strony → **assert: `table_hashes(A) == table_hashes(B) == server.meta.tableHashes`**.

- [ ] **Step 3: Scenariusz idempotencji**

Po konwergencji uruchom sync PONOWNIE bez zmian. **Assert: command=idle/in_sync, brak bumpa rewizji, brak zapisu snapshotu** (serwer: `noop_same_snapshot`/`noop_empty_delta`). Jeśli druga runda generuje delta/bump → finding (niestabilny hash / niedeterministyczna serializacja JSON np. kolejność kluczy).

- [ ] **Step 4: Zapisz findings T6.**

---

## Task 7: Markery / rewizje — zaawansowanie tylko po potwierdzeniu

**Inwariant:** klient przesuwa swój marker „since" / `last_client_revision` DOPIERO po potwierdzonym, trwałym merge na serwerze; nigdy przed (inaczej zmiany między starym a nowym markerem nie zostaną nigdy wysłane → cicha utrata).

**Files:** `__cfab_demon/src/online_sync.rs` (gdzie ustawiany marker/since po sync); `__cfab_demon/src/sync_common.rs:26` (`insert_sync_marker_db`); `__cfab_server/prisma` (`Device.lastClientRevision`, `SyncHead.latestRevision`).

- [ ] **Step 1: Znajdź wszystkie punkty zapisu markera/rewizji po stronie klienta**

Run: `grep -n "insert_sync_marker_db\|last_sync\|since\|revision\|marker" src/online_sync.rs`. Dla każdego ustal: czy zapis następuje PO sukcesie HTTP/merge, czy przed.

- [ ] **Step 2: Scenariusz częściowego sukcesu**

Sync, w którym push się udał, ale potwierdzenie/ack zawiodło (timeout). **Assert: marker NIE przesunięty → następny sync ponawia te zmiany** (idempotentnie, bez duplikatu — łączy się z Task 6). Jeśli marker przesunięty mimo braku ack → finding (utrata).

- [ ] **Step 3: Spójność rewizji serwera**

Sprawdź `handleAck`/`handleDeltaPush`: czy `revision` rośnie monotonicznie i czy klient poprawnie wykrywa „client_behind" gdy inne urządzenie pushnęło (handleStatus `clientRev < meta.revision`). Off-by-one = pominięty pull.

- [ ] **Step 4: Zapisz findings T7.**

---

## Task 8: Przerwanie/awaria w trakcie sync (spójność, brak torn-state)

**Inwariant:** przerwanie sync (sieć, cancel, crash) zostawia obie strony w spójnym stanie; ponowienie odzyskuje bez utraty/duplikatu.

**Files:** `__cfab_server/src/lib/sync/direct-sync.ts:217-223` (nieatomowy zapis snapshotu — H8); `__cfab_demon/src/online_sync.rs` (`request_cancel:257`, `check_timeout_and_stop:262`, cancel sesji).

- [ ] **Step 1: Punkty nieatomowości serwera**

Potwierdź H8: `writeSnapshotGz` zapisuje bez tmp+rename, a meta i snapshot to dwa osobne zapisy. Zidentyfikuj okno, w którym crash zostawia meta.revision wskazujący na NIEzapisany/uszkodzony snapshot.

- [ ] **Step 2: Scenariusz przerwania master-sync (sesyjny)**

W `execute_sync_steps` znajdź sekwencję kroków master↔slave przez storage. Przerwij między „master zapisał merged DB do storage" a „slave pobrał". **Assert: brak stanu, w którym slave nadpisuje swoją bazę częściowym/pustym plikiem.** (Powiązane: audyt bezpieczeństwa odnotował brak catch_unwind w master-sync.)

- [ ] **Step 3: Cancel w połowie**

Wywołaj `request_cancel` w trakcie. **Assert: lokalna baza klienta nietknięta do momentu kompletnego, zweryfikowanego pobrania** (apply dopiero po pełnym sukcesie). Częściowy apply = finding.

- [ ] **Step 4: Zapisz findings T8.**

---

## Task 9: Roundtrip szyfrowania/serializacji (zero utraty bajtów)

**Inwariant:** encrypt → upload → download → decrypt → parse → merge zachowuje dane bit-w-bit (UTF-8, nulle, puste stringi, duże payloady, gzip).

**Files:** `__cfab_demon/src/sync_encryption.rs`; `__cfab_server/src/lib/sync/storage-encryption.ts`; `__cfab_demon/src/online_sync.rs` (execute_async_push/pull — gdzie szyfrowanie wchodzi).

- [ ] **Step 1: Zgodność schematu szyfrowania klient↔serwer**

Sprawdź algorytm/IV/format po obu stronach (serwer: AES-256-GCM + per-session HKDF). Klient `sync_encryption.rs` — czy ten sam algorytm i kolejność (compress→encrypt vs encrypt→compress)? Niezgodność = nieczytelny payload na drugiej stronie.

- [ ] **Step 2: Scenariusz roundtrip z trudnymi danymi**

Payload z: znakami spoza ASCII (nazwy projektów PL), pustymi stringami, NULL w kolumnach nullable, dużą liczbą sesji (~50k). Roundtrip. **Assert: po decrypt+parse stan == wejście.** Gubienie nulli/escapowania = finding.

- [ ] **Step 3: Zapisz findings T9.**

---

## Task 10: Parność migracji (każda kolumna/encja w sync w 5 miejscach)

**Inwariant (memory: project_sync_migration_parity_trap):** każda kolumna/encja DB musi być w sync w 5 miejscach: eksport / UPDATE / INSERT / checksum(table_hash) / tombstony. Pominięcie = utrata przypisań + rozmergowanie.

**Files:** `__cfab_demon/src/sync_common.rs` (export + merge_incoming_data UPDATE/INSERT + tombstony); `__cfab_demon/src/lan_server.rs:705` (`build_table_hashes`); `__cfab_server/src/lib/sync/contracts.ts`.

- [ ] **Step 1: Zbuduj macierz pokrycia**

Dla KAŻDEJ synchronizowanej tabeli/kolumny (ground truth z Task 1 step 1) zaznacz obecność w: (a) `build_delta_export`/`build_full_export`, (b) UPDATE w `merge_incoming_data`, (c) INSERT w `merge_incoming_data`, (d) `build_table_hashes`, (e) obsłudze tombstonów. Pusta komórka = finding.

- [ ] **Step 2: Zweryfikuj najnowsze migracje**

Run: `grep -rn "ADD COLUMN\|CREATE TABLE\|m2[4-9]\|migration" src/*.rs | tail -30` — dla każdej kolumny dodanej w ostatnich migracjach przejdź macierz z kroku 1. Szczególnie nowe encje (clients) i flagi statusu.

- [ ] **Step 3: Checksum parity klient↔serwer**

Potwierdź, że `build_table_hashes` (klient) i to, co serwer trzyma w `meta.tableHashes`/porównuje w `handleStatus`, obejmuje ten sam zbiór kolumn. Kolumna w merge ale nie w checksumie = sync „myśli" że zsynchronizowane gdy nie jest (cicha rozbieżność).

- [ ] **Step 4: Zapisz findings T10.**

---

## Task 11: Synteza i raport końcowy

- [ ] **Step 1: Zbierz findings T0–T10**, deduplikuj, nadaj severity (Critical=utrata/duplikacja danych w żywej ścieżce, High=rozbieżność/resurrection w warunkach brzegowych, Medium=niespójność polityki, Low=teoretyczne).

- [ ] **Step 2: Tabela zbiorcza** (ID, severity, tytuł, plik:linia, scenariusz repro, oczekiwane vs faktyczne).

- [ ] **Step 3: Rekomendacja architektoniczna** — czy ujednolicić merge (jeden autorytatywny, np. zawsze klientowy `merge_incoming_data` ze współdzieleniem przez `shared::sync` — powiązane z audytem jakości 2026-06-23), czy utrzymać dwa i wymusić kontraktowe testy konwergencji w CI.

- [ ] **Step 4: Zapisz raport**, podlinkuj z audytem bezpieczeństwa (`audyt_synchronizacji_online_2026-06-23.md`).

---

## Self-review (autor planu)

- **Pokrycie spec:** „audyt logiki procesu synchronizacji online" → T0 (ścieżka), T1 (eksport), T2 (merge), T3 (usunięcia), T4 (konflikty), T5 (tożsamość), T6 (konwergencja/idempotencja), T7 (markery), T8 (awarie), T9 (szyfrowanie), T10 (parność migracji), T11 (synteza). Pełny cykl read→compute-delta→transport→merge→apply→converge pokryty.
- **Brak placeholderów:** każde zadanie ma konkretne pliki+linie, konkretne komendy grep/cargo, konkretne scenariusze z assertem i wskazaniem istniejącego testu-wzorca.
- **Spójność:** nazwy funkcji i linie wzięte z realnego grepa repo (klient) i z audytu serwera (TS). Założenie do potwierdzenia w T0: która ścieżka jest żywa — celowo postawione jako pierwsze, bo determinuje wagę reszty.
