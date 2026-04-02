import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { sessionsApi, settingsApi } from '@/lib/tauri';
import { normalizeHexColor } from '@/lib/normalize';
import { splitTime } from '@/lib/form-validation';
import {
  activateLicense,
  loadLicenseInfo,
  loadOnlineSyncState,
  loadOnlineSyncSettings,
  loadSecureApiToken,
  runOnlineSyncOnce,
  saveLicenseInfo,
  saveOnlineSyncSettings,
  type LicenseInfo,
  type OnlineSyncSettings,
  type OnlineSyncRunResult,
  type OnlineSyncState,
} from '@/lib/online-sync';
import { emitProjectsAllTimeInvalidated } from '@/lib/sync-events';
import { getErrorMessage } from '@/lib/utils';
import {
  type AppearanceSettings,
  type CurrencySettings,
  type FreezeSettings,
  type LanguageSettings,
  type SessionSettings,
  type SplitSettings,
  type WorkingHoursSettings,
  loadAppearanceSettings,
  loadCurrencySettings,
  loadFreezeSettings,
  loadLanguageSettings,
  loadSessionSettings,
  loadSplitSettings,
  loadWorkingHoursSettings,
  saveAppearanceSettings,
  saveCurrencySettings,
  saveFreezeSettings,
  saveLanguageSettings,
  saveSessionSettings,
  saveSplitSettings,
  saveWorkingHoursSettings,
  timeToMinutes,
} from '@/lib/user-settings';

type PageChangeGuard = (
  nextPage: string,
  currentPage: string,
) => boolean | Promise<boolean>;

type StateUpdater<T> = T | ((prev: T) => T);

