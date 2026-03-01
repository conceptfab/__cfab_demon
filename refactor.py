import os, sys, re

stores = {
    'useUIStore': ['currentPage', 'setCurrentPage', 'helpTab', 'setHelpTab', 'sessionsFocusDate', 'setSessionsFocusDate', 'clearSessionsFocusDate', 'sessionsFocusRange', 'setSessionsFocusRange', 'sessionsFocusProject', 'setSessionsFocusProject', 'projectPageId', 'setProjectPageId', 'firstRun', 'setFirstRun'],
    'useDataStore': ['dateRange', 'timePreset', 'setDateRange', 'setTimePreset', 'shiftDateRange', 'canShiftForward', 'refreshKey', 'triggerRefresh', 'autoImportDone', 'autoImportResult', 'setAutoImportDone'],
    'useSettingsStore': ['currencyCode', 'setCurrencyCode', 'chartAnimations', 'setChartAnimations']
}

def get_store(prop):
    for store_name, props in stores.items():
        if prop in props: return store_name
    return 'useAppStore'

def process_file(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading {path}: {e}")
        return

    if 'useAppStore' not in content:
        return

    original_content = content
    imports_to_add = set()

    # 1. replace const { ... } = useAppStore();
    def repl_destructure(m):
        props_str = m.group(1)
        props = [p.strip() for p in props_str.split(',') if p.strip()]
        
        store_map = {}
        for p in props:
            # Handle aliases e.g. "triggerRefresh: refresh" -> "triggerRefresh"
            clean_p = p.split(':')[0].strip()
            s = get_store(clean_p)
            if s not in store_map:
                store_map[s] = []
            store_map[s].append(p)
            imports_to_add.add(s)
            
        res = []
        for s, p_list in store_map.items():
            res.append(f"const {{ {', '.join(p_list)} }} = {s}();")
        return "\n  ".join(res)

    content = re.sub(r'const\s+\{\s*([^}]+)\s*\}\s*=\s*useAppStore\s*\(\s*\)\s*;', repl_destructure, content)

    # 2. replace useAppStore((s) => s.prop)
    def repl_selector(m):
        prop = m.group(1)
        s = get_store(prop)
        imports_to_add.add(s)
        return f"{s}((s) => s.{prop})"
    content = re.sub(r'useAppStore\s*\(\s*\(\s*[a-zA-Z_]\s*\)\s*=>\s*[a-zA-Z_]\.([a-zA-Z0-9_]+)\s*\)', repl_selector, content)
    
    # 3. replace multi-line useAppStore((s) => { return s.prop })
    def repl_selector_block(m):
        prop = m.group(1)
        s = get_store(prop)
        imports_to_add.add(s)
        # We simplify it to inline here for simplicity unless it has logic, assuming simple returns
        return f"{s}((s) => s.{prop})"
    content = re.sub(r'useAppStore\s*\(\s*\(\s*[a-zA-Z_]\s*\)\s*=>\s*\{\s*return\s*[a-zA-Z_]\.([a-zA-Z0-9_]+);?\s*\}\s*\)', repl_selector_block, content)

    # 4. replace useAppStore.getState().prop
    def repl_getstate(m):
        prop = m.group(1)
        s = get_store(prop)
        imports_to_add.add(s)
        return f"{s}.getState().{prop}"
    content = re.sub(r'useAppStore\.getState\(\)\.([a-zA-Z0-9_]+)', repl_getstate, content)

    # 5. Add imports
    if imports_to_add:
        # replace original import
        import_strs = []
        for s in imports_to_add:
            if s == 'useUIStore': import_strs.append("import { useUIStore } from '@/store/ui-store';")
            if s == 'useDataStore': import_strs.append("import { useDataStore } from '@/store/data-store';")
            if s == 'useSettingsStore': import_strs.append("import { useSettingsStore } from '@/store/settings-store';")
        content = re.sub(r'import\s+\{[^}]*useAppStore[^}]*\}\s+from\s+[\'"]@/store/app-store[\'"];?', '\n'.join(import_strs), content)

    if content != original_content:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Updated: {path}")
    else:
        print(f"Matched 'useAppStore' but regexes didn't change: {path}")

for root, dirs, files in os.walk('c:/_cloud/__cfab_demon/__client/dashboard/src'):
    for file in files:
        if file.endswith(('.ts', '.tsx')) and file != 'app-store.ts':
            process_file(os.path.join(root, file))
