import { format, parseISO } from 'date-fns';

import type { ReportViewController } from '@/hooks/useReportViewController';

type ReportViewBoostsSectionProps = Pick<
  ReportViewController,
  'fmtDur' | 'has' | 'sessionStats' | 't'
>;

export function ReportViewBoostsSection({
  fmtDur,
  has,
  sessionStats,
  t,
}: ReportViewBoostsSectionProps) {
  if (!sessionStats || !has('boosts') || sessionStats.boostedSessions.length === 0) {
    return null;
  }

  return (
    <div>
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2 print:text-gray-500">
        {t('report_view.boosted_sessions')} ({sessionStats.boostedSessions.length})
      </h2>
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="border-b border-border/20 print:border-gray-300 text-left text-muted-foreground/50 print:text-gray-500">
            <th className="py-1 pr-2 font-medium">{t('report_view.date')}</th>
            <th className="py-1 pr-2 font-medium">{t('report_view.app')}</th>
            <th className="py-1 pr-2 font-medium text-right">
              {t('report_view.time')}
            </th>
            <th className="py-1 pr-2 font-medium text-right">
              {t('report_view.multiplier')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sessionStats.boostedSessions.map((s) => (
            <tr
              key={s.id}
              className="border-b border-border/10 print:border-gray-100"
            >
              <td className="py-1 pr-2 font-mono text-muted-foreground/60 print:text-gray-600 whitespace-nowrap">
                {format(parseISO(s.start_time), 'yyyy-MM-dd')}
              </td>
              <td className="py-1 pr-2 truncate max-w-[120px] print:text-black">
                {s.app_name}
              </td>
              <td className="py-1 pr-2 font-mono text-right print:text-black">
                {fmtDur(s.duration_seconds)}
              </td>
              <td className="py-1 font-mono text-right text-amber-400 print:text-amber-700">
                {s.rate_multiplier}×
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
