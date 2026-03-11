import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { Button } from '@/components/ui/button';

type RangeMode = 'daily' | 'weekly';
type ViewMode = 'detailed' | 'compact' | 'ai_detailed';

interface SessionsToolbarSummaryProps {
  text: string;
  showUnassignedOnly: boolean;
  unassignedOnlyText: string;
  unassignedScopeText?: string;
}

interface SessionsToolbarRangeProps {
  mode: RangeMode;
  label: string;
  canShiftForward: boolean;
  labels: {
    today: string;
    week: string;
    previousTooltip: string;
    nextTooltip: string;
  };
  onModeChange: (mode: RangeMode) => void;
  onClearOverrideRange: () => void;
  onShiftBackward: () => void;
  onShiftForward: () => void;
}

interface SessionsToolbarViewProps {
  mode: ViewMode;
  labels: {
    aiData: string;
    detailed: string;
    compact: string;
  };
  onModeChange: (mode: ViewMode) => void;
}

interface SessionsToolbarProps {
  summary: SessionsToolbarSummaryProps;
  range: SessionsToolbarRangeProps;
  view: SessionsToolbarViewProps;
}

export function SessionsToolbar({
  summary,
  range,
  view,
}: SessionsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
      <p className="text-xs text-muted-foreground font-medium flex items-baseline gap-1">
        {summary.text}
        {summary.showUnassignedOnly && (
          <span className="text-amber-400/80 ml-2 font-bold select-none">
            {summary.unassignedOnlyText}
          </span>
        )}
        {summary.showUnassignedOnly && summary.unassignedScopeText && (
          <span className="text-[11px] text-amber-300/70 font-semibold select-none">
            {summary.unassignedScopeText}
          </span>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-secondary/20 p-0.5 rounded border border-border/20">
          <Button
            variant={range.mode === 'daily' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 text-[10px] px-3 font-bold"
            onClick={() => {
              range.onModeChange('daily');
              range.onClearOverrideRange();
            }}
          >
            {range.labels.today}
          </Button>
          <Button
            variant={range.mode === 'weekly' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 text-[10px] px-3 font-bold"
            onClick={() => {
              range.onModeChange('weekly');
              range.onClearOverrideRange();
            }}
          >
            {range.labels.week}
          </Button>
        </div>
        <div className="mx-1 h-4 w-px bg-border/40" />
        <div className="flex items-center gap-1">
          <AppTooltip content={range.labels.previousTooltip}>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={range.onShiftBackward}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
          </AppTooltip>
          <span className="text-[10px] font-mono font-bold text-muted-foreground/80 min-w-[5rem] text-center">
            {range.label}
          </span>
          <AppTooltip content={range.labels.nextTooltip}>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={range.onShiftForward}
              disabled={!range.canShiftForward}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </AppTooltip>
        </div>
        <div className="mx-1 h-4 w-px bg-border/40" />
        <div className="flex bg-secondary/30 p-0.5 rounded border border-border/20">
          <button
            onClick={() => view.onModeChange('ai_detailed')}
            className={`px-3 py-1 text-[10px] font-bold rounded-sm transition-all ${
              view.mode === 'ai_detailed'
                ? 'bg-violet-500/20 text-violet-300 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {view.labels.aiData}
          </button>
          <button
            onClick={() => view.onModeChange('detailed')}
            className={`px-3 py-1 text-[10px] font-bold rounded-sm transition-all ${
              view.mode === 'detailed'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {view.labels.detailed}
          </button>
          <button
            onClick={() => view.onModeChange('compact')}
            className={`px-3 py-1 text-[10px] font-bold rounded-sm transition-all ${
              view.mode === 'compact'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {view.labels.compact}
          </button>
        </div>
      </div>
    </div>
  );
}
