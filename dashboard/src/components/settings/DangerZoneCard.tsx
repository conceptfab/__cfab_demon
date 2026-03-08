import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface DangerZoneCardProps {
  clearArmed: boolean;
  clearing: boolean;
  title: string;
  description: string;
  controlsLabel: string;
  openLabel: string;
  closeLabel: string;
  detailsText: string;
  enableLabel: string;
  clearingLabel: string;
  clearLabel: string;
  onClearArmedChange: (next: boolean) => void;
  onClearData: () => void;
}

export function DangerZoneCard({
  clearArmed,
  clearing,
  title,
  description,
  controlsLabel,
  openLabel,
  closeLabel,
  detailsText,
  enableLabel,
  clearingLabel,
  clearLabel,
  onClearArmedChange,
  onClearData,
}: DangerZoneCardProps) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold text-destructive">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        <details className="group rounded-md border border-destructive/50 bg-destructive/10">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5">
            <span className="text-sm font-medium">{controlsLabel}</span>
            <span className="text-xs text-muted-foreground group-open:hidden">
              {openLabel}
            </span>
            <span className="hidden text-xs text-muted-foreground group-open:inline">
              {closeLabel}
            </span>
          </summary>

          <div className="space-y-3 border-t border-destructive/40 p-3">
            <p className="text-xs leading-5 break-words text-muted-foreground">{detailsText}</p>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input accent-destructive"
                checked={clearArmed}
                onChange={(e) => onClearArmedChange(e.target.checked)}
              />
              {enableLabel}
            </label>

            <Button
              variant="destructive"
              className="h-8"
              onClick={onClearData}
              disabled={clearing || !clearArmed}
            >
              {clearing ? clearingLabel : clearLabel}
            </Button>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
