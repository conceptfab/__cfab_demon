#!/usr/bin/env python3
"""Launch Tauri dashboard in dev mode."""
import subprocess
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# Load .env into environment (for option_env! macro in Rust build)
env_file = ROOT / ".env"
if env_file.exists():
    with open(env_file, "r") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ[k.strip()] = v.strip()

os.chdir(ROOT / "dashboard")
subprocess.run("npm run tauri dev", shell=True)
