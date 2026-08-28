import type { ReportViewController } from '@/hooks/useReportViewController';

type ReportViewSessionsSectionProps = Pick<
  ReportViewController,
  | 'fmtSessionDur'
  | 'has'
  | 'screenLimit'
  | 'sessionRows'
  | 'setShowAll'
  | 'showAll'
  | 't'
>;

export function ReportViewSessionsSection({
  fmtSessionDur,
  has,
  screenLimit,
  sessionRows,
  setShowAll,
  showAll,
  t,
}: ReportViewSessionsSectionProps) {
  if (!sessionRows || !has('sessions') || sessionRows.length === 0) return null;

  // Wiersze przychodzą już scalone (albo nie) z kontrolera — sekcja tylko je rysuje.
  const visibleSessions = showAll ? sessionRows : sessionRows.slice(0, screenLimit);

  return (
    <div>
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2 print:text-gray-500">
        {t('report_view.sessions')} ({sessionRows.length})
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
          {visibleSessions.map((row) => (
            <tr
              key={row.key}
              className="border-b border-border/10 print:border-gray-100"
            >
              <td className="py-1 pr-2 font-mono text-muted-foreground/60 print:text-gray-600 whitespace-nowrap">
                {row.date}
              </td>
              <td className="py-1 pr-2 truncate max-w-[120px] print:text-black">
                {row.appName}
                {row.mergedCount > 1 && (
                  <span className="ml-1 font-mono text-muted-foreground/50 print:text-gray-600">
                    ×{row.mergedCount}
                  </span>
                )}
              </td>
              <td className="py-1 pr-2 font-mono text-right print:text-black">
                {fmtSessionDur(row.seconds)}
              </td>
              <td className="py-1 text-muted-foreground/50 truncate max-w-[200px] print:text-gray-600">
                {row.comment}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!showAll && sessionRows.length > screenLimit && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-[10px] text-sky-500 hover:text-sky-400 mt-1 print:hidden"
        >
          {t('report_view.show_all')} ({sessionRows.length})
        </button>
      )}
    </div>
  );
}
