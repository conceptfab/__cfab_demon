import sqlite3
import os

db_path = os.path.join(os.getenv('APPDATA'), 'TimeFlow', 'timeflow_dashboard.db')
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# Get the ID of the __timeflow_demon project
cur.execute("SELECT id FROM projects WHERE lower(name) = '__timeflow_demon'")
row = cur.fetchone()
if row:
    pid = row[0]
    print(f"Project '__timeflow_demon' found with ID: {pid}")
    
    # Update file_activities that contain __timeflow_demon
    cur.execute("""
        UPDATE file_activities 
        SET project_id = ? 
        WHERE project_id IS NULL AND file_name LIKE '%__timeflow_demon%'
    """, (pid,))
    
    print(f"Updated {cur.rowcount} file activities.")
    conn.commit()
else:
    print("Project '__timeflow_demon' not found.")
    cur.execute("SELECT id, name FROM projects")
    print("All projects:", cur.fetchall())

conn.close()

