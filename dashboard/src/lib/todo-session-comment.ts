import type { SessionWithApp } from '@/lib/db-types';
import type { Todo } from '@/lib/tauri/todos';

/**
 * Automatyczny komentarz sesji z zadania.
 *
 * Reguła: sesja przypisana do projektu dostaje komentarz z tytułu zadania tego
 * samego projektu, jeśli czas sesji POKRYWA SIĘ z terminem zadania. Komentarz
 * jest wyliczany w locie — nie zapisujemy go do bazy, więc wyłączenie opcji
 * przywraca poprzedni widok, nic nie trzeba czyścić i nic nie wchodzi do
 * synchronizacji. Własny komentarz użytkownika ma zawsze pierwszeństwo i nigdy
 * nie jest nadpisywany.
 */

/** Zakres zadania w ms (lokalna strefa czasowa — tak samo liczy się dzień w UI). */
function todoRangeMs(todo: Todo): [number, number] | null {
  if (!todo.due_date) return null;
  // `due_time` to godzina STARTU zadania; koniec zawsze domyka ostatni dzień
  // zakresu, bo zadania nie mają godziny zakończenia.
  const startIso = `${todo.due_date}T${todo.due_time ?? '00:00'}:00`;
  const endIso = `${todo.end_date ?? todo.due_date}T23:59:59`;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return [start, end];
}

/** Wyższy priorytet wygrywa; przy remisie wcześniejszy termin. Deterministycznie. */
function isBetterMatch(candidate: Todo, current: Todo): boolean {
  if (candidate.priority !== current.priority) {
    return candidate.priority > current.priority;
  }
  return (candidate.due_date ?? '') < (current.due_date ?? '');
}

/**
 * Zadanie, którego termin pokrywa się z sesją. `null` gdy brak dopasowania.
 * Bierzemy pod uwagę wyłącznie zadania o zasięgu projektu — zadania globalne
 * i klienckie nie wskazują jednoznacznie, nad czym szła sesja.
 */
export function findTodoForSession(
  session: Pick<SessionWithApp, 'project_name' | 'start_time' | 'end_time'>,
  todos: readonly Todo[],
): Todo | null {
  const projectName = session.project_name;
  if (!projectName) return null;

  const sessionStart = Date.parse(session.start_time);
  const sessionEnd = Date.parse(session.end_time);
  if (Number.isNaN(sessionStart) || Number.isNaN(sessionEnd)) return null;

  let best: Todo | null = null;
  for (const todo of todos) {
    if (todo.scope !== 'project' || todo.project_name !== projectName) continue;
    const range = todoRangeMs(todo);
    if (!range) continue;
    // Półotwarte porównanie w obie strony = klasyczny test przecięcia zakresów.
    if (sessionStart > range[1] || sessionEnd < range[0]) continue;
    if (!best || isBetterMatch(todo, best)) best = todo;
  }
  return best;
}

/**
 * Dokłada `comment` z pasującego zadania tam, gdzie sesja nie ma własnego.
 * Zwraca tę samą tablicę, jeśli nic się nie zmieniło — dzięki temu memo w
 * kontrolerze nie generuje zbędnych renderów.
 */
export function applyTodoAutoComments(
  sessions: SessionWithApp[],
  todos: readonly Todo[],
): SessionWithApp[] {
  if (todos.length === 0) return sessions;

  let changed = false;
  const next = sessions.map((session) => {
    if (session.comment && session.comment.trim() !== '') return session;
    const todo = findTodoForSession(session, todos);
    if (!todo) return session;
    changed = true;
    return { ...session, comment: todo.title, comment_from_todo: true };
  });
  return changed ? next : sessions;
}
