# Plan: Port TIMEFLOW na macOS (praca równoległa z Windows)

**Data:** 2026-04-21
**Branch roboczy:** `macos-port`
**Cel:** Uruchomić TIMEFLOW na macOS przy maksymalnym współdzieleniu kodu z wersją Windows. Obie wersje rozwijane równolegle, jedna baza kodu, jeden repo.

---

## 1. Stan obecny — inwentaryzacja

### Cross-platform już teraz (bez zmian)
- `shared/` crate (`timeflow-shared`) — activity_classification, daily_store, monitored_app, process_utils, session_settings, timeflow_paths, version_compat
- `dashboard/` — Tauri v2 + React, z natury multi-platform
- `src/storage.rs` — SQLite (rusqlite bundled)
- `src/config.rs`, `src/i18n.rs`
- `src/activity.rs`, `src/tracker.rs` (logika, bez syscalls)
- Cała logika sync: `lan_*.rs`, `online_sync.rs`, `sftp_client.rs`, `sync_common.rs`, `sync_encryption.rs`

### Windows-only (do wyniesienia za trait)
- `src/tray.rs` — `native-windows-gui`
- `src/foreground_hook.rs` — WinAPI SetWinEventHook
- `src/win_process_snapshot.rs` — tlhelp32
- `src/monitor/wmi_detection.rs`, `src/monitor/pid_cache.rs` — WMI
- `src/firewall.rs` — netsh / Windows Defender Firewall
- `src/single_instance.rs` — Windows named mutex
- Autostart (rejestr HKCU\Run) — rozproszony, do wyjaśnienia

### Zależności Windows-specific w `Cargo.toml`
- `native-windows-gui`
- `winapi` (synchapi, errhandlingapi, winnt, handleapi, winuser, processthreadsapi, winbase, tlhelp32, minwindef, shellapi)
- `wmi` (już jako `[target.'cfg(windows)'.dependencies]`)
- `embed-resource` (build) — tylko Windows potrzebuje

---

## 2. Architektura docelowa

### Warstwa platformowa — trait-based

```
src/
├── platform/
│   ├── mod.rs                 # re-export, factory, traits
│   ├── traits.rs              # wszystkie traity platformowe
│   ├── windows/
│   │   ├── mod.rs
│   │   ├── tray.rs
│   │   ├── foreground.rs
│   │   ├── process_snapshot.rs
│   │   ├── single_instance.rs
│   │   ├── autostart.rs
│   │   └── firewall.rs
│   └── macos/
│       ├── mod.rs
│       ├── tray.rs
│       ├── foreground.rs
│       ├── process_snapshot.rs
│       ├── single_instance.rs
│       ├── autostart.rs
│       └── firewall.rs        # no-op / user-prompt
```

### Traity (minimalny kontrakt)

```rust
// src/platform/traits.rs
pub trait ProcessSnapshot: Send + Sync {
    fn snapshot(&self) -> Vec<ProcessInfo>;
    fn find_by_pid(&self, pid: u32) -> Option<ProcessInfo>;
}

pub trait ForegroundWatcher: Send + Sync {
    fn current_foreground(&self) -> Option<ForegroundWindow>;
    fn subscribe(&self, callback: Box<dyn Fn(ForegroundWindow) + Send>);
}

pub trait Tray: Send {
    fn show(&mut self, menu: TrayMenu) -> Result<()>;
    fn update_icon(&mut self, icon: TrayIcon);
    fn update_tooltip(&mut self, text: &str);
    fn notify(&self, title: &str, body: &str);
}

pub trait SingleInstance {
    fn acquire(app_id: &str) -> Result<Self> where Self: Sized;
}

pub trait Autostart {
    fn is_enabled(&self) -> bool;
    fn enable(&self, exe_path: &Path) -> Result<()>;
    fn disable(&self) -> Result<()>;
}

pub trait Firewall {
    fn ensure_lan_allowed(&self, port: u16, app_name: &str) -> Result<()>;
}
```

### Factory wg `cfg`

```rust
// src/platform/mod.rs
#[cfg(windows)]
mod windows;
#[cfg(target_os = "macos")]
mod macos;

#[cfg(windows)]
pub use windows::*;
#[cfg(target_os = "macos")]
pub use macos::*;
```

Reszta kodu woła `platform::process_snapshot()` i nie wie, który system pod spodem.

---

## 3. Wybór bibliotek dla macOS

