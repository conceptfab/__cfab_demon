import { describe, expect, it } from 'vitest';

import {
  formatLimitHours,
  limitBarPercent,
  limitTone,
  renderLimitComment,
  LIMIT_WARN_PERCENT,
} from '@/lib/project-limit';

describe('project hour limit presentation', () => {
  it('stays calm below the warning threshold', () => {
    expect(limitTone(0)).toBe('ok');
    expect(limitTone(LIMIT_WARN_PERCENT - 0.1)).toBe('ok');
  });

  it('warns from 80% and turns red exactly at the limit', () => {
    expect(limitTone(LIMIT_WARN_PERCENT)).toBe('warn');
    expect(limitTone(99.9)).toBe('warn');
    expect(limitTone(100)).toBe('over');
    expect(limitTone(140)).toBe('over');
  });

  it('treats a broken percentage as neutral rather than crashing the bar', () => {
    expect(limitTone(Number.NaN)).toBe('ok');
    expect(limitBarPercent(Number.NaN)).toBe(0);
    expect(limitBarPercent(-5)).toBe(0);
  });

  it('clamps the bar at 100% while the tone keeps signalling the overrun', () => {
    expect(limitBarPercent(42.5)).toBe(42.5);
    expect(limitBarPercent(180)).toBe(100);
  });

  it('formats hours with one decimal in the active locale', () => {
    expect(formatLimitHours(65, 'en')).toBe('65.0 h');
    expect(formatLimitHours(12.34, 'en')).toBe('12.3 h');
    expect(formatLimitHours(Number.NaN, 'en')).toBe('0.0 h');
  });

  it('renders the comment template the same way the backend does', () => {
    expect(
      renderLimitComment(
        'Praca ponad limit {limit} h ({period})',
        65,
        '2026-09-01',
        '2026-09-30',
      ),
    ).toBe('Praca ponad limit 65 h (2026-09-01 – 2026-09-30)');
  });

  it('leaves a template without placeholders untouched', () => {
    expect(renderLimitComment('Nadgodziny', 65, 'a', 'b')).toBe('Nadgodziny');
  });
});
