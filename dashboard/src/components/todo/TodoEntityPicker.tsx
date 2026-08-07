import { cn } from '@/lib/utils';

export interface PickerOption {
  name: string;
  color: string;
}

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
  return (
    <div className="max-h-48 overflow-y-auto rounded border border-border/70 bg-secondary/10 py-1">
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
        options.map((option) => (
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
  );
}
