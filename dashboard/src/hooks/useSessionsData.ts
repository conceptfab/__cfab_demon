import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import type { DateRange, SessionWithApp } from '@/lib/db-types';
import { areSessionListsEqual, SESSION_PAGE_SIZE } from '@/lib/session-utils';
import { sessionsApi } from '@/lib/tauri';

type SessionsFetchParams = Parameters<
  (typeof sessionsApi)['getSessions']
>[0];

export function useSessionsData(params: {
  activeDateRange: DateRange;
  buildFetchParams: (offset: number) => SessionsFetchParams;
  reloadVersion: number;
}) {
  const { activeDateRange, buildFetchParams, reloadVersion } = params;
  const [sessions, setSessions] = useState<SessionWithApp[]>([]);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<number>>(
    new Set(),
  );
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sessionsRef = useRef<SessionWithApp[]>([]);
  const hasMoreRef = useRef(false);
  const isLoadingRef = useRef(false);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  const replaceSessionsPage = useCallback((data: SessionWithApp[]) => {
    const nextHasMore = data.length >= SESSION_PAGE_SIZE;
    if (!areSessionListsEqual(sessionsRef.current, data)) {
      sessionsRef.current = data;
      setSessions(data);
    }
    if (hasMoreRef.current !== nextHasMore) {
      hasMoreRef.current = nextHasMore;
      setHasMore(nextHasMore);
    }
  }, []);

  const loadFirstSessionsPage = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    setIsLoading(true);
    setError(null);
    try {
      const data = await sessionsApi.getSessions(buildFetchParams(0));
      replaceSessionsPage(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('Sessions load failed:', msg);
      setError(msg);
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);
    }
  }, [buildFetchParams, replaceSessionsPage]);

  const loadFirstPageRef = useRef(loadFirstSessionsPage);
  loadFirstPageRef.current = loadFirstSessionsPage;

  const handleVisibleSessionsRefresh = useCallback(() => {
    void loadFirstPageRef.current().catch(console.error);
  }, []);

  useEffect(() => {
    let cancelled = false;
    isLoadingRef.current = true;
    setIsLoading(true);
    setError(null);
    sessionsRef.current = [];
    hasMoreRef.current = true;
    sessionsApi
      .getSessions(buildFetchParams(0))
      .then((data) => {
        if (cancelled) return;
        replaceSessionsPage(data);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        console.error('Sessions initial load failed:', msg);
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) {
          isLoadingRef.current = false;
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [buildFetchParams, reloadVersion, replaceSessionsPage]);

  useEffect(() => {
    queueMicrotask(() => {
      setDismissedSuggestions(new Set());
    });
  }, [activeDateRange.start, activeDateRange.end]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      handleVisibleSessionsRefresh();
    };
    const handleWindowFocus = () => {
      handleVisibleSessionsRefresh();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, []);

  const loadMore = useCallback(() => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    sessionsApi
      .getSessions(buildFetchParams(sessionsRef.current.length))
      .then((data) => {
        setSessions((prev) => {
          const next = [...prev, ...data];
          sessionsRef.current = next;
          return next;
        });
        const nextHasMore = data.length >= SESSION_PAGE_SIZE;
        hasMoreRef.current = nextHasMore;
        setHasMore(nextHasMore);
      })
      .catch(console.error)
      .finally(() => {
        isLoadingRef.current = false;
      });
  }, [buildFetchParams, sessionsRef, setSessions]);

  return {
    dismissedSuggestions,
    error,
    hasMore,
    isLoading,
    loadFirstSessionsPage,
    loadMore,
    sessions,
    sessionsRef,
    setDismissedSuggestions,
    setSessions,
  };
}
