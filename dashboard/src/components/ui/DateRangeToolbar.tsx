import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { DateRange } from '@/lib/db-types';
import type { TimePreset } from '@/store/data-store';
import { resolveDateFnsLocale } from '@/lib/date-locale';

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
  const { t, i18n } = useTranslation();
  const locale = resolveDateFnsLocale(i18n.resolvedLanguage);
  const dateLabel =
    dateRange.start === dateRange.end
      ? format(parseISO(dateRange.start), 'MMM d', { locale })
      : `${format(parseISO(dateRange.start), 'MMM d', { locale })} - ${format(parseISO(dateRange.end), 'MMM d', { locale })}`;

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
          {preset === 'all'
            ? t('date_range_toolbar.all_time')
            : t(`ui.date_presets.${preset}`)}
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
            title={t('date_range_toolbar.previous_period')}
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
            title={t('date_range_toolbar.next_period')}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </>
      )}
    </div>
  );
}
