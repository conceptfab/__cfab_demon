import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ROUNDING_SETTINGS,
  distributeReportRounding,
} from '@/lib/rounding';

const days = [
  { date: '2026-03-01', sessionSeconds: [2700, 900] },
  { date: '2026-03-02', sessionSeconds: [1200] },
];

describe('report rounding consistency', () => {
  for (const mode of ['per_total', 'per_session', 'per_day'] as const) {
    it(`timeline days reconcile with total in ${mode}`, () => {
      const r = distributeReportRounding(days, {
        ...DEFAULT_ROUNDING_SETTINGS,
        enabled: true,
        mode,
        intervalMinutes: 15,
      });
      const daysSum = r.days.reduce((acc, day) => acc + day.daySeconds, 0);
      if (mode === 'per_total') {
        expect(r.totalSeconds).toBeGreaterThanOrEqual(daysSum);
      } else {
        expect(daysSum).toBe(r.totalSeconds);
      }
    });
  }
});
