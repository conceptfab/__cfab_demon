import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type TimeField = 'start' | 'end';
type TimePart = 'hour' | 'minute';

interface WorkingHoursCardProps {
  title: string;
  description: string;
  fromLabel: string;
  toLabel: string;
  highlightColorLabel: string;
  labelClassName: string;
  compactSelectClassName: string;
  hours: string[];
  minutes: string[];
  startHour: string;
  startMinute: string;
  endHour: string;
  endMinute: string;
  normalizedColor: string;
  errorText: string | null;
  onTimePartChange: (field: TimeField, part: TimePart, value: string) => void;
  onColorChange: (color: string) => void;
}

export function WorkingHoursCard({
  title,
  description,
  fromLabel,
  toLabel,
  highlightColorLabel,
  labelClassName,
  compactSelectClassName,
  hours,
  minutes,
  startHour,
  startMinute,
  endHour,
  endMinute,
  normalizedColor,
  errorText,
  onTimePartChange,
  onColorChange,
}: WorkingHoursCardProps) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-border/70 bg-background/35 p-3">
          <div className="grid items-center gap-3 sm:grid-cols-[7.5rem_1fr]">
            <label className={labelClassName}>{fromLabel}</label>
            <div className="flex items-center gap-1.5">
              <select
                className={compactSelectClassName}
                value={startHour}
                onChange={(e) => onTimePartChange('start', 'hour', e.target.value)}
              >
                {hours.map((hour) => (
                  <option key={hour} value={hour}>
                    {hour}
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground">:</span>
              <select
                className={compactSelectClassName}
                value={startMinute}
                onChange={(e) =>
                  onTimePartChange('start', 'minute', e.target.value)
                }
              >
                {minutes.map((minute) => (
                  <option key={minute} value={minute}>
                    {minute}
                  </option>
                ))}
              </select>
            </div>

            <label className={labelClassName}>{toLabel}</label>
            <div className="flex items-center gap-1.5">
              <select
                className={compactSelectClassName}
                value={endHour}
                onChange={(e) => onTimePartChange('end', 'hour', e.target.value)}
              >
                {hours.map((hour) => (
                  <option key={hour} value={hour}>
                    {hour}
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground">:</span>
              <select
                className={compactSelectClassName}
                value={endMinute}
                onChange={(e) => onTimePartChange('end', 'minute', e.target.value)}
              >
                {minutes.map((minute) => (
                  <option key={minute} value={minute}>
                    {minute}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="rounded-md border border-border/70 bg-background/35 p-3">
          <div className="grid items-center gap-3 sm:grid-cols-[7.5rem_1fr]">
            <label className={labelClassName}>{highlightColorLabel}</label>
            <div className="flex items-center gap-2.5">
              <input
                type="color"
                className="h-8 w-10 cursor-pointer rounded border border-input bg-background p-1"
                value={normalizedColor}
                onChange={(e) => onColorChange(e.target.value)}
              />
              <span className="font-mono text-sm text-muted-foreground">
                {normalizedColor}
              </span>
            </div>
          </div>
        </div>

        {errorText && <p className="text-sm text-destructive">{errorText}</p>}
      </CardContent>
    </Card>
  );
}
