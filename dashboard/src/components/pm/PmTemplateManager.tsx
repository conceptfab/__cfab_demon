import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Star, Pencil } from 'lucide-react';
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
import type { PmFolderTemplate } from '@/lib/pm-types';
import { getErrorMessage, logTauriError, cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface EditState {
  id: string;
  name: string;
  foldersText: string;
  isNew: boolean;
}

export function PmTemplateManager({ open, onClose }: Props) {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<PmFolderTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const tpl = await pmApi.getPmTemplates();
      setTemplates(tpl);
    } catch (e) {
      logTauriError('pm load templates', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSetDefault = async (id: string) => {
    try {
      await pmApi.setDefaultPmTemplate(id);
      await load();
    } catch (e) {
      logTauriError('pm set default template', e);
    }
  };

  const handleDelete = async (id: string) => {
    if (id === 'default') return;
    try {
      await pmApi.deletePmTemplate(id);
      await load();
    } catch (e) {
      logTauriError('pm delete template', e);
    }
  };

  const handleSave = async () => {
    if (!edit) return;
    setError(null);
    if (!edit.name.trim()) { setError('Name required'); return; }

    const folders = edit.foldersText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (folders.length === 0) { setError('At least one folder required'); return; }

    try {
      await pmApi.savePmTemplate({
        id: edit.id,
        name: edit.name.trim(),
        is_default: false,
        folders,
      });
      setEdit(null);
      await load();
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to save template'));
    }
  };

  const startNew = () => {
    setEdit({
      id: `template_${Date.now()}`,
      name: '',
      foldersText: '',
      isNew: true,
    });
    setError(null);
  };

  const startEdit = (tpl: PmFolderTemplate) => {
    setEdit({
      id: tpl.id,
      name: tpl.name,
      foldersText: tpl.folders.join('\n'),
      isNew: false,
    });
    setError(null);
  };

  const inputClass =
    'w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary';

  const exampleCode = '0126';
  const exampleName = 'Project';

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{t('pm.template_manager.title')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('pm.template_manager.title')}
          </DialogDescription>
        </DialogHeader>

        {edit ? (
          /* Edit / Create form */
          <div className="grid gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                {t('pm.template_manager.template_name')}
              </label>
              <input
                className={inputClass}
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                {t('pm.template_manager.folders_list')}
              </label>
              <p className="text-[10px] text-muted-foreground mb-1">
                {t('pm.template_manager.placeholder_hint')}
              </p>
              <textarea
                className={cn(inputClass, 'font-mono text-xs')}
                value={edit.foldersText}
                onChange={(e) => setEdit({ ...edit, foldersText: e.target.value })}
                rows={10}
                placeholder={"_Sent_files_\n__Final_files__\n_CAD_files"}
              />
            </div>

            {/* Preview */}
            {edit.foldersText.trim() && (
              <div className="rounded-md border border-border/50 bg-muted/30 p-3 max-h-36 overflow-auto">
                <p className="text-xs text-muted-foreground mb-1">{t('pm.template_manager.preview')}</p>
                <div className="text-xs font-mono space-y-0.5">
                  {edit.foldersText.split('\n').filter((l) => l.trim()).map((f, i) => {
                    const resolved = f.trim().replace('{name}', exampleName);
                    return (
                      <div key={i} className="text-muted-foreground">
                        {String(i).padStart(2, '0')}_{exampleCode}{resolved}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEdit(null)}>
                {t('pm.detail.cancel')}
              </Button>
              <Button size="sm" onClick={handleSave}>
                {t('pm.detail.save')}
              </Button>
            </div>
          </div>
        ) : (
          /* Template list */
          <div className="grid gap-3">
            <div className="flex justify-end">
              <Button size="sm" onClick={startNew}>
                <Plus className="mr-1.5 size-3.5" />
                {t('pm.template_manager.new_template')}
              </Button>
            </div>

            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-4">{t('ui.app.loading')}</p>
            ) : (
              <div className="overflow-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">{t('pm.template_manager.template_name')}</th>
                      <th className="px-3 py-2 font-medium text-center">{t('pm.template_manager.folders_count')}</th>
                      <th className="px-3 py-2 font-medium text-center w-24"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((tpl) => (
                      <tr key={tpl.id} className="border-b border-border/50">
                        <td className="px-3 py-2 flex items-center gap-2">
                          {tpl.name}
                          {tpl.is_default && (
                            <Badge variant="outline" className="text-[10px]">
                              {t('pm.template_manager.default_badge')}
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center text-xs font-mono">{tpl.folders.length}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            {!tpl.is_default && (
                              <Button variant="ghost" size="sm" className="size-7 p-0"
                                title={t('pm.template_manager.set_default')}
                                onClick={() => handleSetDefault(tpl.id)}>
                                <Star className="size-3.5" />
                              </Button>
                            )}
                            <Button variant="ghost" size="sm" className="size-7 p-0"
                              onClick={() => startEdit(tpl)}>
                              <Pencil className="size-3.5" />
                            </Button>
                            {tpl.id !== 'default' && (
                              <Button variant="ghost" size="sm" className="size-7 p-0 text-destructive"
                                onClick={() => handleDelete(tpl.id)}>
                                <Trash2 className="size-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
