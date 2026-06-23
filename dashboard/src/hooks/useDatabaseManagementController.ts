import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';

import { useToast } from '@/components/ui/toast-notification';
import { databaseApi } from '@/lib/tauri';
import type { DataFolderStats, DatabaseSettings, DbInfo } from '@/lib/db-types';
import { formatBytes, logTauriError } from '@/lib/utils';

export function useDatabaseManagementController() {
  const { t } = useTranslation();
  const { showError, showInfo } = useToast();

  const [info, setInfo] = useState<DbInfo | null>(null);
  const [settings, setSettings] = useState<DatabaseSettings | null>(null);
  const [folderStats, setFolderStats] = useState<DataFolderStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [dbInfo, dbSettings, stats] = await Promise.all([
        databaseApi.getDbInfo(),
        databaseApi.getDatabaseSettings(),
        databaseApi.getDataFolderStats(),
      ]);
      setInfo(dbInfo);
      setSettings(dbSettings);
      setFolderStats(stats);
    } catch (e) {
      logTauriError('load database management data', e);
      showError(String(e));
    }
  }, [showError]);

  useEffect(() => {
    // loadAll() ustawia 3 stany (info/settings/folderStats) i jest reużywany
    // przez handleVacuum/handleOptimize/handleManualBackup/handleBrowseBackup/
    // handleToggleSetting/saveSettings/handleCleanup. useAsyncData nie obsługuje
    // wielu niezależnych pól danych ani callbacków reużywanych w handlerach.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- multi-state loader reused in multiple event handlers; useAsyncData doesn't fit
    void loadAll();
  }, [loadAll]);

  const handleVacuum = async () => {
    setLoading(true);
    try {
      await databaseApi.vacuumDatabase();
      showInfo(t('data_page.database_management.database_vacuumed_successfully'));
      void loadAll();
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
      await databaseApi.optimizeDatabase();
      showInfo(t('data_page.database_management.database_optimized_successfully'));
      void loadAll();
    } catch (e) {
      showError(
        t('data_page.database_management.optimization_failed', {
          error: String(e),
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleManualBackup = async () => {
    if (!settings?.backup_path) {
      showError(
        t('data_page.database_management.please_configure_a_backup_path_first'),
      );
      return;
    }
    setLoading(true);
    try {
      const path = await databaseApi.performManualBackup();
      showInfo(
        t('data_page.database_management.backup_created', {
          path,
        }),
      );
      void loadAll();
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
      await databaseApi.openDbFolder();
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
      if (selected && typeof selected === 'string' && settings) {
        const nextSettings = { ...settings, backup_path: selected };
        setSettings(nextSettings);
        try {
          await databaseApi.updateDatabaseSettings(nextSettings);
          showInfo(t('data_page.database_management.backup_path_updated'));
          void loadAll();
        } catch (e: unknown) {
          showError(
            t('data_page.database_management.failed_to_save_path', {
              error: String(e),
            }),
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
      await databaseApi.updateDatabaseSettings(nextSettings);
      void loadAll();
    } catch {
      showError(t('data_page.database_management.failed_to_update_setting'));
      setSettings(settings);
    }
  };

  const handleBackupIntervalChange = (val: string) => {
    if (!settings) return;
    const days = parseInt(val, 10) || 1;
    setSettings((prev) => ({ ...prev!, backup_interval_days: days }));
  };

  const saveSettings = async (successMessage: string, errorMessage: string) => {
    if (!settings) return;
    setSaving(true);
    try {
      await databaseApi.updateDatabaseSettings(settings);
      showInfo(successMessage);
      void loadAll();
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
        filters: [
          {
            name: t('data_page.database_management.sqlite_database'),
            extensions: ['db'],
          },
        ],
        multiple: false,
        title: t('data_page.database_management.select_database_file_to_restore'),
      });
      if (selected && typeof selected === 'string') {
        if (
          confirm(
            t(
              'data_page.database_management.warning_all_current_data_will_be_lost_continue',
            ),
          )
        ) {
          setLoading(true);
          try {
            await databaseApi.restoreDatabaseFromFile(selected);
            showInfo(
              t('data_page.database_management.database_restored_please_restart_the_app'),
            );
          } catch (e: unknown) {
            showError(
              t('data_page.database_management.restore_failed', {
                error: String(e),
              }),
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
      const result = await databaseApi.cleanupDataFolder();
      showInfo(
        t('data_page.database_management.cleanup_success', {
          count: result.files_deleted,
          size: formatBytes(result.bytes_freed),
        }),
      );
      void loadAll();
    } catch (e) {
      showError(
        t('data_page.database_management.cleanup_failed', { error: String(e) }),
      );
    } finally {
      setCleaning(false);
    }
  };

  const updateOptimizeIntervalHours = (raw: string) => {
    setSettings((prev) => ({
      ...prev!,
      auto_optimize_interval_hours: Math.max(
        1,
        Math.min(24 * 30, parseInt(raw, 10) || 1),
      ),
    }));
  };

  return {
    cleaning,
    folderStats,
    handleBackupIntervalChange,
    handleBrowseBackup,
    handleCleanup,
    handleManualBackup,
    handleOpenFolder,
    handleOptimize,
    handleRestore,
    handleToggleSetting,
    handleVacuum,
    info,
    loading,
    saveBackupInterval,
    saveOptimizeInterval,
    saving,
    settings,
    t,
    updateOptimizeIntervalHours,
  };
}

export type DatabaseManagementController = ReturnType<
  typeof useDatabaseManagementController
>;
