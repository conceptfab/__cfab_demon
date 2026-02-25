import os
import sqlite3

def get_db_info(path):
    if not os.path.exists(path):
        return None
    
    size = os.path.getsize(path) / (1024 * 1024)
    info = {"size_mb": size, "tables": {}}
    
    try:
        conn = sqlite3.connect(path)
        cursor = conn.cursor()
        
        # Get row counts for all tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [row[0] for row in cursor.fetchall()]
        
        for table in tables:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            count = cursor.fetchone()[0]
            info["tables"][table] = count
            
        conn.close()
    except Exception as e:
        info["error"] = str(e)
        
    return info

log_file = os.path.join(os.getcwd(), 'db_diag_results.txt')

def log(msg):
    with open(log_file, 'a', encoding='utf-8') as f:
        f.write(msg + '\n')

if os.path.exists(log_file):
    os.remove(log_file)

appdata = os.environ.get('APPDATA')
timeflow_dir = os.path.join(appdata, 'TimeFlow')

dbs = ['timeflow_dashboard.db', 'timeflow_dashboard_demo.db']

for db_name in dbs:
    path = os.path.join(timeflow_dir, db_name)
    log(f"\n--- {db_name} ---")
    info = get_db_info(path)
    if info:
        log(f"Size: {info['size_mb']:.2f} MB")
        if "error" in info:
            log(f"Error: {info['error']}")
        else:
            log("Row counts:")
            for table, count in sorted(info["tables"].items(), key=lambda x: x[1], reverse=True):
                log(f"  {table}: {count}")
    else:
        log("Not found.")
