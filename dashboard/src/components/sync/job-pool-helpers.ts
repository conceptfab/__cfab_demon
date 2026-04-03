import type { MutableRefObject } from 'react';
import { daemonApi, sessionsApi } from '@/lib/tauri';
import type { TodayFileSignature, MultiProjectAnalysis, SplitPart } from '@/lib/db-types';
import type { OnlineSyncSettings } from '@/lib/online-sync';
import { loadSessionSettings, loadSplitSettings } from '@/lib/user-settings';
import { isAlreadySplitSession } from '@/lib/session-analysis';

export const JOB_LOOP_TICK_MS = 5000;
export const DIAGNOSTICS_REFRESH_MS = 30_000;
export const FILE_SIGNATURE_CHECK_MS = 30_000;
export const AUTO_SPLIT_INTERVAL_MS = 60_000;

const AUTO_SPLIT_THROTTLE_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isDocumentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

export function buildTodayFileSignatureKey(sig: TodayFileSignature): string {
  return `${sig.exists ? 1 : 0}:${sig.modified_unix_ms ?? 'na'}:${sig.size_bytes ?? 'na'}:${sig.revision ?? 'na'}`;
}

function buildAutoSplits(
  analysis: MultiProjectAnalysis,
  maxProjects: number,
): SplitPart[] {
  const candidates = analysis.candidates
    .filter((candidate) => candidate.score > 0)
    .slice(0, Math.max(2, Math.min(5, maxProjects)));

  if (candidates.length < 2) return [];

  const totalScore = candidates.reduce(
    (acc, candidate) => acc + candidate.score,
    0,
  );
  if (totalScore <= 0) return [];

  const raw: SplitPart[] = candidates.map((candidate) => ({
    project_id: candidate.project_id,
    ratio: candidate.score / totalScore,
  }));

  const ratioSum = raw.reduce((acc, part) => acc + part.ratio, 0);
  if (ratioSum > 0 && Math.abs(1 - ratioSum) > 0.000_001) {
    raw.forEach((part) => {
      part.ratio = part.ratio / ratioSum;
    });
  }

  return raw;
}

export async function runAutoSplitCycle(
  runExclusive: <T>(key: string, fn_: () => Promise<T>) => Promise<T | null>,
  operationKey: string,
): Promise<void> {
  const splitSettings = loadSplitSettings();
  if (!splitSettings.autoSplitEnabled) return;

  const minDuration =
    loadSessionSettings().minSessionDurationSeconds || undefined;

  await runExclusive(operationKey, async () => {
    const cycleStartedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const sessions = await sessionsApi.getSessions({
      limit: 50,
      offset: 0,
      unassigned: true,
      includeFiles: false,
      includeAiSuggestions: true,
      minDuration,
    });

    let splitCount = 0;
    let firstIteration = true;
    for (const session of sessions) {
      if (!firstIteration) {
        await sleep(AUTO_SPLIT_THROTTLE_MS);
      }
      firstIteration = false;

      if (isAlreadySplitSession(session)) continue;

      const analysis = await sessionsApi.analyzeSessionProjects(
        session.id,
        splitSettings.toleranceThreshold,
        splitSettings.maxProjectsPerSession,
      );
      if (!analysis.is_splittable) continue;

      const splits = buildAutoSplits(
        analysis,
        splitSettings.maxProjectsPerSession,
      );
      if (splits.length < 2) continue;

      await sessionsApi.splitSessionMulti(session.id, splits, cycleStartedAt);
      splitCount += 1;
      if (splitCount >= 5) break;
    }

    return splitCount;
  });
}

export async function bootstrapJobPool(options: {
  autoImportDone: boolean;
  lastSignatureRef: MutableRefObject<string | null>;
  runRefresh: () => Promise<void>;
}): Promise<void> {
  const { autoImportDone, lastSignatureRef, runRefresh } = options;
  if (!autoImportDone || !isDocumentVisible()) return;

  await runRefresh();

  try {
    const sig = await daemonApi.getTodayFileSignature();
    lastSignatureRef.current = buildTodayFileSignatureKey(sig);
  } catch {
    // Ignore bootstrap signature failures and let the periodic check retry.
  }
}

