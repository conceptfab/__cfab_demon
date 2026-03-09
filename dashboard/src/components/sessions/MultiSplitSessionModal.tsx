import { useEffect, useMemo, useState } from 'react';
import { BrainCircuit, Scissors, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { formatDuration } from '@/lib/utils';
import type {
  MultiProjectAnalysis,
  ProjectWithStats,
  SessionWithApp,
  SplitPart,
} from '@/lib/db-types';

interface MultiSplitSessionModalProps {
  session: SessionWithApp;
  projects: ProjectWithStats[];
  analysis: MultiProjectAnalysis | null;
  isAnalysisLoading: boolean;
  maxProjects: number;
  onConfirm: (splits: SplitPart[]) => Promise<void>;
  onCancel: () => void;
}

interface EditableSplitPart {
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
    floored[fractional[idx].i] += 1;
    remainder -= 1;
  }

  return floored;
}

function buildInitialParts(
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

export function MultiSplitSessionModal({
  session,
  projects,
  analysis,
  isAnalysisLoading,
  maxProjects,
  onConfirm,
  onCancel,
}: MultiSplitSessionModalProps) {
  const { t } = useTranslation();
  const [parts, setParts] = useState<EditableSplitPart[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setParts(buildInitialParts(analysis, maxProjects));
  }, [analysis, maxProjects, session.id]);

  const activeProjects = useMemo(
    () => projects.filter((p) => !p.excluded_at && !p.frozen_at),
    [projects],
  );

  const projectById = useMemo(() => {
    const map = new Map<number, ProjectWithStats>();
    for (const project of activeProjects) {
      map.set(project.id, project);
    }
    return map;
  }, [activeProjects]);

  const totalPercent = useMemo(
    () => parts.reduce((acc, part) => acc + part.percent, 0),
    [parts],
  );
  const nonZeroParts = useMemo(
    () => parts.filter((part) => part.percent > 0),
    [parts],
  );

  const canSubmit =
    !isSubmitting && nonZeroParts.length >= 2 && totalPercent === 100;

  const handlePercentChange = (index: number, nextPercent: number) => {
    setParts((prev) => {
      const safePercent = clampPercent(nextPercent);
      const nextParts = prev.map((part, i) =>
        i === index ? { ...part, percent: safePercent } : { ...part },
      );

      const newTotal = nextParts.reduce((acc, part) => acc + part.percent, 0);
      if (newTotal === 100) return nextParts;

      const diff = 100 - newTotal;
      const otherIndices = nextParts
        .map((_, i) => i)
        .filter((i) => i !== index);
      if (otherIndices.length === 0) return nextParts;

      let remainingDiff = diff;
      while (remainingDiff !== 0) {
        let changed = false;
        if (remainingDiff > 0) {
          for (const i of otherIndices) {
            if (nextParts[i].percent < 100) {
              nextParts[i].percent += 1;
              remainingDiff -= 1;
              changed = true;
              if (remainingDiff === 0) break;
            }
          }
        } else {
          for (const i of otherIndices) {
            if (nextParts[i].percent > 0) {
              nextParts[i].percent -= 1;
              remainingDiff += 1;
              changed = true;
              if (remainingDiff === 0) break;
            }
          }
        }
        if (!changed) break;
      }
      return nextParts;
    });
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const splits: SplitPart[] = nonZeroParts.map((part) => ({
      project_id: part.project_id,
      ratio: part.percent / 100,
    }));
    const ratioSum = splits.reduce((acc, part) => acc + part.ratio, 0);
    const drift = 1 - ratioSum;
    if (splits.length > 0 && Math.abs(drift) > 0.000_001) {
      splits[splits.length - 1].ratio += drift;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onConfirm(splits);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/65 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-popover p-5 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Scissors className="h-5 w-5 text-amber-400" />
              <h2 className="text-base font-bold">
                {t('sessions.split_multi.title')}
              </h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {session.app_name} · {formatDuration(session.duration_seconds)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {isAnalysisLoading ? (
          <div className="rounded-lg border border-border/30 bg-secondary/20 px-3 py-6 text-center text-sm text-muted-foreground">
            {t('sessions.split_multi.loading')}
          </div>
        ) : !analysis || analysis.candidates.length < 2 ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-4 text-sm text-amber-200">
            {t('sessions.split_multi.no_candidates')}
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-border/30 bg-secondary/10 p-3">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-semibold text-muted-foreground">
                  {t('sessions.split_multi.candidates')}
                </span>
                <span className="text-muted-foreground/70">
                  {t('sessions.split_multi.leader')}:{' '}
                  {analysis.leader_score.toFixed(0)}
                </span>
              </div>
              <div className="space-y-2">
                {analysis.candidates
                  .slice(0, Math.min(5, maxProjects))
                  .map((candidate) => (
                    <div
                      key={candidate.project_id}
                      className="grid grid-cols-[1fr_90px] items-center gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Sparkles className="h-3 w-3 text-sky-400" />
                          <span className="truncate">
                            {candidate.project_name}
                          </span>
                        </div>
                      </div>
                      <span className="text-right font-mono text-muted-foreground/80">
                        {(candidate.ratio_to_leader * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            <div className="space-y-2">
              {parts.map((part, idx) => (
                <div
                  key={`split-part-${idx}`}
                  className="grid grid-cols-[1.3fr_1fr_80px] items-center gap-2 rounded-lg border border-border/30 bg-secondary/5 px-3 py-2"
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <div
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          part.project_id != null
                            ? (projectById.get(part.project_id)?.color ??
                              '#64748b')
                            : '#6b7280',
                      }}
                    />
                    <span className="truncate text-sm font-medium">
                      {part.project_id != null
                        ? (projectById.get(part.project_id)?.name ??
                          t('sessions.split_multi.unknown_project'))
                        : t('sessions.split_multi.unassigned')}
                    </span>
                  </div>

                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={part.percent}
                    onChange={(e) =>
                      handlePercentChange(idx, Number(e.target.value))
                    }
                    className="w-full accent-sky-500"
                  />

                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={part.percent}
                    onChange={(e) =>
                      handlePercentChange(idx, Number(e.target.value))
                    }
                    className="rounded border border-border/40 bg-secondary/30 px-2 py-1 text-right text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer"
                  />

                  <div className="col-span-3 text-[10px] text-muted-foreground/60">
                    {part.from_ai
                      ? t('sessions.split_multi.ai_score', {
                          score: part.ai_score.toFixed(0),
                          ratio: (part.ratio_to_leader * 100).toFixed(0),
                        })
                      : t('sessions.split_multi.custom_part')}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 px-1">
              <span
                className={`text-xs font-mono ${totalPercent === 100 ? 'text-emerald-400' : 'text-amber-400'}`}
              >
                {t('sessions.split_multi.sum')}: {totalPercent}%
              </span>
            </div>

            <div className="overflow-hidden rounded-full border border-border/30 bg-secondary/20">
              <div className="flex h-4 w-full">
                {parts
                  .filter((part) => part.percent > 0)
                  .map((part, idx) => {
                    const projectColor =
                      part.project_id != null
                        ? (projectById.get(part.project_id)?.color ?? '#64748b')
                        : '#6b7280';
                    return (
                      <div
                        key={`preview-${idx}`}
                        style={{
                          width: `${part.percent}%`,
                          backgroundColor: projectColor,
                        }}
                        className="h-full"
                        title={`${part.project_id != null ? (projectById.get(part.project_id)?.name ?? part.project_id) : t('sessions.split_multi.unassigned')} · ${part.percent}%`}
                      />
                    );
                  })}
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-[11px] text-sky-300/80">
              <BrainCircuit className="h-4 w-4 shrink-0 mt-0.5 text-sky-400/60" />
              <div>
                <p className="font-medium">{t('sessions.split_multi.learning_title', 'This split trains AI')}</p>
                <p className="text-sky-300/50 mt-0.5">{t('sessions.split_multi.learning_desc', 'Your decision will improve future automatic project assignments. Split sessions cannot be split again.')}</p>
              </div>
            </div>
          </>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {t('ui.buttons.cancel', 'Anuluj')}
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={
              !canSubmit ||
              isAnalysisLoading ||
              !analysis ||
              analysis.candidates.length < 2
            }
            className="bg-sky-600 hover:bg-sky-700 text-white"
          >
            {isSubmitting
              ? t('sessions.split.splitting', 'Dzielenie...')
              : t('sessions.split.confirm', 'Podziel')}
          </Button>
        </div>
      </div>
    </div>
  );
}
