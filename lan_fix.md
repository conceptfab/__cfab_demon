# LAN Sync Fix — Diagnoza i plan naprawy

## Problem

Dwie maszyny widzą się po LAN (discovery działa), ale po wielokrotnych synchronizacjach
każda ma inny zbiór danych. Cel: po syncu obie maszyny mają **identyczne** dane.

---

## 1. Architektura obecna (jak to działa teraz)

```
Machine A                                    Machine B
─────────                                    ─────────
lan_discovery.rs ──UDP beacon/discover──▶ lan_discovery.rs
     │                                           │
     ▼                                           ▼
lan_peers.json                            lan_peers.json
     │                                           │
     ▼                                           ▼
LanPeerNotification.tsx ◀──poll co 5s──▶ LanPeerNotification.tsx
     │                                           │
     ▼ (klik "Sync" lub auto-sync)               │
run_lan_sync()                                   │
     │                                           │
     ├── POST /lan/status ───────────────▶ handle_status()
     │       (wysyła swoje table_hashes)    (porównuje hashe)
     │       ◀── {needs_pull, needs_push} ──┘
     │
     ├── POST /lan/pull (jeśli needs_pull)
     │       ◀── DeltaArchive ──────────── build_delta_archive()
     │       └── import_delta_into_db()
     │
     └── POST /lan/push (jeśli needs_push)
             ──▶ DeltaArchive ──────────▶ handle_push()
                                           └── import_delta_into_db()
```

### Przepływ danych w `import_delta_into_db()`:
1. Merge **projects** — upsert po `name`, update jeśli remote `updated_at` > local
2. Merge **applications** — insert jeśli `executable_name` nie istnieje, **brak update**
3. Merge **sessions** — insert jeśli `(app_id, start_time)` nie istnieje, **brak update**
4. Merge **manual_sessions** — insert jeśli `(title, start_time)` nie istnieje, **brak update**
5. Apply **tombstones** — insert tombstone + delete record po `record_id`

---

## 2. Zidentyfikowane bugi (przyczyny rozbieżności)

### BUG-1: Symetryczne `needs_pull = needs_push` (KRYTYCZNY)

**Plik:** `lan_server.rs:286`
```rust
let needs_pull = needs_push; // symmetric: if hashes differ, both sides need data
```

**Problem:** Serwer zawsze zwraca `needs_pull == needs_push`. To znaczy:
- Jeśli hashe się różnią → obie flagi = `true`
- Jeśli hashe identyczne → obie flagi = `false`

To jest **logicznie poprawne** z perspektywy "obie strony mają dane do wymiany",
ale **wykonuje się tylko na jednej stronie** (initiator). Machine B nie inicjuje
osobnego synca w tym samym momencie.

**Skutek:** Samo w sobie to nie jest bug — system poprawnie wykrywa, że oba kierunki
wymagają synchronizacji. Ale problem tkwi w tym, że **push do peera jest "fire and forget"**
— nie ma potwierdzenia, że peer prawidłowo zaimportował dane.

### BUG-2: Sessions — brak update istniejących rekordów (KRYTYCZNY)

**Plik:** `lan_sync.rs:342-345`
```rust
match existing {
    Some(_) => {
        // Session exists — skip (don't overwrite local sessions)
    }
    None => { /* INSERT */ }
}
```

**Problem:** Gdy sesja z tym samym `(app_id, start_time)` już istnieje lokalnie,
**import jest kompletnie pomijany** — nawet jeśli remote ma nowszy `updated_at`,
zmieniony `project_id`, `comment`, `is_hidden`, `end_time` czy `duration_seconds`.

**Scenariusz:**
1. Machine A: sesja `(app1, 10:00)` z `project_id = NULL`
2. Machine B: ta sama sesja — user przypisuje `project_id = 5`
3. Sync A→B: skip (B już ma tę sesję)
4. Sync B→A: skip (A już ma tę sesję, bo `(app_id, start_time)` match)
5. **Wynik:** A ma `project_id = NULL`, B ma `project_id = 5` — rozbieżność na zawsze

