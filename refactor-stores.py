import os
import re

# Definicje własności dla danego store'a
stores = {
    'useUIStore': {'currentPage', 'setCurrentPage', 'helpTab', 'setHelpTab', 'sessionsFocusDate', 'setSessionsFocusDate', 'clearSessionsFocusDate', 'sessionsFocusRange', 'setSessionsFocusRange', 'sessionsFocusProject', 'setSessionsFocusProject', 'projectPageId', 'setProjectPageId', 'firstRun', 'setFirstRun'},
    'useDataStore': {'dateRange', 'timePreset', 'setDateRange', 'setTimePreset', 'shiftDateRange', 'canShiftForward', 'refreshKey', 'triggerRefresh', 'autoImportDone', 'autoImportResult', 'setAutoImportDone'},
    'useSettingsStore': {'currencyCode', 'setCurrencyCode', 'chartAnimations', 'setChartAnimations'}
}

def get_store_for_prop(prop):
    for store, props in stores.items():
        if prop in props:
            return store
    return 'useAppStore'

def process_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    if 'useAppStore' not in content:
        return
    
    original_content = content
    imports_to_add = set()
    
    # 1. replace const { x, y } = useAppStore();
    # This is complex because they might destructure from multiple stores now.
    # For simplicity, if we find const { ... } = useAppStore(), we read the props, split them.
    def repl_destructure(m):
        props_str = m.group(1)
        props = [p.strip() for p in props_str.split(',') if p.strip()]
        
        store_map = {}
        for p in props:
            # handle 'refreshKey: rKey'
            clean_p = p.split(':')[0].strip()
            s = get_store_for_prop(clean_p)
            if s not in store_map:
                store_map[s] = []
            store_map[s].append(p)
            imports_to_add.add(s)
            
        res = []
        for s, p_list in store_map.items():
            res.append(f"const {{ {', '.join(p_list)} }} = {s}();")
            
        return "\n  ".join(res)
    
    content = re.sub(r'const\s+\{\s*([^}]+)\s*\}\s*=\s*useAppStore\(\);', repl_destructure, content)
    
    # 2. replace useAppStore((s) => s.prop)
    def repl_selector(m):
        prefix = m.group(1)
        prop = m.group(2)
        s = get_store_for_prop(prop)
        imports_to_add.add(s)
        return f"{prefix}{s}((s) => s.{prop})"
    
    content = re.sub(r'(useAppStore(?:<.*?>)?\(\s*\([^)]*\)\s*=>\s*[a-zA-Z_]\.)([a-zA-Z0-9_]+)', repl_selector, content)
    # also handle multi-line selector (s) => \n s.prop
    content = re.sub(r'(useAppStore\(\s*\([^)]*\)\s*=>\s*\{\s*return\s*[a-zA-Z_]\.)([a-zA-Z0-9_]+)', repl_selector, content)

    # 3. replace useAppStore.getState().prop
    def repl_get_state(m):
        prop = m.group(1)
        s = get_store_for_prop(prop)
        imports_to_add.add(s)
        return f"{s}.getState().{prop}"
    
    content = re.sub(r'useAppStore\.getState\(\)\.([a-zA-Z0-9_]+)', repl_get_state, content)

    # 4. update imports
    if imports_to_add:
        # Generate import statements
        import_statements = []
        for s in imports_to_add:
            if s == 'useUIStore':
                import_statements.append("import { useUIStore } from '@/store/ui-store';")
            elif s == 'useDataStore':
                import_statements.append("import { useDataStore } from '@/store/data-store';")
            elif s == 'useSettingsStore':
                import_statements.append("import { useSettingsStore } from '@/store/settings-store';")
                
        # Replace the original import
        content = re.sub(r'import\s+\{\s*useAppStore\s*\}\s*from\s*[\'"]@/store/app-store[\'"];?', '\n'.join(import_statements), content)
    
    if content != original_content:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Updated {path}")

for root, dirs, files in os.walk('c:/_cloud/__cfab_demon/__client/dashboard/src'):
    for file in files:
        if file.endswith(('.ts', '.tsx')):
            process_file(os.path.join(root, file))
