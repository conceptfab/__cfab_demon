import { useReportViewController } from '@/hooks/useReportViewController';
import { ReportViewPage } from '@/pages/report-view/ReportViewPage';

export function ReportView() {
  const controller = useReportViewController();
  return <ReportViewPage controller={controller} />;
}
