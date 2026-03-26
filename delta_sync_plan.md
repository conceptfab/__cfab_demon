# Plan: Delta Sync z weryfikacją hashami

## Problem

Sync wysyła **cały snapshot bazy (~5MB)** za każdym razem, nawet przy 0 zmian. To powoduje `Failed to fetch` (Railway body limit) i marnuje bandwidth.

## Podejście

**Delta sync z timestamp diff** — wysyłamy tylko rekordy zmienione od ostatniego synca. Full snapshot tylko przy pierwszym syncu lub reseedzie.

---

## Stan obecny

### Klient (Tauri/Rust + Dashboard TS)

| Tabela | `updated_at` | Auto-trigger | Tombstone |
|--------|:---:|:---:|:---:|
| `projects` | ✅ | ✅ | ✅ |
| `sessions` | ✅ | ✅ | ❌ |
| `manual_sessions` | ✅ | ✅ | ✅ |
| `applications` | ❌ | ❌ | ❌ |

- `export.rs` — buduje pełny `ExportArchive` (all data)
- `sync-runner.ts` — wysyła cały archive na push

### Serwer (Next.js + Prisma + PostgreSQL)

- `service.ts` — logika push/pull/status/ack
- `contracts.ts` — typy request/response
- `schema.prisma` — `SyncSnapshot.archiveJson` przechowuje pełny JSON

Serwer przechowuje **pełne snapshoty** w `SyncSnapshot`, porównuje hash payloadu, i prune'uje archiva po ACK od wszystkich urządzeń.

---

## Faza 1: Migracja bazy klienta

### [NEW] Nowa migracja Rust

```sql
-- applications: dodaj updated_at
ALTER TABLE applications ADD COLUMN updated_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00';
UPDATE applications SET updated_at = datetime('now');

CREATE TRIGGER IF NOT EXISTS trg_applications_updated_at
AFTER UPDATE OF executable_name, display_name, project_id, is_imported
ON applications
FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE applications SET updated_at = datetime('now') WHERE id = OLD.id;
END;

-- Tombstones dla sessions i applications
CREATE TRIGGER IF NOT EXISTS trg_sessions_tombstone
AFTER DELETE ON sessions FOR EACH ROW
BEGIN
    INSERT INTO tombstones (table_name, record_id, sync_key)
    VALUES ('sessions', OLD.id, OLD.app_id || '|' || OLD.start_time);
END;

CREATE TRIGGER IF NOT EXISTS trg_applications_tombstone
AFTER DELETE ON applications FOR EACH ROW
BEGIN
    INSERT INTO tombstones (table_name, record_id, sync_key)
    VALUES ('applications', OLD.id, OLD.executable_name);
END;
```

---

## Faza 2: Nowy Tauri command — `export_data_delta`

### [NEW] `delta_export.rs`

Nowy command zwracający tylko rekordy zmienione od `since`:

```rust
struct DeltaArchive {
    version: String,           // "2.0-delta"
    since: String,             // ISO timestamp
    is_full: bool,             // true = fallback full snapshot
    table_hashes: TableHashes, // hash per tabela (deterministyczny)
    data: DeltaData,           // tylko zmienione rekordy
}

struct TableHashes {
    projects: String,       // SHA256(sorted id|updated_at)
    applications: String,
    sessions: String,
    manual_sessions: String,
}

struct DeltaData {
    projects: Vec<Project>,
    applications: Vec<Application>,
    sessions: Vec<Session>,
    manual_sessions: Vec<ManualSession>,
    tombstones: Vec<Tombstone>,     // WHERE deleted_at > since
    // daily_files pominięte w delta
}
```

**Filtrowanie:** `SELECT * FROM sessions WHERE updated_at > ?since`

**Obliczanie hashy:**
```sql
SELECT group_concat(id || '|' || updated_at, ';') 
FROM (SELECT id, updated_at FROM sessions ORDER BY id)
```
Następnie SHA256 z wyniku. Deterministyczne (sorted by id).

