import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { AppTooltip } from '@/components/ui/app-tooltip';
import type { DateRange } from '@/lib/db-types';
import type { TimePreset } from '@/store/data-store';
import { resolveDateFnsLocale } from '@/lib/date-helpers';

interface DateRangeToolbarProps {
  dateRange: DateRange;
  timePreset: TimePreset;
  setTimePreset: (preset: TimePreset) => void;
  shiftDateRange: (direction: -1 | 1) => void;
  canShiftForward: boolean;
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
  const showRangeNavigation = timePreset !== 'all' && timePreset !== 'custom';
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
          aria-pressed={timePreset === preset}
          onClick={() => setTimePreset(preset)}
          className="capitalize"
        >
          {preset === 'all'
            ? t('date_range_toolbar.all_time')
            : t(`ui.date_presets.${preset}`)}
        </Button>
      ))}

      {showRangeNavigation && (
        <>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <AppTooltip content={t('date_range_toolbar.previous_period')}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('date_range_toolbar.previous_period')}
              className="size-8"
              onClick={() => shiftDateRange(-1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
          </AppTooltip>
          <span className="min-w-[5rem] text-center text-xs text-muted-foreground">
            {dateLabel}
          </span>
          <AppTooltip content={t('date_range_toolbar.next_period')}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('date_range_toolbar.next_period')}
              className="size-8"
              onClick={() => shiftDateRange(1)}
              disabled={!canShiftForward}
            >
              <ChevronRight className="size-4" />
            </Button>
          </AppTooltip>
        </>
      )}
    </div>
  );
}

