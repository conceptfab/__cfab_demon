import type { ReportViewController } from '@/hooks/useReportViewController';

type ReportViewCommentsSectionProps = Pick<
  ReportViewController,
  'commentRows' | 'has' | 'screenLimit' | 'setShowAll' | 'showAll' | 't'
>;

export function ReportViewCommentsSection({
  commentRows,
  has,
  screenLimit,
  setShowAll,
  showAll,
  t,
}: ReportViewCommentsSectionProps) {
  if (!commentRows || !has('comments') || commentRows.length === 0) {
    return null;
  }

  // Przy scalaniu ten sam komentarz z jednego dnia pojawia się raz (z licznikiem).
  const comments = commentRows;
  const visibleComments = showAll ? comments : comments.slice(0, screenLimit);

  return (
    <div>
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2 print:text-gray-500">
        {t('report_view.comments')} ({comments.length})
      </h2>
      <div className="space-y-1.5">
        {visibleComments.map((row) => (
          <div key={row.key} className="flex gap-3 text-xs print:text-black">
            <span className="text-muted-foreground/40 font-mono shrink-0 print:text-gray-500">
              {row.date}
            </span>
            <span>
              {row.comment}
              {row.mergedCount > 1 && (
                <span className="ml-1 font-mono text-muted-foreground/40 print:text-gray-500">
                  ×{row.mergedCount}
                </span>
              )}
            </span>
          </div>
        ))}
        {!showAll && comments.length > screenLimit && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="text-[10px] text-sky-500 hover:text-sky-400 mt-1 print:hidden"
          >
            {t('report_view.show_all')} ({comments.length})
          </button>
        )}
      </div>
    </div>
  );
}
