import { useTranslation } from 'react-i18next';

import type { OnlineSyncCardProps } from '@/components/settings/online-sync/online-sync-card-types';

type OnlineSyncToggleOptionsProps = Pick<
  OnlineSyncCardProps,
  | 'onAutoSyncIntervalChange'
  | 'onAutoSyncOnStartupChange'
  | 'onEnableLoggingChange'
  | 'onEnabledChange'
  | 'settings'
>;

export function OnlineSyncToggleOptions({
  onAutoSyncIntervalChange,
  onAutoSyncOnStartupChange,
  onEnableLoggingChange,
  onEnabledChange,
  settings,
}: OnlineSyncToggleOptionsProps) {
  const { t } = useTranslation();

  return (
    <>
      <label
        htmlFor="onlineSyncEnabled"
        aria-label="Enable online sync"
        className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {t('settings.online_sync.enableTitle')}
          </p>
          <p className="text-xs leading-5 break-words text-muted-foreground">
            {t(
              'settings_page.allows_the_dashboard_to_exchange_data_snapshots_with_the',
            )}
          </p>
        </div>
        <input
          id="onlineSyncEnabled"
          type="checkbox"
          className="size-4 rounded border-input accent-primary"
          checked={settings.enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
        />
      </label>

      <label
        htmlFor="onlineSyncOnStartup"
        aria-label="Sync on startup"
        className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {t('settings_page.sync_on_startup')}
          </p>
          <p className="text-xs leading-5 break-words text-muted-foreground">
            {t(
              'settings_page.runs_status_pull_push_after_local_auto_import_finishes',
            )}
          </p>
        </div>
        <input
          id="onlineSyncOnStartup"
          type="checkbox"
          className="size-4 rounded border-input accent-primary"
          checked={settings.autoSyncOnStartup}
          onChange={(e) => onAutoSyncOnStartupChange(e.target.checked)}
        />
      </label>

      <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {t('settings_page.auto_sync_interval')}
          </p>
          <p className="text-xs leading-5 break-words text-muted-foreground">
            {t(
              'settings_page.periodic_sync_after_app_startup_default_is_every_30_minu',
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={1440}
            step={1}
            aria-label={t('settings_page.auto_sync_interval')}
            className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            value={settings.autoSyncIntervalMinutes}
            onChange={(e) => {
              const nextValue = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(nextValue)) {
                onAutoSyncIntervalChange(
                  Math.min(1440, Math.max(1, nextValue)),
                );
              }
            }}
          />
          <span className="text-sm text-muted-foreground">
            {t('settings_page.min')}
          </span>
        </div>
      </div>

      <label
        htmlFor="onlineSyncLogging"
        aria-label="Enable sync logging"
        className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {t('settings.online_sync.loggingTitle')}
          </p>
          <p className="text-xs leading-5 break-words text-muted-foreground">
            {t(
              'settings_page.save_detailed_sync_operations_to_log_file_for_debugging',
            )}
          </p>
        </div>
        <input
          id="onlineSyncLogging"
          type="checkbox"
          className="size-4 rounded border-input accent-primary"
          checked={settings.enableLogging}
          onChange={(e) => onEnableLoggingChange(e.target.checked)}
        />
      </label>
    </>
  );
}
