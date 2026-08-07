import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { TodoPageController } from '@/hooks/useTodoPageController';
import type { TodoScope } from '@/lib/tauri/todos';

interface TodoDialogProps {
  controller: TodoPageController;
  /** Nazwy projektów do wyboru przy zakresie „projekt". */
  projectNames: string[];
  /** Nazwy klientów do wyboru przy zakresie „klient". */
  clientNames: string[];
}

export function TodoDialog({
  controller,
  projectNames,
  clientNames,
}: TodoDialogProps) {
  const { t } = useTranslation();
  const {
    dialogOpen,
    editing,
    form,
    setForm,
    dialogError,
    saving,
    closeDialog,
    submit,
  } = controller;

  const setScope = (scope: TodoScope) => {
    // Zmiana zakresu czyści link nieużywany w nowym zakresie — inaczej rekord
    // wpadłby do backendu z polem sprzecznym z `scope` i został odrzucony.
    setForm({
      ...form,
      scope,
      projectName: scope === 'project' ? form.projectName : null,
      clientName: scope === 'client' ? form.clientName : null,
    });
  };

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(next) => {
        if (!next) closeDialog();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? t('todo.edit') : t('todo.add')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">
              {t('todo.field_title')}
            </span>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">
              {t('todo.field_scope')}
            </span>
            <select
              value={form.scope}
              onChange={(e) => setScope(e.target.value as TodoScope)}
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            >
              <option value="global">{t('todo.scope_global')}</option>
              <option value="client">{t('todo.field_client')}</option>
              <option value="project">{t('todo.field_project')}</option>
            </select>
          </label>

          {form.scope === 'project' && (
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">
                {t('todo.field_project')}
              </span>
              <select
                value={form.projectName ?? ''}
                onChange={(e) =>
                  setForm({ ...form, projectName: e.target.value || null })
                }
                className="w-full rounded border bg-background px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {projectNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {form.scope === 'client' && (
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground">
                {t('todo.field_client')}
              </span>
              <select
                value={form.clientName ?? ''}
                onChange={(e) =>
                  setForm({ ...form, clientName: e.target.value || null })
                }
                className="w-full rounded border bg-background px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {clientNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="flex gap-2">
            <label className="block flex-1 space-y-1">
              <span className="text-sm text-muted-foreground">
                {t('todo.field_due_date')}
              </span>
              <input
                type="date"
                value={form.dueDate ?? ''}
                onChange={(e) =>
                  setForm({ ...form, dueDate: e.target.value || null })
                }
                className="w-full rounded border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="block w-28 space-y-1">
              <span className="text-sm text-muted-foreground">
                {t('todo.field_due_time')}
              </span>
              <input
                type="time"
                value={form.dueTime ?? ''}
                onChange={(e) =>
                  setForm({ ...form, dueTime: e.target.value || null })
                }
                className="w-full rounded border bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">
              {t('todo.field_priority')}
            </span>
            <select
              value={String(form.priority)}
              onChange={(e) =>
                setForm({ ...form, priority: Number(e.target.value) })
              }
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            >
              <option value="0">{t('todo.priority_low')}</option>
              <option value="1">{t('todo.priority_normal')}</option>
              <option value="2">{t('todo.priority_high')}</option>
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-muted-foreground">
              {t('todo.field_notes')}
            </span>
            <textarea
              rows={3}
              value={form.notes ?? ''}
              onChange={(e) =>
                setForm({ ...form, notes: e.target.value || null })
              }
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
          </label>

          {dialogError ? (
            <p className="text-sm text-destructive">{dialogError}</p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={closeDialog}>
            {t('ui.buttons.cancel')}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={saving || !form.title.trim()}
          >
            {t('ui.buttons.ok')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
