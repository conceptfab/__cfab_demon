import type { ReportViewController } from '@/hooks/useReportViewController';
import { ReportViewAiSection } from '@/pages/report-view/ReportViewAiSection';
import { ReportViewBoostsSection } from '@/pages/report-view/ReportViewBoostsSection';
import { ReportViewCommentsSection } from '@/pages/report-view/ReportViewCommentsSection';
import { ReportViewFinancialsSection } from '@/pages/report-view/ReportViewFinancialsSection';
import { ReportViewFooterSection } from '@/pages/report-view/ReportViewFooterSection';
import { ReportViewHeaderSection } from '@/pages/report-view/ReportViewHeaderSection';
import { ReportViewManualSessionsSection } from '@/pages/report-view/ReportViewManualSessionsSection';
import { ReportViewSessionsSection } from '@/pages/report-view/ReportViewSessionsSection';
import { ReportViewStatsSection } from '@/pages/report-view/ReportViewStatsSection';
import { ReportViewTopAppsSection } from '@/pages/report-view/ReportViewTopAppsSection';

interface ReportViewDocumentProps {
  controller: ReportViewController;
}

export function ReportViewDocument({ controller }: ReportViewDocumentProps) {
  return (
    <div className="flex-1 overflow-y-auto px-4 pt-4 print:px-0 print:pt-0 print:overflow-visible print:text-black print:bg-white print:!h-auto print:!max-h-none print:!flex-none">
      <div className="max-w-[700px] mx-auto space-y-6 print:space-y-5">
        <ReportViewHeaderSection {...controller} />
        <ReportViewStatsSection {...controller} />
        <ReportViewFinancialsSection {...controller} />
        <ReportViewTopAppsSection {...controller} />
        <ReportViewAiSection {...controller} />
        <ReportViewSessionsSection {...controller} />
        <ReportViewCommentsSection {...controller} />
        <ReportViewBoostsSection {...controller} />
        <ReportViewManualSessionsSection {...controller} />
        <ReportViewFooterSection {...controller} />
      </div>
    </div>
  );
}
