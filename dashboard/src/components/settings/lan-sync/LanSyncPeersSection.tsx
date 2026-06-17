import { Loader2, Search, Shield } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { LanSyncCardController } from '@/hooks/useLanSyncCardController';

import { LanSyncPeerRow } from './LanSyncPeerRow';
import type { LanSyncCardProps } from './lan-sync-card-types';

type LanSyncPeersSectionProps = Pick<
  LanSyncCardProps,
  | 'settings'
  | 'peers'
  | 'peersTitle'
  | 'noPeersText'
  | 'lastSyncAt'
  | 'lastSyncResult'
  | 'lastSyncSuccess'
  | 'lastSyncLabel'
  | 'dashboardRunningLabel'
  | 'dashboardOfflineLabel'
  | 'syncButtonLabel'
  | 'syncingLabel'
  | 'fullSyncButtonLabel'
  | 'forceSyncButtonLabel'
  | 'slaveInfoText'
  | 'firewallHintTitle'
  | 'firewallHintDescription'
  | 'forceMergeTooltip'
  | 'pairedDeviceIds'
  | 'pairingExpiredDeviceIds'
  | 'pairingCode'
  | 'pairingCodeRemaining'
  | 'onGeneratePairingCode'
  | 'onPairWithPeer'
  | 'onUnpairDevice'
  | 'pairingGenerateCodeLabel'
  | 'pairingCodeLabel'
  | 'pairingCodeExpiresLabel'
  | 'pairingCodeExpiredLabel'
  | 'pairingEnterCodeLabel'
  | 'pairingEnterCodeDescriptionLabel'
  | 'pairingSubmitLabel'
  | 'pairingBadgePairedLabel'
  | 'pairingBadgeExpiredLabel'
  | 'pairingUnpairLabel'
  | 'pairingUnpairConfirmLabel'
  | 'pairingRepairLabel'
  | 'pairingPairButtonLabel'
  | 'pairingNotPairedLabel'
  | 'onSyncWithPeer'
  | 'onFullSyncWithPeer'
  | 'onForceSyncWithPeer'
> &
  Pick<
    LanSyncCardController,
    | 'isSlave'
    | 'scanning'
    | 'handleScanSubnet'
    | 'isBusy'
    | 'setContextMenu'
    | 'justPairedIds'
    | 'handlePairWithFlash'
  >;

export function LanSyncPeersSection({
  settings,
  peers,
  peersTitle,
  noPeersText,
  lastSyncAt,
  lastSyncResult,
  lastSyncSuccess,
  lastSyncLabel,
  dashboardRunningLabel,
  dashboardOfflineLabel,
  syncButtonLabel,
  syncingLabel,
  fullSyncButtonLabel,
  forceSyncButtonLabel,
  slaveInfoText,
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
  onSyncWithPeer,
  onFullSyncWithPeer,
  onForceSyncWithPeer,
  isSlave,
  scanning,
  handleScanSubnet,
  isBusy,
  setContextMenu,
  justPairedIds,
  handlePairWithFlash,
}: LanSyncPeersSectionProps) {
  return (
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
              <LanSyncPeerRow
                key={peer.device_id}
                peer={peer}
                mode={{
                  isSlave,
                  isBusy,
                  canSync,
                }}
                pairingState={{
                  isPaired,
                  isPairingExpired,
                  needsPairing,
                  justPaired: justPairedIds.has(peer.device_id),
                }}
                dashboardRunningLabel={dashboardRunningLabel}
                dashboardOfflineLabel={dashboardOfflineLabel}
                syncButtonLabel={syncButtonLabel}
                syncingLabel={syncingLabel}
                fullSyncButtonLabel={fullSyncButtonLabel}
                forceSyncButtonLabel={forceSyncButtonLabel}
                forceMergeTooltip={forceMergeTooltip}
                pairingBadgePairedLabel={pairingBadgePairedLabel}
                pairingBadgeExpiredLabel={pairingBadgeExpiredLabel}
                pairingPairButtonLabel={pairingPairButtonLabel}
                pairingEnterCodeLabel={pairingEnterCodeLabel}
                pairingEnterCodeDescriptionLabel={pairingEnterCodeDescriptionLabel}
                pairingSubmitLabel={pairingSubmitLabel}
                pairingRepairLabel={pairingRepairLabel}
                pairingUnpairLabel={pairingUnpairLabel}
                pairingUnpairConfirmLabel={pairingUnpairConfirmLabel}
                pairingNotPairedLabel={pairingNotPairedLabel}
                onPairWithPeer={onPairWithPeer}
                onUnpairDevice={onUnpairDevice}
                onSyncWithPeer={onSyncWithPeer}
                onFullSyncWithPeer={onFullSyncWithPeer}
                onForceSyncWithPeer={onForceSyncWithPeer}
                onSyncContextMenu={(e, p) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, peer: p });
                }}
                handlePairWithFlash={handlePairWithFlash}
              />
            );
          })}
        </div>
      )}

      {lastSyncAt && (
        <div className="pt-2 border-t border-border/50">
          <p className="text-xs text-muted-foreground">
            {lastSyncLabel}{' '}
            <span className="font-mono text-foreground">
              {/* eslint-disable-next-line react-doctor/rendering-hydration-mismatch-time -- No SSR (Tauri client app) */}
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
  );
}
