# PARITY — różnice Windows ⇄ macOS

Tracker znanych różnic w zachowaniu i stubów między platformami.

| Obszar | macOS | Windows | Status / TODO |
|---|---|---|---|
| Tray — blok sync (widoczność vs wyszarzenie) | Blok sync jest **widoczny** gdy sync skonfigurowany (online `enabled+url+token` LUB LAN `enabled`); **ukrywany** dopiero gdy sync całkiem wyłączony (`Menu::insert`/`remove`). Bez celu (brak LAN-peera i online nie gotowy) → przyciski wyszarzone, status „Sync: niedostępny". | Blok zawsze obecny (nwg nie usuwa pozycji); **wyszarzony** + status „Sync: niedostępny" gdy brak celu. Warunek `syncable` identyczny jak na macOS (`has_target`). | Różnica szczątkowa: gdy sync CAŁKIEM wyłączony macOS chowa blok, Windows pokazuje wyszarzony. TODO: pełne ukrywanie na Windows przez Win32 `RemoveMenu`/`InsertMenuW` + **weryfikacja na realnym buildzie Windows** (cross-compile z macOS pada na `libsqlite3-sys`). |
| Detekcja statusu demona — zawężenie do zarządzanej binarki (`commands/daemon/mod.rs::query_daemon_process_status`) | `pgrep -f <pełna_ścieżka_z_find_daemon_exe>` zamiast gołej nazwy. Zweryfikowane na macu (demon startuje z absolutną ścieżką jako argv[0]). | `Get-CimInstance Win32_Process` + porównanie pełnej `ExecutablePath`; fallback do `tasklist /FI IMAGENAME` przy każdym błędzie/braku ścieżki. **NIEZWERYFIKOWANE na realnym Windows** (cross-compile pada). Ryzyko: quoting `-Command` w std::process oraz teoretyczny fałszywy „Stopped", gdy PowerShell zwróci sukces z pustym wyjściem. | TODO: zweryfikować scoped query na realnym buildzie Windows; rozważyć `-EncodedCommand` dla pewnego quotingu. |

## Notatki
- Sygnał obecności peera: `LanSyncState.peer_present` (AtomicBool) aktualizowany w pętli `lan_discovery` na podstawie `!peers.is_empty()`; czytany przez oba traye.
- Widoczność bloku sync w trayu: `online_ready || lan_enabled` (online_ready = `online.enabled && !url.is_empty() && !token.is_empty()`).
- Klikalność akcji sync (`has_target`/`syncable`): `online_ready || peer_present` (i nie trwa już sync).
- **`dashboard_running` NIE znaczy „dashboard otwarty".** Flaga w beaconie i w
  `lan_peers.json` oznacza osiągalność węzła. Historycznie liczył ją odczyt
  `heartbeat.txt` (plik pisany przez pętlę trackera DEMONA, nie przez dashboard)
  z oknem 60 s, podczas gdy ścieżka HTTP (`http_ping_one`) wpisywała na sztywno
  `true` — dwa źródła ścierały się i status migał. Gorzej: pojedynczy zamulony
  tick trackera (zamrożona baza na czas LAN sync, App Nap na macOS, pełny skan
  podsieci) gasił flagę i **master przestawał widzieć slave'a**, mimo że sync
  demon↔demon szedł normalnie; w dashboardzie przyciski Sync
  (`LanSyncPeerRow`) robiły się przez to `disabled`, więc ręczna
  synchronizacja „nie startowała". Teraz beacon zawsze raportuje `true`, a
  jedynym kryterium „peer online" jest świeżość `last_seen`:
  `lan_discovery::is_peer_fresh` (Rust, `PEER_STALE_AFTER` = 180 s) i
  `lib/lan-sync.ts::isLanPeerOnline` (TS, to samo okno). Zmiana jest
  wieloplatformowa — obie strony muszą trzymać te progi w zgodzie.

