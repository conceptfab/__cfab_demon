#!/usr/bin/env python3
"""TIMEFLOW — odzyskiwanie ukrytych sesji (macOS + Windows).

Odkrywa sesje oznaczone is_hidden=1 (utracone przez historyczny bug:
rebuild scalał i ukrywał sesje, a refresh importu cofał doliczony czas).
Po odkryciu uruchom TIMEFLOW — rebuild przy starcie ponownie scali sesje,
tym razem z trwale zachowanym czasem (wymaga buildu >= 198f662).

Użycie:
    python3 recover_hidden_sessions.py                    # cała historia
    python3 recover_hidden_sessions.py --date 2026-06-10  # tylko jeden dzień
    python3 recover_hidden_sessions.py --db /sciezka/do/timeflow_dashboard.db
"""

import argparse
import re
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path

PROCESS_NAMES = ("TIMEFLOW", "timeflow-demon")


def default_db_path() -> Path:
    if sys.platform == "win32":
        import os

        appdata = os.environ.get("APPDATA")
        if not appdata:
            sys.exit("BLAD: brak zmiennej APPDATA")
        return Path(appdata) / "TIMEFLOW" / "timeflow_dashboard.db"
    return (
        Path.home()
        / "Library"
        / "Application Support"
        / "TIMEFLOW"
        / "timeflow_dashboard.db"
    )


def timeflow_running() -> list[str]:
    if sys.platform == "win32":
        out = subprocess.run(
            ["tasklist", "/FO", "CSV", "/NH"], capture_output=True, text=True
        ).stdout.lower()
        return [n for n in PROCESS_NAMES if f'"{n.lower()}.exe"' in out]
    running = []
    for name in PROCESS_NAMES:
        if subprocess.run(["pgrep", "-x", name], capture_output=True).returncode == 0:
            running.append(name)
    return running


def main() -> None:
    parser = argparse.ArgumentParser(description="Odkrywa ukryte sesje TIMEFLOW.")
    parser.add_argument("--date", help="tylko jeden dzień (YYYY-MM-DD); domyślnie cała historia")
    parser.add_argument("--db", help="ścieżka do timeflow_dashboard.db (np. praca na kopii)")
    args = parser.parse_args()

    if args.date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.date):
        sys.exit(f"BLAD: data musi mieć format YYYY-MM-DD (podano: {args.date})")

    db = Path(args.db) if args.db else default_db_path()
    if not db.is_file():
        sys.exit(f"BLAD: nie znaleziono bazy: {db}")

    # TIMEFLOW musi być zamknięty — inaczej zapis do bazy w użyciu grozi
    # konfliktem. Przy jawnym --db (praca na kopii) pomijamy check, bo
    # działająca aplikacja używa innej bazy.
    if not args.db:
        running = timeflow_running()
        if running:
            sys.exit(
                f"BLAD: TIMEFLOW działa ({', '.join(running)}). "
                "Zamknij aplikację (tray -> zakończ) i spróbuj ponownie."
            )

    where = "is_hidden = 1"
    params: list[str] = []
    if args.date:
        where += " AND date = ?"
        params.append(args.date)
    label = args.date or "cała historia"

    conn = sqlite3.connect(db)
    try:
        count, secs = conn.execute(
            f"SELECT COUNT(*), COALESCE(SUM(duration_seconds), 0) FROM sessions WHERE {where}",
            params,
        ).fetchone()

        if count == 0:
            print(f"Brak ukrytych sesji do odzyskania (filtr: {label}).")
            return

        base = Path.home() / "Desktop" / f"timeflow_backup_{datetime.now():%Y%m%d_%H%M%S}"
        backup_dir = base
        attempt = 1
        while backup_dir.exists():
            backup_dir = base.with_name(f"{base.name}_{attempt}")
            attempt += 1
        backup_dir.mkdir(parents=True)
        for suffix in ("", "-wal", "-shm"):
            src = Path(str(db) + suffix)
            if src.is_file():
                shutil.copy2(src, backup_dir)
        print(f"Backup bazy: {backup_dir}")

        with conn:
            changed = conn.execute(
                f"UPDATE sessions SET is_hidden = 0 WHERE {where}", params
            ).rowcount
    finally:
        conn.close()

    print(f"Odkryto sesji: {changed} (~{secs / 3600:.1f} h, filtr: {label})")
    print("Teraz uruchom TIMEFLOW — rebuild przy starcie ponownie scali sesje.")
    print(
        "Uwaga: sesje skasowane kiedyś ręcznie w UI także wróciły — "
        "w razie czego skasuj je ponownie."
    )


if __name__ == "__main__":
    main()
