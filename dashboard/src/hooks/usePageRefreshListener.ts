import { useEffect, useEffectEvent } from 'react';

import {
  APP_REFRESH_EVENT,
  LOCAL_DATA_CHANGED_EVENT,
  type AppRefreshDetail,
  type LocalDataChangedDetail,
} from '@/lib/sync-events';

export function usePageRefreshListener(
  onRefresh: (reasons: string[], source: 'app' | 'local') => void,
) {
  const handleRefresh = useEffectEvent(onRefresh);

  useEffect(() => {
    const handleLocalDataChange = (event: Event) => {
      const customEvent = event as CustomEvent<LocalDataChangedDetail>;
      const reason = customEvent.detail?.reason;
      if (!reason) return;
      handleRefresh([reason], 'local');
    };

    const handleAppRefresh = (event: Event) => {
      const customEvent = event as CustomEvent<AppRefreshDetail>;
      const reasons = customEvent.detail?.reasons ?? [];
      if (reasons.length === 0) return;
      handleRefresh(reasons, 'app');
    };

    window.addEventListener(
      LOCAL_DATA_CHANGED_EVENT,
      handleLocalDataChange as EventListener,
    );
    window.addEventListener(APP_REFRESH_EVENT, handleAppRefresh as EventListener);

    return () => {
      window.removeEventListener(
        LOCAL_DATA_CHANGED_EVENT,
        handleLocalDataChange as EventListener,
      );
      window.removeEventListener(
        APP_REFRESH_EVENT,
        handleAppRefresh as EventListener,
      );
    };
  }, []);
}
