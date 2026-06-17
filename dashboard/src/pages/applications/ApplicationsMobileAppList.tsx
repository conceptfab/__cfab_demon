import { Pencil, TimerReset, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { AppWithStats } from '@/lib/db-types';
import { formatDurationWithDaily } from '@/lib/utils';

interface ApplicationsMobileAppListProps {
  apps: AppWithStats[];
  editingColorId: number | null;
  formatLastUsedDate: (value: string | null) => string;
  handleDeleteApp: (app: AppWithStats) => void;
  handleRenameApp: (app: AppWithStats) => void;
  handleResetAppTime: (app: AppWithStats) => void;
  pendingColor: string | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function ApplicationsMobileAppList({
  apps,
  editingColorId,
  formatLastUsedDate,
  handleDeleteApp,
  handleRenameApp,
  handleResetAppTime,
  pendingColor,
  t,
}: ApplicationsMobileAppListProps) {
  return (
    <div className="space-y-2 p-3 md:hidden">
      {apps.map((app) => (
        <div
          key={app.id}
          className="space-y-3 rounded-md border border-border/60 p-3"
        >
          <div className="flex min-w-0 items-start gap-2">
            <span
              className="mt-1 size-3 shrink-0 rounded-full"
              style={{
                backgroundColor:
                  pendingColor && editingColorId === app.id
                    ? pendingColor
                    : app.color,
              }}
            />
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-medium">
                {app.display_name}
              </p>
              <p className="break-all text-xs text-muted-foreground">
                {app.executable_name}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-muted-foreground">
                {t('applications_page.table.total_time')}
              </p>
              <p className="font-mono text-sm">
                {formatDurationWithDaily(
                  app.total_seconds,
                  app.daily_seconds ?? [],
                )}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">
                {t('applications_page.table.sessions')}
              </p>
              <p className="font-mono text-sm">{app.session_count}</p>
            </div>
            <div>
              <p className="text-muted-foreground">
                {t('applications_page.table.last_used')}
              </p>
              <p className="text-sm">{formatLastUsedDate(app.last_used)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">
                {t('applications_page.table.project')}
              </p>
              <p className="break-words text-sm">
                {app.project_name ?? t('ui.common.not_available')}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => handleRenameApp(app)}>
              <Pencil className="mr-1.5 size-3.5" />
              {t('applications_page.tooltips.rename_app')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => handleResetAppTime(app)}>
              <TimerReset className="mr-1.5 size-3.5" />
              {t('applications_page.tooltips.reset_time')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => handleDeleteApp(app)}
            >
              <Trash2 className="mr-1.5 size-3.5" />
              {t('applications_page.tooltips.delete_app_and_sessions')}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
