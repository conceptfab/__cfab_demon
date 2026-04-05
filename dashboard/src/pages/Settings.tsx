import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { useDataStore } from '@/store/data-store';
import { useSettingsStore } from '@/store/settings-store';
import { useUIStore } from '@/store/ui-store';
import { type AppLanguageCode } from '@/lib/user-settings';
import { DEFAULT_ONLINE_SYNC_SERVER_URL } from '@/lib/online-sync';
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
import { LanSyncCard } from '@/components/settings/LanSyncCard';
import { DevSettingsCard } from '@/components/settings/DevSettingsCard';
import { useSettingsFormState } from '@/hooks/useSettingsFormState';
import { useSettingsDemoMode } from '@/hooks/useSettingsDemoMode';
import { lanSyncApi, settingsApi } from '@/lib/tauri';
import { loadLanSyncSettings, saveLanSyncSettings, loadLanSyncState, recordPeerSync } from '@/lib/lan-sync';
import type { LanPeer, LanSyncSettings as LanSyncSettingsType, SyncMarker } from '@/lib/lan-sync-types';

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
  const setStoreWorkingHours = useSettingsStore((s) => s.setWorkingHours);
  const setStoreLanguage = useSettingsStore((s) => s.setLanguage);
  const setStoreSplitSettings = useSettingsStore((s) => s.setSplitSettings);
  const setPageChangeGuard = useUIStore((s) => s.setPageChangeGuard);

  const {
    clearing,
    clearArmed,
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
    handleDeactivateLicense,
    testingRoundtrip,
    testRoundtripResult,
    testRoundtripSuccess,
    handleTestRoundtrip,
    handleForceSyncNow,
  } = useSettingsFormState({
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
  });

  const {
    demoModeStatus,
    demoModeLoading,
    demoModeSwitching,
    demoModeError,
    handleToggleDemoMode,
  } = useSettingsDemoMode({
    t,
    showInfo,
    showError,
    onEnabledChange: () => {
      resetManualSyncResult();
    },
  });

  // ── Tab state ──
  const [activeTab, setActiveTab] = useState<'general' | 'dev'>('general');

  // ── LAN Sync state ──
  const [lanSettings, setLanSettings] = useState<LanSyncSettingsType>(loadLanSyncSettings);
  const [lanPeers, setLanPeers] = useState<LanPeer[]>([]);
  const [lanSyncing, setLanSyncing] = useState(false);
  const [lanSyncResult, setLanSyncResult] = useState<{ text: string; success: boolean } | null>(null);
  const [latestMarker, setLatestMarker] = useState<SyncMarker | null>(null);
  const [myIp, setMyIp] = useState('');

  const [lastSyncAt, setLastSyncAt] = useState(() => loadLanSyncState().lastSyncAt);
  useEffect(() => {
    setLastSyncAt(loadLanSyncState().lastSyncAt);
  }, [lanSyncing]);

  const syncPhaseLabels = useMemo(() => ({
    sync_phase_idle: t('settings.lan_sync.sync_phase_idle'),
    sync_phase_starting: t('settings.lan_sync.sync_phase_starting'),
    sync_phase_negotiating: t('settings.lan_sync.sync_phase_negotiating'),
    sync_phase_negotiated: t('settings.lan_sync.sync_phase_negotiated'),
    sync_phase_freezing: t('settings.lan_sync.sync_phase_freezing'),
    sync_phase_downloading: t('settings.lan_sync.sync_phase_downloading'),
    sync_phase_received: t('settings.lan_sync.sync_phase_received'),
    sync_phase_backup: t('settings.lan_sync.sync_phase_backup'),
    sync_phase_merging: t('settings.lan_sync.sync_phase_merging'),
    sync_phase_verifying: t('settings.lan_sync.sync_phase_verifying'),
    sync_phase_uploading: t('settings.lan_sync.sync_phase_uploading'),
    sync_phase_slave_downloading: t('settings.lan_sync.sync_phase_slave_downloading'),
    sync_phase_completed: t('settings.lan_sync.sync_phase_completed'),
  }), [t]);

  // Get local LAN IP
  useEffect(() => {
    lanSyncApi.getLocalIps().then((ips) => {
      setMyIp(ips[0] || '');
    }).catch(() => {});
  }, []);

  // Load latest sync marker
  useEffect(() => {
    lanSyncApi.getLatestSyncMarker().then(setLatestMarker).catch(() => {});
  }, [lanSyncing]); // Refresh after sync completes

  // Poll peers every 5s; auto-scan subnet once if no peers found after 10s
  useEffect(() => {
    if (!lanSettings.enabled) {
      setLanPeers([]);
      return;
    }
    let autoScanned = false;
    const poll = () => {
      lanSyncApi.getLanPeers().then((peers) => {
        setLanPeers((prev) => {
          if (prev.length !== peers.length) return peers;
          const changed = peers.some((p, i) =>
            p.device_id !== prev[i]?.device_id ||
            p.dashboard_running !== prev[i]?.dashboard_running ||
            p.ip !== prev[i]?.ip
          );
          return changed ? peers : prev;
        });
      }).catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, 5_000);
    // Auto-scan subnet if daemon discovery hasn't found anyone after 10s
    const scanTimer = window.setTimeout(() => {
      if (autoScanned) return;
      lanSyncApi.getLanPeers().then((peers) => {
        if (peers.length === 0 && !autoScanned) {
          autoScanned = true;
          lanSyncApi.scanLanSubnet().catch(() => {});
        }
      }).catch(() => {});
    }, 10_000);
    return () => {
      clearInterval(id);
      clearTimeout(scanTimer);
    };
  }, [lanSettings.enabled]);

  // Start/stop LAN server based on enabled setting
  useEffect(() => {
    if (lanSettings.enabled) {
      lanSyncApi.startLanServer(lanSettings.serverPort).catch((e) => {
        console.warn('Failed to start LAN server:', e);
      });
    } else {
      lanSyncApi.stopLanServer().catch(() => {});
    }
  }, [lanSettings.enabled, lanSettings.serverPort]);

  const updateLanSettings = useCallback((updater: (prev: LanSyncSettingsType) => LanSyncSettingsType) => {
    setLanSettings((prev) => {
      const next = updater(prev);
      saveLanSyncSettings(next);
      // Persist to file for daemon to read
      settingsApi.persistLanSyncSettingsForDaemon(
        next.syncIntervalHours,
        next.discoveryDurationMinutes,
        next.enabled,
        next.forcedRole,
        next.autoSyncOnPeerFound,
      ).catch((e) => console.warn('Failed to persist LAN sync settings for daemon:', e));
      return next;
    });
  }, []);

  const handleLanSync = useCallback(async (peer: LanPeer, fullSync = false, force = false) => {
    setLanSyncing(true);
    setLanSyncResult(null);
    try {
      const state = loadLanSyncState();
      const since = (fullSync || force)
        ? '1970-01-01T00:00:00Z'
        : (state.peerSyncTimes?.[peer.device_id] || state.lastSyncAt || '1970-01-01T00:00:00Z');

      await lanSyncApi.runLanSync(peer.ip, peer.dashboard_port, since, force);
      // LanSyncCard already polls progress — no duplicate polling here.
      recordPeerSync(peer);
      const label = force
        ? t('settings.lan_sync.force_sync_label', 'Force sync')
        : fullSync
          ? t('settings.lan_sync.full_sync_label', 'Full sync')
          : t('settings.lan_sync.sync_label', 'Sync');
      setLanSyncResult({ text: `${label} — OK`, success: true });
      triggerRefresh('lan_sync_pull');
    } catch (e) {
      setLanSyncResult({ text: e instanceof Error ? e.message : String(e), success: false });
    } finally {
      setLanSyncing(false);
    }
  }, [triggerRefresh]);

  const handleManualPing = useCallback(async (ip: string, port: number): Promise<LanPeer | null> => {
    const result = await lanSyncApi.pingLanPeer(ip, port);
    const peer: LanPeer = {
      device_id: result.device_id,
      machine_name: result.machine_name,
      ip: result.ip,
      dashboard_port: result.dashboard_port,
      last_seen: new Date().toISOString(),
      dashboard_running: true,
    };
    // Persist to lan_peers.json so sidebar polling picks it up
    await lanSyncApi.upsertLanPeer(peer);
    setLanPeers((prev) => {
      const exists = prev.some((p) => p.device_id === peer.device_id);
      return exists ? prev.map((p) => p.device_id === peer.device_id ? peer : p) : [...prev, peer];
    });
    return peer;
  }, []);

  const labelClassName = 'text-sm font-medium text-muted-foreground';
  const compactSelectClassName =
    'h-8 w-[3.75rem] rounded-md border border-input bg-background px-1.5 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40';

  const languageOptions: Array<{ code: AppLanguageCode; label: string }> = [
    { code: 'pl', label: t('settings.language.option.pl') },
    { code: 'en', label: t('settings.language.option.en') },
  ];

  const currencyOptions = useMemo(
    () => [
      { code: 'PLN', symbol: 'zł' },
      { code: 'USD', symbol: '$' },
      { code: 'EUR', symbol: '€' },
    ],
    [],
  );

  const demoModeSyncDisabled = demoModeStatus?.enabled === true;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 pb-20">
      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-border/50 px-1">
        <button
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === 'general'
              ? 'border-sky-400 text-sky-400'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('general')}
        >
          {t('settings_page.general_settings')}
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === 'dev'
              ? 'border-amber-400 text-amber-400'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('dev')}
        >
          DEV
        </button>
      </div>

      {activeTab === 'dev' ? (
        <div className="space-y-4">
          <DevSettingsCard />
        </div>
      ) : (
      <>
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
            updateWorkingHours((prev) => ({ ...prev, color }));
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
            updateCurrencySettings({ code });
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
            updateLanguageSettings({ code: code as AppLanguageCode });
          }}
        />

        <AppearanceCard
          title={t('settings_page.appearance_performance')}
          description={t('settings_page.adjust_visual_effects_and_performance_options')}
          animationsTitle={t('settings_page.enable_chart_animations')}
          animationsDescription={t('settings_page.turn_off_to_improve_ui_responsiveness_on_slower_devices')}
          checked={appearanceSettings.chartAnimations}
          onToggle={(enabled) => {
            updateAppearanceSettings((prev) => ({
              ...prev,
              chartAnimations: enabled,
            }));
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
          skipShortSessionsTitle={t('settings.session.skipShortTitle')}
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
            updateSessionSettings((prev) => ({
              ...prev,
              gapFillMinutes: minutes,
            }));
          }}
          onMinDurationChange={(seconds) => {
            updateSessionSettings((prev) => ({
              ...prev,
              minSessionDurationSeconds: seconds,
            }));
          }}
          onRebuildOnStartupChange={(enabled) => {
            updateSessionSettings((prev) => ({
              ...prev,
              rebuildOnStartup: enabled,
            }));
          }}
          onRebuild={() => {
            void handleRebuildSessions();
          }}
        />

        <SessionSplitCard
          title={t('settings.splitTitle')}
          maxProjectsTitle={t('settings.splitMaxProjects')}
          maxProjectsDescription={t('settings.splitMaxProjectsDesc')}
          toleranceTitle={t('settings.splitTolerance')}
          toleranceLowLabel={t('settings.splitToleranceLow')}
          toleranceHighLabel={t('settings.splitToleranceHigh')}
          toleranceDescription={splitToleranceDescription}
          autoSplitTitle={t('settings.splitAuto')}
          autoSplitDescription={t('settings.splitAutoDesc')}
          splitSettings={splitSettings}
          onMaxProjectsChange={(maxProjects) => {
            updateSplitSetting('maxProjectsPerSession', maxProjects);
          }}
          onToleranceThresholdChange={(threshold) => {
            updateSplitSetting('toleranceThreshold', threshold);
          }}
          onAutoSplitEnabledChange={(enabled) => {
            updateSplitSetting('autoSplitEnabled', enabled);
          }}
        />

        <LanSyncCard
          settings={lanSettings}
          peers={lanPeers}
          syncing={lanSyncing}
          lastSyncAt={lastSyncAt}
          lastSyncResult={lanSyncResult?.text ?? null}
          lastSyncSuccess={lanSyncResult?.success ?? false}
          latestMarker={latestMarker}
          title={t('settings.lan_sync.title')}
          description={t('settings.lan_sync.description')}
          enableTitle={t('settings.lan_sync.enable_title')}
          enableDescription={t('settings.lan_sync.enable_description')}
          autoSyncTitle={t('settings.lan_sync.auto_sync_title')}
          autoSyncDescription={t('settings.lan_sync.auto_sync_description')}
          syncIntervalLabel={t('settings.lan_sync.sync_interval')}
          syncMarkerLabel={t('settings.lan_sync.sync_marker')}
          peersTitle={t('settings.lan_sync.peers_title')}
          noPeersText={t('settings.lan_sync.no_peers')}
          syncButtonLabel={t('settings.lan_sync.sync_button')}
          syncingLabel={t('settings.lan_sync.syncing')}
          lastSyncLabel={t('settings.lan_sync.last_sync')}
          dashboardRunningLabel={t('settings.lan_sync.dashboard_running')}
          dashboardOfflineLabel={t('settings.lan_sync.dashboard_offline')}
          roleLabel={t('settings.lan_sync.role_label')}
          roleAutoLabel={t('settings.lan_sync.role_auto')}
          roleMasterLabel={t('settings.lan_sync.role_master')}
          roleSlaveLabel={t('settings.lan_sync.role_slave')}
          manualSearchLabel={t('settings.lan_sync.my_ip_label')}
          manualSearchPlaceholder={t('settings.lan_sync.manual_search_placeholder')}
          manualSearchButton={t('settings.lan_sync.manual_search_button')}
          myIpLabel={t('settings.lan_sync.my_ip_label')}
          myIp={myIp}
          onManualPing={handleManualPing}
          labelClassName={labelClassName}
          onEnabledChange={(enabled) => {
            updateLanSettings((prev) => ({ ...prev, enabled }));
          }}
          onAutoSyncChange={(autoSyncOnPeerFound) => {
            updateLanSettings((prev) => ({ ...prev, autoSyncOnPeerFound }));
          }}
          onSyncIntervalChange={(syncIntervalHours) => {
            updateLanSettings((prev) => ({ ...prev, syncIntervalHours }));
          }}
          onForcedRoleChange={(forcedRole) => {
            updateLanSettings((prev) => ({ ...prev, forcedRole }));
          }}
          onSyncWithPeer={(peer) => {
            void handleLanSync(peer);
          }}
          onFullSyncWithPeer={(peer) => {
            void handleLanSync(peer, true);
          }}
          onForceSyncWithPeer={(peer) => {
            void handleLanSync(peer, true, true);
          }}
          fullSyncButtonLabel={t('settings.lan_sync.full_sync')}
          forceSyncButtonLabel={t('settings.lan_sync.force_sync')}
          slaveInfoText={t('settings.lan_sync.slave_info')}
          showLogLabel={t('settings.lan_sync.show_log')}
          hideLogLabel={t('settings.lan_sync.hide_log')}
          noLogEntriesText={t('settings.lan_sync.no_log_entries')}
          forceMergeTooltip={t('settings.lan_sync.force_merge_tooltip')}
          syncPhaseLabels={syncPhaseLabels}
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
          defaultServerUrl={DEFAULT_ONLINE_SYNC_SERVER_URL}
          labelClassName={labelClassName}
          lastSyncLabel={lastSyncLabel}
          shortHash={shortHash}
          localHashShort={localHashShort}
          pendingAckHashShort={pendingAckHashShort}
          onEnabledChange={(enabled) => {
            updateOnlineSyncSettings((prev) => ({ ...prev, enabled }));
          }}
          onAutoSyncOnStartupChange={(enabled) => {
            updateOnlineSyncSettings((prev) => ({
              ...prev,
              autoSyncOnStartup: enabled,
            }));
          }}
          onAutoSyncIntervalChange={(minutes) => {
            updateOnlineSyncSettings((prev) => ({
              ...prev,
              autoSyncIntervalMinutes: minutes,
            }));
          }}
          onEnableLoggingChange={(enabled) => {
            updateOnlineSyncSettings((prev) => ({
              ...prev,
              enableLogging: enabled,
            }));
          }}
          onServerUrlChange={(serverUrl) => {
            updateOnlineSyncSettings((prev) => ({ ...prev, serverUrl }));
          }}
          onResetServerUrl={() => {
            updateOnlineSyncSettings((prev) => ({
              ...prev,
              serverUrl: DEFAULT_ONLINE_SYNC_SERVER_URL,
            }));
          }}
          onUserIdChange={(userId) => {
            updateOnlineSyncSettings((prev) => ({ ...prev, userId }));
          }}
          onApiTokenChange={(apiToken) => {
            updateOnlineSyncSettings((prev) => ({ ...prev, apiToken }));
          }}
          onShowTokenChange={setShowOnlineSyncToken}
          onSyncNow={() => {
            void handleSyncNow(demoModeSyncDisabled);
          }}
          licenseInfo={licenseInfo}
          licenseKeyInput={licenseKeyInput}
          licenseActivating={licenseActivating}
          licenseError={licenseError}
          onLicenseKeyChange={setLicenseKeyInput}
          onActivateLicense={handleActivateLicense}
          onDeactivateLicense={handleDeactivateLicense}
          testingRoundtrip={testingRoundtrip}
          testRoundtripResult={testRoundtripResult}
          testRoundtripSuccess={testRoundtripSuccess}
          onTestRoundtrip={handleTestRoundtrip}
          onForceSyncNow={() => {
            void handleForceSyncNow(demoModeSyncDisabled);
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
            updateFreezeSettings((prev) => ({
              ...prev,
              thresholdDays: val,
            }));
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
      </>
      )}

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
