import { useDashboardPageController } from '@/hooks/useDashboardPageController';
import { DashboardView } from '@/pages/dashboard/DashboardView';

export function Dashboard() {
  const controller = useDashboardPageController();
  return <DashboardView controller={controller} />;
}
