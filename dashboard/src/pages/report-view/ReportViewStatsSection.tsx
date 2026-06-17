import type { ReportViewController } from '@/hooks/useReportViewController';

type ReportViewStatsSectionProps = Pick<
  ReportViewController,
  'displayValues' | 'fmtDur' | 'has' | 'report' | 'sessionStats' | 't'
>;

export function ReportViewStatsSection({
  displayValues,
  fmtDur,
  has,
  report,
  sessionStats,
  t,
}: ReportViewStatsSectionProps) {
  if (!report || !sessionStats || !displayValues || !has('stats')) return null;

  return (
    <div className="grid grid-cols-3 gap-4 print:break-inside-avoid">
      {[
        {
          label: t('report_view.total_time'),
          value: fmtDur(report.project.total_seconds, displayValues.dailySeconds),
          accent: true,
        },
        {
          label: t('report_view.sessions'),
          value: String(sessionStats.totalSessions),
        },
        {
          label: t('report_view.apps'),
          value: String(report.extra.top_apps.length),
        },
      ].map((item) => (
        <div
          key={item.label}
          className="rounded-lg border border-border/20 p-3 print:border-gray-200"
        >
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 print:text-gray-500">
            {item.label}
          </div>
          <div
            className={`text-xl font-bold mt-0.5 ${item.accent ? 'text-sky-400 print:text-blue-700' : 'print:text-black'}`}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}
