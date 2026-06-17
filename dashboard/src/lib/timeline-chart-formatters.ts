import { format, parseISO, type Locale } from 'date-fns';

export function formatTimelineAxisLabel(
  raw: string,
  isHourly: boolean,
  daySpan: number,
  locale: Locale | undefined,
): string {
  try {
    if (isHourly) return format(parseISO(raw), 'HH:mm');
    if (daySpan <= 7) return format(parseISO(raw), 'EEE', { locale });
    return format(parseISO(raw), 'MMM d', { locale });
  } catch {
    return raw;
  }
}

export function formatTimelineTooltipLabel(
  raw: string,
  isHourly: boolean,
  locale: Locale | undefined,
): string {
  try {
    return format(
      parseISO(raw),
      isHourly ? 'MMM d, yyyy HH:mm' : 'MMM d, yyyy',
      { locale },
    );
  } catch {
    return raw;
  }
}
