import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  MultiProjectAnalysis,
  SessionWithApp,
} from '@/lib/db-types';
import {
  isAlreadySplitSession,
} from '@/lib/session-analysis';
import { evictOldestEntries, withTimeout } from '@/lib/async-utils';
import { sessionsApi } from '@/lib/tauri';
import type { SplitSettings } from '@/lib/user-settings';

const SPLIT_ANALYSIS_BATCH_SIZE = 25;

interface UseSessionSplitAnalysisOptions {
  multiSplitSession: SessionWithApp | null;
  sessions: SessionWithApp[];
  splitSettings: SplitSettings;
}

export function useSessionSplitAnalysis({
  multiSplitSession,
  sessions,
  splitSettings,
}: UseSessionSplitAnalysisOptions) {
  const [splitEligibilityBySession, setSplitEligibilityBySession] = useState<
    Map<number, boolean>
  >(new Map());
  const [splitAnalysisBySession, setSplitAnalysisBySession] = useState<
    Map<number, MultiProjectAnalysis>
  >(new Map());
  const [splitAnalysisLoadingIds, setSplitAnalysisLoadingIds] = useState<
    Set<number>
  >(new Set());
  const splitEligibilityCacheRef = useRef<Map<number, string>>(new Map());
  const splitAnalysisBatchTimerRef = useRef<number | null>(null);
  const splitSettingsKey = `${splitSettings.toleranceThreshold}:${splitSettings.maxProjectsPerSession}`;

  const clearSplitCaches = useCallback(() => {
    splitEligibilityCacheRef.current.clear();
    setSplitEligibilityBySession(new Map());
    setSplitAnalysisBySession(new Map());
    setSplitAnalysisLoadingIds(new Set());
  }, []);

  useEffect(() => {
    if (!multiSplitSession) return;
    const sessionId = multiSplitSession.id;
    if (splitAnalysisBySession.has(sessionId)) return;
    if (splitAnalysisLoadingIds.has(sessionId)) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setSplitAnalysisLoadingIds((prev) => {
        const next = new Set(prev);
        next.add(sessionId);
        return next;
      });
    });

    void withTimeout(
      sessionsApi.analyzeSessionProjects(
        sessionId,
        splitSettings.toleranceThreshold,
        splitSettings.maxProjectsPerSession,
      ),
      12_000,
    )
      .then((analysis) => {
        if (cancelled) return;
        setSplitAnalysisBySession((prev) => {
          const next = new Map(prev);
          next.set(sessionId, analysis);
          return next;
        });
      })
      .catch((error) => {
        console.warn(
          `Failed to analyze split candidates for session ${sessionId}:`,
          error,
        );
        if (cancelled) return;
        setSplitAnalysisBySession((prev) => {
          if (prev.has(sessionId)) return prev;
          const next = new Map(prev);
          next.set(sessionId, {
            session_id: sessionId,
            candidates: [],
            is_splittable: false,
            leader_project_id: null,
            leader_score: 0,
          });
          return next;
        });
      })
      .finally(() => {
        setSplitAnalysisLoadingIds((prev) => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    multiSplitSession,
    splitAnalysisBySession,
    splitAnalysisLoadingIds,
    splitSettings.maxProjectsPerSession,
    splitSettings.toleranceThreshold,
  ]);

  useEffect(() => {
    if (splitAnalysisBatchTimerRef.current !== null) {
      window.clearTimeout(splitAnalysisBatchTimerRef.current);
      splitAnalysisBatchTimerRef.current = null;
    }

    const pendingSessionIds = sessions
      .filter((session) => !isAlreadySplitSession(session))
      .map((session) => session.id)
      .filter(
        (sessionId) =>
          splitEligibilityCacheRef.current.get(sessionId) !== splitSettingsKey,
      );

    if (pendingSessionIds.length === 0) {
      return;
    }

    let cancelled = false;
    const runBatch = (offset: number) => {
      const batch = pendingSessionIds.slice(
        offset,
        offset + SPLIT_ANALYSIS_BATCH_SIZE,
      );
      if (batch.length === 0) {
        splitAnalysisBatchTimerRef.current = null;
        return;
      }

      void sessionsApi
        .analyzeSessionsSplittable(
          batch,
          splitSettings.toleranceThreshold,
          splitSettings.maxProjectsPerSession,
        )
        .then((flags) => {
          if (cancelled) return;
          const splitFlagsBySession = new Map(
            flags.map((flag) => [flag.session_id, flag.is_splittable] as const),
          );
          const eligibilityCache = splitEligibilityCacheRef.current;
          batch.forEach((sessionId) => {
            eligibilityCache.set(sessionId, splitSettingsKey);
          });
          evictOldestEntries(eligibilityCache, 200);
          setSplitEligibilityBySession((prev) => {
            const next = new Map(prev);
            let changed = false;
            batch.forEach((sessionId) => {
              const isSplittable = splitFlagsBySession.get(sessionId) ?? false;
              if (next.get(sessionId) !== isSplittable) {
                next.set(sessionId, isSplittable);
                changed = true;
              }
            });
            return changed ? next : prev;
          });
        })
        .catch((error) => {
          batch.forEach((sessionId) => {
            splitEligibilityCacheRef.current.delete(sessionId);
          });
          console.error(error);
        })
        .finally(() => {
          if (cancelled) return;
          const nextOffset = offset + batch.length;
          if (nextOffset >= pendingSessionIds.length) {
            splitAnalysisBatchTimerRef.current = null;
            return;
          }
          splitAnalysisBatchTimerRef.current = window.setTimeout(() => {
            runBatch(nextOffset);
          }, 0);
        });
    };

    splitAnalysisBatchTimerRef.current = window.setTimeout(() => {
      runBatch(0);
    }, 0);

    return () => {
      cancelled = true;
      if (splitAnalysisBatchTimerRef.current !== null) {
        window.clearTimeout(splitAnalysisBatchTimerRef.current);
        splitAnalysisBatchTimerRef.current = null;
      }
    };
  }, [
    sessions,
    splitSettings.maxProjectsPerSession,
    splitSettings.toleranceThreshold,
    splitSettingsKey,
  ]);

  const isSessionSplittable = useCallback(
    (session: SessionWithApp): boolean => {
      if (isAlreadySplitSession(session)) return false;
      return splitEligibilityBySession.get(session.id) ?? false;
    },
    [splitEligibilityBySession],
  );

  const selectedSplitAnalysis = useMemo(
    () =>
      multiSplitSession
        ? (splitAnalysisBySession.get(multiSplitSession.id) ?? null)
        : null,
    [multiSplitSession, splitAnalysisBySession],
  );
  const selectedSplitAnalysisLoading = useMemo(
    () =>
      multiSplitSession
        ? splitAnalysisLoadingIds.has(multiSplitSession.id)
        : false,
    [multiSplitSession, splitAnalysisLoadingIds],
  );

  return {
    clearSplitCaches,
    isSessionSplittable,
    selectedSplitAnalysis,
    selectedSplitAnalysisLoading,
    splitEligibilityBySession,
  };
}
