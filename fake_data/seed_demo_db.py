from __future__ import annotations

import json
import os
import shutil
import sqlite3
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional


ROOT = Path(__file__).resolve().parent
APPDATA = os.environ.get("APPDATA")
if not APPDATA:
    raise SystemExit("APPDATA is not set")

TF_DIR = Path(APPDATA) / "TimeFlow"
DEMO_DB = TF_DIR / "timeflow_dashboard_demo.db"
MODE_FILE = TF_DIR / "timeflow_dashboard_mode.json"

def _hsl_to_hex(h: float, s: float, l: float) -> str:
    c = (1 - abs(2 * l - 1)) * s
    hp = (h / 60.0) % 6
    x = c * (1 - abs((hp % 2) - 1))
    if 0 <= hp < 1:
        r1, g1, b1 = c, x, 0
    elif 1 <= hp < 2:
        r1, g1, b1 = x, c, 0
    elif 2 <= hp < 3:
        r1, g1, b1 = 0, c, x
    elif 3 <= hp < 4:
        r1, g1, b1 = 0, x, c
    elif 4 <= hp < 5:
        r1, g1, b1 = x, 0, c
    else:
        r1, g1, b1 = c, 0, x
    m = l - c / 2
    r = round((r1 + m) * 255)
    g = round((g1 + m) * 255)
    b = round((b1 + m) * 255)
    return f"#{r:02x}{g:02x}{b:02x}"


def project_color_for_name(name: str) -> str:
    acc = 0
    for b in name.encode("utf-8", errors="ignore"):
        acc = ((acc * 31) + b) & 0xFFFFFFFF
    hue = acc % 360
    sat = min(0.82, 0.62 + ((acc >> 9) % 18) / 100.0)
    light = min(0.68, 0.52 + ((acc >> 17) % 14) / 100.0)
    return _hsl_to_hex(float(hue), float(sat), float(light))


def parse_project_name_from_file(file_name: str) -> Optional[str]:
    if " - " not in file_name:
        return None
    project = file_name.rsplit(" - ", 1)[-1].strip()
    if not project or project == "(background)":
        return None
    return project


@dataclass
class FileRange:
    project_id: int
    start: str
    end: str
    total_seconds: int

    @property
    def start_dt(self) -> datetime:
        return datetime.fromisoformat(self.start)

    @property
    def end_dt(self) -> datetime:
        return datetime.fromisoformat(self.end)


