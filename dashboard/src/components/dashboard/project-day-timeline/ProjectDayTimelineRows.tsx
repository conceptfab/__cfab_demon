import { Flame } from 'lucide-react';

import { AppTooltip } from '@/components/ui/app-tooltip';
import { mobileLayout } from '@/lib/mobile-layout';
import { formatDuration } from '@/lib/utils';
import { ProjectDayTimelineSegment } from '@/components/dashboard/project-day-timeline/ProjectDayTimelineSegment';
import {
  fmtHourMinute,
  fmtHourShort,
  hexToRgba,
  normalizeProjectName,
} from '@/components/dashboard/project-day-timeline/timeline-calculations';
import type { ProjectDayTimelineController } from '@/hooks/useProjectDayTimelineController';

type ProjectDayTimelineRowsProps = Pick<
  ProjectDayTimelineController,
  | 'coarsePointer'
  | 'handleManualSegmentContextMenu'
  | 'handleSegmentContextMenu'
  | 'handleTimelineContextMenu'
  | 'mobileAxisTicks'
  | 'model'
  | 'onAddManualSession'
  | 'onAssignSession'
  | 'onUpdateSessionRateMultiplier'
  | 'projectIdByName'
  | 't'
>;

export function ProjectDayTimelineRows({
  coarsePointer,
  handleManualSegmentContextMenu,
  handleSegmentContextMenu,
  handleTimelineContextMenu,
  mobileAxisTicks,
  model,
  onAddManualSession,
  onAssignSession,
  onUpdateSessionRateMultiplier,
  projectIdByName,
  t,
}: ProjectDayTimelineRowsProps) {
  if (!model) return null;

  const unassigned = model.rows.find((row) => row.isUnassigned);
  const mixedRateLabel = t('project_day_timeline.text.mixed');
  const canOpenContextMenu = Boolean(
    onAssignSession || onUpdateSessionRateMultiplier,
  );

  return (
    <div className="space-y-3">
      {unassigned && (
        <div className={mobileLayout.alertBox}>
          <span className="font-semibold">
            {t('project_day_timeline.text.unassigned_sessions_detected')}
          </span>{' '}
          <span className="md:hidden">
            {t('project_day_timeline.text.tap_segment_to_assign')}
          </span>
          <span className="hidden md:inline">
            {t(
              'project_day_timeline.text.right_click_their_segments_to_assign_each_session_to_a_p',
            )}
          </span>
        </div>
      )}

      <div className="-mx-1 overflow-x-auto touch-pan-x px-1 md:mx-0 md:overflow-visible md:px-0">
        <div className="min-w-[36rem] space-y-3 md:min-w-0">
          {model.rows.map((row) => (
            <div
              key={row.name}
              className="space-y-1.5 border-b border-border/25 pb-3 last:border-b-0 md:grid md:grid-cols-[170px_1fr_130px] md:items-center md:gap-3 md:border-b-0 md:pb-0"
            >
              <div className="flex min-w-0 items-center justify-between gap-2 md:contents">
                <div
                  data-project-id={
                    row.isUnassigned
                      ? undefined
                      : projectIdByName.get(normalizeProjectName(row.name))
                  }
                  data-project-name={row.isUnassigned ? undefined : row.name}
                  className={`flex min-w-0 items-center gap-1 text-xs ${
                    row.isUnassigned
                      ? 'text-amber-300'
                      : 'text-muted-foreground'
                  }`}
                  title={row.name}
                >
                  <span
                    className="inline-block size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: row.color }}
                  />
                  <span className="truncate">{row.name}</span>
                  {row.boostedCount > 0 && (
                    <AppTooltip
                      content={t(
                        'project_day_timeline.text.boosted_sessions_count',
                        { count: row.boostedCount },
                      )}
                    >
                      <span className="shrink-0">
                        <Flame className="size-3 text-emerald-400" />
                      </span>
                    </AppTooltip>
                  )}
                </div>
                <div className="shrink-0 font-mono text-[11px] whitespace-nowrap md:hidden">
                  {formatDuration(row.totalSeconds)}
                </div>
              </div>

              <div
                className="relative h-8 rounded-md border border-border/60 bg-secondary/20 overflow-hidden md:h-7"
                onContextMenu={
                  onAddManualSession
                    ? (e) =>
                        handleTimelineContextMenu(
                          e,
                          model.rangeStart,
                          model.rangeSpan,
                        )
                    : undefined
                }
              >
                {model.workingRange && (
                  <div
                    className="absolute inset-y-0 pointer-events-none border-x"
                    style={{
                      left: `${model.workingRange.leftPct}%`,
                      width: `${model.workingRange.widthPct}%`,
                      borderColor: hexToRgba(model.workingRange.color, 0.42),
                      backgroundColor: hexToRgba(
                        model.workingRange.color,
                        0.14,
                      ),
                    }}
                    title={`Working hours: ${model.workingRange.label}`}
                  />
                )}
                {row.segments.map((segment) => (
                  <ProjectDayTimelineSegment
                    key={`${row.name}-${segment.startMs}-${segment.endMs}`}
                    segment={segment}
                    rowName={row.name}
                    rowColor={row.color}
                    rangeStart={model.rangeStart}
                    rangeSpan={model.rangeSpan}
                    coarsePointer={coarsePointer}
                    canOpenContextMenu={canOpenContextMenu}
                    onSegmentContextMenu={handleSegmentContextMenu}
                    onManualSegmentContextMenu={handleManualSegmentContextMenu}
                    mixedRateLabel={mixedRateLabel}
                  />
                ))}
              </div>

              <div className="hidden text-right font-mono text-xs whitespace-nowrap md:block">
                {formatDuration(row.totalSeconds)}
              </div>
            </div>
          ))}

          <div className="grid grid-cols-[1fr] items-start pt-1 md:grid-cols-[170px_1fr_130px] md:gap-3">
            <div className="hidden md:block" />
            <div className="relative h-7">
              {(coarsePointer ? mobileAxisTicks : model.ticks).map((tick) => {
                const left =
                  ((tick - model.rangeStart) / model.rangeSpan) * 100;
                return (
                  <div
                    key={tick}
                    className="absolute top-0 text-muted-foreground"
                    style={{ left: `${left}%`, transform: 'translateX(-50%)' }}
                  >
                    <div className="mx-auto h-2 w-px bg-border/70" />
                    <div className="mt-1 text-[9px] md:text-[10px]">
                      {coarsePointer
                        ? fmtHourShort(tick)
                        : fmtHourMinute(tick)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="hidden md:block" />
          </div>
        </div>
      </div>
    </div>
  );
}
