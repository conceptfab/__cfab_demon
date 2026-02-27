# API Synchronizacji Online (kontrakt klienta)

Ten dokument opisuje, czego klient TimeFlow oczekuje od serwera synchronizacji.
Cel: szybka weryfikacja, czy backend obsluguje pelny przeplyw i nie gubi zmian
(w tym boosty, komentarze i manual sessions).

## Zakres i zalozenia

- Tryb docelowy: tylko sync chmurowy (bez trybu awaryjnego po stronie klienta).
- Model danych: klient wysyla/pobiera pelny snapshot (`archive`), nie diff.
- Transport: HTTP `POST` + JSON.
- Klient wysyla naglowek `Authorization: Bearer <token>` tylko gdy token jest ustawiony.
- Kazda odpowiedz endpointu sync musi byc poprawnym JSON.

## Kontrakt transportowy

- `Content-Type` requestu: `application/json`.
- Status HTTP poza `2xx`: traktowany jako blad.
- `2xx` z niepoprawnym JSON: traktowany jako blad.
- Timeout requestu: konfigurowalny, po stronie klienta clamp `3000..60000 ms` (domyslnie `15000 ms`).
- Dla `/api/sync/ack` timeout jest clampowany do `5000..10000 ms` i jest retry:
  - max `3` proby,
  - retry tylko dla: timeout, network error, HTTP `>=500`,
  - backoff: `250 ms * nr_proby`.

## Obowiazkowe endpointy

### 1) `POST /api/sync/status`

Request:

```json
{
  "userId": "string",
  "deviceId": "string",
  "clientRevision": 123,
  "clientHash": "sha256hex-or-null"
}
```

Uwagi:
- `clientRevision` moze byc `null`.
- `clientHash` moze byc `null`.

Response:

```json
{
  "ok": true,
  "serverRevision": 124,
  "serverHash": "sha256hex-or-null",
  "shouldPush": false,
  "shouldPull": true,
  "reason": "string"
}
```

Wymagania:
- `shouldPush` i `shouldPull` musza byc jawnie zwracane jako boolean.
- Klient najpierw sprawdza `shouldPull`; jesli oba beda `true`, wykona sciezke pull.
- Specjalny `reason` rozpoznawany przez klienta:
  - `server_snapshot_pruned` -> uruchamia reseed (push lokalnego snapshotu, jesli mozliwy),
  - `same_hash`,
  - `same_revision_hash_not_provided`.

### 2) `POST /api/sync/pull`

Request:

```json
{
  "userId": "string",
  "deviceId": "string",
  "clientRevision": 123
}
```

Response:

```json
{
  "ok": true,
  "hasUpdate": true,
  "revision": 124,
  "payloadSha256": "sha256hex",
  "receivedAt": "2026-02-27T12:34:56.000Z",
  "archive": {},
  "reason": "string"
}
```

Wymagania:
- Gdy `hasUpdate=true`, odpowiedz musi zawierac:
  - `archive`,
  - `revision` (nie `null`),
  - `payloadSha256` (nie `null`).
- `reason=server_snapshot_pruned` musi byc obslugiwany (klient przejdzie do reseed).
- Po udanym `pull` klient importuje `archive` i natychmiast wysyla `/ack`.

### 3) `POST /api/sync/push`

Request:

```json
{
  "userId": "string",
  "deviceId": "string",
  "knownServerRevision": 124,
  "archive": {}
}
```

Uwagi:
- `knownServerRevision` moze byc `null`.
- `archive` to pelny snapshot danych lokalnych.

Response:

```json
{
  "ok": true,
  "accepted": true,
  "noOp": false,
  "revision": 125,
  "payloadSha256": "sha256hex",
  "receivedAt": "2026-02-27T12:35:30.000Z",
  "reason": "string"
}
```

