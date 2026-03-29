export interface LanSyncSettings {
  enabled: boolean;
  serverPort: number;
  autoSyncOnPeerFound: boolean;
}

export interface LanPeer {
  device_id: string;
  machine_name: string;
  ip: string;
  dashboard_port: number;
  last_seen: string;
  dashboard_running: boolean;
}

export interface LanSyncState {
  peers: LanPeer[];
  lastSyncAt: string | null;
  lastSyncPeerId: string | null;
  peerSyncTimes?: Record<string, string>;
}

export interface LanSyncResult {
  ok: boolean;
  action: string;
  pulled: boolean;
  pushed: boolean;
  import_summary: LanImportSummary | null;
  error: string | null;
}

export interface LanImportSummary {
  projects_merged: number;
  apps_merged: number;
  sessions_merged: number;
  manual_sessions_merged: number;
  tombstones_applied: number;
}

export interface LanServerStatus {
  running: boolean;
  port: number | null;
}

export const LAN_SYNC_SETTINGS_KEY = 'timeflow.settings.lan-sync';
export const LAN_SYNC_STATE_KEY = 'timeflow.state.lan-sync';
export const LAN_SYNC_SETTINGS_CHANGED_EVENT = 'timeflow:lan-sync-settings-changed';

export const DEFAULT_LAN_SYNC_SETTINGS: LanSyncSettings = {
  enabled: true,
  serverPort: 47891,
  autoSyncOnPeerFound: true,
};
