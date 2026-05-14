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

function isValidProjectNumber(value: string): boolean {
  const trimmed = value.trim();
  return /^\d{1,3}$/.test(trimmed) && Number(trimmed) > 0;
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
  const [projectNumber, setProjectNumber] = useState('');
  const [numberLoading, setNumberLoading] = useState(false);
  const [numberError, setNumberError] = useState(false);

  useEffect(() => {
    pmApi.getPmTemplates().then((tpl) => {
      setTemplates(tpl);
      const def = tpl.find((t) => t.is_default);
      if (def) setTemplateId(def.id);
      else if (tpl.length > 0) setTemplateId(tpl[0].id);
    }).catch((e) => logTauriError('pm load templates', e));
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setNumberLoading(true);
    setNumberError(false);
    pmApi.suggestProjectNumber()
      .then((n) => { if (!cancelled) setProjectNumber(n); })
      .catch((e) => {
        if (cancelled) return;
        logTauriError('pm suggest project number', e);
        setNumberError(true);
        setProjectNumber('');
      })
      .finally(() => { if (!cancelled) setNumberLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  const year = new Date().getFullYear().toString().slice(-2);
  const numberIsValid = isValidProjectNumber(projectNumber);
  const displayNumber = numberIsValid ? projectNumber.trim().padStart(2, '0') : 'XX';
  const previewCode = `${displayNumber}${year}`;
  const previewName = client && name ? `${displayNumber}_${year}_${client}_${name}` : '';

  const selectedTemplate = templates.find((t) => t.id === templateId);

  const handleSubmit = async () => {
    setError(null);
    if (!client.trim()) { setError(t('pm.errors.client_required')); return; }
    if (!name.trim()) { setError(t('pm.errors.name_required')); return; }

    const trimmedNumber = projectNumber.trim();
    if (!isValidProjectNumber(trimmedNumber)) {
      setError(t('pm.errors.number_invalid'));
      return;
    }

    setSubmitting(true);
    try {
      await pmApi.createPmProject({
        prj_client: client.trim(),
        prj_name: name.trim(),
        prj_desc: desc.trim(),
        prj_budget: budget.trim(),
        prj_term: term,
        template_id: templateId || 'default',
        prj_number: trimmedNumber,
      });
      onCreated();
    } catch (e) {
      const msg = getErrorMessage(e, t('pm.errors.create_failed'));
      if (msg.includes('PM_NUMBER_TAKEN')) {
        setError(t('pm.errors.number_taken', { number: trimmedNumber }));
      } else {
        setError(msg);
      }
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
          {/* Project number */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {t('pm.create.number')} *
            </label>
            <input
              className="w-32 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              value={projectNumber}
              onChange={(e) => {
                setNumberError(false);
                setProjectNumber(e.target.value.replace(/\D/g, '').slice(0, 3));
              }}
              inputMode="numeric"
              placeholder={numberLoading ? '…' : '01'}
              disabled={numberLoading}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {numberError ? t('pm.errors.number_load_failed') : t('pm.create.number_hint')}
            </p>
          </div>
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
                  const prefix = String(i).padStart(2, '0');
                  return (
                    <div key={`${prefix}-${f}`} className="text-muted-foreground">
                      {prefix}_{previewCode}{resolved}
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
            <Button size="sm" onClick={handleSubmit} disabled={submitting || numberLoading || numberError}>
              {t('pm.create.submit')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
