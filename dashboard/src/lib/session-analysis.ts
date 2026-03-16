import type { MultiProjectAnalysis, ScoreBreakdown } from '@/lib/db-types';

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

export function isSplittableFromBreakdown(
  breakdown: ScoreBreakdown | null | undefined,
  toleranceThreshold: number,
): boolean {
  if (!breakdown || breakdown.candidates.length < 2) return false;
  const sorted = [...breakdown.candidates].sort(
    (a, b) => b.total_score - a.total_score,
  );
  const leader = sorted[0]?.total_score ?? 0;
  const second = sorted[1]?.total_score ?? 0;
  if (!(leader > 0)) return false;
  return second / leader >= toleranceThreshold;
}

export function buildAnalysisFromBreakdown(
  sessionId: number,
  breakdown: ScoreBreakdown | null | undefined,
  toleranceThreshold: number,
  maxProjects: number,
): MultiProjectAnalysis | null {
  if (!breakdown || breakdown.candidates.length === 0) return null;

  const sorted = [...breakdown.candidates]
    .filter((candidate) => candidate.total_score > 0)
    .sort((a, b) => b.total_score - a.total_score)
    .slice(0, Math.max(2, Math.min(5, maxProjects)));

  if (sorted.length === 0) return null;

  const leader = sorted[0];
  const leaderScore = leader?.total_score ?? 0;
  const secondScore = sorted[1]?.total_score ?? 0;

  return {
    session_id: sessionId,
    candidates: sorted.map((candidate) => ({
      project_id: candidate.project_id,
      project_name: candidate.project_name,
      score: candidate.total_score,
      ratio_to_leader:
        leaderScore > 0 ? candidate.total_score / leaderScore : 0,
    })),
    is_splittable:
      leaderScore > 0 && secondScore / leaderScore >= toleranceThreshold,
    leader_project_id: leader?.project_id ?? null,
    leader_score: leaderScore,
  };
}
