import os
import shutil

files_to_move = [
    "map_UI.md",
    "strings.md",
    "_diag.py",
    "check_db_sizes.py",
    "check_git.py",
    "db_fix.py",
    "debug_check_db.py",
    "diag_db.py",
    "errors_raport.md",
    "find_logs.py",
    "fix-dashboard.py",
    "get_stats.py",
    "move_debug.py",
    "query.py",
    "run_diag.bat",
    "test-query.py"
]

target_dir = "_do_usuniecia"

if not os.path.exists(target_dir):
    os.makedirs(target_dir)

for file in files_to_move:
    if os.path.exists(file):
        try:
            shutil.move(file, os.path.join(target_dir, file))
            print(f"Moved: {file}")
        except Exception as e:
            print(f"Error moving {file}: {e}")
    else:
        print(f"Not found: {file}")
