import { useReportsPageController } from '@/hooks/useReportsPageController';
import { ReportsView } from '@/pages/reports/ReportsView';

export function Reports() {
  const controller = useReportsPageController();
  return <ReportsView controller={controller} />;
}
