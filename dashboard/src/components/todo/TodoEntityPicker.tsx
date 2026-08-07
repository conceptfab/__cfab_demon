import { useState } from 'react';
import { ArrowDownAZ, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AppTooltip } from '@/components/ui/app-tooltip';
import { cn } from '@/lib/utils';

export interface PickerOption {
  name: string;
  color: string;
  /** Do sortowania „ostatnio używane"; brak = na koniec listy. */
  lastUsedAt?: string | null;
}

type SortMode = 'alpha' | 'recent';

interface TodoEntityPickerProps {
  options: PickerOption[];
  value: string | null;
  onChange: (name: string | null) => void;
  /** Etykieta pozycji „brak wyboru" — np. „Nieprzypisane". */
  emptyLabel: string;
  emptyText: string;
}

/**
 * Lista wyboru projektu/klienta w stylu menu przypisania sesji
 * (`SessionContextMenu`): kropka koloru + nazwa, podświetlenie aktywnego wiersza.
 * Świadomie NIE `<select>` — natywna lista rysowana przez system wypada z motywu
 * aplikacji i przy kilkudziesięciu projektach jest nieczytelna.
 */
export function TodoEntityPicker({
  options,
  value,
  onChange,
  emptyLabel,
  emptyText,
}: TodoEntityPickerProps) {
  const { t } = useTranslation();
  // Te same tryby co w menu przypisania sesji — przy kilkudziesięciu projektach
  // sama alfabetyczna lista zmusza do przewijania za każdym razem.
  const [sortMode, setSortMode] = useState<SortMode>('alpha');

  const sorted = options.toSorted((a, b) =>
    sortMode === 'alpha'
      ? a.name.localeCompare(b.name)
      : (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '') ||
        a.name.localeCompare(b.name),
  );

  return (
    <div className="rounded border border-border/70 bg-secondary/10">
      <div className="flex items-center gap-1 border-b border-border/50 px-1.5 py-1">
        <div className="inline-flex rounded-sm border border-border/70 bg-secondary/20 p-0.5">
          <AppTooltip content={t('sessions.menu.mode_alpha')}>
            <button
              type="button"
              onClick={() => setSortMode('alpha')}
              aria-label={t('sessions.menu.mode_alpha')}
              className={cn(
                'inline-flex size-6 cursor-pointer items-center justify-center rounded-sm transition-colors',
                sortMode === 'alpha'
                  ? 'bg-background text-sky-200 shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <ArrowDownAZ className="size-3.5" />
            </button>
          </AppTooltip>
          <AppTooltip content={t('sessions.menu.mode_new_top')}>
            <button
              type="button"
              onClick={() => setSortMode('recent')}
              aria-label={t('sessions.menu.mode_new_top')}
              className={cn(
                'inline-flex size-6 cursor-pointer items-center justify-center rounded-sm transition-colors',
                sortMode === 'recent'
                  ? 'bg-background text-sky-200 shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Clock className="size-3.5" />
            </button>
          </AppTooltip>
        </div>
      </div>

      <div className="max-h-48 overflow-y-auto py-1">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          'flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground',
          value === null && 'bg-accent/60 text-accent-foreground',
        )}
      >
        <div className="size-2.5 shrink-0 rounded-full bg-muted-foreground/60" />
        <span className="truncate">{emptyLabel}</span>
      </button>

      {options.length === 0 ? (
        <div className="px-2 py-1.5 text-sm text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        sorted.map((option) => (
          <button
            type="button"
            key={option.name}
            onClick={() => onChange(option.name)}
            className={cn(
              'flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground',
              value === option.name && 'bg-accent/60 text-accent-foreground',
            )}
          >
            <div
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: option.color }}
            />
            <span className="truncate">{option.name}</span>
          </button>
        ))
      )}
      </div>
    </div>
  );
}
