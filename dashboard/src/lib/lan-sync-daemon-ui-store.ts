import { useEffect, useSyncExternalStore } from 'react';

import { lanSyncApi } from '@/lib/tauri/lan-sync';
import {
  nextDaemonSyncUi,
  type DaemonSyncUiState,
} from '@/lib/lan-sync-daemon-ui';

const IDLE_SNAPSHOT: DaemonSyncUiState = {
  progress: null,
  daemonSyncing: false,
};

let snapshot: DaemonSyncUiState = IDLE_SNAPSHOT;
let pollTimer: number | null = null;
let completedTimer: number | null = null;
let subscriberCount = 0;
let pollIntervalMs = 3000;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function setSnapshot(updater: (prev: DaemonSyncUiState) => DaemonSyncUiState) {
  const next = updater(snapshot);
  if (next === snapshot) return;
  snapshot = next;
  emit();
}

async function pollDaemonSyncUi() {
  try {
    const progress = await lanSyncApi.getLanSyncProgress();

    if (progress.phase === 'completed') {
      setSnapshot((prev) =>
        nextDaemonSyncUi(prev, { progress, daemonSyncing: true }),
      );
      if (!completedTimer) {
        completedTimer = window.setTimeout(() => {
          setSnapshot((prev) =>
            nextDaemonSyncUi(prev, { ...prev, daemonSyncing: false }),
          );
          completedTimer = null;
        }, 3000);
      }
      return;
    }

    if (progress.phase === 'idle' || progress.step === 0) {
      setSnapshot((prev) =>
        nextDaemonSyncUi(prev, {
          progress,
          daemonSyncing: completedTimer ? prev.daemonSyncing : false,
        }),
      );
      return;
    }

    setSnapshot((prev) =>
      nextDaemonSyncUi(prev, { progress, daemonSyncing: true }),
    );
    if (completedTimer) {
      clearTimeout(completedTimer);
      completedTimer = null;
    }
  } catch {
    setSnapshot((prev) =>
      nextDaemonSyncUi(prev, { progress: null, daemonSyncing: false }),
    );
  }
}

function schedulePoll(delayMs = pollIntervalMs) {
  if (pollTimer !== null) clearTimeout(pollTimer);
  pollTimer = window.setTimeout(() => {
    void pollDaemonSyncUi().finally(() => {
      if (subscriberCount > 0) schedulePoll();
    });
  }, delayMs);
}

function startPolling() {
  void pollDaemonSyncUi().finally(() => schedulePoll());
}

function stopPolling() {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (completedTimer !== null) {
    clearTimeout(completedTimer);
    completedTimer = null;
  }
}

function getDaemonSyncUiSnapshot(): DaemonSyncUiState {
  return snapshot;
}

function subscribeDaemonSyncUi(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  subscriberCount += 1;
  if (subscriberCount === 1) startPolling();

  return () => {
    listeners.delete(onStoreChange);
    subscriberCount -= 1;
    if (subscriberCount === 0) stopPolling();
  };
}

function setDaemonSyncPollIntervalMs(nextIntervalMs: number) {
  pollIntervalMs = nextIntervalMs;
}

export function useDaemonSyncUiSnapshot(): DaemonSyncUiState {
  return useSyncExternalStore(
    subscribeDaemonSyncUi,
    getDaemonSyncUiSnapshot,
    getDaemonSyncUiSnapshot,
  );
}

export function useDaemonSyncPollInterval(isBusy: boolean) {
  useEffect(() => {
    setDaemonSyncPollIntervalMs(isBusy ? 600 : 3000);
  }, [isBusy]);
}
