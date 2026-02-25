import sqlite3
import os

db1 = r"C:\Users\micz\AppData\Roaming\TimeFlow\timeflow_dashboard.db"
db2 = r"C:\Users\micz\AppData\Roaming\TimeFlow\timeflow_dashboard_demo.db"

out = []

for db_path in [db1, db2]:
    if not os.path.exists(db_path):
        out.append(f"{db_path} not found")
        continue
    
    size = os.path.getsize(db_path) / (1024*1024)
    out.append(f"\n--- {os.path.basename(db_path)} ({size:.2f} MB) ---")
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [row[0] for row in cursor.fetchall()]
    
    counts = []
    for t in tables:
        cursor.execute(f"SELECT COUNT(*) FROM {t}")
        counts.append((t, cursor.fetchone()[0]))
    
    for t, c in sorted(counts, key=lambda x: x[1], reverse=True):
        out.append(f"  {t}: {c}")
        
    conn.close()

with open(r"C:\_cloud\__cfab_demon\__client\stats.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(out))
