import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import {
  clearAllData,
  getDemoModeStatus,
  persistLanguageForDaemon,
  rebuildSessions,
  setDemoMode,
} from '@/lib/tauri';
import type { DemoModeStatus } from '@/lib/db-types';
import { useDataStore } from '@/store/data-store';
import { useSettingsStore } from '@/store/settings-store';
import {
  type AppLanguageCode,
  type LanguageSettings,
  loadWorkingHoursSettings,
  normalizeHexColor,
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
import { createInlineTranslator } from '@/lib/inline-i18n';
import { emitProjectsAllTimeInvalidated } from '@/lib/sync-events';
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

function splitTime(value: string): [string, string] {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return ['09', '00'];
  return [match[1], match[2]];
}

export function Settings() {
  const { i18n, t } = useTranslation();
  const tt = createInlineTranslator(t, i18n.resolvedLanguage ?? i18n.language);
  const { showError, showInfo } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const setCurrencyCode = useSettingsStore((s) => s.setCurrencyCode);
  const setChartAnimations = useSettingsStore((s) => s.setChartAnimations);
  const [clearing, setClearing] = useState(false);
  const [showSavedToast, setShowSavedToast] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
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
    return () => clearTimeout(toastTimerRef.current);
  }, []);
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
        const status = await getDemoModeStatus();
        if (!cancelled) {
          setDemoModeStatus(status);
        }
      } catch (e) {
        if (!cancelled) {
          setDemoModeError(String(e));
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
  }, []);

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
        tt('Użyj poprawnego czasu HH:mm.', 'Please use a valid HH:mm time.'),
      );
      setSavedSettings(false);
      return;
    }
    if (endMinutes <= startMinutes) {
      setWorkingHoursError(
        tt(
          "Godzina 'Do' musi być późniejsza niż 'Od'.",
          "'To' time must be later than 'From' time.",
        ),
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
    void persistLanguageForDaemon(savedLanguage.code).catch((err) => {
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
    setShowSavedToast(true);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setShowSavedToast(false), 3000);
    triggerRefresh();
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
      const merged = await rebuildSessions(sessionSettings.gapFillMinutes);
      showInfo(
        tt(
          'Pomyślnie połączono {{merged}} bliskich sesji.',
          'Successfully merged {{merged}} close sessions.',
          { merged },
        ),
      );
    } catch (e) {
      console.error(e);
      showError(
        tt('Błąd łączenia sesji: ', 'Error linking sessions: ') + String(e),
      );
    } finally {
      setRebuilding(false);
    }
  };

  const handleClearData = async () => {
    const confirmed = await confirm(
      tt(
        'Czy na pewno chcesz usunąć wszystkie dane? Tej operacji nie można cofnąć.',
        'Are you sure you want to delete all data? This cannot be undone.',
      ),
    );
    if (!confirmed) return;
    setClearing(true);
    try {
      await clearAllData();
      setClearArmed(false);
      showInfo(tt('Wszystkie dane usunięte.', 'All data removed.'));
    } catch (e) {
      console.error(e);
      showError(
        tt('Nie udało się wyczyścić danych: ', 'Failed to clear data: ') +
          String(e),
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
        triggerRefresh();
      }
    } catch (e) {
      setManualSyncResult({
        ok: false,
        action: 'none',
        reason: 'sync_failed',
        serverRevision: onlineSyncState.serverRevision,
        error: String(e),
      });
    } finally {
      setManualSyncing(false);
    }
  };

  const handleToggleDemoMode = async (enabled: boolean) => {
    setDemoModeSwitching(true);
    setDemoModeError(null);
    try {
      const status = await setDemoMode(enabled);
      setDemoModeStatus(status);
      setManualSyncResult(null);
      showInfo(
        status.enabled
          ? tt(
              'Tryb demo włączony. Dashboard używa teraz bazy demo.',
              'Demo mode enabled. Dashboard now uses the demo database.',
            )
          : tt(
              'Tryb demo wyłączony. Dashboard używa teraz głównej bazy.',
              'Demo mode disabled. Dashboard now uses the primary database.',
            ),
      );
    } catch (e) {
      console.error(e);
      setDemoModeError(String(e));
      showError(
        tt(
          'Nie udało się przełączyć trybu demo: ',
          'Failed to switch demo mode: ',
        ) + String(e),
      );
    } finally {
      setDemoModeSwitching(false);
    }
  };

  const lastSyncLabel = onlineSyncState.lastSyncAt
    ? new Date(onlineSyncState.lastSyncAt).toLocaleString()
    : tt('Nigdy', 'Never');
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
        ? tt(
            'Ostatni manualny sync: pominięto (wyłączony w trybie demo)',
            'Last manual sync: skipped (disabled in Demo Mode)',
          )
        : manualSyncResult.ackPending
          ? tt(
              'Ostatni manualny sync: pull zastosowany, ACK oczekuje ({{detail}})',
              'Last manual sync: pull applied, ACK pending ({{detail}})',
              {
                detail:
                  manualSyncResult.ackReason ?? manualSyncResult.reason,
              },
            )
          : tt(
              'Ostatni manualny sync: {{action}} ({{reason}})',
              'Last manual sync: {{action}} ({{reason}})',
              {
                action: manualSyncResult.action,
                reason: manualSyncResult.reason,
              },
            )
      : tt(
          'Ostatni manualny sync nie powiódł się: {{error}}',
          'Last manual sync failed: {{error}}',
          {
            error: manualSyncResult.error ?? manualSyncResult.reason,
          },
        )
    : null;
  const manualSyncResultSuccess = manualSyncResult?.ok ?? false;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 pb-20">
      <div className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight px-1">
          {tt('Ustawienia ogólne', 'General Settings')}
        </h2>
        <WorkingHoursCard
          title={tt('Godziny pracy', 'Working Hours')}
          description={tt(
            'Służy do podświetlenia oczekiwanego okna pracy na osi czasu.',
            'Used to highlight expected work window on timeline.',
          )}
          fromLabel={tt('Od', 'From')}
          toLabel={tt('Do', 'To')}
          highlightColorLabel={tt('Kolor podświetlenia', 'Highlight Color')}
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
          title={tt('Waluta', 'Currency')}
          description={tt(
            'Wybierz preferowaną walutę dla wycen projektów.',
            'Select preferred currency for project values.',
          )}
          activeCurrencyLabel={tt('Aktywna waluta', 'Active Currency')}
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
          title={tt('Wygląd i wydajność', 'Appearance & Performance')}
          description={tt(
            'Dostosuj efekty wizualne i opcje wydajności.',
            'Adjust visual effects and performance options.',
          )}
          animationsTitle={tt('Włącz animacje wykresów', 'Enable chart animations')}
          animationsDescription={tt(
            'Wyłącz, aby poprawić responsywność UI na wolniejszych urządzeniach.',
            'Turn off to improve UI responsiveness on slower devices.',
          )}
          checked={appearanceSettings.chartAnimations}
          onToggle={(enabled) => {
            setAppearanceSettings((prev) => ({ ...prev, chartAnimations: enabled }));
            setSavedSettings(false);
          }}
        />
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight px-1 mt-8 text-sky-400">
          {tt('Zaawansowane / Algorytmy', 'Advanced / Algorithms')}
        </h2>

        <SessionManagementCard
          title={tt('Zarządzanie sesjami', 'Session Management')}
          description={tt(
            'Reguły automatycznego łączenia bliskich sesji.',
            'Rules for automatic merging of nearby sessions.',
          )}
          mergeGapLabel={tt('Przerwa scalania', 'Merge Gap')}
          mergeGapAriaLabel={tt(
            'Przerwa scalania w minutach',
            'Merge gap in minutes',
          )}
          minutesLabel={tt('min', 'min')}
          sliderValue={sliderValue}
          skipShortSessionsTitle={t(
            'settings.session.skipShortTitle',
            'Skip short sessions',
          )}
          skipShortSessionsDescription={tt(
            'Sesje krótsze lub równe tej wartości będą ukryte na liście.',
            'Sessions shorter than or equal to this duration will be hidden from the list.',
          )}
          minDurationAriaLabel={tt(
            'Minimalna długość sesji w sekundach',
            'Minimum session duration in seconds',
          )}
          minDurationSeconds={sessionSettings.minSessionDurationSeconds}
          secondsLabel={tt('sek', 'sec')}
          autoRebuildTitle={tt(
            'Auto-przebudowa przy starcie',
            'Auto-rebuild on startup',
          )}
          autoRebuildDescription={tt(
            'Automatycznie łącz bliskie sesje przy uruchomieniu aplikacji.',
            'Automatically merge close sessions when app starts.',
          )}
          rebuildOnStartup={sessionSettings.rebuildOnStartup}
          rebuildExistingTitle={tt(
            'Przebuduj istniejące sesje',
            'Rebuild Existing Sessions',
          )}
          rebuildExistingDescription={tt(
            'Zastosuj aktualny próg scalania do już zaimportowanych sesji.',
            'Apply current merge gap to already imported sessions.',
          )}
          rebuildingLabel={tt('Przebudowa...', 'Rebuilding...')}
          rebuildLabel={tt('Przebuduj', 'Rebuild')}
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
          title={tt('Synchronizacja online', 'Online Sync')}
          description={tt(
            'Synchronizacja przy starcie z serwerem zdalnym (snapshot push/pull).',
            'Startup synchronization with remote server using snapshot push/pull.',
          )}
          enableSyncTitle={t(
            'settings.online_sync.enableTitle',
            'Enable online sync',
          )}
          enableSyncDescription={tt(
            'Pozwala dashboardowi wymieniać snapshoty danych z serwerem sync.',
            'Allows the dashboard to exchange data snapshots with the sync server.',
          )}
          syncOnStartupTitle={tt('Synchronizuj przy starcie', 'Sync on startup')}
          syncOnStartupDescription={tt(
            'Uruchamia status -> pull/push po zakończeniu lokalnego auto-importu.',
            'Runs status -> pull/push after local auto-import finishes.',
          )}
          autoSyncIntervalTitle={tt('Interwał auto-sync', 'Auto sync interval')}
          autoSyncIntervalDescription={tt(
            'Cykliczny sync po uruchomieniu aplikacji. Domyślnie co 30 minut.',
            'Periodic sync after app startup. Default is every 30 minutes.',
          )}
          minutesLabel={tt('min', 'min')}
          enableLoggingTitle={t(
            'settings.online_sync.loggingTitle',
            'Enable sync logging',
          )}
          enableLoggingDescription={tt(
            'Zapisuj szczegółowe operacje sync do logów diagnostycznych.',
            'Save detailed sync operations to log file for debugging.',
          )}
          serverUrlLabel={tt('URL serwera', 'Server URL')}
          useDefaultServerLabel={t(
            'settings.online_sync.useRailwayDefault',
            'Use Railway Default',
          )}
          userIdLabel={tt('ID użytkownika', 'User ID')}
          userIdPlaceholder="e.g. demo-user / email / UUID"
          apiTokenLabel={tt('Token API (Bearer)', 'API Token (Bearer)')}
          apiTokenPlaceholder={tt(
            "Wklej surowy token (bez prefiksu 'Bearer ' i bez cudzysłowów)",
            "Paste the raw token (without 'Bearer ' prefix and without quotes)",
          )}
          showTokenLabel={tt('Pokaż token', 'Show token')}
          hideTokenLabel={tt('Ukryj token', 'Hide token')}
          apiTokenHint={tt(
            'Wprowadź surowy token; aplikacja automatycznie doda nagłówek Bearer.',
            'Enter the raw token; the app will add the Bearer header automatically.',
          )}
          deviceIdLabel={tt('ID urządzenia', 'Device ID')}
          generatedOnSaveLabel={tt(
            '(wygenerowane przy zapisie)',
            '(generated on save)',
          )}
          deviceIdHint={tt(
            'Generowane automatycznie i używane do identyfikacji tej maszyny podczas sync.',
            'Generated automatically and used to identify this machine during sync.',
          )}
          statusTitle={tt('Status ostatniej synchronizacji', 'Last Sync Status')}
          lastSuccessfulLabel={tt(
            'Ostatni udany check/sync:',
            'Last successful check/sync:',
          )}
          demoModeDisabledWarning={tt(
            'Synchronizacja online jest wyłączona, gdy aktywny jest tryb demo.',
            'Online sync is disabled while Demo Mode is active.',
          )}
          serverRevisionLabel={tt('Rewizja serwera:', 'Server revision:')}
          serverHashLabel={tt('Hash serwera:', 'Server hash:')}
          localRevisionHashLabel={tt('Lokalna rew/hash:', 'Local rev/hash:')}
          pendingAckLabel={tt('Oczekujące ACK:', 'Pending ACK:')}
          retriesLabel={tt('ponowienia', 'retries')}
          reseedWarning={tt(
            'Payload serwera został wyczyszczony po ACK. Wymagany lokalny reseed/eksport.',
            'Server payload was cleaned up after ACKs. Local reseed/export is required.',
          )}
          syncingLabel={tt('Synchronizacja...', 'Syncing...')}
          syncDisabledInDemoLabel={t(
            'settings.online_sync.syncDisabledInDemo',
            'Sync disabled in demo',
          )}
          syncNowLabel={tt('Synchronizuj teraz', 'Sync now')}
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
          title={tt('Zamrażanie projektów', 'Project Freezing')}
          description={tt(
            'Projekty nieaktywne przez zadany okres są automatycznie zamrażane i ukrywane na listach przypisań sesji.',
            'Projects inactive for a set period are automatically frozen and hidden from session assignment lists.',
          )}
          thresholdTitle={tt('Próg nieaktywności', 'Inactivity threshold')}
          thresholdDescription={tt(
            'Liczba dni bez aktywności, po której projekt zostanie automatycznie zamrożony.',
            'Number of days without activity after which a project is automatically frozen.',
          )}
          thresholdAriaLabel={tt(
            'Próg zamrożenia w dniach',
            'Freeze threshold in days',
          )}
          daysLabel={tt('dni', 'days')}
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
          title={tt('Tryb demo', 'Demo Mode')}
          description={tt(
            'Przełącz źródło danych dashboardu na osobny plik bazy demo (trwałe po restarcie).',
            'Switch dashboard data source to a separate demo database file (persists after restart).',
          )}
          toggleTitle={tt('Użyj bazy demo', 'Use demo database')}
          toggleDescription={tt(
            'Dotyczy całego dashboardu (odczyt/zapis/import) i przełącza na osobny plik SQLite. W trybie demo odświeżanie dzienne czyta z fake_data i oczekuje fake w nazwie pliku JSON (np. 2026-02-22_fake.json).',
            'Applies to the whole dashboard app (reads/writes/imports) and switches to a separate SQLite file. In demo mode, live daily refresh reads from fake_data and expects fake in the JSON filename (for example 2026-02-22_fake.json).',
          )}
          loadingStatusText={tt(
            'Wczytywanie statusu trybu demo...',
            'Loading demo mode status...',
          )}
          activeDbLabel={tt('Aktywna DB:', 'Active DB:')}
          primaryDbLabel={tt('Główna DB:', 'Primary DB:')}
          demoDbLabel={tt('Demo DB:', 'Demo DB:')}
          demoActiveText={tt(
            'Tryb demo jest aktywny. Nowe importy/zmiany trafią do bazy demo.',
            'Demo mode is active. New imports/changes will affect the demo database.',
          )}
          primaryActiveText={tt('Aktywny jest tryb główny.', 'Primary mode is active.')}
          unavailableStatusText={tt(
            'Status trybu demo niedostępny.',
            'Demo mode status unavailable.',
          )}
          switchingLabel={tt('Przełączanie...', 'Switching...')}
          disableLabel={tt('Wyłącz tryb demo', 'Disable Demo Mode')}
          enableLabel={tt('Włącz tryb demo', 'Enable Demo Mode')}
          onToggle={(enabled) => {
            void handleToggleDemoMode(enabled);
          }}
        />
        <DangerZoneCard
          clearArmed={clearArmed}
          clearing={clearing}
          title={tt('Strefa ryzyka', 'Danger Zone')}
          description={tt(
            'Domyślnie ukryte, aby uniknąć przypadkowych kliknięć.',
            'Hidden by default to avoid accidental clicks.',
          )}
          controlsLabel={tt('Kontrolki czyszczenia danych', 'Data wipe controls')}
          openLabel={tt('Otwórz', 'Open')}
          closeLabel={tt('Zamknij', 'Close')}
          detailsText={tt(
            'Usuwa wszystkie zaimportowane sesje i historię z lokalnej bazy danych.',
            'Deletes all imported sessions and history from local database.',
          )}
          enableLabel={tt('Włącz czyszczenie danych', 'Enable clear action')}
          clearingLabel={tt('Czyszczenie...', 'Clearing...')}
          clearLabel={tt('Wyczyść dane', 'Clear Data')}
          onClearArmedChange={setClearArmed}
          onClearData={() => {
            void handleClearData();
          }}
        />
      </div>

      <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2">
        {showSavedToast && (
          <div className="rounded-full bg-emerald-500/20 px-3 py-1.5 text-[11px] font-bold text-emerald-400 border border-emerald-500/40 shadow-xl animate-in fade-in zoom-in slide-in-from-bottom-2 duration-300">
            {tt('Zapisano', 'Saved')}
          </div>
        )}

        {!savedSettings && (
          <Button
            className="h-8 min-w-[7rem] rounded-full shadow-[0_0_20px_rgba(16,185,129,0.4)] transition-all duration-300 hover:scale-110 active:scale-95 animate-shine text-white border-none font-black text-[10px] uppercase tracking-wider"
            onClick={handleSaveSettings}
          >
            {tt('ZAPISZ ZMIANY!', 'SAVE CHANGES!')}
          </Button>
        )}
      </div>
      <ConfirmDialog />
    </div>
  );
}
