import { ArrowDownUp, Link2, Wifi } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { AppTooltip } from '@/components/ui/app-tooltip';
import type { SidebarController } from '@/hooks/useSidebarController';

type SidebarLanStatusRowProps = Pick<
  SidebarController,
  | 'goToPage'
  | 'handleLanScan'
  | 'handleLanSync'
  | 'lanIsSlave'
  | 'lanPeer'
  | 'lanPeerPaired'
  | 'lanPeerVersionOk'
  | 'lanScanning'
  | 'lanSyncMessage'
  | 'lanSyncReady'
  | 'lanSyncing'
> & {
  collapsed?: boolean;
};

export function SidebarLanStatusRow({
  collapsed = false,
  goToPage,
  handleLanScan,
  handleLanSync,
  lanIsSlave,
  lanPeer,
  lanPeerPaired,
  lanPeerVersionOk,
  lanScanning,
  lanSyncMessage,
  lanSyncReady,
  lanSyncing,
}: SidebarLanStatusRowProps) {
  const { t } = useTranslation();

  const wifiColor = cn(
    'size-3.5',
    lanSyncing || lanScanning
      ? 'text-amber-400'
      : lanPeer
        ? 'text-sky-400'
        : 'text-muted-foreground/35',
  );

  // W trybie zwiniętym pokazujemy tylko ikonę Wifi (kolor = stan); szczegóły
  // i akcje (parowanie, delta-sync) zostają na pełnej szynie / w ustawieniach.
  if (collapsed) {
    const collapsedStatus =
      lanSyncMessage ??
      (lanPeer
        ? lanPeer.machine_name
        : lanScanning
          ? t('layout.status.lan_scanning')
          : t('layout.status.lan_no_peers'));
    return (
      <AppTooltip
        content={`${t('layout.status.lan')}: ${collapsedStatus}`}
        side="right"
      >
        <button
          type="button"
          aria-label={`${t('layout.status.lan')}: ${collapsedStatus}`}
          onClick={
            !lanPeer && !lanScanning
              ? () => void handleLanScan()
              : () => goToPage('settings')
          }
          className="flex w-full items-center justify-center rounded-md border border-transparent px-0 py-1.5 transition-all hover:bg-accent/40"
        >
          <Wifi className={wifiColor} />
        </button>
      </AppTooltip>
    );
  }

  return (
    <div className="flex w-full items-center gap-0.5 rounded-md p-1">
      <AppTooltip
        content={
          lanPeer
            ? t('layout.tooltips.lan_peer_ip', {
                name: lanPeer.machine_name,
                ip: lanPeer.ip,
              })
            : t('layout.tooltips.lan_click_to_scan')
        }
        side="right"
      >
        <button
          type="button"
          onClick={
            !lanPeer && !lanScanning
              ? () => void handleLanScan()
              : () => goToPage('settings')
          }
          className={cn(
            'flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-all text-[11px] font-medium',
            'hover:bg-accent/40',
          )}
        >
          <Wifi className={wifiColor} />
          <div className="flex min-w-0 flex-col items-start gap-0.5 leading-none">
            <span className="text-[7px] font-bold uppercase tracking-wider text-muted-foreground/45">
              {t('layout.status.lan')}
            </span>
            <span className="truncate text-[10px] text-muted-foreground max-w-[68px]">
              {lanSyncMessage ??
                (lanPeer
                  ? lanPeer.machine_name
                  : lanScanning
                    ? t('layout.status.lan_scanning')
                    : t('layout.status.lan_no_peers'))}
            </span>
          </div>
        </button>
      </AppTooltip>

      <div className="flex items-center gap-0.5 ml-auto">
        <AppTooltip
          content={
            !lanPeer
              ? t('layout.tooltips.lan_readiness_no_peer')
              : !lanPeerPaired
                ? t('layout.tooltips.lan_readiness_not_paired')
                : !lanPeerVersionOk
                  ? t('layout.tooltips.lan_readiness_version_mismatch')
                  : t('layout.tooltips.lan_readiness_ready')
          }
          side="right"
        >
          <div
            className={cn(
              'flex items-center justify-center rounded-md p-1.5 transition-all',
              lanSyncReady
                ? 'text-emerald-500'
                : lanPeer && !lanPeerVersionOk
                  ? 'text-red-400'
                  : lanPeer
                    ? 'text-amber-400'
                    : 'text-muted-foreground/25',
            )}
          >
            <Link2 className="size-3.5" />
          </div>
        </AppTooltip>

        <AppTooltip
          content={
            lanSyncReady && !lanIsSlave
              ? t('layout.tooltips.lan_delta_sync')
              : lanPeer && lanPeerPaired && !lanPeerVersionOk
                ? t('layout.tooltips.lan_readiness_version_mismatch')
                : t('layout.tooltips.lan_delta_sync_disabled')
          }
          side="right"
        >
          <button
            type="button"
            onClick={
              lanSyncReady && !lanIsSlave && !lanSyncing
                ? () => void handleLanSync()
                : undefined
            }
            disabled={!lanSyncReady || lanIsSlave || lanSyncing}
            className={cn(
              'flex items-center justify-center rounded-md p-1.5 transition-all',
              lanSyncReady && !lanIsSlave && !lanSyncing
                ? 'text-sky-400 hover:bg-sky-500/15 hover:text-sky-300 active:scale-90'
                : 'text-muted-foreground/25 cursor-not-allowed',
              lanSyncing && 'animate-pulse text-amber-400',
            )}
          >
            <ArrowDownUp className="size-3.5" />
          </button>
        </AppTooltip>
      </div>
    </div>
  );
}
