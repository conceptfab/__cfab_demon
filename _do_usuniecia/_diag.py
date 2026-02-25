"""Diagnostic: check DB state for unassigned sessions."""
import sqlite3, os

db = os.path.join(os.environ["APPDATA"], "TimeFlow", "timeflow_dashboard.db")
c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)

print("=== PROJECTS ===")
for r in c.execute("SELECT id, name FROM projects ORDER BY id"):
    print(f"  id={r[0]}  name={r[1]!r}")

print("\n=== TODAY FILE ACTIVITIES ===")
for r in c.execute(
    "SELECT fa.id, fa.app_id, fa.file_name, fa.project_id, fa.first_seen, fa.last_seen "
    "FROM file_activities fa WHERE fa.date='2026-02-20' ORDER BY fa.app_id, fa.first_seen"
):
    print(f"  id={r[0]} app_id={r[1]} file={r[2]!r} proj_id={r[3]} first={r[4]} last={r[5]}")

print("\n=== TODAY SESSIONS ===")
for r in c.execute(
    "SELECT s.id, s.app_id, a.executable_name, s.start_time, s.end_time, s.duration_seconds, s.project_id "
    "FROM sessions s JOIN applications a ON a.id=s.app_id WHERE s.date='2026-02-20' ORDER BY s.start_time"
):
    print(f"  id={r[0]} app={r[2]} start={r[3]} end={r[4]} dur={r[5]}s proj_id={r[6]}")

c.close()