### BUG-3: Applications — brak update istniejących rekordów (KRYTYCZNY)

**Plik:** `lan_sync.rs:306-318`
```rust
if existing.is_none() {
    tx.execute("INSERT INTO applications ...", ...)?;
}
```

**Problem:** Jeśli aplikacja istnieje (po `executable_name`), jej `display_name` i
`project_id` **nigdy nie są aktualizowane** z danych remote.

**Scenariusz:**
1. Machine A: app "code.exe" → `project_id = NULL`
2. Machine B: user przypisuje "code.exe" → `project_id = 3`
3. Sync: obie strony mają "code.exe", więc skip
4. **Wynik:** A ma `project_id = NULL`, B ma `project_id = 3`

### BUG-4: Manual sessions — brak update, zły klucz deduplikacji (KRYTYCZNY)

**Plik:** `lan_sync.rs:374-402`

**Problem 4a:** Brak update — identycznie jak BUG-2.

**Problem 4b:** Klucz deduplikacji `(title, start_time)` nie zgadza się z UNIQUE
constraint w schema, który to `UNIQUE(project_id, start_time, title)` (schema.sql:422).
To znaczy, że ten sam tytuł + start_time ale inny `project_id` → **duplikat w bazie**,
a ten sam `project_id` + `start_time` ale inny tytuł → **duplikat w bazie**.

### BUG-5: Tombstones usuwają po `record_id` — ID nie jest przenośne między maszynami (KRYTYCZNY)

**Plik:** `lan_sync.rs:438-439`
```rust
let delete_sql = format!("DELETE FROM {} WHERE id = ?1", table);
let _ = tx.execute(&delete_sql, [&ts.record_id]);
```

**Problem:** `record_id` to lokalny `INTEGER PRIMARY KEY AUTOINCREMENT` — na Machine A
projekt "Foo" może mieć `id = 5`, a na Machine B `id = 12`. Tombstone z A mówi
"delete from projects WHERE id = 5" — na B to **usuwa zupełnie inny projekt!**

Tombstones mają `sync_key` (np. `name` dla projektów, `project_id|start_time|title`
dla manual_sessions), ale **sync_key nigdy nie jest używany do faktycznego usunięcia**.

**Skutek:** Usunięcie rekordu na jednej maszynie może usunąć **losowy inny rekord**
na drugiej maszynie, albo nie usunąć niczego (jeśli `id` nie istnieje).

### BUG-6: `since` timestamp — globalny, nie per-peer (POWAŻNY)

**Plik:** `LanPeerNotification.tsx:92`
```typescript
const since = state.lastSyncAt || '1970-01-01T00:00:00Z';
```

**Problem:** `lastSyncAt` jest **jeden globalny** timestamp w localStorage, nie per-peer.

**Scenariusz z 3+ maszynami:**
1. Machine A sync z Machine B o 10:00 → `lastSyncAt = 10:00`
2. Machine C pojawiła się o 09:00 z danymi od 08:00
3. Machine A sync z Machine C o 11:00 → `since = 10:00`
4. Delta od C zawiera tylko rekordy > 10:00, a **dane 08:00-10:00 z C są pominięte**

Przy dwóch maszynach ten bug jest mniej groźny, ale przy cotygodniowym syncu i zmianach
godzin systemowych (DST, NTP drift) może powodować utratę danych.

### BUG-7: `since` normalizacja obcina timezone → porównanie z UTC vs local (POWAŻNY)

**Plik:** `delta_export.rs:206-222`
```rust
fn normalize_datetime_for_sqlite(s: &str) -> String {
    let s = s.replace('T', " ");
    let s = s.trim_end_matches('Z');
    // ...truncate at 19 chars...
}
```

Frontend wysyła `since` jako ISO 8601 z timezone (np. `2026-03-29T10:00:00.000Z`).
Normalizacja obcina `Z` → `2026-03-29 10:00:00`.

Ale `updated_at` w bazie jest zapisywane przez:
- triggery schema: `datetime('now')` → **UTC** bez strefy
- import: `chrono::Local::now().to_rfc3339()` → **czas lokalny** ze strefą!

