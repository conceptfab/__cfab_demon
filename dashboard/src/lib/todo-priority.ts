/**
 * Oznaczanie wysokiego priorytetu zadań — jedno źródło dla wszystkich widoków.
 *
 * Znacznikiem jest STRZAŁKA W GÓRĘ w treści wiersza, nie pasek na krawędzi.
 * Pasek — czerwony czy bursztynowy — czytał się jak usterka renderowania:
 * kilkupikselowa kreska przyklejona do brzegu kafelka nie wygląda na informację,
 * bo nie ma kształtu żadnego znaku. Strzałka stoi w rzędzie z tekstem, ma
 * rozpoznawalną formę i jest powszechną konwencją priorytetu.
 *
 * Kolor jest bursztynowy, nie czerwony: czerwień w tej aplikacji znaczy
 * „po terminie" (kolumna „Zaległe", komunikaty błędów).
 */
export const HIGH_PRIORITY = 2;

/** Klasa koloru dla ikony priorytetu i plakietki na listach. */
export const HIGH_PRIORITY_ICON = 'text-amber-400';

/** Klasy plakietki „wysoki priorytet" na listach zadań. */
export const HIGH_PRIORITY_BADGE =
  'border-amber-400/40 bg-amber-400/10 text-amber-300';

export function isHighPriority(priority: number): boolean {
  return priority === HIGH_PRIORITY;
}
