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
  licenseTitle: string;
  licenseKeyPlaceholder: string;
  licenseActivateLabel: string;
  licenseActivatingLabel: string;
  licensePlanLabel: string;
  licenseGroupLabel: string;
  licenseDevicesLabel: string;
  licenseExpiresLabel: string;
  licenseActiveLabel: string;
  title: string;
  description: string;
  enableSyncTitle: string;
  enableSyncDescription: string;
  syncOnStartupTitle: string;
  syncOnStartupDescription: string;
  autoSyncIntervalTitle: string;
  autoSyncIntervalDescription: string;
  minutesLabel: string;
  enableLoggingTitle: string;
  enableLoggingDescription: string;
  serverUrlLabel: string;
  useDefaultServerLabel: string;
  userIdLabel: string;
  userIdPlaceholder: string;
  apiTokenLabel: string;
  apiTokenPlaceholder: string;
  showTokenLabel: string;
  hideTokenLabel: string;
  apiTokenHint: string;
  deviceIdLabel: string;
  generatedOnSaveLabel: string;
  deviceIdHint: string;
  statusTitle: string;
  lastSuccessfulLabel: string;
  demoModeDisabledWarning: string;
  serverRevisionLabel: string;
  serverHashLabel: string;
  localRevisionHashLabel: string;
  pendingAckLabel: string;
  retriesLabel: string;
  reseedWarning: string;
  syncingLabel: string;
  syncDisabledInDemoLabel: string;
  syncNowLabel: string;
  notAvailableLabel: string;
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
  testingRoundtrip: boolean;
  testRoundtripResult: string | null;
  testRoundtripSuccess: boolean;
  testRoundtripLabel: string;
  testingRoundtripLabel: string;
  onTestRoundtrip: () => void;
  forceSyncLabel: string;
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
  title,
  description,
  enableSyncTitle,
  enableSyncDescription,
  syncOnStartupTitle,
  syncOnStartupDescription,
  autoSyncIntervalTitle,
  autoSyncIntervalDescription,
  minutesLabel,
  enableLoggingTitle,
  enableLoggingDescription,
  serverUrlLabel,
  useDefaultServerLabel,
  userIdLabel,
  userIdPlaceholder,
  apiTokenLabel,
  apiTokenPlaceholder,
  showTokenLabel,
  hideTokenLabel,
  apiTokenHint,
  deviceIdLabel,
  generatedOnSaveLabel,
  deviceIdHint,
  statusTitle,
  lastSuccessfulLabel,
  demoModeDisabledWarning,
  serverRevisionLabel,
  serverHashLabel,
  localRevisionHashLabel,
  pendingAckLabel,
  retriesLabel,
  reseedWarning,
  syncingLabel,
  syncDisabledInDemoLabel,
  syncNowLabel,
  notAvailableLabel,
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
  licenseTitle,
  licenseKeyPlaceholder,
  licenseActivateLabel,
  licenseActivatingLabel,
  licensePlanLabel,
  licenseGroupLabel,
  licenseDevicesLabel,
  licenseExpiresLabel,
  licenseActiveLabel,
  onLicenseKeyChange,
  onActivateLicense,
  testingRoundtrip,
  testRoundtripResult,
  testRoundtripSuccess,
  testRoundtripLabel,
  testingRoundtripLabel,
  onTestRoundtrip,
  forceSyncLabel,
  onForceSyncNow,
}: OnlineSyncCardProps) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* License activation section */}
        <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{licenseTitle}</span>
          </div>
          {licenseInfo ? (
            <div className="grid gap-1.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                  {licenseActiveLabel}
                </span>
                <span className="font-mono text-muted-foreground">
                  {licenseInfo.plan.toUpperCase()}
                </span>
              </div>
              <div className="text-muted-foreground">
                {licenseGroupLabel}: <span className="text-foreground">{licenseInfo.groupName}</span>
              </div>
              <div className="text-muted-foreground">
                {licenseDevicesLabel}: <span className="text-foreground">{licenseInfo.activeDevices}/{licenseInfo.maxDevices}</span>
              </div>
              {licenseInfo.expiresAt && (
                <div className="text-muted-foreground">
                  {licenseExpiresLabel}: <span className="text-foreground">{new Date(licenseInfo.expiresAt).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-sm shadow-sm placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  placeholder={licenseKeyPlaceholder}
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
                  {licenseActivating ? licenseActivatingLabel : licenseActivateLabel}
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
          className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{enableSyncTitle}</p>
            <p className="text-xs leading-5 break-words text-muted-foreground">
              {enableSyncDescription}
            </p>
          </div>
          <input
            id="onlineSyncEnabled"
            type="checkbox"
            className="h-4 w-4 rounded border-input accent-primary"
            checked={settings.enabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
          />
        </label>

        <label
          htmlFor="onlineSyncOnStartup"
          className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{syncOnStartupTitle}</p>
            <p className="text-xs leading-5 break-words text-muted-foreground">
              {syncOnStartupDescription}
            </p>
          </div>
          <input
            id="onlineSyncOnStartup"
            type="checkbox"
            className="h-4 w-4 rounded border-input accent-primary"
            checked={settings.autoSyncOnStartup}
            onChange={(e) => onAutoSyncOnStartupChange(e.target.checked)}
          />
        </label>

        <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="min-w-0">
            <p className="text-sm font-medium">{autoSyncIntervalTitle}</p>
            <p className="text-xs leading-5 break-words text-muted-foreground">
              {autoSyncIntervalDescription}
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
            <span className="text-sm text-muted-foreground">{minutesLabel}</span>
          </div>
        </div>

        <label
          htmlFor="onlineSyncLogging"
          className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{enableLoggingTitle}</p>
            <p className="text-xs leading-5 break-words text-muted-foreground">
              {enableLoggingDescription}
            </p>
          </div>
          <input
            id="onlineSyncLogging"
            type="checkbox"
            className="h-4 w-4 rounded border-input accent-primary"
            checked={settings.enableLogging}
            onChange={(e) => onEnableLoggingChange(e.target.checked)}
          />
        </label>

        <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3">
          <label className="grid gap-1.5 text-sm">
            <span className={labelClassName}>{serverUrlLabel}</span>
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
                {useDefaultServerLabel}
              </Button>
              <span className="text-xs text-muted-foreground break-all">
                {defaultServerUrl}
              </span>
            </div>
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className={labelClassName}>{userIdLabel}</span>
            <input
              type="text"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              placeholder={userIdPlaceholder}
              value={settings.userId}
              onChange={(e) => onUserIdChange(e.target.value)}
            />
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className={labelClassName}>{apiTokenLabel}</span>
            <div className="flex items-center gap-2">
              <input
                type={showToken ? 'text' : 'password'}
                autoComplete="off"
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                placeholder={apiTokenPlaceholder}
                value={settings.apiToken}
                onChange={(e) => onApiTokenChange(e.target.value)}
              />
              <AppTooltip content={showToken ? hideTokenLabel : showTokenLabel}>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-10 px-0"
                  onClick={() => onShowTokenChange(!showToken)}
                  aria-label={showToken ? hideTokenLabel : showTokenLabel}
                >
                  {showToken ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </AppTooltip>
            </div>
            <p className="text-xs text-muted-foreground">{apiTokenHint}</p>
          </label>

          <div className="grid gap-1.5 text-sm">
            <span className={labelClassName}>{deviceIdLabel}</span>
            <div className="rounded-md border border-input bg-muted/30 px-3 py-2 font-mono text-xs break-all">
              {settings.deviceId || generatedOnSaveLabel}
            </div>
            <p className="text-xs text-muted-foreground">{deviceIdHint}</p>
          </div>

          <div className="grid gap-3 rounded-md border border-border/70 bg-background/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{statusTitle}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-8"
                  onClick={onSyncNow}
                  disabled={manualSyncing || demoModeSyncDisabled}
                >
                  {manualSyncing
                    ? syncingLabel
                    : demoModeSyncDisabled
                      ? syncDisabledInDemoLabel
                      : syncNowLabel}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8"
                  onClick={onTestRoundtrip}
                  disabled={testingRoundtrip}
                >
                  {testingRoundtrip ? testingRoundtripLabel : testRoundtripLabel}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
                  onClick={onForceSyncNow}
                  disabled={manualSyncing || demoModeSyncDisabled}
                >
                  {forceSyncLabel}
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              {lastSuccessfulLabel} {lastSyncLabel}
            </p>

            {demoModeSyncDisabled && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-300">
                {demoModeDisabledWarning}
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
                {serverRevisionLabel}{' '}
                <span className="font-mono text-foreground">
                  {state.serverRevision}
                </span>
              </div>
              <div>
                {serverHashLabel}{' '}
                <span className="font-mono text-foreground break-all">
                  {shortHash}
                </span>
              </div>
              <div>
                {localRevisionHashLabel}{' '}
                <span className="font-mono text-foreground">
                  {state.localRevision ?? notAvailableLabel} / {localHashShort}
                </span>
              </div>
              {state.pendingAck && (
                <div className="text-amber-500">
                  {pendingAckLabel}{' '}
                  <span className="font-mono text-foreground">
                    r{state.pendingAck.revision} / {pendingAckHashShort}
                  </span>
                  {state.pendingAck.retries > 0 && (
                    <>
                      {' '}
                      ({retriesLabel}: {state.pendingAck.retries})
                    </>
                  )}
                </div>
              )}
              {state.needsReseed && (
                <div className="text-amber-500">{reseedWarning}</div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
