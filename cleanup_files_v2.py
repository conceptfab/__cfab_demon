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

with open("cleanup_log.txt", "w") as log:
    if not os.path.exists(target_dir):
        os.makedirs(target_dir)
        log.write(f"Created directory: {target_dir}\n")

    for file in files_to_move:
        if os.path.exists(file):
            try:
                shutil.move(file, os.path.join(target_dir, file))
                log.write(f"Moved: {file}\n")
            except Exception as e:
                log.write(f"Error moving {file}: {e}\n")
        else:
            log.write(f"Not found: {file}\n")
log.write("Cleanup finished.\n")
