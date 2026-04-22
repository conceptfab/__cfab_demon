#!/usr/bin/env python3
"""
Build TIMEFLOW na macOS (aarch64-apple-darwin).

Domyślnie: demon pakowany w `TIMEFLOW Demon.app` (LSUIElement=true, menu-bar
agent, bez Docka, bez otwierania Terminala) + dashboard (Tauri .app/.dmg).
Wszystkie artefakty lądują w katalogu ./dist/.

Przykłady:
    python build_all_macos.py                 # Demon.app + dashboard.app
    python build_all_macos.py --no-clean      # Szybsza inkrementalna kompilacja
    python build_all_macos.py --debug         # Binary debug (szybsza, większa)
    python build_all_macos.py --no-dashboard  # Tylko demon (bez Tauri buildu)
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from build_common import handle_version

ROOT = Path(__file__).resolve().parent
DEMON_BIN = "timeflow-demon"
DEMON_PACKAGE = "timeflow-demon"
DEMON_APP_NAME = "TIMEFLOW Demon.app"
DEMON_BUNDLE_ID = "com.timeflow.demon"
DASHBOARD_DIR = ROOT / "dashboard"


def die(msg: str, code: int = 1) -> None:
    print(f"\n   BLAD: {msg}", file=sys.stderr)
    sys.exit(code)


def header(msg: str) -> None:
    print("\n" + "=" * 60)
    print(f"  {msg}")
    print("=" * 60)


def step(title: str) -> None:
    print(f"\n[+] {title}")
    print("-" * 40)


def require_macos() -> None:
    if sys.platform != "darwin":
        die(
            f"Ten skrypt jest przeznaczony wylacznie dla macOS (sys.platform={sys.platform!r}). "
            "Na Windows uzyj build_all.py."
        )


def ensure_cargo() -> None:
    cargo = shutil.which("cargo")
    if cargo is None:
        die(
            "cargo nie znaleziony w PATH. Zainstaluj rustup: https://rustup.rs "
            "i zrobic `source ~/.cargo/env` w tej sesji (albo dopisz do ~/.zshrc)."
        )
    try:
        out = subprocess.check_output([cargo, "--version"], text=True).strip()
        print(f"   {out}")
    except subprocess.CalledProcessError as exc:
        die(f"cargo --version zakonczyl sie bledem: {exc}")


def kill_running_daemon() -> None:
    """Zatrzymuje bieżące instancje timeflow-demon (inaczej plik binarny bywa zablokowany)."""
    try:
        result = subprocess.run(
            ["pgrep", "-f", "target/.*/timeflow-demon"],
            capture_output=True,
            text=True,
        )
        pids = [p for p in result.stdout.split() if p.strip()]
        if not pids:
            return
        print(f"   Znaleziono dzialajacego demona: PID={','.join(pids)} — wysylam SIGTERM")
        subprocess.run(["kill", "-TERM", *pids], check=False)
        # Krotki oddech na clean exit, potem twardy kill jesli trzyma
        time.sleep(0.8)
        still_alive = subprocess.run(
            ["pgrep", "-f", "target/.*/timeflow-demon"],
            capture_output=True,
            text=True,
        ).stdout.split()
        if still_alive:
            subprocess.run(["kill", "-KILL", *still_alive], check=False)
            print(f"   Wymuszony SIGKILL: PID={','.join(still_alive)}")
    except FileNotFoundError:
        # pgrep/kill nie ma — pomijamy
        pass


def compare_locales() -> None:
    """Weryfikuje spójność tłumaczeń PL/EN (jeśli skrypt istnieje)."""
    compare_script = ROOT / "compare_locales.py"
    if not compare_script.exists():
        print("   Pominieto — brak compare_locales.py")
        return
    result = subprocess.run(
        [sys.executable, str(compare_script)], cwd=ROOT, capture_output=True, text=True
    )
    stdout = result.stdout.strip()
    has_missing = any(
        line.strip()
        and not line.strip().startswith(("---", "Missing", "Empty"))
        for line in stdout.splitlines()
    )
    if has_missing:
        print("\n   OSTRZEZENIE: wykryto braki w tlumaczeniach (PL/EN):")
        print(stdout)
    else:
        print("   OK — tlumaczenia PL/EN zsynchronizowane.")


def build_demon(dist: Path, release: bool, no_clean: bool, jobs: int | None) -> Path:
    mode = "release" if release else "debug"

    if not no_clean:
        step(f"[1/2] cargo clean -p {DEMON_PACKAGE}")
        subprocess.run(["cargo", "clean", "-p", DEMON_PACKAGE], cwd=ROOT, check=False)

    step(f"[2/2] cargo build -p {DEMON_PACKAGE} ({mode})")
    cmd: list[str] = ["cargo", "build", "-p", DEMON_PACKAGE]
    if release:
        cmd.append("--release")
    if jobs is not None:
        cmd.extend(["-j", str(jobs)])

    t0 = time.time()
    result = subprocess.run(cmd, cwd=ROOT)
    elapsed = time.time() - t0
    if result.returncode != 0:
        die(f"cargo build zwrocil {result.returncode} po {elapsed:.1f}s")
    print(f"\n   OK — binary gotowy ({elapsed:.1f}s)")

    built = ROOT / "target" / mode / DEMON_BIN
    if not built.exists():
        die(f"Nie znalazlem zbudowanego pliku: {built}")

    dst = dist / DEMON_BIN
    shutil.copy2(built, dst)
    size_mb = dst.stat().st_size / (1024 * 1024)
    print(f"   Skopiowano: {dst} ({size_mb:.2f} MB)")
    return dst


def smoke_test(binary: Path) -> None:
    """Szybki sprawdzian: binarka odpowiada na --version."""
    step("Smoke test: --version")
    try:
        out = subprocess.check_output(
            [str(binary), "--version"], text=True, timeout=10
        ).strip()
        print(f"   {binary.name} --version → {out}")
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
        # Nie zatrzymujemy buildu, ale sygnalizujemy ostrzezenie.
        print(f"   OSTRZEZENIE: smoke test nie powiodl sie: {exc}")


def read_version() -> str:
    """Zwraca zawartość pliku VERSION albo 'dev' jeśli nie istnieje."""
    version_file = ROOT / "VERSION"
    if version_file.exists():
        return version_file.read_text(encoding="utf-8").strip() or "dev"
    return "dev"


def package_demon_app(binary: Path, dist: Path) -> Path:
    """Pakuje binarkę demona w bundle `.app` z LSUIElement=true.

    Dzięki temu dwuklik w Finderze (lub `open TIMEFLOW\\ Demon.app`) uruchamia
    demona jako menu-bar agenta — bez Terminala, bez ikony w Docku.

    Layout:
      TIMEFLOW Demon.app/
        Contents/
          Info.plist
          MacOS/timeflow-demon
          Resources/icon.icns
    """
    step("Pakowanie demona w .app bundle (LSUIElement=true)")
    app_dir = dist / DEMON_APP_NAME
    if app_dir.exists():
        shutil.rmtree(app_dir)

    contents = app_dir / "Contents"
    macos_dir = contents / "MacOS"
    resources_dir = contents / "Resources"
    macos_dir.mkdir(parents=True)
    resources_dir.mkdir(parents=True)

    bundled_bin = macos_dir / DEMON_BIN
    shutil.copy2(binary, bundled_bin)
    os.chmod(bundled_bin, 0o755)

    # Ikona: reużywamy .icns z dashboardu (ta sama tożsamość wizualna).
    icns_src = DASHBOARD_DIR / "src-tauri" / "icons" / "icon.icns"
    has_icon = icns_src.exists()
    if has_icon:
        shutil.copy2(icns_src, resources_dir / "icon.icns")
    else:
        print(f"   OSTRZEZENIE: brak {icns_src} — bundle bez ikony aplikacji.")

    version = read_version()
    icon_key = (
        "    <key>CFBundleIconFile</key>\n    <string>icon</string>\n"
        if has_icon
        else ""
    )
    plist = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
        '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        '<plist version="1.0">\n'
        "<dict>\n"
        "    <key>CFBundleDevelopmentRegion</key>\n    <string>en</string>\n"
        "    <key>CFBundleDisplayName</key>\n    <string>TIMEFLOW Demon</string>\n"
        f"    <key>CFBundleExecutable</key>\n    <string>{DEMON_BIN}</string>\n"
        f"{icon_key}"
        f"    <key>CFBundleIdentifier</key>\n    <string>{DEMON_BUNDLE_ID}</string>\n"
        "    <key>CFBundleInfoDictionaryVersion</key>\n    <string>6.0</string>\n"
        "    <key>CFBundleName</key>\n    <string>TIMEFLOW Demon</string>\n"
        "    <key>CFBundlePackageType</key>\n    <string>APPL</string>\n"
        f"    <key>CFBundleShortVersionString</key>\n    <string>{version}</string>\n"
        f"    <key>CFBundleVersion</key>\n    <string>{version}</string>\n"
        "    <key>CFBundleSignature</key>\n    <string>????</string>\n"
        "    <key>LSMinimumSystemVersion</key>\n    <string>11.0</string>\n"
        # LSUIElement=true → agent app: brak ikony w Docku, brak menu appki,
        # brak Cmd-Tab. Tylko tray w menu barze (NSApplicationActivationPolicy
        # ::Accessory w kodzie ustawia to samo w runtime, ale Info.plist
        # gwarantuje że LaunchServices traktuje bundle właściwie od startu).
        "    <key>LSUIElement</key>\n    <true/>\n"
        "    <key>NSHighResolutionCapable</key>\n    <true/>\n"
        "    <key>NSSupportsAutomaticGraphicsSwitching</key>\n    <true/>\n"
        "</dict>\n"
        "</plist>\n"
    )
    (contents / "Info.plist").write_text(plist, encoding="utf-8")

    size_mb = sum(p.stat().st_size for p in app_dir.rglob("*") if p.is_file()) / (1024 * 1024)
    print(f"   Utworzono: {app_dir} ({size_mb:.2f} MB)")
    print(f"   Uruchomienie: open \"{app_dir}\"")
    return app_dir


def build_dashboard_macos(dist: Path) -> None:
    """Buduje dashboard Tauri na macOS przez lokalny @tauri-apps/cli (npm).

    Oczekiwana kolejność:
      1. `npm install` — jeśli dashboard/node_modules brakuje
      2. `npm run tauri -- build --target aarch64-apple-darwin` — Vite frontend
         (beforeBuildCommand) + cargo build --release + .app/.dmg bundle
    """
    step("Dashboard Tauri (macOS)")
    if not (DASHBOARD_DIR / "src-tauri" / "Cargo.toml").exists():
        print("   Brak dashboard/src-tauri — pomijam.")
        return
    if shutil.which("npm") is None:
        print("   'npm' nie znaleziony w PATH. Zainstaluj Node.js: https://nodejs.org")
        return
    if shutil.which("node") is None:
        print("   'node' nie znaleziony w PATH. Zainstaluj Node.js: https://nodejs.org")
        return

    if not (DASHBOARD_DIR / "node_modules").exists():
        print("   node_modules brakuje — uruchamiam 'npm install'...")
        result = subprocess.run(["npm", "install"], cwd=DASHBOARD_DIR)
        if result.returncode != 0:
            die("npm install zakonczyl sie bledem — sprawdz logi powyzej.")

    # Domyślnie budujemy tylko .app bundle. Tauri próbuje też .dmg, ale to
    # wymaga narzędzia `create-dmg` (brew install create-dmg) — zostawiamy
    # za osobną flagą żeby build nie zawalał się bez tej zależności.
    bundles = "app,dmg" if os.environ.get("TIMEFLOW_BUILD_DMG") == "1" else "app"
    print(f"   cargo tauri build (release, aarch64-apple-darwin, bundles={bundles})...")
    t0 = time.time()
    result = subprocess.run(
        [
            "npm",
            "run",
            "tauri",
            "--",
            "build",
            "--target",
            "aarch64-apple-darwin",
            "--bundles",
            bundles,
        ],
        cwd=DASHBOARD_DIR,
    )
    elapsed = time.time() - t0
    if result.returncode != 0:
        die(
            f"tauri build zakonczyl sie bledem ({result.returncode}) po {elapsed:.1f}s. "
            f"Pelne logi powyzej."
        )
    print(f"   OK — tauri build ({elapsed:.1f}s).")

    # Cargo workspace używa wspólnego target/ w root projektu — Tauri respektuje
    # to ustawienie. Szukamy bundle'a tam, nie w dashboard/src-tauri/target.
    bundle_dir = (
        ROOT / "target" / "aarch64-apple-darwin" / "release" / "bundle" / "macos"
    )
    if bundle_dir.exists():
        for app in bundle_dir.glob("*.app"):
            target = dist / app.name
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(app, target)
            size_mb = sum(p.stat().st_size for p in target.rglob("*") if p.is_file()) / (1024 * 1024)
            print(f"   Skopiowano bundle: {target} ({size_mb:.1f} MB)")
    else:
        print(f"   UWAGA: brak bundle'a w {bundle_dir}")

    # Skopiuj .dmg jeśli powstał (tylko gdy TIMEFLOW_BUILD_DMG=1 + create-dmg dostępne)
    dmg_dir = bundle_dir.parent / "dmg"
    if dmg_dir.exists():
        for dmg in dmg_dir.glob("*.dmg"):
            if dmg.name.startswith("rw."):
                continue  # artefakt z tymczasowego mount (nieudany bundle)
            shutil.copy2(dmg, dist / dmg.name)
            print(f"   Skopiowano: {dist / dmg.name}")


def main() -> None:
    require_macos()

    parser = argparse.ArgumentParser(
        description="Kompilacja TIMEFLOW Demon na macOS → dist/",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--no-clean",
        action="store_true",
        help="Pomin 'cargo clean -p timeflow-demon' przed buildem (inkrementalnie).",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Tryb debug zamiast release (szybsze kompilowanie, wieksza binarka).",
    )
    parser.add_argument(
        "--jobs",
        "-j",
        type=int,
        default=None,
        help="Ograniczenie liczby watkow cargo (np. -j 1 przy bledach linkera).",
    )
    parser.add_argument(
        "--out-dir",
        type=str,
        default="dist",
        help="Katalog docelowy dla artefaktow (domyslnie: dist).",
    )
    parser.add_argument(
        "--no-dashboard",
        action="store_true",
        help="Pomin build dashboardu Tauri (domyslnie budowany razem z demonem).",
    )
    parser.add_argument(
        "--no-app-bundle",
        action="store_true",
        help="Nie pakuj demona w TIMEFLOW Demon.app (zostaw goła binarke).",
    )
    parser.add_argument(
        "--skip-version",
        action="store_true",
        help="Pomin interaktywna aktualizacje pliku VERSION.",
    )
    parser.add_argument(
        "--skip-smoke",
        action="store_true",
        help="Pomin smoke-test '--version' po buildzie.",
    )
    args = parser.parse_args()

    start = time.time()
    header("TIMEFLOW — build macOS (aarch64-apple-darwin)")

    step("Weryfikacja srodowiska")
    ensure_cargo()
    print(f"   ROOT: {ROOT}")

    step("Zatrzymanie dzialajacych instancji demona")
    kill_running_daemon()

    if not args.skip_version:
        step("Wersja")
        handle_version(ROOT)

    step("Weryfikacja tlumaczen (i18n)")
    compare_locales()

    dist = ROOT / args.out_dir
    dist.mkdir(parents=True, exist_ok=True)

    binary = build_demon(dist, release=not args.debug, no_clean=args.no_clean, jobs=args.jobs)

    if not args.skip_smoke:
        smoke_test(binary)

    demon_app: Path | None = None
    if not args.no_app_bundle:
        demon_app = package_demon_app(binary, dist)
    else:
        step("Pakowanie demona w .app")
        print("   Pominieto (--no-app-bundle) — w dist/ zostaje goła binarka.")

    if not args.no_dashboard:
        build_dashboard_macos(dist)
    else:
        step("Dashboard (Tauri)")
        print("   Pominieto (--no-dashboard).")

    elapsed = time.time() - start
    header(f"GOTOWE — czas {elapsed:.1f}s")
    print(f"   Katalog wyjsciowy: {dist}")
    if demon_app is not None:
        print(f"   Daemon bundle:     {demon_app}")
    print(f"   Daemon binary:     {binary}")
    print()
    print("   Uruchomienie (bez terminala, rekomendowane):")
    if demon_app is not None:
        print(f"     open \"{demon_app}\"")
        print(f"     # albo dwuklik w Finderze na \"{DEMON_APP_NAME}\"")
    print()
    print("   Uruchomienie CLI (z terminalem):")
    print(f"     {binary}                                     # foreground")
    print(f"     nohup {binary} > /dev/null 2>&1 &            # background")
    print()
    print("   Dane uzytkownika lada w:")
    print("     ~/Library/Application Support/TimeFlow/       # config, DB, logi")
    print("     ~/Library/Application Support/TimeFlow/logs/daemon.log")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n   Przerwano (Ctrl+C)")
        sys.exit(130)