| Obszar | Biblioteka | Uwagi |
|---|---|---|
| Tray icon + menu | **`tray-icon` 0.14+** (crate od Tauri) | Win/macOS/Linux — warto ujednolicić też Windows później |
| Foreground window | `objc2` + `objc2-app-kit` + `objc2-foundation` | `NSWorkspace.frontmostApplication`, notyfikacje `NSWorkspaceDidActivateApplicationNotification` |
| Accessibility API (tytuł okna) | `core-foundation` + `accessibility-sys` | wymaga zgody użytkownika — system dialog przy pierwszym uruchomieniu |
| Lista procesów | **`sysinfo` 0.31+** | cross-platform; zastąpi też `win_process_snapshot` długoterminowo |
| Single instance | `fs2` + plik lock w `~/Library/Application Support/TIMEFLOW/timeflow.lock` | `fcntl` flock |
| Autostart | własna implementacja: plist w `~/Library/LaunchAgents/com.kleniewski.timeflow.plist` | `launchctl load/unload` |
| Firewall | **no-op** | macOS sam poprosi użytkownika przy pierwszym bind na LAN |
| Notyfikacje | `mac-notification-sys` lub `tray-icon` wbudowane | proste toast |
| Bundle | `cargo-bundle` albo Tauri bundler | `.app` + `.dmg` + `.icns` |

### Nowe sekcje `Cargo.toml`

```toml
[target.'cfg(target_os = "macos")'.dependencies]
tray-icon = "0.14"
objc2 = "0.5"
objc2-app-kit = { version = "0.2", features = ["NSWorkspace", "NSRunningApplication"] }
objc2-foundation = "0.2"
core-foundation = "0.9"
accessibility-sys = "0.1"
sysinfo = "0.31"
fs2 = "0.4"

[target.'cfg(target_os = "macos")'.build-dependencies]
# brak embed-resource
```

`embed-resource` wchodzi tylko pod `[target.'cfg(windows)'.build-dependencies]`.

---

## 4. Tauri (dashboard) — co dopisać

`dashboard/src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "macOS": {
      "category": "public.app-category.productivity",
      "identifier": "com.kleniewski.timeflow",
      "icon": ["icons/icon.icns"],
      "minimumSystemVersion": "11.0",
      "entitlements": "entitlements.plist",
      "signingIdentity": null,
      "providerShortName": null
    }
  }
}
```

Entitlements (`entitlements.plist`) minimalne:
- `com.apple.security.network.client` (SFTP, HTTP)
- `com.apple.security.network.server` (LAN sync — tylko jeśli sandbox)
- BEZ sandbox na start (prościej, mniej problemów z AX API)

Ikony: wygeneruj `.icns` z istniejącego źródła (`icons.ai`) przez `iconutil` na Macu albo `png2icns`.

---

## 5. Build system i workflow równoległy

### Jedno repo, jedna gałąź

- NIE rób forka na Mac.
- Branch `macos-port` → po scaleniu port `master`.
- Push z Win → pull na Mac → `cargo check` natychmiast łapie rozjazdy.

### Build scripts

`build_demon.py` dopisz gałąź:

```python
if sys.platform == "darwin":
    # cargo build --release --target aarch64-apple-darwin
    # codesign (opcjonalnie)
    # strip
elif sys.platform == "win32":
    # obecna ścieżka
```

Dodaj `Justfile` (albo `Makefile`) dla wygody:

```
check-win:
    cargo check --target x86_64-pc-windows-msvc

check-mac:
    cargo check --target aarch64-apple-darwin

check-all: check-win check-mac
```

Użytkownik przed każdym commitem odpala `just check-all` (o ile ma cross-compile toolchain), albo przynajmniej `cargo check` na swojej platformie + pull na drugiej maszynie.

### CI (opcjonalne, później)

GitHub Actions z `macos-14` i `windows-latest` — `cargo check` + `cargo test` na oba systemy. Na start nie jest krytyczne.

---

## 6. Kolejność prac — 5 faz

### Faza 1: Refactor platformowy (2-4 dni) — BEZ regresji na Windows
- [ ] Utwórz `src/platform/{mod.rs, traits.rs, windows/}`
- [ ] Przenieś `tray.rs` → `platform/windows/tray.rs` + implementuj trait `Tray`
- [ ] Przenieś `foreground_hook.rs` → `platform/windows/foreground.rs`
- [ ] Przenieś `win_process_snapshot.rs` → `platform/windows/process_snapshot.rs`
- [ ] Przenieś `single_instance.rs` → `platform/windows/single_instance.rs`
- [ ] Przenieś `firewall.rs` → `platform/windows/firewall.rs`
- [ ] Wyciągnij autostart (z main.rs / config.rs) → `platform/windows/autostart.rs`
- [ ] Zaktualizuj call-sites — wszędzie `platform::tray()`, `platform::foreground()`, itd.
- [ ] `cargo build --release` na Win: identyczny rezultat. Smoke test: tray działa, monitor śledzi aplikacje, LAN sync działa.
- [ ] **Gate:** bez tego zielony Windows — STOP. Nie ruszaj Maca.

