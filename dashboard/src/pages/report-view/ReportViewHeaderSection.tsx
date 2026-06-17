import logoSrc from '@/assets/logo.png';
import type { ReportViewController } from '@/hooks/useReportViewController';

type ReportViewHeaderSectionProps = Pick<
  ReportViewController,
  'appVersion' | 'generatedAt' | 'has' | 'report' | 't' | 'template'
>;

export function ReportViewHeaderSection({
  appVersion,
  generatedAt,
  has,
  report,
  t,
  template,
}: ReportViewHeaderSectionProps) {
  if (!report || !has('header')) return null;

  return (
    <div className="border-b-2 border-foreground/10 pb-4 print:border-black/20">
      {template.showLogo && (
        <div className="flex items-center gap-2 mb-3">
          <img src={logoSrc} alt="TIMEFLOW" className="size-8 print:block" />
          <span className="text-sm font-semibold uppercase tracking-wide print:text-black">
            TIMEFLOW
          </span>
          {appVersion && (
            <span className="text-xs text-muted-foreground/50 print:text-gray-400">
              v{appVersion}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-3 mb-1">
        <div
          className="size-5 rounded-full ring-2 ring-offset-2 ring-offset-background print:ring-offset-white"
          style={{
            backgroundColor: report.project.color,
            boxShadow: 'none',
          }}
        />
        <h1 className="text-2xl font-semibold tracking-tight print:text-black">
          {report.project.name}
        </h1>
      </div>
      <p className="text-xs text-muted-foreground print:text-gray-500 mt-1">
        {t('report_view.report_generated')}: {generatedAt}
        {report.project.frozen_at && ` · ${t('report_view.project_frozen')}`}
      </p>
    </div>
  );
}
