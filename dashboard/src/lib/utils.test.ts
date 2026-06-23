import { describe, expect, it } from 'vitest';

import { getErrorMessage } from '@/lib/utils';

describe('getErrorMessage', () => {
  it('extracts message from { code, message } (CommandError shape)', () => {
    expect(
      getErrorMessage({ code: 'not_found', message: 'nie znaleziono' }, 'fallback')
    ).toBe('nie znaleziono');
  });

  it('returns raw string for plain string error', () => {
    expect(getErrorMessage('coś poszło nie tak', 'fallback')).toBe('coś poszło nie tak');
  });

  it('returns message from Error instance', () => {
    expect(getErrorMessage(new Error('błąd instancji'), 'fallback')).toBe('błąd instancji');
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
