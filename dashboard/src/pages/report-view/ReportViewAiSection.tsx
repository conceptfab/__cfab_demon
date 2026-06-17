import type { ReportViewController } from '@/hooks/useReportViewController';

type ReportViewAiSectionProps = Pick<
  ReportViewController,
  'has' | 'sessionStats' | 't'
>;

export function ReportViewAiSection({ has, sessionStats, t }: ReportViewAiSectionProps) {
  if (!sessionStats || !has('ai')) return null;

  return (
    <div className="rounded-lg border border-border/20 p-4 print:border-gray-200 print:break-inside-avoid">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2 print:text-gray-500">
        {t('report_view.ai_model')}
      </h2>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-[10px] text-muted-foreground/50 print:text-gray-500">
            {t('report_view.ai_suggestions')}
          </div>
          <div className="font-bold text-lg print:text-black">
            {sessionStats.sessionsWithAI}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground/50 print:text-gray-500">
            {t('report_view.auto_assigned')}
          </div>
          <div className="font-bold text-lg print:text-black">
            {sessionStats.sessionsAIAssigned}
          </div>
        </div>
      </div>
    </div>
  );
}
