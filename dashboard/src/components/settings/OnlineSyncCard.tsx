import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  LicenseInfo,
  OnlineSyncRunResult,
  OnlineSyncSettings,
  OnlineSyncState,
} from '@/lib/online-sync';

interface OnlineSyncCardProps {
  settings: OnlineSyncSettings;
  state: OnlineSyncState;
  manualSyncResult: OnlineSyncRunResult | null;
  manualSyncResultText: string | null;
  manualSyncResultSuccess: boolean;
  manualSyncing: boolean;
  demoModeSyncDisabled: boolean;
  showToken: boolean;
  licenseInfo: LicenseInfo | null;
  licenseKeyInput: string;
  licenseActivating: boolean;
  licenseError: string | null;
  defaultServerUrl: string;
  labelClassName: string;
  lastSyncLabel: string;
  shortHash: string;
  localHashShort: string;
  pendingAckHashShort: string;
  onEnabledChange: (enabled: boolean) => void;
  onAutoSyncOnStartupChange: (enabled: boolean) => void;
  onAutoSyncIntervalChange: (minutes: number) => void;
  onEnableLoggingChange: (enabled: boolean) => void;
  onServerUrlChange: (url: string) => void;
  onResetServerUrl: () => void;
  onUserIdChange: (userId: string) => void;
  onApiTokenChange: (token: string) => void;
  onShowTokenChange: (show: boolean) => void;
  onSyncNow: () => void;
  onLicenseKeyChange: (key: string) => void;
  onActivateLicense: () => void;
  onDeactivateLicense: () => void;
  testingRoundtrip: boolean;
  testRoundtripResult: string | null;
  testRoundtripSuccess: boolean;
  onTestRoundtrip: () => void;
  onForceSyncNow: () => void;
}

