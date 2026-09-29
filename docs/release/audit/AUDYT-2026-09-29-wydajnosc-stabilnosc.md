# Audyt TIMEFLOW — wydajność, stabilność, martwy kod, wielowątkowość

Data: 2026-09-29 · gałąź `main_1.6` · zakres: demon (`src/`), `shared/`, dashboard (Tauri `dashboard/src-tauri/src` + React `dashboard/src`).

## Wnioski w skrócie

- **Kod jest w dobrym stanie ogólnym**: brak błędów kompilacji/clippy, knip nie znajduje martwych plików/eksportów we froncie, LAN server ma limity połączeń i timeouty, pętla jobów frontu już respektuje widoczność okna, trasy są ładowane leniwie.
- **Dwa realne problemy na macOS** (stabilność + poprawność pomiaru):
  1. brak `autoreleasepool` w długo żyjących pętlach Objective-C → pamięć demona rośnie z czasem,
  2. czas CPU z `proc_pidinfo` na Apple Silicon jest w tickach Mach, a nie w ns → śledzenie aplikacji w tle zaniżone ~41×.
- **Dashboard blokuje główny wątek** w kilku komendach synchronicznych (m.in. rekurencyjne liczenie rozmiaru folderu PM, które dodatkowo podąża za symlinkami).
- Martwy kod: kilka nieużywanych funkcji w demonie + większe bloki „na przyszłość” utrzymywane tylko przez testy (do decyzji).

## Metodyka

| Narzędzie / krok | Wynik |
|---|---|
| `cargo clippy --workspace --all-targets` | 0 błędów, ~70 ostrzeżeń stylu (bez wpływu na działanie) |
| Tymczasowe zdjęcie `#[allow(dead_code)]` + `cargo check` | 21 pozycji (lista w §4) |
| `knip` (dashboard) | 1 zduplikowany eksport |
| `react-doctor` (root) | 82/100 — 15 ostrzeżeń (nowe reguły; §5) |
| `scripts/audit/find-panics-in-prod.sh` | 29 trafień, wszystkie klasy „poisoned mutex”/stałe — bez realnego ryzyka |
| Ręczny przegląd ścieżek gorących | tracker, monitor macOS, tray macOS, ForegroundSignal, DailyStore, pula DB, start dashboardu, pollingi frontu |

## 1. Stabilność

| # | Priorytet | Problem | Skutek | Poprawka |
|---|---|---|---|---|
| S1 | **Wysoki** | macOS: pętla tray (`platform/macos/tray.rs`, 4 Hz na głównym wątku) oraz wątki trackera/foreground wołają API ObjC (`NSDate`, `nextEventMatchingMask`, `frontmostApplication`, `localizedName`, `set_icon`) **bez `autoreleasepool`**. Ręczna pętla nie ma puli drenowanej co iterację. | Obiekty autoreleased kumulują się do końca procesu → stały wzrost RSS demona (zgodne z komentarzem w `tray.rs`: 540 MB po ~12 h). | Owinąć każdą iterację pętli tray, pompkę zdarzeń i wywołania ObjC w wątkach w `objc2::rc::autoreleasepool`. **Wdrożone.** |
| S2 | Średni | `pm_get_folder_size`: rekurencja `is_file()`/`read_dir` **podąża za symlinkami**; pętla symlinków → nieskończona rekursja → przepełnienie stosu → `abort` całego dashboardu. Do tego komenda synchroniczna (główny wątek). | Zawieszenie/crash UI przy dużych lub zapętlonych folderach projektów (NAS). | Iteracyjny walk po `DirEntry::file_type()` (bez podążania za symlinkami) + wykonanie w `spawn_blocking`. **Wdrożone.** |
| S3 | Info (decyzja) | `panic = "abort"` w `[profile.release]` sprawia, że `catch_unwind` w `tracker::start` i obsługa „poisoned mutex” są martwe w buildzie release — panika w dowolnym wątku kończy cały demon. | Po panice brak trackingu do restartu (dashboard/autostart). | Do decyzji: albo `panic = "unwind"` dla demona (+~kilkadziesiąt KB), albo watchdog restartujący proces. **Nie zmieniano.** |
| S4 | Niski | Log demona rotowany tylko przy starcie (`init_logging`). | Przy tygodniach pracy plik może przekroczyć `max_log_size_kb`. | Sprawdzanie rozmiaru np. co godzinę w logerze. **Nie zmieniano** (niski wolumen logów na poziomie info). |

## 2. Poprawność pomiaru / wielowątkowość