export function runJobPoolTick(options: {
  autoImportDone: boolean;
  now: number;
  nextDiagnosticsRef: MutableRefObject<number>;
  nextRefreshRef: MutableRefObject<number>;
  nextSigCheckRef: MutableRefObject<number>;
  nextAutoSplitRef: MutableRefObject<number>;
  nextSyncIntervalRef: MutableRefObject<number>;
  nextSyncPollRef: MutableRefObject<number>;
  nextLanSyncRef: MutableRefObject<number>;
  syncSettingsRef: MutableRefObject<OnlineSyncSettings>;
  refreshDiagnostics: () => void | Promise<unknown>;
  runRefresh: () => Promise<void>;
  checkFileChange: () => Promise<void>;
  runAutoSplit: () => Promise<void>;
  runSync: (reason: string, isAuto?: boolean) => Promise<void>;
  runLanSyncInterval: () => Promise<void>;
}): void {
  const {
    autoImportDone,
    now,
    nextDiagnosticsRef,
    nextRefreshRef,
    nextSigCheckRef,
    nextAutoSplitRef,
    nextSyncIntervalRef,
    nextSyncPollRef,
    nextLanSyncRef,
    syncSettingsRef,
    refreshDiagnostics,
    runRefresh,
    checkFileChange,
    runAutoSplit,
    runSync,
    runLanSyncInterval,
  } = options;

  if (autoImportDone && now >= nextAutoSplitRef.current) {
    nextAutoSplitRef.current = now + AUTO_SPLIT_INTERVAL_MS;
    void runAutoSplit();
  }

  if (!isDocumentVisible()) return;

  if (now >= nextDiagnosticsRef.current) {
    nextDiagnosticsRef.current = now + DIAGNOSTICS_REFRESH_MS;
    void refreshDiagnostics();
  }

  if (autoImportDone && now >= nextRefreshRef.current) {
    nextRefreshRef.current = now + 60_000;
    void runRefresh();
  }

  if (autoImportDone && now >= nextSigCheckRef.current) {
    nextSigCheckRef.current = now + FILE_SIGNATURE_CHECK_MS;
    void checkFileChange();
  }

  if (!autoImportDone) return;

  // LAN sync interval (independent of online sync settings)
  if (now >= nextLanSyncRef.current) {
    // Re-schedule will be set by the callback after reading LAN settings
    nextLanSyncRef.current = now + 60_000; // temporary; callback reschedules properly
    void runLanSyncInterval();
  }

  const syncSettings = syncSettingsRef.current;
  if (!syncSettings.enabled) return;

  if (now >= nextSyncIntervalRef.current) {
    nextSyncIntervalRef.current =
      now + Math.max(1, syncSettings.autoSyncIntervalMinutes) * 60_000;
    void runSync('interval');
  }

  if (now >= nextSyncPollRef.current) {
    nextSyncPollRef.current = now + 120_000;
    void runSync('poll');
  }
}

export function createJobPoolEventHandlers(options: {
  autoImportDone: boolean;
  nextDiagnosticsRef: MutableRefObject<number>;
  nextRefreshRef: MutableRefObject<number>;
  nextSigCheckRef: MutableRefObject<number>;
  nextAutoSplitRef: MutableRefObject<number>;
  nextSyncIntervalRef: MutableRefObject<number>;
  nextSyncPollRef: MutableRefObject<number>;
  localChangeRefreshTimer: MutableRefObject<number | null>;
  localChangeSyncTimer: MutableRefObject<number | null>;
  refreshSyncSettingsCache: () => void;
  refreshDiagnostics: () => void | Promise<unknown>;
  refreshDatabaseSettings: () => void | Promise<unknown>;
  runRefresh: () => Promise<void>;
  runSync: (reason: string, isAuto?: boolean) => Promise<void>;
  triggerRefresh: (reason: string) => void;
}) {
  const {
    autoImportDone,
    nextDiagnosticsRef,
    nextRefreshRef,
    nextSigCheckRef,
    nextAutoSplitRef,
    nextSyncIntervalRef,
    nextSyncPollRef,
    localChangeRefreshTimer,
    localChangeSyncTimer,
    refreshSyncSettingsCache,
    refreshDiagnostics,
    refreshDatabaseSettings,
    runRefresh,
    runSync,
    triggerRefresh,
  } = options;

  const handleSyncSettingsChange = () => {
    refreshSyncSettingsCache();
  };

  const handleVisibilityChange = () => {
    refreshSyncSettingsCache();
    if (!isDocumentVisible()) return;

    nextDiagnosticsRef.current = 0;
    void refreshDiagnostics();
    void refreshDatabaseSettings();

    if (!autoImportDone) return;

    nextRefreshRef.current = 0;
    nextSigCheckRef.current = 0;
    nextAutoSplitRef.current = Date.now() + AUTO_SPLIT_INTERVAL_MS;
    nextSyncIntervalRef.current = 0;
    nextSyncPollRef.current = 0;
    void runRefresh();
  };

  const handleLocalDataChange = () => {
    if (!isDocumentVisible()) return;

    void refreshDatabaseSettings();

    if (localChangeRefreshTimer.current) {
      window.clearTimeout(localChangeRefreshTimer.current);
    }
    localChangeRefreshTimer.current = window.setTimeout(
      () => triggerRefresh('background_local_data_changed'),
      120,
    );

    if (!autoImportDone) return;

    if (localChangeSyncTimer.current) {
      window.clearTimeout(localChangeSyncTimer.current);
    }
    localChangeSyncTimer.current = window.setTimeout(() => {
      void runSync('local_change');
    }, 1_500);
  };

  return {
    handleSyncSettingsChange,
    handleVisibilityChange,
    handleLocalDataChange,
  };
}
