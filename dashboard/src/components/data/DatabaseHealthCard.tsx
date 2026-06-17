import {
  Clock,
  Database,
  FileUp,
  FolderOpen,
  Save,
  Wind,
  Zap,
} from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { formatBytes } from '@/lib/utils';
import type { DatabaseManagementController } from '@/hooks/useDatabaseManagementController';

type DatabaseHealthCardProps = Pick<
  DatabaseManagementController,
  | 'handleOpenFolder'
  | 'handleOptimize'
  | 'handleRestore'
  | 'handleToggleSetting'
  | 'handleVacuum'
  | 'info'
  | 'loading'
  | 'saveOptimizeInterval'
  | 'saving'
  | 'settings'
  | 't'
  | 'updateOptimizeIntervalHours'
>;

export function DatabaseHealthCard({
  handleOpenFolder,
  handleOptimize,
  handleRestore,
  handleToggleSetting,
  handleVacuum,
  info,
  loading,
  saveOptimizeInterval,
  saving,
  settings,
  t,
  updateOptimizeIntervalHours,
}: DatabaseHealthCardProps) {
  if (!settings || !info) return null;

  return (
    <Card className="overflow-hidden border-border/40 bg-background/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Database className="size-4 text-blue-500" />
          {t('data_page.database_management.database_health')}
        </CardTitle>
        <CardDescription className="text-xs">
          {t('data_page.database_management.monitor_and_optimize_your_local_database')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-3 rounded-md bg-accent/30 border border-border/20">
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              {t('data_page.database_management.database_size')}
            </p>
            <p className="text-lg font-bold">{formatBytes(info.size_bytes)}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-2"
            onClick={handleVacuum}
            disabled={loading}
          >
            <Wind className="size-3.5" />
            {t('data_page.database_management.run_vacuum')}
          </Button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm">
                {t('data_page.database_management.vacuum_on_startup')}
              </Label>
              <p className="text-[10px] text-muted-foreground">
                {t('data_page.database_management.keep_database_optimized_automatically')}
              </p>
            </div>
            <Switch
              checked={settings.vacuum_on_startup}
              onCheckedChange={() => handleToggleSetting('vacuum_on_startup')}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm">
                {t('data_page.database_management.auto_optimize')}
              </Label>
              <p className="text-[10px] text-muted-foreground">
                {t('data_page.database_management.run_smart_optimization_automatically_on_schedule')}
              </p>
            </div>
            <Switch
              checked={settings.auto_optimize_enabled}
              onCheckedChange={() => handleToggleSetting('auto_optimize_enabled')}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-semibold text-muted-foreground">
              {t('data_page.database_management.optimize_interval_hours')}
            </Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min="1"
                max={24 * 30}
                value={settings.auto_optimize_interval_hours}
                onChange={(e) => updateOptimizeIntervalHours(e.target.value)}
                className="h-8 text-[11px]"
              />
              <AppTooltip
                content={t('data_page.database_management.save_optimize_interval')}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  onClick={saveOptimizeInterval}
                  disabled={saving}
                >
                  <Save className="size-3.5" />
                </Button>
              </AppTooltip>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] font-medium py-1.5">
            <Clock className="size-3 text-muted-foreground" />
            {t('data_page.database_management.last_optimization')}{' '}
            {settings.last_optimize_at
              // eslint-disable-next-line react-doctor/rendering-hydration-mismatch-time -- No SSR (Tauri client app)
              ? new Date(settings.last_optimize_at).toLocaleString()
              : t('data_page.database_management.never')}
          </div>

          <div className="pt-2 flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="w-full gap-2 h-8 text-[11px]"
              onClick={handleOpenFolder}
            >
              <FolderOpen className="size-3.5" />
              {t('data_page.database_management.open_db_folder')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2 h-8 text-[11px]"
              onClick={handleOptimize}
              disabled={loading}
            >
              <Zap className="size-3.5" />
              {t('data_page.database_management.optimize_now')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2 h-8 text-[11px] text-amber-500 hover:text-amber-600"
              onClick={handleRestore}
            >
              <FileUp className="size-3.5" />
              {t('data_page.database_management.restore_db')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
