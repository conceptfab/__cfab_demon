#!/usr/bin/env python3
"""Launch Tauri dashboard in dev mode without leaving stale repo-local processes behind."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DASHBOARD_DIR = ROOT / "dashboard"
VITE_PORT = 5173


def load_env_file() -> None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return

    with env_file.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ[key.strip()] = value.strip()


def run_powershell_json(script: str) -> list[dict[str, object]]:
    result = subprocess.run(
        ["powershell", "-NoProfile", "-Command", script],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0 or not result.stdout.strip():
        return []

    payload = json.loads(result.stdout)
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        return [payload]
    return []


def find_repo_dev_processes() -> list[dict[str, object]]:
    root_str = str(ROOT).replace("'", "''")
    script = rf"""
    $root = '{root_str}'
    $self = {os.getpid()}
    $procs = Get-CimInstance Win32_Process | Where-Object {{
      $_.ProcessId -ne $self -and
      $_.CommandLine -and
      $_.CommandLine -like "*$root*" -and
      $_.Name -match '^(python|python\.exe|node|node\.exe|cargo|cargo\.exe|rustc|rustc\.exe)$' -and
      $_.CommandLine -match 'dashboard_dev\.py|tauri dev|vite|target\\debug'
    }} | Select-Object Name, ProcessId, CommandLine
    if ($procs) {{ $procs | ConvertTo-Json -Compress }}
    """
    return run_powershell_json(script)


def find_port_owners(port: int) -> list[dict[str, object]]:
    script = rf"""
    $owners = Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue |
      Select-Object OwningProcess, LocalAddress, LocalPort
    if ($owners) {{ $owners | ConvertTo-Json -Compress }}
    """
    return run_powershell_json(script)


def terminate_process_tree(pid: int) -> None:
    subprocess.run(
        ["taskkill", "/PID", str(pid), "/T", "/F"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )


def cleanup_repo_dev_processes() -> None:
    stale = find_repo_dev_processes()
    if not stale:
        return

    print("Stopping stale TIMEFLOW dashboard dev processes...")
    for proc in stale:
        pid = int(proc["ProcessId"])
        name = str(proc["Name"])
        print(f"  - {name} (PID {pid})")
        terminate_process_tree(pid)

    for _ in range(30):
        if not find_repo_dev_processes():
            return
        time.sleep(0.2)


def ensure_vite_port_is_free() -> None:
    owners = find_port_owners(VITE_PORT)
    if not owners:
        return

    repo_pids = {int(proc["ProcessId"]) for proc in find_repo_dev_processes()}
    blocking = [owner for owner in owners if int(owner["OwningProcess"]) not in repo_pids]
    if not blocking:
        return

    details = ", ".join(
        f"PID {int(owner['OwningProcess'])} ({owner['LocalAddress']}:{owner['LocalPort']})"
        for owner in blocking
    )
    raise SystemExit(
        f"Port {VITE_PORT} is already occupied by a non-TIMEFLOW process: {details}"
    )


def main() -> int:
    load_env_file()
    cleanup_repo_dev_processes()
    ensure_vite_port_is_free()

    print("Starting TIMEFLOW dashboard dev...")
    result = subprocess.run(
        ["npm.cmd", "run", "tauri", "dev"],
        cwd=DASHBOARD_DIR,
        env=os.environ.copy(),
        check=False,
    )
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
