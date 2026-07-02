import { format, parseISO } from 'date-fns';

import type { ManualSessionWithProject, SessionWithApp } from '@/lib/db-types';

export interface TimelineEntry {
  key: string;
  kind: 'auto' | 'manual';
  startTime: string;
  label: string;
  durationSeconds: number;
  /** Komentarz sesji automatycznej (trimmed) — null gdy brak. Sesje manualne nie mają komentarzy. */
  comment: string | null;
  /** Typ sesji manualnej (np. 'meeting') — null dla sesji automatycznych. */
  sessionType: string | null;
}

export interface TimelineDay {
  /** 'yyyy-MM-dd' */
  date: string;
  totalSeconds: number;
  entries: TimelineEntry[];
}

export function buildTimelineDays(
  sessions: SessionWithApp[],
  manualSessions: ManualSessionWithProject[],
): TimelineDay[] {
  const entries: TimelineEntry[] = [
    ...sessions.map((s) => ({
      key: `auto-${s.id}`,
      kind: 'auto' as const,
      startTime: s.start_time,
      label: s.app_name,
      durationSeconds: s.duration_seconds,
      comment: s.comment?.trim() ? s.comment.trim() : null,
      sessionType: null,
    })),
    ...manualSessions.map((s) => ({
      key: `manual-${s.id}`,
      kind: 'manual' as const,
      startTime: s.start_time,
      label: s.title,
      durationSeconds: s.duration_seconds,
      comment: null,
      sessionType: s.session_type,
    })),
  ].sort(
    (a, b) => parseISO(a.startTime).getTime() - parseISO(b.startTime).getTime(),
  );

  const days: TimelineDay[] = [];
  for (const entry of entries) {
    const date = format(parseISO(entry.startTime), 'yyyy-MM-dd');
    const last = days[days.length - 1];
    if (last && last.date === date) {
      last.entries.push(entry);
      last.totalSeconds += entry.durationSeconds;
    } else {
      days.push({
        date,
        totalSeconds: entry.durationSeconds,
        entries: [entry],
      });
    }
  }
  return days;
}
