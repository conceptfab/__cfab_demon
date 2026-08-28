import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns';

import { ALL_TIME_DATE_RANGE } from '@/lib/date-helpers';
import type { DateRange } from '@/lib/db-types';

/**
 * Okres rozliczeniowy raportu projektowego. Backend filtruje po `session_date`
 * (obie granice włącznie), więc miesiąc to `YYYY-MM-01` .. ostatni dzień miesiąca.
 */
export type ReportPeriodPreset =
  | 'all_time'
  | 'this_month'
  | 'last_month'
  | 'custom';

/**
 * `range` dla presetu `all_time` to faktyczne granice danych projektu (pierwszy
 * i ostatni dzień z sesją / kosztem), a nie sztywne `2020-01-01 .. 2100-01-01` —
 * dzięki temu nagłówek raportu podaje realny okres projektu. Wartownik zostaje
 * tylko wtedy, gdy granic nie udało się ustalić (brak danych / błąd zapytania).
 */
export interface ReportPeriod {
  preset: ReportPeriodPreset;
  range: DateRange;
}

export const ALL_TIME_PERIOD: ReportPeriod = {
  preset: 'all_time',
  range: ALL_TIME_DATE_RANGE,
};

const ISO_DATE = 'yyyy-MM-dd';

function monthRange(date: Date): DateRange {
  return {
    start: format(startOfMonth(date), ISO_DATE),
    end: format(endOfMonth(date), ISO_DATE),
  };
}

/**
 * Buduje okres dla presetu. `custom` bez podanego zakresu spada na bieżący miesiąc —
 * daje sensowny punkt startowy w pickerze zamiast pustych pól. `all_time` z podanym
 * zakresem przyjmuje FAKTYCZNE granice projektu (patrz {@link ReportPeriod}); bez
 * nich spada na otwarty zakres-wartownik, który nie gubi żadnych danych.
 */
export function buildReportPeriod(
  preset: ReportPeriodPreset,
  range?: DateRange,
  now: Date = new Date(),
): ReportPeriod {
  switch (preset) {
    case 'this_month':
      return { preset, range: monthRange(now) };
    case 'last_month':
      return { preset, range: monthRange(subMonths(now, 1)) };
    case 'custom':
      return { preset, range: range ?? monthRange(now) };
    case 'all_time':
    default:
      return range ? { preset: 'all_time', range } : ALL_TIME_PERIOD;
  }
}

export function isAllTimePeriod(period: ReportPeriod): boolean {
  return period.preset === 'all_time';
}

/**
 * Czy zakres to otwarty wartownik `2020-01-01 .. 2100-01-01` (brak realnych granic).
 * Takiego zakresu NIE pokazujemy użytkownikowi — nic nie mówi o projekcie.
 */
export function isOpenEndedRange(range: DateRange): boolean {
  return (
    range.start === ALL_TIME_DATE_RANGE.start &&
    range.end === ALL_TIME_DATE_RANGE.end
  );
}

/** Etykieta okresu do nagłówka/stopki dokumentu i nazwy pliku PDF. */
export function formatPeriodLabel(period: ReportPeriod): string {
  return `${period.range.start} – ${period.range.end}`;
}

/**
 * Sufiks nazwy pliku PDF: `2026-07` dla pełnego miesiąca, `2026-07-05_2026-07-20`
 * dla dowolnego innego zakresu, pusty dla całego okresu.
 */
export function buildPeriodFileSuffix(period: ReportPeriod): string {
  if (isAllTimePeriod(period)) return '';
  const { start, end } = period.range;
  const startMonth = start.slice(0, 7);
  if (startMonth === end.slice(0, 7) && start === `${startMonth}-01`) {
    const lastDay = format(endOfMonth(new Date(`${start}T00:00:00`)), ISO_DATE);
    if (end === lastDay) return startMonth;
  }
  return `${start}_${end}`;
}
