#!/usr/bin/env python3
"""
Kompiluje po kolei: demon (timeflow-demon) oraz dashboard (TimeFlow).
Wszystkie pliki wykonywalne trafiają do wspólnego katalogu dist/.
"""
import argparse
import sys
import time
import zipfile
from pathlib import Path

from build_common import handle_version, build_demon, build_dashboard

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(
        description="Kompilacja demona + dashboard -> dist/",
        epilog="""
Przyklady:
  python build_release.py              # Pelna kompilacja obu modulow + ZIP
  python build_release.py --no-clean   # Szybsza rekompilacja (bez cargo clean)
  python build_release.py --no-zip     # Kompilacja bez tworzenia archiwum ZIP
  python build_release.py --demon-only # Tylko demon
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
    parser.add_argument(
        "--no-zip",
        action="store_true",
        help="Pomin tworzenie archiwum ZIP po kompilacji",
    )
    parser.add_argument(
        "--send",
        action="store_true",
        help="Stworz archiwum ZIP i przygotuj do wyslania",
    )
    args = parser.parse_args()

    do_build_demon = not args.dashboard_only
    do_build_dashboard = not args.demon_only

    start_time = time.time()

    new_version = handle_version(ROOT)

    DIST = ROOT / "dist"
    DIST.mkdir(parents=True, exist_ok=True)

    if do_build_demon:
        if not build_demon(ROOT, DIST, args.no_clean):
            sys.exit(1)

    if do_build_dashboard:
        if not build_dashboard(ROOT):
            sys.exit(1)

    should_zip = (not args.no_zip) or args.send
    if should_zip:
        zip_path = zip_artifacts(DIST, new_version)
        if args.send:
            send_artifacts(zip_path)

    elapsed = time.time() - start_time
    print("\n" + "=" * 60)
    print(f"  GOTOWE - Czas: {elapsed:.1f}s")
    print(f"  Katalog: {DIST.absolute()}")
    print("=" * 60)


def zip_artifacts(dist_dir: Path, version: str) -> Path:
    """Tworzy archiwum ZIP z binarkami w katalogu głównym."""
    print("\n" + "=" * 60)
    print(f"  PAKIETOWANIE (ZIP): wersja {version}")
    print("=" * 60)

    zip_name = f"TIMEFLOW_v{version}.zip"
    zip_path = dist_dir / zip_name

    files_to_zip = [
        "timeflow-demon.exe",
        "timeflow-dashboard.exe"
    ]

    found_files = []
    for f in files_to_zip:
        p = dist_dir / f
        if p.exists():
            found_files.append(p)
        else:
            print(f"   UWAGA: Nie znaleziono pliku {f} w {dist_dir}")

    if not found_files:
        print("   BŁĄD: Brak plików do spakowania!")
        return zip_path

    try:
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
            for p in found_files:
                print(f"   Dodaje: {p.name}")
                z.write(p, arcname=p.name)

        print(f"  GOTOWE: {zip_path.absolute()}")
    except Exception as e:
        print(f"   BŁĄD podczas tworzenia ZIP: {e}")

    return zip_path


def send_artifacts(zip_path: Path):
    """Placeholder dla funkcji wysylania."""
    print("\n" + "=" * 60)
    print("  WYSYŁANIE ARTEFAKTÓW")
    print("=" * 60)
    if zip_path.exists():
        print(f"   Plik {zip_path.name} jest gotowy do wysłania.")
        print(f"   Lokalizacja: {zip_path.absolute()}")
        # Tutaj mozna dodac logike uploadu (np. scp, ftp, api)
        print("   [INFO] Funkcja wysyłania (send) działa obecnie jako placeholder.")
    else:
        print(f"   BŁĄD: Plik {zip_path} nie istnieje!")


if __name__ == "__main__":
    main()
