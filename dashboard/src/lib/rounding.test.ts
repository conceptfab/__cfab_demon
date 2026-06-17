import { describe, it, expect } from 'vitest';
import {
  roundSeconds,
  roundDurations,
  roundDailyTotals,
  roundAggregate,
  effectiveIntervalMinutes,
  scaleValueToRounded,
  normalizeRoundingSettings,
  DEFAULT_ROUNDING_SETTINGS,
  FULL_HOUR_MINUTES,
  type RoundingSettings,
} from './rounding';

const settings = (over: Partial<RoundingSettings>): RoundingSettings => ({
  ...DEFAULT_ROUNDING_SETTINGS,
  ...over,
});

describe('roundSeconds', () => {
  it('returns 0 for zero and invalid values', () => {
    expect(roundSeconds(0, 15)).toBe(0);
    expect(roundSeconds(-100, 15)).toBe(0);
    expect(roundSeconds(Number.NaN, 15)).toBe(0);
  });

  it('rounds up to the interval', () => {
    expect(roundSeconds(1, 15)).toBe(900); // 1s -> 15 min
    expect(roundSeconds(60, 15)).toBe(900); // 1 min -> 15 min
    expect(roundSeconds(901, 15)).toBe(1800); // 15m+1s -> 30 min
  });

  it('does not over-round a value exactly on the boundary', () => {
    expect(roundSeconds(900, 15)).toBe(900); // exactly 15 min stays
    expect(roundSeconds(3600, 60)).toBe(3600);
  });

  it('respects other intervals (6 min = 1/10 h)', () => {
    expect(roundSeconds(1, 6)).toBe(360);
    expect(roundSeconds(361, 6)).toBe(720);
  });
});

describe('roundDurations — variants', () => {
  const sessions = [720, 720, 720]; // 3 x 12 min = 36 min raw

  it('disabled -> returns the raw sum', () => {
    expect(roundDurations(sessions, settings({ enabled: false }))).toBe(2160);
  });

  it('per_total -> rounds only the sum', () => {
    // 2160s (36m) -> 45 min = 2700s
    expect(
      roundDurations(sessions, settings({ enabled: true, mode: 'per_total', intervalMinutes: 15 })),
    ).toBe(2700);
  });

  it('per_session -> rounds each then sums', () => {
    expect(
      roundDurations(sessions, settings({ enabled: true, mode: 'per_session', intervalMinutes: 5 })),
    ).toBe(3 * 900); // 720s -> 900s (15m) at a 5-min step
  });

  it('per_session yields more than per_total for fragmented sessions', () => {
    const many = [61, 61, 61]; // 3 x ~1min
    const perTotal = roundDurations(many, settings({ enabled: true, mode: 'per_total', intervalMinutes: 15 }));
    const perSession = roundDurations(many, settings({ enabled: true, mode: 'per_session', intervalMinutes: 15 }));
    expect(perTotal).toBe(900); // 183s -> 15 min
    expect(perSession).toBe(2700); // 3 x 15 min
    expect(perSession).toBeGreaterThan(perTotal);
  });
});

describe('effectiveIntervalMinutes', () => {
  it('forces a full hour for per_day, ignoring the configured interval', () => {
    expect(
      effectiveIntervalMinutes(settings({ mode: 'per_day', intervalMinutes: 15 })),
    ).toBe(FULL_HOUR_MINUTES);
  });
  it('uses the configured interval for the other modes', () => {
    expect(
      effectiveIntervalMinutes(settings({ mode: 'per_total', intervalMinutes: 15 })),
    ).toBe(15);
    expect(
      effectiveIntervalMinutes(settings({ mode: 'per_session', intervalMinutes: 30 })),
    ).toBe(30);
  });
});

describe('roundDailyTotals — per_day', () => {
  // 3 days: 10m, 1h05m, 2h. per_day -> 1h + 2h + 2h = 5h.
  const days = [600, 3900, 7200];

  it('rounds each day up to a full hour, then sums', () => {
    expect(
      roundDailyTotals(days, settings({ enabled: true, mode: 'per_day' })),
    ).toBe(5 * 3600);
  });

  it('ignores the configured interval (always 1h) in per_day', () => {
    expect(
      roundDailyTotals(days, settings({ enabled: true, mode: 'per_day', intervalMinutes: 5 })),
    ).toBe(5 * 3600);
  });

  it('disabled -> raw sum of days', () => {
    expect(roundDailyTotals(days, settings({ enabled: false }))).toBe(11700);
  });

  it('per_total over daily totals rounds only the grand sum', () => {
    // sum 11700s (3h15m) -> 3h30m at 30 min = 12600s (one round, not per-day)
    expect(
      roundDailyTotals(days, settings({ enabled: true, mode: 'per_total', intervalMinutes: 30 })),
    ).toBe(12600);
  });
});

describe('roundDurations — per_day fallback (no day breakdown)', () => {
  it('rounds the whole flat list up to a full hour', () => {
    // 3 x 12 min = 36 min -> 1h
    expect(
      roundDurations([720, 720, 720], settings({ enabled: true, mode: 'per_day', intervalMinutes: 15 })),
    ).toBe(3600);
  });
});

describe('roundAggregate', () => {
  it('disabled -> unchanged', () => {
    expect(roundAggregate(2160, settings({ enabled: false }))).toBe(2160);
  });
  it('enabled -> rounds the total up', () => {
    expect(roundAggregate(2160, settings({ enabled: true, intervalMinutes: 15 }))).toBe(2700);
  });
});

describe('scaleValueToRounded', () => {
  it('scales value by the rounded/real ratio', () => {
    // 36 min real -> 45 min rounded; value 100 -> 125
    expect(scaleValueToRounded(100, 2160, 2700)).toBeCloseTo(125);
  });
  it('returns value unchanged when real time is zero or invalid', () => {
    expect(scaleValueToRounded(100, 0, 900)).toBe(100);
    expect(scaleValueToRounded(100, Number.NaN, 900)).toBe(100);
  });
});

describe('normalizeRoundingSettings', () => {
  it('rejects an invalid interval and mode -> defaults', () => {
    const n = normalizeRoundingSettings({ enabled: true, intervalMinutes: 7, mode: 'bogus' } as never);
    expect(n.intervalMinutes).toBe(DEFAULT_ROUNDING_SETTINGS.intervalMinutes);
    expect(n.mode).toBe(DEFAULT_ROUNDING_SETTINGS.mode);
    expect(n.enabled).toBe(true);
  });
  it('keeps valid values', () => {
    const n = normalizeRoundingSettings({ enabled: false, intervalMinutes: 30, mode: 'per_session' });
    expect(n).toEqual({ enabled: false, intervalMinutes: 30, mode: 'per_session' });
  });
  it('accepts the per_day mode', () => {
    const n = normalizeRoundingSettings({ enabled: true, intervalMinutes: 15, mode: 'per_day' });
    expect(n.mode).toBe('per_day');
  });
});
