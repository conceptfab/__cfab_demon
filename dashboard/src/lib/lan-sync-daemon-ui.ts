import type { SyncProgress } from '@/lib/lan-sync-types';

export type DaemonSyncUiState = {
  progress: SyncProgress | null;
  daemonSyncing: boolean;
};

function syncProgressMatches(
  prev: SyncProgress | null | undefined,
  next: SyncProgress,
): boolean {
  return (
    prev?.phase === next.phase &&
    prev?.step === next.step &&
    prev?.role === next.role
  );
}

export function nextDaemonSyncUi(
  prev: DaemonSyncUiState,
  next: DaemonSyncUiState,
): DaemonSyncUiState {
  if (
    prev.progress === next.progress &&
    prev.daemonSyncing === next.daemonSyncing
  ) {
    return prev;
  }
  if (
    prev.progress &&
    next.progress &&
    syncProgressMatches(prev.progress, next.progress) &&
    prev.daemonSyncing === next.daemonSyncing
  ) {
    return prev;
  }
  if (
    !prev.progress &&
    !next.progress &&
    prev.daemonSyncing === next.daemonSyncing
  ) {
    return prev;
  }
  return next;
}