function resolveStateUpdate<T>(prev: T, next: StateUpdater<T>): T {
  return typeof next === 'function'
    ? (next as (value: T) => T)(prev)
    : next;
}

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
  const [clearing, setClearing] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);
  const [workingHours, setWorkingHours] = useState<WorkingHoursSettings>(() =>
    loadWorkingHoursSettings(),
  );
  const [sessionSettings, setSessionSettings] = useState<SessionSettings>(() =>
    loadSessionSettings(),
  );
  const [onlineSyncSettings, setOnlineSyncSettings] =
    useState<OnlineSyncSettings>(() => loadOnlineSyncSettings());
  const [freezeSettings, setFreezeSettings] = useState<FreezeSettings>(() =>
    loadFreezeSettings(),
  );
  const [currencySettings, setCurrencySettings] = useState<CurrencySettings>(
    () => loadCurrencySettings(),
  );
  const [languageSettings, setLanguageSettings] = useState<LanguageSettings>(
    () => loadLanguageSettings(),
  );
  const [appearanceSettings, setAppearanceSettings] =
    useState<AppearanceSettings>(() => loadAppearanceSettings());
  const [splitSettings, setSplitSettings] = useState<SplitSettings>(() =>
    loadSplitSettings(),
  );
  const [workingHoursError, setWorkingHoursError] = useState<string | null>(
    null,
  );
  const [savedSettings, setSavedSettings] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [manualSyncing, setManualSyncing] = useState(false);
  const [manualSyncResult, setManualSyncResult] =
    useState<OnlineSyncRunResult | null>(null);
  const [onlineSyncState, setOnlineSyncState] = useState<OnlineSyncState>(() =>
    loadOnlineSyncState(),
  );
  const [showOnlineSyncToken, setShowOnlineSyncToken] = useState(false);
  const [licenseInfo, setLicenseInfo] = useState<LicenseInfo | null>(() =>
    loadLicenseInfo(),
  );
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [licenseActivating, setLicenseActivating] = useState(false);
  const [licenseError, setLicenseError] = useState<string | null>(null);

  useEffect(() => {
    loadSecureApiToken().then((token) => {
      if (token) {
        setOnlineSyncSettings((prev) => ({ ...prev, apiToken: token }));
      }
    });
  }, []);

  useEffect(() => {
    if (savedSettings) {
      setPageChangeGuard(null);
      return;
    }

    const pageChangeGuard: PageChangeGuard = async (nextPage, currentPage) => {
      if (currentPage !== 'settings' || nextPage === 'settings') return true;
      return confirm(t('settings_page.unsaved_changes_confirm'));
    };

    setPageChangeGuard(pageChangeGuard);
    return () => setPageChangeGuard(null);
  }, [confirm, savedSettings, setPageChangeGuard, t]);

  useEffect(() => {
    if (savedSettings) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [savedSettings]);

  const [startHour, startMinute] = useMemo(
    () => splitTime(workingHours.start),
    [workingHours.start],
  );
  const [endHour, endMinute] = useMemo(
    () => splitTime(workingHours.end),
    [workingHours.end],
  );
  const normalizedColor = useMemo(
    () => normalizeHexColor(workingHours.color),
    [workingHours.color],
  );
  const sliderValue = useMemo(
    () => Math.min(30, Math.max(0, sessionSettings.gapFillMinutes)),
    [sessionSettings.gapFillMinutes],
  );

  const lastSyncLabel = onlineSyncState.lastSyncAt
    ? new Date(onlineSyncState.lastSyncAt).toLocaleString()
    : t('settings_page.never');
  const shortHash = onlineSyncState.serverHash
    ? `${onlineSyncState.serverHash.slice(0, 12)}...`
    : 'n/a';
  const localHashShort = onlineSyncState.localHash
    ? `${onlineSyncState.localHash.slice(0, 12)}...`
    : 'n/a';
  const pendingAckHashShort = onlineSyncState.pendingAck?.payloadSha256
    ? `${onlineSyncState.pendingAck.payloadSha256.slice(0, 12)}...`
    : 'n/a';
  const splitToleranceDescription =
    splitSettings.toleranceThreshold >= 0.9
      ? t(
          'settings.splitToleranceDesc1',
          'Split only when projects have nearly identical scores.',
        )
      : splitSettings.toleranceThreshold >= 0.6
        ? t(
            'settings.splitToleranceDesc2',
            `Split when second project has >=${Math.round(splitSettings.toleranceThreshold * 100)}% of leader's score.`,
          )
        : t(
            'settings.splitToleranceDesc3',
            'Split even with large score disparity.',
          );
  const manualSyncResultText = manualSyncResult
    ? manualSyncResult.ok
      ? manualSyncResult.skipped && manualSyncResult.reason === 'demo_mode'
        ? t('settings_page.last_manual_sync_skipped_disabled_in_demo_mode')
        : manualSyncResult.ackPending
          ? t('settings_page.last_manual_sync_pull_applied_ack_pending', {
              detail: manualSyncResult.ackReason ?? manualSyncResult.reason,
            })
          : t('settings_page.last_manual_sync', {
              action: manualSyncResult.action,
              reason: manualSyncResult.reason,
            })
      : t('settings_page.last_manual_sync_failed', {
          error: manualSyncResult.error ?? manualSyncResult.reason,
        })
    : null;
  const manualSyncResultSuccess = manualSyncResult?.ok ?? false;

  const updateTimePart = useCallback(
    (field: 'start' | 'end', part: 'hour' | 'minute', value: string) => {
      setWorkingHours((prev) => {
        const [hour, minute] = splitTime(prev[field]);
        const nextHour = part === 'hour' ? value : hour;
        const nextMinute = part === 'minute' ? value : minute;
        return { ...prev, [field]: `${nextHour}:${nextMinute}` };
      });
      setWorkingHoursError(null);
      setSavedSettings(false);
    },
    [],
  );

  const updateWorkingHours = useCallback(
    (next: StateUpdater<WorkingHoursSettings>) => {
      setWorkingHours((prev) => resolveStateUpdate(prev, next));
      setWorkingHoursError(null);
      setSavedSettings(false);
    },
    [],
  );

  const updateSessionSettings = useCallback(
    (next: StateUpdater<SessionSettings>) => {
      setSessionSettings((prev) => resolveStateUpdate(prev, next));
      setSavedSettings(false);
    },
    [],
  );

  const updateOnlineSyncSettings = useCallback(
    (next: StateUpdater<OnlineSyncSettings>) => {
      setOnlineSyncSettings((prev) => resolveStateUpdate(prev, next));
      setSavedSettings(false);
    },
    [],
  );

  const updateFreezeSettings = useCallback(
    (next: StateUpdater<FreezeSettings>) => {
      setFreezeSettings((prev) => resolveStateUpdate(prev, next));
      setSavedSettings(false);
    },
    [],
  );

  const updateCurrencySettings = useCallback(
    (next: StateUpdater<CurrencySettings>) => {
      setCurrencySettings((prev) => resolveStateUpdate(prev, next));
      setSavedSettings(false);
    },
    [],
  );

  const updateLanguageSettings = useCallback(
    (next: StateUpdater<LanguageSettings>) => {
      setLanguageSettings((prev) => resolveStateUpdate(prev, next));
      setSavedSettings(false);
    },
    [],
  );

  const updateAppearanceSettings = useCallback(
    (next: StateUpdater<AppearanceSettings>) => {
      setAppearanceSettings((prev) => resolveStateUpdate(prev, next));
      setSavedSettings(false);
    },
    [],
  );

  const updateSplitSetting = useCallback(
    <K extends keyof SplitSettings>(key: K, value: SplitSettings[K]) => {
      setSplitSettings((prev) => saveSplitSettings({ ...prev, [key]: value }));
      setSavedSettings(false);
    },
    [],
  );

  const handleSaveSettings = useCallback(() => {
    const startMinutes = timeToMinutes(workingHours.start);
    const endMinutes = timeToMinutes(workingHours.end);

    if (startMinutes === null || endMinutes === null) {
      setWorkingHoursError(
        t('settings_page.please_use_a_valid_hh_mm_time'),
      );
      setSavedSettings(false);
      return;
    }
    if (endMinutes <= startMinutes) {
      setWorkingHoursError(
        t('settings_page.to_time_must_be_later_than_from_time'),
      );
      setSavedSettings(false);
      return;
    }

    const savedWorking = saveWorkingHoursSettings({
      ...workingHours,
      color: normalizedColor,
    });
    const savedSession = saveSessionSettings(sessionSettings);
    const uiApiToken = onlineSyncSettings.apiToken;
    const savedOnlineSync = saveOnlineSyncSettings(onlineSyncSettings);

    // Also persist settings to daemon's online_sync_settings.json
    void import('@/lib/tauri/online-sync').then(({ saveDaemonOnlineSyncSettings }) =>
      saveDaemonOnlineSyncSettings({
        enabled: savedOnlineSync.enabled,
        server_url: savedOnlineSync.serverUrl,
        auth_token: uiApiToken,
        device_id: savedOnlineSync.deviceId,
        encryption_key: savedOnlineSync.encryptionKey ?? '',
        sync_interval_hours: Math.floor(savedOnlineSync.autoSyncIntervalMinutes / 60),
        auto_sync_on_startup: savedOnlineSync.autoSyncOnStartup,
      }).catch((err) => {
        console.warn('Failed to persist online sync settings to daemon:', err);
      })
    ).catch(() => { /* Daemon not available — ignore */ });

    const savedFreeze = saveFreezeSettings(freezeSettings);
    const savedCurrency = saveCurrencySettings(currencySettings);
    const savedLanguage = saveLanguageSettings(languageSettings);
    void settingsApi
      .persistSessionSettingsForDaemon(savedSession.minSessionDurationSeconds)
      .catch((err) => {
        console.warn('Failed to persist session settings for daemon:', err);
      });
    void settingsApi.persistLanguageForDaemon(savedLanguage.code).catch(
      (err) => {
        console.warn('Failed to persist language for daemon:', err);
      },
    );
    const savedAppearance = saveAppearanceSettings(appearanceSettings);

    setWorkingHours(savedWorking);
    setSessionSettings(savedSession);
    setOnlineSyncSettings({ ...savedOnlineSync, apiToken: uiApiToken });
    setFreezeSettings(savedFreeze);
    setCurrencySettings(savedCurrency);
    setLanguageSettings(savedLanguage);
    setAppearanceSettings(savedAppearance);
    setCurrencyCode(savedCurrency.code);
    setChartAnimations(savedAppearance.chartAnimations);
    setStoreWorkingHours?.(savedWorking);
    setStoreLanguage?.(savedLanguage.code);
    setStoreSplitSettings?.(splitSettings);
    if (i18n.resolvedLanguage !== savedLanguage.code) {
      void i18n.changeLanguage(savedLanguage.code).catch((error) => {
        console.warn('Failed to apply language change:', error);
      });
    }
    setWorkingHoursError(null);
    setSavedSettings(true);
    showInfo(t('settings_page.saved'));
    triggerRefresh('settings_saved');
  }, [
    appearanceSettings,
    currencySettings,
    freezeSettings,
    i18n,
    languageSettings,
    normalizedColor,
    onlineSyncSettings,
    sessionSettings,
    setChartAnimations,
    setCurrencyCode,
    setStoreLanguage,
    setStoreSplitSettings,
    setStoreWorkingHours,
    showInfo,
    splitSettings,
    t,
    triggerRefresh,
    workingHours,
  ]);

  const handleRebuildSessions = useCallback(async () => {
    setRebuilding(true);
    try {
      const merged = await sessionsApi.rebuildSessions(
        sessionSettings.gapFillMinutes,
      );
      showInfo(
        t('settings_page.successfully_merged_close_sessions', { merged }),
      );
    } catch (e) {
      console.error(e);
      showError(
        t('settings_page.error_linking_sessions') +
          getErrorMessage(e, t('ui.common.unknown_error')),
      );
    } finally {
      setRebuilding(false);
    }
  }, [sessionSettings.gapFillMinutes, showError, showInfo, t]);

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
      console.error(e);
      showError(
        t('settings_page.failed_to_clear_data') +
          getErrorMessage(e, t('ui.common.unknown_error')),
      );
    } finally {
      setClearing(false);
    }
  }, [confirm, showError, showInfo, t]);

  const handleSyncNow = useCallback(
    async (demoModeEnabled: boolean) => {
      if (demoModeEnabled) {
        setManualSyncResult({
          ok: true,
          skipped: true,
          action: 'none',
          reason: 'demo_mode',
          serverRevision: onlineSyncState.serverRevision,
        });
        return;
      }

      setManualSyncing(true);
      setManualSyncResult(null);
      try {
        const uiToken = onlineSyncSettings.apiToken;
        const savedOnlineSync = saveOnlineSyncSettings(onlineSyncSettings);
        setOnlineSyncSettings({ ...savedOnlineSync, apiToken: uiToken });

        // Also persist settings to daemon's online_sync_settings.json
        try {
          const { saveDaemonOnlineSyncSettings } = await import('@/lib/tauri/online-sync');
          await saveDaemonOnlineSyncSettings({
            enabled: savedOnlineSync.enabled,
            server_url: savedOnlineSync.serverUrl,
            auth_token: uiToken,
            device_id: savedOnlineSync.deviceId,
            encryption_key: savedOnlineSync.encryptionKey ?? '',
            sync_interval_hours: Math.floor(savedOnlineSync.autoSyncIntervalMinutes / 60),
            auto_sync_on_startup: savedOnlineSync.autoSyncOnStartup,
          });
        } catch {
          // Daemon not available — ignore
        }

        const result = await runOnlineSyncOnce({ ignoreStartupToggle: true });
        setManualSyncResult(result);
        setOnlineSyncState(loadOnlineSyncState());

        if (result.ok && result.action === 'pull') {
          emitProjectsAllTimeInvalidated('online_sync_pull');
          triggerRefresh('settings_manual_sync_pull');
        }
      } catch (e) {
        setManualSyncResult({
          ok: false,
          action: 'none',
          reason: 'sync_failed',
          serverRevision: onlineSyncState.serverRevision,
          error: getErrorMessage(e, t('ui.common.unknown_error')),
        });
      } finally {
        setManualSyncing(false);
      }
    },
    [onlineSyncSettings, onlineSyncState.serverRevision, t, triggerRefresh],
  );

  const resetManualSyncResult = useCallback(() => {
    setManualSyncResult(null);
  }, []);

  const handleActivateLicense = useCallback(
    async () => {
      const key = licenseKeyInput.trim();
      if (!key) return;

      const serverUrl = onlineSyncSettings.serverUrl;
      if (!serverUrl) {
        setLicenseError(t('settings.license.no_server_url'));
        return;
      }

      setLicenseActivating(true);
      setLicenseError(null);

      try {
        const deviceId = onlineSyncSettings.deviceId || crypto.randomUUID();
        const deviceName = `${navigator.platform || 'Desktop'} — TIMEFLOW`;

        const result = await activateLicense(serverUrl, key, deviceId, deviceName);

        if (!result.ok) {
          setLicenseError(result.error || 'Activation failed');
          return;
        }

        const info: LicenseInfo = {
          licenseKey: key,
          licenseId: result.licenseId!,
          plan: result.plan!,
          status: result.status!,
          groupId: result.groupId!,
          groupName: result.groupName!,
          maxDevices: result.maxDevices!,
          activeDevices: result.activeDevices!,
          expiresAt: result.expiresAt ?? null,
          activatedAt: new Date().toISOString(),
        };
        saveLicenseInfo(info);
        setLicenseInfo(info);
        setLicenseKeyInput('');

        // Auto-fill deviceId if empty
        if (!onlineSyncSettings.deviceId) {
          setOnlineSyncSettings((prev) => ({ ...prev, deviceId }));
        }

        showInfo(t('settings.license.activated_success'));
      } catch (e) {
        setLicenseError(getErrorMessage(e, t('ui.common.unknown_error')));
      } finally {
        setLicenseActivating(false);
      }
    },
    [licenseKeyInput, onlineSyncSettings, t, showInfo],
  );

  return {
    clearing,
    clearArmed,
    workingHours,
    sessionSettings,
    onlineSyncSettings,
    freezeSettings,
    currencySettings,
    languageSettings,
    appearanceSettings,
    splitSettings,
    workingHoursError,
    savedSettings,
    rebuilding,
    manualSyncing,
    manualSyncResult,
    manualSyncResultText,
    manualSyncResultSuccess,
    onlineSyncState,
    showOnlineSyncToken,
    startHour,
    startMinute,
    endHour,
    endMinute,
    sliderValue,
    normalizedColor,
    lastSyncLabel,
    shortHash,
    localHashShort,
    pendingAckHashShort,
    splitToleranceDescription,
    setClearArmed,
    setShowOnlineSyncToken,
    updateTimePart,
    updateWorkingHours,
    updateSessionSettings,
    updateOnlineSyncSettings,
    updateFreezeSettings,
    updateCurrencySettings,
    updateLanguageSettings,
    updateAppearanceSettings,
    updateSplitSetting,
    handleSaveSettings,
    handleRebuildSessions,
    handleClearData,
    handleSyncNow,
    resetManualSyncResult,
    licenseInfo,
    licenseKeyInput,
    licenseActivating,
    licenseError,
    setLicenseKeyInput,
    handleActivateLicense,
  };
}
