import { UNASSIGNED_PROJECT_SENTINEL } from '@/lib/project-labels';
import { manualToSessionRow, wallClockSeconds } from '@/lib/session-utils';
import type { SessionWithApp } from '@/lib/db-types';

export interface GroupedProject {
  projectId: number | null;
  projectName: string;
  projectColor: string;
  totalSeconds: number;
  boostedCount: number;
  sessions: SessionWithApp[];
}

export function isTrackedSession(
  session: SessionWithApp | ReturnType<typeof manualToSessionRow>,
): session is SessionWithApp {
  return !('isManual' in session && session.isManual);
}

export function groupSessionsByProject(
  mergedSessions: Array<
    SessionWithApp | ReturnType<typeof manualToSessionRow>
  >,
  unassignedLabel: string,
  projectIdByName: Map<string, number>,
): GroupedProject[] {
  const groups = new Map<string, GroupedProject>();
  for (const session of mergedSessions) {
    const projectName = session.project_name ?? unassignedLabel;
    const normalizedProjectName = projectName.trim().toLowerCase();
    const isUnassigned = session.project_id == null;
    const inferredProjectId = isUnassigned
      ? null
      : (session.project_id ??
        (normalizedProjectName
          ? (projectIdByName.get(normalizedProjectName) ?? null)
          : null));
    const projectId = inferredProjectId;
    const projectColor = session.project_color ?? '#64748b';
    const key = isUnassigned
      ? UNASSIGNED_PROJECT_SENTINEL
      : typeof projectId === 'number' && projectId > 0
        ? `id:${projectId}`
        : `name:${projectName.trim().toLowerCase()}`;
    if (!groups.has(key)) {
      groups.set(key, {
        projectId,
        projectName: isUnassigned ? unassignedLabel : projectName,
        projectColor,
        totalSeconds: 0,
        boostedCount: 0,
        sessions: [],
      });
    }
    const group = groups.get(key)!;
    if (
      group.projectId == null &&
      typeof projectId === 'number' &&
      projectId > 0
    ) {
      group.projectId = projectId;
    }
    if (isTrackedSession(session) && (session.rate_multiplier ?? 1) > 1.000_001) {
      group.boostedCount++;
    }
    group.sessions.push(session);
  }
  for (const group of groups.values()) {
    group.totalSeconds = wallClockSeconds(group.sessions);
  }
  return Array.from(groups.values()).sort((a, b) => {
    const aUnassigned = a.projectId == null;
    const bUnassigned = b.projectId == null;
    if (aUnassigned !== bUnassigned) return aUnassigned ? -1 : 1;
    return b.totalSeconds - a.totalSeconds;
  });
}
