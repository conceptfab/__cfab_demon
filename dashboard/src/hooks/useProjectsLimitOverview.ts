import { useCallback, useEffect, useState } from 'react';

import { logger } from '@/lib/logger';
import { usePageRefreshListener } from '@/hooks/usePageRefreshListener';
import {
  shouldRefreshProjectsPageAllTime,
  shouldRefreshProjectsPageCore,
} from '@/lib/page-refresh-reasons';
import {
  getProjectsLimitOverview,
  type ProjectLimitBadge,
} from '@/lib/tauri/project-limits';

/**
 * Stan limitów godzin dla listy projektów — osobne, LEKKIE zapytanie (bez list sesji),
 * żeby nie obciążać i tak ciężkiego zapytania listy projektów. Zwraca tylko projekty
 * z ustawionym limitem, więc mapa bywa pusta i to jest normalny stan.
 */
export function useProjectsLimitOverview() {
  const [badges, setBadges] = useState<Map<number, ProjectLimitBadge>>(
    () => new Map(),
  );

  const reload = useCallback(async () => {
    try {
      const rows = await getProjectsLimitOverview();
      setBadges(new Map(rows.map((row) => [row.project_id, row])));
    } catch (e) {
      // Brak limitów nie może wywrócić listy projektów — logujemy i zostawiamy pustą mapę.
      logger.error('[project-limit] overview load failed:', e);
    }
  }, []);

  useEffect(() => {
    // Ten sam callback obsługuje montowanie i reakcję na sygnały odświeżenia niżej.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; ten sam callback reużyty w listenerze odświeżania
    void reload();
  }, [reload]);

  usePageRefreshListener((reasons) => {
    // Zużycie zmienia się z czasem (all-time), a same ustawienia limitu idą ścieżką
    // „core" (`update_project_limit`) — badge musi reagować na obie.
    if (
      reasons.some(
        (reason) =>
          shouldRefreshProjectsPageAllTime(reason) ||
          shouldRefreshProjectsPageCore(reason),
      )
    ) {
      void reload();
    }
  });

  return badges;
}
