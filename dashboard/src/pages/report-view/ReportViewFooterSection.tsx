import type { ReportViewController } from '@/hooks/useReportViewController';

type ReportViewFooterSectionProps = Pick<
  ReportViewController,
  'appVersion' | 'generatedAt' | 'has' | 'report'
>;

export function ReportViewFooterSection({
  appVersion,
  generatedAt,
  has,
  report,
}: ReportViewFooterSectionProps) {
  if (!report || !has('footer')) return null;

  return (
    <div className="text-center text-[10px] text-muted-foreground/30 pt-6 pb-8 border-t border-border/10 print:text-gray-400 print:border-gray-200">
      TIMEFLOW{appVersion ? ` v${appVersion}` : ''} · {report.project.name} ·{' '}
      {generatedAt}
    </div>
  );
}