### Faza 2: Kompilacja na Macu (1 dzień)
- [ ] Skonfiguruj `Cargo.toml` — sekcje `cfg(target_os = "macos")`, `embed-resource` tylko na Win
- [ ] Utwórz `src/platform/macos/*.rs` z `unimplemented!()` w każdej metodzie
- [ ] `cargo check --target aarch64-apple-darwin` zielone
- [ ] Na Macu: `cargo build` — musi się skompilować (może panikować w runtime)

### Faza 3: Implementacja modułów macOS (5-10 dni)
Kolejność od najprostszych:
- [ ] `single_instance.rs` — `fs2::FileExt::try_lock_exclusive` na pliku w `~/Library/Application Support/TIMEFLOW/`
- [ ] `process_snapshot.rs` — `sysinfo::System::new_all()` + `refresh_processes()`
- [ ] `autostart.rs` — generowanie plist + `launchctl load -w`
- [ ] `tray.rs` — `tray-icon` crate (menu, ikona, tooltip, click callbacks)
- [ ] `foreground.rs` — `NSWorkspace.sharedWorkspace().frontmostApplication()` + observer; tytuł okna przez AX API (po zgodzie)
- [ ] `firewall.rs` — no-op, log warning że macOS zapyta sam

Po każdym module: smoke test na Macu.

### Faza 4: Dashboard na macOS (1-2 dni)
- [ ] Update `tauri.conf.json` sekcja `macOS`
- [ ] Wygeneruj `.icns`
- [ ] `cargo tauri dev` na Macu
- [ ] Przetestuj komunikację Tauri ↔ daemon na Macu (IPC, pliki, porty)

### Faza 5: Bundling i dystrybucja (osobny sprint, nie blokuje dev)
- [ ] `cargo-bundle` albo Tauri bundler → `.app`
- [ ] Apple Developer ID (99$/rok) — podpis kodu
- [ ] Notaryzacja przez `notarytool`
- [ ] `.dmg` z background image
- [ ] Auto-update (osobny temat)

---

## 7. Ryzyka i mitigacje

| Ryzyko | Mitigacja |
|---|---|
| Accessibility API wymaga ręcznej zgody użytkownika | Pierwsze uruchomienie — pokaż dialog z instrukcją, otwórz Settings > Privacy > Accessibility |
| AX API jest wolne (bywa lag) | Cachuj tytuł okna, odświeżaj tylko przy zmianie frontmost app |
| Brak `wmi` na macOS → inna ścieżka detekcji typu aplikacji | `sysinfo` + `NSRunningApplication.bundleIdentifier` (często lepsze niż WMI) |
| Różnice w ścieżkach (`AppData` vs `~/Library`) | Już rozwiązane w `shared/timeflow_paths.rs` — sprawdź czy obsługuje macOS, jeśli nie dodaj |
| Sync LAN — multicast/UDP może mieć inne zachowanie na macOS | Test wcześnie, w fazie 3 |
| macOS ARM (Apple Silicon) vs Intel | Buduj universal binary: `cargo build --target x86_64-apple-darwin && --target aarch64-apple-darwin`, potem `lipo -create` |
| Regresja na Windows po refactorze | Faza 1 = ZERO zmiany zachowania, tylko reorganizacja. Test end-to-end przed Fazą 2 |

---

## 8. Co NIE wchodzi w zakres tego planu

- Linux (osobny port później, ale architektura go umożliwi — dodaj `platform/linux/`)
- Mobile (iOS/Android)
- Auto-update na macOS (osobny sprint)
- Podpisy / notaryzacja (Faza 5, nie blokuje dev)
- Refactor `monitor/` na trait-based w Faza 1 (tylko przenieść Windows-specific części; wspólna logika zostaje)

---

## 9. Pierwszy krok — jutro rano

1. `git checkout -b macos-port`
2. Zacznij Fazę 1, pierwszy moduł: `single_instance.rs` → `platform/windows/single_instance.rs`
3. Smoke test na Win, commit.
4. Kolejne moduły po kolei, każdy = osobny commit.
5. Po Fazie 1 — merge do master albo zostaw na branchu jako checkpoint, wtedy Faza 2.

---

## 10. Pytania do rozstrzygnięcia (zanim zaczniemy)

1. Apple Developer ID — masz? (99$/rok, bez tego tylko lokalnie albo z `xattr -d com.apple.quarantine`)
2. Docelowa architektura — tylko Apple Silicon (ARM) czy universal (Intel+ARM)?
3. Czy Mac development będzie na Twojej maszynie czy wynajętym CI?
4. Czy chcesz zachować `native-windows-gui` tray długoterminowo, czy zmigrujemy też Windows na `tray-icon` (unifikacja)?

---

**Autor:** Claude (Opus 4.7)
**Status:** do akceptacji
