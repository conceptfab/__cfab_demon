# PARITY — różnice Windows ⇄ macOS

Tracker znanych różnic w zachowaniu i stubów między platformami.

| Obszar | macOS | Windows | Status / TODO |
|---|---|---|---|
| Tray — opcje sync gdy sync niemożliwy (wyłączony LUB brak peera) | Cały blok sync (status + 2 przyciski + separator) jest **ukrywany** z menu (muda `Menu::insert`/`remove`). | Przyciski **wyszarzone** + status „Sync: niedostępny" (nwg nie pozwala czysto usuwać/wstawiać pozycji menu w runtime, zwł. separatorów). | TODO: zaimplementować pełne ukrywanie na Windows przez Win32 `RemoveMenu`/`InsertMenuW` i **zweryfikować na realnym buildzie Windows** (cross-compile z macOS pada na zależności C `libsqlite3-sys`). |
| Detekcja statusu demona — zawężenie do zarządzanej binarki (`commands/daemon/mod.rs::query_daemon_process_status`) | `pgrep -f <pełna_ścieżka_z_find_daemon_exe>` zamiast gołej nazwy. Zweryfikowane na macu (demon startuje z absolutną ścieżką jako argv[0]). | `Get-CimInstance Win32_Process` + porównanie pełnej `ExecutablePath`; fallback do `tasklist /FI IMAGENAME` przy każdym błędzie/braku ścieżki. **NIEZWERYFIKOWANE na realnym Windows** (cross-compile pada). Ryzyko: quoting `-Command` w std::process oraz teoretyczny fałszywy „Stopped", gdy PowerShell zwróci sukces z pustym wyjściem. | TODO: zweryfikować scoped query na realnym buildzie Windows; rozważyć `-EncodedCommand` dla pewnego quotingu. |

## Notatki
- Sygnał obecności peera: `LanSyncState.peer_present` (AtomicBool) aktualizowany w pętli `lan_discovery` na podstawie `!peers.is_empty()`; czytany przez oba traye.
- Warunek dostępności sync w trayu: `config::load_lan_sync_settings().enabled && peer_present`.

## Parity wersji (LAN sync)
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
