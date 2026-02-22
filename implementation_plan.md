# Implementation Plan: Online Sync (Status / Push / Pull)

## Cel

Wdrozyc MVP synchronizacji danych `offline-first` dla dashboardu:

- klient po starcie sprawdza status serwera,
- jesli lokalne dane sa nowsze -> wysyla paczke (`push`),
- jesli serwer ma nowsze dane -> klient pobiera (`pull`),
- drugi klient po zalogowaniu widzi, ze sa nowe dane i pobiera najnowsza paczke.

## Architektura (MVP)

- Serwer: osobny projekt Next.js (`__cfab_server`) z endpointami API.
- Magazyn danych: prosty plik JSON na serwerze (MVP lokalny/dev).
- Jednostka synchronizacji: snapshot calej paczki eksportu (`ExportArchive`) z dashboardu.
- Wersjonowanie: `revision` (numer rosnacy per user) + `payloadSha256`.
- Kluczowanie: `userId` + `deviceId` (na razie przekazywane w request body; auth docelowo).

## Kontrakty API (MVP)

- `POST /api/sync/status`
  - wejscie: `userId`, `deviceId`, `clientRevision?`, `clientHash?`
  - wyjscie: stan serwera + rekomendacja `push`/`pull`
- `POST /api/sync/push`
  - wejscie: `userId`, `deviceId`, `archive`, `knownServerRevision?`
  - wyjscie: zapisany snapshot / no-op (jesli hash bez zmian)
- `POST /api/sync/pull`
  - wejscie: `userId`, `deviceId`, `clientRevision?`
  - wyjscie: najnowszy snapshot jesli serwer ma nowszy

## Etapy

- [x] Analiza obecnego stanu repo i `__cfab_server`
- [x] Potwierdzenie formatu paczki eksportu (`ExportArchive`) w dashboardzie
- [x] Przygotowanie planu i checklisty postepu
- [x] MVP serwera: storage plikowy (revision/hash/metadata + snapshot)
- [x] MVP serwera: endpoint `status`
- [x] MVP serwera: endpoint `push`
- [x] MVP serwera: endpoint `pull`
- [x] Dokumentacja API i instrukcja testu recznego
- [x] Klient backend (Tauri): headless komendy `export/import` archiwum do sync
- [x] Klient dashboard (Tauri): check status przy starcie (MVP)
- [x] Klient dashboard (Tauri): push/pull + import/export automatyczny (MVP)
- [x] UI ustawien sync (server URL / userId / enable)
- [ ] Auth + bezpieczenstwo (token/logowanie)
- [ ] Szyfrowanie (wariant do decyzji: server-side vs E2E)

## Uwagi projektowe

- Prosty flagowy status "sa nowe dane" nie wystarcza przy wielu urzadzeniach.
- MVP uzywa bezpieczniejszego modelu:
  - `revision` (monotoniczny per user)
  - `payloadSha256` (wykrycie no-op)
  - `deviceId` (zrodlo snapshotu)
- W produkcji storage plikowy trzeba zastapic baza + object storage.

## Progress Log

- 2026-02-22: Rozpoczeto implementacje MVP serwera sync w `__cfab_server` (storage + endpointy `status/push/pull`).
- 2026-02-22: Dodano plikowy storage `data/sync-store.json` (MVP dev) oraz endpointy:
  - `POST /api/sync/status`
  - `POST /api/sync/push`
  - `POST /api/sync/pull`
- 2026-02-22: `npm run lint` w `__cfab_server` przechodzi bez bledow.
- 2026-02-22: Dodano komendy Tauri pod auto-sync bez dialogow:
  - `export_data_archive` (zwraca `ExportArchive`)
  - `import_data_archive` (import z obiektu archiwum)
- 2026-02-22: Dodano klientowy flow sync (MVP) w dashboardzie:
  - startup sync po `AutoImporter`
  - `status -> pull` (gdy serwer ma nowsze dane)
  - `status -> push` (gdy brak potrzeby pull; serwer deduplikuje po hash)
