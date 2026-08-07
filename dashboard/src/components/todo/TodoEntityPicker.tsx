import { useState } from 'react';
import type { ReactNode } from 'react';
import { Flame, Sparkles, Type } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AppTooltip } from '@/components/ui/app-tooltip';
import { cn } from '@/lib/utils';

export interface PickerOption {
  name: string;
  color: string;
  /** Data utworzenia — do trybu „najnowsze". */
  createdAt?: string | null;
  /** Waga (np. sumaryczny czas) — do trybu „top". */
  weight?: number;
}

/** Te same tryby i te same nazwy co w menu przypisania sesji. */
type ListMode = 'alpha_active' | 'new_top_rest' | 'top_new_rest';

interface TodoEntityPickerProps {
  options: PickerOption[];
  value: string | null;
  onChange: (name: string | null) => void;
  emptyLabel: string;
  emptyText: string;
}

/**
 * Wybór projektu/klienta zbudowany na menu przypisania sesji
 * (`SessionContextMenu`): trzy przełączniki trybu z tymi samymi ikonami,
 * tooltipami i kluczami i18n, wiersz „Nieprzypisane", potem płaska lista
 * z kropkami kolorów. Bez ramki i bez `<select>` — natywna lista rysowana przez
 * system wypada z motywu i przy kilkudziesięciu pozycjach jest nieczytelna.
 */
export function TodoEntityPicker({
  options,
  value,
  onChange,
  emptyLabel,
  emptyText,
}: TodoEntityPickerProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ListMode>('alpha_active');

  const byName = (a: PickerOption, b: PickerOption) =>
    a.name.localeCompare(b.name);
  const sorted =
    mode === 'alpha_active'
      ? options.toSorted(byName)
      : mode === 'new_top_rest'
        ? options.toSorted(
            (a, b) =>
              (b.createdAt ?? '').localeCompare(a.createdAt ?? '') ||
              byName(a, b),
          )
        : options.toSorted(
            (a, b) => (b.weight ?? 0) - (a.weight ?? 0) || byName(a, b),
          );

  const modeButton = (id: ListMode, tooltipKey: string, icon: ReactNode) => (
    <AppTooltip content={t(tooltipKey)}>
      <button
        type="button"
        onClick={() => setMode(id)}
        aria-label={t(tooltipKey)}
        className={cn(
          'inline-flex size-7 cursor-pointer items-center justify-center rounded-sm transition-colors',
          mode === id
            ? 'bg-background text-sky-200 shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {icon}
      </button>
    </AppTooltip>
  );

  return (
    <div>
      <div className="pb-1.5">
        <div className="inline-flex rounded-sm border border-border/70 bg-secondary/20 p-0.5">
          {modeButton(
            'alpha_active',
            'sessions.menu.mode_alpha',
            <Type className="size-3.5" />,
          )}
          {modeButton(
            'new_top_rest',
            'sessions.menu.mode_new_top',
            <Sparkles className="size-3.5" />,
          )}
          {modeButton(
            'top_new_rest',
            'sessions.menu.mode_top_new',
            <Flame className="size-3.5" />,
          )}
        </div>
      </div>

      <div className="max-h-48 overflow-y-auto">
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

        {sorted.length === 0 ? (
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
