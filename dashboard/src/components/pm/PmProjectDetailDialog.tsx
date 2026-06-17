import { useEffect, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useConfirmDialogState } from '@/hooks/useConfirmDialogState';
import { pmApi } from '@/lib/tauri/pm';
import type { PmProject } from '@/lib/pm-types';
import { getErrorMessage, logTauriError } from '@/lib/utils';
import {
  buildPmProjectDetailDialogState,
  pmProjectDetailDialogReducer,
} from '@/components/pm/pm-project-detail-dialog-state';

interface Props {
  open: boolean;
  project: PmProject;
  index: number;
  onClose: () => void;
  onUpdated: () => void;
}

const STATUS_OPTIONS = ['active', 'inactive', 'archived'];

export function PmProjectDetailDialog({ open, project, index, onClose, onUpdated }: Props) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(
    pmProjectDetailDialogReducer,
    project,
    buildPmProjectDetailDialogState,
  );
  const { editing, error, folderSize, form, submitting } = state;
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialogState();

  useEffect(() => {
    dispatch({ type: 'reset_form', project });
  }, [project]);

  useEffect(() => {
    pmApi.getPmFolderSize(project.prj_full_name)
      .then((size) => dispatch({ type: 'set_folder_size', folderSize: size }))
      .catch((e) => {
        logTauriError('pm folder size', e);
        dispatch({ type: 'set_folder_size', folderSize: null });
      });
  }, [project.prj_full_name]);

  const handleSave = async () => {
    dispatch({ type: 'set_error', error: null });
    dispatch({ type: 'set_submitting', submitting: true });
    try {
      await pmApi.updatePmProject(index, form);
      onUpdated();
    } catch (e) {
      dispatch({
        type: 'set_error',
        error: getErrorMessage(e, 'Failed to update project'),
      });
    } finally {
      dispatch({ type: 'set_submitting', submitting: false });
    }
  };

  const handleDelete = async () => {
    const confirmed = await confirm(
      t('pm.detail.delete_confirm', { name: project.prj_full_name }),
    );
    if (!confirmed) return;
    dispatch({ type: 'set_error', error: null });
    dispatch({ type: 'set_submitting', submitting: true });
    try {
      await pmApi.deletePmProject(index);
      onUpdated();
    } catch (e) {
      dispatch({
        type: 'set_error',
        error: getErrorMessage(e, 'Failed to delete project'),
      });
      dispatch({ type: 'set_submitting', submitting: false });
    }
  };

  const sizeText = folderSize === undefined
    ? '...'
    : folderSize === null
      ? t('pm.detail.folder_not_found')
      : `${folderSize.toFixed(2)} GB`;

  const inputClass =
    'w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary';

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('pm.detail.title')}</DialogTitle>
          <DialogDescription className="sr-only">
            {project.prj_full_name}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">{t('pm.columns.number')}:</span>
              <span className="ml-1 font-mono">{project.prj_number}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t('pm.columns.year')}:</span>
              <span className="ml-1 font-mono">{project.prj_year}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Code:</span>
              <span className="ml-1 font-mono">{project.prj_code}</span>
            </div>
          </div>

          <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs">
            <p className="text-muted-foreground mb-0.5">{t('pm.detail.folder_path')}</p>
            <p className="font-mono break-all">{project.prj_folder}/{project.prj_full_name}</p>
            <p className="mt-1 text-muted-foreground">
              {t('pm.detail.folder_size')}: {sizeText}
            </p>
          </div>

          {editing ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="pm-detail-client" className="mb-1 block text-xs text-muted-foreground">{t('pm.create.client')}</label>
                  <input id="pm-detail-client" className={inputClass} value={form.prj_client}
                    onChange={(e) => dispatch({ type: 'patch_form', patch: { prj_client: e.target.value } })} />
                </div>
                <div>
                  <label htmlFor="pm-detail-name" className="mb-1 block text-xs text-muted-foreground">{t('pm.create.name')}</label>
                  <input id="pm-detail-name" className={inputClass} value={form.prj_name}
                    onChange={(e) => dispatch({ type: 'patch_form', patch: { prj_name: e.target.value } })} />
                </div>
              </div>
              <div>
                <label htmlFor="pm-detail-desc" className="mb-1 block text-xs text-muted-foreground">{t('pm.create.desc')}</label>
                <textarea id="pm-detail-desc" className={inputClass} value={form.prj_desc} rows={2}
                  onChange={(e) => dispatch({ type: 'patch_form', patch: { prj_desc: e.target.value } })} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="pm-detail-budget" className="mb-1 block text-xs text-muted-foreground">{t('pm.create.budget')}</label>
                  <input id="pm-detail-budget" className={inputClass} value={form.prj_budget}
                    onChange={(e) => dispatch({ type: 'patch_form', patch: { prj_budget: e.target.value } })} />
                </div>
                <div>
                  <label htmlFor="pm-detail-term" className="mb-1 block text-xs text-muted-foreground">{t('pm.create.term')}</label>
                  <input id="pm-detail-term" type="date" className={inputClass} value={form.prj_term}
                    onChange={(e) => dispatch({ type: 'patch_form', patch: { prj_term: e.target.value } })} />
                </div>
                <div>
                  <label htmlFor="pm-detail-status" className="mb-1 block text-xs text-muted-foreground">{t('pm.columns.status')}</label>
                  <select id="pm-detail-status" className={inputClass} value={form.prj_status}
                    onChange={(e) => dispatch({ type: 'patch_form', patch: { prj_status: e.target.value } })}>
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{t(`pm.status.${s}`, s)}</option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          ) : (
            <div className="grid gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">{project.prj_client}</span>
                <span className="text-muted-foreground">·</span>
                <span>{project.prj_name}</span>
                <StatusBadge status={project.prj_status} className="ml-auto">{t(`pm.status.${project.prj_status}`, project.prj_status)}</StatusBadge>
              </div>
              {project.prj_desc && (
                <p className="text-xs text-muted-foreground">{project.prj_desc}</p>
              )}
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>{t('pm.create.budget')}: {project.prj_budget || '—'}</span>
                <span>{t('pm.create.term')}: {project.prj_term || '—'}</span>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-between pt-1">
            <div>
              {editing && (
                <Button variant="destructive" size="sm" onClick={handleDelete} disabled={submitting}>
                  {t('pm.detail.delete')}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {editing ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => dispatch({ type: 'reset_form', project })}
                  >
                    {t('pm.detail.cancel')}
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={submitting}>
                    {t('pm.detail.save')}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={onClose}>
                    {t('ui.buttons.cancel')}
                  </Button>
                  <Button size="sm" onClick={() => dispatch({ type: 'set_editing', editing: true })}>
                    {t('pm.detail.edit')}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <ConfirmDialog {...confirmDialogProps} />
    </>
  );
}
