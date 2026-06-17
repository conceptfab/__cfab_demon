#!/usr/bin/env python3
"""Run TIMEFLOW LAN sync simulator tests.

This is a thin local harness around the Rust DB-level simulator in
src/sync_common.rs. It does not start real LAN servers; it runs the same export
and merge code on two in-memory SQLite databases.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOCKFILE = ROOT / "Cargo.lock"

SUITES: dict[str, list[list[str]]] = {
    "simulator": [
        ["cargo", "test", "-q", "lan_sync_simulator", "--", "--nocapture"],
    ],
    "sync-common": [
        ["cargo", "test", "-q", "sync_common::tests", "--", "--nocapture"],
    ],
    "ignored": [
        [
            "cargo",
            "test",
            "-q",
            "diagnostic_full_sync_does_not_lose_records_when_tombstones_present",
            "--",
            "--ignored",
            "--nocapture",
        ],
    ],
    "all": [
        ["cargo", "test", "-q", "lan_sync_simulator", "--", "--nocapture"],
        ["cargo", "test", "-q", "sync_common::tests", "--", "--nocapture"],
        [
            "cargo",
            "test",
            "-q",
            "diagnostic_full_sync_does_not_lose_records_when_tombstones_present",
            "--",
            "--ignored",
            "--nocapture",
        ],
        ["cargo", "test", "-q", "lan_server::tests", "--", "--nocapture"],
        ["cargo", "test", "-q", "lan_pair_throttle", "--", "--nocapture"],
    ],
}


def run_command(command: list[str]) -> int:
    print(f"\n$ {' '.join(command)}", flush=True)
    completed = subprocess.run(command, cwd=ROOT)
    return completed.returncode


def read_lockfile() -> bytes | None:
    if not LOCKFILE.exists():
        return None
    return LOCKFILE.read_bytes()


def restore_lockfile(original: bytes | None) -> None:
    if original is None:
        return
    if LOCKFILE.exists() and LOCKFILE.read_bytes() != original:
        LOCKFILE.write_bytes(original)
        print("\nRestored Cargo.lock after cargo test touched it.", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run TIMEFLOW LAN sync simulator/regression tests.",
    )
    parser.add_argument(
        "suite",
        nargs="?",
        choices=sorted(SUITES),
        default="simulator",
        help="Test suite to run. Default: simulator.",
    )
    parser.add_argument(
        "--keep-lockfile",
        action="store_true",
        help="Do not restore Cargo.lock after cargo test updates it.",
    )
    args = parser.parse_args()

    original_lockfile = None if args.keep_lockfile else read_lockfile()

    try:
        for command in SUITES[args.suite]:
            code = run_command(command)
            if code != 0:
                return code
        return 0
    finally:
        if not args.keep_lockfile:
            restore_lockfile(original_lockfile)


if __name__ == "__main__":
    sys.exit(main())
