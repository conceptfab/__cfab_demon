import type { ReportViewController } from '@/hooks/useReportViewController';
import { ReportViewDocument } from '@/pages/report-view/ReportViewDocument';
import { ReportViewGate } from '@/pages/report-view/ReportViewGate';
import { ReportViewToolbar } from '@/pages/report-view/ReportViewToolbar';

interface ReportViewPageProps {
  controller: ReportViewController;
}

export function ReportViewPage({ controller }: ReportViewPageProps) {
  const {
    goToProject,
    loadedProjectId,
    projectPageId,
    report,
    reportError,
    t,
  } = controller;

  if (!projectPageId || loadedProjectId !== projectPageId || !report) {
    return (
      <ReportViewGate
        goToProject={goToProject}
        loadedProjectId={loadedProjectId}
        projectPageId={projectPageId}
        report={report}
        reportError={reportError}
        t={t}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen print:h-auto bg-background pt-8 print:pt-0 print:bg-white">
      <ReportViewToolbar {...controller} />
      <ReportViewDocument controller={controller} />
    </div>
  );
}
