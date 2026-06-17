import type { LanPeer } from '@/lib/lan-sync-types';

export type LanPeerNotificationState = {
  visiblePeer: LanPeer | null;
  incompatPeer: LanPeer | null;
  syncing: boolean;
  syncError: string | null;
  localVersion: string;
};

export const initialLanPeerNotificationState: LanPeerNotificationState = {
  visiblePeer: null,
  incompatPeer: null,
  syncing: false,
  syncError: null,
  localVersion: '',
};

export type LanPeerNotificationAction =
  | { type: 'set_visible_peer'; visiblePeer: LanPeer | null }
  | { type: 'set_incompat_peer'; incompatPeer: LanPeer | null }
  | { type: 'set_syncing'; syncing: boolean }
  | { type: 'set_sync_error'; syncError: string | null }
  | { type: 'set_local_version'; localVersion: string };

export function lanPeerNotificationReducer(
  state: LanPeerNotificationState,
  action: LanPeerNotificationAction,
): LanPeerNotificationState {
  switch (action.type) {
    case 'set_visible_peer':
      return { ...state, visiblePeer: action.visiblePeer };
    case 'set_incompat_peer':
      return { ...state, incompatPeer: action.incompatPeer };
    case 'set_syncing':
      return { ...state, syncing: action.syncing };
    case 'set_sync_error':
      return { ...state, syncError: action.syncError };
    case 'set_local_version':
      return { ...state, localVersion: action.localVersion };
    default:
      return state;
  }
}
