import { Loader2, Search, Shield } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { LanSyncCardController } from '@/hooks/useLanSyncCardController';

import {
  LAN_SYNC_INTERVAL_OPTIONS,
  type LanSyncCardProps,
} from './lan-sync-card-types';

type LanSyncSettingsSectionProps = Pick<
  LanSyncCardProps,
  | 'settings'
  | 'enableTitle'
  | 'enableDescription'
  | 'autoSyncTitle'
  | 'autoSyncDescription'
  | 'syncIntervalLabel'
  | 'roleLabel'
  | 'roleAutoLabel'
  | 'roleMasterLabel'
  | 'roleSlaveLabel'
  | 'myIpLabel'
  | 'myIp'
  | 'labelClassName'
  | 'manualSearchLabel'
  | 'manualSearchPlaceholder'
  | 'manualSearchButton'
  | 'syncMarkerLabel'
  | 'latestMarker'
  | 'onEnabledChange'
  | 'onAutoSyncChange'
  | 'onSyncIntervalChange'
  | 'onForcedRoleChange'
> &
  Pick<
    LanSyncCardController,
    | 'manualIp'
    | 'setManualIp'
    | 'pinging'
    | 'pingError'
    | 'handleManualPing'
  >;

export function LanSyncSettingsSection({
  settings,
  enableTitle,
  enableDescription,
  autoSyncTitle,
  autoSyncDescription,
  syncIntervalLabel,
  roleLabel,
  roleAutoLabel,
  roleMasterLabel,
  roleSlaveLabel,
  myIpLabel,
  myIp,
  labelClassName,
  manualSearchLabel,
  manualSearchPlaceholder,
  manualSearchButton,
  syncMarkerLabel,
  latestMarker,
  onEnabledChange,
  onAutoSyncChange,
  onSyncIntervalChange,
  onForcedRoleChange,
  manualIp,
  setManualIp,
  pinging,
  pingError,
  handleManualPing,
}: LanSyncSettingsSectionProps) {
  return (
    <>
      <label
        htmlFor="lanSyncEnabled"
        aria-label="Enable LAN sync"
        className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium">{enableTitle}</p>
          <p className="text-xs leading-5 break-words text-muted-foreground">
            {enableDescription}
          </p>
        </div>
        <input
          id="lanSyncEnabled"
          type="checkbox"
          className="size-4 rounded border-input accent-primary"
          checked={settings.enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
        />
      </label>

      <label
        htmlFor="lanAutoSync"
        aria-label="Auto sync on peer found"
        className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium">{autoSyncTitle}</p>
          <p className="text-xs leading-5 break-words text-muted-foreground">
            {autoSyncDescription}
          </p>
        </div>
        <input
          id="lanAutoSync"
          type="checkbox"
          className="size-4 rounded border-input accent-primary"
          checked={settings.autoSyncOnPeerFound}
          onChange={(e) => onAutoSyncChange(e.target.checked)}
        />
      </label>

      <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="min-w-0">
          <p className="text-sm font-medium">{syncIntervalLabel}</p>
        </div>
        <select
          className="h-8 w-28 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          value={settings.syncIntervalHours}
          onChange={(e) => onSyncIntervalChange(Number(e.target.value))}
        >
          {LAN_SYNC_INTERVAL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="min-w-0">
          <p className="text-sm font-medium">{roleLabel}</p>
        </div>
        <select
          className="h-8 w-28 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          value={settings.forcedRole || ''}
          onChange={(e) => onForcedRoleChange(e.target.value)}
        >
          <option value="">{roleAutoLabel}</option>
          <option value="master">{roleMasterLabel}</option>
          <option value="slave">{roleSlaveLabel}</option>
        </select>
      </div>

      <div className="rounded-md border border-border/70 bg-background/35 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{myIpLabel}</p>
          <span className="text-sm font-mono text-sky-400 select-all">{myIp || '—'}</span>
        </div>
        <label className={labelClassName}>{manualSearchLabel}</label>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder={manualSearchPlaceholder}
            aria-label={manualSearchLabel}
            className="flex-1 h-8 rounded-md border border-input bg-background px-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            value={manualIp}
            onChange={(e) => setManualIp(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleManualPing(); }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-3 text-xs"
            disabled={pinging || !manualIp.trim()}
            onClick={() => void handleManualPing()}
          >
            {pinging ? (
              <Loader2 className="size-3 animate-spin mr-1" />
            ) : (
              <Search className="size-3 mr-1" />
            )}
            {manualSearchButton}
          </Button>
        </div>
        {pingError && (
          <p className="text-xs text-destructive">{pingError}</p>
        )}
      </div>

      {latestMarker && (
        <div className="rounded-md border border-border/70 bg-background/35 p-3 space-y-1">
          <div className="flex items-center gap-2">
            <Shield className="size-3.5 text-sky-400" />
            <p className="text-sm font-medium">{syncMarkerLabel}</p>
          </div>
          <p className="text-xs text-muted-foreground font-mono truncate">
            {latestMarker.marker_hash.slice(0, 16)}…
          </p>
          <p className="text-xs text-muted-foreground">
            {/* eslint-disable-next-line react-doctor/rendering-hydration-mismatch-time -- No SSR (Tauri client app) */}
            {new Date(latestMarker.created_at).toLocaleString()}, {latestMarker.device_id}
            {latestMarker.full_sync ? ' (full)' : ' (delta)'}
          </p>
        </div>
      )}
    </>
  );
}
