import sqlite3
import os

db_path = os.path.join(os.getenv('APPDATA'), 'conceptfab', 'cfab_tracker.db')
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# Get the ID of the __cfab_demon project
cur.execute("SELECT id, name FROM projects")
print("Projects:", cur.fetchall())
