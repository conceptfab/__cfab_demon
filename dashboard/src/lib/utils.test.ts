import { describe, expect, it } from 'vitest';

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
