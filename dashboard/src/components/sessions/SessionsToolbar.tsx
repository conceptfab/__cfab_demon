import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { Button } from '@/components/ui/button';

type RangeMode = 'daily' | 'weekly';
type ViewMode = 'detailed' | 'compact' | 'ai_detailed';

interface SessionsToolbarProps {
  summaryText: string;
  showUnassignedOnly: boolean;
  unassignedOnlyText: string;
  rangeMode: RangeMode;
  onRangeModeChange: (mode: RangeMode) => void;
  onClearOverrideRange: () => void;
  rangeTodayLabel: string;
  rangeWeekLabel: string;
  previousTooltip: string;
  nextTooltip: string;
  rangeLabel: string;
  onShiftBackward: () => void;
  onShiftForward: () => void;
  canShiftForward: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  viewAiDataLabel: string;
  viewDetailedLabel: string;
  viewCompactLabel: string;
}

export function SessionsToolbar({
  summaryText,
  showUnassignedOnly,
  unassignedOnlyText,
  rangeMode,
  onRangeModeChange,
  onClearOverrideRange,
  rangeTodayLabel,
  rangeWeekLabel,
  previousTooltip,
  nextTooltip,
  rangeLabel,
  onShiftBackward,
  onShiftForward,
  canShiftForward,
  viewMode,
  onViewModeChange,
  viewAiDataLabel,
  viewDetailedLabel,
  viewCompactLabel,
}: SessionsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
      <p className="text-xs text-muted-foreground font-medium flex items-baseline gap-1">
        {summaryText}
        {showUnassignedOnly && (
          <span className="text-amber-400/80 ml-2 font-bold select-none">
            {unassignedOnlyText}
          </span>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-secondary/20 p-0.5 rounded border border-border/20">
          <Button
            variant={rangeMode === 'daily' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 text-[10px] px-3 font-bold"
            onClick={() => {
              onRangeModeChange('daily');
              onClearOverrideRange();
            }}
          >
            {rangeTodayLabel}
          </Button>
          <Button
            variant={rangeMode === 'weekly' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 text-[10px] px-3 font-bold"
            onClick={() => {
              onRangeModeChange('weekly');
              onClearOverrideRange();
            }}
          >
            {rangeWeekLabel}
          </Button>
        </div>
        <div className="mx-1 h-4 w-px bg-border/40" />
        <div className="flex items-center gap-1">
          <AppTooltip content={previousTooltip}>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onShiftBackward}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
          </AppTooltip>
          <span className="text-[10px] font-mono font-bold text-muted-foreground/80 min-w-[5rem] text-center">
            {rangeLabel}
          </span>
          <AppTooltip content={nextTooltip}>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onShiftForward}
              disabled={!canShiftForward}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </AppTooltip>
        </div>
        <div className="mx-1 h-4 w-px bg-border/40" />
        <div className="flex bg-secondary/30 p-0.5 rounded border border-border/20">
          <button
            onClick={() => onViewModeChange('ai_detailed')}
            className={`px-3 py-1 text-[10px] font-bold rounded-sm transition-all ${
              viewMode === 'ai_detailed'
                ? 'bg-violet-500/20 text-violet-300 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {viewAiDataLabel}
          </button>
          <button
            onClick={() => onViewModeChange('detailed')}
            className={`px-3 py-1 text-[10px] font-bold rounded-sm transition-all ${
              viewMode === 'detailed'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {viewDetailedLabel}
          </button>
          <button
            onClick={() => onViewModeChange('compact')}
            className={`px-3 py-1 text-[10px] font-bold rounded-sm transition-all ${
              viewMode === 'compact'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {viewCompactLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
