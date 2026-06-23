import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useConfirmDialogState } from '@/hooks/useConfirmDialogState';
import { ALL_TIME_DATE_RANGE } from '@/lib/date-helpers';
import {
  clientsArchive,
  clientsCreate,
  clientsDelete,
  clientsList,
  clientsSyncFromPm,
  clientsUpdate,
  getClientsSummary,
  projectSetClient,
  projectSetStatus,
  projectsWithClient,
  type Client,
  type ClientSummary,
  type ProjectClientRow,
  type ProjectStatus,
} from '@/lib/tauri';
import { getErrorMessage } from '@/lib/utils';
import {
  EMPTY_CLIENT_FORM,
  type ClientFormState,
} from '@/pages/clients/clients-page-constants';
import { useDataStore } from '@/store/data-store';
import { useSettingsStore } from '@/store/settings-store';
import { useUIStore } from '@/store/ui-store';
import { useToast } from '@/components/ui/toast-notification';

export function useClientsPageController() {
  const { t } = useTranslation();
  const { showError, showInfo } = useToast();
  const { confirm, dialogProps } = useConfirmDialogState();
  const currencyCode = useSettingsStore((s) => s.currencyCode);
  const refreshKey = useDataStore((s) => s.refreshKey);
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const setClientPageName = useUIStore((s) => s.setClientPageName);
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const setProjectPageId = useUIStore((s) => s.setProjectPageId);

  const [clients, setClients] = useState<Client[]>([]);
  const [summaries, setSummaries] = useState<ClientSummary[]>([]);
  const [projects, setProjects] = useState<ProjectClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const editingIdRef = useRef<number | null>(null);
  const [form, setForm] = useState<ClientFormState>(EMPTY_CLIENT_FORM);
  const [showForm, setShowForm] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [showEmptyClients, setShowEmptyClients] = useState(false);

  const openProject = (projectId: number) => {
    setProjectPageId(projectId);
    setCurrentPage('project-card');
  };

  const openClientPage = (clientName: string) => {
    setClientPageName(clientName);
    setCurrentPage('client-card');
  };

  const load = useCallback(async () => {
    try {
      const [c, s, p] = await Promise.all([
        clientsList(),
        getClientsSummary(ALL_TIME_DATE_RANGE),
        projectsWithClient(),
      ]);
      setClients(c);
      setSummaries(s);
      setProjects(p);
    } catch (err) {
      showError(getErrorMessage(err, t('clients_page.error')));
    } finally {
      setLoading(false);
    }
  }, [showError, t]);

  useEffect(() => {
    // load() ustawia 3 stany (clients/summaries/projects) i reaguje na refreshKey.
    // useAsyncData zwraca pojedynczy data: T|null — nie obsługuje wielu
    // niezależnych kolekcji bez rozbicia na osobne hooki.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- multi-state loader (clients + summaries + projects); refreshKey dep; useAsyncData doesn't fit
    void load();
  }, [load, refreshKey]);

  const totalValue = useMemo(
    () => summaries.reduce((acc, s) => acc + s.total_value, 0),
    [summaries],
  );

  const [activeSummaries, emptySummaries] = useMemo(() => {
    const active: ClientSummary[] = [];
    const empty: ClientSummary[] = [];
    for (const s of summaries) {
      (s.total_value > 0 || s.total_seconds > 0 ? active : empty).push(s);
    }
    return [active, empty];
  }, [summaries]);

  const activeClientNames = useMemo(() => {
    const names: string[] = [];
    for (const client of clients) {
      if (!client.archived_at) names.push(client.name);
    }
    return names;
  }, [clients]);

  const resetForm = () => {
    setForm(EMPTY_CLIENT_FORM);
    editingIdRef.current = null;
    setShowForm(false);
  };

  const startEdit = (c: Client) => {
    editingIdRef.current = c.id;
    setForm({
      name: c.name,
      contact: c.contact ?? '',
      address: c.address ?? '',
      taxId: c.tax_id ?? '',
      currency: c.currency ?? '',
      defaultHourlyRate:
        c.default_hourly_rate != null ? String(c.default_hourly_rate) : '',
      color: c.color || '#38bdf8',
    });
    setShowForm(true);
  };

  const submitForm = async () => {
    const name = form.name.trim();
    if (!name) {
      showError(t('clients_page.field.name'));
      return;
    }
    const input = {
      name,
      contact: form.contact.trim() || null,
      address: form.address.trim() || null,
      taxId: form.taxId.trim() || null,
      currency: form.currency.trim() || null,
      defaultHourlyRate: form.defaultHourlyRate.trim()
        ? Number(form.defaultHourlyRate.replace(',', '.'))
        : null,
      color: form.color || '#38bdf8',
    };
    try {
      if (editingIdRef.current != null) {
        await clientsUpdate(editingIdRef.current, input);
      } else {
        await clientsCreate(input);
      }
      resetForm();
      triggerRefresh('settings_saved');
    } catch (err) {
      showError(getErrorMessage(err, t('clients_page.error')));
    }
  };

  const onSync = async () => {
    try {
      const res = await clientsSyncFromPm();
      showInfo(
        t('clients_page.sync_result', {
          clients: res.clients_created,
          projects: res.projects_assigned,
        }),
      );
      triggerRefresh('settings_saved');
    } catch (err) {
      showError(getErrorMessage(err, t('clients_page.error')));
    }
  };

  const onArchive = async (c: Client) => {
    try {
      await clientsArchive(c.id, !c.archived_at);
      triggerRefresh('settings_saved');
    } catch (err) {
      showError(getErrorMessage(err, t('clients_page.error')));
    }
  };

  const onDelete = async (c: Client) => {
    const ok = await confirm(t('clients_page.confirm_delete', { name: c.name }));
    if (!ok) return;
    try {
      await clientsDelete(c.id, c.name);
      showInfo(t('clients_page.delete'));
      triggerRefresh('settings_saved');
    } catch (err) {
      showError(getErrorMessage(err, t('clients_page.error')));
    }
  };

  const onAssignClient = async (projectId: number, clientName: string) => {
    try {
      await projectSetClient(projectId, clientName || null);
      triggerRefresh('settings_saved');
    } catch (err) {
      showError(getErrorMessage(err, t('clients_page.error')));
    }
  };

  const onAssignStatus = async (projectId: number, status: ProjectStatus) => {
    try {
      await projectSetStatus(projectId, status);
      triggerRefresh('settings_saved');
    } catch (err) {
      showError(getErrorMessage(err, t('clients_page.error')));
    }
  };

  return {
    activeClientNames,
    activeSummaries,
    clients,
    currencyCode,
    dialogProps,
    emptySummaries,
    form,
    loading,
    onArchive,
    onAssignClient,
    onAssignStatus,
    onDelete,
    onSync,
    openClientPage,
    openProject,
    projects,
    resetForm,
    setForm,
    setShowAssign,
    setShowEmptyClients,
    setShowForm,
    setShowManage,
    showAssign,
    showEmptyClients,
    showForm,
    showManage,
    startEdit,
    submitForm,
    summaries,
    t,
    totalValue,
  };
}

export type ClientsPageController = ReturnType<typeof useClientsPageController>;
