import { useEffect, useReducer, useRef } from 'react';
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
import { getErrorMessage, logTauriError } from '@/lib/utils';
import {
  initialPmCreateProjectFormState,
  pmCreateProjectFormReducer,
} from '@/components/pm/pm-create-project-dialog-state';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  /** Istniejący klienci PM — podpowiadani w polu Client name (można też wpisać nowego). */
  clients?: string[];
}

function isValidProjectNumber(value: string): boolean {
  const trimmed = value.trim();
  return /^\d{1,3}$/.test(trimmed) && Number(trimmed) > 0;
}

const EMPTY_CLIENTS: string[] = [];

function PmCreateProjectForm({
  onClose,
  onCreated,
  clients = EMPTY_CLIENTS,
}: Omit<Props, 'open'>) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(
    pmCreateProjectFormReducer,
    initialPmCreateProjectFormState,
  );
  const {
    budget,
    client,
    desc,
    error,
    name,
    numberError,
    numberLoading,
    projectNumber,
    submitting,
    templateId,
    templates,
    term,
  } = state;

  useEffect(() => {
    pmApi.getPmTemplates().then((tpl) => {
      dispatch({ type: 'set_templates', templates: tpl });
      const def = tpl.find((item) => item.is_default);
      if (def) dispatch({ type: 'set_template_id', templateId: def.id });
      else if (tpl.length > 0) dispatch({ type: 'set_template_id', templateId: tpl[0].id });
    }).catch((e) => logTauriError('pm load templates', e));
  }, []);

  useEffect(() => {
    let cancelled = false;
    pmApi.suggestProjectNumber()
      .then((n) => {
        if (!cancelled) dispatch({ type: 'set_project_number', projectNumber: n });
      })
      .catch((e) => {
        if (cancelled) return;
        logTauriError('pm suggest project number', e);
        dispatch({ type: 'set_number_error', numberError: true });
        dispatch({ type: 'set_project_number', projectNumber: '' });
      })
      .finally(() => {
        if (!cancelled) dispatch({ type: 'set_number_loading', numberLoading: false });
      });
    return () => { cancelled = true; };
  }, []);

  const year = new Date().getFullYear().toString().slice(-2);
  const numberIsValid = isValidProjectNumber(projectNumber);
  const displayNumber = numberIsValid ? projectNumber.trim().padStart(2, '0') : 'XX';
  const previewCode = `${displayNumber}${year}`;
  const previewName = client && name ? `${displayNumber}_${year}_${client}_${name}` : '';

  const selectedTemplate = templates.find((t) => t.id === templateId);

  const handleSubmit = async () => {
    dispatch({ type: 'set_error', error: null });
    if (!client.trim()) {
      dispatch({ type: 'set_error', error: t('pm.errors.client_required') });
      return;
    }
    if (!name.trim()) {
      dispatch({ type: 'set_error', error: t('pm.errors.name_required') });
      return;
    }

    const trimmedNumber = projectNumber.trim();
    if (!isValidProjectNumber(trimmedNumber)) {
      dispatch({ type: 'set_error', error: t('pm.errors.number_invalid') });
      return;
    }

    dispatch({ type: 'set_submitting', submitting: true });
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
        dispatch({
          type: 'set_error',
          error: t('pm.errors.number_taken', { number: trimmedNumber }),
        });
      } else {
        dispatch({ type: 'set_error', error: msg });
      }
    } finally {
      dispatch({ type: 'set_submitting', submitting: false });
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('pm.create.title')}</DialogTitle>
        <DialogDescription className="sr-only">
          {t('pm.create.title')}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3">
          {/* Project number */}
          <div>
            <label htmlFor="pm-create-number" className="mb-1 block text-xs text-muted-foreground">
              {t('pm.create.number')} *
            </label>
            <input
              id="pm-create-number"
              className="w-32 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              value={projectNumber}
              onChange={(e) => {
                dispatch({ type: 'set_number_error', numberError: false });
                dispatch({
                  type: 'set_project_number',
                  projectNumber: e.target.value.replace(/\D/g, '').slice(0, 3),
                });
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
              <label htmlFor="pm-create-client" className="mb-1 block text-xs text-muted-foreground">
                {t('pm.create.client')} *
              </label>
              <input
                id="pm-create-client"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={client}
                onChange={(e) => dispatch({ type: 'set_client', client: e.target.value })}
                placeholder="ACME"
                list="pm-create-client-list"
                autoComplete="off"
              />
              {clients.length > 0 && (
                <datalist id="pm-create-client-list">
                  {clients.map((c) => (
                    <option key={c} value={c} aria-label={c} />
                  ))}
                </datalist>
              )}
            </div>
            <div>
              <label htmlFor="pm-create-name" className="mb-1 block text-xs text-muted-foreground">
                {t('pm.create.name')} *
              </label>
              <input
                id="pm-create-name"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={name}
                onChange={(e) => dispatch({ type: 'set_name', name: e.target.value })}
                placeholder="Website"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="pm-create-desc" className="mb-1 block text-xs text-muted-foreground">
              {t('pm.create.desc')}
            </label>
            <textarea
              id="pm-create-desc"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              value={desc}
              onChange={(e) => dispatch({ type: 'set_desc', desc: e.target.value })}
              rows={2}
            />
          </div>

          {/* Budget + Term */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pm-create-budget" className="mb-1 block text-xs text-muted-foreground">
                {t('pm.create.budget')}
              </label>
              <input
                id="pm-create-budget"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={budget}
                onChange={(e) => dispatch({ type: 'set_budget', budget: e.target.value })}
                placeholder="5000"
              />
            </div>
            <div>
              <label htmlFor="pm-create-term" className="mb-1 block text-xs text-muted-foreground">
                {t('pm.create.term')}
              </label>
              <input
                id="pm-create-term"
                type="date"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                value={term}
                onChange={(e) => dispatch({ type: 'set_term', term: e.target.value })}
              />
            </div>
          </div>

          {/* Template */}
          <div>
            <label htmlFor="pm-create-template" className="mb-1 block text-xs text-muted-foreground">
              {t('pm.create.template')}
            </label>
            <select
              id="pm-create-template"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              value={templateId}
              onChange={(e) => dispatch({ type: 'set_template_id', templateId: e.target.value })}
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
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {t('ui.buttons.cancel')}
            </Button>
            <Button type="button" size="sm" onClick={handleSubmit} disabled={submitting || numberLoading || numberError}>
              {t('pm.create.submit')}
            </Button>
          </div>
        </div>
    </>
  );
}

export function PmCreateProjectDialog({ open, onClose, onCreated, clients = EMPTY_CLIENTS }: Props) {
  const prevOpenRef = useRef(false);
  const openCountRef = useRef(0);
  if (open && !prevOpenRef.current) {
    openCountRef.current += 1;
  }
  prevOpenRef.current = open;
  const formKey = open ? `open-${openCountRef.current}` : 'closed';

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl">
        {open && (
          <PmCreateProjectForm
            key={formKey}
            onClose={onClose}
            onCreated={onCreated}
            clients={clients}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
