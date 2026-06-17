import type { ReactNode } from 'react';

import { ProjectList } from '@/components/projects/ProjectList';
import type { ProjectListSlotProps } from '@/components/projects/projects-list-types';
import type { ProjectWithStats } from '@/lib/db-types';
import type { DuplicateInfo } from '@/components/project/DuplicateMarkerBadge';

export type ProjectsListSlotDeps = {
  hotProjectIds: Set<number>;
  newProjectMaxAgeMs: number;
  duplicateByProjectId: Map<number, DuplicateInfo>;
  viewMode: 'detailed' | 'compact';
  getVisibleProjects: (
    projectList: ProjectWithStats[],
    listKey: string,
  ) => { visible: ProjectWithStats[]; hiddenCount: number };
  loadMoreProjects: (listKey: string, totalCount: number) => void;
  renderProjectCard: (project: ProjectWithStats) => ReactNode;
  openEdit: (project: ProjectWithStats) => void;
  handleUnfreeze: (projectId: number) => void | Promise<void>;
};

export function ProjectsListSlot({
  projectList,
  listKey,
  deps,
}: ProjectListSlotProps & { deps: ProjectsListSlotDeps }) {
  if (projectList.length === 0) return null;
  const { visible, hiddenCount } = deps.getVisibleProjects(projectList, listKey);

  return (
    <ProjectList
      hiddenCount={hiddenCount}
      hotProjectIds={deps.hotProjectIds}
      listKey={listKey}
      newProjectMaxAgeMs={deps.newProjectMaxAgeMs}
      projects={visible}
      duplicateByProjectId={deps.duplicateByProjectId}
      renderProjectCard={deps.renderProjectCard}
      viewMode={deps.viewMode}
      onLoadMore={() => deps.loadMoreProjects(listKey, projectList.length)}
      onOpenProject={deps.openEdit}
      onUnfreeze={(projectId) => {
        void deps.handleUnfreeze(projectId);
      }}
    />
  );
}
