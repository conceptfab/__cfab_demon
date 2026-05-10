import {
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

export function useSessionScoreBreakdown({
  sessions,
  showScoreBreakdown,
  viewMode,
}: UseSessionScoreBreakdownOptions) {
  const [scoreBreakdown, setScoreBreakdown] = useState<{
    sessionId: number;
    data: ScoreBreakdown;
  } | null>(null);
  const [aiBreakdowns, setAiBreakdowns] = useState<Map<number, ScoreBreakdown>>(
    new Map(),
  );
  const aiBreakdownsRef = useRef<Map<number, ScoreBreakdown>>(new Map());
  const [loadingBreakdownIds, setLoadingBreakdownIds] = useState<Set<number>>(
    new Set(),
  );
  const scoreBreakdownRequestsRef = useRef<
    Map<number, Promise<ScoreBreakdown>>
  >(new Map());
  const scoreBreakdownCacheRef = useRef<Map<number, CachedBreakdownEntry>>(
    new Map(),
  );

  const getCachedBreakdown = useCallback(
    (sessionId: number): ScoreBreakdown | null => {
      const cached = scoreBreakdownCacheRef.current.get(sessionId);
      if (!cached) return null;
      if (Date.now() - cached.fetchedAtMs > SCORE_BREAKDOWN_CACHE_TTL_MS) {
        scoreBreakdownCacheRef.current.delete(sessionId);
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
      if (!showScoreBreakdown) {
        setLoadingBreakdownIds(new Set());
        return;
      }
      const visibleSessionIds = new Set(sessions.map((session) => session.id));
      setAiBreakdowns((prev) => {
        const next = new Map<number, ScoreBreakdown>();
        prev.forEach((value, sessionId) => {
          if (visibleSessionIds.has(sessionId)) {
            next.set(sessionId, value);
          }
        });
        return next;
      });
      setLoadingBreakdownIds((prev) => {
        const next = new Set<number>();
        prev.forEach((sessionId) => {
          if (visibleSessionIds.has(sessionId)) {
            next.add(sessionId);
          }
        });
        return next;
      });
      if (scoreBreakdown && !visibleSessionIds.has(scoreBreakdown.sessionId)) {
        setScoreBreakdown(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sessions, showScoreBreakdown, scoreBreakdown]);

  const loadScoreBreakdown = useCallback(
    async (sessionId: number): Promise<ScoreBreakdown> => {
      const currentBreakdowns = aiBreakdownsRef.current;
      const cached =
        currentBreakdowns.get(sessionId) ?? getCachedBreakdown(sessionId);
      if (cached) {
        if (!currentBreakdowns.has(sessionId)) {
          setAiBreakdowns((prev) => {
            if (prev.has(sessionId)) return prev;
            const next = new Map(prev);
            next.set(sessionId, cached);
            return next;
          });
        }
        return cached;
      }

      const inFlight = scoreBreakdownRequestsRef.current.get(sessionId);
      if (inFlight) return inFlight;

      setLoadingBreakdownIds((prev) => {
        const next = new Set(prev);
        next.add(sessionId);
        return next;
      });

      const request = withTimeout(
        sessionsApi.getSessionScoreBreakdown(sessionId),
        10_000,
      )
        .then((data) => {
          const cache = scoreBreakdownCacheRef.current;
          cache.set(sessionId, {
            data,
            fetchedAtMs: Date.now(),
          });
          evictOldestEntries(cache, 200);
          setAiBreakdowns((prev) => {
            if (prev.has(sessionId)) return prev;
            const next = new Map(prev);
            next.set(sessionId, data);
            return next;
          });
          return data;
        })
        .catch((error) => {
          logTauriError('load score breakdown', error);
          return EMPTY_SCORE_BREAKDOWN;
        })
        .finally(() => {
          scoreBreakdownRequestsRef.current.delete(sessionId);
          setLoadingBreakdownIds((prev) => {
            const next = new Set(prev);
            next.delete(sessionId);
            return next;
          });
        });

      scoreBreakdownRequestsRef.current.set(sessionId, request);
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
        !aiBreakdownsRef.current.has(sessionId) &&
        !getCachedBreakdown(sessionId) &&
        !scoreBreakdownRequestsRef.current.has(sessionId),
    );
    if (missingIds.length === 0) return;

    let cancelled = false;
    const batchSize = 8;

    const prefetch = async () => {
      for (let index = 0; index < missingIds.length; index += batchSize) {
        if (cancelled) return;
        const batch = missingIds.slice(index, index + batchSize);
        await Promise.allSettled(
          batch.map((sessionId) => loadScoreBreakdown(sessionId)),
        );
      }
    };

    void prefetch();
    return () => {
      cancelled = true;
    };
  }, [breakdownPrefetchIdsKey, getCachedBreakdown, loadScoreBreakdown, viewMode]);

  const handleToggleScoreBreakdown = useCallback(
    async (sessionId: number, event: ReactMouseEvent) => {
      event.stopPropagation();
      if (scoreBreakdown?.sessionId === sessionId) {
        setScoreBreakdown(null);
        return;
      }
      const data = await loadScoreBreakdown(sessionId);
      setScoreBreakdown({ sessionId, data });
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
