import { useProjectPageController } from '@/hooks/useProjectPageController';
import { ProjectPageView } from '@/pages/ProjectPageView';

export function ProjectPage() {
  const controller = useProjectPageController();
  return <ProjectPageView controller={controller} />;
}
