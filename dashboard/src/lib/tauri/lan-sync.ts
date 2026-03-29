import { invoke, invokeMutation } from './core';
import type {
  LanPeer,
  LanSyncResult,
  LanServerStatus,
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

export const lanSyncApi = {
  getLanPeers,
  buildTableHashesOnly,
  runLanSync,
  startLanServer,
  stopLanServer,
  getLanServerStatus,
} as const;
