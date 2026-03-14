import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';

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
  const sessionsRef = useRef<SessionWithApp[]>([]);
  const hasMoreRef = useRef(false);

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
    const data = await sessionsApi.getSessions(buildFetchParams(0));
    replaceSessionsPage(data);
  }, [buildFetchParams, replaceSessionsPage]);

  const handleVisibleSessionsRefresh = useEffectEvent(() => {
    void loadFirstSessionsPage().catch(console.error);
  });

  useEffect(() => {
    let cancelled = false;
    sessionsApi
      .getSessions(buildFetchParams(0))
      .then((data) => {
        if (cancelled) return;
        replaceSessionsPage(data);
      })
      .catch(console.error);
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
      .catch(console.error);
  }, [buildFetchParams, sessionsRef, setSessions]);

  return {
    dismissedSuggestions,
    hasMore,
    loadFirstSessionsPage,
    loadMore,
    sessions,
    sessionsRef,
    setDismissedSuggestions,
    setSessions,
  };
}
