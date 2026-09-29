import type { ProjectWithStats } from '@/lib/db-types';
import type {
  ProjectStatusCounts,
  ProjectStatusFilter,
} from '@/components/projects/projects-list-types';

export const STATUS_FILTER_STORAGE_KEY = 'timeflow_projects_status_filter';

export function loadSavedStatusFilter(): ProjectStatusFilter {
  try {
    const saved = localStorage.getItem(STATUS_FILTER_STORAGE_KEY);
    if (saved === 'active' || saved === 'frozen' || saved === 'all') {
      return saved;
    }
  } catch {
    // localStorage may be unavailable or throw in restricted contexts
  }
  return 'all';
}

export function filterProjectsByStatus(
  projects: ProjectWithStats[],
  filter: ProjectStatusFilter,
): ProjectWithStats[] {
  if (filter === 'active') {
    return projects.filter((p) => !p.frozen_at);
  }
  if (filter === 'frozen') {
    return projects.filter((p) => Boolean(p.frozen_at));
  }
  return projects;
}

export function computeProjectStatusCounts(
  projects: ProjectWithStats[],
): ProjectStatusCounts {
  let active = 0;
  let frozen = 0;
  for (const p of projects) {
    if (p.frozen_at) {
      frozen++;
    } else {
      active++;
    }
  }
  return {
    all: projects.length,
    active,
    frozen,
  };
}
