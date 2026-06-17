import { ChevronLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ReportViewController } from '@/hooks/useReportViewController';

type ReportViewGateProps = Pick<
  ReportViewController,
  | 'goToProject'
  | 'loadedProjectId'
  | 'projectPageId'
  | 'report'
  | 'reportError'
  | 't'
>;

export function ReportViewGate({
  goToProject,
  loadedProjectId,
  projectPageId,
  report,
  reportError,
  t,
}: ReportViewGateProps) {
  if (!projectPageId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        {t('report_view.no_project_selected')}
      </div>
    );
  }

  if (loadedProjectId !== projectPageId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        {t('report_view.generating_report')}
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="text-muted-foreground text-sm">
          {t('report_view.no_data_found')}
        </div>
        {reportError && (
          <div className="text-destructive text-xs font-mono max-w-md text-center break-all">
            {reportError}
          </div>
        )}
        <Button variant="ghost" size="sm" onClick={goToProject}>
          <ChevronLeft className="mr-1 size-4" />
          {t('report_view.back_to_project')}
        </Button>
      </div>
    );
  }

  return null;
}
