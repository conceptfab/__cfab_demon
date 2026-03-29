import { useState, useEffect } from 'react';
import { Wifi, Monitor, RefreshCw, Loader2, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { LanPeer, LanSyncSettings, SyncMarker } from '@/lib/lan-sync-types';

const SYNC_INTERVAL_OPTIONS = [
  { value: 0, label: 'Manual' },
  { value: 4, label: '4h' },
  { value: 8, label: '8h' },
  { value: 12, label: '12h' },
  { value: 24, label: '24h' },
  { value: 48, label: '48h' },
];

interface LanSyncCardProps {
  settings: LanSyncSettings;
  peers: LanPeer[];
  syncing: boolean;
  lastSyncAt: string | null;
  lastSyncResult: string | null;
  lastSyncSuccess: boolean;
  latestMarker: SyncMarker | null;
  title: string;
  description: string;
  enableTitle: string;
  enableDescription: string;
  portLabel: string;
  autoSyncTitle: string;
  autoSyncDescription: string;
  syncIntervalLabel: string;
  syncMarkerLabel: string;
  peersTitle: string;
  noPeersText: string;
  syncButtonLabel: string;
  syncingLabel: string;
  lastSyncLabel: string;
  dashboardRunningLabel: string;
  dashboardOfflineLabel: string;
  fullSyncButtonLabel?: string;
  labelClassName: string;
  onEnabledChange: (enabled: boolean) => void;
  onPortChange: (port: number) => void;
  onAutoSyncChange: (enabled: boolean) => void;
  onSyncIntervalChange: (hours: number) => void;
  onSyncWithPeer: (peer: LanPeer) => void;
  onFullSyncWithPeer?: (peer: LanPeer) => void;
}

export function LanSyncCard({
  settings,
  peers,
  syncing,
  lastSyncAt,
  lastSyncResult,
  lastSyncSuccess,
  latestMarker,
  title,
  description,
  enableTitle,
  enableDescription,
  portLabel,
  autoSyncTitle,
  autoSyncDescription,
  syncIntervalLabel,
  syncMarkerLabel,
  peersTitle,
  noPeersText,
  syncButtonLabel,
  syncingLabel,
  lastSyncLabel,
  dashboardRunningLabel,
  dashboardOfflineLabel,
  fullSyncButtonLabel,
  labelClassName,
  onEnabledChange,
  onPortChange,
  onAutoSyncChange,
  onSyncIntervalChange,
  onSyncWithPeer,
  onFullSyncWithPeer,
}: LanSyncCardProps) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Wifi className="h-4 w-4 text-sky-400" />
          {title}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <label
          htmlFor="lanSyncEnabled"
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
            className="h-4 w-4 rounded border-input accent-primary"
            checked={settings.enabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
          />
        </label>

        <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="min-w-0">
            <p className="text-sm font-medium">{portLabel}</p>
          </div>
          <input
            type="number"
            min={1024}
            max={65535}
            className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            value={settings.serverPort}
            onChange={(e) => {
              const val = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(val) && val >= 1024 && val <= 65535) {
                onPortChange(val);
              }
            }}
          />
        </div>

        <label
          htmlFor="lanAutoSync"
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
            className="h-4 w-4 rounded border-input accent-primary"
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
            {SYNC_INTERVAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {latestMarker && (
          <div className="rounded-md border border-border/70 bg-background/35 p-3 space-y-1">
            <div className="flex items-center gap-2">
              <Shield className="h-3.5 w-3.5 text-sky-400" />
              <p className="text-sm font-medium">{syncMarkerLabel}</p>
            </div>
            <p className="text-xs text-muted-foreground font-mono truncate">
              {latestMarker.marker_hash.slice(0, 16)}…
            </p>
            <p className="text-xs text-muted-foreground">
              {new Date(latestMarker.created_at).toLocaleString()} — {latestMarker.device_id}
              {latestMarker.full_sync ? ' (full)' : ' (delta)'}
            </p>
          </div>
        )}

        <div className="rounded-md border border-border/70 bg-background/35 p-3 space-y-3">
          <p className="text-sm font-medium">{peersTitle}</p>

          {peers.length === 0 ? (
            <p className="text-xs text-muted-foreground">{noPeersText}</p>
          ) : (
            <div className="space-y-2">
              {peers.map((peer) => (
                <div
                  key={peer.device_id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border/50 bg-background/20 p-2.5"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {peer.machine_name}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {peer.ip}:{peer.dashboard_port}
                      </p>
                    </div>
                    <span
                      className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full ${
                        peer.dashboard_running
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-zinc-500/15 text-zinc-400'
                      }`}
                    >
                      {peer.dashboard_running
                        ? dashboardRunningLabel
                        : dashboardOfflineLabel}
                    </span>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      disabled={syncing || !peer.dashboard_running}
                      onClick={() => onSyncWithPeer(peer)}
                    >
                      {syncing ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <RefreshCw className="h-3 w-3 mr-1" />
                      )}
                      {syncing ? syncingLabel : syncButtonLabel}
                    </Button>
                    {onFullSyncWithPeer && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                        disabled={syncing || !peer.dashboard_running}
                        onClick={() => onFullSyncWithPeer(peer)}
                      >
                        {fullSyncButtonLabel}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {lastSyncAt && (
            <div className="pt-2 border-t border-border/50">
              <p className="text-xs text-muted-foreground">
                {lastSyncLabel}{' '}
                <span className="font-mono text-foreground">
                  {new Date(lastSyncAt).toLocaleString()}
                </span>
              </p>
              {lastSyncResult && (
                <p
                  className={`text-xs mt-1 ${
                    lastSyncSuccess ? 'text-emerald-400' : 'text-destructive'
                  }`}
                >
                  {lastSyncResult}
                </p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
