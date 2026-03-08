import { TimerReset } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface SessionManagementCardProps {
  title: string;
  description: string;
  mergeGapLabel: string;
  mergeGapAriaLabel: string;
  minutesLabel: string;
  sliderValue: number;
  skipShortSessionsTitle: string;
  skipShortSessionsDescription: string;
  minDurationAriaLabel: string;
  minDurationSeconds: number;
  secondsLabel: string;
  autoRebuildTitle: string;
  autoRebuildDescription: string;
  rebuildOnStartup: boolean;
  rebuildExistingTitle: string;
  rebuildExistingDescription: string;
  rebuildingLabel: string;
  rebuildLabel: string;
  rebuilding: boolean;
  onGapFillChange: (minutes: number) => void;
  onMinDurationChange: (seconds: number) => void;
  onRebuildOnStartupChange: (enabled: boolean) => void;
  onRebuild: () => void;
}

export function SessionManagementCard({
  title,
  description,
  mergeGapLabel,
  mergeGapAriaLabel,
  minutesLabel,
  sliderValue,
  skipShortSessionsTitle,
  skipShortSessionsDescription,
  minDurationAriaLabel,
  minDurationSeconds,
  secondsLabel,
  autoRebuildTitle,
  autoRebuildDescription,
  rebuildOnStartup,
  rebuildExistingTitle,
  rebuildExistingDescription,
  rebuildingLabel,
  rebuildLabel,
  rebuilding,
  onGapFillChange,
  onMinDurationChange,
  onRebuildOnStartupChange,
  onRebuild,
}: SessionManagementCardProps) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-border/70 bg-background/35 p-3">
          <div className="grid items-center gap-3 sm:grid-cols-[7.5rem_1fr]">
            <label className="text-sm font-medium text-muted-foreground">
              {mergeGapLabel}
            </label>
            <div className="w-full space-y-1.5">
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="30"
                  step="1"
                  aria-label={mergeGapAriaLabel}
                  className="h-2 w-full cursor-pointer accent-primary"
                  value={sliderValue}
                  onChange={(e) => {
                    const val = Number.parseInt(e.target.value, 10);
                    if (!Number.isNaN(val)) onGapFillChange(val);
                  }}
                />
                <span className="min-w-[4.75rem] whitespace-nowrap text-right font-mono text-sm text-foreground">
                  {sliderValue} {minutesLabel}
                </span>
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>
                  0 {minutesLabel}
                </span>
                <span>
                  30 {minutesLabel}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-md border border-border/70 bg-background/35 p-3">
          <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <p className="text-sm font-medium">{skipShortSessionsTitle}</p>
              <p className="text-xs leading-5 break-words text-muted-foreground">
                {skipShortSessionsDescription}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={300}
                step={1}
                aria-label={minDurationAriaLabel}
                className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                value={minDurationSeconds}
                onChange={(e) => {
                  const val = Number.parseInt(e.target.value, 10);
                  if (!Number.isNaN(val)) onMinDurationChange(val);
                }}
              />
              <span className="text-sm text-muted-foreground">{secondsLabel}</span>
            </div>
          </div>
        </div>

        <label
          htmlFor="rebuildOnStartup"
          className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{autoRebuildTitle}</p>
            <p className="text-xs leading-5 break-words text-muted-foreground">
              {autoRebuildDescription}
            </p>
          </div>
          <input
            id="rebuildOnStartup"
            type="checkbox"
            className="h-4 w-4 rounded border-input accent-primary"
            checked={rebuildOnStartup}
            onChange={(e) => onRebuildOnStartupChange(e.target.checked)}
          />
        </label>

        <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="min-w-0">
            <p className="text-sm font-medium">{rebuildExistingTitle}</p>
            <p className="text-xs leading-5 break-words text-muted-foreground">
              {rebuildExistingDescription}
            </p>
          </div>
          <Button
            variant="outline"
            className="h-8 w-fit"
            onClick={onRebuild}
            disabled={rebuilding}
          >
            <TimerReset className="mr-2 h-4 w-4" />
            {rebuilding ? rebuildingLabel : rebuildLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
