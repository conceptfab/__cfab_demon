import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface TimeAlgorithmOption {
  id: string;
  name: string;
  description: string;
}

interface TimeAlgorithmCardProps {
  title: string;
  description: string;
  options: TimeAlgorithmOption[];
  selectedId: string;
  activeBadge: string;
  note?: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
}

export function TimeAlgorithmCard({
  title,
  description,
  options,
  selectedId,
  activeBadge,
  note,
  disabled,
  onSelect,
}: TimeAlgorithmCardProps) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {options.map((option) => {
          const selected = option.id === selectedId;
          return (
            <label
              key={option.id}
              className={`grid cursor-pointer gap-3 rounded-md border p-3 transition-colors sm:grid-cols-[auto_1fr] sm:items-start ${
                selected
                  ? 'border-sky-400/60 bg-sky-400/5'
                  : 'border-border/70 bg-background/35 hover:bg-secondary/20'
              } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              <input
                type="radio"
                name="timeAlgorithm"
                className="mt-1 size-4 accent-primary"
                value={option.id}
                checked={selected}
                disabled={disabled}
                onChange={() => onSelect(option.id)}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{option.name}</p>
                  {selected && (
                    <span className="rounded-full bg-sky-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-400">
                      {activeBadge}
                    </span>
                  )}
                </div>
                <p className="text-xs leading-5 break-words text-muted-foreground">
                  {option.description}
                </p>
              </div>
            </label>
          );
        })}
        {note && (
          <p className="text-xs leading-5 text-muted-foreground/80 italic">
            {note}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
