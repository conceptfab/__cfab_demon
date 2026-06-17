import { Clock, Save, ShieldCheck } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { AppTooltip } from '@/components/ui/app-tooltip';
import type { DatabaseManagementController } from '@/hooks/useDatabaseManagementController';

type DatabaseBackupCardProps = Pick<
  DatabaseManagementController,
  | 'handleBackupIntervalChange'
  | 'handleBrowseBackup'
  | 'handleManualBackup'
  | 'handleToggleSetting'
  | 'loading'
  | 'saveBackupInterval'
  | 'saving'
  | 'settings'
  | 't'
>;

export function DatabaseBackupCard({
  handleBackupIntervalChange,
  handleBrowseBackup,
  handleManualBackup,
  handleToggleSetting,
  loading,
  saveBackupInterval,
  saving,
  settings,
  t,
}: DatabaseBackupCardProps) {
  if (!settings) return null;

  return (
    <Card className="overflow-hidden border-border/40 bg-background/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <ShieldCheck className="size-4 text-emerald-500" />
          {t('data_page.database_management.data_backups')}
        </CardTitle>
        <CardDescription className="text-xs">
          {t('data_page.database_management.secure_your_data_with_automatic_backups')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm">
              {t('data_page.database_management.automatic_backups')}
            </Label>
            <p className="text-[10px] text-muted-foreground">
              {t('data_page.database_management.schedule_periodic_database_copies')}
            </p>
          </div>
          <Switch
            checked={settings.backup_enabled}
            onCheckedChange={() => handleToggleSetting('backup_enabled')}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-[10px] uppercase font-semibold text-muted-foreground">
            {t('data_page.database_management.backup_destination')}
          </Label>
          <div className="flex gap-2">
            <Input
              readOnly
              value={
                settings.backup_path ||
                t('data_page.database_management.not_configured')
              }
              className="h-8 text-[11px] bg-background/30"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={handleBrowseBackup}
            >
              {t('data_page.database_management.browse')}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-semibold text-muted-foreground">
              {t('data_page.database_management.interval_days')}
            </Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min="1"
                value={settings.backup_interval_days}
                onChange={(e) => handleBackupIntervalChange(e.target.value)}
                className="h-8 text-[11px]"
              />
              <AppTooltip
                content={t('data_page.database_management.save_backup_interval')}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  onClick={saveBackupInterval}
                  disabled={saving}
                >
                  <Save className="size-3.5" />
                </Button>
              </AppTooltip>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-semibold text-muted-foreground">
              {t('data_page.database_management.last_backup')}
            </Label>
            <div className="flex items-center gap-1.5 text-[11px] font-medium py-1.5">
              <Clock className="size-3 text-muted-foreground" />
              {settings.last_backup_at
                // eslint-disable-next-line react-doctor/rendering-hydration-mismatch-time -- No SSR (Tauri client app)
                ? new Date(settings.last_backup_at).toLocaleDateString()
                : t('data_page.database_management.never')}
            </div>
          </div>
        </div>

        <Button
          className="w-full gap-2 h-9 bg-emerald-600 hover:bg-emerald-700 text-white border-0 shadow-lg"
          onClick={handleManualBackup}
          disabled={loading}
        >
          <Save className="size-4" />
          {t('data_page.database_management.backup_now')}
        </Button>
      </CardContent>
    </Card>
  );
}
