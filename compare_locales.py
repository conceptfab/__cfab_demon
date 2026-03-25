from __future__ import annotations

import json
import sys
from typing import Any


def get_keys(d: dict[str, Any], prefix: str = '') -> set[str]:
    keys = set()
    for k, v in d.items():
        new_key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            keys.update(get_keys(v, new_key))
        else:
            if not v: # Also report empty string as missing
                keys.add(new_key + " (EMPTY KEY)")
            keys.add(new_key)
    return keys

def main() -> None:
    with open(r'c:\_cloud\__cfab_demon\__client\dashboard\src\locales\en\common.json', 'r', encoding='utf-8') as f:
        en = json.load(f)
    with open(r'c:\_cloud\__cfab_demon\__client\dashboard\src\locales\pl\common.json', 'r', encoding='utf-8') as f:
        pl = json.load(f)

    en_keys = set(k for k in get_keys(en) if not k.endswith(" (EMPTY KEY)"))
    pl_keys = set(k for k in get_keys(pl) if not k.endswith(" (EMPTY KEY)"))
    
    en_empty = set(k.replace(" (EMPTY KEY)", "") for k in get_keys(en) if k.endswith(" (EMPTY KEY)"))
    pl_empty = set(k.replace(" (EMPTY KEY)", "") for k in get_keys(pl) if k.endswith(" (EMPTY KEY)"))

    missing_in_pl = en_keys - pl_keys
    missing_in_en = pl_keys - en_keys

    print("--- Missing in PL (Keys present in EN but completely missing from PL):")
    for k in sorted(missing_in_pl):
        print(f"  {k}")
    
    print("\n--- Missing in EN (Keys present in PL but completely missing from EN):")
    for k in sorted(missing_in_en):
        print(f"  {k}")
        
    print("\n--- Empty values in PL:")
    for k in sorted(pl_empty):
        print(f"  {k}")
        
    print("\n--- Empty values in EN:")
    for k in sorted(en_empty):
        print(f"  {k}")

if __name__ == '__main__':
    main()
