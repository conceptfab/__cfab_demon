import { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Database,
  FolderOpen,
  Wind,
  Zap,
  Save,
  Clock,
  ShieldCheck,
  FileUp,
  Trash2,
} from "lucide-react";
import {
  getDbInfo,
  vacuumDatabase,
  optimizeDatabase,
  getDatabaseSettings,
  updateDatabaseSettings,
  openDbFolder,
  performManualBackup,
  restoreDatabaseFromFile,
  getDataFolderStats,
  cleanupDataFolder,
} from "@/lib/tauri";
import type { DbInfo, DatabaseSettings, DataFolderStats } from "@/lib/db-types";
import { open } from "@tauri-apps/plugin-dialog";
import { useToast } from "@/components/ui/toast-notification";
import { AppTooltip } from "@/components/ui/app-tooltip";
import { formatBytes } from "@/lib/utils";

export function DatabaseManagement() {
  const { t } = useTranslation();

  const [info, setInfo] = useState<DbInfo | null>(null);
  const [settings, setSettings] = useState<DatabaseSettings | null>(null);
  const [folderStats, setFolderStats] = useState<DataFolderStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const { showError, showInfo } = useToast();

  const loadAll = async () => {
    try {
      const [dbInfo, dbSettings, stats] = await Promise.all([
        getDbInfo(),
        getDatabaseSettings(),
        getDataFolderStats(),
      ]);
      setInfo(dbInfo);
      setSettings(dbSettings);
      setFolderStats(stats);
    } catch (e) {
      console.error("Failed to load database management data:", e);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleVacuum = async () => {
    setLoading(true);
    try {
      await vacuumDatabase();
      showInfo(t('data_page.database_management.database_vacuumed_successfully'));
      loadAll();
    } catch (e) {
      showError(
        t('data_page.database_management.vacuum_failed', {
          error: String(e),
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleOptimize = async () => {
    setLoading(true);
    try {
      await optimizeDatabase();
      showInfo(t('data_page.database_management.database_optimized_successfully'));
      loadAll();
    } catch (e) {
      showError(
        t('data_page.database_management.optimization_failed', { error: String(e) }),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleManualBackup = async () => {
    if (!settings?.backup_path) {
      showError(t('data_page.database_management.please_configure_a_backup_path_first'));
      return;
    }
    setLoading(true);
    try {
      const path = await performManualBackup();
      showInfo(
        t('data_page.database_management.backup_created', {
          path,
        }),
      );
      loadAll();
    } catch (e) {
      showError(
        t('data_page.database_management.backup_failed', {
          error: String(e),
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await openDbFolder();
    } catch {
      showError(t('data_page.database_management.failed_to_open_folder'));
    }
  };

  const handleBrowseBackup = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('data_page.database_management.select_backup_directory'),
      });
      if (selected && typeof selected === "string" && settings) {
        const nextSettings = { ...settings, backup_path: selected };
        setSettings(nextSettings);
        try {
          await updateDatabaseSettings(nextSettings);
          showInfo(t('data_page.database_management.backup_path_updated'));
          loadAll();
        } catch (e: unknown) {
          showError(
            t('data_page.database_management.failed_to_save_path', { error: String(e) }),
          );
        }
      }
    } catch (e: unknown) {
      console.error(e);
      showError(t('data_page.database_management.failed_to_open_directory_picker'));
    }
  };

  const handleToggleSetting = async (key: keyof DatabaseSettings) => {
    if (!settings) return;
    const nextSettings = { ...settings, [key]: !settings[key] };
    setSettings(nextSettings);
    try {
      await updateDatabaseSettings(nextSettings);
      loadAll();
    } catch {
      showError(t('data_page.database_management.failed_to_update_setting'));
      setSettings(settings);
    }
  };

  const handleBackupIntervalChange = (val: string) => {
    if (!settings) return;
    const days = parseInt(val, 10) || 1;
    setSettings({ ...settings, backup_interval_days: days });
  };

  const saveSettings = async (successMessage: string, errorMessage: string) => {
    if (!settings) return;
    setSaving(true);
    try {
      await updateDatabaseSettings(settings);
      showInfo(successMessage);
      loadAll();
    } catch {
      showError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const saveBackupInterval = async () =>
    saveSettings(
      t('data_page.database_management.backup_interval_updated'),
      t('data_page.database_management.failed_to_update_backup_interval'),
    );

  const saveOptimizeInterval = async () =>
    saveSettings(
      t('data_page.database_management.optimization_interval_updated'),
      t('data_page.database_management.failed_to_update_optimization_interval'),
    );

  const handleRestore = async () => {
    try {
      const selected = await open({
        filters: [{ name: t('data_page.database_management.sqlite_database'), extensions: ["db"] }],
        multiple: false,
        title: t('data_page.database_management.select_database_file_to_restore'),
      });
      if (selected && typeof selected === "string") {
        if (confirm(t('data_page.database_management.warning_all_current_data_will_be_lost_continue'))) {
          setLoading(true);
          try {
            await restoreDatabaseFromFile(selected);
            showInfo(t('data_page.database_management.database_restored_please_restart_the_app'));
          } catch (e: unknown) {
            showError(
              t('data_page.database_management.restore_failed', { error: String(e) }),
            );
          } finally {
            setLoading(false);
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleCleanup = async () => {
    if (!confirm(t('data_page.database_management.cleanup_confirm'))) return;
    setCleaning(true);
    try {
      const result = await cleanupDataFolder();
      showInfo(
        t('data_page.database_management.cleanup_success', {
          count: result.files_deleted,
          size: formatBytes(result.bytes_freed),
        }),
      );
      loadAll();
    } catch (e) {
      showError(
        t('data_page.database_management.cleanup_failed', { error: String(e) }),
      );
    } finally {
      setCleaning(false);
    }
  };

  if (!settings || !info) return null;

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="overflow-hidden border-border/40 bg-background/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Database className="h-4 w-4 text-blue-500" />
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
                <Wind className="h-3.5 w-3.5" />
                {t('data_page.database_management.run_vacuum')}
              </Button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">{t('data_page.database_management.vacuum_on_startup')}</Label>
                  <p className="text-[10px] text-muted-foreground">
                    {t('data_page.database_management.keep_database_optimized_automatically')}
                  </p>
                </div>
                <Switch
                  checked={settings.vacuum_on_startup}
                  onCheckedChange={() => handleToggleSetting("vacuum_on_startup")}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">{t('data_page.database_management.auto_optimize')}</Label>
                  <p className="text-[10px] text-muted-foreground">
                    {t('data_page.database_management.run_smart_optimization_automatically_on_schedule')}
                  </p>
                </div>
                <Switch
                  checked={settings.auto_optimize_enabled}
                  onCheckedChange={() => handleToggleSetting("auto_optimize_enabled")}
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
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        auto_optimize_interval_hours: Math.max(
                          1,
                          Math.min(24 * 30, parseInt(e.target.value, 10) || 1),
                        ),
                      })
                    }
                    className="h-8 text-[11px]"
                  />
                  <AppTooltip content={t('data_page.database_management.save_optimize_interval')}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={saveOptimizeInterval}
                      disabled={saving}
                    >
                      <Save className="h-3.5 w-3.5" />
                    </Button>
                  </AppTooltip>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] font-medium py-1.5">
                <Clock className="h-3 w-3 text-muted-foreground" />
                {t('data_page.database_management.last_optimization')}
                {" "}
                {settings.last_optimize_at
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
                  <FolderOpen className="h-3.5 w-3.5" />
                  {t('data_page.database_management.open_db_folder')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 h-8 text-[11px]"
                  onClick={handleOptimize}
                  disabled={loading}
                >
                  <Zap className="h-3.5 w-3.5" />
                  {t('data_page.database_management.optimize_now')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 h-8 text-[11px] text-amber-500 hover:text-amber-600"
                  onClick={handleRestore}
                >
                  <FileUp className="h-3.5 w-3.5" />
                  {t('data_page.database_management.restore_db')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-border/40 bg-background/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              {t('data_page.database_management.data_backups')}
            </CardTitle>
            <CardDescription className="text-xs">
              {t('data_page.database_management.secure_your_data_with_automatic_backups')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm">{t('data_page.database_management.automatic_backups')}</Label>
                <p className="text-[10px] text-muted-foreground">
                  {t('data_page.database_management.schedule_periodic_database_copies')}
                </p>
              </div>
              <Switch
                checked={settings.backup_enabled}
                onCheckedChange={() => handleToggleSetting("backup_enabled")}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-semibold text-muted-foreground">
                {t('data_page.database_management.backup_destination')}
              </Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={settings.backup_path || t('data_page.database_management.not_configured')}
                  className="h-8 text-[11px] bg-background/30"
                />
                <Button variant="outline" size="sm" className="h-8" onClick={handleBrowseBackup}>
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
                  <AppTooltip content={t('data_page.database_management.save_backup_interval')}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={saveBackupInterval}
                      disabled={saving}
                    >
                      <Save className="h-3.5 w-3.5" />
                    </Button>
                  </AppTooltip>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase font-semibold text-muted-foreground">
                  {t('data_page.database_management.last_backup')}
                </Label>
                <div className="flex items-center gap-1.5 text-[11px] font-medium py-1.5">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  {settings.last_backup_at
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
              <Save className="h-4 w-4" />
              {t('data_page.database_management.backup_now')}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden border-border/40 bg-background/50 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-amber-500" />
            {t('data_page.database_management.data_cleanup')}
          </CardTitle>
          <CardDescription className="text-xs">
            {t('data_page.database_management.cleanup_description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-3 rounded-md bg-accent/30 border border-border/20">
            <div className="space-y-0.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                {t('data_page.database_management.cleanup_files_label')}
              </p>
              <p className="text-sm font-medium">
                {folderStats && folderStats.file_count > 0
                  ? t('data_page.database_management.cleanup_files_found', {
                      count: folderStats.file_count,
                      size: formatBytes(folderStats.total_bytes),
                    })
                  : t('data_page.database_management.cleanup_no_files')}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-2 text-amber-500 hover:text-amber-600"
              onClick={handleCleanup}
              disabled={cleaning || !folderStats || folderStats.file_count === 0}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {cleaning
                ? t('data_page.database_management.cleanup_cleaning')
                : t('data_page.database_management.cleanup_button')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
