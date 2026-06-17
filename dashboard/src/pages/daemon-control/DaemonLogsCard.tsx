import { RefreshCw, ScrollText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DaemonControlController } from '@/hooks/useDaemonControlController';

type DaemonLogsCardProps = Pick<
  DaemonControlController,
  | 'autoRefresh'
  | 'logLines'
  | 'logs'
  | 'logsContainerRef'
  | 'logsEndRef'
  | 'refreshAll'
  | 't'
  | 'toggleAutoRefresh'
>;

export function DaemonLogsCard({
  autoRefresh,
  logLines,
  logs,
  logsContainerRef,
  logsEndRef,
  refreshAll,
  t,
  toggleAutoRefresh,
}: DaemonLogsCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <ScrollText className="size-4" />
          {t('daemon_page.logs_title')}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={toggleAutoRefresh}
              className={`min-h-8 rounded px-2 py-0.5 text-xs ${
                autoRefresh
                  ? 'bg-accent text-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {autoRefresh
                ? t('daemon_page.auto_refresh_on')
                : t('daemon_page.auto_refresh_off')}
            </button>
            <Button
              variant="ghost"
              size="sm"
              className="size-8 p-0 sm:size-7"
              onClick={() => refreshAll()}
            >
              <RefreshCw className="size-4 sm:size-3.5" />
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          ref={logsContainerRef}
          className="h-96 overflow-y-auto rounded-md border bg-black/50 p-3 font-mono text-xs leading-5"
        >
          {logs ? (
            logLines.map((entry) => (
              <div key={entry.key} className={entry.className}>
                {entry.line}
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">{t('daemon_page.no_logs')}</p>
          )}
          <div ref={logsEndRef} />
        </div>
      </CardContent>
    </Card>
  );
}
