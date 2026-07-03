import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ROUNDING_SETTINGS,
  distributeReportRounding,
  type RoundingSettings,
} from '@/lib/rounding';

const days = [
  { date: '2026-03-01', sessionSeconds: [2700, 900] },
  { date: '2026-03-02', sessionSeconds: [1200] },
];

const sum = (values: readonly number[]) =>
  values.reduce((acc, seconds) => acc + seconds, 0);

const enabledSettings = (
  mode: RoundingSettings['mode'],
): RoundingSettings => ({
  ...DEFAULT_ROUNDING_SETTINGS,
  enabled: true,
  mode,
  intervalMinutes: 15,
});

describe('report rounding consistency', () => {
  it('keeps entries, days and total identical when rounding is disabled', () => {
    const r = distributeReportRounding(days, {
      ...DEFAULT_ROUNDING_SETTINGS,
      enabled: false,
      intervalMinutes: 15,
    });

    expect(r.days.map((day) => day.entrySeconds)).toEqual([[2700, 900], [1200]]);
    expect(r.days.map((day) => day.daySeconds)).toEqual([3600, 1200]);
    expect(sum(r.days.map((day) => day.daySeconds))).toBe(4800);
    expect(r.totalSeconds).toBe(4800);
  });

  it('rounds only the grand total in per_total mode', () => {
    const r = distributeReportRounding(days, enabledSettings('per_total'));

    expect(r.days.map((day) => day.entrySeconds)).toEqual([[2700, 900], [1200]]);
    expect(r.days.map((day) => day.daySeconds)).toEqual([3600, 1200]);
    expect(sum(r.days.map((day) => day.daySeconds))).toBe(4800);
    expect(r.totalSeconds).toBe(5400);
  });

  it('rounds each entry and reconciles days with total in per_session mode', () => {
    const r = distributeReportRounding(days, enabledSettings('per_session'));

    expect(r.days.map((day) => day.entrySeconds)).toEqual([[2700, 900], [1800]]);
    expect(r.days.map((day) => day.daySeconds)).toEqual([3600, 1800]);
    expect(sum(r.days.map((day) => day.daySeconds))).toBe(5400);
    expect(r.totalSeconds).toBe(5400);
  });

  it('rounds each day to full hours and reconciles days with total in per_day mode', () => {
    const r = distributeReportRounding(days, enabledSettings('per_day'));

    expect(r.days.map((day) => day.entrySeconds)).toEqual([[2700, 900], [1200]]);
    expect(r.days.map((day) => day.daySeconds)).toEqual([3600, 3600]);
    expect(sum(r.days.map((day) => day.daySeconds))).toBe(7200);
    expect(r.totalSeconds).toBe(7200);
  });

  for (const mode of ['per_total', 'per_session', 'per_day'] as const) {
    it(`timeline days reconcile with total in ${mode}`, () => {
      const r = distributeReportRounding(days, enabledSettings(mode));
      const daysSum = r.days.reduce((acc, day) => acc + day.daySeconds, 0);
      if (mode === 'per_total') {
        expect(r.totalSeconds).toBeGreaterThanOrEqual(daysSum);
      } else {
        expect(daysSum).toBe(r.totalSeconds);
      }
    });
  }
});
