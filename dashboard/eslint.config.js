import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// `react-doctor/*` i `jsx-a11y/*` są egzekwowane przez CLI `npx react-doctor`
// (wynik 100/100), nie przez lokalny `eslint .`. Rejestrujemy te reguły jako
// no-op, żeby świadome komentarze `eslint-disable` (drag region Tauri, brak SSR,
// dynamic-import wg react-doctor) były rozpoznawane, a nie raportowane jako
// „Definition for rule … was not found”. Bez dodawania zależności.
const noopRule = { create: () => ({}) }
const stubPlugin = (names) => ({
  rules: Object.fromEntries(names.map((n) => [n, noopRule])),
})
const reactDoctorStub = stubPlugin([
  'async-await-in-loop',
  'label-has-associated-control',
  'no-static-element-interactions',
  'prefer-dynamic-import',
  'rendering-hydration-mismatch-time',
])
const jsxA11yStub = stubPlugin([
  'click-events-have-key-events',
  'label-has-associated-control',
  'no-static-element-interactions',
])

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'src-tauri/target', 'src-tauri/target/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      'react-doctor': reactDoctorStub,
      'jsx-a11y': jsxA11yStub,
    },
    // Dyrektywy `eslint-disable react-doctor/* , jsx-a11y/*` są używane przez CLI
    // react-doctor (tam te reguły faktycznie raportują). Lokalny `eslint .` widzi
    // tylko no-op stuby, więc bez tego oznaczałby je jako „unused”.
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      'react-refresh/only-export-components': [
        'error',
        {
          allowConstantExport: true,
          allowExportNames: ['buttonVariants', 'badgeVariants', 'useToast'],
        },
      ],
      // Task 90: forbid `const { ... } = useXxxStore()` — every Zustand
      // read must go through a selector so components don't re-render on
      // every store update. See docs/CODING_STYLE.md.
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            "VariableDeclarator[id.type='ObjectPattern'][init.type='CallExpression'][init.callee.type='Identifier'][init.callee.name=/^use(UI|Data|BackgroundStatus|Settings|ProjectsCache)Store$/][init.arguments.length=0]",
          message:
            'Destructuring a Zustand store without a selector subscribes the component to every field. Use `useXxxStore(s => s.field)` instead.',
        },
      ],
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
