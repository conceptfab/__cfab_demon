# Online sync: async store-and-forward (bez peer-wait) — projekt

- **Data:** 2026-06-24
- **Status:** zatwierdzony do napisania planu implementacji
- **Obszar:** `__cfab_demon` (daemon Rust + dashboard) ↔ `__cfab_server` (Next.js/Prisma/SFTP)

## 1. Problem

Obecna synchronizacja online udaje LAN sync: to 13-krokowy handshake master↔slave,
w którym **oba urządzenia muszą być online jednocześnie**. Master tworzy sesję,
czeka ~60 s na slave'a ([online_sync.rs:300](../../../src/online_sync.rs), `wait_for_peer`),
a jak nikt nie dołączy → cichy skip i zero wymiany danych. W praktyce sync prawie
nigdy nie zachodzi, bo trafienie w okno „oba online naraz" jest rzadkie. To czyni
funkcję bezużyteczną.

Serwer ma już komplet prymitywów do wymiany asynchronicznej, z których klient nie korzysta:
- `direct-sync.ts` — wersjonowany snapshot per użytkownik (`push`/`pull`/`status`/`ack`,
  optymistyczna współbieżność przez `knownServerRevision`),
- `async-delta.ts` — store-and-forward blobów na SFTP (TTL 72 h),
- SSE push (`useBackgroundSync.ts`) — serwer potrafi powiadomić urządzenie o nowych danych.

Merge jest i pozostaje **po stronie klienta** (`sync_common::merge_incoming_data` —
tombstony, content-hash, ręczne zarządzanie FK). To kod wrażliwy, którego świadomie
nie przenosimy na serwer.

## 2. Cel i kryteria sukcesu

Zamiana modelu na **asynchroniczny store-and-forward**: każde urządzenie samodzielnie,
na swoim interwale, wypycha własne zmiany i dociąga cudze — bez czekania na drugie urządzenie.

Sukces = wszystkie poniższe:
1. Brak jakiegokolwiek „czekania na peera". Sync zawsze robi coś użytecznego
   (push własnych zmian i/lub pull cudzych).
2. Urządzenie B odbiera dane urządzenia A nawet gdy A jest dawno offline.
3. **Nagrywanie czasu nie zatrzymuje się** na czas merge (patrz §6 — akceptowany swap <100 ms).
4. Przy równoczesnej edycji żaden cały push nie ginie (gwarancja CAS), dane zbiegają do unii.
5. Brak ryzyka zostawienia bazy w stanie „frozen" przy błędzie/panice.

## 3. Zatwierdzone decyzje (z brainstormingu)

| Wymiar | Decyzja |
|---|---|
| Model wymiany | **Pull co interwał** — A wypycha przy zmianie, B dociąga co N minut (SSE pozostaje jako tani bonus, nie rdzeń). |
| Zatrzymanie nagrywania | **Bezprzerwowe** — merge w tle na kopii, atomowy swap **<100 ms**. Bez dosłownego zero-ms (bez warstwy operacyjnej na gorącej ścieżce). |
| Konflikty | **Reużycie istniejącego silnika merge** (last-write-wins per encja), bez nowej warstwy detekcji konfliktów. |
| Topologia | **3+ urządzeń** na licencję — jeden wspólny blob z rewizją + CAS + mapa rewizji per urządzenie. |
| Lokalizacja merge | **Klient** (`sync_common`), bez portowania na serwer. |

## 4. Architektura

### 4.1 Serwer (`__cfab_server`) — minimalne zmiany, głównie reuse

- **Storage:** jeden snapshot per użytkownik (grupę): `data/online-sync/<userId>/{meta.json, snapshot.json.gz}`.
  `meta.json` trzyma `revision`, `payloadSha256`, `tableHashes`, `updatedAt`, `deviceId` (już istnieje).
