import { format } from 'date-fns';

export function buildTodayDate(): string {
  return format(new Date(), 'yyyy-MM-dd');
}
