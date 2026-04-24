import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  buildAssignProjectSections,
  type AssignProjectSection,
} from '@/components/dashboard/project-day-timeline/timeline-calculations';
import type { ProjectWithStats } from '@/lib/db-types';
import type { AssignProjectListMode } from '@/store/ui-store';

interface UseAssignProjectSectionsParams {
  assignProjectListMode: AssignProjectListMode;
  freezeThresholdDays: number;
  projects: ProjectWithStats[];
}

interface UseAssignProjectSectionsResult {
  assignProjectSections: AssignProjectSection[];
  assignProjectsCount: number;
  showAssignSectionHeaders: boolean;
}

export function useAssignProjectSections({
  assignProjectListMode,
  freezeThresholdDays,
  projects,
}: UseAssignProjectSectionsParams): UseAssignProjectSectionsResult {
  const { t } = useTranslation();

  const assignProjectSections = useMemo(() => {
    return buildAssignProjectSections({
      assignProjectListMode,
      projects,
      activeProjectsLabel: t(
        'sessions.menu.active_projects_az',
        'Active projects (A-Z)',
      ),
      newestProjectsLabel: t(
        'sessions.menu.newest_projects_az',
        'Newest projects (A-Z)',
      ),
      topProjectsLabel: t('sessions.menu.top_projects_az', 'Top projects (A-Z)'),
      remainingProjectsLabel: t(
        'sessions.menu.remaining_active_az',
        'Remaining active (A-Z)',
      ),
      newProjectMaxAgeMs: Math.max(1, freezeThresholdDays) * 24 * 60 * 60 * 1000,
    });
  }, [assignProjectListMode, freezeThresholdDays, projects, t]);

  const assignProjectsCount = useMemo(
    () =>
      assignProjectSections.reduce(
        (total, section) => total + section.projects.length,
        0,
      ),
    [assignProjectSections],
  );

  return {
    assignProjectSections,
    assignProjectsCount,
    showAssignSectionHeaders: assignProjectListMode !== 'alpha_active',
  };
}
