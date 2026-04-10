import { invoke, invokeMutation } from './core';
import type {
  LanPeer,
  LanSyncResult,
  LanServerStatus,
  SyncMarker,
  SyncProgress,
  PairingCodeInfo,
  PairedDeviceInfo,
} from '../lan-sync-types';
import type { TableHashes } from '../online-sync-types';

export const getLanPeers = () =>
  invoke<LanPeer[]>('get_lan_peers');

export const getLocalIps = () =>
  invoke<string[]>('get_local_ips');

export interface PingLanPeerResult {
  device_id: string;
  machine_name: string;
  ip: string;
  dashboard_port: number;
  role: string;
  version: string;
}

export const pingLanPeer = (ip: string, port: number) =>
  invoke<PingLanPeerResult>('ping_lan_peer', { ip, port });

export const scanLanSubnet = () =>
  invoke<PingLanPeerResult[]>('scan_lan_subnet');

export const buildTableHashesOnly = () =>
  invoke<TableHashes>('build_table_hashes_only');

export const runLanSync = (peerIp: string, peerPort: number, since: string, force?: boolean) =>
  invokeMutation<LanSyncResult>('run_lan_sync', { peerIp, peerPort, since, force: force ?? false });

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

export const upsertLanPeer = (peer: LanPeer) =>
  invokeMutation<void>('upsert_lan_peer', { peer });

export const getLanSyncLog = (lines?: number) =>
  invoke<string>('get_lan_sync_log', { lines: lines ?? 30 });

export const getLanSyncProgress = () =>
  invoke<SyncProgress>('get_lan_sync_progress');

export const generatePairingCode = () =>
  invokeMutation<PairingCodeInfo>('generate_pairing_code');

export const submitPairingCode = (peerIp: string, peerPort: number, code: string) =>
  invokeMutation<PairedDeviceInfo>('submit_pairing_code', { peerIp, peerPort, code });

export const unpairDevice = (deviceId: string) =>
  invokeMutation<boolean>('unpair_device', { deviceId });

export const getPairedDevices = () =>
  invoke<PairedDeviceInfo[]>('get_paired_devices');

export const lanSyncApi = {
  getLanPeers,
  getLocalIps,
  pingLanPeer,
  scanLanSubnet,
  upsertLanPeer,
  getLanSyncLog,
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
  generatePairingCode,
  submitPairingCode,
  unpairDevice,
  getPairedDevices,
} as const;
