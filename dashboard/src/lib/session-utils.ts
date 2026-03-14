import type { SessionWithApp } from '@/lib/db-types';

export const SESSION_PAGE_SIZE = 100;

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

export function areFileActivitiesEqual(
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
    (left.project_color ?? null) === (right.project_color ?? null)
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
    if (!areFileActivitiesEqual(left.files[index], right.files[index])) {
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
    if (!areSessionsEqual(left[index], right[index])) {
      return false;
    }
  }

  return true;
}
