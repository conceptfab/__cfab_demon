import type { DateRange } from '@/lib/db-types';

export const ALL_TIME_START = '2020-01-01';
export const ALL_TIME_OPEN_END = '2100-01-01';

export const ALL_TIME_DATE_RANGE: DateRange = {
  start: ALL_TIME_START,
  end: ALL_TIME_OPEN_END,
};

export const allTimeRangeTo = (end: string): DateRange => ({
  start: ALL_TIME_START,
  end,
});
