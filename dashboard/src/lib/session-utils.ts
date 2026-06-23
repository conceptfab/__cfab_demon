import type { ManualSessionWithProject, SessionWithApp } from '@/lib/db-types';

/**
 * Convert a ManualSessionWithProject into a shape compatible with SessionWithApp.
 * Used by Sessions and ProjectPage to merge manual sessions into session lists.
 */
export function manualToSessionRow(
  session: ManualSessionWithProject,
  label: string,
) {
  return {
    ...session,
    app_id: session.app_id ?? 0,
    app_name: label,
    executable_name: 'manual',
    comment: session.title,
    files: [] as SessionWithApp['files'],
    isManual: true as const,
  };
}

export const SESSION_PAGE_SIZE = 100;

/**
 * Wall-clock seconds for a set of sessions: the union of their
 * [start_time, end_time] intervals, so overlapping ranges (e.g. two apps
 * active at once on the same project) are counted only once.
 *
 * This mirrors the backend's unique-time computation
 * (compute_project_activity_unique) so per-project/group totals stay
 * consistent with the Dashboard and Earnings. It deliberately uses
 * end - start (clock time) instead of duration_seconds, which can carry
 * boost inflation, and skips unparseable or zero/negative intervals.
 */
export function wallClockSeconds(
  sessions: readonly { start_time: string; end_time: string }[],
): number {
  const intervals: Array<[number, number]> = [];
  for (const s of sessions) {
    const start = Date.parse(s.start_time);
    const end = Date.parse(s.end_time);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    intervals.push([start, end]);
  }
  if (intervals.length === 0) return 0;
  intervals.sort((a, b) => a[0] - b[0]);

  let totalMs = 0;
  // safe: length === 0 already returned above
  let [curStart, curEnd] = intervals[0]!;
  for (let i = 1; i < intervals.length; i++) {
    // safe: loop bounds are [1, intervals.length)
    const [start, end] = intervals[i]!;
    if (start <= curEnd) {
      if (end > curEnd) curEnd = end;
    } else {
      totalMs += curEnd - curStart;
      curStart = start;
      curEnd = end;
    }
  }
  totalMs += curEnd - curStart;
  return Math.round(totalMs / 1000);
}

export function normalizeSessionIds(input: number | number[]): number[] {
  if (Array.isArray(input)) {
    return Array.from(
      new Set(input.filter((id) => Number.isFinite(id) && id > 0)),
    );
  }
  return Number.isFinite(input) && input > 0 ? [input] : [];
}

export function requiresCommentForMultiplierBoost(
  multiplier: number | null | undefined,
): boolean {
  return multiplier != null && multiplier > 1.000_001;
}

export function findSessionIdsMissingComment(
  sessionIdsInput: number | number[],
  getCommentById: (sessionId: number) => string | null | undefined,
): number[] {
  return normalizeSessionIds(sessionIdsInput).filter((sessionId) => {
    const comment = getCommentById(sessionId);
    return !comment || !comment.trim();
  });
}

function areFileActivitiesEqual(
  left: SessionWithApp['files'][number],
  right: SessionWithApp['files'][number],
): boolean {
  return (
    left.id === right.id &&
    left.app_id === right.app_id &&
    left.file_name === right.file_name &&
    (left.file_path ?? null) === (right.file_path ?? null) &&
    left.total_seconds === right.total_seconds &&
    left.first_seen === right.first_seen &&
    left.last_seen === right.last_seen &&
    (left.project_id ?? null) === (right.project_id ?? null) &&
    (left.project_name ?? null) === (right.project_name ?? null) &&
    (left.project_color ?? null) === (right.project_color ?? null) &&
    JSON.stringify(left.activity_spans ?? []) === JSON.stringify(right.activity_spans ?? [])
  );
}

export function areSessionsEqual(
  left: SessionWithApp,
  right: SessionWithApp,
): boolean {
  if (
    left.id !== right.id ||
    left.app_id !== right.app_id ||
    left.app_name !== right.app_name ||
    left.executable_name !== right.executable_name ||
    (left.project_id ?? null) !== (right.project_id ?? null) ||
    left.start_time !== right.start_time ||
    left.end_time !== right.end_time ||
    left.duration_seconds !== right.duration_seconds ||
    (left.rate_multiplier ?? null) !== (right.rate_multiplier ?? null) ||
    (left.comment ?? null) !== (right.comment ?? null) ||
    (left.is_hidden ?? null) !== (right.is_hidden ?? null) ||
    (left.split_source_session_id ?? null) !==
      (right.split_source_session_id ?? null) ||
    (left.project_name ?? null) !== (right.project_name ?? null) ||
    (left.project_color ?? null) !== (right.project_color ?? null) ||
    (left.suggested_project_id ?? null) !==
      (right.suggested_project_id ?? null) ||
    (left.suggested_project_name ?? null) !==
      (right.suggested_project_name ?? null) ||
    (left.suggested_confidence ?? null) !==
      (right.suggested_confidence ?? null) ||
    (left.ai_assigned ?? null) !== (right.ai_assigned ?? null) ||
    left.files.length !== right.files.length
  ) {
    return false;
  }

  for (let index = 0; index < left.files.length; index += 1) {
    // safe: both arrays have the same length (checked above), loop is within bounds
    if (!areFileActivitiesEqual(left.files[index]!, right.files[index]!)) {
      return false;
    }
  }

  return true;
}

export function areSessionListsEqual(
  left: SessionWithApp[],
  right: SessionWithApp[],
): boolean {
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    // safe: both arrays have the same length (checked above), loop is within bounds
    if (!areSessionsEqual(left[index]!, right[index]!)) {
      return false;
    }
  }

  return true;
}
