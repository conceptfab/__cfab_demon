import { useState, useEffect, useRef } from 'react';
import { Wifi, Monitor, RefreshCw, Loader2, Shield, ShieldCheck, ShieldAlert, ShieldX, Search, FileText, Zap, CheckCircle2 } from 'lucide-react';
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
  slaveInfoText?: string;
  showLogLabel?: string;
  hideLogLabel?: string;
  noLogEntriesText?: string;
  firewallHintTitle?: string;
  firewallHintDescription?: string;
  forceMergeTooltip?: string;
  // Pairing props
  pairedDeviceIds?: Set<string>;
  pairingExpiredDeviceIds?: Set<string>;
  pairingCode?: string | null;
  pairingCodeRemaining?: number;
  onGeneratePairingCode?: () => void;
  onPairWithPeer?: (peer: LanPeer, code: string) => Promise<void>;
  onUnpairDevice?: (peer: LanPeer) => void;
  pairingGenerateCodeLabel?: string;
  pairingCodeLabel?: string;
  pairingCodeExpiresLabel?: string;
  pairingCodeExpiredLabel?: string;
  pairingEnterCodeLabel?: string;
  pairingEnterCodeDescriptionLabel?: string;
  pairingSubmitLabel?: string;
  pairingBadgePairedLabel?: string;
  pairingBadgeExpiredLabel?: string;
  pairingUnpairLabel?: string;
  pairingUnpairConfirmLabel?: string;
  pairingRepairLabel?: string;
  pairingPairButtonLabel?: string;
  pairingNotPairedLabel?: string;
  onEnabledChange: (enabled: boolean) => void;
  onAutoSyncChange: (enabled: boolean) => void;
  onSyncIntervalChange: (hours: number) => void;
  onForcedRoleChange: (role: string) => void;
  onManualPing: (ip: string, port: number) => Promise<LanPeer | null>;
  onSyncWithPeer: (peer: LanPeer) => void;
  onFullSyncWithPeer?: (peer: LanPeer) => void;
  onForceSyncWithPeer?: (peer: LanPeer) => void;
}