## Parity wersji (LAN sync)
- **Koszty dodatkowe (m26, `project_costs`):** encja synchronizuje się jako osobna
  tabela (LWW po `updated_at`, klucz sync = `uid`) z tombstonami (trigger
  `trg_project_costs_tombstone` w schema.sql + migracja **m26** + re-eksport w
  `db_migrations/tombstone_triggers.rs`). Peer ze starszą wersją TIMEFLOW nie zna
  tabeli: jego archiwum jej nie zawiera, a nasze klucze ignoruje — koszty NIE
  propagują się do czasu aktualizacji obu maszyn. Nie ma ryzyka utraty danych
  (nieznane klucze są pomijane, nie nadpisują lokalnych rekordów). Checksum
  `project_costs` jest content-hashem po pełnym zestawie kolumn, więc rozjazd
  kwoty/daty/komentarza jest wykrywalny i sam się leczy.
- **DWA niezależne eksporty — oba wymagały wpięcia.** Dashboard serializuje archiwum
  przez serde (`commands/delta_export.rs`, `DeltaData` + `TableHashes`). Demon ma
  własny, całkowicie odrębny eksport: `build_delta_for_pull` w `src/lan_server.rs`
  składa JSON ręcznie przez `fetch_all_rows`, ma własną strukturę `TableHashes`,
  własne `build_table_hashes` ORAZ ręczny `impl PartialEq`. Pominięcie `PartialEq`
  jest najgroźniejsze: rozjazd nie zostałby wykryty i peery raportowałyby
  „zsynchronizowane". Test `merge_roundtrip_project_costs_via_daemon_export`
  w `src/sync_common.rs` pilnuje całej ścieżki end-to-end.
  Uwaga sprzed m26: `impl PartialEq for TableHashes` nadal pomija
  `assignment_feedback` i `assignment_auto_runs`, mimo że hashe dla nich powstają.
- **Tabele m26 a schemat demona.** Demon ma własny, ręcznie pisany schemat i NIE
  uruchamia migracji dashboardu. Ponieważ `merge_incoming_data` odtwarza WSZYSTKIE
  triggery tombstone przy każdym merge, brak tabeli `project_costs`/`todos` wywalał
  cały merge (nie tylko koszty) na `no such table`. Chroni przed tym
  `ensure_m26_entity_tables` wołane przed pętlą triggerów. `verify_merge_integrity`
  ma własną pętlę DROP/CREATE i celowo NIE dostaje `ensure_*` — wszystkie cztery
  produkcyjne wywołania idą bezpośrednio po `merge_incoming_data` na tej samej bazie.
- **Rename i kasowanie projektu a koszty.** Kaskadę zmiany nazwy realizuje trigger
  `trg_projects_rename_cascade_costs` (m26), wzorem `trg_projects_rename_cascade_merged`
  z m23; odświeża `updated_at`, więc zmiana rozchodzi się przez LWW. Kasowanie
  projektu czyści koszty w kodzie komendy (`delete_costs_of_project` w
  `commands/projects.rs`, wołane z obu ścieżek kasowania), bo link idzie po nazwie
  i SQLite nie ma tu kaskady FK.
- **Komendy a webui.** Komendy Tauri wymagają rejestracji w TRZECH miejscach:
  `commands/mod.rs`, `invoke_handler` w `lib.rs` oraz wygenerowanym
  `webui/rpc_generated.rs` (`node scripts/gen_webrpc.cjs`). Bez trzeciego działają
  na desktopie i cicho NIE działają w webui na telefonie; `build.rs` sygnalizuje
  rozjazd tylko ostrzeżeniem.
