import { DateRangePicker } from '@/components/ui/DateRangePicker';
import type { DateRange } from '@/lib/db-types';

interface EstimatesRangePickerProps {
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
}

/**
 * Wybór własnego zakresu dat dla panelu Estymacje. Cienki wrapper na współdzielony
 * {@link DateRangePicker} — `setDateRange` ustawi preset 'custom' w data-store.
 */
export function EstimatesRangePicker({
  dateRange,
  setDateRange,
}: EstimatesRangePickerProps) {
  return (
    <DateRangePicker
      start={dateRange.start}
      end={dateRange.end}
      onApply={setDateRange}
    />
  );
}
