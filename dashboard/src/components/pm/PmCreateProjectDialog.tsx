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
import { pmApi } from '@/lib/tauri/pm';
import type { PmFolderTemplate } from '@/lib/pm-types';
import { getErrorMessage, logTauriError } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function PmCreateProjectDialog({ open, onClose, onCreated }: Props) {
  const { t } = useTranslation();
  const [client, setClient] = useState('');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [budget, setBudget] = useState('');
  const [term, setTerm] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [templates, setTemplates] = useState<PmFolderTemplate[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pmApi.getPmTemplates().then((tpl) => {
      setTemplates(tpl);
      const def = tpl.find((t) => t.is_default);
      if (def) setTemplateId(def.id);
      else if (tpl.length > 0) setTemplateId(tpl[0].id);
    }).catch((e) => logTauriError('pm load templates', e));
  }, []);

  const year = new Date().getFullYear().toString().slice(-2);
  const previewCode = `XX${year}`;
  const previewName = client && name ? `XX_${year}_${client}_${name}` : '';

  const selectedTemplate = templates.find((t) => t.id === templateId);

  const handleSubmit = async () => {
    setError(null);
    if (!client.trim()) { setError(t('pm.errors.client_required')); return; }
    if (!name.trim()) { setError(t('pm.errors.name_required')); return; }

    setSubmitting(true);
    try {
      await pmApi.createPmProject({
        prj_client: client.trim(),
        prj_name: name.trim(),
        prj_desc: desc.trim(),
        prj_budget: budget.trim(),
        prj_term: term,
        template_id: templateId || 'default',
      });
      onCreated();
    } catch (e) {
      setError(getErrorMessage(e, t('pm.errors.create_failed')));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('pm.create.title')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('pm.create.title')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {/* Client + Name */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                {t('pm.create.client')} *
              </label>
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={client}
                onChange={(e) => setClient(e.target.value)}
                placeholder="ACME"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                {t('pm.create.name')} *
              </label>
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Website"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {t('pm.create.desc')}
            </label>
            <textarea
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={2}
            />
          </div>

          {/* Budget + Term */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                {t('pm.create.budget')}
              </label>
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="5000"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                {t('pm.create.term')}
              </label>
              <input
                type="date"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
            </div>
          </div>

          {/* Template */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {t('pm.create.template')}
            </label>
            <select
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name} ({tpl.folders.length} folders)
                </option>
              ))}
            </select>
          </div>

          {/* Preview */}
          {previewName && (
            <div className="rounded-md border border-border/50 bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground mb-1">{t('pm.create.preview')}</p>
              <p className="text-sm font-mono font-medium">{previewName}</p>
            </div>
          )}

          {/* Folder tree preview */}
          {selectedTemplate && previewName && (
            <div className="rounded-md border border-border/50 bg-muted/30 p-3 max-h-40 overflow-auto">
              <p className="text-xs text-muted-foreground mb-1">{t('pm.create.folder_preview')}</p>
              <div className="text-xs font-mono space-y-0.5">
                {selectedTemplate.folders.map((f, i) => {
                  const resolved = f.replace('{name}', name || 'Project');
                  return (
                    <div key={`folder-${i}-${f}`} className="text-muted-foreground">
                      {String(i).padStart(2, '0')}_{previewCode}{resolved}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onClose}>
              {t('ui.buttons.cancel')}
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={submitting}>
              {t('pm.create.submit')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
