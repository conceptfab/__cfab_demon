import { describe, it, expect } from 'vitest';
import { shouldShowFrozenNotice } from './sync-overlay-helpers';

describe('shouldShowFrozenNotice', () => {
  it('hidden while creating session (step 1)', () => {
    expect(shouldShowFrozenNotice('creating_session', 1)).toBe(false);
  });
  it('hidden while awaiting peer (step 2)', () => {
    expect(shouldShowFrozenNotice('awaiting_peer', 2)).toBe(false);
  });
  it('hidden while negotiating (step 3)', () => {
    expect(shouldShowFrozenNotice('negotiating', 3)).toBe(false);
  });
  it('shown once the DB is frozen (step 5)', () => {
    expect(shouldShowFrozenNotice('freezing', 5)).toBe(true);
  });
  it('shown during transfer (step 8)', () => {
    expect(shouldShowFrozenNotice('uploading', 8)).toBe(true);
  });
  it('hidden on completion', () => {
    expect(shouldShowFrozenNotice('completed', 13)).toBe(false);
  });
  it('hidden on not_needed', () => {
    expect(shouldShowFrozenNotice('not_needed', 13)).toBe(false);
  });
  it('hidden on error phases', () => {
    expect(shouldShowFrozenNotice('error_merge', 7)).toBe(false);
  });
});
