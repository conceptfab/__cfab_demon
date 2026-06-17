import { useCallback, useState } from 'react';
import type { TFunction } from 'i18next';
import { settingsApi } from '@/lib/tauri';
import { saveOnlineSyncSettings } from '@/lib/online-sync';
import { logTauriWarn } from '@/lib/utils';
import {
  type CurrencySettings,
  type LanguageSettings,
  type SplitSettings,
  type WorkingHoursSettings,
  saveAppearanceSettings,
  saveCurrencySettings,
  saveFreezeSettings,
  saveLanguageSettings,
  saveSessionSettings,
  saveWorkingHoursSettings,
  timeToMinutes,
} from '@/lib/user-settings';
import {
  type PageChangeGuard,
} from './settings/useSettingsFormTypes';
import { useGeneralSettings } from './settings/useGeneralSettings';
import { useSettingsGuards } from './settings/useSettingsGuards';
import { useSettingsMaintenance } from './settings/useSettingsMaintenance';
import { useSyncSettings } from './settings/useSyncSettings';
import { useUiSettings } from './settings/useUiSettings';

interface UseSettingsFormStateOptions {
  confirm: (message: string) => Promise<boolean>;
  i18n: {
    resolvedLanguage?: string;
    changeLanguage: (code: string) => Promise<unknown>;
  };
  t: TFunction;
  showInfo: (message: string) => void;
  showError: (message: string) => void;
  triggerRefresh: (reason: string) => void;
  setCurrencyCode: (code: CurrencySettings['code']) => void;
  setChartAnimations: (enabled: boolean) => void;
  setPageChangeGuard: (guard: PageChangeGuard | null) => void;
  setStoreWorkingHours?: (next: WorkingHoursSettings) => void;
  setStoreLanguage?: (code: LanguageSettings['code']) => void;
  setStoreSplitSettings?: (next: SplitSettings) => void;
}

export function useSettingsFormState({
  confirm,
  i18n,
  t,
  showInfo,
  showError,
  triggerRefresh,
  setCurrencyCode,
  setChartAnimations,
  setPageChangeGuard,
  setStoreWorkingHours,
  setStoreLanguage,
  setStoreSplitSettings,
}: UseSettingsFormStateOptions) {
  const [savedSettings, setSavedSettings] = useState(true);
  const uiSettings = useUiSettings({ setSavedSettings });
  const generalSettings = useGeneralSettings({ setSavedSettings, t });
  const syncSettings = useSyncSettings({
    setSavedSettings,
    showInfo,
    t,
    triggerRefresh,
  });
  const maintenance = useSettingsMaintenance({
    confirm,
    gapFillMinutes: generalSettings.sessionSettings.gapFillMinutes,
    showError,
    showInfo,
    t,
  });

  useSettingsGuards({
    confirm,
    savedSettings,
    setPageChangeGuard,
    t,
  });

  const handleSaveSettings = useCallback(() => {
    const startMinutes = timeToMinutes(uiSettings.workingHours.start);
    const endMinutes = timeToMinutes(uiSettings.workingHours.end);

    if (startMinutes === null || endMinutes === null) {
      uiSettings.setWorkingHoursError(
        t('settings_page.please_use_a_valid_hh_mm_time'),
      );
      setSavedSettings(false);
      return;
    }
    if (endMinutes <= startMinutes) {
      uiSettings.setWorkingHoursError(
        t('settings_page.to_time_must_be_later_than_from_time'),
      );
      setSavedSettings(false);
      return;
    }

    const savedWorking = saveWorkingHoursSettings({
      ...uiSettings.workingHours,
      color: uiSettings.normalizedColor,
    });
    const savedSession = saveSessionSettings(generalSettings.sessionSettings);
    const uiApiToken = syncSettings.onlineSyncSettings.apiToken;
    const savedOnlineSync = saveOnlineSyncSettings(
      syncSettings.onlineSyncSettings,
    );

    void import('@/lib/tauri/online-sync')
      .then(({ saveDaemonOnlineSyncSettings }) =>
        saveDaemonOnlineSyncSettings({
          enabled: savedOnlineSync.enabled,
          server_url: savedOnlineSync.serverUrl,
          auth_token: uiApiToken,
          device_id: savedOnlineSync.deviceId,
          encryption_key: savedOnlineSync.encryptionKey ?? '',
          sync_interval_minutes: savedOnlineSync.autoSyncIntervalMinutes,
          auto_sync_on_startup: savedOnlineSync.autoSyncOnStartup,
        }).catch((err) => {
          logTauriWarn('Failed to persist online sync settings to daemon:', err);
        }),
      )
      .catch(() => {
        // Daemon not available; local UI settings are still saved.
      });

    const savedFreeze = saveFreezeSettings(generalSettings.freezeSettings);
    const savedCurrency = saveCurrencySettings(uiSettings.currencySettings);
    const savedLanguage = saveLanguageSettings(uiSettings.languageSettings);
    void settingsApi
      .persistSessionSettingsForDaemon(savedSession.minSessionDurationSeconds)
      .catch((err) => {
        logTauriWarn('Failed to persist session settings for daemon:', err);
      });
    void settingsApi.persistLanguageForDaemon(savedLanguage.code).catch(
      (err) => {
        logTauriWarn('Failed to persist language for daemon:', err);
      },
    );
    const savedAppearance = saveAppearanceSettings(uiSettings.appearanceSettings);

    uiSettings.setWorkingHours(savedWorking);
    generalSettings.setSessionSettings(savedSession);
    syncSettings.setOnlineSyncSettings({
      ...savedOnlineSync,
      apiToken: uiApiToken,
    });
    generalSettings.setFreezeSettings(savedFreeze);
    uiSettings.setCurrencySettings(savedCurrency);
    uiSettings.setLanguageSettings(savedLanguage);
    uiSettings.setAppearanceSettings(savedAppearance);
    setCurrencyCode(savedCurrency.code);
    setChartAnimations(savedAppearance.chartAnimations);
    setStoreWorkingHours?.(savedWorking);
    setStoreLanguage?.(savedLanguage.code);
    setStoreSplitSettings?.(generalSettings.splitSettings);
    if (i18n.resolvedLanguage !== savedLanguage.code) {
      void i18n.changeLanguage(savedLanguage.code).catch((error) => {
        logTauriWarn('Failed to apply language change:', error);
      });
    }
    uiSettings.setWorkingHoursError(null);
    setSavedSettings(true);
    showInfo(t('settings_page.saved'));
    triggerRefresh('settings_saved');
  }, [
    generalSettings,
    i18n,
    setChartAnimations,
    setCurrencyCode,
    setStoreLanguage,
    setStoreSplitSettings,
    setStoreWorkingHours,
    showInfo,
    syncSettings,
    t,
    triggerRefresh,
    uiSettings,
  ]);

  return {
    ...maintenance,
    ...uiSettings,
    ...generalSettings,
    ...syncSettings,
    savedSettings,
    handleSaveSettings,
  };
}
