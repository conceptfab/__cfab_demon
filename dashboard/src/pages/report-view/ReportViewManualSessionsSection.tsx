import { format, parseISO } from 'date-fns';

import type { ReportViewController } from '@/hooks/useReportViewController';

type ReportViewManualSessionsSectionProps = Pick<
  ReportViewController,
  'fmtDur' | 'has' | 'report' | 'screenLimit' | 'setShowAll' | 'showAll' | 't'
>;

export function ReportViewManualSessionsSection({
  fmtDur,
  has,
  report,
  screenLimit,
  setShowAll,
  showAll,
  t,
}: ReportViewManualSessionsSectionProps) {
  if (!report || !has('manual_sessions') || report.manual_sessions.length === 0) {
    return null;
  }

  const visibleSessions = showAll
    ? report.manual_sessions
    : report.manual_sessions.slice(0, screenLimit);

  return (
    <div>
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2 print:text-gray-500">
        {t('report_view.manual_sessions')} ({report.manual_sessions.length})
      </h2>
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="border-b border-border/20 print:border-gray-300 text-left text-muted-foreground/50 print:text-gray-500">
            <th className="py-1 pr-2 font-medium">{t('report_view.date')}</th>
            <th className="py-1 pr-2 font-medium">{t('report_view.title')}</th>
            <th className="py-1 pr-2 font-medium">{t('report_view.type')}</th>
            <th className="py-1 pr-2 font-medium text-right">
              {t('report_view.time')}
            </th>
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
              <td className="py-1 pr-2 truncate max-w-[180px] print:text-black">
                {s.title}
              </td>
              <td className="py-1 pr-2 text-muted-foreground/50 print:text-gray-600">
                {s.session_type}
              </td>
              <td className="py-1 font-mono text-right print:text-black">
                {fmtDur(s.duration_seconds)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!showAll && report.manual_sessions.length > screenLimit && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-[10px] text-sky-500 hover:text-sky-400 mt-1 print:hidden"
        >
          {t('report_view.show_all')} ({report.manual_sessions.length})
        </button>
      )}
    </div>
  );
}