**Problem:** `updated_at` w jednych rekordach jest w UTC (`2026-03-29 08:00:00`),
w innych w local time (`2026-03-29 10:00:00+02:00` obcięte do `2026-03-29 10:00:00`).
Porównanie `WHERE updated_at > since` daje **niespójne wyniki** — część rekordów
jest pomijana, część eksportowana podwójnie.

### BUG-8: Hash oparty na `id || '|' || updated_at` — ID różnią się między maszynami (ŚREDNI)

**Plik:** `helpers.rs:74-83`
```rust
"SELECT COALESCE(hex(sha256(group_concat(id || '|' || updated_at, ';'))), '') \
 FROM (SELECT id, updated_at FROM {} ORDER BY id)"
```

**Problem:** Hash tabeli uwzględnia `id` (autoincrement), który jest **różny na każdej
maszynie** dla tych samych danych logicznych. Po udanym syncu hashe i tak się nie
zgodzą, bo `id` dla tych samych rekordów są inne.

**Skutek:** `handle_status()` **zawsze** zwraca `needs_push = true, needs_pull = true`,
nawet gdy dane są identyczne. Każdy sync generuje zbędny pull+push, ale nie naprawia
niczego (bo import skipuje istniejące rekordy).

### BUG-9: Import sesji nadpisuje `updated_at` na `Local::now()` (ŚREDNI)

**Plik:** `lan_sync.rs:361`
```rust
chrono::Local::now().to_rfc3339(),  // ← zamiast remote updated_at
```

Importowane sesje dostają `updated_at` = czas lokalna maszyna importująca.
To powoduje:
1. Hash tabeli się zmienia po imporcie (→ BUG-8 gwarantuje niekończące się synci)
2. Przy następnym syncu te same sesje mogą być ponownie eksportowane (bo ich
   `updated_at` jest "nowszy" niż `since` peera)

### BUG-10: `resolve_project_id()` cicho zwraca NULL (ŚREDNI)

**Plik:** `lan_sync.rs:469-482`

Gdy remote sesja ma `project_id` wskazujący na projekt, który nie istnieje jeszcze
lokalnie (np. bo merge projektów jest po nazwie a nie po ID), `resolve_project_id`
zwraca `None` → sesja jest importowana z `project_id = NULL`.

**Uwaga:** W teorii projekty są importowane PRZED sesjami (linia 241 przed 325),
więc powinny już istnieć. Ale: jeśli nazwa projektu na remote różni się choćby
białymi znakami lub wielkością liter, resolve nie znajdzie go.

### BUG-11: Peer dismissed po syncu — ponowny sync wymaga restartu (NISKI)

**Plik:** `LanPeerNotification.tsx:104-105`
```typescript
setVisiblePeer(null);
dismissPeer(peer.device_id);
```

Po udanym syncu peer jest dodawany do `dismissed-peers` w localStorage.
Przy cotygodniowym syncu user musi ręcznie oczyścić localStorage lub
restartować dashboard (dismissed nie ma TTL).

---

## 3. Ranking priorytetów

| # | Bug | Wpływ na rozbieżność | Trudność naprawy |
|---|-----|----------------------|------------------|
| 1 | BUG-2: Sessions brak update | **KRYTYCZNY** — główna przyczyna | Średnia |
| 2 | BUG-5: Tombstones delete po record_id | **KRYTYCZNY** — usuwanie losowych rekordów | Średnia |
| 3 | BUG-3: Applications brak update | **KRYTYCZNY** — project_id nie propaguje | Łatwa |
| 4 | BUG-4: Manual sessions brak update | **KRYTYCZNY** — j.w. + zły klucz dedup | Średnia |
| 5 | BUG-8: Hash uwzględnia id | **POWAŻNY** — sync nigdy nie stwierdzi "OK" | Łatwa |
| 6 | BUG-7: since UTC vs local mismatch | **POWAŻNY** — delta pomija/duplikuje | Średnia |
| 7 | BUG-9: updated_at nadpisywane na local | **ŚREDNI** — pętla re-eksportu | Łatwa |
| 8 | BUG-6: since globalny, nie per-peer | **ŚREDNI** (niski przy 2 maszynach) | Łatwa |
| 9 | BUG-10: resolve_project_id cichy NULL | **ŚREDNI** — utrata przypisań | Łatwa |
| 10| BUG-11: Peer dismissed bez TTL | **NISKI** — UX issue | Łatwa |

