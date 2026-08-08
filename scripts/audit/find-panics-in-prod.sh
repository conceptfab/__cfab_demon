#!/usr/bin/env bash
# Wypisuje unwrap/expect/panic/unreachable/todo POZA blokami #[cfg(test)]
# i poza plikami */tests.rs.
#
# DLACZEGO odsiewanie jest konieczne: goły `grep -c '.unwrap()'` po repo daje
# ~1096 trafień i prowadzi do fałszywego wniosku "kod jest usiany panikami".
# Realna liczba na ścieżce produkcyjnej to ~26 — reszta siedzi w testach,
# gdzie unwrap jest poprawnym idiomem.
#
# Wynik jest SUROWCEM do klasyfikacji, nie listą błędów. Każde trafienie
# klasyfikuj ręcznie wg docs/release/audit/INSTRUKCJA-AUDYTU.md (klasy A/B/C).
set -uo pipefail
cd "$(dirname "$0")/../.."

python3 - "$@" <<'PY'
import re, os, sys

PAT = re.compile(r'\.unwrap\(\)|\.expect\(|panic!\(|unreachable!\(|todo!\(|unimplemented!\(')
ROOTS = ['src', 'shared', 'dashboard/src-tauri/src']

hits = []
for root in ROOTS:
    for dirpath, _, files in os.walk(root):
        if 'target' in dirpath.split(os.sep):
            continue
        for name in sorted(files):
            if not name.endswith('.rs') or name == 'tests.rs':
                continue
            path = os.path.join(dirpath, name)
            with open(path, encoding='utf-8', errors='replace') as fh:
                lines = fh.read().split('\n')
            in_test = False
            depth = 0
            for i, line in enumerate(lines):
                if not in_test and re.search(r'#\[cfg\(test\)\]', line):
                    in_test = True
                    depth = 0
                    continue
                if in_test:
                    depth += line.count('{') - line.count('}')
                    if depth <= 0 and '}' in line:
                        in_test = False
                    continue
                if PAT.search(line):
                    hits.append((path, i + 1, line.strip()[:120]))

print(f"PUNKTY PANIKI NA SCIEZCE PRODUKCYJNEJ: {len(hits)}\n")
for path, line_no, text in hits:
    print(f"{path}:{line_no}: {text}")

per_file = {}
for path, _, _ in hits:
    per_file[path] = per_file.get(path, 0) + 1
print("\n--- rozklad per plik ---")
for path, count in sorted(per_file.items(), key=lambda kv: -kv[1]):
    print(f"{count:5d}  {path}")
PY
