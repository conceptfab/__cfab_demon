// Vitest setup: provides an in-memory `localStorage` global for tests that
// exercise localStorage-backed modules (np. report-templates) in the default
// node environment. Nie wymusza środowiska DOM ani dodatkowych zależności.
import { beforeEach } from 'vitest';

function makeLocalStorageMock(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(store).length;
    },
    getItem: (k: string): string | null => (k in store ? store[k] : null),
    setItem: (k: string, v: string): void => {
      store[k] = String(v);
    },
    removeItem: (k: string): void => {
      delete store[k];
    },
    clear: (): void => {
      store = {};
    },
    key: (i: number): string | null => Object.keys(store)[i] ?? null,
  };
}

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = makeLocalStorageMock();
}

// Reset między testami, tak by stan localStorage nie przeciekał.
beforeEach(() => {
  globalThis.localStorage?.clear();
});
