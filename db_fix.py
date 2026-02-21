import sqlite3
import os

db_path = os.path.join(os.getenv('APPDATA'), 'conceptfab', 'cfab_tracker.db')
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# Get the ID of the __cfab_demon project
cur.execute("SELECT id FROM projects WHERE lower(name) = '__cfab_demon'")
row = cur.fetchone()
if row:
    pid = row[0]
    print(f"Project '__cfab_demon' found with ID: {pid}")
    
    # Update file_activities that contain __cfab_demon
    cur.execute("""
        UPDATE file_activities 
        SET project_id = ? 
        WHERE project_id IS NULL AND file_name LIKE '%__cfab_demon%'
    """, (pid,))
    
    print(f"Updated {cur.rowcount} file activities.")
    conn.commit()
else:
    print("Project '__cfab_demon' not found.")
    cur.execute("SELECT id, name FROM projects")
    print("All projects:", cur.fetchall())
