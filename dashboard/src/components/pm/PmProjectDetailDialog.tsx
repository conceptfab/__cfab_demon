import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { pmApi } from '@/lib/tauri/pm';
import type { PmProject } from '@/lib/pm-types';
import { getErrorMessage, logTauriError } from '@/lib/utils';

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
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ ...project });
  const [folderSize, setFolderSize] = useState<number | null | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pmApi.getPmFolderSize(project.prj_full_name)
      .then(setFolderSize)
      .catch((e) => { logTauriError('pm folder size', e); setFolderSize(null); });
  }, [project.prj_full_name]);

  const handleSave = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await pmApi.updatePmProject(index, form);
      onUpdated();
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to update project'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    setSubmitting(true);
    try {
      await pmApi.deletePmProject(index);
      onUpdated();
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to delete project'));
      setSubmitting(false);
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
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('pm.detail.title')}</DialogTitle>
          <DialogDescription className="sr-only">
            {project.prj_full_name}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {/* Read-only info */}
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

          {/* Editable fields */}
          {editing ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">{t('pm.create.client')}</label>
                  <input className={inputClass} value={form.prj_client}
                    onChange={(e) => setForm({ ...form, prj_client: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">{t('pm.create.name')}</label>
                  <input className={inputClass} value={form.prj_name}
                    onChange={(e) => setForm({ ...form, prj_name: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{t('pm.create.desc')}</label>
                <textarea className={inputClass} value={form.prj_desc} rows={2}
                  onChange={(e) => setForm({ ...form, prj_desc: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">{t('pm.create.budget')}</label>
                  <input className={inputClass} value={form.prj_budget}
                    onChange={(e) => setForm({ ...form, prj_budget: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">{t('pm.create.term')}</label>
                  <input type="date" className={inputClass} value={form.prj_term}
                    onChange={(e) => setForm({ ...form, prj_term: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">{t('pm.columns.status')}</label>
                  <select className={inputClass} value={form.prj_status}
                    onChange={(e) => setForm({ ...form, prj_status: e.target.value })}>
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
                <span className="text-muted-foreground">—</span>
                <span>{project.prj_name}</span>
                <Badge variant="outline" className="ml-auto text-[10px]">{t(`pm.status.${project.prj_status}`, project.prj_status)}</Badge>
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
                  {t('ui.buttons.confirm')}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {editing ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => { setEditing(false); setForm({ ...project }); }}>
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
                  <Button size="sm" onClick={() => setEditing(true)}>
                    {t('pm.detail.edit')}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
