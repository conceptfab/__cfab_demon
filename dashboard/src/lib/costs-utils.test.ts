import { describe, expect, it } from 'vitest';

import { parseAmountInput, sumCosts } from '@/lib/costs-utils';
import type { ProjectCost } from '@/lib/tauri/costs';

function cost(uid: string, amount: number): ProjectCost {
  return {
    uid,
    project_name: 'Acme',
    cost_date: '2026-05-10',
    amount,
    comment: null,
    created_at: null,
    updated_at: '2026-05-10 10:00:00',
  };
}

describe('parseAmountInput', () => {
  it('accepts a comma as the decimal separator', () => {
    expect(parseAmountInput('12,50')).toBe(12.5);
  });

  it('accepts a dot as the decimal separator', () => {
    expect(parseAmountInput('12.50')).toBe(12.5);
  });

  it('accepts zero', () => {
    expect(parseAmountInput('0')).toBe(0);
  });

  it('rejects negative amounts', () => {
    expect(parseAmountInput('-5')).toBeNull();
  });

  it('rejects non-numeric input', () => {
    expect(parseAmountInput('abc')).toBeNull();
    expect(parseAmountInput('')).toBeNull();
  });
});

describe('sumCosts', () => {
  it('returns 0 for an empty list', () => {
    expect(sumCosts([])).toBe(0);
  });

  it('sums amounts', () => {
    expect(sumCosts([cost('a', 100), cost('b', 50.5)])).toBe(150.5);
  });
});
