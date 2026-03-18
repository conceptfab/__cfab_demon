import { useEffect, useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search,
  ArrowUpDown,
  Plus,
  RefreshCw,
  Trash2,
  Shield,
  TimerReset,
  Pencil,
  Save,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  applicationsApi,
  daemonApi,
} from '@/lib/tauri';
import { PromptModal } from '@/components/ui/prompt-modal';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { formatDuration, getErrorMessage, logTauriError } from '@/lib/utils';
import { useDataStore } from '@/store/data-store';
import { useToast } from '@/components/ui/toast-notification';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { AppWithStats, MonitoredApp } from '@/lib/db-types';
import type { PromptConfig } from '@/lib/ui-types';
import { usePageRefreshListener } from '@/hooks/usePageRefreshListener';
import { shouldRefreshApplicationsPage } from '@/lib/page-refresh-reasons';

type SortKey = 'display_name' | 'total_seconds' | 'session_count' | 'last_used';
const APP_ROWS_PAGE_SIZE = 100;

export function Applications() {
  const { i18n, t } = useTranslation();
  const { triggerRefresh } = useDataStore();
  const { showError, showInfo } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [apps, setApps] = useState<AppWithStats[]>([]);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('total_seconds');
  const [sortAsc, setSortAsc] = useState(false);
  const [editingColorId, setEditingColorId] = useState<number | null>(null);
  const [pendingColor, setPendingColor] = useState<string | null>(null);
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null);
  const [visibleRows, setVisibleRows] = useState(APP_ROWS_PAGE_SIZE);

  // Monitored apps state
  const [monitored, setMonitored] = useState<MonitoredApp[]>([]);
  const [newExe, setNewExe] = useState('');
  const [newDisplay, setNewDisplay] = useState('');
  const [monitoredError, setMonitoredError] = useState('');
  const [syncingMonitored, setSyncingMonitored] = useState(false);
  const [dataReloadVersion, setDataReloadVersion] = useState(0);
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

  const getMonitoredErrorMessage = useCallback(
    (error: unknown) => {
      const message = getErrorMessage(error, t('ui.common.unknown_error'));
      if (message === 'monitored.exe_name_empty') {
        return t('applications_page.errors.monitored_exe_required');
      }
      if (message === 'monitored.display_name_empty') {
        return t('applications_page.errors.monitored_display_name_required');
      }
      if (message === 'monitored.not_found') {
        return t('applications_page.errors.monitored_not_found');
      }
      if (message.startsWith('monitored.already_monitored:')) {
        return t('applications_page.errors.monitored_already_added', {
          exeName: message.slice('monitored.already_monitored:'.length),
        });
      }
      return message;
    },
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
    setDataReloadVersion((prev) => prev + 1);
  });

  useEffect(() => {
    void loadApplications();
    void loadMonitored();
  }, [dataReloadVersion, loadApplications, loadMonitored]);

  const monitoredSet = useMemo(
    () => new Set(monitored.map((m) => m.exe_name)),
    [monitored],
  );

  const handleAddApp = async () => {
    setMonitoredError('');
    try {
      await daemonApi.addMonitoredApp(newExe, newDisplay);
      setNewExe('');
      setNewDisplay('');
      await loadMonitored();
    } catch (e) {
      setMonitoredError(getMonitoredErrorMessage(e));
    }
  };

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
      const message = getMonitoredErrorMessage(e);
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
          const message = getMonitoredErrorMessage(e);
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
    result = [...result].sort((a, b) => {
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
            t('applications_page.errors.rename_app_prefix') +
              ` ${String(e)}`,
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
        t('applications_page.errors.delete_app_prefix') +
          ` ${String(e)}`,
      );
    }
  };

  const toggleSort = (key: SortKey) => {
    setVisibleRows(APP_ROWS_PAGE_SIZE);
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Monitored Apps Management */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Shield className="h-4 w-4" />
            {t('applications_page.monitored.title')}
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                onClick={() => {
                  void handleSyncMonitored();
                }}
                disabled={syncingMonitored || loadingApps || apps.length === 0}
                aria-busy={syncingMonitored}
              >
                <RefreshCw
                  className={`mr-1 h-3.5 w-3.5 ${
                    syncingMonitored ? 'animate-spin' : ''
                  }`}
                />
                {syncingMonitored
                  ? t('applications_page.actions.syncing')
                  : t('applications_page.actions.sync_from_apps')}
              </Button>
              <Badge variant="secondary">{monitored.length}</Badge>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Add form */}
          <div className="flex items-center gap-2">
            <input
              className="flex h-8 flex-1 rounded-md border bg-transparent px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label={t('applications_page.monitored.exe_label')}
              placeholder={t('applications_page.monitored.exe_placeholder')}
              value={newExe}
              onChange={(e) => setNewExe(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddApp()}
            />
            <input
              className="flex h-8 flex-1 rounded-md border bg-transparent px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label={t('applications_page.monitored.display_name_label')}
              placeholder={t(
                'applications_page.monitored.display_name_placeholder',
              )}
              value={newDisplay}
              onChange={(e) => setNewDisplay(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddApp()}
            />
            <Button
              size="sm"
              className="h-8"
              onClick={handleAddApp}
              disabled={!newExe.trim()}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              {t('applications_page.actions.add')}
            </Button>
          </div>
          {monitoredError && (
            <p
              role="alert"
              aria-live="assertive"
              className="text-xs text-destructive"
            >
              {monitoredError}
            </p>
          )}

          {/* Monitored list */}
          {loadingMonitored && monitored.length === 0 ? (
            <p
              role="status"
              aria-live="polite"
              className="text-xs text-muted-foreground text-center py-2"
            >
              {t('applications_page.monitored.loading')}
            </p>
          ) : monitored.length > 0 ? (
            <div className="space-y-1">
              {monitored.map((app) => (
                <div
                  key={app.exe_name}
                  className="flex items-center justify-between rounded-md px-3 py-1.5 hover:bg-accent/50 transition-colors"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium">
                      {app.display_name}
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {app.exe_name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <AppTooltip content={t('applications_page.tooltips.rename_monitored')}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => handleRenameMonitoredApp(app)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </AppTooltip>
                    <AppTooltip content={t('applications_page.tooltips.remove_monitored')}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemoveApp(app.exe_name)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </AppTooltip>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p
              role="status"
              aria-live="polite"
              className="text-xs text-muted-foreground text-center py-2"
            >
              {t('applications_page.monitored.empty')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Tracked Apps Table */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="flex h-9 w-full rounded-md border bg-transparent pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={t('applications_page.search_placeholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setVisibleRows(APP_ROWS_PAGE_SIZE);
            }}
          />
        </div>
        <p className="text-sm text-muted-foreground whitespace-nowrap">
          {t('applications_page.apps_count', { count: filtered.length })}
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                {(
                  [
                    ['display_name', t('applications_page.table.application')],
                    ['total_seconds', t('applications_page.table.total_time')],
                    ['session_count', t('applications_page.table.sessions')],
                    ['last_used', t('applications_page.table.last_used')],
                  ] as [SortKey, string][]
                ).map(([key, label]) => (
                  <th key={key} className="px-4 py-3 text-left font-medium">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-3 h-auto p-1"
                      onClick={() => toggleSort(key)}
                    >
                      {label}
                      <ArrowUpDown className="ml-1 h-3 w-3" />
                    </Button>
                  </th>
                ))}
                <th className="px-4 py-3 text-left font-medium">
                  {t('applications_page.table.project')}
                </th>
                <th className="px-4 py-3 text-left font-medium w-16"></th>
              </tr>
            </thead>
            <tbody>
              {visibleFiltered.map((app) => (
                <tr
                  key={app.id}
                  className="border-b last:border-0 hover:bg-accent/50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="relative group">
                        <AppTooltip content={t('applications_page.tooltips.change_color')}>
                          <div
                            className="h-3 w-3 rounded-full cursor-pointer hover:scale-125 transition-transform"
                            style={{ backgroundColor: pendingColor && editingColorId === app.id ? pendingColor : app.color }}
                            onClick={() => {
                              if (editingColorId === app.id) {
                                setEditingColorId(null);
                                setPendingColor(null);
                              } else {
                                setEditingColorId(app.id);
                                setPendingColor(null);
                              }
                            }}
                          />
                        </AppTooltip>
                        {editingColorId === app.id && (
                          <div className="absolute top-full left-0 z-50 mt-1 p-2 rounded border bg-popover shadow-md">
                            <div className="flex items-center gap-1">
                              <input
                                type="color"
                                defaultValue={app.color || '#38bdf8'}
                                className="w-16 h-8 border border-border rounded cursor-pointer"
                                onChange={(e) => setPendingColor(e.target.value)}
                                title={t('applications_page.tooltips.choose_color')}
                              />
                              {pendingColor && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-green-500 hover:text-green-400"
                                  onClick={() => {
                                    handleUpdateColor(app.id, pendingColor);
                                    setPendingColor(null);
                                  }}
                                  title={t('applications_page.tooltips.save_color')}
                                >
                                  <Save className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                            <div className="mt-2 flex gap-1">
                              {[
                                '#38bdf8',
                                '#a78bfa',
                                '#34d399',
                                '#fb923c',
                                '#f87171',
                                '#fbbf24',
                                '#818cf8',
                                '#22d3ee',
                              ].map((c) => (
                                <button
                                  key={c}
                                  className="h-5 w-5 rounded-full border border-white/10 hover:scale-110 transition-transform"
                                  style={{ backgroundColor: c }}
                                  onClick={() => {
                                    handleUpdateColor(app.id, c);
                                    setPendingColor(null);
                                  }}
                                  title={c}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="font-medium">{app.display_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {app.executable_name}
                        </p>
                      </div>
                      {monitoredSet.has(app.executable_name) && (
                        <Badge variant="outline" className="text-xs h-5">
                          {t('applications_page.labels.monitored')}
                        </Badge>
                      )}
                      {app.is_imported === 1 && (
                        <Badge
                          variant="secondary"
                          className="bg-orange-500/10 text-orange-500 border-orange-500/20 px-1 py-0 h-4 text-[10px]"
                        >
                          {t('applications_page.labels.imported')}
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {formatDuration(app.total_seconds)}
                  </td>
                  <td className="px-4 py-3 font-mono">{app.session_count}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatLastUsedDate(app.last_used)}
                  </td>
                  <td className="px-4 py-3">
                    {app.project_name ? (
                      <Badge
                        variant="secondary"
                        style={{
                          borderLeft: `3px solid ${app.project_color ?? '#38bdf8'}`,
                        }}
                      >
                        {app.project_name}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">{i18n.t('ui.common.not_available')}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <AppTooltip content={t('applications_page.tooltips.rename_app')}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleRenameApp(app)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </AppTooltip>
                      <AppTooltip content={t('applications_page.tooltips.reset_time')}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleResetAppTime(app)}
                        >
                          <TimerReset className="h-3.5 w-3.5" />
                        </Button>
                      </AppTooltip>
                      <AppTooltip content={t('applications_page.tooltips.delete_app_and_sessions')}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeleteApp(app)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AppTooltip>
                    </div>
                  </td>
                </tr>
              ))}
              {loadingApps && filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    role="status"
                    aria-live="polite"
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    {t('applications_page.loading.applications')}
                  </td>
                </tr>
              )}
              {!loadingApps && appsLoadError && (
                <tr>
                  <td
                    colSpan={6}
                    role="alert"
                    aria-live="assertive"
                    className="px-4 py-8 text-center text-destructive"
                  >
                    {appsLoadError}
                  </td>
                </tr>
              )}
              {!loadingApps && !appsLoadError && filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    role="status"
                    aria-live="polite"
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    {t('applications_page.empty.no_applications')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {canLoadMore && (
            <div className="flex justify-center border-t px-4 py-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVisibleRows((prev) => prev + APP_ROWS_PAGE_SIZE)}
              >
                {t('applications_page.actions.load_more')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <PromptModal
        open={promptConfig !== null}
        onOpenChange={(open) => !open && setPromptConfig(null)}
        title={promptConfig?.title ?? ''}
        description={promptConfig?.description}
        initialValue={promptConfig?.initialValue ?? ''}
        onConfirm={promptConfig?.onConfirm ?? (() => {})}
      />
      <ConfirmDialog />
    </div>
  );
}

