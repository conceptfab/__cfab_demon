import { useMemo, useState } from 'react';
import { Scissors, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { formatDuration } from '@/lib/utils';
import type {
  MultiProjectAnalysis,
  ProjectWithStats,
  SessionWithApp,
  SplitPart,
} from '@/lib/db-types';
import {
  buildInitialParts,
  rebalanceSplitPercents,
} from '@/components/sessions/multi-split-utils';
import { MultiSplitSessionEditor } from '@/components/sessions/MultiSplitSessionEditor';

interface MultiSplitSessionModalProps {
  session: SessionWithApp;
  projects: ProjectWithStats[];
  analysis: MultiProjectAnalysis | null;
  isAnalysisLoading: boolean;
  maxProjects: number;
  onConfirm: (splits: SplitPart[]) => Promise<void>;
  onCancel: () => void;
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
  const derivedInitialParts = useMemo(
    () => buildInitialParts(analysis, maxProjects),
    [analysis, maxProjects],
  );
  const [editableParts, setEditableParts] = useState({
    seed: derivedInitialParts,
    parts: derivedInitialParts,
  });
  if (editableParts.seed !== derivedInitialParts) {
    setEditableParts({ seed: derivedInitialParts, parts: derivedInitialParts });
  }
  const parts = editableParts.parts;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setEditableParts((prev) => ({
      ...prev,
      parts: rebalanceSplitPercents(prev.parts, index, nextPercent),
    }));
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
              <Scissors className="size-5 text-amber-400" />
              <h2 className="text-base font-semibold">
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
            className="size-7 p-0"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            <X className="size-4" />
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
          <MultiSplitSessionEditor
            analysis={analysis}
            parts={parts}
            maxProjects={maxProjects}
            projectById={projectById}
            totalPercent={totalPercent}
            onPercentChange={handlePercentChange}
          />
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
            {t('ui.buttons.cancel')}
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
              ? t('sessions.split.splitting')
              : t('sessions.split.confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}
