import { useState, useEffect, useRef } from 'react';
import { Wifi, Monitor, RefreshCw, Loader2, Shield, Search, FileText, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { LanPeer, LanSyncSettings, SyncMarker, SyncProgress } from '@/lib/lan-sync-types';
import { lanSyncApi } from '@/lib/tauri/lan-sync';

const SYNC_INTERVAL_OPTIONS = [
  { value: 0, label: 'Manual' },
  { value: 4, label: '4h' },
  { value: 8, label: '8h' },
  { value: 12, label: '12h' },
  { value: 24, label: '24h' },
  { value: 48, label: '48h' },
];

/** Map daemon progress phase keys to translation keys */
const PHASE_LABELS: Record<string, string> = {
  idle: 'sync_phase_idle',
  starting: 'sync_phase_starting',
  negotiating: 'sync_phase_negotiating',
  negotiated: 'sync_phase_negotiated',
  freezing: 'sync_phase_freezing',
  downloading_from_slave: 'sync_phase_downloading',
  received_from_slave: 'sync_phase_received',
  backing_up: 'sync_phase_backup',
  merging: 'sync_phase_merging',
  verifying: 'sync_phase_verifying',
  uploading_to_slave: 'sync_phase_uploading',
  slave_downloading: 'sync_phase_slave_downloading',
  completed: 'sync_phase_completed',
};

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
  forceSyncButtonLabel?: string;
  roleLabel: string;
  roleAutoLabel: string;
  roleMasterLabel: string;
  roleSlaveLabel: string;
  manualSearchLabel: string;
  manualSearchPlaceholder: string;
  manualSearchButton: string;
  myIpLabel: string;
  myIp: string;
  labelClassName: string;
  syncPhaseLabels?: Record<string, string>;
  slaveInfoText?: string;
  showLogLabel?: string;
  hideLogLabel?: string;
  noLogEntriesText?: string;
  forceMergeTooltip?: string;
  onEnabledChange: (enabled: boolean) => void;
  onAutoSyncChange: (enabled: boolean) => void;
  onSyncIntervalChange: (hours: number) => void;
  onForcedRoleChange: (role: string) => void;
  onManualPing: (ip: string, port: number) => Promise<LanPeer | null>;
  onSyncWithPeer: (peer: LanPeer) => void;
  onFullSyncWithPeer?: (peer: LanPeer) => void;
  onForceSyncWithPeer?: (peer: LanPeer) => void;
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
  forceSyncButtonLabel,
  roleLabel,
  roleAutoLabel,
  roleMasterLabel,
  roleSlaveLabel,
  manualSearchLabel,
  manualSearchPlaceholder,
  manualSearchButton,
  myIpLabel,
  myIp,
  labelClassName,
  syncPhaseLabels,
  slaveInfoText,
  showLogLabel,
  hideLogLabel,
  noLogEntriesText,
  forceMergeTooltip,
  onEnabledChange,
  onAutoSyncChange,
  onSyncIntervalChange,
  onForcedRoleChange,
  onManualPing,
  onSyncWithPeer,
  onFullSyncWithPeer,
  onForceSyncWithPeer,
}: LanSyncCardProps) {
  const [manualIp, setManualIp] = useState('');
  const [pinging, setPinging] = useState(false);
  const [pingError, setPingError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [syncLog, setSyncLog] = useState('');
  const [showLog, setShowLog] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [daemonSyncing, setDaemonSyncing] = useState(false);
  const completedTimerRef = useRef<number | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  // The card is "busy" when either the UI triggered sync OR daemon is syncing (slave case)
  const isBusy = syncing || daemonSyncing;

  // Detect slave role — from daemon's actual role or forced setting
  const daemonRole = progress?.role || '';
  const isSlave = settings.forcedRole === 'slave' || (settings.forcedRole !== 'master' && daemonRole === 'slave');

  // Always poll daemon progress — detects sync on SLAVE too
  useEffect(() => {
    const poll = async () => {
      try {
        const p = await lanSyncApi.getLanSyncProgress();
        setProgress(p);

        if (p.phase === 'completed') {
          // Show "completed" for 3 seconds then dismiss
          setDaemonSyncing(true);
          if (!completedTimerRef.current) {
            completedTimerRef.current = window.setTimeout(() => {
              setDaemonSyncing(false);
              completedTimerRef.current = null;
            }, 3000);
          }
        } else if (p.phase === 'idle' || p.step === 0) {
          if (!completedTimerRef.current) setDaemonSyncing(false);
        } else {
          // Active sync phase
          setDaemonSyncing(true);
          if (!showLog) setShowLog(true);
          // Cancel completed timer if we re-enter active sync
          if (completedTimerRef.current) {
            clearTimeout(completedTimerRef.current);
            completedTimerRef.current = null;
          }
        }
      } catch {
        setDaemonSyncing(false);
        setProgress(null);
      }
    };
    void poll();
    const timer = window.setInterval(poll, isBusy ? 600 : 3000);
    return () => {
      clearInterval(timer);
      if (completedTimerRef.current) {
        clearTimeout(completedTimerRef.current);
        completedTimerRef.current = null;
      }
    };
  }, [isBusy, showLog]);

  // Poll sync log when busy or log visible
  useEffect(() => {
    if (!showLog && !isBusy) return;
    const poll = async () => {
      try {
        const log = await lanSyncApi.getLanSyncLog(50);
        setSyncLog(log);
        if (logRef.current) {
          logRef.current.scrollTop = logRef.current.scrollHeight;
        }
      } catch { /* ignore */ }
    };
    void poll();
    const timer = window.setInterval(poll, isBusy ? 500 : 2000);
    return () => clearInterval(timer);
  }, [showLog, isBusy]);

  const handleManualPing = async () => {
    const trimmed = manualIp.trim();
    if (!trimmed) return;
    setPinging(true);
    setPingError(null);
    try {
      await onManualPing(trimmed, settings.serverPort);
      setManualIp('');
    } catch (e) {
      setPingError(e instanceof Error ? e.message : String(e));
    } finally {
      setPinging(false);
    }
  };

  const handleScanSubnet = async () => {
    setScanning(true);
    try {
      await lanSyncApi.scanLanSubnet();
    } catch (e) {
      console.warn('LAN scan failed:', e);
    } finally {
      setScanning(false);
    }
  };

  const getPhaseLabel = (phase: string): string => {
    const key = PHASE_LABELS[phase];
    if (key && syncPhaseLabels?.[key]) return syncPhaseLabels[key];
    // Fallback: humanize the phase key
    return phase.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const progressPercent = progress && progress.total_steps > 0
    ? Math.round((progress.step / progress.total_steps) * 100)
    : 0;

  return (
    <Card className="relative">
      {/* ── Sync overlay (shows on master AND slave) ── */}
      {isBusy && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 rounded-lg bg-background/90 backdrop-blur-sm">
          <Loader2 className="h-8 w-8 animate-spin text-sky-400" />
          <div className="text-center space-y-2 px-6">
            <p className="text-sm font-semibold text-foreground">
              {syncingLabel}
            </p>
            {progress && progress.phase !== 'idle' && (
              <>
                <p className="text-xs text-muted-foreground">
                  {getPhaseLabel(progress.phase)}
                  <span className="ml-2 font-mono text-sky-400">
                    ({progress.step}/{progress.total_steps})
                  </span>
                </p>
                {/* Progress bar */}
                <div className="w-48 h-1.5 bg-border/50 rounded-full overflow-hidden mx-auto">
                  <div
                    className="h-full bg-sky-400 rounded-full transition-all duration-500"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                {progress.bytes_transferred > 0 && (
                  <p className="text-[10px] font-mono text-muted-foreground">
                    {formatBytes(progress.bytes_transferred)}
                    {progress.bytes_total > 0 && ` / ${formatBytes(progress.bytes_total)}`}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

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
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={manualSearchPlaceholder}
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
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Search className="h-3 w-3 mr-1" />
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{peersTitle}</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                disabled={scanning}
                onClick={handleScanSubnet}
              >
                {scanning ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <Search className="h-3 w-3 mr-1" />
                )}
                {scanning ? 'Scanning…' : 'Scan LAN'}
              </Button>
            </div>
            {isSlave && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium uppercase tracking-wide">
                Slave mode
              </span>
            )}
          </div>

          {isSlave && (
            <p className="text-xs text-muted-foreground italic">
              {slaveInfoText ?? 'This device is in slave mode — synchronization is initiated by the master.'}
            </p>
          )}

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
                    {isSlave ? null : (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2.5 text-xs"
                          disabled={isBusy || !peer.dashboard_running}
                          onClick={() => onSyncWithPeer(peer)}
                        >
                          {isBusy ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <RefreshCw className="h-3 w-3 mr-1" />
                          )}
                          {isBusy ? syncingLabel : syncButtonLabel}
                        </Button>
                        {onFullSyncWithPeer && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                            disabled={isBusy || !peer.dashboard_running}
                            onClick={() => onFullSyncWithPeer(peer)}
                          >
                            {fullSyncButtonLabel}
                          </Button>
                        )}
                        {onForceSyncWithPeer && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-amber-400 hover:text-amber-300"
                            disabled={isBusy || !peer.dashboard_running}
                            onClick={() => onForceSyncWithPeer(peer)}
                            title={forceMergeTooltip ?? 'Force merge — ignores hash comparison'}
                          >
                            <Zap className="h-3 w-3 mr-1" />
                            {forceSyncButtonLabel ?? 'Force'}
                          </Button>
                        )}
                      </>
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
        <div className="flex items-center gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => setShowLog((v) => !v)}
          >
            <FileText className="h-3 w-3 mr-1" />
            {showLog ? (hideLogLabel ?? 'Hide Log') : (showLogLabel ?? 'Show Log')}
          </Button>
        </div>

        {showLog && (
          <pre
            ref={logRef}
            className="mt-2 max-h-48 overflow-auto rounded-md border border-border/50 bg-black/30 p-2 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap"
          >
            {syncLog || (noLogEntriesText ?? '(no log entries yet)')}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