Wymagania:
- `accepted === false` jest przez klienta traktowane jako twarde odrzucenie push.
- Pole `accepted` jest opcjonalne w kliencie (brak = traktowane jako accepted).
- `revision` i `payloadSha256` sa po push autorytatywne i aktualizuja lokalny stan klienta.

### 4) `POST /api/sync/ack`

Request:

```json
{
  "userId": "string",
  "deviceId": "string",
  "revision": 124,
  "payloadSha256": "sha256hex"
}
```

Response:

```json
{
  "ok": true,
  "accepted": true,
  "revision": 124,
  "payloadSha256": "sha256hex",
  "serverRevision": 124,
  "serverHash": "sha256hex-or-null",
  "isLatest": true,
  "reason": "string"
}
```

Wymagania:
- Gdy `accepted=true`, klient usuwa `pendingAck`.
- Gdy `accepted=false` i `reason` to:
  - `unknown_revision` albo
  - `hash_mismatch_for_revision`
  klient rowniez usuwa `pendingAck` (nie retryuje bez konca).
- Dla innych odrzucen ACK klient traktuje to jako blad i zostawia `pendingAck`.

## Format `archive` (snapshot)

Minimalny ksztalt:

```json
{
  "version": "string",
  "exported_at": "ISO datetime",
  "machine_id": "string",
  "export_type": "single_project | all_data",
  "date_range": {},
  "metadata": {
    "total_sessions": 0,
    "total_seconds": 0
  },
  "data": {
    "projects": [],
    "applications": [],
    "sessions": [],
    "manual_sessions": [],
    "daily_files": {},
    "tombstones": []
  }
}
```

Dla Twojego case (brak sync boostow/komentarzy/manual):
- boosty siedza w `data.sessions[].rate_multiplier`,
- komentarze siedza w `data.sessions[].comment`,
- reczne sesje siedza w `data.manual_sessions[]`.

Jesli backend nie zapisuje/nie zwraca tych pol 1:1, beda znikac po syncu.

## Weryfikacja serwera - checklista

1. `status` zwraca stabilnie `shouldPull/shouldPush` i poprawny `serverRevision`.
2. `pull(hasUpdate=true)` zawsze zwraca komplet: `archive + revision + payloadSha256`.
3. `push` zwraca nowe `revision` i `payloadSha256`, a nie stale wartosci.
4. `ack` zwraca `accepted`, `isLatest`, `serverRevision`, `serverHash`.
5. Round-trip danych:
   - Klient A dodaje sesje z `rate_multiplier != 1` i `comment`.
   - Klient A dodaje `manual_session`.
   - Klient B robi sync i musi dostac te pola bez utraty.
6. Przypadek `server_snapshot_pruned`:
   - Serwer zwraca ten `reason` na `status` lub `pull`.
   - Po push reseed serwer wraca do normalnego przeplywu.

## Przykladowe payloady do testow recznych (curl)

```bash
curl -X POST "$SERVER/api/sync/status" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "userId":"u1",
    "deviceId":"dev-a",
    "clientRevision":12,
    "clientHash":"abc123"
  }'
```

```bash
curl -X POST "$SERVER/api/sync/pull" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "userId":"u1",
    "deviceId":"dev-b",
    "clientRevision":12
  }'
```

```bash
curl -X POST "$SERVER/api/sync/push" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "userId":"u1",
    "deviceId":"dev-a",
    "knownServerRevision":12,
    "archive": { "version":"x", "exported_at":"...", "machine_id":"...", "export_type":"all_data", "date_range":{}, "metadata":{"total_sessions":0,"total_seconds":0}, "data":{"projects":[],"applications":[],"sessions":[],"manual_sessions":[],"daily_files":{}} }
  }'
```

```bash
curl -X POST "$SERVER/api/sync/ack" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "userId":"u1",
    "deviceId":"dev-b",
    "revision":13,
    "payloadSha256":"..."
  }'
```

## Zrodlo kontraktu

- `dashboard/src/lib/online-sync.ts`
- `dashboard/src/lib/db-types.ts` (`ExportArchive`)

