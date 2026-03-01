const fs = require('fs');
const path = require('path');

const stores = {
  useUIStore: [
    'currentPage',
    'setCurrentPage',
    'helpTab',
    'setHelpTab',
    'sessionsFocusDate',
    'setSessionsFocusDate',
    'clearSessionsFocusDate',
    'sessionsFocusRange',
    'setSessionsFocusRange',
    'sessionsFocusProject',
    'setSessionsFocusProject',
    'projectPageId',
    'setProjectPageId',
    'firstRun',
    'setFirstRun',
  ],
  useDataStore: [
    'dateRange',
    'timePreset',
    'setDateRange',
    'setTimePreset',
    'shiftDateRange',
    'canShiftForward',
    'refreshKey',
    'triggerRefresh',
    'autoImportDone',
    'autoImportResult',
    'setAutoImportDone',
  ],
  useSettingsStore: [
    'currencyCode',
    'setCurrencyCode',
    'chartAnimations',
    'setChartAnimations',
  ],
};

function getStore(prop) {
  for (const [store, props] of Object.entries(stores)) {
    if (props.includes(prop)) return store;
  }
  return 'useAppStore'; // fallback
}

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  if (!content.includes('useAppStore')) return;

  const originalContent = content;
  const importsToAdd = new Set();

  // 1. replace: const { foo, bar } = useAppStore();
  content = content.replace(
    /const\s+\{\s*([^}]+)\s*\}\s*=\s*useAppStore\(\);/g,
    (match, propsStr) => {
      const props = propsStr
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      const storeMap = {};
      for (const p of props) {
        const cleanP = p.split(':')[0].trim(); // handle aliases
        const s = getStore(cleanP);
        if (!storeMap[s]) storeMap[s] = [];
        storeMap[s].push(p);
        importsToAdd.add(s);
      }
      return Object.entries(storeMap)
        .map(([s, pList]) => `const { ${pList.join(', ')} } = ${s}();`)
        .join('\n  ');
    },
  );

  // 2. replace: useAppStore((s) => s.prop)
  content = content.replace(
    /useAppStore(?:<.*?>)?\(\s*\([^)]*\)\s*=>\s*[a-zA-Z_]\.([a-zA-Z0-9_]+)\)/g,
    (match, prop) => {
      const s = getStore(prop);
      importsToAdd.add(s);
      return `${s}((s) => s.${prop})`;
    },
  );

  // 3. replace useAppStore.getState().prop
  content = content.replace(
    /useAppStore\.getState\(\)\.([a-zA-Z0-9_]+)/g,
    (match, prop) => {
      const s = getStore(prop);
      importsToAdd.add(s);
      return `${s}.getState().${prop}`;
    },
  );

  // 4. Update imports
  if (importsToAdd.size > 0) {
    const importStatements = Array.from(importsToAdd).map((s) => {
      if (s === 'useUIStore')
        return "import { useUIStore } from '@/store/ui-store';";
      if (s === 'useDataStore')
        return "import { useDataStore } from '@/store/data-store';";
      if (s === 'useSettingsStore')
        return "import { useSettingsStore } from '@/store/settings-store';";
    });
    content = content.replace(
      /import\s+\{\s*useAppStore\s*\}\s*from\s*['"]@\/store\/app-store['"];?/g,
      importStatements.join('\n'),
    );
  }

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Updated ${filePath}`);
  }
}

function walk(dir) {
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      walk(filePath);
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      processFile(filePath);
    }
  }
}

walk('c:/_cloud/__cfab_demon/__client/dashboard/src');
