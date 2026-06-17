import { formatDurationRaw } from '@/lib/utils';
import {
  effectiveIntervalMinutes,
  roundDailyTotals,
  roundSeconds,
  scaleValueToRounded,
  type RoundingSettings,
} from '@/lib/rounding';

export function computeReportDisplayValues(
  report: {
    project: { total_seconds: number; daily_seconds?: readonly number[] };
    estimate: number;
  },
  rounded: boolean,
  roundingSettings: RoundingSettings,
) {
  const realTotal = report.project.total_seconds;
  const interval = effectiveIntervalMinutes(roundingSettings);
  const dailySeconds = report.project.daily_seconds ?? [];
  const usePerDay =
    roundingSettings.mode === 'per_day' && dailySeconds.length > 0;
  const displayTotal = rounded
    ? usePerDay
      ? roundDailyTotals(dailySeconds, roundingSettings)
      : roundSeconds(realTotal, interval)
    : realTotal;
  const displayValue = rounded
    ? scaleValueToRounded(report.estimate, realTotal, displayTotal)
    : report.estimate;

  return {
    dailySeconds,
    displayTotal,
    displayValue,
    interval,
    usePerDay,
  };
}

export function createReportDurationFormatter(
  rounded: boolean,
  usePerDay: boolean,
  roundingSettings: RoundingSettings,
  interval: number,
) {
  return (seconds: number, daily?: readonly number[]) =>
    formatDurationRaw(
      rounded
        ? usePerDay && daily && daily.length > 0
          ? roundDailyTotals(daily, roundingSettings)
          : roundSeconds(seconds, interval)
        : seconds,
    );
}
