import sqlite3, os
db=sqlite3.connect(os.path.join(os.environ['APPDATA'], 'TimeFlow', 'timeflow_dashboard.db'))
for r in db.execute('SELECT id, app_id, project_id, start_time, end_time, duration_seconds FROM sessions ORDER BY start_time DESC LIMIT 20').fetchall():
    print(r)