| # | Priorytet | Problem | Skutek | Poprawka |
|---|---|---|---|---|
| W1 | **Wysoki** | `monitor_macos.rs::cpu_time_for_pid` traktuje `pti_total_user + pti_total_system` jako nanosekundy. Na Apple Silicon to **ticki `mach_absolute_time`** (timebase 125/3 ≈ 41,67 ns/tick). | Udział CPU aplikacji w tle zaniżony ~41× → próg `cpu_threshold` prawie nigdy nie jest przekraczany → renderingi/kompilacje w tle nie są liczone na Macach M1+. Na Intelu timebase = 1/1 (brak zmiany). | Przeliczanie przez `mach_timebase_info` (cache w `OnceLock`). **Wdrożone** + test. |
| W2 | Średni | `ForegroundSignal` (macOS): to samo przełączenie okna zgłaszane jest dwa razy — przez observer `NSWorkspaceDidActivateApplication` i przez fallback polling (do 2 s później). `take_last_switch_time` bierze **ostatni** znacznik. Dodatkowo kolejka 50 elementów odrzuca **najnowsze** zdarzenia po zapełnieniu. | Do ~2 s na każde przełączenie przypisywane poprzedniej aplikacji (przy częstym przełączaniu: minuty dziennie). | Fallback rejestruje znacznik tylko, gdy observer nic nie zgłosił w oknie pollingu; bufor trzyma zawsze najnowszy czas. **Wdrożone** + testy. |
| W3 | Średni | 23 komendy Tauri są synchroniczne (`pub fn`) → wykonywane na **głównym wątku** (UI). Blokujące I/O: `pm_get_projects`, `pm_get_templates`, `pm_get_folder_size`, `get_lan_sync_log`, `probe_cfab_hub_db`, `build_delta_archive` (pełne hashe tabel + eksport). | Chwilowe „zamrożenia” okna, szczególnie z folderem PM na dysku sieciowym. | Zamiana na `async` + `spawn_blocking` (nowy helper `run_blocking` obok `run_db_blocking`), regeneracja `rpc_generated.rs`. Dodatkowo `get_lan_sync_log` (pollowany co 0,5–2 s) czytał **cały** plik logu — teraz czyta tylko końcówkę od tyłu. **Wdrożone.** |

## 3. Wydajność

| # | Priorytet | Problem | Poprawka |
|---|---|---|---|
| P1 | Średni | Start dashboardu: `maybe_auto_backup` (checkpoint `TRUNCATE` + `VACUUM INTO` całej bazy) wykonywany synchronicznie w `setup()` przed pokazaniem okna. | Backup w wątku tła po inicjalizacji puli. **Wdrożone.** (`maybe_auto_optimize` zostaje synchronicznie — może wykonać pełny `VACUUM`, który w tle blokowałby zapisy UI.) |
| P2 | Średni | macOS `collect_process_entries`: co 30 s nowa instancja `sysinfo::System` + `refresh_processes(All)` pobiera pełne dane procesów (pamięć, CPU, dysk…), choć potrzebne są tylko nazwa/rodzic/ścieżka exe. To samo przy każdym kliknięciu „Otwórz dashboard”. | `refresh_processes_specifics` z samym `exe`. **Wdrożone.** |
| P3 | Niski | Pollingi frontu działające także przy ukrytym oknie: `LanPeerNotification` (5 s), `useMcpStatus` (15 s). | Pomijanie ticku przy `document.visibilityState !== 'visible'` + odświeżenie po powrocie. **Wdrożone.** `DaemonSyncOverlay` (2 s) zostawiony — śledzi wynik online sync także w tle. |
| P4 | Niski | `extend_activity_spans` przy każdym ticku klonuje, sortuje i parsuje RFC3339 całego wektora spanów (≤100) aktywnego pliku. | Fast-path „dopisz/rozszerz ostatni span” w miejscu. Zysk znikomy przy ticku 10 s — **nie zmieniano**. |
| P5 | Niski | `assignment_model/scoring.rs`: warstwy 3 i 3b to niemal identyczny kod (różni się tabelą i wagami). | Wspólny helper — refaktor bez zysku wydajności, **nie zmieniano**. |
| P6 | Info | `Renders.tsx`: `await` w pętli przy przypisywaniu renderów (react-doctor). | Świadome — zapisy SQLite i tak są szeregowane, a kolejność ma znaczenie przy `remember_rule`. Ewentualnie przyszła komenda wsadowa. |

## 4. Martwy kod

**Usunięte:**

- `dashboard/src/pages/Renders.tsx` — zbędny `export default RendersPage` (import leniwy używa eksportu nazwanego).

**Do decyzji (nieużywane w ogóle, używane tylko w testach lub oznaczone „na przyszłość”).** Nie usuwano — każda pozycja ma w kodzie udokumentowaną decyzję „zostawić” (np. „Decision 2026-06-24”), więc zmiana wymaga zgody właściciela:

