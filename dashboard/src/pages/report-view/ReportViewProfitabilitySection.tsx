import type { ReportViewController } from '@/hooks/useReportViewController';
import { formatDurationSlimRaw, formatMoney } from '@/lib/utils';

type ReportViewProfitabilitySectionProps = Pick<
  ReportViewController,
  'currencyCode' | 'displayValues' | 'has' | 'report' | 't'
>;

export function ReportViewProfitabilitySection({
  currencyCode,
  displayValues,
  has,
  report,
  t,
}: ReportViewProfitabilitySectionProps) {
  if (!report || !displayValues) return null;

  const renders = report.cfab_renders ?? [];
  const costsTotal = report.costs_total ?? 0;
  const estimateHours = report.estimate ?? 0;

  // Render profitability if explicitly requested in sections or when project has renders
  const showSection = has('profitability') || (has('financials') && renders.length > 0);
  if (!showSection) return null;

  const workSeconds =
    (report.sessions?.reduce((acc, s) => acc + (s.duration_seconds || 0), 0) || 0) +
    (report.manual_sessions?.reduce((acc, s) => acc + (s.duration_seconds || 0), 0) || 0);
  const hourlyRate = report.project?.hourly_rate ?? 0;
  const workHours = workSeconds / 3600;
  const workCost = workHours * hourlyRate;

  const renderSeconds = renders.reduce((acc, r) => acc + (r.render_seconds || 0), 0);
  const renderRbh = renderSeconds / 3600;
  const renderCoefficient = 1.0;
  const renderCost = renderRbh * renderCoefficient * hourlyRate;

  const totalCost = workCost + renderCost + costsTotal;
  const estimateCost = estimateHours * hourlyRate;
  const delta = totalCost - estimateCost;
  const deltaPercent = estimateCost > 0 ? ((delta / estimateCost) * 100).toFixed(1) : '—';

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 print:border-green-200 print:bg-green-50 print:break-inside-avoid">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-3 print:text-gray-500">
        {t('reports.profitability_title', 'Analiza rentowności')}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/40 text-left text-muted-foreground">
            <th className="pb-1 font-medium">{t('reports.profitability_item', 'Składnik')}</th>
            <th className="pb-1 text-right font-medium">{t('reports.profitability_quantity', 'Ilość')}</th>
            <th className="pb-1 text-right font-medium">{t('reports.profitability_value', 'Wartość')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          <tr>
            <td className="py-1">{t('reports.profitability_work_hours', 'Czas pracy (sesje)')}</td>
            <td className="py-1 text-right font-mono">{formatDurationSlimRaw(workSeconds)}</td>
            <td className="py-1 text-right font-mono text-emerald-400 print:text-green-700">
              {formatMoney(workCost, currencyCode)}
            </td>
          </tr>
          {renders.length > 0 && (
            <tr>
              <td className="py-1">{t('reports.profitability_render_rbh', 'Czas renderowania (RBH)')}</td>
              <td className="py-1 text-right font-mono">
                {renderRbh.toFixed(2)} RBH × {renderCoefficient}
              </td>
              <td className="py-1 text-right font-mono text-emerald-400 print:text-green-700">
                {formatMoney(renderCost, currencyCode)}
              </td>
            </tr>
          )}
          {costsTotal > 0 && (
            <tr>
              <td className="py-1">{t('reports.profitability_additional_costs', 'Koszty bezpośrednie')}</td>
              <td className="py-1 text-right font-mono">—</td>
              <td className="py-1 text-right font-mono text-emerald-400 print:text-green-700">
                {formatMoney(costsTotal, currencyCode)}
              </td>
            </tr>
          )}
          <tr className="font-semibold border-t border-border/40">
            <td className="py-1.5">{t('reports.profitability_total', 'Koszt całkowity')}</td>
            <td className="py-1.5 text-right" />
            <td className="py-1.5 text-right font-mono text-emerald-400 print:text-green-700">
              {formatMoney(totalCost, currencyCode)}
            </td>
          </tr>
        </tbody>
      </table>

      {estimateHours > 0 && (
        <div className="mt-3 rounded border border-border/30 bg-background/50 p-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t('reports.profitability_estimate', 'Wartość kosztorysowa')}</span>
            <span className="font-mono">{formatMoney(estimateCost, currencyCode)}</span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-muted-foreground">{t('reports.profitability_delta', 'Odchylenie od budżetu')}</span>
            <span
              className={`font-mono font-semibold ${
                delta > 0 ? 'text-destructive print:text-red-600' : 'text-emerald-400 print:text-green-700'
              }`}
            >
              {delta > 0 ? '+' : ''}
              {formatMoney(delta, currencyCode)} ({deltaPercent}%)
            </span>
          </div>
        </div>
      )}

      {renders.length > 0 && (
        <p className="text-[10px] text-muted-foreground mt-2">
          {t('reports.profitability_iterations', { count: renders.length, defaultValue: `Rendery: ${renders.length} iteracji` })}
        </p>
      )}
    </div>
  );
}
