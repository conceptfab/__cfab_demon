#!/usr/bin/env python3
"""
Kompiluje po kolei: demon (timeflow-demon) oraz dashboard (TimeFlow).
Wszystkie pliki wykonywalne trafiają do wspólnego katalogu dist/.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

from build_common import handle_version, build_demon, build_dashboard

ROOT = Path(__file__).resolve().parent


def main() -> None:
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

    do_build_demon = not args.dashboard_only
    do_build_dashboard = not args.demon_only

    start_time = time.time()

    handle_version(ROOT)

    DIST = ROOT / "dist"
    DIST.mkdir(parents=True, exist_ok=True)

    print("\n" + "=" * 60)
    print("  [0/2] WERYFIKACJA TŁUMACZEŃ (i18n)")
    print("=" * 60)
    compare_script = ROOT / "compare_locales.py"
    if compare_script.exists():
        result = subprocess.run([sys.executable, str(compare_script)], cwd=ROOT, capture_output=True, text=True)
        # Tłumaczenia traktujemy jako ostrzeżenie, nie przerywamy builda ale wyświetlamy
        if "(Keys present" in result.stdout or "Empty values" in result.stdout:
            print("\nOSTRZEŻENIE: Wykryto braki/rozbieżności w tłumaczeniach (PL/EN):")
            print(result.stdout)
        else:
            print("OK.")
    else:
        print("Pominięto - brak skryptu compare_locales.py")

    if do_build_demon:
        if not build_demon(ROOT, DIST, args.no_clean):
            sys.exit(1)

    if do_build_dashboard:
        if not build_dashboard(ROOT):
            sys.exit(1)

    elapsed = time.time() - start_time
    print("\n" + "=" * 60)
    print(f"  GOTOWE - Czas: {elapsed:.1f}s")
    print(f"  Katalog: {DIST.absolute()}")
    print("=" * 60)


if __name__ == "__main__":
    main()
