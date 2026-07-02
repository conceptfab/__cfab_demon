import { Fragment } from 'react';
import { format, parseISO } from 'date-fns';

import type { ReportViewController } from '@/hooks/useReportViewController';
import i18n from '@/i18n';
import type { TimelineDay } from '@/lib/report-timeline';

type ReportViewTimelineSectionProps = Pick<
  ReportViewController,
  | 'fmtDur'
  | 'has'
  | 'screenLimit'
  | 'setShowAll'
  | 'showAll'
  | 't'
  | 'timelineDays'
>;

function weekdayName(date: string): string {
  return parseISO(date).toLocaleDateString(i18n.language, { weekday: 'long' });
}

export function ReportViewTimelineSection({
  fmtDur,
  has,
  screenLimit,
  setShowAll,
  showAll,
  t,
  timelineDays,
}: ReportViewTimelineSectionProps) {
  if (!timelineDays || !has('timeline') || timelineDays.length === 0) {
    return null;
  }

  const totalEntries = timelineDays.reduce(
    (sum, day) => sum + day.entries.length,
    0,
  );

  // Na ekranie tniemy po liczbie wpisów (pełnymi dniami); print zawsze dostaje
  // całość, bo handlePrint włącza showAll przy dużych raportach.
  const visibleDays: TimelineDay[] = [];
  let shownEntries = 0;
  for (const day of timelineDays) {
    if (!showAll && shownEntries >= screenLimit) break;
    visibleDays.push(day);
    shownEntries += day.entries.length;
  }

  return (
    <div>
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2 print:text-gray-500">
        {t('report_view.timeline')} ({totalEntries})
      </h2>
      <div className="space-y-3">
        {visibleDays.map((day) => (
          <div key={day.date}>
            <div className="flex items-baseline justify-between border-b border-border/20 print:border-gray-300 pb-0.5 mb-0.5">
              <span className="text-[10px] font-semibold font-mono text-muted-foreground/70 print:text-gray-700">
                {day.date}{' '}
                <span className="font-normal text-muted-foreground/40 print:text-gray-500">
                  · {weekdayName(day.date)}
                </span>
              </span>
              <span className="text-[10px] font-mono text-muted-foreground/60 print:text-gray-600">
                {fmtDur(day.totalSeconds)}
              </span>
            </div>
            <table className="w-full text-[11px] border-collapse">
              <tbody>
                {day.entries.map((entry) => (
                  <Fragment key={entry.key}>
                    <tr className="border-b border-border/10 print:border-gray-100">
                      <td className="py-1 pr-2 font-mono text-muted-foreground/60 print:text-gray-600 whitespace-nowrap w-12">
                        {format(parseISO(entry.startTime), 'HH:mm')}
                      </td>
                      <td className="py-1 pr-2 text-muted-foreground/50 print:text-gray-600 whitespace-nowrap w-14">
                        {entry.kind === 'manual'
                          ? t('report_view.timeline_manual')
                          : t('report_view.timeline_auto')}
                      </td>
                      <td className="py-1 pr-2 truncate max-w-[200px] print:text-black">
                        {entry.label}
                        {entry.sessionType ? (
                          <span className="text-muted-foreground/50 print:text-gray-600">
                            {' '}
                            · {entry.sessionType}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1 font-mono text-right print:text-black whitespace-nowrap">
                        {fmtDur(entry.durationSeconds)}
                      </td>
                    </tr>
                    {entry.comment && (
                      <tr className="border-b border-border/10 print:border-gray-100">
                        <td />
                        <td
                          colSpan={3}
                          className="py-1 pl-2 text-muted-foreground/50 italic print:text-gray-600"
                        >
                          └ {entry.comment}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      {!showAll && totalEntries > screenLimit && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-[10px] text-sky-500 hover:text-sky-400 mt-1 print:hidden"
        >
          {t('report_view.show_all')} ({totalEntries})
        </button>
      )}
    </div>
  );
}
