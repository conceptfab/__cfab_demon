import {
  Cpu,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
} from 'lucide-react';

import { AppTooltip } from '@/components/ui/app-tooltip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DaemonControlController } from '@/hooks/useDaemonControlController';
import { mobileLayout } from '@/lib/mobile-layout';
import { cn, formatPathForDisplay } from '@/lib/utils';

type DaemonStatusCardProps = Pick<
  DaemonControlController,
  | 'filteredUnassigned'
  | 'handleRestart'
  | 'handleStart'
  | 'handleStop'
  | 'loading'
  | 'refreshAll'
  | 'status'
  | 't'
>;

export function DaemonStatusCard({
  filteredUnassigned,
  handleRestart,
  handleStart,
  handleStop,
  loading,
  refreshAll,
  status,
  t,
}: DaemonStatusCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <Cpu className="size-4" />
          {t('daemon_page.status_title')}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto size-8 p-0 sm:size-7"
            onClick={() => refreshAll({ includeLogs: false })}
          >
            <RefreshCw className="size-4 sm:size-3.5" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div
            className={`size-3 rounded-full ${
              status?.running
                ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
            }`}
          />
          <div>
            <p className="text-sm font-medium">
              {status?.running
                ? t('daemon_page.running')
                : t('daemon_page.stopped')}
            </p>
            {status?.pid && (
              <p className="text-xs text-muted-foreground">PID: {status.pid}</p>
            )}
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {status?.version && (
              <AppTooltip
                content={
                  status.is_compatible
                    ? t('daemon_page.daemon_version')
                    : t('daemon_page.version_incompatibility')
                }
              >
                <span
                  className={cn(
                    'text-[10px] font-mono cursor-default',
                    status.is_compatible
                      ? 'text-muted-foreground/50'
                      : 'text-destructive font-bold',
                  )}
                >
                  v{status.version} {!status.is_compatible && '!'}
                </span>
              </AppTooltip>
            )}
            <Badge variant={status?.running ? 'default' : 'destructive'}>
              {status?.running
                ? t('daemon_page.active')
                : t('daemon_page.inactive')}
            </Badge>
          </div>
        </div>

        {filteredUnassigned > 0 && (
          <div className={mobileLayout.alertBox}>
            <span className="font-semibold mr-1">*</span>
            <span>
              {t('daemon_page.unassigned_sessions_hint', {
                count: filteredUnassigned,
              })}
            </span>
          </div>
        )}

        {status?.exe_path && (
          <p
            className="break-all text-xs font-mono text-muted-foreground"
            title={formatPathForDisplay(status.exe_path)}
          >
            {formatPathForDisplay(status.exe_path)}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          {status?.running ? (
            <>
              <Button
                variant="destructive"
                size="sm"
                className="h-11 min-w-0 justify-start gap-2 px-3 sm:h-9"
                onClick={handleStop}
                disabled={!!loading}
              >
                <Square className="size-4 shrink-0" />
                <span className="truncate text-[11px] sm:text-xs">
                  {loading === 'stop'
                    ? t('daemon_page.stopping')
                    : t('daemon_page.stop')}
                </span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-11 min-w-0 justify-start gap-2 px-3 sm:h-9"
                onClick={handleRestart}
                disabled={!!loading}
              >
                <RotateCcw className="size-4 shrink-0" />
                <span className="truncate text-[11px] sm:text-xs">
                  {loading === 'restart'
                    ? t('daemon_page.restarting')
                    : t('daemon_page.restart')}
                </span>
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              className="col-span-2 h-11 justify-start gap-2.5 px-4 sm:h-9"
              onClick={handleStart}
              disabled={!!loading}
            >
              <Play className="size-4 shrink-0" />
              <span className="truncate">
                {loading === 'start'
                  ? t('daemon_page.starting')
                  : t('daemon_page.start')}
              </span>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
