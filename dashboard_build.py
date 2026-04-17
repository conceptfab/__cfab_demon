#!/usr/bin/env python3
"""Build Tauri dashboard for production. Output is copied to dist/."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DASHBOARD = ROOT / "dashboard"
DIST = ROOT / "dist"
FINAL_NAME = "timeflow-dashboard.exe"

# Kod wyjścia dedykowany dla problemu z kopiowaniem (odróżnia od błędu kompilacji).
EXIT_COPY_LOCKED = 2


def _kill_running_dashboard() -> bool:
    """Próbuje zakończyć uruchomione procesy blokujące plik docelowy."""
    killed_any = False
    for image in ("timeflow-dashboard.exe", "TIMEFLOW.exe", "TimeFlow.exe"):
        result = subprocess.run(
            ["taskkill", "/F", "/IM", image],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            print(f"   Zakonczono proces: {image}")
            killed_any = True
    return killed_any


def _cleanup_old_files(dst: Path) -> None:
    """Usuwa stare pliki .old-* pozostawione przez poprzednie buildy."""
    for stale in dst.parent.glob(f"{dst.name}.old-*"):
        try:
            stale.unlink()
        except OSError:
            pass


def _displace_locked(dst: Path) -> bool:
    """Przemianowuje zablokowany plik docelowy — Windows pozwala na rename dzialajacego exe."""
    if not dst.exists():
        return True
    backup = dst.with_name(f"{dst.name}.old-{int(time.time())}")
    try:
        dst.rename(backup)
        print(f"   Zablokowany plik przesuniety do: {backup.name}")
        return True
    except OSError as exc:
        print(f"   Nie udalo sie przemianowac zablokowanego pliku: {exc}")
        return False


def safe_copy(src: Path, dst: Path) -> None:
    """Kopiuje plik; obchodzi lock poprzez kill procesu + rename + copy."""
    _cleanup_old_files(dst)
    try:
        shutil.copy2(src, dst)
        return
    except PermissionError:
        pass

    print(f"\n   Plik docelowy zablokowany, odblokowuje: {dst}")
    _kill_running_dashboard()
    time.sleep(0.8)

    try:
        shutil.copy2(src, dst)
        return
    except PermissionError:
        pass

    if not _displace_locked(dst):
        print(
            "\n   BLAD KOPIOWANIA: nie udalo sie odblokowac pliku docelowego.\n"
            f"   Zrodlo: {src}\n"
            f"   Cel:    {dst}"
        )
        sys.exit(EXIT_COPY_LOCKED)

    try:
        shutil.copy2(src, dst)
    except PermissionError as exc:
        print(
            "\n   BLAD KOPIOWANIA mimo odblokowania:\n"
            f"   Zrodlo: {src}\n"
            f"   Cel:    {dst}\n"
            f"   Szczegoly: {exc}"
        )
        sys.exit(EXIT_COPY_LOCKED)


def main() -> None:
    # Zaladuj .env do srodowiska procesu buildu (runtime app config during build/run scripts).
    env_file = ROOT / ".env"
    if env_file.exists():
        print(f"   Laduje zmienne z {env_file}")
        with open(env_file, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ[k.strip()] = v.strip()

    os.chdir(DASHBOARD)
    result = subprocess.run("npm run tauri build", shell=True)
    if result.returncode != 0:
        sys.exit(result.returncode)

    # Kopiuj wynik do wspólnego dist/
    DIST.mkdir(parents=True, exist_ok=True)
    # Workspace Cargo buduje do root/target/, nie dashboard/src-tauri/target/
    release_dirs = [
        ROOT / "target" / "release",
        DASHBOARD / "src-tauri" / "target" / "release",
    ]
    exe_candidates = ["TIMEFLOW.exe", "TimeFlow.exe", "timeflow-dashboard.exe", "timeflow_dashboard.exe"]
    copied = False
    for release_dir in release_dirs:
        if not release_dir.exists():
            continue
        for exe_name in exe_candidates:
            src_exe = release_dir / exe_name
            if src_exe.exists():
                safe_copy(src_exe, DIST / FINAL_NAME)
                size_mb = (DIST / FINAL_NAME).stat().st_size / (1024 * 1024)
                print(f"\n   Skopiowano: {src_exe} -> dist/{FINAL_NAME} ({size_mb:.2f} MB)")
                copied = True
                break
        if copied:
            break
    if not copied:
        # Szukaj w bundle (nsis/msi) jako fallback
        for release_dir in release_dirs:
            bundle_path = release_dir / "bundle"
            if not bundle_path.exists():
                continue
            for path in bundle_path.rglob("*.exe"):
                if "setup" not in path.name.lower() and "install" not in path.name.lower():
                    safe_copy(path, DIST / FINAL_NAME)
                    print(f"\n   Skopiowano: {path.name} -> dist/{FINAL_NAME}")
                    copied = True
                    break
            if copied:
                break
    if not copied:
        print(f"\n   UWAGA: Nie znaleziono exe dashboardu w żadnym z: {[str(d) for d in release_dirs]}")
        sys.exit(1)


if __name__ == "__main__":
    main()
