import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Konfiguracja testów (vitest). Trzymana osobno od vite.config.ts, by build
// produkcyjny nie ładował setupu testowego. Setup dostarcza in-memory
// `localStorage` dla testów modułów opartych o localStorage.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    setupFiles: ['./vitest.setup.ts'],
  },
});
