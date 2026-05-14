import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadPmViewDefaults,
  savePmViewDefaults,
  PM_VIEW_DEFAULTS,
  PM_VIEW_STORAGE_KEYS,
  type PmViewDefaults,
} from './pm-view-defaults';

function makeLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
}

describe('pm-view-defaults', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { localStorage: makeLocalStorageMock() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns defaults when localStorage is empty', () => {
    expect(loadPmViewDefaults()).toEqual(PM_VIEW_DEFAULTS);
  });

  it('round-trips a saved view', () => {
    const view: PmViewDefaults = {
      filterYear: '26',
      filterClient: 'METRO',
      filterStatus: 'active',
      sortField: 'client',
      sortDir: 'asc',
    };
    savePmViewDefaults(view);
    expect(loadPmViewDefaults()).toEqual(view);
  });

  it('falls back on invalid sortField / sortDir, keeps other fields', () => {
    window.localStorage.setItem(PM_VIEW_STORAGE_KEYS.year, '25');
    window.localStorage.setItem(PM_VIEW_STORAGE_KEYS.sortField, 'bogus');
    window.localStorage.setItem(PM_VIEW_STORAGE_KEYS.sortDir, 'sideways');
    const result = loadPmViewDefaults();
    expect(result.filterYear).toBe('25');
    expect(result.sortField).toBe('number');
    expect(result.sortDir).toBe('desc');
  });

  it('returns defaults when localStorage.getItem throws', () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: () => { throw new Error('blocked'); } },
    });
    expect(loadPmViewDefaults()).toEqual(PM_VIEW_DEFAULTS);
  });

  it('savePmViewDefaults does not throw when setItem throws', () => {
    vi.stubGlobal('window', {
      localStorage: { setItem: () => { throw new Error('blocked'); } },
    });
    expect(() => savePmViewDefaults(PM_VIEW_DEFAULTS)).not.toThrow();
  });
});
