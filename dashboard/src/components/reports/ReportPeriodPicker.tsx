import { useTranslation } from 'react-i18next';

import { DateRangePicker } from '@/components/ui/DateRangePicker';
import {
  buildReportPeriod,
  formatPeriodLabel,
  isAllTimePeriod,
  type ReportPeriod,
  type ReportPeriodPreset,
} from '@/lib/report-period';

const PRESETS: { id: ReportPeriodPreset; labelKey: string }[] = [
  { id: 'all_time', labelKey: 'report_period.all_time' },
  { id: 'this_month', labelKey: 'report_period.this_month' },
  { id: 'last_month', labelKey: 'report_period.last_month' },
];

interface ReportPeriodPickerProps {
  period: ReportPeriod;
  onChange: (period: ReportPeriod) => void;
  /** `compact` = wariant do toolbara podglądu (bez etykiety nad kontrolką). */
  compact?: boolean;
}

/**
 * Wybór okresu rozliczeniowego raportu: presety miesięczne + własny zakres.
 * Używany zarówno przy generowaniu raportu, jak i w toolbarze podglądu — obie
 * ścieżki zapisują ten sam {@link ReportPeriod} do `ui-store`.
 */
export function ReportPeriodPicker({
  period,
  onChange,
  compact = false,
}: ReportPeriodPickerProps) {
  const { t } = useTranslation();

  return (
    <div className={compact ? 'flex items-center gap-2' : 'space-y-2'}>
      {!compact && (
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          {t('report_period.label')}
        </div>
      )}

      <div className="flex items-center gap-2">
        <fieldset
          className="m-0 flex overflow-hidden rounded-md border border-border/60 p-0 text-xs"
          aria-label={t('report_period.label')}
        >
          <legend className="sr-only">{t('report_period.label')}</legend>
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={period.preset === preset.id}
              onClick={() => onChange(buildReportPeriod(preset.id))}
              className={`px-2.5 py-1 font-medium transition-colors ${
                period.preset === preset.id
                  ? 'bg-sky-600 text-white'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(preset.labelKey)}
            </button>
          ))}
        </fieldset>

        <DateRangePicker
          start={period.range.start}
          end={period.range.end}
          onApply={(range) => onChange(buildReportPeriod('custom', range))}
        />

        {compact && !isAllTimePeriod(period) && (
          <span className="whitespace-nowrap text-[10px] text-muted-foreground/60">
            {formatPeriodLabel(period)}
          </span>
        )}
      </div>

      {!compact && !isAllTimePeriod(period) && (
        <p className="text-[10px] text-muted-foreground/60">
          {formatPeriodLabel(period)}
        </p>
      )}
    </div>
  );
}
