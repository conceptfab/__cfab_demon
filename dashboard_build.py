#!/usr/bin/env python3
"""Build Tauri dashboard for production. Output is copied to dist/."""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DASHBOARD = ROOT / "dashboard"
DIST = ROOT / "dist"
FINAL_NAME = "timeflow-dashboard.exe"


def main():
    # Zaladuj .env do srodowiska (dla makra option_env! w Rust)
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
    bundle_dir = DASHBOARD / "src-tauri" / "target" / "release"
    # Tauri może wygenerować różne nazwy w zależności od productName / Cargo name
    exe_candidates = ["TimeFlow.exe", "timeflow-dashboard.exe", "timeflow_dashboard.exe"]
    copied = False
    for exe_name in exe_candidates:
        src_exe = bundle_dir / exe_name
        if src_exe.exists():
            shutil.copy2(src_exe, DIST / FINAL_NAME)
            size_mb = (DIST / FINAL_NAME).stat().st_size / (1024 * 1024)
            print(f"\n   Skopiowano: {exe_name} -> dist/{FINAL_NAME} ({size_mb:.2f} MB)")
            copied = True
            break
    if not copied:
        bundle_path = bundle_dir / "bundle"
        if bundle_path.exists():
            for path in bundle_path.rglob("*.exe"):
                if "setup" not in path.name.lower() and "install" not in path.name.lower():
                    shutil.copy2(path, DIST / FINAL_NAME)
                    print(f"\n   Skopiowano: {path.name} -> dist/{FINAL_NAME}")
                    copied = True
                    break
    if not copied:
        print(f"\n   UWAGA: Nie znaleziono exe w {bundle_dir}")
        sys.exit(1)


if __name__ == "__main__":
    main()

