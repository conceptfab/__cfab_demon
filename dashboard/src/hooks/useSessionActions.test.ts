import { describe, expect, it } from 'vitest';

import {
  findSessionIdsMissingComment,
  requiresCommentForMultiplierBoost,
} from '@/lib/session-utils';
import { parsePositiveRateMultiplierInput } from '@/lib/rate-utils';

describe('useSessionActions helpers', () => {
  it('requires comment only for boost multipliers above 1', () => {
    expect(requiresCommentForMultiplierBoost(null)).toBe(false);
    expect(requiresCommentForMultiplierBoost(1)).toBe(false);
    expect(requiresCommentForMultiplierBoost(1.000_001)).toBe(false);
    expect(requiresCommentForMultiplierBoost(1.1)).toBe(true);
  });

  it('finds only sessions without a meaningful comment', () => {
    const comments = new Map<number, string | null>([
      [1, 'done'],
      [2, '   '],
      [3, null],
      [4, 'kept'],
    ]);

    expect(
      findSessionIdsMissingComment([1, 2, 3, 4, 4], (id) => comments.get(id)),
    ).toEqual([2, 3]);
  });

  it('parses only positive rate multiplier values', () => {
    expect(parsePositiveRateMultiplierInput('2')).toBe(2);
    expect(parsePositiveRateMultiplierInput('2,5')).toBe(2.5);
    expect(parsePositiveRateMultiplierInput(' 1.25 ')).toBe(1.25);
    expect(parsePositiveRateMultiplierInput('0')).toBeNull();
    expect(parsePositiveRateMultiplierInput('-1')).toBeNull();
    expect(parsePositiveRateMultiplierInput('abc')).toBeNull();
  });
});