function PairCodeDialog({
  peer,
  onSubmit,
  buttonLabel,
  buttonVariant = 'outline',
  buttonClassName = '',
  dialogTitle,
  dialogDescription,
  submitLabel,
}: {
  peer: LanPeer;
  onSubmit: (peer: LanPeer, code: string) => Promise<void>;
  buttonLabel: string;
  buttonVariant?: 'outline' | 'ghost' | 'default';
  buttonClassName?: string;
  dialogTitle: string;
  dialogDescription: string;
  submitLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleDigitChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newDigits = [...digits];
    newDigits[index] = value.slice(-1);
    setDigits(newDigits);
    setError(null);
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setDigits(pasted.split(''));
      inputRefs.current[5]?.focus();
    }
  };

  const handleSubmit = async () => {
    const code = digits.join('');
    if (code.length !== 6) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(peer, code);
      setOpen(false);
      setDigits(['', '', '', '', '', '']);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={buttonVariant}
        size="sm"
        className={`h-7 px-2.5 text-xs ${buttonClassName}`}
        onClick={() => {
          setOpen(true);
          setDigits(['', '', '', '', '', '']);
          setError(null);
          setTimeout(() => inputRefs.current[0]?.focus(), 100);
        }}
      >
        <Shield className="size-3 mr-1" />
        {buttonLabel}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold mb-1">{dialogTitle}</h3>
            <p className="text-sm text-muted-foreground mb-4">{dialogDescription}</p>
            <div className="flex justify-center gap-2 mb-4" onPaste={handlePaste}>
              {digits.map((digit, i) => (
                <input
                  key={`pin-digit-${i}`}
                  ref={(el) => { inputRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleDigitChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  className="w-10 h-12 text-center text-xl font-mono font-bold bg-background border border-border rounded-md focus:border-primary focus:outline-none"
                />
              ))}
            </div>
            {error && <p className="text-sm text-destructive mb-3">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void handleSubmit()}
                disabled={submitting || digits.some(d => !d)}
              >
                {submitting ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
                {submitLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
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
  slaveInfoText,
  showLogLabel,
  hideLogLabel,
  noLogEntriesText,
  firewallHintTitle,
  firewallHintDescription,
  forceMergeTooltip,
  pairedDeviceIds,
  pairingExpiredDeviceIds,
  pairingCode,
  pairingCodeRemaining,
  onGeneratePairingCode,
  onPairWithPeer,
  onUnpairDevice,
  pairingGenerateCodeLabel,
  pairingCodeLabel,
  pairingCodeExpiresLabel,
  pairingCodeExpiredLabel,
  pairingEnterCodeLabel,
  pairingEnterCodeDescriptionLabel,
  pairingSubmitLabel,
  pairingBadgePairedLabel,
  pairingBadgeExpiredLabel,
  pairingUnpairLabel,
  pairingUnpairConfirmLabel,
  pairingRepairLabel,
  pairingPairButtonLabel,
  pairingNotPairedLabel,
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

  // Flash "just paired" confirmation per device_id (shown for 4 seconds after pairing)
  const [justPairedIds, setJustPairedIds] = useState<Set<string>>(new Set());

  // Wrap onPairWithPeer to trigger the "just paired" flash
  const handlePairWithFlash = async (peer: LanPeer, code: string) => {
    if (!onPairWithPeer) return;
    await onPairWithPeer(peer, code);
    // Show confirmation flash for this peer
    setJustPairedIds(prev => new Set([...prev, peer.device_id]));
    setTimeout(() => {
      setJustPairedIds(prev => {
        const next = new Set(prev);
        next.delete(peer.device_id);
        return next;
      });
    }, 4000);
  };

  // Context menu state for right-click on sync button
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    peer: LanPeer;
  } | null>(null);

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

  return (
    <Card className="relative">
      {/* Sync progress overlay is handled globally by DaemonSyncOverlay */}

      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Wifi className="size-4 text-sky-400" />
          {title}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
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
              {new Date(latestMarker.created_at).toLocaleString()}, {latestMarker.device_id}
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
                  <Loader2 className="size-3 animate-spin mr-1" />
                ) : (
                  <Search className="size-3 mr-1" />
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

          {/* Pairing code generation — master side only */}
          {onGeneratePairingCode && !isSlave && (
            <div className="flex items-center gap-3 rounded-md border border-border/50 bg-background/20 p-3">
              {pairingCode ? (
                <div className="flex items-center gap-4 w-full">
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">{pairingCodeLabel ?? 'Pairing code'}</span>
                    <span className="text-2xl font-mono font-bold tracking-[0.3em]">{pairingCode}</span>
                  </div>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {pairingCodeRemaining && pairingCodeRemaining > 0
                      ? (pairingCodeExpiresLabel ?? 'Expires in {{seconds}}s').replace('{{seconds}}', String(pairingCodeRemaining))
                      : pairingCodeExpiredLabel ?? 'Code expired'}
                  </span>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onGeneratePairingCode}
                >
                  <Shield className="size-3 mr-1.5" />
                  {pairingGenerateCodeLabel ?? 'Generate pairing code'}
                </Button>
              )}
            </div>
          )}

          {peers.length === 0 ? (
            <>
              <p className="text-xs text-muted-foreground">{noPeersText}</p>
              {settings.enabled && (
                <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                  <div className="flex items-start gap-2">
                    <Shield className="size-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-300/80 space-y-1">
                      <p className="font-medium">{firewallHintTitle ?? 'No visible peers — check your firewall'}</p>
                      <p>{firewallHintDescription ?? 'If the daemon did not have administrator privileges, firewall rules may not have been added. Add them manually:'}</p>
                      <pre className="text-[10px] bg-black/20 rounded p-1.5 overflow-x-auto whitespace-pre-wrap">
{`netsh advfirewall firewall add rule name="TIMEFLOW LAN Discovery" dir=in action=allow protocol=UDP localport=47892
netsh advfirewall firewall add rule name="TIMEFLOW LAN Server" dir=in action=allow protocol=TCP localport=47891`}
                      </pre>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2">
              {peers.map((peer) => {
                const isPaired = pairedDeviceIds?.has(peer.device_id);
                const isPairingExpired = pairingExpiredDeviceIds?.has(peer.device_id);
                const needsPairing = onPairWithPeer && !isPaired;
                const canSync = (isPaired && !isPairingExpired) || !onPairWithPeer;

                return (
                  <div
                    key={peer.device_id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border/50 bg-background/20 p-2.5"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Monitor className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {peer.machine_name}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {peer.ip}:{peer.dashboard_port}
                        </p>
                      </div>
                      {/* Connection status badge */}
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
                      {/* Pairing status icon */}
                      {isPaired && !isPairingExpired && (
                        <span className="ml-1.5 flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium" title={pairingBadgePairedLabel ?? 'paired'}>
                          <ShieldCheck className="size-3.5" />
                          {pairingBadgePairedLabel ?? 'paired'}
                        </span>
                      )}
                      {isPairingExpired && (
                        <span className="ml-1.5 flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium" title={pairingBadgeExpiredLabel ?? 'pairing expired'}>
                          <ShieldAlert className="size-3.5" />
                          {pairingBadgeExpiredLabel ?? 'pairing expired'}
                        </span>
                      )}
                      {onPairWithPeer && !isPaired && !isPairingExpired && (
                        <span className="ml-1.5 flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-500/10 text-zinc-500 font-medium">
                          <ShieldX className="size-3.5" />
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {/* SLAVE: only Pair / Re-pair buttons (code entry) */}
                      {isSlave && onPairWithPeer && (
                        <>
                          {/* Just-paired success flash */}
                          {justPairedIds.has(peer.device_id) && (
                            <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium animate-pulse">
                              <CheckCircle2 className="size-4" />
                              {pairingBadgePairedLabel ?? 'Paired'}!
                            </span>
                          )}
                          {needsPairing && !isPairingExpired && !justPairedIds.has(peer.device_id) && (
                            <PairCodeDialog
                              peer={peer}
                              onSubmit={handlePairWithFlash}
                              buttonLabel={pairingPairButtonLabel ?? 'Pair'}
                              dialogTitle={pairingEnterCodeLabel ?? 'Enter pairing code'}
                              dialogDescription={pairingEnterCodeDescriptionLabel ?? 'Enter the 6-digit code displayed on the other device.'}
                              submitLabel={pairingSubmitLabel ?? 'Pair'}
                            />
                          )}
                          {isPairingExpired && !justPairedIds.has(peer.device_id) && (
                            <PairCodeDialog
                              peer={peer}
                              onSubmit={handlePairWithFlash}
                              buttonLabel={pairingRepairLabel ?? 'Re-pair'}
                              buttonVariant="outline"
                              buttonClassName="text-amber-400 hover:text-amber-300"
                              dialogTitle={pairingEnterCodeLabel ?? 'Enter pairing code'}
                              dialogDescription={pairingEnterCodeDescriptionLabel ?? 'Enter the 6-digit code displayed on the other device.'}
                              submitLabel={pairingSubmitLabel ?? 'Pair'}
                            />
                          )}
                          {isPaired && !justPairedIds.has(peer.device_id) && onUnpairDevice && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-red-400 hover:text-red-300"
                              onClick={() => {
                                const msg = (pairingUnpairConfirmLabel ?? 'Remove pairing with {{name}}?').replace('{{name}}', peer.machine_name);
                                if (window.confirm(msg)) onUnpairDevice(peer);
                              }}
                            >
                              {pairingUnpairLabel ?? 'Unpair'}
                            </Button>
                          )}
                        </>
                      )}
                      {/* MASTER: sync buttons — only when peer is paired (or pairing not enabled) */}
                      {!isSlave && canSync && (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2.5 text-xs"
                            disabled={isBusy || !peer.dashboard_running}
                            onClick={() => onSyncWithPeer(peer)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setContextMenu({ x: e.clientX, y: e.clientY, peer });
                            }}
                          >
                            {isBusy ? (
                              <Loader2 className="size-3 animate-spin mr-1" />
                            ) : (
                              <RefreshCw className="size-3 mr-1" />
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
                              <Zap className="size-3 mr-1" />
                              {forceSyncButtonLabel ?? 'Force'}
                            </Button>
                          )}
                        </>
                      )}
                      {/* MASTER: peer not paired — show hint */}
                      {!isSlave && !canSync && (
                        <span className="text-[10px] text-muted-foreground italic">
                          {pairingNotPairedLabel ?? 'Not paired — pair this device before syncing'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
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
            <FileText className="size-3 mr-1" />
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

      {/* Context menu for right-click on sync button */}
      {contextMenu && (
        <button
          type="button"
          aria-label="Close context menu"
          className="fixed inset-0 z-[100] cursor-default bg-transparent border-0 p-0"
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
        >
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
          <div
            className="absolute rounded-md border border-border bg-popover shadow-lg py-1 min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
              disabled={isBusy}
              onClick={() => {
                onSyncWithPeer(contextMenu.peer);
                setContextMenu(null);
              }}
            >
              <RefreshCw className="size-3 mr-2 inline" />
              Delta sync
            </button>
            {onFullSyncWithPeer && (
              <button
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                disabled={isBusy}
                onClick={() => {
                  onFullSyncWithPeer(contextMenu.peer);
                  setContextMenu(null);
                }}
              >
                <RefreshCw className="size-3 mr-2 inline" />
                Full sync
              </button>
            )}
            {onForceSyncWithPeer && (
              <button
                className="w-full text-left px-3 py-1.5 text-xs text-amber-400 hover:bg-accent disabled:opacity-50"
                disabled={isBusy}
                onClick={() => {
                  onForceSyncWithPeer(contextMenu.peer);
                  setContextMenu(null);
                }}
              >
                <Zap className="size-3 mr-2 inline" />
                Force sync
              </button>
            )}
          </div>
        </button>
      )}
    </Card>
  );
}

