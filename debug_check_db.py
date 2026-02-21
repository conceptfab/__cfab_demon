import sqlite3

db_path = r"C:\Users\micz\AppData\Roaming\conceptfab\cfab_demon.db"
conn = sqlite3.connect(db_path)
cur = conn.cursor()

with open("debug_db.txt", "w", encoding="utf-8") as f:
    f.write("--- Projects ---\n")
    cur.execute("SELECT id, name, color FROM projects WHERE name LIKE '%background%' OR name LIKE '(%)'")
    for row in cur.fetchall():
        f.write(f"{row}\n")

    f.write("\n--- Applications ---\n")
    cur.execute("SELECT id, display_name, executable_name, color FROM applications WHERE display_name LIKE '%background%' OR executable_name LIKE '%background%' OR display_name LIKE '(%)'")
    for row in cur.fetchall():
        f.write(f"{row}\n")

print("Done")
