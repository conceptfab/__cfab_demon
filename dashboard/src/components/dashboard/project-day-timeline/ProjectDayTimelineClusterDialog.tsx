import { Flame } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDuration, formatMultiplierLabel } from '@/lib/utils';
import {
  fmtHourMinute,
} from '@/components/dashboard/project-day-timeline/timeline-calculations';
import type { ProjectDayTimelineController } from '@/hooks/useProjectDayTimelineController';

type ProjectDayTimelineClusterDialogProps = Pick<
  ProjectDayTimelineController,
  'clusterDetails' | 'clusterDetailsSummary' | 'setClusterDetails' | 't'
>;

export function ProjectDayTimelineClusterDialog({
  clusterDetails,
  clusterDetailsSummary,
  setClusterDetails,
  t,
}: ProjectDayTimelineClusterDialogProps) {
  return (
    <Dialog
      open={clusterDetails !== null}
      onOpenChange={(open) => {
        if (!open) setClusterDetails(null);
      }}
    >
      <DialogContent className="max-w-3xl">
        {clusterDetails && clusterDetailsSummary && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span
                  className="inline-block size-2.5 rounded-full"
                  style={{ backgroundColor: clusterDetails.rowColor }}
                />
                <span className="truncate">
                  {t('project_day_timeline.text.session_details')}
                </span>
              </DialogTitle>
            </DialogHeader>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-md border p-3">
                <p className="text-[11px] text-muted-foreground">
                  {t('project_day_timeline.text.project')}
                </p>
                <p
                  className="truncate text-sm font-medium"
                  title={clusterDetails.rowName}
                >
                  {clusterDetails.rowName}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-[11px] text-muted-foreground">
                  {t('project_day_timeline.text.time_range')}
                </p>
                <p className="text-sm font-mono">
                  {fmtHourMinute(clusterDetails.segment.startMs)} -{' '}
                  {fmtHourMinute(clusterDetails.segment.endMs)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t('project_day_timeline.text.span')}{' '}
                  {formatDuration(
                    Math.round(clusterDetailsSummary.spanMs / 1000),
                  )}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-[11px] text-muted-foreground">
                  {t('project_day_timeline.text.sessions')}
                </p>
                <p className="text-sm font-medium">
                  {clusterDetailsSummary.sessionIds.length}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {clusterDetailsSummary.appNames.length}{' '}
                  {t('project_day_timeline.text.app')}
                  {clusterDetailsSummary.appNames.length === 1
                    ? ''
                    : t('project_day_timeline.text.s')}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-[11px] text-muted-foreground">
                  {t('project_day_timeline.text.activity')}
                </p>
                <p className="text-sm font-mono">
                  {formatDuration(
                    Math.round(clusterDetailsSummary.unionMs / 1000),
                  )}
                </p>
                {clusterDetailsSummary.overlapMs > 0 && (
                  <p className="text-[11px] text-amber-300">
                    {t('project_day_timeline.text.overlap')} +
                    {formatDuration(
                      Math.round(clusterDetailsSummary.overlapMs / 1000),
                    )}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {t('project_day_timeline.text.apps_in_chunk')}
                </span>
                {clusterDetailsSummary.appNames.map((appName) => (
                  <Badge key={appName} variant="secondary" className="text-[10px]">
                    {appName}
                  </Badge>
                ))}
                {clusterDetailsSummary.boostedCount > 0 && (
                  <Badge
                    variant="outline"
                    className="text-[10px] border-emerald-500/40 text-emerald-300 gap-1 flex items-center"
                  >
                    <Flame className="size-2.5" />
                    <span>
                      {clusterDetailsSummary.boostedCount}/
                      {clusterDetailsSummary.fragments.length}
                    </span>
                  </Badge>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('project_day_timeline.text.sessions_inside_merged_chunk')}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t('project_day_timeline.text.sum_durations')}{' '}
                  {formatDuration(
                    Math.round(clusterDetailsSummary.sumMs / 1000),
                  )}
                </p>
              </div>
              <div className="max-h-[50vh] space-y-1 overflow-y-auto rounded-md border p-2">
                {clusterDetailsSummary.fragments.map((f) => {
                  const durationSec = Math.max(
                    0,
                    Math.round((f.endMs - f.startMs) / 1000),
                  );
                  const multiplierValue = f.rateMultiplier ?? 1;
                  return (
                    <div
                      key={`${f.sessionId}-${f.startMs}-${f.endMs}`}
                      className="flex items-center justify-between gap-3 rounded border border-border/60 px-2 py-1.5 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">
                            {f.appName}
                          </span>
                          {multiplierValue > 1.000_001 && (
                            <Badge
                              variant="outline"
                              className="h-4 text-[10px] border-emerald-500/40 text-emerald-300 gap-1 flex items-center"
                            >
                              <Flame className="size-2.5" />
                              <span>
                                {formatMultiplierLabel(multiplierValue)}
                              </span>
                            </Badge>
                          )}
                        </div>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {fmtHourMinute(f.startMs)} - {fmtHourMinute(f.endMs)}{' '}
                          - id {f.sessionId}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono">{formatDuration(durationSec)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
