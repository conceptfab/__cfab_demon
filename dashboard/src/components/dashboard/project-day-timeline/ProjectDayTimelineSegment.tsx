import {
  Flame,
  MessageSquare,
  MousePointerClick,
  Sparkles,
} from 'lucide-react';

import { cn, formatMultiplierLabel } from '@/lib/utils';
import {
  fmtHourMinute,
  HATCH_STYLE,
  type SegmentData,
} from '@/components/dashboard/project-day-timeline/timeline-calculations';

interface ProjectDayTimelineSegmentProps {
  segment: SegmentData;
  rowName: string;
  rowColor: string;
  rangeStart: number;
  rangeSpan: number;
  coarsePointer: boolean;
  canOpenContextMenu: boolean;
  onSegmentContextMenu: (
    e: React.MouseEvent,
    segment: SegmentData,
    rowName: string,
    rowColor: string,
  ) => void;
  onManualSegmentContextMenu: (e: React.MouseEvent, segment: SegmentData) => void;
  mixedRateLabel: string;
}

export function ProjectDayTimelineSegment({
  segment,
  rowName,
  rowColor,
  rangeStart,
  rangeSpan,
  coarsePointer,
  canOpenContextMenu,
  onSegmentContextMenu,
  onManualSegmentContextMenu,
  mixedRateLabel,
}: ProjectDayTimelineSegmentProps) {
  const left = ((segment.startMs - rangeStart) / rangeSpan) * 100;
  const width = ((segment.endMs - segment.startMs) / rangeSpan) * 100;
  const fragmentCount = segment.fragmentCount ?? 1;
  const hasManyFragments = !segment.isManual && fragmentCount > 1;
  const hasBoostedRate = (segment.rateMultiplier ?? 1) > 1.000001;
  const multiplierLabel = segment.mixedRateMultiplier
    ? mixedRateLabel
    : formatMultiplierLabel(segment.rateMultiplier);
  const titleBase = segment.isManual
    ? `[Manual] ${segment.manualTitle}`
    : segment.appName;
  const titleFragments = hasManyFragments ? ` - ${fragmentCount} sessions` : '';
  const titleRate =
    hasBoostedRate || segment.mixedRateMultiplier
      ? ` - ($) ${multiplierLabel}`
      : '';
  const titleSuggestion =
    segment.hasSuggestion &&
    !segment.isManual &&
    segment.suggestedProjectName
      ? ` - AI Suggests: ${segment.suggestedProjectName}${
          segment.suggestedConfidence != null
            ? ` (${(segment.suggestedConfidence * 100).toFixed(0)}%)`
            : ''
        } (Right-click to assign)`
      : '';
  const segmentTitle = `${titleBase}: ${fmtHourMinute(segment.startMs)} - ${fmtHourMinute(segment.endMs)}${titleFragments}${titleRate}${titleSuggestion}`;

  const segmentClickHandler = coarsePointer
    ? !segment.isManual
      ? (e: React.MouseEvent | React.KeyboardEvent) =>
          onSegmentContextMenu(e as React.MouseEvent, segment, rowName, rowColor)
      : segment.isManual
        ? (e: React.MouseEvent | React.KeyboardEvent) =>
            onManualSegmentContextMenu(e as React.MouseEvent, segment)
        : undefined
    : undefined;

  const SegmentTag = coarsePointer ? 'button' : 'div';

  return (
    <SegmentTag
      key={`${rowName}-${segment.startMs}-${segment.endMs}`}
      type={coarsePointer ? 'button' : undefined}
      className={cn(
        'absolute top-1 bottom-1 rounded-sm border-0 p-0',
        canOpenContextMenu && 'cursor-context-menu',
        coarsePointer && 'cursor-pointer',
      )}
      style={{
        left: `${Math.max(0, Math.min(100, left))}%`,
        width: `${Math.max(0.8, Math.min(100, width))}%`,
        backgroundColor: rowColor,
        opacity: 0.9,
      }}
      title={segmentTitle}
      aria-label={coarsePointer ? segmentTitle : undefined}
      onContextMenu={
        !segment.isManual
          ? (e) => onSegmentContextMenu(e, segment, rowName, rowColor)
          : segment.isManual
            ? (e) => onManualSegmentContextMenu(e, segment)
            : undefined
      }
      onClick={segmentClickHandler}
      onKeyDown={
        coarsePointer && segmentClickHandler
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                segmentClickHandler(e);
              }
            }
          : undefined
      }
    >
      {segment.isManual && (
        <div className="absolute inset-0 rounded-sm" style={HATCH_STYLE} />
      )}
      {segment.hasSuggestion && !segment.isManual && (
        <div className="pointer-events-none absolute left-0.5 top-0.5 flex items-center justify-center rounded bg-black/40 p-[2px] shadow-sm">
          <Sparkles className="size-2.5 text-sky-300" />
        </div>
      )}
      {segment.comment && (
        <div className="pointer-events-none absolute left-0.5 bottom-0.5 flex items-center justify-center rounded bg-black/40 p-[2px] shadow-sm border border-amber-500/30">
          <MessageSquare className="size-3 text-amber-500 fill-amber-500/20" />
        </div>
      )}
      {segment.isManual && (
        <div className="pointer-events-none absolute left-0.5 top-0.5 flex items-center justify-center rounded bg-black/40 p-[2px] shadow-sm">
          <MousePointerClick className="size-2.5 text-sky-300" />
        </div>
      )}
      {(segment.rateMultiplier ?? 1) > 1.000001 && (
        <div className="pointer-events-none absolute right-0.5 top-0.5 flex items-center justify-center rounded bg-black/35 p-[1px] shadow-sm">
          <Flame className="size-3 text-emerald-400" />
        </div>
      )}
    </SegmentTag>
  );
}
