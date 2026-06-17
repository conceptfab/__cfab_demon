import type { ReportViewController } from '@/hooks/useReportViewController';

type ReportViewTopAppsSectionProps = Pick<
  ReportViewController,
  'fmtDur' | 'has' | 'report' | 't'
>;

export function ReportViewTopAppsSection({
  fmtDur,
  has,
  report,
  t,
}: ReportViewTopAppsSectionProps) {
  if (!report || !has('apps') || report.extra.top_apps.length === 0) return null;

  return (
    <div>
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3 print:text-gray-500">
        {t('report_view.most_used_applications')}
      </h2>
      <div className="space-y-2">
        {report.extra.top_apps.slice(0, 10).map((app) => {
          const maxSec = report.extra.top_apps[0]?.seconds || 1;
          const pct = Math.max(3, Math.round((app.seconds / maxSec) * 100));
          return (
            <div key={app.name} className="flex items-center gap-3">
              <span className="w-28 text-xs font-medium truncate text-foreground print:text-black">
                {app.name}
              </span>
              <div className="flex-1 h-5 rounded bg-secondary/20 overflow-hidden print:bg-gray-100">
                <div
                  className="h-full bg-sky-500/30 rounded print:bg-blue-200 flex items-center pl-2"
                  style={{ width: `${pct}%` }}
                >
                  <span className="text-[10px] font-mono text-foreground/70 print:text-black whitespace-nowrap">
                    {fmtDur(app.seconds, app.daily_seconds)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
