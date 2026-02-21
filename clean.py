import os
import shutil
import pathlib

def clean():
    root = pathlib.Path(__file__).parent.resolve()
    
    # Directories to remove (relative to root)
    dirs_to_remove = [
        "target",
        "dist",
        "dashboard/dist",
        "dashboard/src-tauri/target",
    ]
    
    # Optional: dashboard/node_modules
    # dirs_to_remove.append("dashboard/node_modules")

    print(f"Cleaning project at: {root}")

    # Remove specific directories
    for rel_path in dirs_to_remove:
        full_path = root / rel_path
        if full_path.exists() and full_path.is_dir():
            print(f"Removing directory: {rel_path}")
            try:
                shutil.rmtree(full_path)
            except Exception as e:
                print(f"Error removing {rel_path}: {e}")

    # Recursively remove __pycache__ and bytecode files
    print("Searching for cache files and artifacts...")
    for item in root.rglob("*"):
        # Remove __pycache__
        if item.is_dir() and item.name == "__pycache__":
            print(f"Removing cache dir: {item.relative_to(root)}")
            try:
                shutil.rmtree(item)
            except Exception as e:
                print(f"Error removing {item}: {e}")
                
        # Remove bytecode files
        elif item.is_file() and item.suffix in [".pyc", ".pyo", ".pyd"]:
            print(f"Removing file: {item.relative_to(root)}")
            try:
                item.unlink()
            except Exception as e:
                print(f"Error removing {item}: {e}")

    print("Cleanup complete.")

if __name__ == "__main__":
    clean()
