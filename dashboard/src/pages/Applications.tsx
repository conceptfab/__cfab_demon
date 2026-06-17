import { useApplicationsPageController } from '@/hooks/useApplicationsPageController';
import { ApplicationsView } from '@/pages/applications/ApplicationsView';

export function Applications() {
  const controller = useApplicationsPageController();
  return <ApplicationsView controller={controller} />;
}
