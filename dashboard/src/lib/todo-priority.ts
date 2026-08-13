/**
 * Oznaczanie wysokiego priorytetu zadań — jedno źródło dla wszystkich widoków.
 *
 * Kolor JEST bursztynowy, nie czerwony, i to jest decyzja, nie estetyka:
 * czerwień w tej aplikacji znaczy „po terminie" (kolumna „Zaległe" na pulpicie,
 * komunikaty błędów), więc czerwony pasek przy zadaniu czytał się jak awaria,
 * a nie jak „to jest pilne". Bursztyn niesie „uwaga", nie „błąd", i nie zderza
 * się z żadnym innym znaczeniem w UI.
 */
export const HIGH_PRIORITY = 2;

/** Klasa paska akcentu (element potomny, nie `border-l` — patrz TodoCalendar). */
export const HIGH_PRIORITY_BAR = 'bg-amber-400';

/** Klasy plakietki „wysoki priorytet" na listach zadań. */
export const HIGH_PRIORITY_BADGE =
  'border-amber-400/40 bg-amber-400/10 text-amber-300';

export function isHighPriority(priority: number): boolean {
  return priority === HIGH_PRIORITY;
}
