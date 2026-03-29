import { invoke, invokeMutation } from './core';
import type {
  LanPeer,
  LanSyncResult,
  LanServerStatus,
  SyncMarker,
  SyncProgress,
} from '../lan-sync-types';
import type { TableHashes } from '../online-sync-types';

export const getLanPeers = () =>
  invoke<LanPeer[]>('get_lan_peers');

export const buildTableHashesOnly = () =>
  invoke<TableHashes>('build_table_hashes_only');

export const runLanSync = (peerIp: string, peerPort: number, since: string) =>
  invokeMutation<LanSyncResult>('run_lan_sync', { peerIp, peerPort, since });

export const startLanServer = (port?: number) =>
  invoke<void>('start_lan_server', { port });

export const stopLanServer = () =>
  invoke<void>('stop_lan_server');

export const getLanServerStatus = () =>
  invoke<LanServerStatus>('get_lan_server_status');

export const insertSyncMarker = (tablesHash: string, deviceId: string, peerId?: string, fullSync?: boolean) =>
  invokeMutation<SyncMarker>('insert_sync_marker', { tablesHash, deviceId, peerId, fullSync: fullSync ?? false });

export const getLatestSyncMarker = () =>
  invoke<SyncMarker | null>('get_latest_sync_marker');

export const markersMatch = (remoteMarkerHash?: string | null) =>
  invoke<boolean>('markers_match', { remoteMarkerHash });

export const backupBeforeSync = () =>
  invoke<string>('backup_before_sync');

export const getLanSyncProgress = () =>
  invoke<SyncProgress>('get_lan_sync_progress');

export const lanSyncApi = {
  getLanPeers,
  buildTableHashesOnly,
  runLanSync,
  startLanServer,
  stopLanServer,
  getLanServerStatus,
  insertSyncMarker,
  getLatestSyncMarker,
  markersMatch,
  backupBeforeSync,
  getLanSyncProgress,
} as const;
