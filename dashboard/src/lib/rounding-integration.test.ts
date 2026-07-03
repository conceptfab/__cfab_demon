import { describe, it, expect, afterEach } from 'vitest';
import { formatDuration, formatDurationRaw, formatDurationWithDaily } from './utils';
import { saveRoundingSettings, loadRoundingSettings } from './user-settings';
import { DEFAULT_ROUNDING_SETTINGS } from './rounding';
import {
  computeReportDisplayValues,
  createReportDurationFormatter,
  scaleAppSecondsToRounded,
} from './report-view-formatting';

afterEach(() => {
  saveRoundingSettings(DEFAULT_ROUNDING_SETTINGS); // reset cache between tests
});

describe('formatDuration shows rounding as an ALTERNATIVE (real stays primary)', () => {
  it('does NOT append anything when disabled (raw only)', () => {
    saveRoundingSettings({ ...DEFAULT_ROUNDING_SETTINGS, enabled: false });
    expect(formatDuration(19380)).toBe('5h 23m');
  });

  it('keeps real value primary and appends rounded alternative when enabled', () => {
    saveRoundingSettings({ enabled: true, intervalMinutes: 15, mode: 'per_total' });
    expect(loadRoundingSettings().enabled).toBe(true);
    // real 5h23m stays, rounded 5h30m appended as alternative
    expect(formatDuration(19380)).toBe('5h 23m (≈5h 30m)');
    // raw variant is always untouched
    expect(formatDurationRaw(19380)).toBe('5h 23m');
  });

  it('does NOT append when the value is already on the interval boundary', () => {
    saveRoundingSettings({ enabled: true, intervalMinutes: 15, mode: 'per_total' });
    expect(formatDuration(19800)).toBe('5h 30m'); // exactly 5h30m -> no alternative
  });

  it('reacts to interval change', () => {
    saveRoundingSettings({ enabled: true, intervalMinutes: 60, mode: 'per_total' });
    expect(formatDuration(19380)).toBe('5h 23m (≈6h 0m)');
  });
});

describe('formatDurationWithDaily honors every rounding mode', () => {
  // 3 days: 10m, 1h05m, 2h. Raw total 11700s (3h15m). per_day → 1h+2h+2h = 5h.
  const days = [600, 3900, 7200];

  it('disabled → raw only, ignores daily', () => {
    saveRoundingSettings({ ...DEFAULT_ROUNDING_SETTINGS, enabled: false });
    expect(formatDurationWithDaily(11700, days)).toBe('3h 15m');
  });

  it('per_day → sums each day rounded up to a full hour', () => {
    saveRoundingSettings({ enabled: true, intervalMinutes: 15, mode: 'per_day' });
    // real 3h15m stays, ≈5h from per-day full-hour rounding (interval ignored)
    expect(formatDurationWithDaily(11700, days)).toBe('3h 15m (≈5h 0m)');
  });

  it('per_total → rounds the whole once (daily ignored)', () => {
    saveRoundingSettings({ enabled: true, intervalMinutes: 30, mode: 'per_total' });
    // 3h15m → 3h30m at 30 min
    expect(formatDurationWithDaily(11700, days)).toBe('3h 15m (≈3h 30m)');
  });

  it('per_session → rounds the aggregate at the interval (daily ignored)', () => {
    saveRoundingSettings({ enabled: true, intervalMinutes: 30, mode: 'per_session' });
    expect(formatDurationWithDaily(11700, days)).toBe('3h 15m (≈3h 30m)');
  });

  it('per_day with no daily breakdown → falls back to rounding the whole to a full hour', () => {
    saveRoundingSettings({ enabled: true, intervalMinutes: 15, mode: 'per_day' });
    // empty daily → round 3h15m up to the next full hour (4h)
    expect(formatDurationWithDaily(11700, [])).toBe('3h 15m (≈4h 0m)');
  });
});

describe('report formatter hides minutes when rounding to a FULL HOUR', () => {
  const report = { project: { total_seconds: 11700 }, estimate: 0 }; // 3h 15m

  it('full-hour interval → "Xh" without "0m"', () => {
    const settings = { enabled: true, intervalMinutes: 60, mode: 'per_total' as const };
    const dv = computeReportDisplayValues(report, true, settings);
    expect(dv.fullHour).toBe(true);
    const fmt = createReportDurationFormatter(true, dv.usePerDay, settings, dv.interval);
    expect(fmt(11700)).toBe('4h'); // 3h15m → 4h, no minutes
  });

  it('per_day mode (always full hour) → "Xh" without "0m"', () => {
    const settings = { enabled: true, intervalMinutes: 15, mode: 'per_day' as const };
    const dv = computeReportDisplayValues(report, true, settings);
    expect(dv.fullHour).toBe(true);
    const fmt = createReportDurationFormatter(true, dv.usePerDay, settings, dv.interval);
    expect(fmt(11700)).toBe('4h');
  });

  it('sub-hour interval → minutes stay visible', () => {
    const settings = { enabled: true, intervalMinutes: 15, mode: 'per_total' as const };
    const dv = computeReportDisplayValues(report, true, settings);
    expect(dv.fullHour).toBe(false);
    const fmt = createReportDurationFormatter(true, dv.usePerDay, settings, dv.interval);
    expect(fmt(11700)).toBe('3h 15m');
  });

  it('rounding disabled → minutes stay visible even at 60 min interval', () => {
    const settings = { enabled: false, intervalMinutes: 60, mode: 'per_total' as const };
    const dv = computeReportDisplayValues(report, false, settings);
    expect(dv.fullHour).toBe(false);
    const fmt = createReportDurationFormatter(false, dv.usePerDay, settings, dv.interval);
    expect(fmt(11700)).toBe('3h 15m');
  });
});

