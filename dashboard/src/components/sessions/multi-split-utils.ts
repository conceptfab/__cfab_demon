import type { MultiProjectAnalysis } from '@/lib/db-types';

export interface EditableSplitPart {
  project_id: number | null;
  percent: number;
  ai_score: number;
  ratio_to_leader: number;
  from_ai: boolean;
}

function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function distributePercents(weights: number[]): number[] {
  if (weights.length === 0) return [];

  const safe = weights.map((w) => Math.max(0, w));
  const total = safe.reduce((acc, w) => acc + w, 0);
  const normalized =
    total > 0
      ? safe.map((w) => (w / total) * 100)
      : safe.map(() => 100 / safe.length);

  const floored = normalized.map((v) => Math.floor(v));
  let remainder = 100 - floored.reduce((acc, v) => acc + v, 0);
  const fractional = normalized.map((v, i) => ({
    i,
    frac: v - Math.floor(v),
  }));
  fractional.sort((a, b) => b.frac - a.frac);

  for (let idx = 0; idx < fractional.length && remainder > 0; idx += 1) {
    // safe: loop is within [0, fractional.length); floored has same length as normalized
    floored[fractional[idx]!.i]! += 1;
    remainder -= 1;
  }

  return floored;
}

export function buildInitialParts(
  analysis: MultiProjectAnalysis | null,
  maxProjects: number,
): EditableSplitPart[] {
  if (!analysis || analysis.candidates.length === 0) return [];
  const limited = analysis.candidates.slice(
    0,
    Math.max(2, Math.min(5, maxProjects)),
  );
  const percents = distributePercents(limited.map((c) => c.score));

  return limited.map((candidate, idx) => ({
    project_id: candidate.project_id,
    percent: percents[idx] ?? 0,
    ai_score: candidate.score,
    ratio_to_leader: candidate.ratio_to_leader,
    from_ai: true,
  }));
}

export function rebalanceSplitPercents(
  prev: EditableSplitPart[],
  index: number,
  nextPercent: number,
): EditableSplitPart[] {
  const safePercent = clampPercent(nextPercent);
  const nextParts = prev.map((part, i) =>
    i === index ? { ...part, percent: safePercent } : { ...part },
  );

  const newTotal = nextParts.reduce((acc, part) => acc + part.percent, 0);
  if (newTotal === 100) return nextParts;

  const diff = 100 - newTotal;
  const otherIndices = nextParts.reduce<number[]>((acc, _, i) => {
    if (i !== index) acc.push(i);
    return acc;
  }, []);
  if (otherIndices.length === 0) return nextParts;

  let remainingDiff = diff;
  while (remainingDiff !== 0) {
    let changed = false;
    if (remainingDiff > 0) {
      for (const i of otherIndices) {
        // safe: otherIndices contains valid indices into nextParts (built from prev.reduce)
        if (nextParts[i]!.percent < 100) {
          nextParts[i]!.percent += 1;
          remainingDiff -= 1;
          changed = true;
          if (remainingDiff === 0) break;
        }
      }
    } else {
      for (const i of otherIndices) {
        // safe: otherIndices contains valid indices into nextParts (built from prev.reduce)
        if (nextParts[i]!.percent > 0) {
          nextParts[i]!.percent -= 1;
          remainingDiff += 1;
          changed = true;
          if (remainingDiff === 0) break;
        }
      }
    }
    if (!changed) break;
  }
  return nextParts;
}
