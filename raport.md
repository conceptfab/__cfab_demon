# TIMEFLOW — Raport z przeglądu kodu

**Data:** 2026-03-03
**Zakres:** Cały projekt (daemon Rust, backend Tauri, frontend React/TS, tłumaczenia i18n)

---

## Spis treści

1. [Podsumowanie](#podsumowanie)
2. [Krytyczne problemy](#1-krytyczne-problemy)
3. [Ważne problemy](#2-ważne-problemy)
4. [Optymalizacje i wydajność](#3-optymalizacje-i-wydajność)
5. [Nadmiarowy kod](#4-nadmiarowy-kod)
6. [Brakujące tłumaczenia i niespójności i18n](#5-brakujące-tłumaczenia-i-niespójności-i18n)
7. [Sugerowane rozwiązania — priorytet napraw](#6-sugerowane-rozwiązania--priorytet-napraw)

---

## Podsumowanie

| Kategoria | Krytyczne | Ważne | Optymalizacje | Kosmetyczne |
|-----------|:---------:|:-----:|:-------------:|:-----------:|
| Daemon (Rust) | 1 | 3 | 3 | 2 |
| Backend Tauri (Rust) | 3 | 5 | 2 | 2 |
| Frontend (React/TS) | 3 | 6 | 4 | — |
| Tłumaczenia (i18n) | — | 2 | — | 3 |
| **Razem** | **7** | **16** | **9** | **7** |

---

## 1. Krytyczne problemy

### K-1. Literówka `iS_hidden` w SQL — crash lub błędne wyniki

**Plik:** `dashboard/src-tauri/src/commands/analysis.rs:423`

```sql
AND (is_hidden IS NULL OR iS_hidden = 0)
```

SQLite może zgłosić `no such column: iS_hidden` lub zwrócić błędne wyniki. Ranking aplikacji w `get_stacked_timeline` nie filtruje ukrytych sesji.

**Naprawa:** Zmienić `iS_hidden` → `is_hidden`.

---

### K-2. Podmiana pliku DB z otwartym połączeniem — ryzyko korupcji SQLite

**Plik:** `dashboard/src-tauri/src/commands/import_data.rs:776-810` (`restore_db_from_backup`)

```rust
if wal_path.exists() {
    let _ = fs::remove_file(&wal_path);  // usuwamy WAL aktywnej bazy
}
fs::copy(backup_path, &active_db_path)?;  // podmiana pliku bazy
```

Połączenie w `Mutex<Connection>` jest nadal otwarte. Usunięcie WAL i podmiana pliku `.db` przy aktywnym połączeniu to klasyczny przepis na korupcję SQLite.

**Naprawa:** Przed podmianą pliku należy jawnie zamknąć/unieważnić aktywne połączenie z poola (drop Mutex guard + reinicjalizacja poola). Alternatywnie: użyć SQLite online backup API.

---

### K-3. Foreign keys wyłączone bez re-enable po błędzie przy restore

**Plik:** `dashboard/src-tauri/src/commands/database.rs:203-253`

```rust
conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
// ... operacje ...
tx.commit()?;  // jeśli to failuje — FK zostaje OFF
conn.execute_batch("PRAGMA foreign_keys = ON;");
```

Jeśli `tx.commit()` zwróci błąd, kolejne operacje na tym samym połączeniu (z Mutex poola) działają bez ograniczeń FK — ryzyko osieroconych wierszy.

**Naprawa:** Użyć RAII wrappera lub `finally`-style `let _ = conn.execute_batch("PRAGMA foreign_keys = ON;")` przed każdym `return Err(...)`.

---

### K-4. Race condition: brak `cancelled` guard w Sessions.tsx

**Plik:** `dashboard/src/pages/Sessions.tsx:220-238`

```tsx
useEffect(() => {
  getSessions({ ... })
    .then((data) => {
      setSessions(data);        // brak guard "if (cancelled)"
      setHasMore(data.length >= PAGE_SIZE);
    });
}, [effectiveDateRange, refreshKey, activeProjectId, minDuration]);
```

Przy szybkiej zmianie filtrów stary wynik nadpisze nowy (race condition). Wzorzec `cancelled` jest konsekwentnie używany w Dashboard i useTimeAnalysisData, ale tutaj go brakuje.

**Naprawa:**
```tsx
useEffect(() => {
  let cancelled = false;
  getSessions({ ... })
    .then((data) => {
      if (cancelled) return;
      setSessions(data);
      setHasMore(data.length >= PAGE_SIZE);
    });
  return () => { cancelled = true; };
}, [...]);
```

---

### K-5. Auto-refresh interwał ignoruje `refreshKey`

**Plik:** `dashboard/src/pages/Sessions.tsx:279-305`

```tsx
useEffect(() => {
  const interval = setInterval(() => {
    getSessions({ ... }).then(...)
  }, 15_000);
  return () => clearInterval(interval);
}, [effectiveDateRange, activeProjectId, minDuration]); // brak refreshKey!
```

Po ręcznym odświeżeniu (np. po przypisaniu projektu) stary interwał może nadpisać odświeżony stan.

**Naprawa:** Dodać `refreshKey` do tablicy zależności.

---

### K-6. Brak walidacji pustych dat w ExportPanel

**Plik:** `dashboard/src/components/data/ExportPanel.tsx:33-37`

```tsx
const result = await exportData(
  exportType === "single" ? parseInt(selectedProject, 10) : undefined,
  allTime ? undefined : dateStart,   // dateStart może być ""
  allTime ? undefined : dateEnd      // dateEnd może być ""
);
```

Gdy `allTime === false`, użytkownik może kliknąć "Eksportuj" z pustymi polami dat. Backend dostaje `""` zamiast dat.

**Naprawa:** Guard: `if (!allTime && (!dateStart || !dateEnd)) { showError(...); return; }`

---

### K-7. Race condition restart demona — mutex nie zwolniony przed spawn

**Plik:** `src/main.rs:59-73`

Mutex guard nie jest jawnie zwolniony przed `Command::new(exe).spawn()`. Jeśli nowy proces wystartuje zanim stary zwolni mutex, może dojść do konfliktu.

**Naprawa:** Dodać `drop(_guard)` przed `Command::new(exe).spawn()`.

---

## 2. Ważne problemy

### W-1. `has_boost` / `has_manual` zawsze `false` w `get_stacked_timeline`

**Plik:** `dashboard/src-tauri/src/commands/analysis.rs:457-466`

```rust
Ok(date_map.into_iter().map(|(date, data)| StackedBarData {
    date, data,
    has_boost: false,    // zawsze false
    has_manual: false,   // zawsze false
    comments: Vec::new(),
}).collect())
```

W przeciwieństwie do `get_project_timeline`, ta funkcja nie wypełnia tych pól. Jeśli UI wyświetla boosty/manual na tym wykresie, nigdy ich nie zobaczy.

---

### W-2. Tombstones przetwarzane po tworzeniu projektów (nieprawidłowa kolejność)

**Plik:** `dashboard/src-tauri/src/commands/import_data.rs:132-179`

Tombstones (usuwanie) są wykonywane PO mapowaniu i tworzeniu projektów. Jeśli tombstone usuwa projekt który jest jednocześnie w archiwum, projekt zostanie od razu wstawiony z powrotem.

**Naprawa:** Przenieść obsługę tombstones (linia 150) PRZED tworzenie projektów (linia 133).

---

### W-3. N+1 zapytania SQL w `validate_import`

**Plik:** `dashboard/src-tauri/src/commands/import_data.rs:70-103`

Dla każdej sesji w archiwum osobne zapytanie SQL. Przy tysiącach sesji — tysiące round-tripów.

**Naprawa:** Załadować istniejące sesje do tymczasowej tabeli i sprawdzić kolizje jednym JOINem.

---

### W-4. Brak indeksu na tymczasowej tabeli `_fa_keys`

**Plik:** `dashboard/src-tauri/src/commands/sessions.rs:373-378`

```rust
conn.execute_batch("CREATE TEMP TABLE IF NOT EXISTS _fa_keys (app_id INTEGER, date TEXT)")?;
```

Brak indeksu — JOIN na tej tabeli to pełny skan przy dużej liczbie sesji.

**Naprawa:** Dodać `CREATE INDEX IF NOT EXISTS _idx_fa_keys ON _fa_keys(app_id, date)`.

---

### W-5. Polling wersji demona przy każdym `get_daemon_status`

**Plik:** `dashboard/src-tauri/src/commands/daemon.rs:194-203`

Przy każdym wywołaniu startowany jest nowy proces demona z `--version`. UI polluje status regularnie — to niepotrzebne obciążenie.

**Naprawa:** Cache'ować wynik wersji w `OnceCell` z TTL.

---

### W-6. `today` nigdy nie aktualizuje się po północy w Sessions.tsx

**Plik:** `dashboard/src/pages/Sessions.tsx:151`

```tsx
const today = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
```

`useMemo` z `[]` wylicza `today` tylko przy mount. Jeśli aplikacja jest otwarta przez północ, data pozostanie dniem poprzednim.

**Naprawa:** Użyć `useState` + `setInterval` jak w `useTimeAnalysisData.ts`.

---

### W-7. Natywny `confirm()` zamiast `useConfirm()` w ManualSessionDialog

**Plik:** `dashboard/src/components/ManualSessionDialog.tsx:137`

```tsx
if (!editSession || !confirm(t("..."))) return;
```

Reszta aplikacji używa `useConfirm()`. Natywny `confirm()` blokuje wątek JS i jest niespójny.

**Naprawa:** Zamienić na `useConfirm()`.

---

### W-8. Hard-coded `'Unassigned'` w porównaniu

**Plik:** `dashboard/src/components/dashboard/TopProjectsList.tsx:46`

```tsx
const linkedProject = p.name === 'Unassigned' ? null : ...;
```

Porównanie do angielskiego literału — niespójne z mechaniką tłumaczeń (w PL backend może zwrócić inną nazwę).

**Naprawa:** Porównywać po ID lub specjalnym kluczu, nie po nazwie wyświetlanej.

---

### W-9. Pierwszy tick demona dodaje 0 sekund aktywności

**Plik:** `src/tracker.rs:180,236`

`last_tracking_tick` inicjalizowane do `Instant::now()` tuż przed pętlą. Pierwsze `actual_elapsed` będzie ~0.

**Naprawa:** `let mut last_tracking_tick = Instant::now() - poll_interval;`

---

### W-10. `apps_active_count` liczy wszystkie klucze, nie tylko aktywne

**Plik:** `src/storage.rs:238`

```rust
data.summary.apps_active_count = data.apps.len();
```

Liczy wszystkie historyczne aplikacje załadowane z JSON, nie tylko te z aktywnością danego dnia.

**Naprawa:** `data.apps.values().filter(|a| a.total_seconds > 0).count()`

---

### W-11. SQL injection potencjał w `VACUUM INTO`

**Plik:** `dashboard/src-tauri/src/commands/settings.rs:303-306`

```rust
let escaped_path = path.replace('\'', "''");
let vacuum_sql = format!("VACUUM INTO '{}'", escaped_path);
```

Ręczne escapowanie jest kruche. Rusqlite 0.30+ wspiera parametryzowany `VACUUM INTO`.

**Naprawa:** `conn.execute("VACUUM INTO ?1", rusqlite::params![path])?;`

---

### W-12. `dismissedSuggestions` reset na złej zależności

**Plik:** `dashboard/src/pages/Sessions.tsx:240-242`

```tsx
useEffect(() => {
  setDismissedSuggestions(new Set());
}, [activeDateRange.start, activeDateRange.end]); // zamiast effectiveDateRange
```

Przy przełączaniu na tryb "unassigned" suggestions nie są czyszczone mimo nowych sesji.

---

### W-13. Restart pętli BackgroundServices przy `autoImportDone`

**Plik:** `dashboard/src/components/sync/BackgroundServices.tsx:193-243`

Zmiana `autoImportDone` z `false` → `true` niszczy i odtwarza cały interwał, resetując timery odświeżeń.

---

## 3. Optymalizacje i wydajność

### O-1. `tasklist` zamiast WinAPI do detekcji dashboardu

**Plik:** `src/tray.rs:207-231`

`tasklist /FO CSV` to osobny proces (~50ms, ~10MB RAM). Projekt ma już `build_process_snapshot()` w `monitor.rs`.

**Naprawa:** Użyć istniejącego `build_process_snapshot()` lub bezpośrednio toolhelp32.

---

### O-2. Podwójne `to_lowercase()` w `monitored_exe_names`

**Plik:** `src/config.rs:202`

Dane są już znormalizowane podczas ładowania, ale `monitored_exe_names()` normalizuje je ponownie.

**Naprawa:** Usunąć redundantne `.trim().to_lowercase()`.

---

### O-3. Redundancja przy budowaniu drzewa PID

**Plik:** `src/monitor.rs:352-364`

Ręczne budowanie drzewa zamiast reużycia `collect_descendants`. Można uprościć.

---

### O-4. N+1 `prepare` w pętli merge sesji

**Plik:** `dashboard/src-tauri/src/commands/import_data.rs:560`

`tx.prepare(...)` wywoływane wewnątrz `loop`. Przy dużych importach tworzy wielokrotne przygotowania tego samego SQL.

**Naprawa:** Wyciągnąć `prepare` / użyć `prepare_cached` przed pętlą.

---

### O-5. `localStorage` parsowane co sekundę w BackgroundServices

**Plik:** `dashboard/src/components/sync/BackgroundServices.tsx:219`

`loadOnlineSyncSettings()` parsuje JSON z localStorage w każdym ticku 1s. Wystarczy używać stanu z istniejącego `useEffect` na event `ONLINE_SYNC_SETTINGS_CHANGED_EVENT`.

---

### O-6. Brak `useMemo` dla animation config w AllProjectsChart

**Plik:** `dashboard/src/components/dashboard/AllProjectsChart.tsx:34-39`

`getRechartsAnimationConfig` wyliczane przy każdym renderze. Zależy tylko od `sorted.length`.

**Naprawa:** Opakować w `useMemo`.

---

### O-7. `display_name_for` — liniowe przeszukiwanie przy każdym poll

**Plik:** `src/config.rs:350-357`

`config.apps.iter().find(...)` przy każdej nowej aplikacji. Przy >100 wpisach O(n).

**Naprawa:** Zbudować `HashMap<String, String>` po załadowaniu konfiguracji.

---

### O-8. Duplikacja `parse_time_to_ms` w `rebuild_sessions`

**Plik:** `dashboard/src-tauri/src/commands/sessions.rs:892-917 i 984-1021`

Ta sama logika parsowania timestampów (5 formatów) powielona dwa razy. `parse_local_timestamp` istnieje już w `analysis.rs`.

**Naprawa:** Wyodrębnić wspólną funkcję do modułu `helpers`.

---

### O-9. Mutable module-level state w data-store przy HMR

**Plik:** `dashboard/src/store/data-store.ts:31-32`

```ts
let lastRefreshAtMs = 0;
let scheduledRefreshTimer = null;
```

Przeżywają HMR — throttle blokuje pierwsze odświeżenie po hot-reload. Mniejszy problem w produkcji.

---

## 4. Nadmiarowy kod

### N-1. Nieużywana zależność `sysinfo` w Cargo.toml demona

**Plik:** `Cargo.toml:31`

`sysinfo = "0.30"` nie jest używane w żadnym pliku `.rs` demona.

**Naprawa:** Usunąć z `[dependencies]`.

---

### N-2. Zduplikowany obiekt filtrów sesji

**Plik:** `dashboard/src/pages/Sessions.tsx:221-232 i 283-293`

Ten sam obiekt filtrów dosłownie skopiowany w dwóch `useEffect`. Źródło buga K-5.

**Naprawa:** Wyodrębnić do `useMemo`.

---

### N-3. IIFE w renderze TopProjectsList

**Plik:** `dashboard/src/components/dashboard/TopProjectsList.tsx:85-118`

`(() => { ... })()` w JSX tworzy nową funkcję przy każdym renderze każdego wiersza.

**Naprawa:** Wyodrębnić do zmiennej lokalnej lub osobnego komponentu.

---

### N-4. `session_count` liczy przetworzone, nie zaimportowane sesje

**Plik:** `dashboard/src-tauri/src/commands/import.rs:269`

`session_count += 1` inkrementowane niezależnie od tego czy INSERT był nowy czy ON CONFLICT DO UPDATE. Dezorientujący `ImportResult`.

---

## 5. Brakujące tłumaczenia i niespójności i18n

### Pliki tłumaczeń EN/PL — zsynchronizowane

Oba pliki (`locales/en/common.json` i `locales/pl/common.json`) mają identyczne klucze. Brak brakujących kluczy.

### Hardkodowane teksty wymagające i18n

| Plik | Linia | Tekst | Problem |
|------|-------|-------|---------|
| `pages/QuickStart.tsx` | 145 | `Step {idx + 1}` | Hardkodowane "Step" po angielsku |
| `pages/Help.tsx` | 330 | `title="DASHBOARD"` | Hardkodowane zamiast `t()` |
| `pages/Help.tsx` | 933 | `title="DAEMON"` | Hardkodowane zamiast `t()` |
| `pages/ProjectPage.tsx` | 985 | `title="Activity Over Time"` | Hardkodowany angielski tytuł wykresu |
| `pages/Projects.tsx` | 1710 | `placeholder="C:\\projects\\clients"` | Placeholder ścieżki |

### Niespójności systemów tłumaczeń

1. **`QuickStart.tsx`** — używa własnej lokalnej funkcji `t(pl, en)` zamiast `useInlineT()` lub kluczy i18next. Teksty nie są zarządzane centralnie.

2. **`Help.tsx`** — miesza trzy systemy: `useTranslation()`, `useInlineT()` i hardkodowane stringi. Dwa tytuły sekcji hardkodowane, 9 pozostałych przez `t()`.

3. **System `inline-i18n.ts`** oznaczony jako `@deprecated` — ponad 450 hashowanych wpisów w sekcji `inline` powinno być docelowo zmigrowanych na czytelne klucze i18next.

### Niespójny branding/język w demonzie

**Pliki:** `src/tray.rs`, `src/tracker.rs`

Komunikaty wyświetlane użytkownikowi (MessageBoxW) są po angielsku i mieszają branding. Wg CLAUDE.md: "Nazwa produktu w UI, komunikatach: zawsze `TIMEFLOW`".

---

## 6. Sugerowane rozwiązania — priorytet napraw

### Priorytet 1 — natychmiastowe (ryzyko utraty danych / korupcji)

| # | Problem | Plik | Estymacja |
|---|---------|------|-----------|
| K-1 | Literówka `iS_hidden` → `is_hidden` | `analysis.rs:423` | 1 min |
| K-2 | Zamknąć połączenie DB przed podmianą pliku | `import_data.rs:776-810` | 30 min |
| K-3 | RAII wrapper na `PRAGMA foreign_keys` | `database.rs:203-253` | 15 min |
| K-7 | `drop(_guard)` przed spawn restart | `main.rs:59-73` | 5 min |
| W-11 | Parametryzowany `VACUUM INTO` | `settings.rs:303-306` | 5 min |

### Priorytet 2 — ważne (race conditions, błędne dane w UI)

| # | Problem | Plik | Estymacja |
|---|---------|------|-----------|
| K-4 | Dodać `cancelled` guard w Sessions | `Sessions.tsx:220` | 5 min |
| K-5 | Dodać `refreshKey` do auto-refresh | `Sessions.tsx:279` | 2 min |
| K-6 | Walidacja dat w ExportPanel | `ExportPanel.tsx:33` | 5 min |
| W-1 | Wypełnić `has_boost`/`has_manual` | `analysis.rs:457` | 20 min |
| W-2 | Kolejność tombstones vs projekty | `import_data.rs:132` | 10 min |
| W-6 | `today` auto-update po północy | `Sessions.tsx:151` | 5 min |
| W-7 | Natywny `confirm` → `useConfirm` | `ManualSessionDialog.tsx:137` | 5 min |
| W-8 | Hardcoded 'Unassigned' | `TopProjectsList.tsx:46` | 10 min |
| W-9 | Pierwszy tick 0 sekund | `tracker.rs:180` | 2 min |
| W-10 | `apps_active_count` filter | `storage.rs:238` | 2 min |

### Priorytet 3 — optymalizacje i jakość

| # | Problem | Plik | Estymacja |
|---|---------|------|-----------|
| O-1 | WinAPI zamiast `tasklist` | `tray.rs:207` | 20 min |
| O-3 | N+1 validate_import | `import_data.rs:70` | 30 min |
| O-4 | Brak indeksu `_fa_keys` | `sessions.rs:374` | 2 min |
| O-5 | Cache wersji demona | `daemon.rs:194` | 15 min |
| O-8 | Wspólna `parse_time_to_ms` | `sessions.rs` | 15 min |
| N-1 | Usunąć `sysinfo` z Cargo.toml | `Cargo.toml:31` | 1 min |
| N-2 | Wyodrębnić filtry sesji do useMemo | `Sessions.tsx` | 10 min |

### Priorytet 4 — tłumaczenia

| # | Problem | Plik |
|---|---------|------|
| T-1 | Hardkodowane "Step", "DASHBOARD", "DAEMON", "Activity Over Time" | QuickStart, Help, ProjectPage |
| T-2 | Unifikacja systemów tłumaczeń (usunięcie inline-i18n) | Cały frontend |
| T-3 | Komunikaty demona — polskie tłumaczenia + branding TIMEFLOW | tray.rs, tracker.rs |

---

*Raport wygenerowany automatycznie na podstawie analizy statycznej kodu.*
