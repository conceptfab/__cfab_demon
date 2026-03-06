import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Scissors, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDuration } from '@/lib/utils';
import { suggestSessionSplit } from '@/lib/tauri';
import type { SessionWithApp, ProjectWithStats } from '@/lib/db-types';

interface SplitSessionModalProps {
  session: SessionWithApp;
  projects: ProjectWithStats[];
  onConfirm: (
    ratio: number,
    projectAId: number | null,
    projectBId: number | null,
  ) => Promise<void>;
  onCancel: () => void;
}

export function SplitSessionModal({
  session,
  projects,
  onConfirm,
  onCancel,
}: SplitSessionModalProps) {
  const { t } = useTranslation();
  const [ratio, setRatio] = useState(0.5);
  const [projectAId, setProjectAId] = useState<number | null>(
    session.project_id ?? null,
  );
  const [projectBId, setProjectBId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aiConfidence, setAiConfidence] = useState(0);

  // Auto-fetch AI suggestion on mount
  useEffect(() => {
    suggestSessionSplit(session.id)
      .then((s) => {
        if (s.confidence > 0) {
          setRatio(s.suggested_ratio);
          if (s.project_a_id) setProjectAId(s.project_a_id);
          if (s.project_b_id) setProjectBId(s.project_b_id);
          setAiConfidence(s.confidence);
        }
      })
      .catch(() => {});
  }, [session.id]);

  const durationA = useMemo(
    () => Math.round(session.duration_seconds * ratio),
    [session.duration_seconds, ratio],
  );
  const durationB = useMemo(
    () => session.duration_seconds - durationA,
    [session.duration_seconds, durationA],
  );
  const pctA = Math.round(ratio * 100);
  const pctB = 100 - pctA;

  const activeProjects = useMemo(
    () => projects.filter((p) => !p.excluded_at && !p.frozen_at),
    [projects],
  );

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await onConfirm(ratio, projectAId, projectBId);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in-0">
      <div className="w-full max-w-md rounded-xl border border-border bg-popover p-6 shadow-2xl space-y-5 animate-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Scissors className="h-5 w-5 text-sky-400" />
          <h2 className="text-base font-bold text-foreground">
            {t('sessions.split.title', 'Podziel sesję')}
          </h2>
        </div>

        <p className="text-xs text-muted-foreground">
          {t(
            'sessions.split.description',
            'Przesuń suwak, aby podzielić sesję na dwie części i przypisać je do różnych projektów.',
          )}
        </p>

        {aiConfidence > 0 && (
          <div className="flex items-center gap-1.5 text-[10px] text-amber-400 bg-amber-500/10 rounded-md px-2 py-1 border border-amber-500/20">
            <Sparkles className="h-3 w-3" />
            {t(
              'sessions.split.ai_suggestion',
              'AI zasugerował podział na bazie aktywności na plikach',
            )}
            <span className="ml-auto font-mono text-amber-300">
              {Math.round(aiConfidence * 100)}%
            </span>
          </div>
        )}

        {/* Slider + durations */}
        <div className="space-y-2">
          <input
            type="range"
            min={5}
            max={95}
            value={pctA}
            onChange={(e) => setRatio(Number(e.target.value) / 100)}
            className="w-full accent-sky-500 cursor-pointer"
          />
          <div className="flex justify-between text-[11px] font-mono font-bold">
            <span className="text-sky-400">
              {pctA}% · {formatDuration(durationA)}
            </span>
            <span className="text-violet-400">
              {pctB}% · {formatDuration(durationB)}
            </span>
          </div>
        </div>

        {/* Project selectors */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-sky-400 mb-1 uppercase tracking-wide">
              {t('sessions.split.part_a', 'Część A')}
            </label>
            <select
              className="w-full rounded-md border border-border bg-secondary/30 px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500"
              value={projectAId ?? ''}
              onChange={(e) =>
                setProjectAId(e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">
                {t('sessions.split.unassigned', '— Nieprzypisany —')}
              </option>
              {activeProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-violet-400 mb-1 uppercase tracking-wide">
              {t('sessions.split.part_b', 'Część B')}
            </label>
            <select
              className="w-full rounded-md border border-border bg-secondary/30 px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-violet-500"
              value={projectBId ?? ''}
              onChange={(e) =>
                setProjectBId(e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">
                {t('sessions.split.unassigned', '— Nieprzypisany —')}
              </option>
              {activeProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Visual bar */}
        <div className="flex h-3 rounded-full overflow-hidden border border-border/30">
          <div
            className="bg-sky-500/60 transition-all"
            style={{ width: `${pctA}%` }}
          />
          <div
            className="bg-violet-500/60 transition-all"
            style={{ width: `${pctB}%` }}
          />
        </div>

        {/* Actions */}
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
            disabled={isSubmitting}
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