- 2026-02-22: Walidacja klienta:
  - `cargo check` dla `dashboard/src-tauri` OK
  - `tsc -b` dla `dashboard` OK
  - `eslint` dla zmienionych plikow OK
- 2026-02-22: Dodano UI ustawien sync (MVP) w `Settings`:
  - `Enable online sync`
  - `Sync on startup`
  - `Server URL`
  - `User ID`
  - podglad `Device ID`
- 2026-02-22: Rozszerzono UI sync w `Settings`:
  - przycisk `Sync now` (manualny sync z pominięciem opcji "Sync on startup")
  - status ostatniej udanej synchronizacji/sprawdzenia (`lastSyncAt`)
  - podglad ostatniego `serverRevision` i hash
- 2026-02-22: Dodano status sync w TopBar:
  - badge (`Sync Off`, `Syncing...`, `Sync OK`, `Sync Error`, itp.)
  - krotki opis po prawej (`last sync`, revision, hash / blad)

## Konfiguracja tymczasowa klienta (MVP)

Klient przechowuje konfiguracje sync w `localStorage` pod kluczem:

- `cfab.settings.online-sync`

Przyklad:

```json
{
  "enabled": true,
  "autoSyncOnStartup": true,
  "serverUrl": "https://cfabserver-production.up.railway.app",
  "userId": "demo-user"
}
```

Uwagi:

- Domyslnie ustawiany jest URL Railway: `https://cfabserver-production.up.railway.app`, ale mozna go zmienic w `Settings`.
- `deviceId` generuje sie automatycznie i zostaje zapisany w tym samym obiekcie.
- Lokalny stan synchronizacji (ostatni `serverRevision` / `serverHash`) trzymany jest pod kluczem `cfab.sync.state`.

## Test reczny (MVP)

Uruchom serwer:

```bash
cd __cfab_server
npm run dev
```

1. Sprawdz status (brak danych na serwerze):

```bash
curl -X POST http://localhost:3000/api/sync/status ^
  -H "Content-Type: application/json" ^
  -d "{\"userId\":\"demo-user\",\"deviceId\":\"laptop-a\",\"clientRevision\":0}"
```

Oczekiwane: `hasServerData=false`, `shouldPush=true`.

2. Push snapshotu (uzyj paczki zgodnej z `ExportArchive`):

```bash
curl -X POST http://localhost:3000/api/sync/push ^
  -H "Content-Type: application/json" ^
  -d @sample-push.json
```

`sample-push.json` powinien zawierac:

```json
{
  "userId": "demo-user",
  "deviceId": "laptop-a",
  "archive": {
    "version": "1.1",
    "exported_at": "2026-02-22T10:00:00Z",
    "machine_id": "laptop-a",
    "export_type": "all_data",
    "date_range": { "start": "2026-02-01", "end": "2026-02-22" },
    "metadata": { "project_id": null, "project_name": null, "total_sessions": 0, "total_seconds": 0 },
    "data": { "projects": [], "applications": [], "sessions": [], "manual_sessions": [], "daily_files": {} }
  }
}
```

3. Drugi klient sprawdza status:

```bash
curl -X POST http://localhost:3000/api/sync/status ^
  -H "Content-Type: application/json" ^
  -d "{\"userId\":\"demo-user\",\"deviceId\":\"laptop-b\",\"clientRevision\":0}"
```

Oczekiwane: `shouldPull=true`, `serverRevision>=1`.

4. Drugi klient pobiera snapshot:

```bash
curl -X POST http://localhost:3000/api/sync/pull ^
  -H "Content-Type: application/json" ^
  -d "{\"userId\":\"demo-user\",\"deviceId\":\"laptop-b\",\"clientRevision\":0}"
```

Oczekiwane: `hasUpdate=true` i `archive` z danymi.
