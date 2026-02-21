#!/usr/bin/env python3
"""
Automatyczny skrypt kompilacji dla aplikacji Cfab Demon
Autor: Projekt Cfab Demon - Windows Tray Daemon
"""

import subprocess
import sys
import os
import time
import argparse
import shutil
from pathlib import Path
from typing import Optional

from build_common import CargoProjectBase


class RustBuilder(CargoProjectBase):
    def _read_package_version(self) -> Optional[str]:
        """Odczytuje wersję pakietu z Cargo.toml."""
        try:
            content = self.cargo_toml.read_text(encoding="utf-8")
        except Exception:
            return None
        try:
            import tomllib
            data = tomllib.loads(content)
            ver = data.get("package", {}).get("version")
            return str(ver).strip() if isinstance(ver, str) else None
        except Exception:
            pass
        for line in content.splitlines():
            line = line.strip()
            if line.startswith("version") and "=" in line:
                try:
                    return line.split("=", 1)[1].strip().strip('"')
                except Exception:
                    pass
        return None

    def detect_bin_name(self) -> Optional[str]:
        """Wykrywa nazwę binarki na podstawie Cargo.toml."""
        try:
            content = self.cargo_toml.read_text(encoding="utf-8")
        except Exception:
            return None
        try:
            import tomllib
            data = tomllib.loads(content)
            bin_tables = data.get("bin")
            if isinstance(bin_tables, list) and bin_tables:
                name = bin_tables[0].get("name")
                if isinstance(name, str) and name.strip():
                    return name.strip()
            pkg_name = data.get("package", {}).get("name")
            if isinstance(pkg_name, str) and pkg_name.strip():
                return pkg_name.strip()
        except Exception:
            pass
        # Prosty parser liniowy jako fallback
        lines = content.splitlines()
        in_package = False
        for raw_line in lines:
            line = raw_line.strip()
            if line.startswith("[package]"):
                in_package = True
                continue
            if in_package:
                if line.startswith("[") and not line.startswith("[package]"):
                    break
                if line.startswith("name") and "=" in line:
                    try:
                        name_part = line.split("=", 1)[1].strip()
                        if name_part.startswith('"') and '"' in name_part[1:]:
                            name = name_part.split('"')[1]
                            if name:
                                return name
                    except Exception:
                        pass
        return None

    def print_header(self, message):
        """Wyswietla naglowek z ramka."""
        print("\n" + "=" * 60)
        print(f"  {message}")
        print("=" * 60)

    def print_step(self, step, message):
        """Wyswietla krok z numerem."""
        print(f"\n[{step}] {message}")
        print("-" * 40)

    def check_rust_environment(self) -> bool:
        """Sprawdza czy cargo i rustc sa dostepne w PATH."""
        print("Weryfikacja srodowiska Rust...")
        ok = True
        for cmd, name in [
            (["cargo", "--version"], "cargo"),
            (["rustc", "--version"], "rustc"),
        ]:
            try:
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=5,
                    cwd=self.project_dir,
                )
                if result.returncode == 0 and result.stdout.strip():
                    ver = result.stdout.strip().split("\n")[0]
                    print(f"   OK: {ver}")
                else:
                    print(f"   BLAD: {name}: nie znaleziono lub blad")
                    ok = False
            except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
                print(f"   BLAD: {name}: {e}")
                ok = False
        if not ok:
            print("   Podpowiedz: Zainstaluj Rust (rustup) z https://rustup.rs")
        return ok

    def kill_running_instances(self) -> list[str]:
        """Ubija dzialajace instancje demona (tylko cfab-demon.exe). Nie ubija rustc/cargo — moglyby to byc inne projekty."""
        if os.name != "nt":
            return []
        process_names = ["cfab-demon.exe"]
        killed = []
        for name in process_names:
            try:
                result = subprocess.run(
                    ["taskkill", "/F", "/IM", name],
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                if result.returncode == 0:
                    killed.append(name)
            except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
                pass
        if killed:
            print(f"   Zakonczone procesy: {', '.join(killed)}")
            time.sleep(0.5)
        print("   Srodowisko gotowe do kompilacji")
        return killed

    def check_cargo_project(self) -> bool:
        """Sprawdza czy to jest prawidlowy projekt Cargo."""
        if not super().check_cargo_project():
            print("   Upewnij sie, ze uruchamiasz skrypt w katalogu projektu Rust.")
            return False
        return True

    def _get_error_hint(self, command: list[str]) -> str:
        """Zwraca podpowiedz w zaleznosci od nieudanej komendy."""
        cmd_str = " ".join(command)
        if "clean" in cmd_str:
            return "Upewnij sie, ze zadne procesy cargo/rustc nie blokuja plikow."
        if "build" in cmd_str or "check" in cmd_str:
            return "Sprawdz bledy powyzej. Przydatne: cargo check, cargo clippy"
        if "test" in cmd_str:
            return "Sprawdz bledy powyzej. Wiecej szczegolow: cargo test -- --nocapture"
        return "Sprawdz logi powyzej i dokumentacje projektu."

    def run_command(self, command, description, live_output=False):
        """Uruchamia komende i zwraca wynik."""
        print(f"   {description}...")
        print(f"   Komenda: {' '.join(command)}")

        start_time = time.time()

        try:
            if live_output:
                result = subprocess.run(
                    command, cwd=self.project_dir, check=True
                )
                elapsed = time.time() - start_time
                print(f"   OK: {description} ukonczone w {elapsed:.2f}s")
                return True, result
            else:
                result = subprocess.run(
                    command,
                    cwd=self.project_dir,
                    capture_output=True,
                    text=True,
                    check=True,
                )

            elapsed = time.time() - start_time
            print(f"   OK: {description} ukonczone w {elapsed:.2f}s")

            if getattr(result, 'stdout', None):
                print("   Stdout:")
                print(result.stdout)

            if getattr(result, 'stderr', None):
                print("   Stderr:")
                print(result.stderr)

            return True, result

        except subprocess.CalledProcessError as e:
            elapsed = time.time() - start_time
            print(f"   BLAD: {description} nie powiodlo sie po {elapsed:.2f}s")
            print(f"   Kod bledu: {e.returncode}")

            if e.stdout:
                print("   Stdout:")
                print(e.stdout)

            if e.stderr:
                print("   Stderr:")
                print(e.stderr)

            hint = self._get_error_hint(command)
            print(f"   Podpowiedz: {hint}")

            return False, e

        except Exception as e:
            print(f"   BLAD: Nieoczekiwany blad: {e}")
            print("   Podpowiedz: Sprawdz czy cargo jest w PATH.")
            return False, e

    def clean_build(self, verbose=False):
        """Czysci poprzednia kompilacje."""
        self.print_step("1", "Czyszczenie poprzedniej kompilacji")

        success, _ = self.run_command(
            ["cargo", "clean"],
            "Czyszczenie cache kompilacji",
            live_output=verbose,
        )

        if success:
            target_dir = self.project_dir / "target"
            if target_dir.exists():
                print(f"   UWAGA: Folder target nadal istnieje: {target_dir}")
            else:
                print("   Folder target wyczyszczony")

        return success

    def check_project(self):
        """Sprawdza projekt bez kompilacji (cargo check)."""
        self.print_step("2", "Sprawdzanie skladni i typow")

        success, _ = self.run_command(
            ["cargo", "check"], "Sprawdzanie skladni"
        )
        return success

    def run_clippy(self):
        """Uruchamia cargo clippy do analizy statycznej."""
        self.print_step("2b", "Analiza statyczna (clippy)")

        success, _ = self.run_command(
            ["cargo", "clippy", "--", "-W", "clippy::all"],
            "Analiza clippy",
        )
        return success

    def build_project(self, release=True):
        """Kompiluje projekt."""
        mode = "release" if release else "debug"
        self.print_step("3", f"Kompilacja projektu (tryb: {mode})")

        command = ["cargo", "build"]
        if release:
            command.append("--release")

        success, _ = self.run_command(
            command,
            f"Kompilacja w trybie {mode}",
            live_output=True,
        )

        if success:
            detected_bin = self.detect_bin_name()
            exe_dir = "release" if release else "debug"
            if detected_bin:
                exe_name = f"{detected_bin}.exe" if os.name == "nt" else detected_bin
                exe_path = self.project_dir / "target" / exe_dir / exe_name
                if exe_path.exists():
                    size = exe_path.stat().st_size / (1024 * 1024)
                    print(f"   Plik wykonywalny: {exe_path}")
                    print(f"   Rozmiar: {size:.2f} MB")
                else:
                    print(f"   UWAGA: Nie znaleziono pliku: {exe_path}")
            else:
                print("   UWAGA: Nie udalo sie wykryc nazwy binarki z Cargo.toml")

        return success

    def build_final(
        self,
        out_dir: str = "dist",
        clean: bool = True,
        verbose: bool = False,
        jobs: Optional[int] = None,
    ) -> bool:
        """Buduje binarkę w trybie release i kopiuje do katalogu wyjściowego."""
        demon_name = "cfab-demon"

        self.print_header("FINALNY BUILD - CFAB DEMON")
        print(f"   Katalog projektu: {self.project_dir}")
        print(f"   Tryb kompilacji:  release")
        print(f"   Binarka:          {demon_name}")
        print(f"   Katalog wyjsciowy: {out_dir}")

        if not self.check_cargo_project():
            return False

        # Czyszczenie
        if clean:
            self.print_step("1", "Czyszczenie katalogu 'target'")
            self.clean_build(verbose=verbose)

        # Kompilacja release
        self.print_step("2", "Kompilacja binarek (release)")
        cmd = ["cargo", "build", "--release"]
        if jobs is not None:
            cmd.extend(["-j", str(jobs)])
        
        ok, _ = self.run_command(cmd, "Kompilacja binarki (release)", live_output=True)
        if not ok:
            return False

        # Weryfikacja i kopiowanie artefaktów
        self.print_step("3", "Kopiowanie artefaktow do katalogu wyjsciowego")
        out_path = self.project_dir / out_dir
        out_path.mkdir(parents=True, exist_ok=True)
        
        target_dir = self.project_dir / "target" / "release"

        for name in [demon_name]:
            built_exe = f"{name}.exe" if os.name == "nt" else name
            built_path = target_dir / built_exe
            final_path = out_path / built_exe
            
            if built_path.exists():
                try:
                    shutil.copy2(built_path, final_path)
                    size_mb = final_path.stat().st_size / (1024 * 1024)
                    print(f"   Skopiowano: {built_exe} ({size_mb:.2f} MB)")
                except Exception as e:
                    print(f"   BLAD: Kopiowanie {built_exe} nie powiodlo sie: {e}")
                    return False
            else:
                print(f"   BLAD: Nie znaleziono skompilowanego pliku: {built_path}")
                return False

        pkg_version = self._read_package_version()
        print(f"\n   === WYNIK ===")
        print(f"   Katalog: {out_path}")
        print(f"   Wersja:  {pkg_version or '?'}")
        return True

    def full_build_and_run(self, release=True, run_tests=False, verbose=False):
        """Pelny proces: czyszczenie, kompilacja, opcjonalne testy i uruchomienie."""
        self.print_header("KOMPILACJA PROJEKTU CFAB DEMON")

        if not self.check_cargo_project():
            return False

        print(f"   Katalog projektu: {self.project_dir}")
        print(f"   Tryb kompilacji:  {'release' if release else 'debug'}")

        # Krok 1: Czyszczenie
        if not self.clean_build(verbose=verbose):
            print("\n   BLAD: Proces przerwany na etapie czyszczenia")
            return False

        # Krok 2: Kompilacja
        if not self.build_project(release):
            print("\n   BLAD: Proces przerwany na etapie kompilacji")
            return False

        # Krok 3: Testy (opcjonalnie)
        if run_tests:
            self.print_step("4", "Uruchamianie testow")
            success, _ = self.run_command(
                ["cargo", "test"], "Testy jednostkowe"
            )
            if not success:
                print("   UWAGA: Testy nie przeszly, ale kontynuujemy...")

        print("\n   Kompilacja zakonczona pomyslnie!")
        self.run_application(release=release)

        return True

    def run_application(self, release=True):
        """Uruchamia aplikacje."""
        self.print_step("RUN", "Uruchamianie demona")

        command = ["cargo", "run"]
        if release:
            command.append("--release")

        # Ustawiamy RUST_LOG zeby widziec logi demona
        env = os.environ.copy()
        env.setdefault("RUST_LOG", "info")

        print(f"   Komenda: {' '.join(command)}")
        print(f"   RUST_LOG={env.get('RUST_LOG', '')}")
        print("   (Nacisnij Ctrl+C aby zatrzymac)")

        try:
            subprocess.run(command, cwd=self.project_dir, check=True, env=env)
        except KeyboardInterrupt:
            print("\n   Demon zatrzymany przez uzytkownika")
        except subprocess.CalledProcessError as e:
            print(f"\n   BLAD: Demon zakonczyl sie bledem (kod: {e.returncode})")


def main():
    parser = argparse.ArgumentParser(
        description="Automatyczny skrypt kompilacji dla projektu Cfab Demon",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Przyklady uzycia:
  python build.py                    # Finalny build -> dist/
  python build.py --run              # Kompilacja + uruchomienie
  python build.py --debug --run      # Debug + uruchomienie (z logami)
  python build.py --check-only       # Tylko sprawdzenie skladni
  python build.py --clippy           # Analiza statyczna clippy
  python build.py --clean-only       # Tylko czyszczenie
  python build.py --no-clean         # Build bez czyszczenia (szybszy)
  python build.py --jobs 1           # Ogranicz paralelizm (przy bledach linkera)
        """,
    )

    parser.add_argument(
        "--debug",
        action="store_true",
        help="Kompiluj w trybie debug (domyslnie: release)",
    )

    parser.add_argument(
        "--run",
        action="store_true",
        help="Uruchom demona po kompilacji",
    )

    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Pokaz szczegolowe wyjscie podczas kompilacji",
    )

    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Tylko sprawdz skladnie, nie kompiluj",
    )

    parser.add_argument(
        "--clippy",
        action="store_true",
        help="Uruchom analize statyczna cargo clippy",
    )

    parser.add_argument(
        "--clean-only",
        action="store_true",
        help="Tylko wyczysc cache kompilacji",
    )

    parser.add_argument(
        "--no-clean",
        action="store_true",
        help="Pomin czyszczenie przed buildem (szybsza rekompilacja)",
    )

    parser.add_argument(
        "--out-dir",
        type=str,
        default="dist",
        help="Katalog docelowy dla finalnego pliku (domyslnie: dist)",
    )

    parser.add_argument(
        "--jobs",
        type=int,
        default=None,
        metavar="N",
        help="Liczba zadan cargo (np. 1 przy bledach linkera LNK1104)",
    )

    parser.add_argument(
        "--project-dir",
        type=str,
        default=".",
        help="Sciezka do katalogu projektu (domyslnie: biezacy katalog)",
    )

    args = parser.parse_args()

    builder = RustBuilder(args.project_dir)

    try:
        # Weryfikacja srodowiska
        if not builder.check_rust_environment():
            print("\n   BLAD: Srodowisko Rust nie jest gotowe.")
            print("   Zainstaluj rustup: https://rustup.rs")
            sys.exit(1)

        # Ubij dzialajace instancje
        builder.kill_running_instances()

        start_time = time.time()

        if args.clean_only:
            builder.print_header("CZYSZCZENIE CACHE KOMPILACJI")
            if not builder.check_cargo_project():
                sys.exit(1)
            success = builder.clean_build()
            elapsed = time.time() - start_time
            print(f"\n   Czas: {elapsed:.1f}s")
            sys.exit(0 if success else 1)

        elif args.check_only:
            builder.print_header("SPRAWDZANIE SKLADNI PROJEKTU")
            if not builder.check_cargo_project():
                sys.exit(1)
            success = builder.check_project()
            elapsed = time.time() - start_time
            print(f"\n   Czas: {elapsed:.1f}s")
            sys.exit(0 if success else 1)

        elif args.clippy:
            builder.print_header("ANALIZA STATYCZNA - CLIPPY")
            if not builder.check_cargo_project():
                sys.exit(1)
            success = builder.run_clippy()
            elapsed = time.time() - start_time
            print(f"\n   Czas: {elapsed:.1f}s")
            sys.exit(0 if success else 1)

        elif args.run:
            # Kompilacja + uruchomienie (interaktywne)
            if not builder.check_cargo_project():
                sys.exit(1)
            success = builder.full_build_and_run(
                release=not args.debug,
                verbose=args.verbose,
            )
            elapsed = time.time() - start_time
            print(f"\n   Czas: {elapsed:.1f}s")
            sys.exit(0 if success else 1)

        else:
            # Domyslne: finalny build do dist/
            if not builder.check_cargo_project():
                sys.exit(1)
            success = builder.build_final(
                out_dir=args.out_dir,
                clean=not args.no_clean,
                verbose=args.verbose,
                jobs=args.jobs,
            )
            elapsed = time.time() - start_time
            print(f"\n   Calkowity czas: {elapsed:.1f}s")
            sys.exit(0 if success else 1)

    except KeyboardInterrupt:
        print("\n\n   Proces przerwany przez uzytkownika")
        sys.exit(130)
    except Exception as e:
        print(f"\n\n   Nieoczekiwany blad: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
