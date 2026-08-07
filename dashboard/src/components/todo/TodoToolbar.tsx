import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import type { ScopeFilter } from '@/hooks/useTodoPageController';

const SCOPES: { id: ScopeFilter; labelKey: string }[] = [
  { id: 'all', labelKey: 'todo.scope_all' },
  { id: 'global', labelKey: 'todo.scope_global' },
  { id: 'client', labelKey: 'todo.scope_client' },
  { id: 'project', labelKey: 'todo.scope_project' },
];

interface TodoToolbarProps {
  search: string;
  setSearch: (value: string) => void;
  scopeFilter: ScopeFilter;
  setScopeFilter: (value: ScopeFilter) => void;
  showDone: boolean;
  setShowDone: (value: boolean) => void;
  onAdd: () => void;
}

export function TodoToolbar({
  search,
  setSearch,
  scopeFilter,
  setScopeFilter,
  showDone,
  setShowDone,
  onAdd,
}: TodoToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('todo.search_placeholder')}
        className="min-w-0 flex-1 rounded border bg-background px-3 py-2 text-sm"
      />

      <div className="flex gap-1">
        {SCOPES.map((scope) => (
          <Button
            key={scope.id}
            size="sm"
            variant={scopeFilter === scope.id ? 'default' : 'ghost'}
            onClick={() => setScopeFilter(scope.id)}
          >
            {t(scope.labelKey)}
          </Button>
        ))}
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={showDone}
          onChange={(e) => setShowDone(e.target.checked)}
          className="size-4"
        />
        {t('todo.show_done')}
      </label>

      <Button size="sm" onClick={onAdd}>
        <Plus className="mr-1 h-4 w-4" />
        {t('todo.add')}
      </Button>
    </div>
  );
}
