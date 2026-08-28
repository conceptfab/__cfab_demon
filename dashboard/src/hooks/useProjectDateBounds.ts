import { useEffect, useState } from 'react';

import { useCancellableAsync } from '@/lib/async-utils';
import type { DateRange } from '@/lib/db-types';
import { logger } from '@/lib/logger';
import { getProjectDateBounds } from '@/lib/tauri';

/**
 * Faktyczne granice danych projektu (pierwszy/ostatni dzień z sesją, sesją ręczną
 * lub kosztem). `null` = brak danych, błąd albo jeszcze nie wczytano — wołający ma
 * wtedy zostać przy otwartym zakresie-wartowniku, żeby niczego nie uciąć.
 */
export function useProjectDateBounds(projectId: number | null) {
  // Wynik trzymamy razem z id projektu, dla którego powstał — po przełączeniu
  // projektu oddajemy `null` bez czyszczenia stanu w efekcie (kaskada renderów).
  const [loaded, setLoaded] = useState<{
    projectId: number;
    bounds: DateRange | null;
  } | null>(null);
  const run = useCancellableAsync();

  useEffect(() => {
    if (projectId == null) return;
    void run(() => getProjectDateBounds(projectId), {
      onSuccess: (bounds) => setLoaded({ projectId, bounds }),
      onError: (error) => {
        logger.warn('[report] failed to load project date bounds', error);
        setLoaded({ projectId, bounds: null });
      },
    });
  }, [projectId, run]);

  return loaded?.projectId === projectId ? loaded.bounds : null;
}