---

## Faza 3: Zmiany serwera

### [MODIFY] `contracts.ts`

Nowe body/response:
```typescript
interface SyncDeltaPushBody {
    userId?: string;
    deviceId: string;
    delta: DeltaData;      // tylko zmienione rekordy
    tableHashes: TableHashes;
    baseRevision: number;  // rewizja od której delta
}

interface SyncDeltaPushResponse {
    ok: true;
    accepted: boolean;
    revision: number;
    serverTableHashes: TableHashes;
    reason: string;
}
```

Rozszerzenie `SyncStatusBody` o opcjonalne `tableHashes`:
```typescript
interface SyncStatusBody {
    // ... istniejące pola
    tableHashes?: TableHashes;    // NOWE
}
```

### [MODIFY] `service.ts`

Nowa funkcja `pushDelta`:
1. Pobierz aktualny snapshot z DB
2. Rozpakuj `archiveJson` → merge z deltą klienta (upsert + apply tombstones)
3. Oblicz nowy `payloadSha256` ze zmergowanego archiwum
4. Zapisz jako nowy snapshot
5. Porównaj `tableHashes` — jeśli zgadzają się → OK, jeśli nie → zwróć delta pull

Modyfikacja `getSyncStatus`:
- Jeśli request zawiera `tableHashes` → porównaj z serwerowymi hashami per table
- Zwróć `dirtyTables: string[]` w response

### [NEW] Nowy endpoint `POST /api/sync/delta-push`
### [NEW] Nowy endpoint `POST /api/sync/delta-pull`

### [MODIFY] `schema.prisma`

Dodaj `tableHashes` do `SyncSnapshot`:
```prisma
model SyncSnapshot {
    // ... istniejące pola
    tableHashesJson  Json?    @map("table_hashes_json")
}
```

---

## Faza 4: Zmiana sync-runner klienta

### [MODIFY] `sync-runner.ts`

Nowy flow:

```
1. Export tableHashes (szybkie — tylko hash query, bez danych)
2. Status check → wysyła tableHashes
3. Serwer odpowiada:
   a. Hashe identyczne → DONE (0 transferu)
   b. needs_push → export delta (rekordy od lastSyncAt) → POST /delta-push
   c. needs_pull → POST /delta-pull → import delta
4. Fallback: jeśli serverRevision=0 → full push jak dotychczas
```

### [MODIFY] `sync-state.ts`

Dodaj `lastSuccessfulSyncAt: string | null` do persisted state.

### [MODIFY] `online-sync-types.ts`

Nowe interfejsy: `DeltaArchive`, `TableHashes`, `DeltaData`.

---

## Oczekiwany efekt

| Scenariusz | Payload przed | Payload po |
|------------|:---:|:---:|
| 0 zmian | ~5126 KB | **0 KB** (hash match) |
| 1 nowa sesja | ~5126 KB | **~1 KB** |
| 10 zmian | ~5126 KB | **~5-10 KB** |
| Pierwszy sync / reseed | ~5126 KB | ~5126 KB |

---

## Kolejność implementacji

| Faza | Zakres | Zależności |
|------|--------|-----------|
| 1. Migracja bazy | Klient (Rust) | Brak |
| 2. `export_data_delta` | Klient (Rust) | Faza 1 |
| 3. Serwer delta endpointy | Serwer (TS) | Faza 2 potrzebna do testów |
| 4. sync-runner delta-first | Klient (TS) | Faza 3 |

> Fazy 1-2 można implementować niezależnie od serwera. Stare endpointy zostają jako fallback — backward compatible.

---

## Weryfikacja

- **Unit test** `export_data_delta` — filtrowanie po `since`, deterministyczność hashy
- **Integration test** — delta push → pull na drugim urządzeniu → porównaj hashe
- **Manual**: po syncach sprawdzić w logach `payloadSizeKB` — powinno spaść z ~5000 do ~1-10
