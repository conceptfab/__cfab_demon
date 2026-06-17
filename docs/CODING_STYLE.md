# Coding Style

## Zustand stores

- Use focused selectors for Zustand state and actions:
  `useUIStore((s) => s.currentPage)`.
- Do not destructure the whole store with `useUIStore()`, `useDataStore()`,
  `useSettingsStore()`, or other `use*Store()` hooks in components/hooks.
- Destructuring a value returned by a focused selector is allowed when the
  selected value is intentionally grouped, for example:
  `const { projects, dismissed } = useDataStore((s) => s.discoveredProjects);`.
