import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, Languages, TimerReset } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import {
  clearAllData,
  getDemoModeStatus,
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
} from '@/lib/user-settings';
import {
  DEFAULT_ONLINE_SYNC_SERVER_URL,
  loadOnlineSyncState,
  loadOnlineSyncSettings,
  runOnlineSyncOnce,
  saveOnlineSyncSettings,
  type OnlineSyncSettings,
  type OnlineSyncRunResult,
  type OnlineSyncState,
} from '@/lib/online-sync';
import { useInlineT } from '@/lib/inline-i18n';

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
  const tt = useInlineT();
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const setCurrencyCode = useSettingsStore((s) => s.setCurrencyCode);
  const setChartAnimations = useSettingsStore((s) => s.setChartAnimations);
  const [clearing, setClearing] = useState(false);
  const [showSavedToast, setShowSavedToast] = useState(false);
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
      setWorkingHoursError(tt('Użyj poprawnego czasu HH:mm.', 'Please use a valid HH:mm time.'));
      setSavedSettings(false);
      return;
    }
    if (endMinutes <= startMinutes) {
      setWorkingHoursError(tt("Godzina 'Do' musi być późniejsza niż 'Od'.", "'To' time must be later than 'From' time."));
      setSavedSettings(false);
      return;
    }

    const savedWorking = saveWorkingHoursSettings({
      ...workingHours,
      color: normalizedColor,
    });
    const savedSession = saveSessionSettings(sessionSettings);
    const savedOnlineSync = saveOnlineSyncSettings(onlineSyncSettings);
    const savedFreeze = saveFreezeSettings(freezeSettings);
    const savedCurrency = saveCurrencySettings(currencySettings);
    const savedLanguage = saveLanguageSettings(languageSettings);
    const savedAppearance = saveAppearanceSettings(appearanceSettings);

    setWorkingHours(savedWorking);
    setSessionSettings(savedSession);
    setOnlineSyncSettings(savedOnlineSync);
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
    setTimeout(() => setShowSavedToast(false), 3000);
    triggerRefresh();
  };

  const handleRebuildSessions = async () => {
    setRebuilding(true);
    try {
      const merged = await rebuildSessions(sessionSettings.gapFillMinutes);
      alert(tt(`Pomyślnie połączono ${merged} bliskich sesji.`, `Successfully merged ${merged} close sessions.`));
      triggerRefresh();
    } catch (e) {
      console.error(e);
      alert(tt('Błąd łączenia sesji: ', 'Error linking sessions: ') + String(e));
    } finally {
      setRebuilding(false);
    }
  };

  const handleClearData = async () => {
    if (
      !confirm(
        tt(
          'Czy na pewno chcesz usunąć wszystkie dane? Tej operacji nie można cofnąć.',
          'Are you sure you want to delete all data? This cannot be undone.',
        ),
      )
    )
      return;
    setClearing(true);
    try {
      await clearAllData();
      triggerRefresh();
      setClearArmed(false);
      alert(tt('Wszystkie dane usunięte.', 'All data removed.'));
    } catch (e) {
      console.error(e);
      alert(tt('Nie udało się wyczyścić danych: ', 'Failed to clear data: ') + String(e));
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
      const savedOnlineSync = saveOnlineSyncSettings(onlineSyncSettings);
      setOnlineSyncSettings(savedOnlineSync);

      const result = await runOnlineSyncOnce({ ignoreStartupToggle: true });
      setManualSyncResult(result);
      setOnlineSyncState(loadOnlineSyncState());

      if (result.ok && result.action === 'pull') {
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
      triggerRefresh();
      alert(
        status.enabled
          ? tt('Tryb demo włączony. Dashboard używa teraz bazy demo.', 'Demo mode enabled. Dashboard now uses the demo database.')
          : tt('Tryb demo wyłączony. Dashboard używa teraz głównej bazy.', 'Demo mode disabled. Dashboard now uses the primary database.'),
      );
    } catch (e) {
      console.error(e);
      setDemoModeError(String(e));
      alert(tt('Nie udało się przełączyć trybu demo: ', 'Failed to switch demo mode: ') + String(e));
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

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold">
            {tt('Godziny pracy', 'Working Hours')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {tt(
              'Służy do podświetlenia oczekiwanego okna pracy na osi czasu.',
              'Used to highlight expected work window on timeline.',
            )}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <div className="grid items-center gap-3 sm:grid-cols-[7.5rem_1fr]">
              <label className={labelClassName}>{tt('Od', 'From')}</label>
              <div className="flex items-center gap-1.5">
                <select
                  className={compactSelectClassName}
                  value={startHour}
                  onChange={(e) =>
                    updateTimePart('start', 'hour', e.target.value)
                  }
                >
                  {HOURS.map((hour) => (
                    <option key={hour} value={hour}>
                      {hour}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">:</span>
                <select
                  className={compactSelectClassName}
                  value={startMinute}
                  onChange={(e) =>
                    updateTimePart('start', 'minute', e.target.value)
                  }
                >
                  {MINUTES.map((minute) => (
                    <option key={minute} value={minute}>
                      {minute}
                    </option>
                  ))}
                </select>
              </div>

              <label className={labelClassName}>{tt('Do', 'To')}</label>
              <div className="flex items-center gap-1.5">
                <select
                  className={compactSelectClassName}
                  value={endHour}
                  onChange={(e) =>
                    updateTimePart('end', 'hour', e.target.value)
                  }
                >
                  {HOURS.map((hour) => (
                    <option key={hour} value={hour}>
                      {hour}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">:</span>
                <select
                  className={compactSelectClassName}
                  value={endMinute}
                  onChange={(e) =>
                    updateTimePart('end', 'minute', e.target.value)
                  }
                >
                  {MINUTES.map((minute) => (
                    <option key={minute} value={minute}>
                      {minute}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <div className="grid items-center gap-3 sm:grid-cols-[7.5rem_1fr]">
              <label className={labelClassName}>
                {tt('Kolor podświetlenia', 'Highlight Color')}
              </label>
              <div className="flex items-center gap-2.5">
                <input
                  type="color"
                  className="h-8 w-10 cursor-pointer rounded border border-input bg-background p-1"
                  value={normalizedColor}
                  onChange={(e) => {
                    setWorkingHours((prev) => ({
                      ...prev,
                      color: e.target.value,
                    }));
                    setWorkingHoursError(null);
                    setSavedSettings(false);
                  }}
                />
                <span className="font-mono text-sm text-muted-foreground">
                  {normalizedColor}
                </span>
              </div>
            </div>
          </div>

          {workingHoursError && (
            <p className="text-sm text-destructive">{workingHoursError}</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold">{tt('Waluta', 'Currency')}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {tt('Wybierz preferowaną walutę dla wycen projektów.', 'Select preferred currency for project values.')}
          </p>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <div className="grid items-center gap-3 sm:grid-cols-[7.5rem_1fr]">
              <label className={labelClassName}>{tt('Aktywna waluta', 'Active Currency')}</label>
              <div className="flex items-center gap-2">
                {[
                  { code: 'PLN', symbol: 'zł' },
                  { code: 'USD', symbol: '$' },
                  { code: 'EUR', symbol: '€' },
                ].map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => {
                      setCurrencySettings({ code: item.code });
                      setSavedSettings(false);
                    }}
                    className={`h-8 px-4 rounded-md text-sm font-medium transition-all ${
                      currencySettings.code === item.code
                        ? 'bg-primary text-primary-foreground shadow-sm scale-105'
                        : 'bg-background border border-input hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    {item.code}{' '}
                    <span className="opacity-50 text-[10px] ml-1">
                      ({item.symbol})
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Languages className="h-4 w-4 text-primary" />
            {t('settings.language.title')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t('settings.language.description')}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <div className="grid items-center gap-3 sm:grid-cols-[7.5rem_1fr]">
              <label className={labelClassName}>
                {t('settings.language.field')}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {languageOptions.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => {
                      setLanguageSettings({ code: item.code });
                      setSavedSettings(false);
                    }}
                    className={`h-8 px-4 rounded-md text-sm font-medium transition-all ${
                      languageSettings.code === item.code
                        ? 'bg-primary text-primary-foreground shadow-sm scale-105'
                        : 'bg-background border border-input hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('settings.language.rollout_note')}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold">
            {tt('Zarządzanie sesjami', 'Session Management')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {tt('Reguły automatycznego łączenia bliskich sesji.', 'Rules for automatic merging of nearby sessions.')}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <div className="grid items-center gap-3 sm:grid-cols-[7.5rem_1fr]">
              <label className={labelClassName}>{tt('Przerwa scalania', 'Merge Gap')}</label>
              <div className="w-full space-y-1.5">
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="30"
                    step="1"
                    aria-label={tt('Przerwa scalania w minutach', 'Merge gap in minutes')}
                    className="h-2 w-full cursor-pointer accent-primary"
                    value={sliderValue}
                    onChange={(e) => {
                      const val = Number.parseInt(e.target.value, 10);
                      if (!Number.isNaN(val)) {
                        setSessionSettings((prev) => ({
                          ...prev,
                          gapFillMinutes: val,
                        }));
                        setSavedSettings(false);
                      }
                    }}
                  />
                  <span className="min-w-[4.75rem] whitespace-nowrap text-right font-mono text-sm text-foreground">
                    {sliderValue} {tt('min', 'min')}
                  </span>
                </div>
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>0 {tt('min', 'min')}</span>
                  <span>30 {tt('min', 'min')}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <p className="text-sm font-medium">{tt('Pomijaj krótkie sesje', 'Skip short sessions')}</p>
                <p className="text-xs leading-5 break-words text-muted-foreground">
                  {tt(
                    'Sesje krótsze lub równe tej wartości będą ukryte na liście.',
                    'Sessions shorter than or equal to this duration will be hidden from the list.',
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={300}
                  step={1}
                  aria-label={tt('Minimalna długość sesji w sekundach', 'Minimum session duration in seconds')}
                  className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  value={sessionSettings.minSessionDurationSeconds}
                  onChange={(e) => {
                    const val = Number.parseInt(e.target.value, 10);
                    if (!Number.isNaN(val)) {
                      setSessionSettings((prev) => ({
                        ...prev,
                        minSessionDurationSeconds: val,
                      }));
                      setSavedSettings(false);
                    }
                  }}
                />
                <span className="text-sm text-muted-foreground">{tt('sek', 'sec')}</span>
              </div>
            </div>
          </div>

          <label
            htmlFor="rebuildOnStartup"
            className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{tt('Auto-przebudowa przy starcie', 'Auto-rebuild on startup')}</p>
              <p className="text-xs leading-5 break-words text-muted-foreground">
                {tt('Automatycznie łącz bliskie sesje przy uruchomieniu aplikacji.', 'Automatically merge close sessions when app starts.')}
              </p>
            </div>
            <input
              id="rebuildOnStartup"
              type="checkbox"
              className="h-4 w-4 rounded border-input accent-primary"
              checked={sessionSettings.rebuildOnStartup}
              onChange={(e) => {
                setSessionSettings((prev) => ({
                  ...prev,
                  rebuildOnStartup: e.target.checked,
                }));
                setSavedSettings(false);
              }}
            />
          </label>

          <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
              <p className="text-sm font-medium">{tt('Przebuduj istniejące sesje', 'Rebuild Existing Sessions')}</p>
              <p className="text-xs leading-5 break-words text-muted-foreground">
                {tt('Zastosuj aktualny próg scalania do już zaimportowanych sesji.', 'Apply current merge gap to already imported sessions.')}
              </p>
            </div>
            <Button
              variant="outline"
              className="h-8 w-fit"
              onClick={handleRebuildSessions}
              disabled={rebuilding}
            >
              <TimerReset className="mr-2 h-4 w-4" />
              {rebuilding ? tt('Przebudowa...', 'Rebuilding...') : tt('Przebuduj', 'Rebuild')}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold">{tt('Synchronizacja online', 'Online Sync')}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {tt(
              'Synchronizacja przy starcie z serwerem zdalnym (snapshot push/pull).',
              'Startup synchronization with remote server using snapshot push/pull.',
            )}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <label
            htmlFor="onlineSyncEnabled"
            className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{tt('Włącz synchronizację online', 'Enable online sync')}</p>
              <p className="text-xs leading-5 break-words text-muted-foreground">
                {tt(
                  'Pozwala dashboardowi wymieniać snapshoty danych z serwerem sync.',
                  'Allows the dashboard to exchange data snapshots with the sync server.',
                )}
              </p>
            </div>
            <input
              id="onlineSyncEnabled"
              type="checkbox"
              className="h-4 w-4 rounded border-input accent-primary"
              checked={onlineSyncSettings.enabled}
              onChange={(e) => {
                setOnlineSyncSettings((prev) => ({
                  ...prev,
                  enabled: e.target.checked,
                }));
                setSavedSettings(false);
              }}
            />
          </label>

          <label
            htmlFor="onlineSyncOnStartup"
            className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{tt('Synchronizuj przy starcie', 'Sync on startup')}</p>
              <p className="text-xs leading-5 break-words text-muted-foreground">
                {tt(
                  'Uruchamia status -> pull/push po zakończeniu lokalnego auto-importu.',
                  'Runs status -> pull/push after local auto-import finishes.',
                )}
              </p>
            </div>
            <input
              id="onlineSyncOnStartup"
              type="checkbox"
              className="h-4 w-4 rounded border-input accent-primary"
              checked={onlineSyncSettings.autoSyncOnStartup}
              onChange={(e) => {
                setOnlineSyncSettings((prev) => ({
                  ...prev,
                  autoSyncOnStartup: e.target.checked,
                }));
                setSavedSettings(false);
              }}
            />
          </label>

          <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
              <p className="text-sm font-medium">{tt('Interwał auto-sync', 'Auto sync interval')}</p>
              <p className="text-xs leading-5 break-words text-muted-foreground">
                {tt('Cykliczny sync po uruchomieniu aplikacji. Domyślnie co 30 minut.', 'Periodic sync after app startup. Default is every 30 minutes.')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={1440}
                step={1}
                className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                value={onlineSyncSettings.autoSyncIntervalMinutes}
                onChange={(e) => {
                  const nextValue = Number.parseInt(e.target.value, 10);
                  setOnlineSyncSettings((prev) => ({
                    ...prev,
                    autoSyncIntervalMinutes: Number.isFinite(nextValue)
                      ? Math.min(1440, Math.max(1, nextValue))
                      : prev.autoSyncIntervalMinutes,
                  }));
                  setSavedSettings(false);
                }}
              />
              <span className="text-sm text-muted-foreground">{tt('min', 'min')}</span>
            </div>
          </div>

          <label
            htmlFor="onlineSyncLogging"
            className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{tt('Włącz logowanie synchronizacji', 'Enable sync logging')}</p>
              <p className="text-xs leading-5 break-words text-muted-foreground">
                {tt('Zapisuj szczegółowe operacje sync do logów diagnostycznych.', 'Save detailed sync operations to log file for debugging.')}
              </p>
            </div>
            <input
              id="onlineSyncLogging"
              type="checkbox"
              className="h-4 w-4 rounded border-input accent-primary"
              checked={onlineSyncSettings.enableLogging}
              onChange={(e) => {
                setOnlineSyncSettings((prev) => ({
                  ...prev,
                  enableLogging: e.target.checked,
                }));
                setSavedSettings(false);
              }}
            />
          </label>

          <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3">
            <label className="grid gap-1.5 text-sm">
              <span className={labelClassName}>{tt('URL serwera', 'Server URL')}</span>
              <input
                type="text"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                placeholder={DEFAULT_ONLINE_SYNC_SERVER_URL}
                value={onlineSyncSettings.serverUrl}
                onChange={(e) => {
                  setOnlineSyncSettings((prev) => ({
                    ...prev,
                    serverUrl: e.target.value,
                  }));
                  setSavedSettings(false);
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setOnlineSyncSettings((prev) => ({
                      ...prev,
                      serverUrl: DEFAULT_ONLINE_SYNC_SERVER_URL,
                    }));
                    setSavedSettings(false);
                  }}
                >
                  {tt('Użyj domyślnego Railway', 'Use Railway Default')}
                </Button>
                <span className="text-xs text-muted-foreground break-all">
                  {DEFAULT_ONLINE_SYNC_SERVER_URL}
                </span>
              </div>
            </label>

            <label className="grid gap-1.5 text-sm">
              <span className={labelClassName}>{tt('ID użytkownika', 'User ID')}</span>
              <input
                type="text"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                placeholder="e.g. demo-user / email / UUID"
                value={onlineSyncSettings.userId}
                onChange={(e) => {
                  setOnlineSyncSettings((prev) => ({
                    ...prev,
                    userId: e.target.value,
                  }));
                  setSavedSettings(false);
                }}
              />
            </label>

            <label className="grid gap-1.5 text-sm">
              <span className={labelClassName}>{tt('Token API (Bearer)', 'API Token (Bearer)')}</span>
              <div className="flex items-center gap-2">
                <input
                  type={showOnlineSyncToken ? 'text' : 'password'}
                  autoComplete="off"
                  className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  placeholder={tt(
                    "Wklej surowy token (bez prefiksu 'Bearer ' i bez cudzysłowów)",
                    "Paste the raw token (without 'Bearer ' prefix and without quotes)",
                  )}
                  value={onlineSyncSettings.apiToken}
                  onChange={(e) => {
                    setOnlineSyncSettings((prev) => ({
                      ...prev,
                      apiToken: e.target.value,
                    }));
                    setSavedSettings(false);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-10 px-0"
                  onClick={() => setShowOnlineSyncToken((prev) => !prev)}
                  aria-label={showOnlineSyncToken ? tt('Ukryj token', 'Hide token') : tt('Pokaż token', 'Show token')}
                  title={showOnlineSyncToken ? tt('Ukryj token', 'Hide token') : tt('Pokaż token', 'Show token')}
                >
                  {showOnlineSyncToken ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {tt(
                  'Wprowadź surowy token; aplikacja automatycznie doda nagłówek Bearer.',
                  'Enter the raw token; the app will add the Bearer header automatically.',
                )}
              </p>
            </label>

            <div className="grid gap-1.5 text-sm">
              <span className={labelClassName}>{tt('ID urządzenia', 'Device ID')}</span>
              <div className="rounded-md border border-input bg-muted/30 px-3 py-2 font-mono text-xs break-all">
                {onlineSyncSettings.deviceId || tt('(wygenerowane przy zapisie)', '(generated on save)')}
              </div>
              <p className="text-xs text-muted-foreground">
                {tt(
                  'Generowane automatycznie i używane do identyfikacji tej maszyny podczas sync.',
                  'Generated automatically and used to identify this machine during sync.',
                )}
              </p>
            </div>

            <div className="grid gap-3 rounded-md border border-border/70 bg-background/20 p-3 sm:grid-cols-[1fr_auto] sm:items-start">
              <div className="min-w-0 space-y-2">
                <div>
                  <p className="text-sm font-medium">{tt('Status ostatniej synchronizacji', 'Last Sync Status')}</p>
                  <p className="text-xs text-muted-foreground">
                    {tt('Ostatni udany check/sync:', 'Last successful check/sync:')} {lastSyncLabel}
                  </p>
                </div>

                {demoModeSyncDisabled && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-300">
                    {tt('Synchronizacja online jest wyłączona, gdy aktywny jest tryb demo.', 'Online sync is disabled while Demo Mode is active.')}
                  </div>
                )}

                <div className="grid gap-1 text-xs text-muted-foreground">
                  <div>
                    {tt('Rewizja serwera:', 'Server revision:')}{' '}
                    <span className="font-mono text-foreground">
                      {onlineSyncState.serverRevision}
                    </span>
                  </div>
                  <div>
                    {tt('Hash serwera:', 'Server hash:')}{' '}
                    <span className="font-mono text-foreground break-all">
                      {shortHash}
                    </span>
                  </div>
                  <div>
                    {tt('Lokalna rew/hash:', 'Local rev/hash:')}{' '}
                    <span className="font-mono text-foreground">
                      {onlineSyncState.localRevision ?? 'n/a'} /{' '}
                      {localHashShort}
                    </span>
                  </div>
                  {onlineSyncState.pendingAck && (
                    <div className="text-amber-500">
                      {tt('Oczekujące ACK:', 'Pending ACK:')}{' '}
                      <span className="font-mono text-foreground">
                        r{onlineSyncState.pendingAck.revision} /{' '}
                        {pendingAckHashShort}
                      </span>
                      {onlineSyncState.pendingAck.retries > 0 && (
                        <> ({tt('ponowienia', 'retries')}: {onlineSyncState.pendingAck.retries})</>
                      )}
                    </div>
                  )}
                  {onlineSyncState.needsReseed && (
                    <div className="text-amber-500">
                      {tt(
                        'Payload serwera został wyczyszczony po ACK. Wymagany lokalny reseed/eksport.',
                        'Server payload was cleaned up after ACKs. Local reseed/export is required.',
                      )}
                    </div>
                  )}
                </div>

                {manualSyncResult && (
                  <div
                    className={
                      manualSyncResult.ok
                        ? 'text-xs text-emerald-400'
                        : 'text-xs text-destructive'
                    }
                  >
                    {manualSyncResult.ok
                      ? manualSyncResult.skipped &&
                        manualSyncResult.reason === 'demo_mode'
                        ? tt('Ostatni manualny sync: pominięto (wyłączony w trybie demo)', 'Last manual sync: skipped (disabled in Demo Mode)')
                        : manualSyncResult.ackPending
                          ? tt(
                              `Ostatni manualny sync: pull zastosowany, ACK oczekuje (${manualSyncResult.ackReason ?? manualSyncResult.reason})`,
                              `Last manual sync: pull applied, ACK pending (${manualSyncResult.ackReason ?? manualSyncResult.reason})`,
                            )
                          : tt(
                              `Ostatni manualny sync: ${manualSyncResult.action} (${manualSyncResult.reason})`,
                              `Last manual sync: ${manualSyncResult.action} (${manualSyncResult.reason})`,
                            )
                      : tt(
                          `Ostatni manualny sync nie powiódł się: ${manualSyncResult.error ?? manualSyncResult.reason}`,
                          `Last manual sync failed: ${manualSyncResult.error ?? manualSyncResult.reason}`,
                        )}
                  </div>
                )}
              </div>

              <Button
                type="button"
                variant="outline"
                className="h-8 w-fit"
                onClick={handleSyncNow}
                disabled={manualSyncing || demoModeSyncDisabled}
              >
                {manualSyncing
                  ? tt('Synchronizacja...', 'Syncing...')
                  : demoModeSyncDisabled
                    ? tt('Sync wyłączony w demo', 'Sync disabled in demo')
                    : tt('Synchronizuj teraz', 'Sync now')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold">
            {tt('Zamrażanie projektów', 'Project Freezing')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {tt(
              'Projekty nieaktywne przez zadany okres są automatycznie zamrażane i ukrywane na listach przypisań sesji.',
              'Projects inactive for a set period are automatically frozen and hidden from session assignment lists.',
            )}
          </p>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <p className="text-sm font-medium">{tt('Próg nieaktywności', 'Inactivity threshold')}</p>
                <p className="text-xs leading-5 break-words text-muted-foreground">
                  {tt(
                    'Liczba dni bez aktywności, po której projekt zostanie automatycznie zamrożony.',
                    'Number of days without activity after which a project is automatically frozen.',
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={365}
                  step={1}
                  aria-label={tt('Próg zamrożenia w dniach', 'Freeze threshold in days')}
                  className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  value={freezeSettings.thresholdDays}
                  onChange={(e) => {
                    const val = Number.parseInt(e.target.value, 10);
                    if (!Number.isNaN(val)) {
                      setFreezeSettings((prev) => ({
                        ...prev,
                        thresholdDays: val,
                      }));
                      setSavedSettings(false);
                    }
                  }}
                />
                <span className="text-sm text-muted-foreground">{tt('dni', 'days')}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold">{tt('Tryb demo', 'Demo Mode')}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {tt(
              'Przełącz źródło danych dashboardu na osobny plik bazy demo (trwałe po restarcie).',
              'Switch dashboard data source to a separate demo database file (persists after restart).',
            )}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <label
            htmlFor="demoModeEnabled"
            className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{tt('Użyj bazy demo', 'Use demo database')}</p>
              <p className="text-xs leading-5 break-words text-muted-foreground">
                {tt(
                  'Dotyczy całego dashboardu (odczyt/zapis/import) i przełącza na osobny plik SQLite. W trybie demo odświeżanie dzienne czyta z fake_data i oczekuje fake w nazwie pliku JSON (np. 2026-02-22_fake.json).',
                  'Applies to the whole dashboard app (reads/writes/imports) and switches to a separate SQLite file. In demo mode, live daily refresh reads from fake_data and expects fake in the JSON filename (for example 2026-02-22_fake.json).',
                )}
              </p>
            </div>
            <input
              id="demoModeEnabled"
              type="checkbox"
              className="h-4 w-4 rounded border-input accent-primary"
              checked={demoModeStatus?.enabled ?? false}
              disabled={demoModeLoading || demoModeSwitching}
              onChange={(e) => {
                void handleToggleDemoMode(e.target.checked);
              }}
            />
          </label>

          <div className="rounded-md border border-border/70 bg-background/20 p-3 text-xs">
            {demoModeLoading ? (
              <p className="text-muted-foreground">
                {tt('Wczytywanie statusu trybu demo...', 'Loading demo mode status...')}
              </p>
            ) : demoModeStatus ? (
              <div className="space-y-1.5 text-muted-foreground">
                <div>
                  {tt('Aktywna DB:', 'Active DB:')}{' '}
                  <span className="font-mono text-foreground break-all">
                    {demoModeStatus.activeDbPath}
                  </span>
                </div>
                <div>
                  {tt('Główna DB:', 'Primary DB:')}{' '}
                  <span className="font-mono text-foreground break-all">
                    {demoModeStatus.primaryDbPath}
                  </span>
                </div>
                <div>
                  {tt('Demo DB:', 'Demo DB:')}{' '}
                  <span className="font-mono text-foreground break-all">
                    {demoModeStatus.demoDbPath}
                  </span>
                </div>
                <div
                  className={
                    demoModeStatus.enabled
                      ? 'text-amber-500'
                      : 'text-emerald-500'
                  }
                >
                  {demoModeStatus.enabled
                    ? tt('Tryb demo jest aktywny. Nowe importy/zmiany trafią do bazy demo.', 'Demo mode is active. New imports/changes will affect the demo database.')
                    : tt('Aktywny jest tryb główny.', 'Primary mode is active.')}
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">
                {tt('Status trybu demo niedostępny.', 'Demo mode status unavailable.')}
              </p>
            )}

            {demoModeError && (
              <p className="mt-2 text-destructive">{demoModeError}</p>
            )}
          </div>

          <div className="flex items-center justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-8"
              disabled={demoModeLoading || demoModeSwitching}
              onClick={() => {
                if (!demoModeStatus) return;
                void handleToggleDemoMode(!demoModeStatus.enabled);
              }}
            >
              {demoModeSwitching
                ? tt('Przełączanie...', 'Switching...')
                : demoModeStatus?.enabled
                  ? tt('Wyłącz tryb demo', 'Disable Demo Mode')
                  : tt('Włącz tryb demo', 'Enable Demo Mode')}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold text-destructive">
            {tt('Strefa ryzyka', 'Danger Zone')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {tt('Domyślnie ukryte, aby uniknąć przypadkowych kliknięć.', 'Hidden by default to avoid accidental clicks.')}
          </p>
        </CardHeader>
        <CardContent>
          <details className="group rounded-md border border-destructive/50 bg-destructive/10">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5">
              <span className="text-sm font-medium">{tt('Kontrolki czyszczenia danych', 'Data wipe controls')}</span>
              <span className="text-xs text-muted-foreground group-open:hidden">
                {tt('Otwórz', 'Open')}
              </span>
              <span className="hidden text-xs text-muted-foreground group-open:inline">
                {tt('Zamknij', 'Close')}
              </span>
            </summary>

            <div className="space-y-3 border-t border-destructive/40 p-3">
              <p className="text-xs leading-5 break-words text-muted-foreground">
                {tt(
                  'Usuwa wszystkie zaimportowane sesje i historię z lokalnej bazy danych.',
                  'Deletes all imported sessions and history from local database.',
                )}
              </p>

              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input accent-destructive"
                  checked={clearArmed}
                  onChange={(e) => setClearArmed(e.target.checked)}
                />
                {tt('Włącz czyszczenie danych', 'Enable clear action')}
              </label>

              <Button
                variant="destructive"
                className="h-8"
                onClick={handleClearData}
                disabled={clearing || !clearArmed}
              >
                {clearing ? tt('Czyszczenie...', 'Clearing...') : tt('Wyczyść dane', 'Clear Data')}
              </Button>
            </div>
          </details>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold">
            {tt('Wygląd i wydajność', 'Appearance & Performance')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {tt('Dostosuj efekty wizualne i opcje wydajności.', 'Adjust visual effects and performance options.')}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <label
            htmlFor="chartAnimationsEnabled"
            className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{tt('Włącz animacje wykresów', 'Enable chart animations')}</p>
              <p className="text-xs leading-5 break-words text-muted-foreground">
                {tt('Wyłącz, aby poprawić responsywność UI na wolniejszych urządzeniach.', 'Turn off to improve UI responsiveness on slower devices.')}
              </p>
            </div>
            <input
              id="chartAnimationsEnabled"
              type="checkbox"
              className="h-4 w-4 rounded border-input accent-primary"
              checked={appearanceSettings.chartAnimations}
              onChange={(e) => {
                setAppearanceSettings((prev) => ({
                  ...prev,
                  chartAnimations: e.target.checked,
                }));
                setSavedSettings(false);
              }}
            />
          </label>
        </CardContent>
      </Card>
      <div className="h-20" /> {/* Spacer for floating button */}
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
    </div>
  );
}
