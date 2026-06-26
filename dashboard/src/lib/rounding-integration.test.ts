import { describe, it, expect, afterEach } from 'vitest';
import { formatDuration, formatDurationRaw, formatDurationWithDaily } from './utils';
import { saveRoundingSettings, loadRoundingSettings } from './user-settings';
import { DEFAULT_ROUNDING_SETTINGS } from './rounding';
import {
  computeReportDisplayValues,
  createReportDurationFormatter,
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
