import os
import shutil

scripts_to_move = [
    'db_fix.py',
    'debug_check_db.py',
    'query.py',
    'test-query.py',
    '_diag.py',
    'fix-dashboard.py'
]

os.makedirs('scripts/debug', exist_ok=True)

for script in scripts_to_move:
    if os.path.exists(script):
        try:
            shutil.move(script, f'scripts/debug/{script}')
            print(f"Moved {script} to scripts/debug")
        except Exception as e:
            print(f"Failed to move {script}: {e}")
    else:
        print(f"{script} does not exist in root")