describe('app hours = app share of DEDUPLICATED auto time, scaled like the total', () => {
  // Tło (01_26_RM_Jutrzenki): backendowe top_apps[].seconds to surowe, NAKŁADAJĄCE
  // się czasy (C4D chodzi w tle, gdy używany jest ZWCAD/Photoshop) — większe niż
  // zdeduplikowany zegar. Skalowanie ich wprost współczynnikiem raportu dawało
  // C4D 20h przy 15h dni, w których w ogóle występuje. Poprawnie: udział aplikacji
  // mapujemy na zdeduplikowany czas auto i dopiero ten skalujemy.
  const appsTotal = 45900; // surowa suma aplikacji z nakładkami (12h45m)
  const autoEffective = 27000; // zdeduplikowany czas sesji auto (7h30m)
  const realTotal = 144000; // 40h raw (auto + manual, dedup)
  const displayTotal = 50 * 3600; // 50h po zaokrągleniu
  const interval = 60;

  const scale = (appSeconds: number, intervalMinutes = interval) =>
    scaleAppSecondsToRounded(
      appSeconds,
      appsTotal,
      autoEffective,
      realTotal,
      displayTotal,
      intervalMinutes,
    );

  it('maps app share onto scaled deduplicated auto time (nearest hour, not ceil)', () => {
    // budżet auto po skali: 27000 × 50/40 = 33750s (9h22m)
    expect(scale(36000)).toBe(7 * 3600); // 78.4% -> 7h21m -> 7h
    expect(scale(9000)).toBe(2 * 3600); // 19.6% -> 1h50m -> 2h
  });

  it('quantizes a trace usage to 0 instead of inflating it to a full hour', () => {
    expect(scale(900)).toBe(0); // ~2% udziału -> 11m -> "<1h"
  });

  it('apps sum never exceeds the scaled auto budget rounded up', () => {
    const sum = [36000, 9000, 900].reduce((acc, s) => acc + scale(s), 0);
    expect(sum).toBe(9 * 3600); // 9h <= 9h22m budżetu auto <= sumy dni auto
    expect(sum).toBeLessThanOrEqual(Math.ceil((autoEffective * 1.25) / 3600) * 3600);
  });

  it('respects sub-hour intervals in per_total mode', () => {
    expect(scale(36000, 15)).toBe(26100); // 7h21m -> kwant 15 min -> 7h15m
  });

  it('returns 0 for empty/invalid inputs', () => {
    expect(scale(0)).toBe(0);
    expect(
      scaleAppSecondsToRounded(3600, 0, autoEffective, realTotal, displayTotal, interval),
    ).toBe(0);
  });
});

describe('full-hour value is consistent (no grosze noise)', () => {
  // Real scenario: 100/h rate, exact clock 42h47m13.7s -> rounded to 43h.
  // Value must be exactly 43 x 100 = 4300.00, without cents noise.
  const RATE = 100;
  const valueBase = 154033.7; // fractional backend seconds used as value base
  const estimate = (valueBase / 3600) * RATE;
  const settings = { enabled: true, intervalMinutes: 60, mode: 'per_total' as const };

  it('uses the exact fractional base → 43h × 100 = 4300.00 exactly', () => {
    const report = {
      project: { total_seconds: Math.round(valueBase) },
      estimate,
      extra: { value_base_seconds: valueBase },
    };
    const dv = computeReportDisplayValues(report, true, settings);
    expect(dv.displayTotal).toBe(43 * 3600);
    expect(Number(dv.displayValue.toFixed(2))).toBe(4300);
  });

  it('without the exact base (fallback to i64 total_seconds) the grosze noise reappears', () => {
    const report = {
      project: { total_seconds: Math.round(valueBase) },
      estimate,
    };
    const dv = computeReportDisplayValues(report, true, settings);
    expect(dv.displayTotal).toBe(43 * 3600);
    // Proof that the i64 denominator injects noise: the amount is not 4300.00.
    expect(Number(dv.displayValue.toFixed(2))).not.toBe(4300);
  });
});
