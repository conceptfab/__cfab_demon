#!/usr/bin/env python3
"""
Wspólna logika dla build.py i dev.py — projekt TimeFlow Demon.
"""

import subprocess
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

