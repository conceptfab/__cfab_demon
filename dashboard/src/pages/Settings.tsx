import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { sessionsApi, settingsApi } from '@/lib/tauri';
import type { DemoModeStatus } from '@/lib/db-types';
import { useDataStore } from '@/store/data-store';
import { useSettingsStore } from '@/store/settings-store';
import { useUIStore } from '@/store/ui-store';
import {
  type AppLanguageCode,
  type LanguageSettings,
  loadWorkingHoursSettings,
  saveWorkingHoursSettings,
  timeToMinutes,
  type WorkingHoursSettings,
  loadSessionSettings,
  saveSessionSettings,
  type SessionSettings,
  loadFreezeSettings,
  saveFreezeSettings,
  type FreezeSettings,
  loadCurrencySettings,
  saveCurrencySettings,
  type CurrencySettings,
  loadLanguageSettings,
  saveLanguageSettings,
  loadAppearanceSettings,
  saveAppearanceSettings,
  type AppearanceSettings,
  loadSplitSettings,
  saveSplitSettings,
  type SplitSettings,
} from '@/lib/user-settings';
import { normalizeHexColor } from '@/lib/normalize';
import { splitTime } from '@/lib/form-validation';
import {
  DEFAULT_ONLINE_SYNC_SERVER_URL,
  loadOnlineSyncState,
  loadOnlineSyncSettings,
  loadSecureApiToken,
  runOnlineSyncOnce,
  saveOnlineSyncSettings,
  type OnlineSyncSettings,
  type OnlineSyncRunResult,
  type OnlineSyncState,
} from '@/lib/online-sync';
import { emitProjectsAllTimeInvalidated } from '@/lib/sync-events';
import { getErrorMessage } from '@/lib/utils';
import { useToast } from '@/components/ui/toast-notification';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ProjectFreezeCard } from '@/components/settings/ProjectFreezeCard';
import { DemoModeCard } from '@/components/settings/DemoModeCard';
import { DangerZoneCard } from '@/components/settings/DangerZoneCard';
import { WorkingHoursCard } from '@/components/settings/WorkingHoursCard';
import { CurrencyCard } from '@/components/settings/CurrencyCard';
import { LanguageCard } from '@/components/settings/LanguageCard';
import { AppearanceCard } from '@/components/settings/AppearanceCard';
import { SessionManagementCard } from '@/components/settings/SessionManagementCard';
import { SessionSplitCard } from '@/components/settings/SessionSplitCard';
import { OnlineSyncCard } from '@/components/settings/OnlineSyncCard';

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, '0'),
);

