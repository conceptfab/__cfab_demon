#!/usr/bin/env python3
"""
Wspólna logika dla build.py i dev.py — projekt TimeFlow Demon.
"""

import re
import subprocess
import sys
from pathlib import Path
from typing import Optional


class CargoProjectBase:
    """Bazowa klasa z wspólną logiką dla projektów Cargo."""

    def __init__(self, project_dir: str = "."):
        self.project_dir = Path(project_dir).resolve()
        self.cargo_toml = self.project_dir / "Cargo.toml"

    def check_cargo_project(self) -> bool:
        """Sprawdza czy to jest prawidłowy projekt Cargo."""
        if not self.cargo_toml.exists():
            print(f"BŁĄD: Brak Cargo.toml w {self.project_dir}")
            return False
        return True

    def run_command(
        self,
        command: list[str],
        description: str,
        live_output: bool = False,
        cwd: Optional[Path] = None,
    ) -> tuple[bool, subprocess.CompletedProcess | subprocess.CalledProcessError | Exception]:
        """Uruchamia komendę i zwraca (sukces, wynik)."""
        work_dir = cwd or self.project_dir
        print(f"  {description}...")
        try:
            if live_output:
                result = subprocess.run(command, cwd=work_dir, check=True)
                return True, result
            result = subprocess.run(
                command,
                cwd=work_dir,
                capture_output=True,
                text=True,
                check=True,
            )
            if result.stdout:
                print(result.stdout)
            return True, result
        except subprocess.CalledProcessError as e:
            print(f"  BŁĄD: {description}")
            if e.stderr:
                print(e.stderr)
            return False, e
        except Exception as e:
            print(f"  BŁĄD: {e}")
            return False, e


def handle_version(root: Path) -> str:
    """Obsługa wersji: odczyt, input, walidacja, zapis. Zwraca wybraną wersję."""
    version_file = root / "VERSION"
    current_version = "0.0.0"
    if version_file.exists():
        current_version = version_file.read_text().strip()

    print(f"\nAktualna wersja: {current_version}")
    new_version = input(
        f"Podaj nową wersję (major.minor.release) [Enter aby zostawić {current_version}]: "
    ).strip()

    if not new_version:
        new_version = current_version

    if not re.match(r"^\d+\.\d+\.\d+$", new_version):
        print(f"BŁĄD: Nieprawidłowy format wersji: {new_version}. Oczekiwano major.minor.release")
        sys.exit(1)

    version_file.write_text(new_version)
    print(f"Ustawiono wersję: {new_version}")
    return new_version


def build_demon(root: Path, dist: Path, no_clean: bool = False) -> bool:
    """Kompiluje demona. Zwraca True jeśli sukces."""
    print("\n" + "=" * 60)
    print("  [1/2] KOMPILACJA DEMONA")
    print("=" * 60)
    cmd = [
        sys.executable,
        str(root / "build_demon.py"),
        "--out-dir", str(dist),
        "--project-dir", str(root),
    ]
    if no_clean:
        cmd.append("--no-clean")
    result = subprocess.run(cmd, cwd=root)
    if result.returncode != 0:
        print("\n   BLAD: Kompilacja demona nie powiodla sie.")
        return False
    return True


def build_dashboard(root: Path) -> bool:
    """Kompiluje dashboard. Zwraca True jeśli sukces."""
    print("\n" + "=" * 60)
    print("  [2/2] KOMPILACJA DASHBOARDU")
    print("=" * 60)
    result = subprocess.run(
        [sys.executable, str(root / "dashboard_build.py")],
        cwd=root,
    )
    if result.returncode != 0:
        print("\n   BLAD: Kompilacja dashboardu nie powiodla sie.")
        return False
    return True
