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

type SplitAnalysisUi = {
  eligibilityBySession: Map<number, boolean>;
  analysisBySession: Map<number, MultiProjectAnalysis>;
};

function createEmptySplitAnalysisUi(): SplitAnalysisUi {
  return {
    eligibilityBySession: new Map(),
    analysisBySession: new Map(),
  };
}

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
  const [splitAnalysisUi, setSplitAnalysisUi] = useState<SplitAnalysisUi>(
    createEmptySplitAnalysisUi,
  );
  const {
    eligibilityBySession: splitEligibilityBySession,
    analysisBySession: splitAnalysisBySession,
  } = splitAnalysisUi;
  const modalAnalysisInFlightRef = useRef<number | null>(null);
  const splitEligibilityCacheRef = useRef<Map<number, string>>(undefined!);
  if (splitEligibilityCacheRef.current == null) {
    splitEligibilityCacheRef.current = new Map();
  }
  const splitAnalysisBatchTimerRef = useRef<number | null>(null);
  const splitSettingsKey = `${splitSettings.toleranceThreshold}:${splitSettings.maxProjectsPerSession}`;

  const clearSplitCaches = useCallback(() => {
    splitEligibilityCacheRef.current.clear();
    setSplitAnalysisUi(createEmptySplitAnalysisUi());
  }, []);

  useEffect(() => {
    if (!multiSplitSession) return;
    const sessionId = multiSplitSession.id;
    if (splitAnalysisBySession.has(sessionId)) return;
    if (modalAnalysisInFlightRef.current === sessionId) return;

    let cancelled = false;
    modalAnalysisInFlightRef.current = sessionId;

    void withTimeout(
      sessionsApi.analyzeSessionProjects(
        sessionId,
        splitSettings.toleranceThreshold,
        splitSettings.maxProjectsPerSession,
      ),
      12_000,
    )
      .then(
        (analysis) => ({ analysis }) as const,
        (error) => {
          console.warn(
            `Failed to analyze split candidates for session ${sessionId}:`,
            error,
          );
          return {
            analysis: {
              session_id: sessionId,
              candidates: [],
              is_splittable: false,
              leader_project_id: null,
              leader_score: 0,
            } satisfies MultiProjectAnalysis,
          };
        },
      )
      .then(({ analysis }) => {
        if (cancelled) return;
        setSplitAnalysisUi((prev) => {
          if (prev.analysisBySession.has(sessionId)) return prev;
          const analysisBySession = new Map(prev.analysisBySession);
          analysisBySession.set(sessionId, analysis);
          return { ...prev, analysisBySession };
        });
      })
      .finally(() => {
        if (modalAnalysisInFlightRef.current === sessionId) {
          modalAnalysisInFlightRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    multiSplitSession,
    splitAnalysisBySession,
    splitSettings.maxProjectsPerSession,
    splitSettings.toleranceThreshold,
  ]);

  useEffect(() => {
    if (splitAnalysisBatchTimerRef.current !== null) {
      window.clearTimeout(splitAnalysisBatchTimerRef.current);
      splitAnalysisBatchTimerRef.current = null;
    }

    const pendingSessionIds = sessions.reduce<number[]>((acc, session) => {
      if (
        !isAlreadySplitSession(session) &&
        splitEligibilityCacheRef.current.get(session.id) !== splitSettingsKey
      ) {
        acc.push(session.id);
      }
      return acc;
    }, []);

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
          setSplitAnalysisUi((prev) => {
            const eligibilityBySession = new Map(prev.eligibilityBySession);
            let changed = false;
            batch.forEach((sessionId) => {
              const isSplittable = splitFlagsBySession.get(sessionId) ?? false;
              if (eligibilityBySession.get(sessionId) !== isSplittable) {
                eligibilityBySession.set(sessionId, isSplittable);
                changed = true;
              }
            });
            return changed
              ? { ...prev, eligibilityBySession }
              : prev;
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
        ? !splitAnalysisBySession.has(multiSplitSession.id)
        : false,
    [multiSplitSession, splitAnalysisBySession],
  );

  return {
    clearSplitCaches,
    isSessionSplittable,
    selectedSplitAnalysis,
    selectedSplitAnalysisLoading,
    splitEligibilityBySession,
  };
}
