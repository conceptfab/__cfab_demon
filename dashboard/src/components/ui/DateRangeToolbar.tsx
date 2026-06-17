import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { cn } from '@/lib/utils';
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

const SIDE_SLOT = 'size-9 shrink-0';
const PRESETS = ['today', 'week', 'month', 'all'] as const;

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

  const presetLabel = (preset: (typeof PRESETS)[number]) =>
    preset === 'all'
      ? t('date_range_toolbar.all_time')
      : t(`ui.date_presets.${preset}`);

  const dateNavigation = (
    <div className="flex items-center justify-center gap-0.5">
      <AppTooltip content={t('date_range_toolbar.previous_period')}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('date_range_toolbar.previous_period')}
          className={SIDE_SLOT}
          onClick={() => shiftDateRange(-1)}
        >
          <ChevronLeft className="size-4" />
        </Button>
      </AppTooltip>
      <span className="min-w-[4.5rem] whitespace-nowrap text-center text-xs text-muted-foreground">
        {dateLabel}
      </span>
      <AppTooltip content={t('date_range_toolbar.next_period')}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('date_range_toolbar.next_period')}
          className={SIDE_SLOT}
          onClick={() => shiftDateRange(1)}
          disabled={!canShiftForward}
        >
          <ChevronRight className="size-4" />
        </Button>
      </AppTooltip>
    </div>
  );

  return (
    <div className="box-border flex w-full min-w-0 max-w-full flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:justify-end">
      {/* Mobile: pełna szerokość, 4 równe presety */}
      <fieldset
        className="box-border m-0 flex w-full min-w-0 max-w-full rounded-lg border border-border/70 bg-muted/15 p-0.5 md:hidden"
      >
        <legend className="sr-only">{t('date_range_toolbar.preset_group')}</legend>
        {PRESETS.map((preset) => (
          <Button
            key={preset}
            variant="ghost"
            size="sm"
            aria-pressed={timePreset === preset}
            onClick={() => setTimePreset(preset)}
            className={cn(
              'h-8 min-w-0 flex-1 rounded-md px-0.5 text-[9px] leading-tight capitalize whitespace-normal shadow-none',
              timePreset === preset
                ? 'border border-primary/30 bg-primary/14 text-foreground'
                : 'border border-transparent text-muted-foreground hover:bg-accent/50',
            )}
          >
            {presetLabel(preset)}
          </Button>
        ))}
      </fieldset>

      {/* Mobile: data na środku, odświeżenie po prawej (symetryczne sloty) */}
      {(showRangeNavigation || children) && (
        <div className="grid w-full min-w-0 max-w-full grid-cols-[2.25rem_1fr_2.25rem] items-center md:hidden">
          <span className={SIDE_SLOT} aria-hidden />
          {showRangeNavigation ? dateNavigation : <div />}
          <div className="flex items-center justify-end">
            {children ?? <span className={SIDE_SLOT} aria-hidden />}
          </div>
        </div>
      )}

      {/* Desktop */}
      <div className="hidden min-w-0 flex-wrap items-center justify-end gap-2 md:flex">
        {PRESETS.map((preset) => (
          <Button
            key={preset}
            variant={timePreset === preset ? 'default' : 'outline'}
            size="sm"
            aria-pressed={timePreset === preset}
            onClick={() => setTimePreset(preset)}
            className="h-8 capitalize"
          >
            {presetLabel(preset)}
          </Button>
        ))}
        {showRangeNavigation && (
          <>
            <div className="mx-0.5 h-4 w-px bg-border" />
            {dateNavigation}
          </>
        )}
        {children ? <div className="shrink-0">{children}</div> : null}
      </div>
    </div>
  );
}
