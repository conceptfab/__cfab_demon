import { useTodoPageController } from '@/hooks/useTodoPageController';
import { TodoPageView } from '@/pages/todo/TodoPageView';

export function Todo() {
  const controller = useTodoPageController();
  return <TodoPageView controller={controller} />;
}
