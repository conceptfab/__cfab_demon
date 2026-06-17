import { Plus, Pencil, RefreshCw, Shield, Trash2 } from 'lucide-react';

import { AppTooltip } from '@/components/ui/app-tooltip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ApplicationsPageController } from '@/hooks/useApplicationsPageController';

type ApplicationsMonitoredCardProps = Pick<
  ApplicationsPageController,
  | 'addingApp'
  | 'apps'
  | 'dropActive'
  | 'handleAddApp'
  | 'handleRemoveApp'
  | 'handleRenameMonitoredApp'
  | 'handleSyncMonitored'
  | 'loadingApps'
  | 'loadingMonitored'
  | 'monitored'
  | 'monitoredError'
  | 'newDisplay'
  | 'newExe'
  | 'setNewDisplay'
  | 'setNewExe'
  | 'syncingMonitored'
  | 't'
>;

export function ApplicationsMonitoredCard({
  addingApp,
  apps,
  dropActive,
  handleAddApp,
  handleRemoveApp,
  handleRenameMonitoredApp,
  handleSyncMonitored,
  loadingApps,
  loadingMonitored,
  monitored,
  monitoredError,
  newDisplay,
  newExe,
  setNewDisplay,
  setNewExe,
  syncingMonitored,
  t,
}: ApplicationsMonitoredCardProps) {
  return (
    <Card
      className={
        dropActive
          ? 'ring-2 ring-primary ring-offset-2 ring-offset-background transition-shadow'
          : 'transition-shadow'
      }
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <Shield className="size-4" />
          {t('applications_page.monitored.title')}
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              className="h-7 max-w-full"
              onClick={() => {
                void handleSyncMonitored();
              }}
              disabled={syncingMonitored || loadingApps || apps.length === 0}
              aria-busy={syncingMonitored}
            >
              <RefreshCw
                className={`mr-1 size-3.5 ${
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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            className="flex h-8 w-full min-w-0 flex-1 rounded-md border bg-transparent px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label={t('applications_page.monitored.exe_label')}
            placeholder={t('applications_page.monitored.exe_placeholder')}
            value={newExe}
            onChange={(e) => setNewExe(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleAddApp();
            }}
          />
          <input
            className="flex h-8 w-full min-w-0 flex-1 rounded-md border bg-transparent px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label={t('applications_page.monitored.display_name_label')}
            placeholder={t(
              'applications_page.monitored.display_name_placeholder',
            )}
            value={newDisplay}
            onChange={(e) => setNewDisplay(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleAddApp();
            }}
          />
          <Button
            size="sm"
            className="h-8 w-full sm:w-auto"
            onClick={handleAddApp}
            disabled={!newExe.trim() || addingApp}
          >
            <Plus className="size-3.5 mr-1" />
            {t('applications_page.actions.add')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {dropActive
            ? t('applications_page.monitored.drop_active')
            : t('applications_page.monitored.drop_hint')}
        </p>
        {monitoredError && (
          <p
            role="alert"
            aria-live="assertive"
            className="text-xs text-destructive"
          >
            {monitoredError}
          </p>
        )}

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
                className="flex flex-col gap-2 rounded-md px-3 py-2 transition-colors hover:bg-accent/50 sm:flex-row sm:items-center sm:justify-between sm:py-1.5"
              >
                <div className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {app.display_name}
                  </span>
                  <span className="block break-all text-xs text-muted-foreground sm:ml-2 sm:inline">
                    {app.exe_name}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <AppTooltip
                    content={t('applications_page.tooltips.rename_monitored')}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-7 p-0"
                      aria-label={t(
                        'applications_page.tooltips.rename_monitored',
                      )}
                      onClick={() => handleRenameMonitoredApp(app)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  </AppTooltip>
                  <AppTooltip
                    content={t('applications_page.tooltips.remove_monitored')}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-7 p-0 text-muted-foreground hover:text-destructive"
                      aria-label={t(
                        'applications_page.tooltips.remove_monitored',
                      )}
                      onClick={() => handleRemoveApp(app.exe_name)}
                    >
                      <Trash2 className="size-3.5" />
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
  );
}
