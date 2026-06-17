import { useMemo } from 'react';
import { BrainCircuit, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { EditableSplitPart } from '@/components/sessions/multi-split-utils';

interface MultiSplitSessionEditorProps {
  analysis: MultiProjectAnalysis;
  parts: EditableSplitPart[];
  maxProjects: number;
  projectById: Map<number, ProjectWithStats>;
  totalPercent: number;
  onPercentChange: (index: number, nextPercent: number) => void;
}

export function MultiSplitSessionEditor({
  analysis,
  parts,
  maxProjects,
  projectById,
  totalPercent,
  onPercentChange,
}: MultiSplitSessionEditorProps) {
  const { t } = useTranslation();

  const previewSegments = useMemo(
    () =>
      parts.flatMap((part, idx) => {
        if (part.percent <= 0) return [];
        const projectColor =
          part.project_id != null
            ? (projectById.get(part.project_id)?.color ?? '#64748b')
            : '#6b7280';
        return [
          {
            key: `preview-${part.project_id ?? `unassigned-${idx}`}`,
            width: part.percent,
            color: projectColor,
            title: `${part.project_id != null ? (projectById.get(part.project_id)?.name ?? part.project_id) : t('sessions.split_multi.unassigned')} · ${part.percent}%`,
          },
        ];
      }),
    [parts, projectById, t],
  );

  return (
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
                    <Sparkles className="size-3 text-sky-400" />
                    <span className="truncate">{candidate.project_name}</span>
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
            key={`split-part-${part.project_id ?? `unassigned-${idx}`}`}
            className="grid grid-cols-[1.3fr_1fr_80px] items-center gap-2 rounded-lg border border-border/30 bg-secondary/5 px-3 py-2"
          >
            <div className="flex items-center gap-2 overflow-hidden">
              <div
                className="size-3 shrink-0 rounded-full"
                style={{
                  backgroundColor:
                    part.project_id != null
                      ? (projectById.get(part.project_id)?.color ?? '#64748b')
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
              aria-label={t('sessions.split_multi.percent_slider', {
                project:
                  part.project_id != null
                    ? (projectById.get(part.project_id)?.name ??
                      t('sessions.split_multi.unknown_project'))
                    : t('sessions.split_multi.unassigned'),
              })}
              onChange={(e) => onPercentChange(idx, Number(e.target.value))}
              className="w-full accent-sky-500"
            />

            <input
              type="number"
              min={0}
              max={100}
              value={part.percent}
              aria-label={t('sessions.split_multi.percent_value', {
                project:
                  part.project_id != null
                    ? (projectById.get(part.project_id)?.name ??
                      t('sessions.split_multi.unknown_project'))
                    : t('sessions.split_multi.unassigned'),
              })}
              onChange={(e) => onPercentChange(idx, Number(e.target.value))}
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
          {previewSegments.map((segment) => (
            <div
              key={segment.key}
              style={{
                width: `${segment.width}%`,
                backgroundColor: segment.color,
              }}
              className="h-full"
              title={segment.title}
            />
          ))}
        </div>
      </div>
      <div className="flex items-start gap-2 rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-[11px] text-sky-300/80">
        <BrainCircuit className="size-4 shrink-0 mt-0.5 text-sky-400/60" />
        <div>
          <p className="font-medium">{t('sessions.split_multi.learning_title')}</p>
          <p className="text-sky-300/50 mt-0.5">
            {t('sessions.split_multi.learning_desc')}
          </p>
        </div>
      </div>
    </>
  );
}
