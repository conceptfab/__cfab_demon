import type { ElementType } from 'react';
import {
  CircleDollarSign,
  CircleOff,
  LayoutDashboard,
  MessageSquare,
  MousePointerClick,
  RefreshCw,
  Snowflake,
  TimerReset,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ProjectExtraInfo, ProjectWithStats } from '@/lib/db-types';
import { cn, formatDuration, formatMoney } from '@/lib/utils';

type ProjectEstimatesSectionProps = {
  project: ProjectWithStats;
  extraInfo: ProjectExtraInfo | null;
  estimate: number;
  currencyCode: string;
  busy: string | null;
  onResetTime: () => void;
  onToggleFreeze: () => void;
  onExclude: () => void;
  onCompact: () => void;
};

export function ProjectEstimatesSection({
  project,
  extraInfo,
  estimate,
  currencyCode,
  busy,
  onResetTime,
  onToggleFreeze,
  onExclude,
  onCompact,
}: ProjectEstimatesSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {t('project_page.text.project_overview')}
          </CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onResetTime}
              title={t('project_page.text.reset_time')}
            >
              <TimerReset className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={cn(project.frozen_at && 'bg-blue-500/10 text-blue-400')}
              onClick={onToggleFreeze}
              title={
                project.frozen_at
                  ? t('project_page.text.unfreeze_project')
                  : t('project_page.text.freeze_project')
              }
            >
              <Snowflake className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={onExclude}
              title={t('project_page.text.exclude_project')}
            >
              <CircleOff className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col gap-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t('project_page.text.total_time_value')}
            </p>
            <div className="flex items-baseline gap-4">
              <p className="text-4xl font-[200] text-emerald-400">
                {formatDuration(project.total_seconds)}
              </p>
              <span className="text-2xl font-[100] opacity-30">/</span>
              <p className="text-3xl font-[200] text-emerald-400/80">
                {formatMoney(estimate, currencyCode)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {(
              [
                {
                  label: t('project_page.text.sessions'),
                  value: extraInfo?.db_stats.session_count || 0,
                },
                {
                  label: t('project_page.text.manual_sessions'),
                  value: extraInfo?.db_stats.manual_session_count || 0,
                  icon: MousePointerClick,
                  iconBg: 'bg-orange-500/10',
                  iconText: 'text-orange-400',
                },
                {
                  label: t('project_page.text.comments'),
                  value: extraInfo?.db_stats.comment_count || 0,
                  icon: MessageSquare,
                  iconBg: 'bg-sky-500/10',
                  iconText: 'text-sky-400',
                },
                {
                  label: t('project_page.text.boosted_sessions'),
                  value: extraInfo?.db_stats.boosted_session_count || 0,
                  icon: CircleDollarSign,
                  iconBg: 'bg-emerald-500/10',
                  iconText: 'text-emerald-400',
                },
              ] as {
                label: string;
                value: number;
                icon?: ElementType;
                iconBg?: string;
                iconText?: string;
              }[]
            ).map(({ label, value, icon: Icon, iconBg, iconText }) => (
              <div
                key={label}
                className="flex flex-col justify-between rounded-lg border border-border/40 bg-secondary/20 p-4"
              >
                <p className="mb-1 text-[10px] font-bold uppercase text-muted-foreground">
                  {label}
                </p>
                <p className="flex items-center justify-between text-2xl font-light">
                  <span>{value}</span>
                  {Icon && value > 0 && (
                    <div
                      className={`flex h-6 w-6 items-center justify-center rounded ${iconBg} ${iconText}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                  )}
                </p>
              </div>
            ))}
          </div>

          {project.assigned_folder_path && (
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase text-muted-foreground">
                {t('project_page.text.assigned_folder')}
              </p>
              <p
                className="cursor-default truncate rounded bg-secondary/30 p-2 font-mono text-sm transition-colors hover:bg-secondary/50"
                title={project.assigned_folder_path}
              >
                {project.assigned_folder_path}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {t('project_page.text.top_applications')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {extraInfo?.top_apps.map((app, index) => (
              <div
                key={`${app.name}-${index}`}
                className="flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-secondary/20"
              >
                <div
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: app.color || '#64748b' }}
                />
                <span className="flex-1 truncate text-sm font-medium">
                  {app.name}
                </span>
                <span className="shrink-0 font-mono text-xs text-emerald-400">
                  {formatDuration(app.seconds)}
                </span>
              </div>
            ))}
            {(!extraInfo?.top_apps || extraInfo.top_apps.length === 0) && (
              <p className="py-4 text-center text-sm italic text-muted-foreground">
                {t('project_page.text.no_application_data_yet')}
              </p>
            )}
          </div>

          <div className="mt-6 border-t border-dashed border-border/60 pt-6">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-muted-foreground">
                {t('project_page.text.data_management')}
              </span>
              <Badge variant="outline" className="text-[10px] opacity-70">
                ~{((extraInfo?.db_stats.estimated_size_bytes || 0) / 1024).toFixed(1)} KB
              </Badge>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="w-full border-amber-500/20 bg-amber-500/10 text-xs text-amber-500 hover:bg-amber-500/20"
              onClick={onCompact}
              disabled={
                !extraInfo ||
                extraInfo.db_stats.file_activity_count === 0 ||
                !!busy
              }
            >
              {busy === 'compact' ? (
                <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <LayoutDashboard className="mr-2 h-3.5 w-3.5" />
              )}
              {t('project_page.text.compact_detailed_records')}
            </Button>
            <p className="mt-2 px-1 text-[10px] leading-tight text-muted-foreground">
              {t(
                'project_page.text.compaction_removes_detailed_file_level_history_while_pre',
              )}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
