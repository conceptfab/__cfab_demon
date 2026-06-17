import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { Button } from '@/components/ui/button';
import { SegmentedGroup, SegmentedItem } from '@/components/ui/SegmentedControl';

const SIDE_SLOT = 'size-9 shrink-0';

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
    group: string;
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
    group: string;
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
  const dateNavigation = (
    <div className="flex min-w-0 items-center justify-center gap-0.5">
      <AppTooltip content={range.labels.previousTooltip}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={range.labels.previousTooltip}
          className={SIDE_SLOT}
          onClick={range.onShiftBackward}
        >
          <ChevronLeft className="size-4" />
        </Button>
      </AppTooltip>
      <span className="min-w-[4.5rem] whitespace-nowrap text-center text-xs text-muted-foreground">
        {range.label}
      </span>
      <AppTooltip content={range.labels.nextTooltip}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={range.labels.nextTooltip}
          className={SIDE_SLOT}
          onClick={range.onShiftForward}
          disabled={!range.canShiftForward}
        >
          <ChevronRight className="size-4" />
        </Button>
      </AppTooltip>
    </div>
  );

  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">
        {summary.text}
        {summary.showUnassignedOnly && (
          <span className="ml-2 font-bold text-amber-400/80 select-none">
            {summary.unassignedOnlyText}
          </span>
        )}
        {summary.showUnassignedOnly && summary.unassignedScopeText && (
          <span className="ml-1 text-[11px] font-semibold text-amber-300/70 select-none">
            {summary.unassignedScopeText}
          </span>
        )}
      </p>

      <div className="flex w-full min-w-0 flex-col gap-2 md:hidden">
        <SegmentedGroup aria-label={range.labels.group}>
          <SegmentedItem
            active={range.mode === 'daily'}
            onClick={() => {
              range.onModeChange('daily');
              range.onClearOverrideRange();
            }}
          >
            {range.labels.today}
          </SegmentedItem>
          <SegmentedItem
            active={range.mode === 'weekly'}
            onClick={() => {
              range.onModeChange('weekly');
              range.onClearOverrideRange();
            }}
          >
            {range.labels.week}
          </SegmentedItem>
        </SegmentedGroup>

        <div className="grid w-full grid-cols-[2.25rem_1fr_2.25rem] items-center">
          <span className={SIDE_SLOT} aria-hidden />
          {dateNavigation}
          <span className={SIDE_SLOT} aria-hidden />
        </div>

        <SegmentedGroup aria-label={view.labels.group}>
          <SegmentedItem
            active={view.mode === 'ai_detailed'}
            onClick={() => view.onModeChange('ai_detailed')}
          >
            {view.labels.aiData}
          </SegmentedItem>
          <SegmentedItem
            active={view.mode === 'detailed'}
            onClick={() => view.onModeChange('detailed')}
          >
            {view.labels.detailed}
          </SegmentedItem>
          <SegmentedItem
            active={view.mode === 'compact'}
            onClick={() => view.onModeChange('compact')}
          >
            {view.labels.compact}
          </SegmentedItem>
        </SegmentedGroup>
      </div>

      <div className="hidden min-w-0 flex-wrap items-center justify-end gap-2 md:flex">
        <SegmentedGroup aria-label={range.labels.group} className="w-auto">
          <SegmentedItem
            active={range.mode === 'daily'}
            onClick={() => {
              range.onModeChange('daily');
              range.onClearOverrideRange();
            }}
            className="px-3 sm:flex-none"
          >
            {range.labels.today}
          </SegmentedItem>
          <SegmentedItem
            active={range.mode === 'weekly'}
            onClick={() => {
              range.onModeChange('weekly');
              range.onClearOverrideRange();
            }}
            className="px-3 sm:flex-none"
          >
            {range.labels.week}
          </SegmentedItem>
        </SegmentedGroup>

        <div className="mx-0.5 h-4 w-px bg-border" />
        {dateNavigation}

        <div className="mx-0.5 h-4 w-px bg-border" />

        <SegmentedGroup aria-label={view.labels.group} className="w-auto">
          <SegmentedItem
            active={view.mode === 'ai_detailed'}
            onClick={() => view.onModeChange('ai_detailed')}
            className="px-3 sm:flex-none"
          >
            {view.labels.aiData}
          </SegmentedItem>
          <SegmentedItem
            active={view.mode === 'detailed'}
            onClick={() => view.onModeChange('detailed')}
            className="px-3 sm:flex-none"
          >
            {view.labels.detailed}
          </SegmentedItem>
          <SegmentedItem
            active={view.mode === 'compact'}
            onClick={() => view.onModeChange('compact')}
            className="px-3 sm:flex-none"
          >
            {view.labels.compact}
          </SegmentedItem>
        </SegmentedGroup>
      </div>
    </div>
  );
}
