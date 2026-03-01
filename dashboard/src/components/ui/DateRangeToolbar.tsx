import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import type { DateRange } from '@/lib/db-types';
import type { TimePreset } from '@/store/data-store';

interface DateRangeToolbarProps {
  dateRange: DateRange;
  timePreset: TimePreset;
  setTimePreset: (preset: TimePreset) => void;
  shiftDateRange: (direction: -1 | 1) => void;
  canShiftForward: () => boolean;
  children?: React.ReactNode;
}

export function DateRangeToolbar({
  dateRange,
  timePreset,
  setTimePreset,
  shiftDateRange,
  canShiftForward,
  children,
}: DateRangeToolbarProps) {
  const dateLabel =
    dateRange.start === dateRange.end
      ? format(parseISO(dateRange.start), 'MMM d')
      : `${format(parseISO(dateRange.start), 'MMM d')} – ${format(parseISO(dateRange.end), 'MMM d')}`;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {children}

      {(['today', 'week', 'month', 'all'] as const).map((preset) => (
        <Button
          key={preset}
          variant={timePreset === preset ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setTimePreset(preset)}
          className="capitalize"
        >
          {preset === 'all' ? 'All time' : preset}
        </Button>
      ))}

      {timePreset !== 'all' && (
        <>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => shiftDateRange(-1)}
            title="Previous period"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[5rem] text-center text-xs text-muted-foreground">
            {dateLabel}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => shiftDateRange(1)}
            disabled={!canShiftForward()}
            title="Next period"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </>
      )}
    </div>
  );
}