---

## 4. Plan naprawy (kolejność implementacji)

### Faza 1: Naprawa merge logic (BUG-2, BUG-3, BUG-4)

**Cel:** Istniejące rekordy są AKTUALIZOWANE, nie skipowane.

#### 4.1.1 Sessions — upsert z "last writer wins" po `updated_at`

```rust
// lan_sync.rs — zamienić blok match existing (linia 342-367)
match existing {
    Some(existing_id) => {
        // Porównaj updated_at — jeśli remote nowszy, zaktualizuj
        let local_updated: Option<String> = tx
            .query_row(
                "SELECT updated_at FROM sessions WHERE id = ?1",
                [existing_id],
                |row| row.get(0),
            )
            .ok();

        let remote_updated = &session.updated_at; // WYMAGA: dodać updated_at do SessionRow

        if let Some(ref local_ts) = local_updated {
            if remote_updated.as_deref().map_or(false, |r| r > local_ts.as_str()) {
                tx.execute(
                    "UPDATE sessions SET project_id = ?1, end_time = ?2, \
                     duration_seconds = ?3, rate_multiplier = ?4, comment = ?5, \
                     is_hidden = ?6, updated_at = ?7 WHERE id = ?8",
                    rusqlite::params![
                        local_project_id,
                        session.end_time,
                        session.duration_seconds,
                        session.rate_multiplier,
                        session.comment,
                        session.is_hidden as i64,
                        remote_updated,
                        existing_id,
                    ],
                )
                .map_err(|e| e.to_string())?;
                summary.sessions_merged += 1;
            }
        }
    }
    None => { /* INSERT jak dotąd, ale z remote updated_at zamiast Local::now() */ }
}
```

**Wymagane zmiany:**
- Dodać `updated_at: Option<String>` do `SessionRow` (types.rs + delta_export.rs SELECT)
- Analogiczna zmiana w manual_sessions
- W INSERT: użyć `session.updated_at` zamiast `chrono::Local::now().to_rfc3339()`

#### 4.1.2 Applications — upsert z "last writer wins"

```rust
// lan_sync.rs — zamienić blok if existing.is_none() (linia 306-318)
match existing {
    Some(existing_id) => {
        // Update display_name i project_id jeśli remote nowszy
        let local_updated: Option<String> = tx
            .query_row(
                "SELECT updated_at FROM applications WHERE id = ?1",
                [existing_id],
                |row| row.get(0),
            )
            .ok();

        // WYMAGA: dodać updated_at do ApplicationRow i delta_export SELECT
        if let Some(ref local_ts) = local_updated {
            if app_row.updated_at.as_deref().map_or(false, |r| r > local_ts.as_str()) {
                let resolved_project = resolve_project_id(&tx, app_row.project_id, &delta.data.projects);
                tx.execute(
                    "UPDATE applications SET display_name = ?1, project_id = ?2 \
                     WHERE id = ?3",
                    rusqlite::params![app_row.display_name, resolved_project, existing_id],
                )
                .map_err(|e| e.to_string())?;
                summary.apps_merged += 1;
            }
        }
    }
    None => { /* INSERT jak dotąd */ }
}
```

#### 4.1.3 Manual sessions — upsert + poprawny klucz dedup

Zmienić klucz deduplikacji z `(title, start_time)` na `(project_id, start_time, title)`
(zgodnie z UNIQUE constraint w schema) + dodać UPDATE branch identycznie jak w sesjach.

---

### Faza 2: Naprawa tombstones (BUG-5)

**Cel:** Tombstones usuwają po `sync_key`, nie po `record_id`.