export function Settings() {
  const { i18n, t } = useTranslation();
  const { showError, showInfo } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const setCurrencyCode = useSettingsStore((s) => s.setCurrencyCode);
  const setChartAnimations = useSettingsStore((s) => s.setChartAnimations);
  const setPageChangeGuard = useUIStore((s) => s.setPageChangeGuard);
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

  // Load API token from Rust secure storage on mount
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

    const pageChangeGuard = async (nextPage: string, currentPage: string) => {
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

  const [demoModeStatus, setDemoModeStatus] = useState<DemoModeStatus | null>(
    null,
  );
  const [demoModeLoading, setDemoModeLoading] = useState(true);
  const [demoModeSwitching, setDemoModeSwitching] = useState(false);
  const [demoModeError, setDemoModeError] = useState<string | null>(null);

  const labelClassName = 'text-sm font-medium text-muted-foreground';
  const compactSelectClassName =
    'h-8 w-[3.75rem] rounded-md border border-input bg-background px-1.5 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40';
  const sliderValue = Math.min(30, Math.max(0, sessionSettings.gapFillMinutes));
  const languageOptions: Array<{ code: AppLanguageCode; label: string }> = [
    { code: 'pl', label: t('settings.language.option.pl') },
    { code: 'en', label: t('settings.language.option.en') },
  ];
  const currencyOptions = [
    { code: 'PLN', symbol: 'zł' },
    { code: 'USD', symbol: '$' },
    { code: 'EUR', symbol: '€' },
  ];

  const [startHour, startMinute] = useMemo(
    () => splitTime(workingHours.start),
    [workingHours.start],
  );
  const [endHour, endMinute] = useMemo(
    () => splitTime(workingHours.end),
    [workingHours.end],
  );
  const normalizedColor = normalizeHexColor(workingHours.color);

  useEffect(() => {
    let cancelled = false;

    const loadDemoStatus = async () => {
      setDemoModeLoading(true);
      setDemoModeError(null);
      try {
        const status = await settingsApi.getDemoModeStatus();
        if (!cancelled) {
          setDemoModeStatus(status);
        }
      } catch (e) {
        if (!cancelled) {
          setDemoModeError(
            getErrorMessage(
              e,
              t('settings_page.demo_mode_status_unavailable'),
            ),
          );
        }
      } finally {
        if (!cancelled) {
          setDemoModeLoading(false);
        }
      }
    };

    void loadDemoStatus();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const updateTimePart = (
    field: 'start' | 'end',
    part: 'hour' | 'minute',
    value: string,
  ) => {
    setWorkingHours((prev) => {
      const [hour, minute] = splitTime(prev[field]);
      const nextHour = part === 'hour' ? value : hour;
      const nextMinute = part === 'minute' ? value : minute;
      return { ...prev, [field]: `${nextHour}:${nextMinute}` };
    });
    setWorkingHoursError(null);
    setSavedSettings(false);
  };

  const handleSaveSettings = () => {
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
    const uiApiToken = onlineSyncSettings.apiToken; // preserve token for UI display
    const savedOnlineSync = saveOnlineSyncSettings(onlineSyncSettings);
    const savedFreeze = saveFreezeSettings(freezeSettings);
    const savedCurrency = saveCurrencySettings(currencySettings);
    const savedLanguage = saveLanguageSettings(languageSettings);
    void settingsApi.persistLanguageForDaemon(savedLanguage.code).catch((err) => {
      console.warn('Failed to persist language for daemon:', err);
    });
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
    if (i18n.resolvedLanguage !== savedLanguage.code) {
      void i18n.changeLanguage(savedLanguage.code).catch((error) => {
        console.warn('Failed to apply language change:', error);
      });
    }
    setWorkingHoursError(null);
    setSavedSettings(true);
    showInfo(t('settings_page.saved'));
    triggerRefresh('settings_saved');
  };

  const handleSplitChange = <K extends keyof SplitSettings>(
    key: K,
    value: SplitSettings[K],
  ) => {
    setSplitSettings((prev) => {
      const next = saveSplitSettings({ ...prev, [key]: value });
      return next;
    });
  };

  const handleRebuildSessions = async () => {
    setRebuilding(true);
    try {
      const merged = await sessionsApi.rebuildSessions(sessionSettings.gapFillMinutes);
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
  };

  const handleClearData = async () => {
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
  };

  const handleSyncNow = async () => {
    if (demoModeStatus?.enabled) {
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
      // Persist only online sync settings before running manual sync.
      const uiToken = onlineSyncSettings.apiToken;
      const savedOnlineSync = saveOnlineSyncSettings(onlineSyncSettings);
      setOnlineSyncSettings({ ...savedOnlineSync, apiToken: uiToken });

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
  };

  const handleToggleDemoMode = async (enabled: boolean) => {
    setDemoModeSwitching(true);
    setDemoModeError(null);
    try {
      const status = await settingsApi.setDemoMode(enabled);
      setDemoModeStatus(status);
      setManualSyncResult(null);
      showInfo(
        status.enabled
          ? t('settings_page.demo_mode_enabled_dashboard_now_uses_the_demo_database')
          : t('settings_page.demo_mode_disabled_dashboard_now_uses_the_primary_databa'),
      );
    } catch (e) {
      console.error(e);
      const errorMessage = getErrorMessage(e, t('ui.common.unknown_error'));
      setDemoModeError(errorMessage);
      showError(t('settings_page.failed_to_switch_demo_mode') + errorMessage);
    } finally {
      setDemoModeSwitching(false);
    }
  };

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
  const demoModeSyncDisabled = demoModeStatus?.enabled === true;
  const splitToleranceDescription =
    splitSettings.toleranceThreshold >= 0.9
      ? t(
          'settings.splitToleranceDesc1',
          'Split only when projects have nearly identical scores.',
        )
      : splitSettings.toleranceThreshold >= 0.6
        ? t(
            'settings.splitToleranceDesc2',
            `Split when second project has ≥${Math.round(splitSettings.toleranceThreshold * 100)}% of leader's score.`,
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
                detail:
                  manualSyncResult.ackReason ?? manualSyncResult.reason,
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

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 pb-20">
      <div className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight px-1">
          {t('settings_page.general_settings')}
        </h2>
        <WorkingHoursCard
          title={t('settings_page.working_hours')}
          description={t('settings_page.used_to_highlight_expected_work_window_on_timeline')}
          fromLabel={t('settings_page.from')}
          toLabel={t('settings_page.to')}
          highlightColorLabel={t('settings_page.highlight_color')}
          labelClassName={labelClassName}
          compactSelectClassName={compactSelectClassName}
          hours={HOURS}
          minutes={MINUTES}
          startHour={startHour}
          startMinute={startMinute}
          endHour={endHour}
          endMinute={endMinute}
          normalizedColor={normalizedColor}
          errorText={workingHoursError}
          onTimePartChange={updateTimePart}
          onColorChange={(color) => {
            setWorkingHours((prev) => ({ ...prev, color }));
            setWorkingHoursError(null);
            setSavedSettings(false);
          }}
        />
        <CurrencyCard
          title={t('settings_page.currency')}
          description={t('settings_page.select_preferred_currency_for_project_values')}
          activeCurrencyLabel={t('settings_page.active_currency')}
          labelClassName={labelClassName}
          currencies={currencyOptions}
          selectedCode={currencySettings.code}
          onSelectCurrency={(code) => {
            setCurrencySettings({ code });
            setSavedSettings(false);
          }}
        />
        <LanguageCard
          title={t('settings.language.title')}
          description={t('settings.language.description')}
          fieldLabel={t('settings.language.field')}
          rolloutNote={t('settings.language.rollout_note')}
          labelClassName={labelClassName}
          options={languageOptions}
          selectedCode={languageSettings.code}
          onSelectLanguage={(code) => {
            setLanguageSettings({ code: code as AppLanguageCode });
            setSavedSettings(false);
          }}
        />
        <AppearanceCard
          title={t('settings_page.appearance_performance')}
          description={t('settings_page.adjust_visual_effects_and_performance_options')}
          animationsTitle={t('settings_page.enable_chart_animations')}
          animationsDescription={t('settings_page.turn_off_to_improve_ui_responsiveness_on_slower_devices')}
          checked={appearanceSettings.chartAnimations}
          onToggle={(enabled) => {
            setAppearanceSettings((prev) => ({ ...prev, chartAnimations: enabled }));
            setSavedSettings(false);
          }}
        />
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight px-1 mt-8 text-sky-400">
          {t('settings_page.advanced_algorithms')}
        </h2>

        <SessionManagementCard
          title={t('settings_page.session_management')}
          description={t('settings_page.rules_for_automatic_merging_of_nearby_sessions')}
          mergeGapLabel={t('settings_page.merge_gap')}
          mergeGapAriaLabel={t('settings_page.merge_gap_in_minutes')}
          minutesLabel={t('settings_page.min')}
          sliderValue={sliderValue}
          skipShortSessionsTitle={t(
            'settings.session.skipShortTitle',
            'Skip short sessions',
          )}
          skipShortSessionsDescription={t('settings_page.sessions_shorter_than_or_equal_to_this_duration_will_be')}
          minDurationAriaLabel={t('settings_page.minimum_session_duration_in_seconds')}
          minDurationSeconds={sessionSettings.minSessionDurationSeconds}
          secondsLabel={t('settings_page.sec')}
          autoRebuildTitle={t('settings_page.auto_rebuild_on_startup')}
          autoRebuildDescription={t('settings_page.automatically_merge_close_sessions_when_app_starts')}
          rebuildOnStartup={sessionSettings.rebuildOnStartup}
          rebuildExistingTitle={t('settings_page.rebuild_existing_sessions')}
          rebuildExistingDescription={t('settings_page.apply_current_merge_gap_to_already_imported_sessions')}
          rebuildingLabel={t('settings_page.rebuilding')}
          rebuildLabel={t('settings_page.rebuild')}
          rebuilding={rebuilding}
          onGapFillChange={(minutes) => {
            setSessionSettings((prev) => ({ ...prev, gapFillMinutes: minutes }));
            setSavedSettings(false);
          }}
          onMinDurationChange={(seconds) => {
            setSessionSettings((prev) => ({
              ...prev,
              minSessionDurationSeconds: seconds,
            }));
            setSavedSettings(false);
          }}
          onRebuildOnStartupChange={(enabled) => {
            setSessionSettings((prev) => ({ ...prev, rebuildOnStartup: enabled }));
            setSavedSettings(false);
          }}
          onRebuild={() => {
            void handleRebuildSessions();
          }}
        />

        <SessionSplitCard
          title={t('settings.splitTitle', 'Session Split')}
          maxProjectsTitle={t(
            'settings.splitMaxProjects',
            'Max projects per session',
          )}
          maxProjectsDescription={t(
            'settings.splitMaxProjectsDesc',
            'Do ilu maksymalnie projektów można podzielić jedną sesję.',
          )}
          toleranceTitle={t('settings.splitTolerance', 'Tolerance coefficient')}
          toleranceLowLabel={t('settings.splitToleranceLow', 'loose')}
          toleranceHighLabel={t('settings.splitToleranceHigh', 'strict')}
          toleranceDescription={splitToleranceDescription}
          autoSplitTitle={t('settings.splitAuto', 'Automatic split')}
          autoSplitDescription={t(
            'settings.splitAutoDesc',
            'Sessions meeting split conditions will be split automatically.',
          )}
          splitSettings={splitSettings}
          onMaxProjectsChange={(maxProjects) => {
            handleSplitChange('maxProjectsPerSession', maxProjects);
          }}
          onToleranceThresholdChange={(threshold) => {
            handleSplitChange('toleranceThreshold', threshold);
          }}
          onAutoSplitEnabledChange={(enabled) => {
            handleSplitChange('autoSplitEnabled', enabled);
          }}
        />

        <OnlineSyncCard
          settings={onlineSyncSettings}
          state={onlineSyncState}
          manualSyncResult={manualSyncResult}
          manualSyncResultText={manualSyncResultText}
          manualSyncResultSuccess={manualSyncResultSuccess}
          manualSyncing={manualSyncing}
          demoModeSyncDisabled={demoModeSyncDisabled}
          showToken={showOnlineSyncToken}
          title={t('settings_page.online_sync')}
          description={t('settings_page.startup_synchronization_with_remote_server_using_snapsho')}
          enableSyncTitle={t(
            'settings.online_sync.enableTitle',
            'Enable online sync',
          )}
          enableSyncDescription={t('settings_page.allows_the_dashboard_to_exchange_data_snapshots_with_the')}
          syncOnStartupTitle={t('settings_page.sync_on_startup')}
          syncOnStartupDescription={t('settings_page.runs_status_pull_push_after_local_auto_import_finishes')}
          autoSyncIntervalTitle={t('settings_page.auto_sync_interval')}
          autoSyncIntervalDescription={t('settings_page.periodic_sync_after_app_startup_default_is_every_30_minu')}
          minutesLabel={t('settings_page.min')}
          enableLoggingTitle={t(
            'settings.online_sync.loggingTitle',
            'Enable sync logging',
          )}
          enableLoggingDescription={t('settings_page.save_detailed_sync_operations_to_log_file_for_debugging')}
          serverUrlLabel={t('settings_page.server_url')}
          useDefaultServerLabel={t(
            'settings.online_sync.useRailwayDefault',
            'Use Railway Default',
          )}
          userIdLabel={t('settings_page.user_id')}
          userIdPlaceholder="e.g. demo-user / email / UUID"
          apiTokenLabel={t('settings_page.api_token_bearer')}
          apiTokenPlaceholder={t('settings_page.paste_the_raw_token_without_bearer_prefix_and_without_qu')}
          showTokenLabel={t('settings_page.show_token')}
          hideTokenLabel={t('settings_page.hide_token')}
          apiTokenHint={t('settings_page.enter_the_raw_token_the_app_will_add_the_bearer_header_a')}
          deviceIdLabel={t('settings_page.device_id')}
          generatedOnSaveLabel={t('settings_page.generated_on_save')}
          deviceIdHint={t('settings_page.generated_automatically_and_used_to_identify_this_machin')}
          statusTitle={t('settings_page.last_sync_status')}
          lastSuccessfulLabel={t('settings_page.last_successful_check_sync')}
          demoModeDisabledWarning={t('settings_page.online_sync_is_disabled_while_demo_mode_is_active')}
          serverRevisionLabel={t('settings_page.server_revision')}
          serverHashLabel={t('settings_page.server_hash')}
          localRevisionHashLabel={t('settings_page.local_rev_hash')}
          pendingAckLabel={t('settings_page.pending_ack')}
          retriesLabel={t('settings_page.retries')}
          reseedWarning={t('settings_page.server_payload_was_cleaned_up_after_acks_local_reseed_ex')}
          syncingLabel={t('settings_page.syncing')}
          syncDisabledInDemoLabel={t(
            'settings.online_sync.syncDisabledInDemo',
            'Sync disabled in demo',
          )}
          syncNowLabel={t('settings_page.sync_now')}
          defaultServerUrl={DEFAULT_ONLINE_SYNC_SERVER_URL}
          labelClassName={labelClassName}
          lastSyncLabel={lastSyncLabel}
          shortHash={shortHash}
          localHashShort={localHashShort}
          pendingAckHashShort={pendingAckHashShort}
          onEnabledChange={(enabled) => {
            setOnlineSyncSettings((prev) => ({ ...prev, enabled }));
            setSavedSettings(false);
          }}
          onAutoSyncOnStartupChange={(enabled) => {
            setOnlineSyncSettings((prev) => ({
              ...prev,
              autoSyncOnStartup: enabled,
            }));
            setSavedSettings(false);
          }}
          onAutoSyncIntervalChange={(minutes) => {
            setOnlineSyncSettings((prev) => ({
              ...prev,
              autoSyncIntervalMinutes: minutes,
            }));
            setSavedSettings(false);
          }}
          onEnableLoggingChange={(enabled) => {
            setOnlineSyncSettings((prev) => ({ ...prev, enableLogging: enabled }));
            setSavedSettings(false);
          }}
          onServerUrlChange={(serverUrl) => {
            setOnlineSyncSettings((prev) => ({ ...prev, serverUrl }));
            setSavedSettings(false);
          }}
          onResetServerUrl={() => {
            setOnlineSyncSettings((prev) => ({
              ...prev,
              serverUrl: DEFAULT_ONLINE_SYNC_SERVER_URL,
            }));
            setSavedSettings(false);
          }}
          onUserIdChange={(userId) => {
            setOnlineSyncSettings((prev) => ({ ...prev, userId }));
            setSavedSettings(false);
          }}
          onApiTokenChange={(apiToken) => {
            setOnlineSyncSettings((prev) => ({ ...prev, apiToken }));
            setSavedSettings(false);
          }}
          onShowTokenChange={setShowOnlineSyncToken}
          onSyncNow={() => {
            void handleSyncNow();
          }}
        />
        <ProjectFreezeCard
          thresholdDays={freezeSettings.thresholdDays}
          title={t('settings_page.project_freezing')}
          description={t('settings_page.projects_inactive_for_a_set_period_are_automatically_fro')}
          thresholdTitle={t('settings_page.inactivity_threshold')}
          thresholdDescription={t('settings_page.number_of_days_without_activity_after_which_a_project_is')}
          thresholdAriaLabel={t('settings_page.freeze_threshold_in_days')}
          daysLabel={t('settings_page.days')}
          onThresholdChange={(val) => {
            setFreezeSettings((prev) => ({
              ...prev,
              thresholdDays: val,
            }));
            setSavedSettings(false);
          }}
        />
        <DemoModeCard
          demoModeStatus={demoModeStatus}
          demoModeLoading={demoModeLoading}
          demoModeSwitching={demoModeSwitching}
          demoModeError={demoModeError}
          title={t('settings_page.demo_mode')}
          description={t('settings_page.switch_dashboard_data_source_to_a_separate_demo_database')}
          toggleTitle={t('settings_page.use_demo_database')}
          toggleDescription={t('settings_page.applies_to_the_whole_dashboard_app_reads_writes_imports')}
          loadingStatusText={t('settings_page.loading_demo_mode_status')}
          activeDbLabel={t('settings_page.active_db')}
          primaryDbLabel={t('settings_page.primary_db')}
          demoDbLabel={t('settings_page.demo_db')}
          demoActiveText={t('settings_page.demo_mode_is_active_new_imports_changes_will_affect_the')}
          primaryActiveText={t('settings_page.primary_mode_is_active')}
          unavailableStatusText={t('settings_page.demo_mode_status_unavailable')}
          switchingLabel={t('settings_page.switching')}
          disableLabel={t('settings_page.disable_demo_mode')}
          enableLabel={t('settings_page.enable_demo_mode')}
          onToggle={(enabled) => {
            void handleToggleDemoMode(enabled);
          }}
        />
        <DangerZoneCard
          clearArmed={clearArmed}
          clearing={clearing}
          title={t('settings_page.danger_zone')}
          description={t('settings_page.hidden_by_default_to_avoid_accidental_clicks')}
          controlsLabel={t('settings_page.data_wipe_controls')}
          openLabel={t('settings_page.open')}
          closeLabel={t('settings_page.close')}
          detailsText={t('settings_page.deletes_all_imported_sessions_and_history_from_local_dat')}
          enableLabel={t('settings_page.enable_clear_action')}
          clearingLabel={t('settings_page.clearing')}
          clearLabel={t('settings_page.clear_data')}
          onClearArmedChange={setClearArmed}
          onClearData={() => {
            void handleClearData();
          }}
        />
      </div>

      <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2">
        {!savedSettings && (
          <Button
            className="h-8 min-w-[7rem] rounded-full shadow-[0_0_20px_rgba(16,185,129,0.4)] transition-all duration-300 hover:scale-110 active:scale-95 animate-shine text-white border-none font-black text-[10px] uppercase tracking-wider"
            onClick={handleSaveSettings}
          >
            {t('settings_page.save_changes')}
          </Button>
        )}
      </div>
      <ConfirmDialog />
    </div>
  );
}
