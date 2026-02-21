import sqlite3
import os

appdata = os.getenv("APPDATA")
db_path = os.path.join(appdata, "conceptfab", "cfab_dashboard.db")
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# All sessions for today
today = "2026-02-21"
cur.execute("SELECT COUNT(*) FROM sessions WHERE date = ?", (today,))
print(f"Total sessions today: {cur.fetchone()[0]}")

cur.execute("SELECT COUNT(*) FROM sessions WHERE date = ? AND project_id IS NULL", (today,))
print(f"Unassigned sessions today (DB project_id IS NULL): {cur.fetchone()[0]}")

cur.execute("SELECT id, app_id, duration_seconds FROM sessions WHERE date = ? AND project_id IS NULL LIMIT 10", (today,))
print("Unassigned sessions details:", cur.fetchall())

conn.close()
