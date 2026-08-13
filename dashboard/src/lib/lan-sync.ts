import type {
  LanPeer,
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

/**
 * Po tylu ms od `last_seen` wpis peera uznajemy za martwy. Lustro
 * `PEER_STALE_AFTER` w `src/lan_discovery.rs` — demon czyści listę co 30 s
 * i zapisuje plik raz na 5 s, więc okno musi być wyraźnie szersze niż jego
 * `PEER_EXPIRY` (120 s), inaczej status miga.
 */
const PEER_STALE_AFTER_MS = 180_000;

/**
 * Czy peer nadaje się do synchronizacji „teraz".
 *
 * NIE opiera się na `dashboard_running`. Ta flaga płynęła z `heartbeat.txt`
 * peera (plik pisany przez pętlę trackera demona, nie przez dashboard) i
 * potrafiła zgasnąć przy jednym zamulonym ticku — a wtedy przyciski Sync w
 * Ustawieniach robiły się `disabled`, master pokazywał „brak peerów", mimo że
 * synchronizacja demon↔demon szła normalnie. Liczy się świeżość `last_seen`:
 * to jedyny sygnał, który przeżywa restart i nie zależy od kondycji trackera.
 */
export function isLanPeerOnline(peer: LanPeer): boolean {
  const seen = Date.parse(peer.last_seen);
  if (Number.isNaN(seen)) return true;
  return Date.now() - seen < PEER_STALE_AFTER_MS;
}

export function recordPeerSync(peer: LanPeer): void {
  const state = loadLanSyncState();
  const now = new Date().toISOString();
  saveLanSyncState({
    ...state,
    lastSyncAt: now,
    lastSyncPeerId: peer.device_id,
    peerSyncTimes: { ...state.peerSyncTimes, [peer.device_id]: now },
  });
}