- **Endpointy (już są w `direct-sync.ts`):**
  - `POST /sync/status` — przyjmuje `{userId, deviceId, clientRevision, clientHash, tableHashes}`,
    zwraca komendę: `idle | pull | send_full | send_delta`.
  - `POST /sync/push` — przyjmuje `{knownServerRevision, archive}`; jeśli `knownServerRevision != serverRevision`
    → odrzuca jako **stale** (CAS). Inaczej zapisuje snapshot, `revision++`, liczy `payloadSha256`.
  - `POST /sync/delta-pull` — zwraca snapshot, gdy `clientRevision < serverRevision`.
  - `POST /sync/ack` — zapisuje, że urządzenie pobrało rewizję R (źródło mapy „device → lastSeenRevision").
- **Nowa praca po stronie serwera (mała):**
  - Upewnić się, że `/sync/status` poprawnie obsługuje 3+ urządzeń (komenda liczona z porównania
    `clientRevision`/`clientHash` vs serwer; nie z obecności peera).
  - Per-device `lastSeenRevision` — odtwarzane z `ack` (rozszerzyć device registry o pole, jeśli brak).
- **Wyłączane z użycia przez klienta:** `session/create`, `session/[id]/status|report|heartbeat|cancel`,
  `peer-presence`. Endpointy mogą zostać w kodzie (kompatybilność wsteczna), ale klient ich nie woła.

### 4.2 Klient — daemon (`online_sync.rs`)

Cała maszyna stanów master/slave znika. Zastępuje ją jedna funkcja `sync_once`:

```
sync_once(device):
  s = POST /sync/status {clientRevision, clientHash, tableHashes}
  match s.command:
    idle                 -> return Done            # nic się nie zmieniło nigdzie
    pull (send_full/
          send_delta z serwera = "masz starszą") :
        snapshot = pobierz z serwera
        merge_nonblocking(snapshot)                # §6, nagrywanie trwa
        if local_hash != server_hash:              # merge dał nową unię
            goto push
        else:
            ack(serverRevision); return Done
    push:
        r = POST /sync/push {knownServerRevision=clientRevision, archive=export_local()}
        match r:
          ok(newRev)   -> zapisz clientRevision=newRev; return Done
          stale_rev    -> pull → merge → retry push   # bounded: max 3, potem backoff
```

- Zachowane: `guarded_then_cleanup` (panic-safety, [lan_sync_orchestrator]),
  exponential backoff przy błędach serwera ([config.rs](../../../src/config.rs)), bramka interwału.
- Usunięte: `wait_for_peer`, stałe `PEER_WAIT_ATTEMPTS`, role master/slave,
  `cancel_session(... "peer_no_show")`, „silent skip on no-show" (nie ma pojęcia braku peera),
  freeze całej sesji na kroki 5–13.
- `build_full_export()` / `merge_incoming_data()` z `sync_common` używane bez zmian semantyki.
  **Uwaga parności:** każda nowa kolumna/encja DB musi nadal wejść w 5 miejsc eksportu/merge/checksum
  (pułapka m24/m25) — to się nie zmienia.

### 4.3 Klient — triggery

| Trigger | Akcja | Uwaga |
|---|---|---|
| Interwał (co N min) | pełny `sync_once` | rdzeń „pull co interwał" |
| Lokalna zmiana (debounce) | `sync_once` (zwykle skończy na `push`) | tani, wypycha własne |
| Start aplikacji | `sync_once` | dociąga zaległości |
| SSE push z serwera | `sync_once` wcześniej | bonus, nie wymagany |
| Ręczny przycisk | `sync_once` z `force=true` | omija interwał/cooldown |

Wszystkie pętle dashboardu (`useJobPool`, `useBackgroundSync`) i daemon nadal wchodzą przez
jeden loopback endpoint `/online/trigger-sync` ([lan_server.rs](../../../src/lan_server.rs)), gdzie
działa wspólna bramka interwału + cooldown (eliminacja retry-storm pozostaje).

## 5. Współbieżność i konwergencja (3+ urządzeń)

- **CAS (compare-and-swap):** push musi podać rewizję bazową. Dwa równoczesne pushe z tej samej
  bazy → pierwszy wygrywa (rev N+1), drugi dostaje `stale` i musi najpierw pobrać+scalić.
  Gwarancja: **żaden cały push nie ginie**.
- **Warunek stopu (content-hash):** po merge urządzenie liczy hash swojej bazy; jeśli równy
  rewizji serwera → nie wypycha. To zatrzymuje wieczny ping-pong i wymusza konwergencję.
- **Konwergencja:** przy K urządzeniach edytujących równocześnie — najwyżej O(K) tanich,
  asynchronicznych rund; każda runda to status+pull+merge+push bez blokowania nagrywania.
- **Konflikt na encji:** wygrywa ostatni zapis (semantyka obecnego merge). Świadomie bez
  detekcji/surfacingu konfliktów (YAGNI — patrz §10).

## 6. Merge bezprzerwowy (jedyny trudny element)

Wymóg: nagrywanie nie zatrzymuje się na czas merge. Plan dla SQLite:

1. **Kopia-cień** żywej bazy przy rewizji R przez SQLite Online Backup API (`db_merge.sqlite`).
   Nagrywanie pisze dalej do żywej bazy.
2. **Watermark** przed kopią: zapamiętaj `max(rowid)`/`max(updated_at)` per istotna tabela.
3. `sync_common::merge_incoming_data(remote_snapshot)` → **do kopii-cienia**, osobne połączenie,
   `foreign_keys=OFF` (wymóg obecnego merge; sentinel `manual_sessions project_id=0` zachowany).
   Cała ciężka praca poza gorącą ścieżką.
4. **Pogodzenie okna merge:** wiersze żywej bazy ponad watermark to zapisy z czasu merge
   (zwykle czyste dopiski nagrywania). Składamy je do cienia tym samym silnikiem merge
   (operacja unii, idempotentna). W rzadkim przypadku edycji starej encji w trakcie merge —
   też obejmuje to fold unii.
5. **Atomowy swap** kopii w miejsce żywej bazy. To **<100 ms** (rename / `VACUUM INTO`), a nie
   sekundy merge'u. Pod krótką blokadą zapisu: ostatni fold świeżych wierszy (jeśli pojawiły się
   między krokiem 4 a swapem) i podmiana wskaźnika pliku.

