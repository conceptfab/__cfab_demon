import { format } from 'date-fns';
import type { Locale } from 'date-fns';
import { enUS, pl } from 'date-fns/locale';

import type { DateRange } from '@/lib/db-types';

export const ALL_TIME_START = '2020-01-01';
export const ALL_TIME_OPEN_END = '2100-01-01';

export const ALL_TIME_DATE_RANGE: DateRange = {
  start: ALL_TIME_START,
  end: ALL_TIME_OPEN_END,
};

export function buildTodayDate(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export function resolveDateFnsLocale(language?: string | null): Locale {
  if (language?.toLowerCase().startsWith('pl')) {
    return pl;
  }
  return enUS;
}
