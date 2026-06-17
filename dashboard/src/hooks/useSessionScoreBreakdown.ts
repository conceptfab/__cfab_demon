import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import type { ScoreBreakdown, SessionWithApp } from '@/lib/db-types';
import {
  EMPTY_SCORE_BREAKDOWN,
  isAlreadySplitSession,
} from '@/lib/session-analysis';
import { evictOldestEntries, withTimeout } from '@/lib/async-utils';
import { sessionsApi } from '@/lib/tauri';
import { logTauriError } from '@/lib/utils';

const SCORE_BREAKDOWN_CACHE_TTL_MS = 5 * 60 * 1000;

type CachedBreakdownEntry = {
  data: ScoreBreakdown;
  fetchedAtMs: number;
};

interface UseSessionScoreBreakdownOptions {
  sessions: SessionWithApp[];
  showScoreBreakdown: boolean;
  viewMode: 'detailed' | 'compact' | 'ai_detailed';
}

type BreakdownUiState = {
  scoreBreakdown: {
    sessionId: number;
    data: ScoreBreakdown;
  } | null;
  aiBreakdowns: Map<number, ScoreBreakdown>;
  loadingBreakdownIds: Set<number>;
};

const emptyBreakdownUiState = (): BreakdownUiState => ({
  scoreBreakdown: null,
  aiBreakdowns: new Map(),
  loadingBreakdownIds: new Set(),
});

function pruneBreakdownUiToVisibleSessions(
  prev: BreakdownUiState,
  sessions: SessionWithApp[],
  showScoreBreakdown: boolean,
): BreakdownUiState {
  if (!showScoreBreakdown) {
    return {
      ...prev,
      aiBreakdowns: new Map(),
      loadingBreakdownIds: new Set(),
      scoreBreakdown: null,
    };
  }

  const visibleSessionIds = new Set(sessions.map((session) => session.id));
  const aiBreakdowns = new Map<number, ScoreBreakdown>();
  prev.aiBreakdowns.forEach((value, sessionId) => {
    if (visibleSessionIds.has(sessionId)) {
      aiBreakdowns.set(sessionId, value);
    }
  });

  const loadingBreakdownIds = new Set<number>();
  prev.loadingBreakdownIds.forEach((sessionId) => {
    if (visibleSessionIds.has(sessionId)) {
      loadingBreakdownIds.add(sessionId);
    }
  });

  const scoreBreakdown =
    prev.scoreBreakdown &&
    !visibleSessionIds.has(prev.scoreBreakdown.sessionId)
      ? null
      : prev.scoreBreakdown;

  return { aiBreakdowns, loadingBreakdownIds, scoreBreakdown };
}

