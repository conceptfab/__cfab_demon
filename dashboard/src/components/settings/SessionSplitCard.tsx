import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { SplitSettings } from '@/lib/user-settings';

interface SessionSplitCardProps {
  title: string;
  maxProjectsTitle: string;
  maxProjectsDescription: string;
  toleranceTitle: string;
  toleranceLowLabel: string;
  toleranceHighLabel: string;
  toleranceDescription: string;
  autoSplitTitle: string;
  autoSplitDescription: string;
  splitSettings: SplitSettings;
  onMaxProjectsChange: (maxProjects: number) => void;
  onToleranceThresholdChange: (threshold: number) => void;
  onAutoSplitEnabledChange: (enabled: boolean) => void;
}

export function SessionSplitCard({
  title,
  maxProjectsTitle,
  maxProjectsDescription,
  toleranceTitle,
  toleranceLowLabel,
  toleranceHighLabel,
  toleranceDescription,
  autoSplitTitle,
  autoSplitDescription,
  splitSettings,
  onMaxProjectsChange,
  onToleranceThresholdChange,
  onAutoSplitEnabledChange,
}: SessionSplitCardProps) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-border/70 bg-background/35 overflow-hidden">
          <div className="grid gap-3 p-3 sm:grid-cols-[1fr_auto] sm:items-center border-b border-border/50">
            <div className="min-w-0">
              <p className="text-sm font-medium">{maxProjectsTitle}</p>
              <p className="text-xs leading-5 break-words text-muted-foreground">
                {maxProjectsDescription}
              </p>
            </div>
            <select
              value={splitSettings.maxProjectsPerSession}
              onChange={(e) => onMaxProjectsChange(Number(e.target.value))}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 text-foreground"
            >
              {[2, 3, 4, 5].map((n) => (
                <option
                  key={n}
                  value={n}
                  className="bg-background text-foreground"
                >
                  {n}
                </option>
              ))}
            </select>
          </div>

          <div className="p-3 border-b border-border/50">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{toleranceTitle}</p>
              <span className="text-xs font-mono text-sky-400">
                1:{splitSettings.toleranceThreshold.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={20}
              max={100}
              step={5}
              value={Math.round(splitSettings.toleranceThreshold * 100)}
              onChange={(e) =>
                onToleranceThresholdChange(Number(e.target.value) / 100)
              }
              className="mt-2 w-full accent-sky-500"
            />
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground/50">
              <span>0.20 ({toleranceLowLabel})</span>
              <span>1.00 ({toleranceHighLabel})</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {toleranceDescription}
            </p>
          </div>

          <label
            htmlFor="autoSplitEnabled"
            className="grid cursor-pointer gap-3 p-3 sm:grid-cols-[1fr_auto] sm:items-center hover:bg-secondary/5 transition-colors"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-sky-400">{autoSplitTitle}</p>
              <p className="text-xs leading-5 break-words text-muted-foreground">
                {autoSplitDescription}
              </p>
            </div>
            <button
              id="autoSplitEnabled"
              type="button"
              role="switch"
              aria-checked={splitSettings.autoSplitEnabled}
              onClick={() =>
                onAutoSplitEnabledChange(!splitSettings.autoSplitEnabled)
              }
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                splitSettings.autoSplitEnabled ? 'bg-sky-600' : 'bg-secondary'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  splitSettings.autoSplitEnabled
                    ? 'translate-x-4.5'
                    : 'translate-x-0.5'
                }`}
              />
            </button>
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
