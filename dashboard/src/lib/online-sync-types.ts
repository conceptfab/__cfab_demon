import type { ExportArchive, ImportSummary } from '@/lib/db-types';

export interface OnlineSyncSettings {
  enabled: boolean;
  autoSyncOnStartup: boolean;
  autoSyncIntervalMinutes: number;
  serverUrl: string;
  userId: string;
  apiToken: string;
  encryptionKey: string;
  deviceId: string;
  requestTimeoutMs: number;
  enableLogging: boolean;
}

export interface TableHashes {
  projects: string;
  applications: string;
  sessions: string;
  manual_sessions: string;
}

export interface DeltaData {
  projects: any[];
  applications: any[];
  sessions: any[];
  manual_sessions: any[];
  tombstones: {
    table_name: string;
    record_id: string;
    record_uuid: string;
    deleted_at: string;
    sync_key: string;
  }[];
}

export interface DeltaArchive {
  version: string;
  since: string;
  is_full: boolean;
  table_hashes: TableHashes;
  data: DeltaData;
}

export interface OnlineSyncPendingAck {
  revision: number;
  payloadSha256: string;
  createdAt: string;
  retries: number;
  lastError?: string;
}

export interface OnlineSyncState {
  serverRevision: number;
  serverHash: string | null;
  localRevision: number | null;
  localHash: string | null;
  pendingAck: OnlineSyncPendingAck | null;
  lastSyncAt: string | null;
  needsReseed: boolean;
}

export interface OnlineSyncRunResult {
  ok: boolean;
  skipped?: boolean;
  action: 'none' | 'push' | 'pull' | 'noop';
  reason: string;
  serverRevision: number | null;
  importSummary?: ImportSummary;
  error?: string;
  ackAccepted?: boolean;
  ackPending?: boolean;
  ackReason?: string | null;
  ackIsLatest?: boolean | null;
  needsReseed?: boolean;
}

export interface RunOnlineSyncOptions {
  ignoreStartupToggle?: boolean;
  /** When true, autoSyncOnStartup=false will block this sync. Only set for the initial startup sync. */
  isStartupSync?: boolean;
  /** When true, skip delta and push full archive regardless of server state. */
  forceFullPush?: boolean;
}

export type OnlineSyncIndicatorStatus =
  | 'disabled'
  | 'unconfigured'
  | 'idle'
  | 'syncing'
  | 'success'
  | 'warning'
  | 'error';

export interface OnlineSyncIndicatorSnapshot {
  status: OnlineSyncIndicatorStatus;
  label: string;
  detail: string;
  serverRevision: number;
  serverHash: string | null;
  lastSyncAt: string | null;
  lastAction: OnlineSyncRunResult['action'] | null;
  lastReason: string | null;
  error: string | null;
  pendingAck: OnlineSyncPendingAck | null;
  needsReseed: boolean;
}

export interface SyncStatusResponse {
  ok: true;
  serverRevision: number;
  serverHash: string | null;
  shouldPush: boolean;
  shouldPull: boolean;
  reason: string;
}

export interface SyncDeltaPushResponse {
  ok: true;
  accepted: boolean;
  revision: number;
  serverTableHashes: TableHashes;
  reason: string;
}

export interface SyncPushResponse {
  ok: true;
  accepted?: boolean;
  noOp: boolean;
  revision: number;
  payloadSha256: string;
  receivedAt?: string;
  reason: string;
}

export interface SyncPullResponse {
  ok: true;
  hasUpdate: boolean;
  revision: number | null;
  payloadSha256: string | null;
  receivedAt: string | null;
  archive?: ExportArchive;
  reason: string;
}

export interface SyncAckResponse {
  ok: true;
  accepted: boolean;
  revision: number;
  payloadSha256: string;
  serverRevision: number;
  serverHash: string | null;
  isLatest: boolean;
  reason: string;
}

export interface OnlineSyncStateEnvelope {
  version: number;
  scopes: Record<string, Partial<OnlineSyncState>>;
}

export interface LocalDatasetState {
  exportOk: boolean;
  hasReseedData: boolean;
  revision: number | null;
  payloadSha256: string | null;
  archive: ExportArchive | DeltaArchive | null;
  tableHashes?: TableHashes | null;
  exportError?: string;
}

export interface FlushPendingAckResult {
  attempted: boolean;
  accepted: boolean;
  pendingRemains: boolean;
  reason: string;
  response?: SyncAckResponse;
  error?: string;
}

export type SyncHttpErrorKind =
  | 'timeout'
  | 'network'
  | 'http'
  | 'invalid_json'
  | 'unknown';

export type OnlineSyncStatusListener = (snapshot: OnlineSyncIndicatorSnapshot) => void;

export interface LicenseActivationResult {
  ok: boolean;
  licenseId?: string;
  plan?: string;
  status?: string;
  groupId?: string;
  groupName?: string;
  deviceId?: string;
  maxDevices?: number;
  activeDevices?: number;
  expiresAt?: string | null;
  error?: string;
  code?: string;
}

export interface LicenseInfo {
  licenseKey: string;
  licenseId: string;
  plan: string;
  status: string;
  groupId: string;
  groupName: string;
  maxDevices: number;
  activeDevices: number;
  expiresAt: string | null;
  activatedAt: string;
}
