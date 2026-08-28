import { Fragment } from 'react';
import { format, parseISO } from 'date-fns';
import { Monitor, Pencil } from 'lucide-react';

import type { ReportViewController } from '@/hooks/useReportViewController';
import i18n from '@/i18n';
import { formatDurationRaw } from '@/lib/utils';
import type { TimelineDay } from '@/lib/report-timeline';

type ReportViewTimelineSectionProps = Pick<
  ReportViewController,
  | 'has'
  | 'reportRounding'
  | 'rounded'
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
  has,
  reportRounding,
  rounded,
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
  const roundedByDate = new Map(
    reportRounding?.days.map((day) => [day.date, day]),
  );

  return (
    <div>
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2 print:text-gray-500">
        {t('report_view.timeline')} ({totalEntries})
      </h2>
      <div className="space-y-3">
        {visibleDays.map((day) => {
          const roundedDay = roundedByDate.get(day.date);
          return (
          <div key={day.date}>
            <div className="flex items-baseline justify-between border-b border-border/20 print:border-gray-300 pb-0.5 mb-0.5">
              <span className="text-[10px] font-semibold font-mono text-muted-foreground/70 print:text-gray-700">
                {day.date}{' '}
                <span className="font-normal text-muted-foreground/40 print:text-gray-500">
                  · {weekdayName(day.date)}
                </span>
              </span>
              <span className="text-[10px] font-mono text-muted-foreground/60 print:text-gray-600">
                {formatDurationRaw(roundedDay?.daySeconds ?? day.totalSeconds)}
              </span>
            </div>
            <table className="w-full text-[11px] border-collapse">
              <tbody>
                {day.entries.map((entry, index) => (
                  <Fragment key={entry.key}>
                    <tr className="border-b border-border/10 print:border-gray-100">
                      {/* Przy zaokrągleniu jedyny czas w timeline to suma dzienna —
                          godziny startu i czasy sesji są ukrywane, żeby raport nie
                          pokazywał surowych minut obok zaokrąglonych sum. */}
                      {!rounded && (
                        <td className="py-1 pr-2 font-mono text-muted-foreground/60 print:text-gray-600 whitespace-nowrap w-12">
                          {format(parseISO(entry.startTime), 'HH:mm')}
                        </td>
                      )}
                      <td className="py-1 pr-2 text-muted-foreground/50 print:text-gray-600 whitespace-nowrap w-14">
                        {entry.kind === 'manual' ? (
                          <Pencil
                            className="size-3 print:text-gray-600"
                            aria-label={t('report_view.timeline_manual')}
                          >
                            <title>{t('report_view.timeline_manual')}</title>
                          </Pencil>
                        ) : (
                          <Monitor
                            className="size-3 print:text-gray-600"
                            aria-label={t('report_view.timeline_auto')}
                          >
                            <title>{t('report_view.timeline_auto')}</title>
                          </Monitor>
                        )}
                      </td>
                      <td
                        colSpan={rounded ? 2 : 1}
                        className="py-1 pr-2 truncate max-w-[200px] print:text-black"
                      >
                        {entry.label}
                        {entry.mergedCount > 1 && (
                          <span className="ml-1 font-mono text-muted-foreground/50 print:text-gray-600">
                            ×{entry.mergedCount}
                          </span>
                        )}
                        {entry.sessionType ? (
                          <span className="text-muted-foreground/50 print:text-gray-600">
                            {' '}
                            · {entry.sessionType}
                          </span>
                        ) : null}
                      </td>
                      {!rounded && (
                        <td className="py-1 font-mono text-right print:text-black whitespace-nowrap">
                          {formatDurationRaw(
                            roundedDay?.entrySeconds[index] ?? entry.durationSeconds,
                          )}
                        </td>
                      )}
                    </tr>
                    {entry.comment && (
                      <tr className="border-b border-border/10 print:border-gray-100">
                        <td />
                        <td
                          colSpan={rounded ? 2 : 3}
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
          );
        })}
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
