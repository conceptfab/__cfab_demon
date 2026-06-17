import { formatDurationRaw, formatMoney } from '@/lib/utils';
import type { ReportViewController } from '@/hooks/useReportViewController';

type ReportViewFinancialsSectionProps = Pick<
  ReportViewController,
  'currencyCode' | 'displayValues' | 'has' | 'report'
> & Pick<ReportViewController, 't'>;

export function ReportViewFinancialsSection({
  currencyCode,
  displayValues,
  has,
  report,
  t,
}: ReportViewFinancialsSectionProps) {
  if (!report || !displayValues || !has('financials') || report.estimate <= 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 print:border-green-200 print:bg-green-50 print:break-inside-avoid">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2 print:text-gray-500">
        {t('report_view.financials')}
      </div>
      <div className="flex items-baseline gap-6">
        <div>
          <div className="text-[10px] text-muted-foreground/50 print:text-gray-500">
            {t('report_view.estimated_value')}
          </div>
          <div className="text-2xl font-bold text-emerald-400 print:text-green-700">
            {formatMoney(displayValues.displayValue, currencyCode)}
          </div>
        </div>
        <div className="text-muted-foreground/20 text-xl print:text-gray-300">
          /
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground/50 print:text-gray-500">
            {t('report_view.work_time')}
          </div>
          <div className="text-xl font-bold print:text-black">
            {formatDurationRaw(displayValues.displayTotal)}
          </div>
        </div>
      </div>
    </div>
  );
}
