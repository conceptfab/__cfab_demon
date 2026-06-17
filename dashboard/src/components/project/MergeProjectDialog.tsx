import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { ProjectWithStats } from '@/lib/db-types';
import { cn, getErrorMessage } from '@/lib/utils';

interface MergeProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectWithStats | null;
  /** Active projects offered as merge targets (source project is filtered out). */
  projects: ProjectWithStats[];
  onMerge: (sourceId: number, targetId: number) => Promise<void>;
}

export function MergeProjectDialog({
  open: isOpen,
  onOpenChange,
  project,
  projects,
  onMerge,
}: MergeProjectDialogProps) {
  const { t } = useTranslation();
  const [targetId, setTargetId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setTargetId(null);
      setError(null);
    }
    onOpenChange(next);
  };

  const candidates = project
    ? projects.filter((p) => p.id !== project.id && !p.frozen_at)
    : [];
  const target = candidates.find((p) => p.id === targetId) ?? null;

  const handleConfirm = async () => {
    if (!project || !target) return;
    setError(null);
    setBusy(true);
    try {
      await onMerge(project.id, target.id);
      onOpenChange(false);
    } catch (e) {
      setError(getErrorMessage(e, t('ui.common.unknown_error')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('projects.labels.merge_project')} {project?.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('projects_page.no_data')}
            </p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {candidates.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 rounded border px-3 py-2 text-left text-sm transition-colors hover:bg-accent',
                    targetId === p.id
                      ? 'border-primary bg-accent'
                      : 'border-transparent',
                  )}
                  onClick={() => {
                    setTargetId(p.id);
                    setError(null);
                  }}
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                  <span className="min-w-0 truncate">{p.name}</span>
                </button>
              ))}
            </div>
          )}
          {target && (
            <p className="text-xs text-muted-foreground">
              {t('projects.confirm.merge_project', { target: target.name })}
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            onClick={() => {
              void handleConfirm();
            }}
            className="mt-2 w-full"
            disabled={!target || busy}
          >
            {t('ui.buttons.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
