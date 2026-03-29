import type {
  LanSyncSettings,
  LanSyncState,
} from './lan-sync-types';
import {
  LAN_SYNC_SETTINGS_KEY,
  LAN_SYNC_STATE_KEY,
  LAN_SYNC_SETTINGS_CHANGED_EVENT,
  DEFAULT_LAN_SYNC_SETTINGS,
} from './lan-sync-types';

export function loadLanSyncSettings(): LanSyncSettings {
  try {
    const raw = localStorage.getItem(LAN_SYNC_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_LAN_SYNC_SETTINGS };
    return { ...DEFAULT_LAN_SYNC_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_LAN_SYNC_SETTINGS };
  }
}

export function saveLanSyncSettings(settings: LanSyncSettings): void {
  localStorage.setItem(LAN_SYNC_SETTINGS_KEY, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent(LAN_SYNC_SETTINGS_CHANGED_EVENT));
}

export function loadLanSyncState(): LanSyncState {
  try {
    const raw = localStorage.getItem(LAN_SYNC_STATE_KEY);
    if (!raw) return { peers: [], lastSyncAt: null, lastSyncPeerId: null };
    return JSON.parse(raw);
  } catch {
    return { peers: [], lastSyncAt: null, lastSyncPeerId: null };
  }
}

export function saveLanSyncState(state: LanSyncState): void {
  localStorage.setItem(LAN_SYNC_STATE_KEY, JSON.stringify(state));
}

export function recordPeerSync(peer: import('./lan-sync-types').LanPeer): void {
  const state = loadLanSyncState();
  const now = new Date().toISOString();
  saveLanSyncState({
    ...state,
    lastSyncAt: now,
    lastSyncPeerId: peer.device_id,
    peerSyncTimes: { ...state.peerSyncTimes, [peer.device_id]: now },
  });
}
