import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

import { ALL_TIME_DATE_RANGE } from '@/lib/date-helpers';
import type { DateRange } from '@/lib/db-types';
import type { TimePreset } from '@/store/data-store';

const ISO = 'yyyy-MM-dd';

/**
 * Okresy ekranu Zadania. ŚWIADOMIE własne, nie ze wspólnego `data-store`.
 *
 * Store liczy zakresy WSTECZ (tydzień = dziś − 6 dni) i twardo blokuje ruch
 * w przyszłość (`canShiftForward = range.end < dziś`), bo czasu pracy w przyszłości
 * nie ma. Zadania są odwrotnością: to kalendarz do PLANOWANIA, więc „tydzień" musi
 * znaczyć bieżący tydzień kalendarzowy, a strzałki muszą działać w obie strony.
 * Komponent paska (`DateRangeToolbar`) i słownik presetów zostają wspólne.
 */
export function todoPresetToRange(
  preset: TimePreset,
  anchor: Date = new Date(),
): DateRange {
  switch (preset) {
    case 'today': {
      const day = format(anchor, ISO);
      return { start: day, end: day };
    }
    case 'week':
      return {
        start: format(startOfWeek(anchor, { weekStartsOn: 1 }), ISO),
        end: format(endOfWeek(anchor, { weekStartsOn: 1 }), ISO),
      };
    case 'month':
      return {
        start: format(startOfMonth(anchor), ISO),
        end: format(endOfMonth(anchor), ISO),
      };
    default:
      return ALL_TIME_DATE_RANGE;
  }
}

/**
 * Przesuwa kotwicę o jedną jednostkę presetu. `direction` -1 wstecz, 1 do przodu.
 * Dla „całego okresu" nie ma czego przesuwać, więc kotwica zostaje.
 */
export function shiftTodoAnchor(
  preset: TimePreset,
  anchor: Date,
  direction: -1 | 1,
): Date {
  switch (preset) {
    case 'today':
      return addDays(anchor, direction);
    case 'week':
      return addWeeks(anchor, direction);
    case 'month':
      return addMonths(anchor, direction);
    default:
      return anchor;
  }
}
