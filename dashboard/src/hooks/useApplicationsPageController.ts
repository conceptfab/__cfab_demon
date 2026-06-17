import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentWebview } from '@tauri-apps/api/webview';

import { useConfirmDialogState } from '@/hooks/useConfirmDialogState';
import { usePageRefreshListener } from '@/hooks/usePageRefreshListener';
import { getMonitoredErrorMessage } from '@/lib/applications-page-utils';
import type { AppWithStats, MonitoredApp } from '@/lib/db-types';
import { shouldRefreshApplicationsPage } from '@/lib/page-refresh-reasons';
import type { PromptConfig } from '@/lib/ui-types';
import {
  applicationsApi,
  daemonApi,
  hasTauriRuntime,
} from '@/lib/tauri';
import { getErrorMessage, logTauriError } from '@/lib/utils';
import {
  APP_ROWS_PAGE_SIZE,
  type ApplicationsSortKey,
} from '@/pages/applications/applications-page-constants';
import { useDataStore } from '@/store/data-store';
import { useToast } from '@/components/ui/toast-notification';

export function useApplicationsPageController() {
  const { i18n, t } = useTranslation();
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const { showError, showInfo } = useToast();
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialogState();
  const [apps, setApps] = useState<AppWithStats[]>([]);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<ApplicationsSortKey>('total_seconds');
  const [sortAsc, setSortAsc] = useState(false);
  const [editingColorId, setEditingColorId] = useState<number | null>(null);
  const [pendingColor, setPendingColor] = useState<string | null>(null);
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null);
  const [visibleRows, setVisibleRows] = useState(APP_ROWS_PAGE_SIZE);

  const [monitored, setMonitored] = useState<MonitoredApp[]>([]);
  const [newExe, setNewExe] = useState('');
  const [newDisplay, setNewDisplay] = useState('');
  const [monitoredError, setMonitoredError] = useState('');
  const [addingApp, setAddingApp] = useState(false);
  const [syncingMonitored, setSyncingMonitored] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [loadingApps, setLoadingApps] = useState(true);
  const [loadingMonitored, setLoadingMonitored] = useState(true);
  const [appsLoadError, setAppsLoadError] = useState('');

  const monitoredDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language),
    [i18n.language, i18n.resolvedLanguage],
  );

  const formatLastUsedDate = useCallback(
    (value: string | null) => {
      if (!value) {
        return t('ui.common.not_available');
      }
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        return value;
      }
      return monitoredDateFormatter.format(parsed);
    },
    [monitoredDateFormatter, t],
  );

  const resolveMonitoredError = useCallback(
    (error: unknown) => getMonitoredErrorMessage(error, t),
    [t],
  );

  const loadApplications = useCallback(async () => {
    setLoadingApps(true);
    try {
      const value = await applicationsApi.getApplications();
      setApps(value);
      setVisibleRows(APP_ROWS_PAGE_SIZE);
      setAppsLoadError('');
    } catch (error) {
      logTauriError('load applications', error);
      setApps([]);
      setAppsLoadError(t('applications_page.errors.load_applications'));
    } finally {
      setLoadingApps(false);
    }
  }, [t]);

  const loadMonitored = useCallback(async () => {
    setLoadingMonitored(true);
    try {
      const value = await daemonApi.getMonitoredApps();
      setMonitored(value);
      setMonitoredError('');
    } catch (error) {
      logTauriError('load monitored apps', error);
      setMonitoredError(t('applications_page.errors.load_monitored'));
    } finally {
      setLoadingMonitored(false);
    }
  }, [t]);

  usePageRefreshListener((reasons) => {
    if (!reasons.some((reason) => shouldRefreshApplicationsPage(reason))) {
      return;
    }
    void loadApplications();
    void loadMonitored();
  });

  useEffect(() => {
    // async loadery na mount: setState biegnie po await, nie kaskaduje renderów.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadApplications();
    void loadMonitored();
  }, [loadApplications, loadMonitored]);

  const monitoredSet = useMemo(
    () => new Set(monitored.map((m) => m.exe_name)),
    [monitored],
  );

  const handleAddApp = async () => {
    if (addingApp) return;
    setAddingApp(true);
    setMonitoredError('');
    try {
      await daemonApi.addMonitoredApp(newExe, newDisplay);
      setNewExe('');
      setNewDisplay('');
      await loadMonitored();
    } catch (e) {
      setMonitoredError(resolveMonitoredError(e));
    } finally {
      setAddingApp(false);
    }
  };

  const handleDroppedPaths = useCallback(
    async (paths: string[]) => {
      setMonitoredError('');
      const results = await Promise.allSettled(
        paths.map(async (path) => {
          const info = await daemonApi.inspectDroppedApp(path);
          await daemonApi.addMonitoredApp(
            info.exe_name,
            info.display_name,
            info.bundle_id ?? undefined,
            info.app_path ?? undefined,
          );
          return info;
        }),
      );

      let added = false;
      for (const result of results) {
        if (result.status === 'fulfilled') {
          added = true;
          showInfo(
            t('applications_page.messages.drop_added', {
              name: result.value.display_name,
            }),
          );
        } else {
          logTauriError('inspect/add dropped app', result.reason);
          const message = resolveMonitoredError(result.reason);
          setMonitoredError(message);
          showError(message);
        }
      }
      if (added) {
        await loadMonitored();
      }
    },
    [loadMonitored, resolveMonitoredError, showError, showInfo, t],
  );

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'over') {
          setDropActive(true);
        } else if (event.payload.type === 'leave') {
          setDropActive(false);
        } else if (event.payload.type === 'drop') {
          setDropActive(false);
          void handleDroppedPaths(event.payload.paths);
        }
      })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [handleDroppedPaths]);

  const handleRemoveApp = async (exeName: string) => {
    const confirmed = await confirm(
      t('applications_page.prompts.remove_monitored_confirm', { exeName }),
    );
    if (!confirmed) return;

    try {
      await daemonApi.removeMonitoredApp(exeName);
      await loadMonitored();
    } catch (e) {
      logTauriError('remove monitored app', e);
      const message = resolveMonitoredError(e);
      setMonitoredError(message);
      showError(message);
    }
  };

  const handleRenameMonitoredApp = async (app: MonitoredApp) => {
    const current = app.display_name || app.exe_name;
    setPromptConfig({
      title: t('applications_page.prompts.rename_monitored_title'),
      initialValue: current,
      onConfirm: async (next) => {
        const trimmed = next.trim();
        if (!trimmed) {
          showError(t('applications_page.errors.monitored_display_name_required'));
          return;
        }
        if (trimmed === current) return;

        try {
          await daemonApi.renameMonitoredApp(app.exe_name, trimmed);
          await loadMonitored();
        } catch (e) {
          logTauriError('rename monitored app', e);
          const message = resolveMonitoredError(e);
          setMonitoredError(message);
          showError(message);
        }
      },
    });
  };

  const handleSyncMonitored = async () => {
    setMonitoredError('');
    setSyncingMonitored(true);
    try {
      const result = await daemonApi.syncMonitoredAppsFromApplications();
      await loadMonitored();
      if (result.added > 0) {
        showInfo(
          t('applications_page.messages.sync_monitored_added', {
            added: result.added,
            scanned: result.scanned,
          }),
        );
      } else {
        showInfo(t('applications_page.messages.sync_monitored_noop'));
      }
    } catch (error) {
      logTauriError('sync monitored apps from applications', error);
      const message =
        `${t('applications_page.errors.sync_monitored_prefix')} ${getErrorMessage(error, t('ui.common.unknown_error'))}`;
      setMonitoredError(message);
      showError(message);
    } finally {
      setSyncingMonitored(false);
    }
  };

  const filtered = useMemo(() => {
    let result = apps;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (a) =>
          a.display_name.toLowerCase().includes(q) ||
          a.executable_name.toLowerCase().includes(q),
      );
    }
    result = result.toSorted((a, b) => {
      let cmp = 0;
      if (sortKey === 'display_name')
        cmp = a.display_name.localeCompare(b.display_name);
      else if (sortKey === 'total_seconds')
        cmp = a.total_seconds - b.total_seconds;
      else if (sortKey === 'session_count')
        cmp = a.session_count - b.session_count;
      else if (sortKey === 'last_used')
        cmp = (a.last_used ?? '').localeCompare(b.last_used ?? '');
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [apps, search, sortKey, sortAsc]);

  const visibleFiltered = useMemo(
    () => filtered.slice(0, visibleRows),
    [filtered, visibleRows],
  );

  const canLoadMore = visibleRows < filtered.length;

  const handleResetAppTime = async (app: AppWithStats) => {
    const label = app.display_name || app.executable_name;
    const confirmed = await confirm(
      t('applications_page.prompts.reset_time_confirm', { label }),
    );
    if (!confirmed) return;

    try {
      await applicationsApi.resetAppTime(app.id);
      triggerRefresh('applications_changed');
    } catch (err) {
      logTauriError('reset app time', err);
      showError(
        `${t('applications_page.errors.reset_time_prefix')} ${getErrorMessage(err, t('ui.common.unknown_error'))}`,
      );
    }
  };

  const handleUpdateColor = async (appId: number, color: string) => {
    try {
      await applicationsApi.updateAppColor(appId, color);
      setEditingColorId(null);
      triggerRefresh('applications_changed');
    } catch (error) {
      logTauriError('update app color', error);
      showError(
        `${t('applications_page.errors.save_color_prefix')} ${String(error)}`,
      );
    }
  };

  const handleRenameApp = async (app: AppWithStats) => {
    const current = app.display_name || app.executable_name;
    setPromptConfig({
      title: t('applications_page.prompts.rename_app_title'),
      description: t('applications_page.prompts.rename_app_description'),
      initialValue: current,
      onConfirm: async (next) => {
        const trimmed = next.trim();
        if (!trimmed) {
          showError(t('applications_page.errors.app_name_empty'));
          return;
        }
        if (trimmed === current) return;

        try {
          await applicationsApi.renameApplication(app.id, trimmed);
          triggerRefresh('applications_changed');
        } catch (e) {
          logTauriError('rename application', e);
          showError(
            t('applications_page.errors.rename_app_prefix') + ` ${String(e)}`,
          );
        }
      },
    });
  };

  const handleDeleteApp = async (app: AppWithStats) => {
    const label = app.display_name || app.executable_name;
    const confirmed = await confirm(
      t('applications_page.prompts.delete_app_confirm', {
        label,
        sessionCount: app.session_count,
      }),
    );
    if (!confirmed) return;

    try {
      await applicationsApi.deleteAppAndData(app.id);
      triggerRefresh('applications_changed');
    } catch (e) {
      logTauriError('delete app and data', e);
      showError(
        t('applications_page.errors.delete_app_prefix') + ` ${String(e)}`,
      );
    }
  };

  const toggleSort = (key: ApplicationsSortKey) => {
    setVisibleRows(APP_ROWS_PAGE_SIZE);
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setVisibleRows(APP_ROWS_PAGE_SIZE);
  };

  const loadMoreRows = () => {
    setVisibleRows((prev) => prev + APP_ROWS_PAGE_SIZE);
  };

  const closePrompt = () => setPromptConfig(null);

  return {
    addingApp,
    apps,
    appsLoadError,
    canLoadMore,
    confirmDialogProps,
    dropActive,
    editingColorId,
    filtered,
    formatLastUsedDate,
    handleAddApp,
    handleDeleteApp,
    handleRenameApp,
    handleRenameMonitoredApp,
    handleRemoveApp,
    handleResetAppTime,
    handleSearchChange,
    handleSyncMonitored,
    handleUpdateColor,
    loadMoreRows,
    loadingApps,
    loadingMonitored,
    monitored,
    monitoredError,
    monitoredSet,
    newDisplay,
    newExe,
    pendingColor,
    promptConfig,
    closePrompt,
    search,
    setEditingColorId,
    setNewDisplay,
    setNewExe,
    setPendingColor,
    setPromptConfig,
    sortAsc,
    sortKey,
    syncingMonitored,
    t,
    toggleSort,
    visibleFiltered,
  };
}

export type ApplicationsPageController = ReturnType<
  typeof useApplicationsPageController
>;