export function useSessionScoreBreakdown({
  sessions,
  showScoreBreakdown,
  viewMode,
}: UseSessionScoreBreakdownOptions) {
  const [breakdownUi, setBreakdownUi] = useState<BreakdownUiState>(
    emptyBreakdownUiState,
  );
  const { scoreBreakdown, aiBreakdowns, loadingBreakdownIds } = breakdownUi;
  const aiBreakdownsRef = useRef<Map<number, ScoreBreakdown> | null>(null);
  const scoreBreakdownRequestsRef = useRef<
    Map<number, Promise<ScoreBreakdown>>
  | null>(null);
  const scoreBreakdownCacheRef = useRef<Map<number, CachedBreakdownEntry> | null>(
    null,
  );
  if (aiBreakdownsRef.current == null) aiBreakdownsRef.current = new Map();
  if (scoreBreakdownRequestsRef.current == null) scoreBreakdownRequestsRef.current = new Map();
  if (scoreBreakdownCacheRef.current == null) scoreBreakdownCacheRef.current = new Map();

  const getCachedBreakdown = useCallback(
    (sessionId: number): ScoreBreakdown | null => {
      const cached = scoreBreakdownCacheRef.current!.get(sessionId);
      if (!cached) return null;
      if (Date.now() - cached.fetchedAtMs > SCORE_BREAKDOWN_CACHE_TTL_MS) {
        scoreBreakdownCacheRef.current!.delete(sessionId);
        return null;
      }
      return cached.data;
    },
    [],
  );

  useEffect(() => {
    aiBreakdownsRef.current = aiBreakdowns;
  }, [aiBreakdowns]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      startTransition(() => {
        setBreakdownUi((prev) =>
          pruneBreakdownUiToVisibleSessions(prev, sessions, showScoreBreakdown),
        );
      });
    });
    return () => {
      cancelled = true;
    };
  }, [sessions, showScoreBreakdown]);

  const loadScoreBreakdown = useCallback(
    async (sessionId: number): Promise<ScoreBreakdown> => {
      const currentBreakdowns = aiBreakdownsRef.current!;
      const cached =
        currentBreakdowns.get(sessionId) ?? getCachedBreakdown(sessionId);
      if (cached) {
        if (!currentBreakdowns.has(sessionId)) {
          setBreakdownUi((prev) => {
            if (prev.aiBreakdowns.has(sessionId)) return prev;
            const nextAiBreakdowns = new Map(prev.aiBreakdowns);
            nextAiBreakdowns.set(sessionId, cached);
            return { ...prev, aiBreakdowns: nextAiBreakdowns };
          });
        }
        return cached;
      }

      const inFlight = scoreBreakdownRequestsRef.current!.get(sessionId);
      if (inFlight) return inFlight;

      setBreakdownUi((prev) => {
        const nextLoading = new Set(prev.loadingBreakdownIds);
        nextLoading.add(sessionId);
        return { ...prev, loadingBreakdownIds: nextLoading };
      });

      const request = withTimeout(
        sessionsApi.getSessionScoreBreakdown(sessionId),
        10_000,
      )
        .then((data) => {
          const cache = scoreBreakdownCacheRef.current!;
          cache.set(sessionId, {
            data,
            fetchedAtMs: Date.now(),
          });
          evictOldestEntries(cache, 200);
          setBreakdownUi((prev) => {
            if (prev.aiBreakdowns.has(sessionId)) return prev;
            const nextAiBreakdowns = new Map(prev.aiBreakdowns);
            nextAiBreakdowns.set(sessionId, data);
            return { ...prev, aiBreakdowns: nextAiBreakdowns };
          });
          return data;
        })
        .catch((error) => {
          logTauriError('load score breakdown', error);
          return EMPTY_SCORE_BREAKDOWN;
        })
        .finally(() => {
          scoreBreakdownRequestsRef.current!.delete(sessionId);
          setBreakdownUi((prev) => {
            const nextLoading = new Set(prev.loadingBreakdownIds);
            nextLoading.delete(sessionId);
            return { ...prev, loadingBreakdownIds: nextLoading };
          });
        });

      scoreBreakdownRequestsRef.current!.set(sessionId, request);
      return request;
    },
    [getCachedBreakdown],
  );

  const breakdownPrefetchIdsKey = useMemo(
    () =>
      sessions
        .reduce<number[]>((acc, session) => {
          if (!isAlreadySplitSession(session)) acc.push(session.id);
          return acc;
        }, [])
        .join(','),
    [sessions],
  );

  useEffect(() => {
    if (viewMode !== 'ai_detailed') return;

    const sessionIds = breakdownPrefetchIdsKey
      ? breakdownPrefetchIdsKey.split(',').reduce<number[]>((acc, value) => {
          const n = Number(value);
          if (Number.isFinite(n)) acc.push(n);
          return acc;
        }, [])
      : [];
    if (sessionIds.length === 0) return;

    const missingIds = sessionIds.filter(
      (sessionId) =>
        !aiBreakdownsRef.current!.has(sessionId) &&
        !getCachedBreakdown(sessionId) &&
        !scoreBreakdownRequestsRef.current!.has(sessionId),
    );
    if (missingIds.length === 0) return;

    let cancelled = false;
    const batchSize = 8;

    const prefetchBatch = async (startIndex: number): Promise<void> => {
      if (cancelled || startIndex >= missingIds.length) return;
      const batch = missingIds.slice(startIndex, startIndex + batchSize);
      await Promise.allSettled(
        batch.map((sessionId) => loadScoreBreakdown(sessionId)),
      );
      return prefetchBatch(startIndex + batchSize);
    };

    void prefetchBatch(0);
    return () => {
      cancelled = true;
    };
  }, [breakdownPrefetchIdsKey, getCachedBreakdown, loadScoreBreakdown, viewMode]);

  const handleToggleScoreBreakdown = useCallback(
    async (sessionId: number, event: ReactMouseEvent) => {
      event.stopPropagation();
      if (scoreBreakdown?.sessionId === sessionId) {
        setBreakdownUi((prev) => ({ ...prev, scoreBreakdown: null }));
        return;
      }
      const data = await loadScoreBreakdown(sessionId);
      setBreakdownUi((prev) => ({
        ...prev,
        scoreBreakdown: { sessionId, data },
      }));
    },
    [loadScoreBreakdown, scoreBreakdown],
  );

  const getScoreBreakdownData = useCallback(
    (sessionId: number) =>
      aiBreakdowns.get(sessionId) ??
      (scoreBreakdown?.sessionId === sessionId ? scoreBreakdown.data : null),
    [aiBreakdowns, scoreBreakdown],
  );

  return {
    aiBreakdowns,
    getScoreBreakdownData,
    handleToggleScoreBreakdown,
    loadingBreakdownIds,
    scoreBreakdown,
  };
}
