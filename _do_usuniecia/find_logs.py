import os
import re

POLISH_CHARS = set("ąćęłńóśźżĄĆĘŁŃÓŚŹŻ")
POLISH_WORDS = ["błąd", "brak", "plik", "uruchomiono", "zakonczono", "nie", "tak", "okno", "czas", "wstrzymano", "wznowiono", "zakończono", "zapisano"]

def contains_polish(text):
    if any(c in POLISH_CHARS for c in text):
        return True
    
    text_lower = text.lower()
    for word in POLISH_WORDS:
        # Match whole words only
        if re.search(rf'\b{word}\b', text_lower):
            return True
    return False

def search_files(directory):
    for root, _, files in os.walk(directory):
        for file in files:
            if file.endswith('.rs'):
                path = os.path.join(root, file)
                try:
                    with open(path, 'r', encoding='utf-8') as f:
                        lines = f.readlines()
                        for i, line in enumerate(lines):
                            if ('log::' in line or 'println!' in line or 'eprintln!' in line) and contains_polish(line):
                                print(f"{path}:{i+1}: {line.strip()}")
                except Exception as e:
                    pass

print("Searching daemon...")
search_files('src')
print("Searching dashboard backend...")
search_files('dashboard/src-tauri/src')
print("Done.")