export function OnlineSyncCard({
  settings,
  state,
  manualSyncResult,
  manualSyncResultText,
  manualSyncResultSuccess,
  manualSyncing,
  demoModeSyncDisabled,
  showToken,
  defaultServerUrl,
  labelClassName,
  lastSyncLabel,
  shortHash,
  localHashShort,
  pendingAckHashShort,
  onEnabledChange,
  onAutoSyncOnStartupChange,
  onAutoSyncIntervalChange,
  onEnableLoggingChange,
  onServerUrlChange,
  onResetServerUrl,
  onUserIdChange,
  onApiTokenChange,
  onShowTokenChange,
  onSyncNow,
  licenseInfo,
  licenseKeyInput,
  licenseActivating,
  licenseError,
  onLicenseKeyChange,
  onActivateLicense,
  onDeactivateLicense,
  testingRoundtrip,
  testRoundtripResult,
  testRoundtripSuccess,
  onTestRoundtrip,
  onForceSyncNow,
}: OnlineSyncCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold">{t('settings_page.online_sync')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('settings_page.startup_synchronization_with_remote_server_using_snapsho')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* License activation section */}
        <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t('settings.license.title')}</span>
          </div>
          {licenseInfo ? (
            <div className="grid gap-1.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                  {t('settings.license.active')}
                </span>
                <span className="font-mono text-muted-foreground">
                  {licenseInfo.plan.toUpperCase()}
                </span>
                <button
                  type="button"
                  className="ml-auto rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:border-red-500/50 hover:text-red-400 transition-colors"
                  onClick={onDeactivateLicense}
                >
                  {t('settings.license.deactivate', 'Change license')}
                </button>
              </div>
              <div className="text-muted-foreground">
                {t('settings.license.group')}: <span className="text-foreground">{licenseInfo.groupName}</span>
              </div>
              <div className="text-muted-foreground">
                {t('settings.license.devices')}: <span className="text-foreground">{licenseInfo.activeDevices}/{licenseInfo.maxDevices}</span>
              </div>
              {licenseInfo.expiresAt && (
                <div className="text-muted-foreground">
                  {t('settings.license.expires')}: <span className="text-foreground">{new Date(licenseInfo.expiresAt).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-sm shadow-sm placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  placeholder={t('settings.license.key_placeholder')}
                  value={licenseKeyInput}
                  onChange={(e) => onLicenseKeyChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && licenseKeyInput.trim()) {
                      onActivateLicense();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 whitespace-nowrap"
                  onClick={onActivateLicense}
                  disabled={licenseActivating || !licenseKeyInput.trim()}
                >
                  {licenseActivating ? t('settings.license.activating') : t('settings.license.activate')}
                </Button>
              </div>
              {licenseError && (
                <p className="text-xs text-destructive">{licenseError}</p>
              )}
            </div>
          )}
        </div>

        <label
          htmlFor="onlineSyncEnabled"
          aria-label="Enable online sync"
          className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('settings.online_sync.enableTitle')}</p>
            <p className="text-xs leading-5 break-words text-muted-foreground">
              {t('settings_page.allows_the_dashboard_to_exchange_data_snapshots_with_the')}
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
            <p className="text-sm font-medium">{t('settings_page.sync_on_startup')}</p>
            <p className="text-xs leading-5 break-words text-muted-foreground">
              {t('settings_page.runs_status_pull_push_after_local_auto_import_finishes')}
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
            <p className="text-sm font-medium">{t('settings_page.auto_sync_interval')}</p>
            <p className="text-xs leading-5 break-words text-muted-foreground">
              {t('settings_page.periodic_sync_after_app_startup_default_is_every_30_minu')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={1440}
              step={1}
              className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              value={settings.autoSyncIntervalMinutes}
              onChange={(e) => {
                const nextValue = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(nextValue)) {
                  onAutoSyncIntervalChange(Math.min(1440, Math.max(1, nextValue)));
                }
              }}
            />
            <span className="text-sm text-muted-foreground">{t('settings_page.min')}</span>
          </div>
        </div>

        <label
          htmlFor="onlineSyncLogging"
          aria-label="Enable sync logging"
          className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{t('settings.online_sync.loggingTitle')}</p>
            <p className="text-xs leading-5 break-words text-muted-foreground">
              {t('settings_page.save_detailed_sync_operations_to_log_file_for_debugging')}
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

        <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3">
          <label className="grid gap-1.5 text-sm">
            <span className={labelClassName}>{t('settings_page.server_url')}</span>
            <input
              type="text"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              placeholder={defaultServerUrl}
              value={settings.serverUrl}
              onChange={(e) => onServerUrlChange(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={onResetServerUrl}
              >
                {t('settings.online_sync.useRailwayDefault')}
              </Button>
              <span className="text-xs text-muted-foreground break-all">
                {defaultServerUrl}
              </span>
            </div>
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className={labelClassName}>{t('settings_page.user_id')}</span>
            <input
              type="text"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              placeholder={t('settings_page.user_id_placeholder')}
              value={settings.userId}
              onChange={(e) => onUserIdChange(e.target.value)}
            />
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className={labelClassName}>{t('settings_page.api_token_bearer')}</span>
            <div className="flex items-center gap-2">
              <input
                type={showToken ? 'text' : 'password'}
                autoComplete="off"
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                placeholder={t('settings_page.paste_the_raw_token_without_bearer_prefix_and_without_qu')}
                value={settings.apiToken}
                onChange={(e) => onApiTokenChange(e.target.value)}
              />
              <AppTooltip content={showToken ? t('settings_page.hide_token') : t('settings_page.show_token')}>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-10 px-0"
                  onClick={() => onShowTokenChange(!showToken)}
                  aria-label={showToken ? t('settings_page.hide_token') : t('settings_page.show_token')}
                >
                  {showToken ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </Button>
              </AppTooltip>
            </div>
            <p className="text-xs text-muted-foreground">
              {settings.apiToken
                ? t('settings_page.token_set_auto')
                : t('settings_page.enter_the_raw_token_the_app_will_add_the_bearer_header_a')}
            </p>
          </label>

          <div className="grid gap-1.5 text-sm">
            <span className={labelClassName}>{t('settings_page.device_id')}</span>
            <div className="rounded-md border border-input bg-muted/30 px-3 py-2 font-mono text-xs break-all">
              {settings.deviceId || t('settings_page.generated_on_save')}
            </div>
            <p className="text-xs text-muted-foreground">{t('settings_page.generated_automatically_and_used_to_identify_this_machin')}</p>
          </div>

          <div className="grid gap-3 rounded-md border border-border/70 bg-background/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{t('settings_page.last_sync_status')}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-8"
                  onClick={onSyncNow}
                  disabled={manualSyncing || demoModeSyncDisabled}
                >
                  {manualSyncing
                    ? t('settings_page.syncing')
                    : demoModeSyncDisabled
                      ? t('settings.online_sync.syncDisabledInDemo')
                      : t('settings_page.sync_now')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8"
                  onClick={onTestRoundtrip}
                  disabled={testingRoundtrip}
                >
                  {testingRoundtrip ? t('settings_page.testing_roundtrip') : t('settings_page.test_roundtrip')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
                  onClick={onForceSyncNow}
                  disabled={manualSyncing || demoModeSyncDisabled}
                >
                  {t('settings_page.force_full_sync')}
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              {t('settings_page.last_successful_check_sync')} {lastSyncLabel}
            </p>

            {demoModeSyncDisabled && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-300">
                {t('settings_page.online_sync_is_disabled_while_demo_mode_is_active')}
              </div>
            )}

            {(testRoundtripResult || (manualSyncResult && manualSyncResultText)) && (
              <div className="grid gap-1 rounded-md border border-border/50 bg-background/30 p-2">
                {testRoundtripResult && (
                  <div
                    className={`text-xs font-mono break-all ${testRoundtripSuccess ? 'text-emerald-400' : 'text-destructive'}`}
                  >
                    {testRoundtripResult}
                  </div>
                )}
                {manualSyncResult && manualSyncResultText && (
                  <div
                    className={
                      manualSyncResultSuccess
                        ? 'text-xs text-emerald-400'
                        : 'text-xs text-destructive'
                    }
                  >
                    {manualSyncResultText}
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-1 text-xs text-muted-foreground">
              <div>
                {t('settings_page.server_revision')}{' '}
                <span className="font-mono text-foreground">
                  {state.serverRevision}
                </span>
              </div>
              <div>
                {t('settings_page.server_hash')}{' '}
                <span className="font-mono text-foreground break-all">
                  {shortHash}
                </span>
              </div>
              <div>
                {t('settings_page.local_rev_hash')}{' '}
                <span className="font-mono text-foreground">
                  {state.localRevision ?? t('ui.common.not_available')} / {localHashShort}
                </span>
              </div>
              {state.pendingAck && (
                <div className="text-amber-500">
                  {t('settings_page.pending_ack')}{' '}
                  <span className="font-mono text-foreground">
                    r{state.pendingAck.revision} / {pendingAckHashShort}
                  </span>
                  {state.pendingAck.retries > 0 && (
                    <>
                      {' '}
                      ({t('settings_page.retries')}: {state.pendingAck.retries})
                    </>
                  )}
                </div>
              )}
              {state.needsReseed && (
                <div className="text-amber-500">{t('settings_page.server_payload_was_cleaned_up_after_acks_local_reseed_ex')}</div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