def overlap_seconds(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> float:
    start = max(a_start, b_start)
    end = min(a_end, b_end)
    return max(0.0, (end - start).total_seconds())


def backup_if_exists(path: Path) -> Optional[Path]:
    if not path.exists():
        return None
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = path.with_name(f"{path.stem}.backup_{ts}{path.suffix}")
    shutil.copy2(path, backup)
    wal = path.with_suffix(path.suffix + "-wal")
    shm = path.with_suffix(path.suffix + "-shm")
    if wal.exists():
        shutil.copy2(wal, backup.with_name(backup.name + ".wal"))
    if shm.exists():
        shutil.copy2(shm, backup.with_name(backup.name + ".shm"))
    return backup


def existing_tables(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    return {r[0] for r in rows}


def clear_data(conn: sqlite3.Connection) -> None:
    tables = existing_tables(conn)
    delete_order = [
        "assignment_auto_run_items",
        "assignment_auto_runs",
        "assignment_feedback",
        "assignment_suggestions",
        "assignment_model_app",
        "assignment_model_token",
        "assignment_model_time",
        "assignment_model_state",
        "file_activities",
        "sessions",
        "manual_sessions",
        "imported_files",
        "applications",
        "project_folders",
        "projects",
    ]
    for tbl in delete_order:
        if tbl in tables:
            conn.execute(f"DELETE FROM {tbl}")
    if "sqlite_sequence" in tables:
        names = [t for t in delete_order if t in tables]
        if names:
            placeholders = ",".join("?" for _ in names)
            conn.execute(f"DELETE FROM sqlite_sequence WHERE name IN ({placeholders})", names)


def ensure_project(conn: sqlite3.Connection, name: str, cache: dict[str, int]) -> int:
    pid = cache.get(name.lower())
    if pid is not None:
        return pid
    row = conn.execute("SELECT id FROM projects WHERE lower(name)=lower(?)", (name,)).fetchone()
    if row:
        cache[name.lower()] = int(row[0])
        return int(row[0])
    conn.execute(
        "INSERT INTO projects (name, color, is_imported) VALUES (?, ?, 1)",
        (name, project_color_for_name(name)),
    )
    pid = int(conn.execute("SELECT id FROM projects WHERE lower(name)=lower(?)", (name,)).fetchone()[0])
    cache[name.lower()] = pid
    return pid


def ensure_app(conn: sqlite3.Connection, exe: str, display_name: str, cache: dict[str, int]) -> int:
    aid = cache.get(exe.lower())
    if aid is not None:
        return aid
    row = conn.execute("SELECT id FROM applications WHERE lower(executable_name)=lower(?)", (exe,)).fetchone()
    if row:
        aid = int(row[0])
        conn.execute(
            "UPDATE applications SET display_name = COALESCE(NULLIF(?, ''), display_name), is_imported = 1 WHERE id = ?",
            (display_name, aid),
        )
        cache[exe.lower()] = aid
        return aid
    conn.execute(
        "INSERT INTO applications (executable_name, display_name, project_id, is_imported) VALUES (?, ?, NULL, 1)",
        (exe, display_name),
    )
    aid = int(conn.execute("SELECT id FROM applications WHERE lower(executable_name)=lower(?)", (exe,)).fetchone()[0])
    cache[exe.lower()] = aid
    return aid


def assign_session_project(session_start: str, session_end: str, file_ranges: list[FileRange]) -> Optional[int]:
    if not file_ranges:
        return None
    s_dt = datetime.fromisoformat(session_start)
    e_dt = datetime.fromisoformat(session_end)

    by_project: dict[int, float] = defaultdict(float)
    totals: dict[int, int] = defaultdict(int)
    nearest_gap: dict[int, float] = {}

    for fr in file_ranges:
        totals[fr.project_id] += fr.total_seconds
        fs = fr.start_dt
        fe = fr.end_dt
        ov = overlap_seconds(s_dt, e_dt, fs, fe)
        if ov > 0:
            by_project[fr.project_id] += ov
        else:
            gap = min(abs((s_dt - fe).total_seconds()), abs((e_dt - fs).total_seconds()))
            nearest_gap[fr.project_id] = min(nearest_gap.get(fr.project_id, float("inf")), gap)

    if by_project:
        best = sorted(by_project.items(), key=lambda kv: (-kv[1], -totals[kv[0]], kv[0]))[0][0]
        return best

    if len(totals) == 1:
        return next(iter(totals))

    if nearest_gap:
        best = sorted(nearest_gap.items(), key=lambda kv: (kv[1], -totals[kv[0]], kv[0]))[0][0]
        return best

    if totals:
        return sorted(totals.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
    return None


def seed_demo_db() -> None:
    if not DEMO_DB.exists():
        raise SystemExit(f"Demo DB not found: {DEMO_DB}")

    json_files = sorted(ROOT.glob("*_fake.json"))
    if not json_files:
        raise SystemExit(f"No *_fake.json files found in {ROOT}")

    backup = backup_if_exists(DEMO_DB)

    conn = sqlite3.connect(DEMO_DB, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.execute("PRAGMA journal_mode=WAL")

    project_cache: dict[str, int] = {}
    app_cache: dict[str, int] = {}
    inserted_sessions = 0
    inserted_files = 0
    file_project_counter: Counter[str] = Counter()

    try:
        conn.execute("BEGIN IMMEDIATE")
        clear_data(conn)

        for path in json_files:
            daily = json.loads(path.read_text(encoding="utf-8"))
            date_str = daily["date"]
            apps = daily.get("apps", {})

            for exe, app_data in apps.items():
                app_id = ensure_app(conn, exe, app_data.get("display_name", exe), app_cache)

                file_ranges: list[FileRange] = []
                for file_entry in app_data.get("files", []):
                    file_name = file_entry["name"]
                    project_name = parse_project_name_from_file(file_name)
                    project_id = ensure_project(conn, project_name, project_cache) if project_name else None

                    conn.execute(
                        """
                        INSERT INTO file_activities (app_id, date, file_name, total_seconds, first_seen, last_seen, project_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            app_id,
                            date_str,
                            file_name,
                            int(file_entry.get("total_seconds", 0)),
                            file_entry["first_seen"],
                            file_entry["last_seen"],
                            project_id,
                        ),
                    )
                    inserted_files += 1

                    if project_id is not None:
                        file_ranges.append(
                            FileRange(
                                project_id=project_id,
                                start=file_entry["first_seen"],
                                end=file_entry["last_seen"],
                                total_seconds=int(file_entry.get("total_seconds", 0)),
                            )
                        )
                        file_project_counter[project_name] += int(file_entry.get("total_seconds", 0))

                file_ranges.sort(key=lambda x: (x.start, x.end, x.project_id))

                last_pid: Optional[int] = None
                for sess in sorted(app_data.get("sessions", []), key=lambda s: s["start"]):
                    pid = assign_session_project(sess["start"], sess["end"], file_ranges)
                    if pid is None:
                        pid = last_pid
                    if pid is None and file_ranges:
                        pid = file_ranges[0].project_id
                    if pid is None:
                        raise RuntimeError(
                            f"Cannot assign session for {exe} on {date_str}: {sess['start']} -> {sess['end']}"
                        )

                    conn.execute(
                        """
                        INSERT INTO sessions (app_id, start_time, end_time, duration_seconds, date, project_id)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (
                            app_id,
                            sess["start"],
                            sess["end"],
                            int(sess.get("duration_seconds", 0)),
                            date_str,
                            pid,
                        ),
                    )
                    inserted_sessions += 1
                    last_pid = pid

            conn.execute(
                "INSERT OR IGNORE INTO imported_files (file_path, records_count) VALUES (?, ?)",
                (str(path), sum(len(a.get("sessions", [])) for a in apps.values())),
            )

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    # Persist demo mode ON so the user sees seeded data after restart/switch.
    TF_DIR.mkdir(parents=True, exist_ok=True)
    MODE_FILE.write_text(json.dumps({"demo_mode": True}, indent=2), encoding="utf-8")

    check = sqlite3.connect(DEMO_DB, timeout=10)
    try:
        total_sessions = int(check.execute("SELECT COUNT(*) FROM sessions").fetchone()[0])
        unassigned = int(check.execute("SELECT COUNT(*) FROM sessions WHERE project_id IS NULL").fetchone()[0])
        total_projects = int(check.execute("SELECT COUNT(*) FROM projects").fetchone()[0])
        total_files = int(check.execute("SELECT COUNT(*) FROM file_activities").fetchone()[0])
        min_date, max_date = check.execute("SELECT MIN(date), MAX(date) FROM sessions").fetchone()
    finally:
        check.close()

    print(f"Seeded demo DB: {DEMO_DB}")
    if backup:
        print(f"Backup: {backup}")
    print(f"JSON files imported: {len(json_files)}")
    print(f"Sessions inserted: {inserted_sessions} (db count: {total_sessions})")
    print(f"File activities inserted: {inserted_files} (db count: {total_files})")
    print(f"Projects: {total_projects}")
    print(f"Sessions unassigned: {unassigned}")
    print(f"Date range in DB: {min_date} -> {max_date}")


if __name__ == "__main__":
    seed_demo_db()