**Uczciwy tradeoff (zapisany świadomie):** to NIE jest dosłowne zero-ms; nagrywanie blokuje się
na czas swapu (<100 ms, niewyczuwalne). Pełne zero-ms wymagałoby warstwy operacyjnej na ścieżce
nagrywania — odrzucone jako zbyt drogie/ryzykowne.

## 7. Bezpieczeństwo i obsługa błędów (zysk vs dziś)

- Merge na **kopii** → błąd/panika nie dotyka żywej bazy; nagrywanie nigdy nie zagrożone,
  brak ryzyka „frozen DB" (dziś freeze + auto-unfreeze po 20 min przy panice).
- Zachowane: `guarded_then_cleanup` (panic-safety), exponential backoff (15→300 s) przy 500.
- CAS `stale` → bounded retry (3), potem backoff.
- Serwer nieosiągalny → no-op, ponów za interwał. Zero overlay błędu, zero freeze.

## 8. Stan i ustawienia

- `online_sync_settings.json`: usunąć pola związane z rolą; zostają `enabled`, `server_url`,
  `auth_token`, `device_id`, `encryption_key`, `group_id`, `sync_interval_minutes`,
  `auto_sync_on_startup`. Sekrety plaintext bez zmian (świadoma regresja keychain).
- Stan na dysku: `online_sync_last_completed.txt` (bramka interwału), `online_sync_backoff.json`
  (cooldown). Dodać trwały `clientRevision` + `lastLocalHash` per urządzenie.

## 9. UI / Help / terminologia (wymóg CLAUDE.md)

- **Overlay:** „recording paused / frozen" (`DaemonSyncOverlay.tsx`, `SyncProgressOverlay.tsx`)
  zastąpić dyskretnym wskaźnikiem „synchronizacja…", bez komunikatu o zamrożeniu.
- **Help.tsx (w tym samym PR):** opis nowego modelu — „synchronizacja w tle, bez czekania na
  drugie urządzenie; działa nawet gdy drugie urządzenie jest offline; nagrywanie się nie
  zatrzymuje; przy równoczesnej edycji tej samej rzeczy wygrywa ostatni zapis".
- Spójna nazwa funkcji w UI / Help / logach (TIMEFLOW).

## 10. Poza zakresem (YAGNI)

- Detekcja/surfacing konfliktów (zostaje last-write-wins).
- Merge po stronie serwera / serwer jako źródło prawdy.
- Real-time live streaming zmian (dosłowny zero-ms, ciągły strumień).
- Przepisywanie silnika merge / model CRDT/oplog.
- Usuwanie endpointów sesyjnych z serwera (zostają dla kompatybilności).

## 11. Testy

1. **Roundtrip 3 urządzeń** z równoczesną edycją → zbiega do unii, zero utraty danych.
2. **Kontencja CAS:** dwa równoczesne pushe → jeden `stale`, retry; oba zestawy danych przeżywają.
3. **Zapis w trakcie merge:** nagrywanie pisze podczas merge → wiersze obecne po swapie.
4. **Content-hash stop:** brak zmian nigdzie → `status=idle`, zero pushy, zero ping-pongu.
5. **Resilience:** panika w merge → żywa baza nietknięta, nagrywanie trwa, brak frozen DB.
6. **Offline forward:** A wypycha, A offline; B (później) dociąga dane A.

## 12. Ryzyka

- **Koszt merge x2** (remote-fold + window-fold) na kopii — akceptowalny, poza gorącą ścieżką.
- **Parność migracji** (m24/m25 trap) — każda nowa kolumna nadal wymaga 5 miejsc; niezależne od tej zmiany.
- **Swap na SQLite** — rename/`VACUUM INTO` musi być atomowy względem otwartych połączeń nagrywania;
  do zweryfikowania w planie (WAL checkpoint przed swapem).
