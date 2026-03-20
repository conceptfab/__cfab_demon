#!/usr/bin/env python3
"""Build Tauri dashboard for production. Output is copied to dist/."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DASHBOARD = ROOT / "dashboard"
DIST = ROOT / "dist"
FINAL_NAME = "timeflow-dashboard.exe"


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
                shutil.copy2(src_exe, DIST / FINAL_NAME)
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
                    shutil.copy2(path, DIST / FINAL_NAME)
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
