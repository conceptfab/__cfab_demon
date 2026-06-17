#!/usr/bin/env python3
"""Uruchom TIMEFLOW Web UI w trybie bez okna (headless) i otwórz w przeglądarce.

Localhost (127.0.0.1) loguje się automatycznie — żaden kod parowania nie jest
potrzebny (zaufany loopback). Urządzenia w LAN dalej wymagają kodu z zakładki
"Web Server". To skrypt deweloperski: szybkie odpalenie www UI do podglądu.

Użycie:
    python3 webui_dev.py            # DOMYŚLNIE: Vite HMR na 5174 + LAN. Twoje bieżące
                                     #   zmiany frontu + realne dane, bez logowania.
                                     #   Otwórz wypisany http://<IP-LAN>:5174 na telefonie
                                     #   = live reload widoków mobilnych bez przebudowy.
    python3 webui_dev.py --no-open  # to samo, ale nie otwieraj przeglądarki
    python3 webui_dev.py --stop      # zatrzymaj działającą instancję headless
    python3 webui_dev.py --built     # serwuj ZBUDOWANY SPA z binarki (bez HMR) —
                                     #   test produkcyjnego buildu, nie dev frontu
    python3 webui_dev.py --built --rebuild  # najpierw przebuduj SPA + binarkę
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DASHBOARD_DIR = ROOT / "dashboard"
DEFAULT_PORT = 47892


def data_dir() -> Path:
    """Katalog danych TIMEFLOW (to samo źródło co demon i dashboard)."""
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "TIMEFLOW"
    if sys.platform.startswith("win"):
        import os

        base = os.environ.get("APPDATA", str(Path.home()))
        return Path(base) / "TIMEFLOW"
    return Path.home() / ".local" / "share" / "TIMEFLOW"


def configured_port() -> int:
    cfg = data_dir() / "webserver_settings.json"
    try:
        return int(json.loads(cfg.read_text()).get("port", DEFAULT_PORT))
    except Exception:
        return DEFAULT_PORT


def read_host_status() -> dict | None:
    status = data_dir() / "webui_host.json"
    try:
        return json.loads(status.read_text())
    except Exception:
        return None


def pid_alive(pid: int) -> bool:
    if sys.platform.startswith("win"):
        out = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
            capture_output=True, text=True, check=False,
        )
        return str(pid) in out.stdout
    try:
        import os

        os.kill(pid, 0)
        return True
    except OSError:
        return False


def healthz(port: int, timeout: float = 0.5) -> bool:
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/healthz", timeout=timeout
        ) as resp:
            return resp.status == 200
    except Exception:
        return False


def lan_ip() -> str:
    if sys.platform == "darwin":
        for iface in ("en0", "en1"):
            out = subprocess.run(
                ["ipconfig", "getifaddr", iface],
                capture_output=True, text=True, check=False,
            )
            ip = out.stdout.strip()
            if ip:
                return ip
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        sock.close()
        if not ip.startswith("127."):
            return ip
    except Exception:
        pass
    return "127.0.0.1"


def find_app_binary() -> Path | None:
    """Lokalizuje binarkę dashboardu (preferuj zbudowany .app, potem target/)."""
    candidates = [
        ROOT / "dist" / "TIMEFLOW.app" / "Contents" / "MacOS" / "timeflow-dashboard",
        ROOT / "target" / "release" / "timeflow-dashboard",
        ROOT / "target" / "debug" / "timeflow-dashboard",
    ]
    if sys.platform.startswith("win"):
        candidates = [
            ROOT / "target" / "release" / "timeflow-dashboard.exe",
            ROOT / "target" / "debug" / "timeflow-dashboard.exe",
        ]
    return next((c for c in candidates if c.exists()), None)


def stop_running() -> None:
    status = read_host_status()
    if status and pid_alive(status.get("pid", -1)):
        pid = status["pid"]
        print(f"Zatrzymuję instancję headless (PID {pid})...")
        if sys.platform.startswith("win"):
            subprocess.run(["taskkill", "/PID", str(pid), "/F"], check=False)
        else:
            import os
            import signal

            try:
                os.kill(pid, signal.SIGTERM)
            except OSError:
                pass
        for _ in range(25):
            if not pid_alive(pid):
                break
            time.sleep(0.2)
    (data_dir() / "webui_host.json").unlink(missing_ok=True)


def rebuild() -> None:
    npm = "npm.cmd" if sys.platform.startswith("win") else "npm"
    print("Buduję frontend (npm run build)...")
    subprocess.run([npm, "run", "build"], cwd=DASHBOARD_DIR, check=True)
    print("Buduję binarkę dashboardu (cargo build -p timeflow-dashboard)...")
    subprocess.run(
        ["cargo", "build", "-p", "timeflow-dashboard"], cwd=ROOT, check=True
    )


def launch_headless(binary: Path) -> None:
    print(f"Uruchamiam headless: {binary} --headless")
    kwargs: dict = {}
    if not sys.platform.startswith("win"):
        kwargs["start_new_session"] = True
    subprocess.Popen([str(binary), "--headless"], cwd=ROOT, **kwargs)


def open_browser(url: str) -> None:
    if sys.platform == "darwin":
        subprocess.run(["open", url], check=False)
    elif sys.platform.startswith("win"):
        subprocess.run(["cmd", "/C", "start", "", url], check=False)
    else:
        subprocess.run(["xdg-open", url], check=False)


def tcp_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except Exception:
        return False


def ensure_backend(port: int) -> bool:
    """Upewnij się, że backend Web UI (headless) działa na `port`."""
    if healthz(port):
        return True
    binary = find_app_binary()
    if binary is None:
        print(
            "Nie znaleziono binarki dashboardu — uruchom z --rebuild albo zbuduj "
            ".app (np. python3 build_all_macos.py).",
            file=sys.stderr,
        )
        return False
    stop_running()
    launch_headless(binary)
    print("Czekam aż backend wstanie (/healthz)...")
    for _ in range(50):
        if healthz(port):
            return True
        time.sleep(0.2)
    print("Backend nie odpowiedział w czasie. Sprawdź dashboard.log.", file=sys.stderr)
    return False


def run_vite_dev(backend_port: int, vite_port: int, open_in_browser: bool) -> int:
    """Vite HMR (bieżący frontend) z proxy RPC do żywego backendu — realne dane,
    bez logowania (dev-only flaga trusted + zaufany loopback backendu)."""
    if not ensure_backend(backend_port):
        return 1

    ip = lan_ip()
    env = os.environ.copy()
    env["TIMEFLOW_WEBUI_PORT"] = str(backend_port)
    # Eksponuj Vite na LAN z HMR po adresie LAN -> live reload na telefonie.
    if ip != "127.0.0.1":
        env["TIMEFLOW_VITE_LAN_HOST"] = ip
    npm = "npm.cmd" if sys.platform.startswith("win") else "npm"
    url = f"http://127.0.0.1:{vite_port}"
    lan_url = f"http://{ip}:{vite_port}"

    print()
    print(f"  Vite HMR (localhost):              {url}")
    if ip != "127.0.0.1":
        print(f"  >> NA TELEFONIE (LAN, live reload): {lan_url}")
    print(f"  Proxy RPC -> backend z danymi:     http://127.0.0.1:{backend_port}")
    print("  Bez logowania (dev-only trusted).  Ctrl+C aby zatrzymać Vite.")
    print()

    if open_in_browser:
        def _open_later() -> None:
            for _ in range(60):
                if tcp_open(vite_port):
                    break
                time.sleep(0.3)
            open_browser(url)

        threading.Thread(target=_open_later, daemon=True).start()

    return subprocess.run(
        [npm, "run", "dev", "--", "--port", str(vite_port), "--strictPort"],
        cwd=DASHBOARD_DIR, env=env, check=False,
    ).returncode


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rebuild", action="store_true",
                        help="przebuduj SPA + binarkę przed uruchomieniem")
    parser.add_argument("--no-open", action="store_true",
                        help="nie otwieraj przeglądarki")
    parser.add_argument("--stop", action="store_true",
                        help="zatrzymaj działającą instancję i wyjdź")
    parser.add_argument("--vite", action="store_true",
                        help="(domyślne) Vite HMR + LAN z proxy do backendu (dev frontu)")
    parser.add_argument("--built", action="store_true",
                        help="serwuj ZBUDOWANY SPA z binarki (bez HMR) zamiast Vite")
    parser.add_argument("--vite-port", type=int, default=5174,
                        help="port dla trybu Vite (domyślnie 5174)")
    args = parser.parse_args()

    if args.stop:
        stop_running()
        print("Zatrzymano.")
        return 0

    port = configured_port()

    # Tryb Vite (HMR + LAN) jest domyślny — to go używamy do dev frontu.
    # `--built` przełącza na stary tryb (zbudowany SPA z binarki, bez HMR).
    if not args.built:
        return run_vite_dev(port, args.vite_port, open_in_browser=not args.no_open)

    if args.rebuild or not healthz(port):
        stop_running()
        rebuild()
    elif healthz(port):
        print(
            "Uwaga: działający serwer na 47892 może serwować STARY embed SPA.\n"
            "  Dla świeżego UI: python3 webui_dev.py --rebuild --built\n"
            "  Albo dev z HMR: python3 webui_dev.py  →  http://127.0.0.1:5174",
            file=sys.stderr,
        )

    # Wznów istniejącą instancję jeśli zdrowa, inaczej uruchom nową.
    if healthz(port):
        print(f"Serwer już działa na porcie {port} — wznawiam.")
    else:
        binary = find_app_binary()
        if binary is None:
            print(
                "Nie znaleziono binarki dashboardu. Uruchom z --rebuild albo "
                "zbuduj .app (np. python3 build_all_macos.py).",
                file=sys.stderr,
            )
            return 1
        stop_running()  # sprzątnij ewentualny martwy plik statusu
        launch_headless(binary)
        print("Czekam aż serwer wstanie (/healthz)...")
        for _ in range(50):
            if healthz(port):
                break
            time.sleep(0.2)
        else:
            print("Serwer nie odpowiedział w czasie. Sprawdź dashboard.log.",
                  file=sys.stderr)
            return 1

    local_url = f"http://127.0.0.1:{port}"
    lan_url = f"http://{lan_ip()}:{port}"
    print()
    print(f"  Localhost (auto-login, bez kodu):  {local_url}")
    print(f"  LAN (wymaga kodu z 'Web Server'):  {lan_url}")
    print()

    if not args.no_open:
        open_browser(local_url)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
