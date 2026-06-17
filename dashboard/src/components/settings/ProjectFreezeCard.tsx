import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ProjectFreezeCardProps {
  thresholdDays: number;
  title: string;
  description: string;
  thresholdTitle: string;
  thresholdDescription: string;
  thresholdAriaLabel: string;
  daysLabel: string;
  onThresholdChange: (nextDays: number) => void;
}

export function ProjectFreezeCard({
  thresholdDays,
  title,
  description,
  thresholdTitle,
  thresholdDescription,
  thresholdAriaLabel,
  daysLabel,
  onThresholdChange,
}: ProjectFreezeCardProps) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-border/70 bg-background/35 p-3">
          <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <p className="text-sm font-medium">{thresholdTitle}</p>
              <p className="text-xs leading-5 break-words text-muted-foreground">
                {thresholdDescription}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={365}
                step={1}
                aria-label={thresholdAriaLabel}
                className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                value={thresholdDays}
                onChange={(e) => {
                  const val = Number.parseInt(e.target.value, 10);
                  if (!Number.isNaN(val)) onThresholdChange(val);
                }}
              />
              <span className="text-sm text-muted-foreground">{daysLabel}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
