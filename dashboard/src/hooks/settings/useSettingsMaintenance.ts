import { useCallback, useState } from 'react';
import type { TFunction } from 'i18next';
import { sessionsApi, settingsApi } from '@/lib/tauri';
import { getErrorMessage, logTauriWarn } from '@/lib/utils';

interface UseSettingsMaintenanceOptions {
  confirm: (message: string) => Promise<boolean>;
  gapFillMinutes: number;
  showError: (message: string) => void;
  showInfo: (message: string) => void;
  t: TFunction;
}

export function useSettingsMaintenance({
  confirm,
  gapFillMinutes,
  showError,
  showInfo,
  t,
}: UseSettingsMaintenanceOptions) {
  const [clearing, setClearing] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const handleRebuildSessions = useCallback(async () => {
    setRebuilding(true);
    try {
      const merged = await sessionsApi.rebuildSessions(gapFillMinutes);
      showInfo(
        t('settings_page.successfully_merged_close_sessions', { merged }),
      );
    } catch (e) {
      logTauriWarn('Settings operation failed:', e);
      showError(
        t('settings_page.error_linking_sessions') +
          getErrorMessage(e, t('ui.common.unknown_error')),
      );
    } finally {
      setRebuilding(false);
    }
  }, [gapFillMinutes, showError, showInfo, t]);

  const handleClearData = useCallback(async () => {
    const confirmed = await confirm(
      t('settings_page.are_you_sure_you_want_to_delete_all_data_this_cannot_be'),
    );
    if (!confirmed) return;

    setClearing(true);
    try {
      await settingsApi.clearAllData();
      setClearArmed(false);
      showInfo(t('settings_page.all_data_removed'));
    } catch (e) {
      logTauriWarn('Settings operation failed:', e);
      showError(
        t('settings_page.failed_to_clear_data') +
          getErrorMessage(e, t('ui.common.unknown_error')),
      );
    } finally {
      setClearing(false);
    }
  }, [confirm, showError, showInfo, t]);

  return {
    clearing,
    clearArmed,
    rebuilding,
    setClearArmed,
    handleRebuildSessions,
    handleClearData,
  };
}