| Element | Linie | Uwagi |
|---|---|---|
| `config.rs::effective_device_id`, `online_sync.rs::server_get`, `sync_common.rs::shadow_db_path` | ~30 | Zero użyć (także w testach i kodzie Windows). Komentarze: „zostaje na wypadek powrotu…”. |
| `sync_common.rs`: `merge_incoming_nonblocking*`, `shadow_path_for`, `open_rw_path`, `remove_shadow_file`, `snapshot_db_to_path` | ~150 | „future fast-swap” — tylko testy. Albo wdrożyć, albo usunąć. |
| `sync_encryption.rs`: `encrypt_file_data`, `decrypt_file_data`, `derive_session_key`, typy SFTP | ~150 | „Stary transport SFTP — pod ewentualny powrót”. |
| `sync_common.rs`: `build_delta_export`, `get_last_push_timestamp`; `lan_server.rs`: `build_delta_for_pull_public` | ~40 | Tylko symulator/testy — można przenieść pod `#[cfg(test)]`. |
| Komenda `build_delta_archive` + `dataApi.buildDeltaArchive` | ~670 (plik) | Nie wywoływana przez UI; dostępna tylko przez mostek WebUI. Jeśli nikt jej nie używa zewnętrznie — do usunięcia. |
| `mcp/protocol.rs::INTERNAL_ERROR`, `cfab_render.rs` pole `frozen_at` | 2 | Stała ze specyfikacji JSON-RPC / pole deserializacji — zostawić. |
| `i18n.rs` warianty `DashboardNotFound`, `VersionErrorTitle`… | — | Używane tylko w buildzie Windows — to nie martwy kod. |

## 5. Jakość frontu (react-doctor 82/100)

Oczekiwany wynik wg `CLAUDE.md` to 100/100 — spadek wynika z nowych reguł w nowszej wersji narzędzia:

- `no-unguarded-numeric-input-parse` ×7 (`AiSettingsForm`, `AiBatchActionsCard`, `MultiSplitSessionEditor`, `WebServerCard`) — `parseInt/parseFloat` z inputu bez obsługi `NaN`.
- `no-array-index-as-key` ×2 (`RendersOfflineSection`, `MultiSplitSessionEditor`).
- `no-fetch-response-used-without-status-check` ×3, `auth-token-in-web-storage` ×1 (transport WebUI) — do weryfikacji, czy to false-positive (status sprawdzany w warstwie wyżej).
- `async-await-in-loop` ×2 — patrz P6.

**Nie zmieniano w tej iteracji** — osobny, mały PR (zmiany zachowania inputów wymagają decyzji co do UX przy pustym/niepoprawnym polu).

## 6. Clippy (~70 ostrzeżeń)

Wyłącznie styl: `needless_borrow` ×8, `doc_lazy_continuation` ×5, `redundant_locals` ×4, `double_ended_iterator_last` ×4, `too_many_arguments` ×4, drobne `manual_*`. Rekomendacja: jednorazowy `cargo clippy --fix` w osobnym commicie (poza zakresem tej zmiany — zasada minimalnego zakresu).

Uwaga: goły `cargo clippy` (bez `-W clippy::all`) **kończy się błędem** na `assignment_model/training.rs:154` (`approx_constant` — literał ≈ `LN_2`, lint domyślnie `deny`). Istniało przed audytem; poprawka: `std::f64::consts::LN_2`.

## 7. Wdrożone poprawki — podsumowanie

| ID | Pliki |
|---|---|
| S1 | `src/platform/macos/tray.rs`, `src/monitor_macos.rs`, `src/platform/macos/foreground.rs` |
| W1 | `src/monitor_macos.rs` |
| W2 | `src/platform/foreground_signal.rs`, `src/platform/macos/foreground.rs` |
| S2, W3 | `dashboard/src-tauri/src/commands/{pm.rs,pm_manager.rs,lan_sync.rs,cfab_render.rs,delta_export.rs}`, `webui/rpc_generated.rs` (regenerowany) |
| P1 | `dashboard/src-tauri/src/db.rs` |
| P2 | `src/platform/macos/process_snapshot.rs` |
| P3 | `dashboard/src/components/sync/LanPeerNotification.tsx`, `dashboard/src/hooks/useMcpStatus.ts` |
| Martwy kod | `dashboard/src/pages/Renders.tsx` |

Wszystkie komendy PM wykonują I/O pod wspólną blokadą (`PM_IO_LOCK`), więc operacje read-modify-write na `projects_list.json`/szablonach pozostają sekwencyjne — tak jak wcześniej na głównym wątku.

### Weryfikacja

| Krok | Wynik |
|---|---|
| `cargo test --workspace` | 574 testy OK (w tym 11 nowych: timebase Mach, dedup ForegroundSignal, `read_last_lines`, `dir_size` + pętla symlinków) |
| `npm test` (vitest) | 295/295 OK |
| `npm run lint` / `npm run typecheck` | 14 / 13 błędów — **identyczne na czystym `HEAD`** (istniejące wcześniej, m.in. `SettingsIntegrationTab`, `useProjectPageController`, `RendersIntegrationStatus`) |
| clippy na zmienionych plikach | brak nowych ostrzeżeń (wyłapany i naprawiony regres: nieawaitowany `upsert_lan_peer` w skanie LAN) |

Zmiany nie wpływają na widoczne funkcje ani ustawienia — `Help.tsx` nie wymaga aktualizacji (poza W1: na Macach M1+ śledzenie w tle zacznie realnie działać zgodnie z dotychczasowym opisem).
