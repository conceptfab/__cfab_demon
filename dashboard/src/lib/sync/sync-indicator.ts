import i18n from '@/i18n';
import type {
  OnlineSyncIndicatorSnapshot,
  OnlineSyncPendingAck,
  OnlineSyncStatusListener,
  OnlineSyncState,
} from '@/lib/online-sync-types';
import {
  loadOnlineSyncSettings,
  loadOnlineSyncState,
} from '@/lib/sync/sync-state';

const onlineSyncStatusListeners = new Set<OnlineSyncStatusListener>();
let onlineSyncIndicatorSnapshotCache: OnlineSyncIndicatorSnapshot | null = null;

function syncIndicatorT(
  key: string,
  interpolation?: Record<string, string | number | null>,
): string {
  return i18n.t(key, interpolation);
}

function shortHash(hash: string | null): string {
  return hash ? `${hash.slice(0, 8)}...` : 'n/a';
}

function buildSnapshot(
  state: OnlineSyncState,
  overrides: Partial<OnlineSyncIndicatorSnapshot> &
    Pick<OnlineSyncIndicatorSnapshot, 'status' | 'label' | 'detail'>,
): OnlineSyncIndicatorSnapshot {
  return {
    serverRevision: state.serverRevision,
    serverHash: state.serverHash,
    lastSyncAt: state.lastSyncAt,
    lastAction: null,
    lastReason: null,
    error: null,
    pendingAck: state.pendingAck,
    needsReseed: state.needsReseed,
    ...overrides,
  };
}

function arePendingAcksEqual(
  left: OnlineSyncPendingAck | null,
  right: OnlineSyncPendingAck | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.revision === right.revision &&
    left.payloadSha256 === right.payloadSha256 &&
    left.createdAt === right.createdAt &&
    left.retries === right.retries &&
    (left.lastError ?? null) === (right.lastError ?? null)
  );
}

function areIndicatorSnapshotsEqual(
  left: OnlineSyncIndicatorSnapshot | null,
  right: OnlineSyncIndicatorSnapshot,
): boolean {
  if (!left) return false;
  return (
    left.status === right.status &&
    left.label === right.label &&
    left.detail === right.detail &&
    left.serverRevision === right.serverRevision &&
    left.serverHash === right.serverHash &&
    left.lastSyncAt === right.lastSyncAt &&
    left.lastAction === right.lastAction &&
    left.lastReason === right.lastReason &&
    left.error === right.error &&
    left.needsReseed === right.needsReseed &&
    arePendingAcksEqual(left.pendingAck, right.pendingAck)
  );
}

function formatLastSyncDetail(state: OnlineSyncState): string {
  if (!state.lastSyncAt) {
    return syncIndicatorT('online_sync_indicator.details.no_sync_yet');
  }
  const timestamp = new Date(state.lastSyncAt);
  const timeLabel = Number.isNaN(timestamp.getTime())
    ? state.lastSyncAt
    : timestamp.toLocaleTimeString();
  return syncIndicatorT('online_sync_indicator.details.last_sync', {
    time: timeLabel,
    revision: state.serverRevision,
    hash: shortHash(state.serverHash),
  });
}

function formatPendingAckDetail(state: OnlineSyncState): string {
  if (!state.pendingAck) {
    return syncIndicatorT('online_sync_indicator.details.ack_pending');
  }
  const pending = state.pendingAck;
  if (pending.retries > 0) {
    return syncIndicatorT(
      'online_sync_indicator.details.downloaded_waiting_ack_retries',
      {
        revision: pending.revision,
        count: pending.retries,
      },
    );
  }
  return syncIndicatorT(
    'online_sync_indicator.details.downloaded_waiting_ack',
    {
      revision: pending.revision,
    },
  );
}

function buildIndicatorSnapshotFromStorage(): OnlineSyncIndicatorSnapshot {
  const settings = loadOnlineSyncSettings();
  const state = loadOnlineSyncState(settings);

  if (!settings.enabled) {
    return buildSnapshot(state, {
      status: 'disabled',
      label: syncIndicatorT('online_sync_indicator.labels.disabled'),
      detail: syncIndicatorT('online_sync_indicator.details.disabled'),
    });
  }

  if (!settings.serverUrl || !settings.userId) {
    return buildSnapshot(state, {
      status: 'unconfigured',
      label: syncIndicatorT('online_sync_indicator.labels.setup'),
      detail: syncIndicatorT('online_sync_indicator.details.configure'),
    });
  }

  if (state.needsReseed) {
    return buildSnapshot(state, {
      status: 'error',
      label: syncIndicatorT('online_sync_indicator.labels.reseed_required'),
      detail: syncIndicatorT(
        'online_sync_indicator.details.reseed_required',
      ),
      lastReason: 'server_snapshot_pruned',
      error: 'server_snapshot_pruned',
    });
  }

  if (state.pendingAck) {
    return buildSnapshot(state, {
      status: 'warning',
      label: syncIndicatorT('online_sync_indicator.labels.ack_pending'),
      detail: formatPendingAckDetail(state),
      lastReason: 'pending_ack',
    });
  }

  return buildSnapshot(state, {
    status: 'idle',
    label: syncIndicatorT('online_sync_indicator.labels.ready'),
    detail: formatLastSyncDetail(state),
  });
}

function emitOnlineSyncIndicatorSnapshot(
  snapshot: OnlineSyncIndicatorSnapshot,
): void {
  if (areIndicatorSnapshotsEqual(onlineSyncIndicatorSnapshotCache, snapshot)) {
    return;
  }
  onlineSyncIndicatorSnapshotCache = snapshot;
  for (const listener of onlineSyncStatusListeners) {
    listener(snapshot);
  }
}

export function refreshIndicatorFromStorage(): void {
  emitOnlineSyncIndicatorSnapshot(buildIndicatorSnapshotFromStorage());
}

export function getOnlineSyncIndicatorSnapshot(): OnlineSyncIndicatorSnapshot {
  if (!onlineSyncIndicatorSnapshotCache) {
    onlineSyncIndicatorSnapshotCache = buildIndicatorSnapshotFromStorage();
  }
  return onlineSyncIndicatorSnapshotCache;
}

export function subscribeOnlineSyncIndicator(
  listener: OnlineSyncStatusListener,
): () => void {
  onlineSyncStatusListeners.add(listener);
  listener(getOnlineSyncIndicatorSnapshot());
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    onlineSyncStatusListeners.delete(listener);
  };
}