```rust
// lan_sync.rs — zamienić blok tombstones (linia 405-441)
for ts in &delta.data.tombstones {
    // ...walidacja table_name jak dotąd...

    // Sprawdź czy tombstone już zastosowany (po sync_key, nie record_uuid)
    let exists: Option<i64> = tx
        .query_row(
            "SELECT 1 FROM tombstones WHERE table_name = ?1 AND sync_key = ?2",
            rusqlite::params![ts.table_name, ts.sync_key],
            |row| row.get(0),
        )
        .ok();
    if exists.is_some() {
        continue;
    }

    // Usuń rekord po SYNC_KEY, nie po record_id
    match ts.table_name.as_str() {
        "projects" => {
            // sync_key = project name
            let _ = tx.execute(
                "DELETE FROM projects WHERE name = ?1",
                [&ts.sync_key],
            );
        }
        "manual_sessions" => {
            // sync_key = "project_id|start_time|title"
            // parse sync_key
            let parts: Vec<&str> = ts.sync_key.as_deref()
                .unwrap_or("").splitn(3, '|').collect();
            if parts.len() == 3 {
                // Resolve project_id by name or use directly
                let _ = tx.execute(
                    "DELETE FROM manual_sessions \
                     WHERE start_time = ?1 AND title = ?2",
                    rusqlite::params![parts[1], parts[2]],
                );
            }
        }
        "sessions" => {
            // UWAGA: sessions nie mają jeszcze triggera tombstone w schema!
            // Trzeba dodać trigger + sync_key format
        }
        _ => {}
    }

    // Insert tombstone record
    tx.execute(
        "INSERT OR IGNORE INTO tombstones (table_name, record_id, record_uuid, deleted_at, sync_key) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![ts.table_name, ts.record_id, ts.record_uuid, ts.deleted_at, ts.sync_key],
    )
    .map_err(|e| e.to_string())?;
    summary.tombstones_applied += 1;
}
```

**Dodatkowe:** Dodać tombstone trigger dla sessions i applications w schema (jeśli ich usuwanie jest wspierane).

---

### Faza 3: Naprawa hashowania (BUG-8)

**Cel:** Hash tabeli nie zawiera `id`, tylko dane identyfikujące rekord.

```rust
// helpers.rs — zmienić compute_table_hash
pub(crate) fn compute_table_hash(conn: &rusqlite::Connection, table: &str) -> String {
    let sql = match table {
        "projects" => {
            "SELECT COALESCE(hex(sha256(group_concat(name || '|' || updated_at, ';'))), '') \
             FROM (SELECT name, updated_at FROM projects ORDER BY name)"
        }
        "applications" => {
            "SELECT COALESCE(hex(sha256(group_concat(executable_name || '|' || updated_at, ';'))), '') \
             FROM (SELECT executable_name, updated_at FROM applications ORDER BY executable_name)"
        }
        "sessions" => {
            "SELECT COALESCE(hex(sha256(group_concat(app_name || '|' || start_time || '|' || updated_at, ';'))), '') \
             FROM (SELECT a.executable_name AS app_name, s.start_time, s.updated_at \
                   FROM sessions s JOIN applications a ON s.app_id = a.id \
                   ORDER BY a.executable_name, s.start_time)"
        }
        "manual_sessions" => {
            "SELECT COALESCE(hex(sha256(group_concat(title || '|' || start_time || '|' || updated_at, ';'))), '') \
             FROM (SELECT title, start_time, updated_at FROM manual_sessions ORDER BY title, start_time)"
        }
        _ => return String::new(),
    };
    conn.query_row(sql, [], |row| row.get(0))
        .unwrap_or_else(|_| String::new())
        .to_lowercase()
}
```

**Efekt:** Po pełnym syncu obie maszyny będą miały identyczne hashe → status endpoint
zwróci `needs_pull = false, needs_push = false` → **sync poprawnie stwierdza "OK, dane
są identyczne"**.

---

### Faza 4: Naprawa timestampów (BUG-7, BUG-9)

#### 4.4.1 Ujednolicenie `updated_at` na UTC (BUG-7)

