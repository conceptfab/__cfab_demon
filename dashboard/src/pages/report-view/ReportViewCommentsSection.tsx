import { format, parseISO } from 'date-fns';

import type { ReportViewController } from '@/hooks/useReportViewController';

type ReportViewCommentsSectionProps = Pick<
  ReportViewController,
  'has' | 'screenLimit' | 'sessionStats' | 'setShowAll' | 'showAll' | 't'
>;

export function ReportViewCommentsSection({
  has,
  screenLimit,
  sessionStats,
  setShowAll,
  showAll,
  t,
}: ReportViewCommentsSectionProps) {
  if (!sessionStats || !has('comments') || sessionStats.sessionsWithComments.length === 0) {
    return null;
  }

  const comments = sessionStats.sessionsWithComments;
  const visibleComments = showAll ? comments : comments.slice(0, screenLimit);

  return (
    <div>
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2 print:text-gray-500">
        {t('report_view.comments')} ({comments.length})
      </h2>
      <div className="space-y-1.5">
        {visibleComments.map((s) => (
          <div key={s.id} className="flex gap-3 text-xs print:text-black">
            <span className="text-muted-foreground/40 font-mono shrink-0 print:text-gray-500">
              {format(parseISO(s.start_time), 'yyyy-MM-dd')}
            </span>
            <span>{s.comment}</span>
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
