import { format, parseISO } from 'date-fns';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TodoRow } from '@/components/todo/TodoRow';
import { resolveDateFnsLocale } from '@/lib/date-helpers';
import type { Todo } from '@/lib/tauri/todos';

interface TodoDayViewProps {
  /** YYYY-MM-DD */
  date: string;
  todos: Todo[];
  onAdd: (date: string) => void;
  onToggle: (todo: Todo) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
}

/**
 * Widok jednego dnia. ŚWIADOMIE nie jest komórką kalendarza: siatka dla jednego
 * dnia degeneruje się do wielkiego pustego prostokąta na całą szerokość ekranu.
 * Zamiast tego zwykła lista zadań tego dnia — ten sam wiersz co w widoku listy.
 */
export function TodoDayView({
  date,
  todos,
  onAdd,
  onToggle,
  onEdit,
  onDelete,
}: TodoDayViewProps) {
  const { t, i18n } = useTranslation();
  const locale = resolveDateFnsLocale(i18n.resolvedLanguage ?? i18n.language);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">
          {format(parseISO(date), 'EEEE, d MMMM yyyy', { locale })}
        </CardTitle>
        <Button size="sm" onClick={() => onAdd(date)}>
          <Plus className="mr-1 h-4 w-4" />
          {t('todo.add')}
        </Button>
      </CardHeader>
      <CardContent>
        {todos.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            {t('todo.empty')}
          </p>
        ) : (
          <ul>
            {todos.map((todo) => (
              <TodoRow
                key={todo.uid}
                todo={todo}
                onToggle={onToggle}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
