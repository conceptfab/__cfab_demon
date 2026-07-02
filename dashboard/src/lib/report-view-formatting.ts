import { formatDurationRaw, formatDurationSlimRaw } from '@/lib/utils';
import {
  effectiveIntervalMinutes,
  FULL_HOUR_MINUTES,
  roundDailyTotals,
  roundSeconds,
  scaleValueToRounded,
  type RoundingSettings,
} from '@/lib/rounding';

export function computeReportDisplayValues(
  report: {
    project: { total_seconds: number; daily_seconds?: readonly number[] };
    estimate: number;
    extra?: { value_base_seconds?: number };
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
  // Baza WARTOŚCI = dokładny (ułamkowy) clock z backendu, z którego liczony jest `estimate`.
  // Skalowanie po nim (a nie po `total_seconds: i64`) usuwa groszowy szum zaokrąglenia —
  // np. 43h × 100 daje dokładnie 4300,00. Fallback do `total_seconds`, gdy pole niedostępne.
  const valueBaseSeconds =
    typeof report.extra?.value_base_seconds === 'number' &&
    report.extra.value_base_seconds > 0
      ? report.extra.value_base_seconds
      : realTotal;
  const displayValue = rounded
    ? scaleValueToRounded(report.estimate, valueBaseSeconds, displayTotal)
    : report.estimate;

  // Zaokrąglanie do PEŁNEJ godziny (interwał 60 min, też tryb per_day) → wartości są
  // zawsze wielokrotnością godziny, więc minuty ("0m") są zbędne i je ukrywamy.
  const fullHour = rounded && interval === FULL_HOUR_MINUTES;

  return {
    dailySeconds,
    displayTotal,
    displayValue,
    fullHour,
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
  // Przy zaokrąglaniu do pełnej godziny pomijamy minuty (format „Xh" zamiast „Xh 0m").
  const format =
    rounded && interval === FULL_HOUR_MINUTES
      ? formatDurationSlimRaw
      : formatDurationRaw;
  return (seconds: number, daily?: readonly number[]) =>
    format(
      rounded
        ? usePerDay && daily && daily.length > 0
          ? roundDailyTotals(daily, roundingSettings)
          : roundSeconds(seconds, interval)
        : seconds,
    );
}
