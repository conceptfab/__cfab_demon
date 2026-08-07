import { formatDurationRaw, formatDurationSlimRaw, formatMoney } from '@/lib/utils';
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
  const costs = report?.costs ?? [];
  const costsTotal = report?.costs_total ?? 0;

  // Projekt może mieć same koszty bez śladu czasu (np. zakup licencji przed startem
  // prac) — wtedy sekcja finansowa nadal musi się pokazać.
  if (
    !report ||
    !displayValues ||
    !has('financials') ||
    (report.estimate <= 0 && costsTotal <= 0)
  ) {
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
            {(displayValues.fullHour ? formatDurationSlimRaw : formatDurationRaw)(
              displayValues.displayTotal,
            )}
          </div>
        </div>
      </div>

      {costs.length > 0 && (
        <div className="mt-4 border-t border-emerald-500/20 pt-3 print:border-green-200">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2 print:text-gray-500">
            {t('costs.report_section_title')}
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground/50 print:text-gray-500">
                <th className="pb-1 font-medium">{t('costs.column_date')}</th>
                <th className="pb-1 font-medium">
                  {t('costs.column_comment')}
                </th>
                <th className="pb-1 text-right font-medium">
                  {t('costs.column_amount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {costs.map((cost) => (
                <tr key={cost.uid}>
                  <td className="py-0.5 print:text-black">{cost.cost_date}</td>
                  <td className="py-0.5 text-muted-foreground print:text-gray-600">
                    {cost.comment ?? t('ui.common.not_available')}
                  </td>
                  <td className="py-0.5 text-right font-mono print:text-black">
                    {formatMoney(cost.amount, currencyCode)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-2 flex items-baseline justify-between border-t border-emerald-500/20 pt-2 text-sm font-bold print:border-green-200">
            <span className="text-muted-foreground/70 print:text-gray-600">
              {t('costs.summary_grand_total')}
            </span>
            <span className="font-mono text-emerald-400 print:text-green-700">
              {formatMoney(displayValues.displayValue + costsTotal, currencyCode)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
