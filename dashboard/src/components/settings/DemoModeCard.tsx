import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { DemoModeStatus } from '@/lib/db-types';

interface DemoModeCardProps {
  demoModeStatus: DemoModeStatus | null;
  demoModeLoading: boolean;
  demoModeSwitching: boolean;
  demoModeError: string | null;
  title: string;
  description: string;
  toggleTitle: string;
  toggleDescription: string;
  loadingStatusText: string;
  activeDbLabel: string;
  primaryDbLabel: string;
  demoDbLabel: string;
  demoActiveText: string;
  primaryActiveText: string;
  unavailableStatusText: string;
  switchingLabel: string;
  disableLabel: string;
  enableLabel: string;
  onToggle: (enabled: boolean) => void;
}

export function DemoModeCard({
  demoModeStatus,
  demoModeLoading,
  demoModeSwitching,
  demoModeError,
  title,
  description,
  toggleTitle,
  toggleDescription,
  loadingStatusText,
  activeDbLabel,
  primaryDbLabel,
  demoDbLabel,
  demoActiveText,
  primaryActiveText,
  unavailableStatusText,
  switchingLabel,
  disableLabel,
  enableLabel,
  onToggle,
}: DemoModeCardProps) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <label
          htmlFor="demoModeEnabled"
          className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{toggleTitle}</p>
            <p className="text-xs leading-5 break-words text-muted-foreground">
              {toggleDescription}
            </p>
          </div>
          <input
            id="demoModeEnabled"
            type="checkbox"
            className="size-4 rounded border-input accent-primary"
            checked={demoModeStatus?.enabled ?? false}
            disabled={demoModeLoading || demoModeSwitching}
            onChange={(e) => onToggle(e.target.checked)}
          />
        </label>

        <div className="rounded-md border border-border/70 bg-background/20 p-3 text-xs">
          {demoModeLoading ? (
            <p className="text-muted-foreground">{loadingStatusText}</p>
          ) : demoModeStatus ? (
            <div className="space-y-1.5 text-muted-foreground">
              <div>
                {activeDbLabel}{' '}
                <span className="font-mono text-foreground break-all">
                  {demoModeStatus.activeDbPath}
                </span>
              </div>
              <div>
                {primaryDbLabel}{' '}
                <span className="font-mono text-foreground break-all">
                  {demoModeStatus.primaryDbPath}
                </span>
              </div>
              <div>
                {demoDbLabel}{' '}
                <span className="font-mono text-foreground break-all">
                  {demoModeStatus.demoDbPath}
                </span>
              </div>
              <div
                className={
                  demoModeStatus.enabled ? 'text-amber-500' : 'text-emerald-500'
                }
              >
                {demoModeStatus.enabled
                  ? demoActiveText
                  : primaryActiveText}
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">{unavailableStatusText}</p>
          )}

          {demoModeError && <p className="mt-2 text-destructive">{demoModeError}</p>}
        </div>

        <div className="flex items-center justify-end">
          <Button
            type="button"
            variant="outline"
            className="h-8"
            disabled={demoModeLoading || demoModeSwitching}
            onClick={() => {
              if (!demoModeStatus) return;
              onToggle(!demoModeStatus.enabled);
            }}
          >
            {demoModeSwitching
              ? switchingLabel
              : demoModeStatus?.enabled
                ? disableLabel
                : enableLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
