#!/usr/bin/env python3
"""
Szybki skrypt do testów developerskich - TimeFlow Demon
Minimalne kroki, bez czyszczenia, tryb debug.
"""

import subprocess
import sys
import os
import time
import argparse
from pathlib import Path

from build_common import CargoProjectBase


class DevRunner(CargoProjectBase):
    def run(self, cmd: list[str], desc: str, live: bool = False) -> bool:
        ok, _ = self.run_command(cmd, desc, live_output=live)
        return ok

    def check(self) -> bool:
        """cargo check – szybka weryfikacja składni."""
        return self.run(["cargo", "check"], "Sprawdzanie składni")

    def test(self, nocapture: bool = False) -> bool:
        """cargo test – testy jednostkowe."""
        cmd = ["cargo", "test"]
        if nocapture:
            cmd.extend(["--", "--nocapture"])
        return self.run(cmd, "Testy jednostkowe", live=True)

    def build_debug(self) -> bool:
        """cargo build (debug) – szybka kompilacja."""
        return self.run(["cargo", "build"], "Kompilacja debug", live=True)

    def run_demon(self) -> bool:
        """cargo run – uruchomienie demona w trybie debug."""
        env = os.environ.copy()
        env.setdefault("RUST_LOG", "debug")
        print("\n  >>> Uruchamianie DEMONA (Ctrl+C = stop) <<<")
        try:
            subprocess.run(
                ["cargo", "run", "--bin", "timeflow-demon"],
                cwd=self.project_dir,
                check=True,
                env=env,
            )
        except KeyboardInterrupt:
            print("\n  Demon zatrzymany.")
        except subprocess.CalledProcessError as e:
            print(f"  BŁĄD: kod {e.returncode}")
            return False
        return True


def main():
    p = argparse.ArgumentParser(
        description="Szybkie testy developerskie – TimeFlow Demon",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Przykłady:
  python demon_dev.py              # check + test (domyślne)
  python demon_dev.py -c           # tylko check
  python demon_dev.py -t           # tylko testy
  python demon_dev.py -b           # build debug
  python demon_dev.py -r           # uruchom demona
  python demon_dev.py -ct          # check + test
        """,
    )
    p.add_argument("-c", "--check", action="store_true", help="cargo check")
    p.add_argument("-t", "--test", action="store_true", help="cargo test")
    p.add_argument("-b", "--build", action="store_true", help="cargo build (debug)")
    p.add_argument("-r", "--run", action="store_true", help="uruchom demona")
    p.add_argument("--nocapture", action="store_true", help="testy z pełnym stdout")
    p.add_argument("--project-dir", default=".", help="katalog projektu")
    args = p.parse_args()

    runner = DevRunner(args.project_dir)
    if not runner.check_cargo_project():
        sys.exit(1)

    # Domyślnie: check + test
    if not any([args.check, args.test, args.build, args.run]):
        args.check = True
        args.test = True

    start_time = time.time()
    ok = True

    if args.check:
        print("\n[1] Check")
        ok = runner.check() and ok
    if args.test:
        print("\n[2] Test")
        ok = runner.test(nocapture=args.nocapture) and ok
    if args.build:
        print("\n[3] Build Debug")
        ok = runner.build_debug() and ok
    if args.run:
        runner.run_demon()

    elapsed = time.time() - start_time
    print(f"\nCzas operacji: {elapsed:.1f}s")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()

