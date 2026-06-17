import {
  ArrowUpDown,
  Pencil,
  Save,
  TimerReset,
  Trash2,
} from 'lucide-react';

import { AppTooltip } from '@/components/ui/app-tooltip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AppWithStats } from '@/lib/db-types';
import { formatDurationWithDaily } from '@/lib/utils';
import type { ApplicationsSortKey } from '@/pages/applications/applications-page-constants';

interface ApplicationsDesktopAppTableProps {
  apps: AppWithStats[];
  appsLoadError: string;
  editingColorId: number | null;
  filteredCount: number;
  formatLastUsedDate: (value: string | null) => string;
  handleDeleteApp: (app: AppWithStats) => void;
  handleRenameApp: (app: AppWithStats) => void;
  handleResetAppTime: (app: AppWithStats) => void;
  handleUpdateColor: (appId: number, color: string) => void;
  loadingApps: boolean;
  monitoredSet: Set<string>;
  pendingColor: string | null;
  setEditingColorId: (id: number | null) => void;
  setPendingColor: (color: string | null) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  toggleSort: (key: ApplicationsSortKey) => void;
}

export function ApplicationsDesktopAppTable({
  apps,
  appsLoadError,
  editingColorId,
  filteredCount,
  formatLastUsedDate,
  handleDeleteApp,
  handleRenameApp,
  handleResetAppTime,
  handleUpdateColor,
  loadingApps,
  monitoredSet,
  pendingColor,
  setEditingColorId,
  setPendingColor,
  t,
  toggleSort,
}: ApplicationsDesktopAppTableProps) {
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="min-w-[46rem] text-sm">
        <thead>
          <tr className="border-b text-muted-foreground">
            {(
              [
                ['display_name', t('applications_page.table.application')],
                ['total_seconds', t('applications_page.table.total_time')],
                ['session_count', t('applications_page.table.sessions')],
                ['last_used', t('applications_page.table.last_used')],
              ] as [ApplicationsSortKey, string][]
            ).map(([key, label]) => (
              <th key={key} className="px-4 py-3 text-left font-medium">
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-3 h-auto p-1"
                  onClick={() => toggleSort(key)}
                >
                  {label}
                  <ArrowUpDown className="ml-1 size-3" />
                </Button>
              </th>
            ))}
            <th className="px-4 py-3 text-left font-medium">
              {t('applications_page.table.project')}
            </th>
            <th
              className="px-4 py-3 text-left font-medium w-16"
              aria-label={t('accessibility.actions_column')}
            />
          </tr>
        </thead>
        <tbody>
          {apps.map((app) => (
            <tr
              key={app.id}
              className="border-b last:border-0 hover:bg-accent/50 transition-colors"
            >
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="relative group">
                    <AppTooltip
                      content={t('applications_page.tooltips.change_color')}
                    >
                      <button
                        type="button"
                        aria-label={t('applications_page.tooltips.change_color')}
                        className="size-3 rounded-full border-0 bg-transparent p-0 cursor-pointer hover:scale-125 transition-transform"
                        style={{
                          backgroundColor:
                            pendingColor && editingColorId === app.id
                              ? pendingColor
                              : app.color,
                        }}
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
                            aria-label={t(
                              'applications_page.tooltips.choose_color',
                            )}
                            onChange={(e) => setPendingColor(e.target.value)}
                            title={t('applications_page.tooltips.choose_color')}
                          />
                          {pendingColor && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-green-500 hover:text-green-400"
                              aria-label={t(
                                'applications_page.tooltips.save_color',
                              )}
                              onClick={() => {
                                handleUpdateColor(app.id, pendingColor);
                                setPendingColor(null);
                              }}
                              title={t('applications_page.tooltips.save_color')}
                            >
                              <Save className="size-4" />
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
                              type="button"
                              key={c}
                              className="size-5 rounded-full border border-white/10 hover:scale-110 transition-transform"
                              style={{ backgroundColor: c }}
                              onClick={() => {
                                handleUpdateColor(app.id, c);
                                setPendingColor(null);
                              }}
                              aria-label={`${t('applications_page.tooltips.choose_color')}: ${c}`}
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
                {formatDurationWithDaily(app.total_seconds, app.daily_seconds)}
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
                  <span className="text-muted-foreground">
                    {t('ui.common.not_available')}
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1">
                  <AppTooltip content={t('applications_page.tooltips.rename_app')}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={t('applications_page.tooltips.rename_app')}
                      onClick={() => handleRenameApp(app)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  </AppTooltip>
                  <AppTooltip content={t('applications_page.tooltips.reset_time')}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={t('applications_page.tooltips.reset_time')}
                      onClick={() => handleResetAppTime(app)}
                    >
                      <TimerReset className="size-3.5" />
                    </Button>
                  </AppTooltip>
                  <AppTooltip
                    content={t(
                      'applications_page.tooltips.delete_app_and_sessions',
                    )}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      aria-label={t(
                        'applications_page.tooltips.delete_app_and_sessions',
                      )}
                      onClick={() => handleDeleteApp(app)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </AppTooltip>
                </div>
              </td>
            </tr>
          ))}
          {loadingApps && filteredCount === 0 && (
            <tr>
              <td
                colSpan={6}
                className="px-4 py-8 text-center text-muted-foreground"
              >
                <output
                  aria-live="polite"
                  aria-label={t('applications_page.loading.applications')}
                >
                  {t('applications_page.loading.applications')}
                </output>
              </td>
            </tr>
          )}
          {!loadingApps && appsLoadError && (
            <tr>
              <td
                colSpan={6}
                className="px-4 py-8 text-center text-destructive"
              >
                <span role="alert" aria-live="assertive">
                  {appsLoadError}
                </span>
              </td>
            </tr>
          )}
          {!loadingApps && !appsLoadError && filteredCount === 0 && (
            <tr>
              <td
                colSpan={6}
                className="px-4 py-8 text-center text-muted-foreground"
              >
                <output
                  aria-live="polite"
                  aria-label={t('applications_page.empty.no_applications')}
                >
                  {t('applications_page.empty.no_applications')}
                </output>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
