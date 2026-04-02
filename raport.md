# TIMEFLOW — Raport audytu kodu

**Data:** 2026-04-02
**Zakres:** Daemon (Rust) + Dashboard (React/TypeScript) + Tłumaczenia + Pokrycie Help

---

## Spis treści

1. [Podsumowanie](#podsumowanie)
2. [Daemon (Rust) — problemy](#daemon-rust)
3. [Dashboard (React/TS) — problemy](#dashboard-reactts)
4. [Tłumaczenia — brakujące/hardcoded](#tłumaczenia)
5. [Pokrycie Help.tsx — brakujące opisy funkcji](#pokrycie-helptsx)

---

## Podsumowanie

| Obszar | Krytyczne | Wysokie | Średnie | Niskie | Razem |
|--------|-----------|---------|---------|--------|-------|
| Daemon (Rust) | 3 | 6 | 8 | 4 | **21** |
| Dashboard (React/TS) | 2 | 5 | 1 | 3 | **11** |
| Tłumaczenia | 1 | 1 | 0 | 2 | **4** |
| Help — pokrycie | 0 | 1 | 1 | 0 | **2** |
| **Razem** | **6** | **13** | **10** | **9** | **38** |

---

## Daemon (Rust)

### KRYTYCZNE

#### D-CRIT-1: `DefaultHasher` jest niedeterministyczny — delta sync nigdy nie działa

**Plik:** `src/lan_common.rs:89-91, 105-109`

`compute_table_hash` i `generate_marker_hash` używają `std::collections::hash_map::DefaultHasher`. Od Rust 1.36 jest on losowo seedowany przy każdym uruchomieniu procesu (SipHash z losowym kluczem). Ten sam zestaw danych generuje **różny hash** między uruchomieniami i na różnych maszynach.

**Skutek:** Mechanizm delta vs full sync porównuje `local_marker` z `remote_marker_hash` w `lan_sync_orchestrator.rs:521`. Nawet gdy obie maszyny mają identyczne dane, markery nigdy nie będą równe — sync **zawsze** działa w trybie full, nigdy delta.

```rust
// Obecne — niedeterministyczne:
let mut hasher = std::collections::hash_map::DefaultHasher::new();
concat.hash(&mut hasher);
format!("{:016x}", hasher.finish())
```

**Naprawa:** Zastąpić `DefaultHasher` deterministycznym hasherem (FNV-1a bez nowych zależności lub SHA-256 z `sha2` już w projekcie):

```rust
fn fnv1a_64(data: &[u8]) -> u64 {
    let mut hash: u64 = 14695981039346656037;
    for byte in data {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(1099511628211);
    }
    hash
}
```

---

#### D-CRIT-2: Race condition — `sync_in_progress` sprawdzany bez blokady

**Plik:** `src/lan_server.rs:691-704`, `src/online_sync.rs:709-730`

Wzorzec check-then-act nie jest atomowy. `sync_in_progress` jest sprawdzane z `Ordering::Relaxed`, a `freeze()` (ustawiające flagę na `true`) jest wywoływane dopiero wewnątrz `execute_master_sync` po kilku krokach HTTP. Dwa równoczesne żądania `/lan/trigger-sync` mogą oba przejść przez sprawdzenie i uruchomić dwa synchronizatory jednocześnie.

**Naprawa:** Użyć `compare_exchange` atomowego:

```rust
if state.sync_in_progress.compare_exchange(
    false, true, Ordering::SeqCst, Ordering::SeqCst
).is_err() {
    return (409, json_error("Sync already in progress"));
}
```

---

#### D-CRIT-3: Potencjalny deadlock — zagnieżdżone blokowanie muteksów w `LanSyncState`

**Plik:** `src/lan_server.rs:195-211`

W `check_auto_unfreeze()` blokada `frozen_at` jest zwalniana przez `drop(guard)`, a potem `unfreeze()` ponownie blokuje `frozen_at`. Choć `drop` jest przed wywołaniem, wzorzec jest kruchy i podatny na regresję. Dodatkowo `reset_progress()` wywoływane po `unfreeze()` blokuje `progress` — niekonwencjonalna kolejność.

**Naprawa:** Scalić stan `frozen_at` i `db_frozen` w jedną strukturę chronioną jednym muteksem.

---

### WYSOKIE

#### D-HIGH-1: Brak limitu wątków — `handle_connection` tworzy nieograniczoną liczbę

**Plik:** `src/lan_server.rs:270-279`

Każde połączenie TCP tworzy nowy wątek bez limitu. Serwer nasłuchuje na `0.0.0.0:47891` (dostępny z sieci LAN) — DoS lub błędny klient może otworzyć tysiące połączeń.

**Naprawa:** Dodać semafor lub pulę wątków (np. `Arc<Semaphore>` z limitem 16-32).

---

#### D-HIGH-2: Brak walidacji odpowiedzi HTTP w kliencie LAN

**Plik:** `src/lan_sync_orchestrator.rs:102-157`

`http_request` odczytuje `status_line` ale nie parsuje kodu statusu. Odpowiedź HTTP 4xx/5xx jest zwracana jako `Ok(body)`, a caller próbuje parsować JSON z treścią błędu jako odpowiedź sukcesu.

**Naprawa:** Parsować kod statusu i zwracać `Err` dla kodów >= 400.

---

#### D-HIGH-3: Nieograniczony wzrost `title_history` w pamięci

**Plik:** `src/tracker.rs:161-170`

`push_title_history` nie ma limitu — rośnie bez ograniczeń do momentu zapisu na dysk (co 5 min). Limit `MAX_TITLE_HISTORY_LEN = 12` stosowany dopiero w `prepare_daily_for_storage`.

**Naprawa:** Wymusić limit bezpośrednio w `push_title_history`.

---

#### D-HIGH-4: `save_daily` opóźniany w nieskończoność przy `db_frozen = true`

**Plik:** `src/tracker.rs:597-607`

Gdy baza jest zamrożona, kod pomija zapis ale nie aktualizuje `last_save`. Podczas długiego zamrożenia (do 5 min — `AUTO_UNFREEZE_TIMEOUT`) dane gromadzone w pamięci mogą zostać utracone przy crashu.

**Naprawa:** Wywołać `save_daily` bezpośrednio po odmrożeniu lub buforować na dysku.

---

#### D-HIGH-5: `backup_database` otwiera nowe połączenie przy zamrożonej bazie

**Plik:** `src/sync_common.rs:57`

`backup_database()` wywołuje `open_dashboard_db()` wewnątrz, podczas gdy orchestrator trzyma otwarte `conn`. `VACUUM INTO` wymaga wyłączności odczytu — może kończyć się `SQLITE_BUSY`.

**Naprawa:** Przekazać istniejące połączenie `conn` zamiast otwierać nowe.

---

#### D-HIGH-6: Path traversal / brak weryfikacji JSON w `handle_download_db`

**Plik:** `src/lan_server.rs:563-564, 599-607`

Plik `lan_sync_merged.json` jest zwracany verbatim bez weryfikacji formatu. Jeśli plik zostałby zastąpiony przez inny proces, serwer zwróci dowolną treść.

**Naprawa:** Weryfikować że zwracana treść jest poprawnym JSON.

---

### ŚREDNIE

| # | Plik | Problem |
|---|------|---------|
| D-MED-1 | `sftp_client.rs:81-115` | `download_data` buforuje cały plik SFTP bez limitu rozmiaru — ryzyko OOM |
| D-MED-2 | `lan_common.rs:33-40` | `sync_log` czyta cały plik przy rotacji — O(n) dla każdego wpisu po 100KB |
| D-MED-3 | `lan_server.rs:329-340` | Brak limitu na liczbę nagłówków HTTP — pętla `loop { read_line }` bez ograniczenia |
| D-MED-4 | `sync_common.rs:122-123, 179, 283-284` | Timestampy porównywane jako stringi — błąd gdy format ISO vs `YYYY-MM-DD HH:MM:SS` |
| D-MED-5 | `lan_server.rs:664-675, 832-847` | `handle_push`/`import_push_data` — stub, nie importuje danych, ale zwraca sukces |
| D-MED-6 | `sftp_client.rs:12-17`, `sync_encryption.rs:27-36` | Hasła i klucze przechowywane jako zwykłe `String` — brak zerowania z pamięci |
| D-MED-7 | `lan_discovery.rs:46-47, 651` | Master election: `uptime_secs` może być sfałszowane przez złośliwy node |
| D-MED-8 | `lan_server.rs:268` | `check_auto_unfreeze` wywoływane co 500ms — zbyt częste blokowanie mutexu |

### NISKIE

| # | Plik | Problem |
|---|------|---------|
| D-LOW-1 | `lan_discovery.rs:112-119` | `generate_device_id` — kolizja przy wielokrotnym uruchomieniu w tej samej milisekundzie |
| D-LOW-2 | `i18n.rs:93-118` | `load_language` — TOCTOU na cache muteksie, może użyć przestarzałego języka |
| D-LOW-3 | `lan_discovery.rs:631` | Nieużywana zmienna `is_new` — niespójna logika zapisu `peers_dirty` |
| D-LOW-4 | `config.rs:95`, `lan_common.rs:58` | `SQLITE_OPEN_NO_MUTEX` — wymaga dokumentacji że każdy wątek musi mieć osobne połączenie |

---

## Dashboard (React/TS)

### KRYTYCZNE

#### FE-CRIT-1: Błędny regex w `normalizeApiToken` — `bearer` nigdy nie jest usuwany

**Plik:** `dashboard/src/lib/sync/sync-storage.ts:40-41`

Regex `/^bearer\\s+/i` w literale regex szuka dosłownego `\s` (backslash + litera s), nie whitespace. Token z prefiksem `Bearer ` nie zostanie oczyszczony — pełny ciąg trafi jako token autoryzacyjny.

```ts
// Obecne (błędne):
if (/^bearer\\s+/i.test(value)) {

// Poprawne:
if (/^bearer\s+/i.test(value)) {
```

---

#### FE-CRIT-2: `isLoadingRef` blokuje ponowne ładowanie przy zmianie parametrów

**Plik:** `dashboard/src/hooks/useSessionsData.ts:67-84`

Gdy efekt uruchomi się ponownie (zmiana `buildFetchParams`), sprawdza `if (isLoadingRef.current) return` — jeśli poprzednia odpowiedź nie wróciła, drugi efekt **wycofuje się bez załadowania danych** dla nowych parametrów. Użytkownik widzi stare dane dla starego zakresu dat.

**Naprawa:** Flaga in-flight powinna być per-efekt (AbortController), nie globalna ref:

```ts
useEffect(() => {
  let cancelled = false;
  sessionsApi.getSessions(buildFetchParams(0)).then((data) => {
    if (cancelled) return;
    replaceSessionsPage(data);
  });
  return () => { cancelled = true; };
}, [buildFetchParams, reloadVersion]);
```

---

### WYSOKIE

#### FE-HIGH-1: `lastSyncAt` — `useMemo` z nieprawidłową zależnością

**Plik:** `dashboard/src/pages/Settings.tsx:129`

```ts
const lastSyncAt = useMemo(() => loadLanSyncState().lastSyncAt, [lanSyncing]);
```

`useMemo` z zależnością `[lanSyncing]` odczytuje `localStorage` tylko gdy `lanSyncing` zmienia wartość. Jeśli sync kończy się błędem (oba stany `false`), memo się nie przelicza.

**Naprawa:** Użyć `useState` + aktualizacja po zakończeniu sync.

---

#### FE-HIGH-2: Wyciek stanu `loadMore` przy zmianie filtrów

**Plik:** `dashboard/src/hooks/useSessionsData.ts:109-128`

Gdy `buildFetchParams` się zmienia, ale nowy efekt jeszcze nie zadziałał, `loadMore` wykonuje zapytanie z offsetem starej listy do nowego backendu — appenduje dane z nowym filtrem do starej listy.

**Naprawa:** Zresetować `sessionsRef` i `hasMore` przy zmianie parametrów przed nowym efektem.

---

#### FE-HIGH-3: Race condition w `useSessionSplitAnalysis`

**Plik:** `dashboard/src/hooks/useSessionSplitAnalysis.ts:182-192`

Rekurencyjne `setTimeout` w `runBatch` nie sprawdza `cancelled` w `finally` — po cleanup efektu kolejne wywołanie `setSplitEligibilityBySession` może zaktualizować stary efekt.

**Naprawa:** Dodać `if (cancelled) return;` na początku `finally`.

---

#### FE-HIGH-4: `handleSaveSettings` nie persystuje `splitSettings` w transakcji zapisu

**Plik:** `dashboard/src/hooks/useSettingsFormState.ts:368`

`splitSettings` jest zapisywany natychmiast przez `updateSplitSetting` (poza cyklem zapisu). Zmiana nie jest chroniona przez mechanizm "unsaved changes" — nie pojawia się w dialogu "Masz niezapisane zmiany".

---

#### FE-HIGH-5: `groupedByProject` przeliczane przy każdej zmianie `t` referencji

**Plik:** `dashboard/src/pages/Sessions.tsx:411`

`t` jest zależnością `useMemo`. Funkcja `t` z `react-i18next` może zmieniać referencję — powoduje pełne przeliczenie grupy sesji. Wyciągnąć stałą wartość "unassigned" poza memo.

---

### ŚREDNIE

#### FE-MED-1: Podwójne nasłuchiwanie na `PROJECTS_ALL_TIME_INVALIDATED_EVENT`

**Plik:** `dashboard/src/hooks/useProjectsData.ts:119-136`

Ten sam event jest obsługiwany globalnie przez `projects-cache-store.ts` — listener w `useProjectsData` powoduje podwójne odświeżanie.

---

### NISKIE

| # | Plik | Problem |
|---|------|---------|
| FE-LOW-1 | `pages/Reports.tsx:281-284` | `crypto.randomUUID` — zbędne sprawdzanie (zawsze dostępne w Tauri/Chromium) |
| FE-LOW-2 | `pages/Settings.tsx:221` | Wynik LAN sync (`"Force sync — OK"` itd.) — hardcoded po angielsku zamiast `t()` |
| FE-LOW-3 | `lib/inline-i18n.ts` | `createInlineTranslator` — martwy kod, nigdzie nie importowany |

---

## Tłumaczenia

### KRYTYCZNE

#### I18N-CRIT-1: Hardcoded string PL w Help.tsx

**Plik:** `dashboard/src/pages/Help.tsx:808`

```
'Od wersji z Delta Sync: system przesyła tylko zmodyfikowane pakiety synchronizacji...'
```

Wstawiony bezpośrednio jako literał — brak odpowiednika EN. Użytkownicy anglojęzyczni widzą ten tekst po polsku.

**Naprawa:** Wyekstrahować do klucza JSON z parą PL + EN.

---

### WYSOKIE

#### I18N-HIGH-1: Tytuł PDF po polsku

**Plik:** `dashboard/src/pages/ReportView.tsx:38`

```ts
document.title = `timeflow_raport_${safeName}`;
```

Prefix `timeflow_raport_` jest po polsku. Użytkownicy EN dostają `timeflow_raport_ProjectName.pdf`.

**Naprawa:** Użyć tłumaczenia: `timeflow_report_` (EN) / `timeflow_raport_` (PL).

---

### NISKIE

| # | Plik | Problem |
|---|------|---------|
| I18N-LOW-1 | `components/sync/SyncProgressOverlay.tsx:122` | Fallback `'Synchronizacja LAN'` po polsku zamiast EN (klucz JSON istnieje, więc nie jest widoczny) |
| I18N-LOW-2 | `locales/{en,pl}/common.json` | 2 klucze `help_page.*` zdefiniowane ale nieużywane (font selection, files/activity section) |

---

## Pokrycie Help.tsx

### WYSOKIE

#### HELP-HIGH-1: Overlay postępu sync online — brak opisu

**Komponent:** `dashboard/src/components/sync/SyncProgressOverlay.tsx`

`SyncProgressOverlay` działa zarówno dla LAN jak i Online sync (parametr `syncType`), ale Help.tsx opisuje go **tylko** w kontekście LAN. Sekcja `online-sync` nie wspomina o overlayie postępu.

**Naprawa:** Dodać opis overlay postępu do sekcji `online-sync` w Help.tsx.

---

### ŚREDNIE

#### HELP-MED-1: Sekcja "Pliki/aktywność" w raportach — brak opisu

**Komponent:** `dashboard/src/pages/Reports.tsx` (sekcja `files` w edytorze szablonu)

Sekcja `files` jest dostępna w liście `ALL_SECTIONS` edytora szablonu, ale Help.tsx nie opisuje co ta sekcja zawiera w raporcie. Klucze JSON z opisem istnieją (`help_page.files_activity_section_...`), ale nie są użyte.

**Naprawa:** Dodać klucz `files_activity_section_...` do tablicy `features[]` w sekcji `reports` Help.tsx.

---

## Rekomendacje priorytetowe

### Do naprawy natychmiast (blokery funkcjonalności):

1. **D-CRIT-1** — `DefaultHasher` niedeterministyczny → delta sync nie działa nigdy
2. **D-CRIT-2** — Race condition na `sync_in_progress` → ryzyko równoległego zapisu do bazy
3. **FE-CRIT-1** — Błędny regex `bearer\\s+` → token z prefiksem Bearer powoduje błąd auth
4. **D-HIGH-2** — Brak parsowania kodu HTTP → błędy serwera traktowane jako sukces

### Do naprawy w następnym sprincie:

5. **FE-CRIT-2** — `isLoadingRef` blokuje ponowne ładowanie → stare dane po zmianie filtrów
6. **D-HIGH-1** — Brak limitu wątków serwera HTTP → DoS z sieci LAN
7. **D-HIGH-4** — Utrata danych przy crashu w trakcie zamrożenia bazy
8. **D-CRIT-3** — Potencjalny deadlock w `LanSyncState`
9. **I18N-CRIT-1** — Hardcoded PL w Help.tsx → widoczny bug dla użytkowników EN

### Optymalizacje i dług techniczny:

10. **D-MED-4** — Porównanie timestampów jako stringi (potencjalne błędy przy różnych formatach)
11. **FE-HIGH-5** — `groupedByProject` przeliczane zbyt często
12. **FE-LOW-3** — Martwy kod `createInlineTranslator`
13. **D-MED-2** — Rotacja logów O(n) przy każdym wpisie
