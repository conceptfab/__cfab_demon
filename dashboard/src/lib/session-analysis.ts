import type { ScoreBreakdown } from '@/lib/db-types';

export const EMPTY_SCORE_BREAKDOWN: ScoreBreakdown = {
  candidates: [],
  has_manual_override: false,
  manual_override_project_id: null,
  final_suggestion: null,
};

export function isAlreadySplitSession(session: {
  split_source_session_id?: number | null;
}): boolean {
  return typeof session.split_source_session_id === 'number';
}
