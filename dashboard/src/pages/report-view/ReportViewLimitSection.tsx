import { format, parseISO } from 'date-fns';
import { useTranslation } from 'react-i18next';

import type { ReportViewController } from '@/hooks/useReportViewController';
import { formatLimitHours } from '@/lib/project-limit';

type ReportViewLimitSectionProps = Pick<
  ReportViewController,
  'fmtDur' | 'has' | 'report' | 't'
>;

/**
 * Rozliczenie limitu godzin. Okres rozliczeniowy ma własny kalendarz (dzień startu
 * projektu), więc jego daty są wydrukowane wprost — mogą się różnić od okresu raportu.
 */
export function ReportViewLimitSection({
  fmtDur,
  has,
  report,
  t,
}: ReportViewLimitSectionProps) {
  const { i18n } = useTranslation();
  const limit = report?.limit;
  if (!limit || !has('limit')) {
    return null;
  }

  const boosted = limit.over_sessions.filter((s) => s.rate_multiplier > 1);

  return (
    <div>
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2 print:text-gray-500">
        {t('report_view.limit_title')}
      </h2>

      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-[9px] text-muted-foreground/50 print:text-gray-500">
            {t('report_view.limit_cycle')}
          </div>
          <div className="font-mono text-[11px] print:text-black">
            {limit.cycle_start} – {limit.cycle_end}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground/50 print:text-gray-500">
            {t('report_view.limit_hours')}
          </div>
          <div className="font-mono font-bold print:text-black">
            {formatLimitHours(limit.limit_hours, i18n.language)}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground/50 print:text-gray-500">
            {t('report_view.limit_used')}
          </div>
          <div className="font-mono font-bold print:text-black">
            {formatLimitHours(limit.used_hours, i18n.language)}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground/50 print:text-gray-500">
            {t('report_view.limit_over')}
          </div>
          <div className="font-mono font-bold text-amber-400 print:text-amber-700">
            {formatLimitHours(limit.over_hours, i18n.language)}
          </div>
        </div>
      </div>

      {limit.manual_over_hours > 0 ? (
        <p className="mt-2 text-[10px] text-muted-foreground/50 print:text-gray-500">
          {t('report_view.limit_manual_note', {
            hours: formatLimitHours(limit.manual_over_hours, i18n.language),
          })}
        </p>
      ) : null}

      {boosted.length > 0 ? (
        <table className="mt-3 w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-border/20 text-left text-muted-foreground/50 print:border-gray-300 print:text-gray-500">
              <th className="py-1 pr-2 font-medium">{t('report_view.date')}</th>
              <th className="py-1 pr-2 font-medium">{t('report_view.app')}</th>
              <th className="py-1 pr-2 text-right font-medium">
                {t('report_view.time')}
              </th>
              <th className="py-1 pr-2 text-right font-medium">
                {t('report_view.multiplier')}
              </th>
            </tr>
          </thead>
          <tbody>
            {boosted.map((session) => (
              <tr
                key={session.id}
                className="border-b border-border/10 print:border-gray-100"
              >
                <td className="whitespace-nowrap py-1 pr-2 font-mono text-muted-foreground/60 print:text-gray-600">
                  {format(parseISO(session.start_time), 'yyyy-MM-dd')}
                </td>
                <td className="max-w-[120px] truncate py-1 pr-2 print:text-black">
                  {session.app_name}
                </td>
                <td className="py-1 pr-2 text-right font-mono print:text-black">
                  {fmtDur(session.effective_seconds)}
                </td>
                <td className="py-1 text-right font-mono text-amber-400 print:text-amber-700">
                  {session.rate_multiplier}×
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
