import { useEffect, useMemo, useState } from 'react';

import type { PickerOption } from '@/components/todo/TodoEntityPicker';
import { clientsList, projectsWithClient } from '@/lib/tauri/clients';
import { logger } from '@/lib/logger';

const byPickerName = (a: PickerOption, b: PickerOption) =>
  a.name.localeCompare(b.name);

/**
 * Listy referencyjne do dialogu zadań (projekty, klienci) plus mapa
 * NAZWA → kolor do oznaczania zadań w siatkach.
 *
 * Ładowane raz — nie zmieniają się w trakcie pracy z zadaniami. Wspólne dla
 * ekranu Zadań i kafelka terminów na pulpicie, żeby oba miały ten sam zestaw
 * encji i te same kolory.
 */
export function useTodoReferenceOptions() {
  const [projectOptions, setProjectOptions] = useState<PickerOption[]>([]);
  const [clientOptions, setClientOptions] = useState<PickerOption[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; listy referencyjne do selectów
    void (async () => {
      try {
        const [projects, clients] = await Promise.all([
          projectsWithClient(),
          clientsList(),
        ]);
        // Tylko AKTYWNE projekty — menu przypisania sesji filtruje tak samo
        // (`!frozen_at`), więc zamrożone, wykluczone i zarchiwizowane nie
        // zaśmiecają listy dziesiątkami pozycji.
        const activeProjects: PickerOption[] = [];
        for (const project of projects) {
          if (project.status !== 'active') continue;
          activeProjects.push({ name: project.name, color: project.color });
        }
        setProjectOptions(activeProjects.toSorted(byPickerName));
        setClientOptions(
          clients
            .map((c) => ({ name: c.name, color: c.color }))
            .toSorted(byPickerName),
        );
      } catch (e) {
        logger.error('[todos] reference lists failed:', e);
      }
    })();
  }, []);

  // Jedna mapa dla projektów i klientów: kafelek zadania oznacza je kolorem
  // swojej encji, tak jak reszta aplikacji.
  const colorByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of [...projectOptions, ...clientOptions]) {
      map.set(option.name, option.color);
    }
    return map;
  }, [projectOptions, clientOptions]);

  return { projectOptions, clientOptions, colorByName };
}
