import { RotateCcw, WandSparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface AiBatchActionsCardProps {
  title: string;
  sessionLimitLabel: string;
  autoLimit: number;
  onAutoLimitChange: (value: number) => void;
  runLabel: string;
  runStartingLabel: string;
  rollbackLabel: string;
  rollbackRunningLabel: string;
  rollbackHint: string;
  modeIsAutoSafe: boolean;
  runningAuto: boolean;
  rollingBack: boolean;
  canRollbackLastRun: boolean;
  onRun: () => void;
  onRollback: () => void;
}

export function AiBatchActionsCard({
  title,
  sessionLimitLabel,
  autoLimit,
  onAutoLimitChange,
  runLabel,
  runStartingLabel,
  rollbackLabel,
  rollbackRunningLabel,
  rollbackHint,
  modeIsAutoSafe,
  runningAuto,
  rollingBack,
  canRollbackLastRun,
  onRun,
  onRollback,
}: AiBatchActionsCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="block max-w-xs space-y-1.5 text-sm">
          <span className="text-xs text-muted-foreground">{sessionLimitLabel}</span>
          <input
            type="number"
            min={1}
            max={10000}
            step={1}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={autoLimit}
            onChange={(e) => {
              const next = Number.parseInt(e.target.value, 10);
              onAutoLimitChange(Number.isNaN(next) ? autoLimit : next);
            }}
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <AppTooltip
            content={
              !modeIsAutoSafe
                ? t('ai_page.batch.tooltip_requires_auto_safe')
                : undefined
            }
          >
            <span>
              <Button
                className="h-9"
                onClick={onRun}
                disabled={runningAuto || !modeIsAutoSafe}
              >
                <WandSparkles className="mr-2 size-4" />
                {runningAuto ? runStartingLabel : runLabel}
              </Button>
            </span>
          </AppTooltip>

          <Button
            variant="outline"
            className="h-9"
            onClick={onRollback}
            disabled={rollingBack || !canRollbackLastRun}
          >
            <RotateCcw className="mr-2 size-4" />
            {rollingBack ? rollbackRunningLabel : rollbackLabel}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">{rollbackHint}</p>
      </CardContent>
    </Card>
  );
}
