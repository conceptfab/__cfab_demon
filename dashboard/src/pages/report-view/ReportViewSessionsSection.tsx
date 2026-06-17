import { format, parseISO } from 'date-fns';

import type { ReportViewController } from '@/hooks/useReportViewController';

type ReportViewSessionsSectionProps = Pick<
  ReportViewController,
  'fmtDur' | 'has' | 'report' | 'screenLimit' | 'setShowAll' | 'showAll' | 't'
>;

export function ReportViewSessionsSection({
  fmtDur,
  has,
  report,
  screenLimit,
  setShowAll,
  showAll,
  t,
}: ReportViewSessionsSectionProps) {
  if (!report || !has('sessions') || report.sessions.length === 0) return null;

  const visibleSessions = showAll
    ? report.sessions
    : report.sessions.slice(0, screenLimit);

  return (
    <div>
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2 print:text-gray-500">
        {t('report_view.sessions')} ({report.sessions.length})
      </h2>
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="border-b border-border/20 print:border-gray-300 text-left text-muted-foreground/50 print:text-gray-500">
            <th className="py-1 pr-2 font-medium">{t('report_view.date')}</th>
            <th className="py-1 pr-2 font-medium">{t('report_view.app')}</th>
            <th className="py-1 pr-2 font-medium text-right">
              {t('report_view.time')}
            </th>
            <th className="py-1 font-medium">{t('report_view.comment')}</th>
          </tr>
        </thead>
        <tbody>
          {visibleSessions.map((s) => (
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
              <td className="py-1 text-muted-foreground/50 truncate max-w-[200px] print:text-gray-600">
                {s.comment?.trim() || ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!showAll && report.sessions.length > screenLimit && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-[10px] text-sky-500 hover:text-sky-400 mt-1 print:hidden"
        >
          {t('report_view.show_all')} ({report.sessions.length})
        </button>
      )}
    </div>
  );
}
