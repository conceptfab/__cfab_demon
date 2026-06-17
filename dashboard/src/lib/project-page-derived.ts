import { manualToSessionRow } from '@/lib/session-utils';
import type {
  ManualSessionWithProject,
  SessionWithApp,
  StackedBarData,
} from '@/lib/db-types';
import type {
  ProjectSessionRow,
  RecentCommentItem,
} from '@/components/project-page/ProjectSessionsList';

export function buildAutoSessionsById(recentSessions: SessionWithApp[]) {
  const byId = new Map<number, SessionWithApp>();
  for (const s of recentSessions) {
    byId.set(s.id, s);
  }
  return byId;
}

export function buildGroupedProjectSessions(
  recentSessions: SessionWithApp[],
  manualSessions: ManualSessionWithProject[],
  manualSessionLabel: string,
) {
  const groups: Record<string, ProjectSessionRow[]> = {};

  recentSessions.forEach((s) => {
    const date = s.start_time.substring(0, 10);
    if (!groups[date]) groups[date] = [];
    groups[date].push({ ...s, isManual: false as const });
  });

  manualSessions.forEach((m) => {
    const date = m.start_time.substring(0, 10);
    if (!groups[date]) groups[date] = [];
    groups[date].push(manualToSessionRow(m, manualSessionLabel));
  });

  return Object.entries(groups)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, sessions]) => ({
      date,
      sessions: sessions.sort((a, b) =>
        b.start_time.localeCompare(a.start_time),
      ),
    }));
}

export function buildRecentProjectComments(
  recentSessions: SessionWithApp[],
  manualSessions: ManualSessionWithProject[],
  manualSessionLabel: string,
): RecentCommentItem[] {
  const automatic = recentSessions.reduce<RecentCommentItem[]>((acc, s) => {
    const text = s.comment?.trim();
    if (text) {
      acc.push({
        key: `auto-${s.id}`,
        start_time: s.start_time,
        duration_seconds: s.duration_seconds,
        comment: text,
        source: s.app_name,
      });
    }
    return acc;
  }, []);

  const manual = manualSessions.reduce<RecentCommentItem[]>((acc, m) => {
    const text = m.title?.trim();
    if (text) {
      acc.push({
        key: `manual-${m.id}`,
        start_time: m.start_time,
        duration_seconds: m.duration_seconds,
        comment: text,
        source: manualSessionLabel,
      });
    }
    return acc;
  }, []);

  return [...automatic, ...manual]
    .sort((a, b) => b.start_time.localeCompare(a.start_time))
    .slice(0, 5);
}

export function buildFilteredProjectTimeline(
  timelineData: StackedBarData[],
  projectName: string | undefined,
  recentSessions: SessionWithApp[],
  manualSessions: ManualSessionWithProject[],
) {
  if (!projectName) return timelineData;

  const commentsByDate = new Map<string, Set<string>>();
  recentSessions.forEach((s) => {
    if (s.comment?.trim()) {
      const date = s.start_time.substring(0, 10);
      if (!commentsByDate.has(date)) commentsByDate.set(date, new Set());
      commentsByDate.get(date)!.add(s.comment.trim());
    }
  });
  manualSessions.forEach((s) => {
    if (s.title?.trim()) {
      const date = s.start_time.substring(0, 10);
      if (!commentsByDate.has(date)) commentsByDate.set(date, new Set());
      commentsByDate.get(date)!.add(s.title.trim());
    }
  });

  const manualByDate = new Set(
    manualSessions.map((ms) => ms.start_time.substring(0, 10)),
  );

  return timelineData.map((row) => {
    const comments = commentsByDate.get(row.date);
    return {
      ...row,
      [projectName]: row[projectName] || 0,
      comments: comments ? Array.from(comments) : undefined,
      has_manual: row.has_manual || manualByDate.has(row.date),
    };
  });
}
