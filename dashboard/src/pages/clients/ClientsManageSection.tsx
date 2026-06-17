import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { ClientsPageController } from '@/hooks/useClientsPageController';
import { ClientsFormField } from '@/pages/clients/ClientsFormField';
import { CLIENT_FORM_INPUT_CLASS } from '@/pages/clients/clients-page-constants';

type ClientsManageSectionProps = Pick<
  ClientsPageController,
  | 'clients'
  | 'form'
  | 'loading'
  | 'onArchive'
  | 'onDelete'
  | 'resetForm'
  | 'setForm'
  | 'setShowForm'
  | 'setShowManage'
  | 'showForm'
  | 'showManage'
  | 'startEdit'
  | 'submitForm'
  | 't'
>;

export function ClientsManageSection({
  clients,
  form,
  loading,
  onArchive,
  onDelete,
  resetForm,
  setForm,
  setShowForm,
  setShowManage,
  showForm,
  showManage,
  startEdit,
  submitForm,
  t,
}: ClientsManageSectionProps) {
  return (
    <Card>
      <button
        type="button"
        onClick={() => setShowManage((v) => !v)}
        className="flex w-full items-center justify-between px-6 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-base font-semibold">
          {showManage ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
          {t('clients_page.manage.title')}
        </span>
        <span className="text-xs text-muted-foreground">{clients.length}</span>
      </button>
      {showManage && (
        <CardContent className="space-y-3">
          {!showForm && (
            <Button size="sm" onClick={() => setShowForm(true)}>
              <Plus className="mr-1 size-4" />
              {t('clients_page.add')}
            </Button>
          )}
          {showForm && (
            <div className="grid gap-2 rounded-md border border-border/70 bg-background/40 p-3 sm:grid-cols-2">
              <ClientsFormField label={t('clients_page.field.name')}>
                <input
                  aria-label={t('clients_page.field.name')}
                  className={CLIENT_FORM_INPUT_CLASS}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </ClientsFormField>
              <ClientsFormField label={t('clients_page.field.contact')}>
                <input
                  aria-label={t('clients_page.field.contact')}
                  className={CLIENT_FORM_INPUT_CLASS}
                  value={form.contact}
                  onChange={(e) =>
                    setForm({ ...form, contact: e.target.value })
                  }
                />
              </ClientsFormField>
              <ClientsFormField label={t('clients_page.field.address')}>
                <input
                  aria-label={t('clients_page.field.address')}
                  className={CLIENT_FORM_INPUT_CLASS}
                  value={form.address}
                  onChange={(e) =>
                    setForm({ ...form, address: e.target.value })
                  }
                />
              </ClientsFormField>
              <ClientsFormField label={t('clients_page.field.tax_id')}>
                <input
                  aria-label={t('clients_page.field.tax_id')}
                  className={CLIENT_FORM_INPUT_CLASS}
                  value={form.taxId}
                  onChange={(e) => setForm({ ...form, taxId: e.target.value })}
                />
              </ClientsFormField>
              <ClientsFormField label={t('clients_page.field.currency')}>
                <input
                  aria-label={t('clients_page.field.currency')}
                  className={CLIENT_FORM_INPUT_CLASS}
                  value={form.currency}
                  onChange={(e) =>
                    setForm({ ...form, currency: e.target.value })
                  }
                  placeholder="PLN / EUR / USD"
                />
              </ClientsFormField>
              <ClientsFormField label={t('clients_page.field.rate')}>
                <input
                  aria-label={t('clients_page.field.rate')}
                  className={CLIENT_FORM_INPUT_CLASS}
                  value={form.defaultHourlyRate}
                  onChange={(e) =>
                    setForm({ ...form, defaultHourlyRate: e.target.value })
                  }
                  inputMode="decimal"
                />
              </ClientsFormField>
              <ClientsFormField label={t('clients_page.field.color')}>
                <input
                  type="color"
                  aria-label={t('clients_page.field.color')}
                  className="h-8 w-16 rounded border border-input bg-background"
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                />
              </ClientsFormField>
              <div className="flex items-end gap-2 sm:col-span-2">
                <Button size="sm" onClick={submitForm}>
                  {t('clients_page.save')}
                </Button>
                <Button size="sm" variant="ghost" onClick={resetForm}>
                  {t('clients_page.cancel')}
                </Button>
              </div>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">…</p>
          ) : clients.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('clients_page.empty')}</p>
          ) : (
            <div className="divide-y divide-border/50">
              {clients.map((c) => (
                <div key={c.id} className="flex items-center gap-3 py-2">
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: c.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {c.name}
                      </span>
                      {c.archived_at && (
                        <span className="rounded-full bg-secondary/30 px-2 py-0.5 text-[10px] text-muted-foreground">
                          {t('clients_page.archived')}
                        </span>
                      )}
                    </div>
                    {(c.contact || c.tax_id) && (
                      <span className="truncate text-xs text-muted-foreground">
                        {[c.contact, c.tax_id].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="p-1.5 text-muted-foreground hover:text-foreground"
                    title={t('clients_page.edit')}
                    onClick={() => startEdit(c)}
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    className="p-1.5 text-muted-foreground hover:text-foreground"
                    title={
                      c.archived_at
                        ? t('clients_page.unarchive')
                        : t('clients_page.archive')
                    }
                    onClick={() => onArchive(c)}
                  >
                    {c.archived_at ? (
                      <ArchiveRestore className="size-4" />
                    ) : (
                      <Archive className="size-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="p-1.5 text-muted-foreground hover:text-destructive"
                    title={t('clients_page.delete')}
                    onClick={() => onDelete(c)}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
