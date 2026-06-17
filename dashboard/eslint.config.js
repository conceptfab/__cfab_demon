import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

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
