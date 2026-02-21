#!/usr/bin/env python3
"""Launch Tauri dashboard in dev mode."""
import subprocess
import os

os.chdir(os.path.join(os.path.dirname(__file__), "dashboard"))
subprocess.run("npm run tauri dev", shell=True)
