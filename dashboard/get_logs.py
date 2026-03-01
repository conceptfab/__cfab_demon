import subprocess
try:
    res = subprocess.run(["npm.cmd", "run", "build"], capture_output=True, text=True)
    out = res.stdout + "\n" + res.stderr
except Exception as e:
    out = str(e)
open("build_out.txt", "w", encoding="utf-8").write(out)
