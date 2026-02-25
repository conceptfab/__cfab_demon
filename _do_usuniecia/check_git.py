import subprocess
try:
    result = subprocess.check_output(["git", "ls-files", ".env"], stderr=subprocess.STDOUT)
    print(f"TRACKED: {result.decode().strip()}")
except Exception as e:
    print(f"NOT TRACKED or error: {e}")
