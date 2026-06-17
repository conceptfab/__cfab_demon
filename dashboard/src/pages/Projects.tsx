import { useProjectsPageController } from '@/hooks/useProjectsPageController';
import { ProjectsView } from '@/pages/projects/ProjectsView';

export function Projects() {
  const controller = useProjectsPageController();
  return <ProjectsView controller={controller} />;
}