Wszędzie w `import_delta_into_db` zamienić:
```rust
// BYŁO:
chrono::Local::now().to_rfc3339()

// MA BYĆ (zachowaj remote updated_at):
session.updated_at  // lub &ms.updated_at dla manual_sessions
```

Jeśli remote `updated_at` jest puste, fallback na:
```rust
chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
```

Użyć `Utc` zamiast `Local` — spójnie z `datetime('now')` w triggerach SQLite.

#### 4.4.2 Normalizacja `since` z timezone (BUG-7)

`normalize_datetime_for_sqlite` poprawnie obcina timezone, ale powinien **konwertować**
do UTC, a nie obcinać:

```rust
fn normalize_datetime_for_sqlite(s: &str) -> String {
    // Próbuj sparsować jako pełny ISO 8601 i skonwertować do UTC
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return dt.with_timezone(&chrono::Utc)
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
    }
    // Fallback: proste formatowanie jak dotąd
    let s = s.replace('T', " ");
    let s = s.trim_end_matches('Z');
    if s.len() > 19 { s[..19].to_string() } else { s.to_string() }
}
```

---

### Faza 5: Naprawy pomniejsze (BUG-6, BUG-10, BUG-11)

#### 4.5.1 Per-peer `since` (BUG-6)

```typescript
// lan-sync-types.ts — zmienić LanSyncState
export interface LanSyncState {
  peers: LanPeer[];
  lastSyncAt: string | null;        // zostawić dla kompatybilności
  lastSyncPeerId: string | null;
  peerSyncTimes: Record<string, string>; // NOWE: device_id → ISO timestamp
}

// LanPeerNotification.tsx — zmienić since
const peerSince = state.peerSyncTimes?.[peer.device_id] || state.lastSyncAt || '1970-01-01T00:00:00Z';
// Po syncu:
saveLanSyncState({
  ...state,
  lastSyncAt: new Date().toISOString(),
  peerSyncTimes: {
    ...state.peerSyncTimes,
    [peer.device_id]: new Date().toISOString(),
  },
});
```

#### 4.5.2 `resolve_project_id` z case-insensitive match (BUG-10)

```rust
fn resolve_project_id(...) -> Option<i64> {
    let remote_id = remote_project_id?;
    let remote_project = remote_projects.iter().find(|p| p.id == remote_id)?;
    // Case-insensitive + trim
    tx.query_row(
        "SELECT id FROM projects WHERE LOWER(TRIM(name)) = LOWER(TRIM(?1))",
        [&remote_project.name],
        |row| row.get(0),
    )
    .ok()
}
```

#### 4.5.3 Dismiss peer z TTL (BUG-11)

```typescript
// LanPeerNotification.tsx — dodać TTL do dismissed
function getDismissedPeers(): Set<string> {
  try {
    const raw = localStorage.getItem(NOTIFICATION_DISMISS_KEY);
    if (!raw) return new Set();
    const entries: Array<{ id: string; until: number }> = JSON.parse(raw);
    const now = Date.now();
    // Usuwaj wygasłe
    const valid = entries.filter((e) => e.until > now);
    if (valid.length !== entries.length) {
      localStorage.setItem(NOTIFICATION_DISMISS_KEY, JSON.stringify(valid));
    }
    return new Set(valid.map((e) => e.id));
  } catch {
    return new Set();
  }
}

function dismissPeer(deviceId: string): void {
  const raw = localStorage.getItem(NOTIFICATION_DISMISS_KEY);
  const entries: Array<{ id: string; until: number }> = raw ? JSON.parse(raw) : [];
  entries.push({ id: deviceId, until: Date.now() + 4 * 3600_000 }); // 4h TTL
  localStorage.setItem(NOTIFICATION_DISMISS_KEY, JSON.stringify(entries));
}
```

---

## 5. Dodatkowe: "Full sync" na żądanie

Dla cotygodniowego użycia warto dodać przycisk **"Pełna synchronizacja"** w Settings,
który:

