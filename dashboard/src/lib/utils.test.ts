import { describe, expect, it, vi } from 'vitest';

import { getErrorMessage } from '@/lib/utils';

describe('getErrorMessage', () => {
  it('extracts message from { code, message } (CommandError shape)', () => {
    expect(
      getErrorMessage({ code: 'not_found', message: 'not found' }, 'fallback')
    ).toBe('not found');
  });

  it('returns raw string for plain string error', () => {
    expect(getErrorMessage('something went wrong', 'fallback')).toBe('something went wrong');
  });

  it('returns message from Error instance', () => {
    expect(getErrorMessage(new Error('instance error'), 'fallback')).toBe('instance error');
  });

  it('returns fallback for null', () => {
    expect(getErrorMessage(null, 'fallback')).toBe('fallback');
  });

  it('returns fallback for undefined', () => {
    expect(getErrorMessage(undefined, 'fallback')).toBe('fallback');
  });

  it('returns fallback for empty object {}', () => {
    expect(getErrorMessage({}, 'fallback')).toBe('fallback');
  });

  it('returns fallback for object with empty message string', () => {
    expect(getErrorMessage({ code: 'error', message: '   ' }, 'fallback')).toBe('fallback');
  });
});

describe('logTauriError', () => {
  it('forwards error to file via appendFrontendLog', async () => {
    vi.resetModules();
    const spy = vi.fn();
    vi.doMock('@/lib/tauri/log-management', () => ({ appendFrontendLog: spy }));
    const { logTauriError } = await import('@/lib/utils');
    logTauriError('save settings', new Error('boom'));
    await new Promise((r) => setTimeout(r, 0)); // poczekaj na dynamiczny import
    expect(spy).toHaveBeenCalledWith('error', expect.stringContaining('save settings'));
    vi.doUnmock('@/lib/tauri/log-management');
  });
});
