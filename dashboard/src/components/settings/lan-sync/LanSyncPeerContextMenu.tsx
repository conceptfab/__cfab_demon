import { RefreshCw, Zap } from 'lucide-react';

import type { LanSyncCardController } from '@/hooks/useLanSyncCardController';

import type { LanSyncCardProps } from './lan-sync-card-types';

type LanSyncPeerContextMenuProps = Pick<
  LanSyncCardProps,
  'onSyncWithPeer' | 'onFullSyncWithPeer' | 'onForceSyncWithPeer'
> &
  Pick<
    LanSyncCardController,
    'contextMenu' | 'setContextMenu' | 'isBusy'
  >;

export function LanSyncPeerContextMenu({
  contextMenu,
  setContextMenu,
  isBusy,
  onSyncWithPeer,
  onFullSyncWithPeer,
  onForceSyncWithPeer,
}: LanSyncPeerContextMenuProps) {
  if (!contextMenu) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close context menu"
        className="fixed inset-0 z-[100] cursor-default bg-transparent border-0 p-0"
        onClick={() => setContextMenu(null)}
        onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
      />
      <div
        role="menu"
        tabIndex={-1}
        aria-label="Peer sync context menu"
        className="fixed z-[101] rounded-md border border-border bg-popover shadow-lg py-1 min-w-[160px]"
        style={{ left: contextMenu.x, top: contextMenu.y }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') setContextMenu(null); }}
      >
        <button type="button"
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
          <button type="button"
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
          <button type="button"
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
    </>
  );
}