1. Wysyła `since = '1970-01-01 00:00:00'` (pełny eksport)
2. Importuje **wszystko** z peera (nie tylko deltę)
3. Po imporcie — peer robi to samo w drugą stronę

To jest "nuclear option" gdy delta sync zawiedzie. Implementacja:

```typescript
// LanSyncCard.tsx — dodać przycisk
<Button onClick={() => handleFullSync(peer)}>
  {t('settings.lan_sync.full_sync')}
</Button>

async function handleFullSync(peer: LanPeer) {
  await lanSyncApi.runLanSync(peer.ip, peer.dashboard_port, '1970-01-01T00:00:00Z');
}
```

To już działa z obecnym kodem (parametr `since`), ale jest ukryte — warto wyeksponować
w UI.

---

## 6. Dodatkowe: brak synca `file_activities`

Tabela `file_activities` nie jest uwzględniona w delta export/import.
Jeśli chcesz mieć identyczne dane na obu maszynach, musisz dodać ją do:
- `DeltaData` struct
- `build_delta_archive()` query
- `import_delta_into_db()` merge logic

Klucz deduplikacji: `UNIQUE(app_id, date, file_path)` — już jest w schema.

---

## 7. Pliki do zmiany (podsumowanie)

| Plik | Zmiany |
|------|--------|
| `dashboard/src-tauri/src/commands/lan_sync.rs` | Cała logika merge: upsert zamiast skip-if-exists, tombstones po sync_key, UTC timestamps |
| `dashboard/src-tauri/src/commands/lan_server.rs` | Bez zmian (logika status jest OK) |
| `dashboard/src-tauri/src/commands/delta_export.rs` | Dodać `updated_at` do SessionRow SELECT, poprawić normalizację datetime, opcjonalnie file_activities |
| `dashboard/src-tauri/src/commands/helpers.rs` | Zmienić `compute_table_hash` — usunąć `id` z hasha |
| `dashboard/src-tauri/src/commands/types.rs` | Dodać `updated_at` do `SessionRow` i `ApplicationRow` |
| `dashboard/src-tauri/resources/sql/schema.sql` | Dodać tombstone trigger dla sessions, opcjonalnie trigger dla applications |
| `dashboard/src/lib/lan-sync-types.ts` | Dodać `peerSyncTimes` do `LanSyncState` |
| `dashboard/src/lib/lan-sync.ts` | Obsługa nowego pola |
| `dashboard/src/components/sync/LanPeerNotification.tsx` | Per-peer since, dismiss z TTL |
| `dashboard/src/components/settings/LanSyncCard.tsx` | Przycisk "Full sync" |

---

## 8. Kolejność wdrażania

```
Krok 1: BUG-8 (hash bez id)        — szybka zmiana, eliminuje phantom syncs
Krok 2: BUG-2,3,4 (upsert merge)   — główna naprawa, wymaga updated_at w typach
Krok 3: BUG-5 (tombstones sync_key) — krytyczne, ale mniej częste
Krok 4: BUG-7,9 (UTC consistency)   — stabilizacja timestampów
Krok 5: BUG-6,10,11 (drobnostki)    — polerowanie
Krok 6: Full sync button + opcjonalnie file_activities
```

**Szacowana ilość zmian:** ~300-400 linii kodu Rust, ~50 linii TypeScript.

---

## 9. Jak przetestować po naprawie

1. **Przygotowanie:** Dwie maszyny z różnymi danymi (różne projekty, sesje z różnymi przypisaniami)
2. **Test 1 — Full sync:** Klik "Pełna synchronizacja" → obie maszyny powinny mieć identyczne dane
3. **Test 2 — Hash convergence:** Po syncu, oba endpoints `/lan/status` zwracają `needs_pull = false, needs_push = false`
4. **Test 3 — Update propagation:** Zmień `project_id` sesji na A → sync → sprawdź czy B ma ten sam `project_id`
5. **Test 4 — Tombstone propagation:** Usuń projekt na A → sync → sprawdź czy B też go nie ma
6. **Test 5 — Re-sync idempotency:** Powtórz sync 3x → dane nie powinny się zmieniać po pierwszym syncu
