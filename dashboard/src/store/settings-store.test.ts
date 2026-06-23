/**
 * Tests that settings-store setters write through to the shared settings
 * backend — finding #12 fix verification.
 *
 * Node environment (*.test.ts). localStorage is provided by vitest.setup.ts.
 * We spy on the save functions exported by user-settings.ts so that we can
 * verify write-through without a running Tauri backend.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @/lib/tauri so createSettingsManager does not attempt real RPC calls.
vi.mock('@/lib/tauri', () => ({
  getAllUserSettings: vi.fn().mockResolvedValue({}),
  setUserSetting: vi.fn().mockResolvedValue(undefined),
}));

// Import save functions AFTER the mock is registered so they share the same
// module instance as the store (no resetModules needed).
import * as userSettings from '@/lib/user-settings';
import { useSettingsStore } from '@/store/settings-store';

describe('settings-store write-through (finding #12)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.localStorage?.clear();
  });

  it('setCurrencyCode persists via saveCurrencySettings', () => {
    const spy = vi.spyOn(userSettings, 'saveCurrencySettings');
    useSettingsStore.getState().setCurrencyCode('EUR');
    expect(spy).toHaveBeenCalledWith({ code: 'EUR' });
  });

  it('setCurrencyCode also updates in-memory state', () => {
    useSettingsStore.setState({ currencyCode: 'PLN' });
    useSettingsStore.getState().setCurrencyCode('USD');
    expect(useSettingsStore.getState().currencyCode).toBe('USD');
  });

  it('setLanguage persists via saveLanguageSettings', () => {
    const spy = vi.spyOn(userSettings, 'saveLanguageSettings');
    useSettingsStore.getState().setLanguage('pl');
    expect(spy).toHaveBeenCalledWith({ code: 'pl' });
  });

  it('setLanguage also updates in-memory state', () => {
    useSettingsStore.setState({ language: 'en' });
    useSettingsStore.getState().setLanguage('pl');
    expect(useSettingsStore.getState().language).toBe('pl');
  });

  it('setWorkingHours persists via saveWorkingHoursSettings', () => {
    const spy = vi.spyOn(userSettings, 'saveWorkingHoursSettings');
    const next = { start: '08:00', end: '16:00', color: '#10b981' };
    useSettingsStore.getState().setWorkingHours(next);
    expect(spy).toHaveBeenCalledWith(next);
  });

  it('setSplitSettings persists via saveSplitSettings', () => {
    const spy = vi.spyOn(userSettings, 'saveSplitSettings');
    const next = {
      maxProjectsPerSession: 3,
      toleranceThreshold: 0.6,
      autoSplitEnabled: true,
    };
    useSettingsStore.getState().setSplitSettings(next);
    expect(spy).toHaveBeenCalledWith(next);
  });

  it('setRoundingSettings persists via saveRoundingSettings', () => {
    const spy = vi.spyOn(userSettings, 'saveRoundingSettings');
    const current = useSettingsStore.getState().roundingSettings;
    useSettingsStore.getState().setRoundingSettings(current);
    expect(spy).toHaveBeenCalledWith(current);
  });
});
