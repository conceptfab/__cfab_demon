import {
  CheckCircle2,
  Loader2,
  Monitor,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { LanPeer } from '@/lib/lan-sync-types';

import { LanSyncPairCodeDialog } from './LanSyncPairCodeDialog';
import type {
  LanSyncPeerPairingState,
  LanSyncPeerRowMode,
} from './lan-sync-peer-row-types';

export interface LanSyncPeerRowProps {
  peer: LanPeer;
  mode: LanSyncPeerRowMode;
  pairingState: LanSyncPeerPairingState;
  dashboardRunningLabel: string;
  dashboardOfflineLabel: string;
  syncButtonLabel: string;
  syncingLabel: string;
  fullSyncButtonLabel?: string;
  forceSyncButtonLabel?: string;
  forceMergeTooltip?: string;
  pairingBadgePairedLabel?: string;
  pairingBadgeExpiredLabel?: string;
  pairingPairButtonLabel?: string;
  pairingEnterCodeLabel?: string;
  pairingEnterCodeDescriptionLabel?: string;
  pairingSubmitLabel?: string;
  pairingRepairLabel?: string;
  pairingUnpairLabel?: string;
  pairingUnpairConfirmLabel?: string;
  pairingNotPairedLabel?: string;
  onPairWithPeer?: (peer: LanPeer, code: string) => Promise<void>;
  onUnpairDevice?: (peer: LanPeer) => void;
  onSyncWithPeer: (peer: LanPeer) => void;
  onFullSyncWithPeer?: (peer: LanPeer) => void;
  onForceSyncWithPeer?: (peer: LanPeer) => void;
  onSyncContextMenu: (e: React.MouseEvent, peer: LanPeer) => void;
  handlePairWithFlash: (peer: LanPeer, code: string) => Promise<void>;
}

export function LanSyncPeerRow({
  peer,
  mode,
  pairingState,
  dashboardRunningLabel,
  dashboardOfflineLabel,
  syncButtonLabel,
  syncingLabel,
  fullSyncButtonLabel,
  forceSyncButtonLabel,
  forceMergeTooltip,
  pairingBadgePairedLabel,
  pairingBadgeExpiredLabel,
  pairingPairButtonLabel,
  pairingEnterCodeLabel,
  pairingEnterCodeDescriptionLabel,
  pairingSubmitLabel,
  pairingRepairLabel,
  pairingUnpairLabel,
  pairingUnpairConfirmLabel,
  pairingNotPairedLabel,
  onPairWithPeer,
  onUnpairDevice,
  onSyncWithPeer,
  onFullSyncWithPeer,
  onForceSyncWithPeer,
  onSyncContextMenu,
  handlePairWithFlash,
}: LanSyncPeerRowProps) {
  const { isBusy, isSlave, canSync } = mode;
  const { isPaired, isPairingExpired, justPaired, needsPairing } = pairingState;

  return (
    <div
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
            {justPaired && (
              <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium animate-pulse">
                <CheckCircle2 className="size-4" />
                {pairingBadgePairedLabel ?? 'Paired'}!
              </span>
            )}
            {needsPairing && !isPairingExpired && !justPaired && (
              <LanSyncPairCodeDialog
                peer={peer}
                onSubmit={handlePairWithFlash}
                buttonLabel={pairingPairButtonLabel ?? 'Pair'}
                dialogTitle={pairingEnterCodeLabel ?? 'Enter pairing code'}
                dialogDescription={pairingEnterCodeDescriptionLabel ?? 'Enter the 6-digit code displayed on the other device.'}
                submitLabel={pairingSubmitLabel ?? 'Pair'}
              />
            )}
            {isPairingExpired && !justPaired && (
              <LanSyncPairCodeDialog
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
            {isPaired && !justPaired && onUnpairDevice && (
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
              onContextMenu={(e) => onSyncContextMenu(e, peer)}
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
}
