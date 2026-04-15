export interface LanSyncSettings {
  enabled: boolean;
  serverPort: number;
  autoSyncOnPeerFound: boolean;
  syncIntervalHours: number;        // 0 = manual only, 4/8/12/24/48
  discoveryDurationMinutes: number;  // how long to search for peers
  forcedRole: string;               // "" or "auto" = election, "master" / "slave" = forced
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

export interface SyncMarker {
  id: number;
  marker_hash: string;
  created_at: string;
  device_id: string;
  peer_id: string | null;
  tables_hash: string;
  full_sync: boolean;
}

export interface SyncProgress {
  step: number;
  total_steps: number;
  phase: string;
  direction: 'upload' | 'download' | 'local' | 'idle';
  bytes_transferred: number;
  bytes_total: number;
  started_at: number;
  role: string;  // "master" | "slave" | "undecided"
  sync_type?: string;  // "lan" | "online" | ""
}

export const LAN_SYNC_SETTINGS_KEY = 'timeflow.settings.lan-sync';
export const LAN_SYNC_STATE_KEY = 'timeflow.state.lan-sync';
export const LAN_SYNC_SETTINGS_CHANGED_EVENT = 'timeflow:lan-sync-settings-changed';

export interface PairingCodeInfo {
  code: string;
  expires_in_secs: number;
}

export interface PairedDeviceInfo {
  device_id: string;
  machine_name: string;
  paired_at: string;
  /** ISO timestamp of last HTTP 401 observed for this peer. Null/undefined = healthy. */
  last_auth_error_at?: string | null;
}

export const DEFAULT_LAN_SYNC_SETTINGS: LanSyncSettings = {
  enabled: true,
  serverPort: 47891,
  autoSyncOnPeerFound: true,
  syncIntervalHours: 12,
  discoveryDurationMinutes: 5,
  forcedRole: '',
};
