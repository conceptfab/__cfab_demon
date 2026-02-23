#!/usr/bin/env python3
"""
Kompiluje po kolei: demon (timeflow-demon) oraz dashboard (TimeFlow).
Wszystkie pliki wykonywalne trafiają do wspólnego katalogu dist/.
"""
import argparse
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(
        description="Kompilacja demona + dashboard -> dist/",
        epilog="""
Przyklady:
  python build_all.py              # Pelna kompilacja obu modulow
  python build_all.py --no-clean   # Szybsza rekompilacja (bez cargo clean)
  python build_all.py --demon-only # Tylko demon
  python build_all.py --dashboard-only  # Tylko dashboard
        """,
    )
    parser.add_argument(
        "--no-clean",
        action="store_true",
        help="Pomin czyszczenie przed buildem demona",
    )
    parser.add_argument(
        "--demon-only",
        action="store_true",
        help="Kompiluj tylko demon (timeflow-demon)",
    )
    parser.add_argument(
        "--dashboard-only",
        action="store_true",
        help="Kompiluj tylko dashboard",
    )
    args = parser.parse_args()

    build_demon = not args.dashboard_only
    build_dashboard = not args.demon_only

    start_time = time.time()

    # --- Obsługa wersji ---
    version_file = ROOT / "VERSION"
    current_version = "0.0.0"
    if version_file.exists():
        current_version = version_file.read_text().strip()

    print(f"\nAktualna wersja: {current_version}")
    new_version = input(f"Podaj nową wersję (major.minor.release) [Enter aby zostawić {current_version}]: ").strip()
    
    if not new_version:
        new_version = current_version
    
    # Walidacja formatu
    import re
    if not re.match(r"^\d+\.\d+\.\d+$", new_version):
        print(f"BŁĄD: Nieprawidłowy format wersji: {new_version}. Oczekiwano major.minor.release")
        sys.exit(1)
        
    version_file.write_text(new_version)
    print(f"Ustawiono wersję: {new_version}")
    # ----------------------

    DIST = ROOT / "dist"
    DIST.mkdir(parents=True, exist_ok=True)

    if build_demon:
        print("\n" + "=" * 60)
        print("  [1/2] KOMPILACJA DEMONA")
        print("=" * 60)
        cmd = [
            sys.executable,
            str(ROOT / "build_demon.py"),
            "--out-dir", str(DIST),
            "--project-dir", str(ROOT),
        ]
        if args.no_clean:
            cmd.append("--no-clean")
        result = subprocess.run(cmd, cwd=ROOT)
        if result.returncode != 0:
            print("\n   BLAD: Kompilacja demona nie powiodla sie.")
            sys.exit(result.returncode)

    if build_dashboard:
        print("\n" + "=" * 60)
        print("  [2/2] KOMPILACJA DASHBOARDU")
        print("=" * 60)
        result = subprocess.run(
            [sys.executable, str(ROOT / "dashboard_build.py")],
            cwd=ROOT,
        )
        if result.returncode != 0:
            print("\n   BLAD: Kompilacja dashboardu nie powiodla sie.")
            sys.exit(result.returncode)

    elapsed = time.time() - start_time
    print("\n" + "=" * 60)
    print(f"  GOTOWE - Czas: {elapsed:.1f}s")
    print(f"  Katalog: {DIST.absolute()}")
    print("=" * 60)


if __name__ == "__main__":
    main()