- **Zadania (m26, `todos`):** encja synchronizuje się jako osobna tabela (LWW po
  `updated_at`, klucz sync = `uid`) z tombstonami (`trg_todos_tombstone`). Peer ze
  starszą wersją nie zna tabeli — zadania NIE propagują się do czasu aktualizacji
  obu maszyn; brak ryzyka utraty danych (nieznane klucze są pomijane).
  **`gcal_event_id` i `gcal_synced_at` NIE wchodzą do eksportu, merge ani checksumu**
  — są per-maszyna. Gdyby się synchronizowały, dwa urządzenia z włączonym Google
  Calendar (faza 3) biłyby się o to samo wydarzenie. Pilnują tego testy
  `merge_todos_never_touches_gcal_fields` i `todos_hash_ignores_gcal_fields`.
- **Kaskady zadań.** Rename projektu obsługuje trigger `trg_projects_rename_cascade_todos`
  (m26); rename klienta — kod komendy (`rename_client_links` w `commands/clients.rs`),
  bo dla klientów repo nie używa triggerów. Kasowanie projektu i klienta usuwa ich
  zadania (`delete_m26_entities_of_project`, `delete_client_links`) — link idzie po
  nazwie, więc SQLite nie ma tu kaskady FK. Usunięcie klienta ODPINA projekty
  (historia czasu zostaje), ale KASUJE zadania klienckie — zadanie bez klienta nie
  ma sensu, projekt bez klienta ma.
- **Profil wzrostu `project_costs`:** koszty jadą w eksporcie jako PEŁNY zbiór (bez
  filtra `since`), wzorem `clients`. Różnica: `clients` jest skończoną tabelą
  referencyjną, a `project_costs` rośnie liniowo z czasem. Przy dzisiejszej skali
  bez znaczenia; przy tysiącach rekordów przejść na filtr `since`, jak `sessions`.

- **Scalanie projektów (`projects.merged_into`/`merged_at`):** marker w pełni synchronizuje się tylko między urządzeniami z tą samą wersją TIMEFLOW. Starszy peer nie zna kolumn — dostaje tylko `excluded_at` (blokada liczenia czasu działa wszędzie), a jego rekordy NIE wyzerują lokalnego markera (brak klucza w archiwum ⇒ zachowaj lokalną wartość; jawny `null` od nowego peera ⇒ wyczyść, bo to unmerge). Daemon ma defensywne `ALTER TABLE` (`ensure_project_merge_columns`) na wypadek startu przed migracją m23 dashboardu.
- **Rollup czasu scalonych stadiów — zakres widoków:** serie scalonych dzieci są składane do rodzica u źródła (fold w `time_algorithm`), więc rollup obejmuje listę projektów, kartę projektu (czas, wycena, liczniki sesji/komentarzy/boostów, top aplikacje), Dashboard, Estimates (dziecko nie ma własnego wiersza; godziny/wartość/sesje wliczone do rodzica) i wykresy Time Analysis. Sekcje Merged/Excluded pokazują surowy czas własny (bez rollupu).
- **Import backupu a marker scalenia:** `import_data` używa `COALESCE` — archiwum bez pól merged_* (stara wersja) nie wyzeruje lokalnego markera. Trade-off: przywrócenie NOWSZEGO backupu zrobionego po unmerge też nie wyczyści lokalnego markera (serde nie odróżnia braku klucza od null) — w razie potrzeby rozłącz scalenie ręcznie; LAN sync z nowym peerem skoryguje stan automatycznie.
- LAN sync security hardening (2026-06-10): `/lan/trigger-sync`, `/online/trigger-sync`,
  `/online/cancel-sync` są loopback-only (wołane wyłącznie przez lokalny bridge);
  `/lan/pull` wymaga aktywnej sesji sync (db_frozen). Obie zmiany kompatybilne
  z istniejącymi peerami 13-step.
- Version gate w auto-sync: demon (discovery/tray) blokuje sync przy różnych wersjach
  TIMEFLOW — dotychczas robił to tylko bridge dashboardu. Peer ze starszym demonem
  (preflight zwraca CARGO_PKG_VERSION) będzie blokowany do czasu aktualizacji obu maszyn.
