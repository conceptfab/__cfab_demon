import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Konfiguracja testów (vitest). Trzymana osobno od vite.config.ts, by build
// produkcyjny nie ładował setupu testowego. Setup dostarcza in-memory
// `localStorage` dla testów modułów opartych o localStorage.
//
// Dwa projekty (Vitest 4.x — brak environmentMatchGlobs):
//   • "node"  — *.test.ts  → środowisko node (testy logiki, bez DOM)
//   • "jsdom" — *.test.tsx → środowisko jsdom (testy komponentów React)
const alias = { '@': path.resolve(__dirname, './src') };

export default defineConfig({
  test: {
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          include: ['src/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['./vitest.setup.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'jsdom',
          include: ['src/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
  },
});
