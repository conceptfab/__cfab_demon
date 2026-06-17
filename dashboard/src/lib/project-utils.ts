import type { ProjectWithStats } from '@/lib/db-types';

export function compareProjectsByName(
  left: ProjectWithStats,
  right: ProjectWithStats,
): number {
  return left.name.localeCompare(right.name, undefined, {
    sensitivity: 'base',
  });
}

export function isRecentProject(
  project: ProjectWithStats,
  maxAgeMs: number,
  options?: {
    useLastActivity?: boolean;
  },
): boolean {
  const freshnessSource = options?.useLastActivity
    ? project.last_activity ?? project.created_at
    : project.created_at;
  const sourceMs = new Date(freshnessSource).getTime();
  if (!Number.isFinite(sourceMs)) return false;
  const ageMs = Date.now() - sourceMs;
  return ageMs >= 0 && ageMs < maxAgeMs;
}