- `get_machine_name`: macOS używa `hostname` (dotąd zawsze "unknown" — COMPUTERNAME
  jest tylko na Windows).
- **LAN sync — domknięcie parności m24 (klienci + przypisania):** migracja m24
  dodała `projects.client_name`, `projects.status` oraz encję `clients`, ale NIE
  wpięła ich w sync demona (eksport/merge/checksum) — przez co po sync znikało
  przypisanie klienta do projektu, a usunięty klient „zmartwychwstawał". Naprawione:
  `client_name`/`status` jadą w eksporcie/merge projektów (reguła absent-key =
  zachowaj lokalne, jak `merged_into`), encja `clients` synchronizuje się jako
  osobna tabela (LWW po `updated_at`) z tombstonami (trigger `trg_clients_tombstone`
  w schema.sql + migracja **m25** + lustro `src/tombstone_triggers.rs`), a checksum
  projektów jest teraz content-hashem (wykrywa rozjazd `client_name`/`status`/
  `merged_into`, więc rozjazd się sam leczy zamiast wyglądać na „zsynchronizowane").
  Mieszane wersje: stary peer (bez kluczy m24) nie nadpisuje lokalnych wartości
  (absent-key), ale encja `clients` i tombstony klientów propagują się dopiero, gdy
  OBIE maszyny mają tę wersję. Marker zmienia się raz po aktualizacji → pierwszy
  sync będzie pełny (świadome, wymusza ponowną konwergencję).
- **Rozmergowanie po sync — naprawione:** `verify_merge_integrity` zerował
  `merged_into` gdy rodzic był chwilowo NIEOBECNY podczas konwergencji (ciche
  rozmergowanie). Teraz czyści marker TYLKO gdy rodzic ma tombstone (naprawdę
  usunięty); wiszący marker jest nieszkodliwy (rollup robi LEFT JOIN + fallback do
  dziecka), więc przeżywa do dotarcia wiersza rodzica.
- FOLLOW-UP (otwarte): sekret LAN nadal przesyłany plaintext HTTP w nagłówku
  `X-TimeFlow-Secret` — docelowo challenge-response (HMAC z nonce); wymaga zmiany
  protokołu i wersjonowania. Mitygacja częściowa: constant-time compare po stronie serwera.
- **Drag&drop monitored apps**: zmiany w `src/monitor.rs` i `src/platform/windows/process_snapshot.rs` (pole `bundle_id: None`, `pid_paths` puste, sygnatura `measure_cpu_for_app`) są lustrzane i kompilowane tylko na Windows — niezweryfikowane buildem na macOS (libsqlite3-sys cross-compile). Na Windows drag&drop obsługuje wyłącznie `.exe`; `.lnk` zwraca czytelny błąd.

## Remediacja jakości/architektury (branch `chore/quality-remediation`, audyt 2026-06-23)
- **Rdzeń merge wydzielony do `timeflow-shared::sync`:** triggery tombstone (#6), kanoniczna checksum SHA-256/128 (#2, dashboard porzucił FNV-1a — wcześniej obie strony NIGDY nie konwergowały bo różna długość hasha), normalizacja czasu (#1), `PROJECT_SELECT` (#10), content-hash PEŁNYCH kolumn dla 5 encji (#3, FK rozwiązywane do stabilnych nazw — nie lokalnych id), oraz rdzeń LWW-merge + tombstony (`shared::sync::merge`). Daemon i dashboard wołają JEDNĄ implementację.
- **Dashboard import/online-sync ujednolicony na semantykę daemona (ZMIANA ZACHOWANIA):** ścieżka importu/restore dashboardu była ROZBIEŻNA z daemonem — brakowało guardów tombstone (skasowany rekord mógł „zmartwychwstać" z nieaktualnego archiwum) i LWW dla `applications` (display_name/updated_at nie propagowały). Teraz dashboard stosuje pełną semantykę daemona. **Konsekwencja dla restore:** przywracanie archiwum NIE wskrzesi rekordu skasowanego lokalnie nowszym tombstonem (świadoma decyzja). **Sesje WYKLUCZONE z unifikacji** — daemon robi prosty upsert po (app, start_time), dashboard `merge_or_insert_session` scala nakładające się interwały (overlap-merge); to celowo różne algorytmy do różnych celów (LAN P2P vs import).
- **Kontrakt FK=OFF dla merge (#5):** rdzeń merge wymaga `PRAGMA foreign_keys=OFF` (sentinel `manual_sessions.project_id=0`; tombstone projektu NIE może CASCADE-skasować sesji manualnych). Daemon `open_dashboard_db` + dashboard `import_archive_with_fk_off` ustawiają OFF; `assert_fk_off` (debug) na wejściu merge jako guardrail. Bez tego dashboard pod pulą FK=ON powodował twardy abort + cichą utratę danych przez CASCADE.
- **Warstwy obronne:** panic-guard wątku master LAN-sync (#4 — panika w merge nie zostawia DB zamrożonej na zawsze); `ensure_*_columns` abortuje merge przy realnym błędzie ALTER zamiast cichego logu (#79).
- **CI (#7) wpięte (`.github/workflows/ci.yml`):** job `rust` (cargo test 3 crate'y, buduje front bo `timeflow-dashboard` osadza `dist` przez `include_dir!`), `frontend` (typecheck/lint/test/build + kontrola driftu `rpc_generated.rs` #18 + knip #17), `quality` (react-doctor), `audit` (cargo-deny advisories+bans + npm audit), oraz **`windows-build`** — kompiluje `timeflow-demon` na `windows-latest`. To **kompilacyjnie weryfikuje** kod `platform/windows/*` (dotąd „nigdy nie budowany" — patrz pozycje „NIEZWERYFIKOWANE na realnym Windows" wyżej; runtime nadal niezweryfikowany, ale compile-check to pierwszy gate przeciw rotcie).
- **Odłożone (świadomie, wymagają żywego renderu/2 maszyn):** eventy postępu sync zamiast pollingu (#74), rozbicie god-files (#9) + dedup komend (#76/#77), sweep `cn()` (#16), split god-hooków (#14), migracja pozostałych ~26 modułów na `CommandError` (#8 — fundament + 3 moduły zrobione).

## Code signing / notarization (macOS) — świadomy dług (audyt 2026-06-17, M4)
- Stan obecny: buildy macOS są **niesygnowane**. `tauri.conf.json` ma
  `macOS.signingIdentity = null`, `entitlements = null`, `providerShortName = null`;
  `build_all_macos.py` **nie** wywołuje `codesign` ani `notarytool`. (Tauri config
  to czysty JSON — nie da się tam zostawić komentarza, stąd notatka tutaj, by `null`
  nie wyglądał na przeoczenie.)
- Konsekwencja: dystrybucja DMG poza App Store → Gatekeeper pokazuje ostrzeżenie
  „niezweryfikowany deweloper"; brak Hardened Runtime.
- Decyzja: na ten etap **bez podpisu** (brak skonfigurowanego Developer ID /
  poświadczeń notaryzacji w repo — i słusznie, sekretów nie trzymamy w repo).
- Ścieżka włączenia, gdy dystrybucja tego wymaga (skille `tauri-code-signing`/
  `tauri-macos-distribution`):
  1. `signingIdentity` = „Developer ID Application: …" (z env/keychain, nie z repo),
     ustaw `entitlements` + Hardened Runtime.
  2. Krok notaryzacji w `build_all_macos.py` (`xcrun notarytool submit … --wait`,
     potem `xcrun stapler staple`).
  3. Weryfikacja artefaktu: `codesign --verify --deep --strict --verbose=2 *.app`
     oraz `spctl -a -vvv *.app` → `accepted`.
