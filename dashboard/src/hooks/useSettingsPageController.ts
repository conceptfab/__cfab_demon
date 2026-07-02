import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { settingsApi, type TimeAlgorithmInfo } from '@/lib/tauri';
import { DEFAULT_ONLINE_SYNC_SERVER_URL } from '@/lib/online-sync';
import type { AppLanguageCode } from '@/lib/user-settings';
import { useToast } from '@/components/ui/toast-notification';
import { useConfirmDialogState } from '@/hooks/useConfirmDialogState';
import { useSettingsFormState } from '@/hooks/useSettingsFormState';
import { useSettingsDemoMode } from '@/hooks/useSettingsDemoMode';
import { useLanSyncManager } from '@/hooks/useLanSyncManager';
import { useDataStore } from '@/store/data-store';
import { useSettingsStore } from '@/store/settings-store';
import { useUIStore } from '@/store/ui-store';
import type { SettingsTab } from '@/pages/settings/settings-page-constants';
import { logger } from '@/lib/logger';

export function useSettingsPageController() {
  const { i18n, t } = useTranslation();
  const { showError, showInfo } = useToast();
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialogState();
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const setCurrencyCode = useSettingsStore((s) => s.setCurrencyCode);
  const setChartAnimations = useSettingsStore((s) => s.setChartAnimations);
  const setStoreWorkingHours = useSettingsStore((s) => s.setWorkingHours);
  const setStoreLanguage = useSettingsStore((s) => s.setLanguage);
  const setStoreSplitSettings = useSettingsStore((s) => s.setSplitSettings);
  const roundingSettings = useSettingsStore((s) => s.roundingSettings);
  const setStoreRoundingSettings = useSettingsStore(
    (s) => s.setRoundingSettings,
  );
  const setPageChangeGuard = useUIStore((s) => s.setPageChangeGuard);

  const form = useSettingsFormState({
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

  const demoMode = useSettingsDemoMode({
    t,
    showInfo,
    showError,
    onEnabledChange: () => {
      form.resetManualSyncResult();
    },
  });

  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  const tabMeta: Record<SettingsTab, { label: string; active: string }> = {
    general: {
      label: t('settings_page.tab_general'),
      active: 'border-sky-400 text-sky-400',
    },
    sessions: {
      label: t('settings_page.tab_sessions'),
      active: 'border-violet-400 text-violet-400',
    },
    algorithm: {
      label: t('settings_page.tab_algorithm'),
      active: 'border-cyan-400 text-cyan-400',
    },
    rounding: {
      label: t('settings_page.tab_rounding'),
      active: 'border-teal-400 text-teal-400',
    },
    sync: {
      label: t('settings_page.tab_sync'),
      active: 'border-emerald-400 text-emerald-400',
    },
    pm: {
      label: t('settings_page.tab_pm'),
      active: 'border-orange-400 text-orange-400',
    },
    webserver: {
      label: t('settings_page.tab_webserver'),
      active: 'border-rose-400 text-rose-400',
    },
    mcp: {
      label: t('settings_page.tab_mcp'),
      active: 'border-fuchsia-400 text-fuchsia-400',
    },
    advanced: {
      label: t('settings_page.tab_advanced'),
      active: 'border-amber-400 text-amber-400',
    },
  };

  const [timeAlgorithms, setTimeAlgorithms] = useState<TimeAlgorithmInfo[]>([]);
  const [timeAlgorithm, setTimeAlgorithm] = useState<string>('wall_clock');
  const [savingTimeAlgorithm, setSavingTimeAlgorithm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .listTimeAlgorithms()
      .then((list) => {
        if (cancelled) return;
        setTimeAlgorithms(list);
        const active = list.find((a) => a.active) ?? list[0];
        if (active) setTimeAlgorithm(active.id);
      })
      .catch(() => {
        /* keep default */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelectTimeAlgorithm = (id: string) => {
    if (id === timeAlgorithm || savingTimeAlgorithm) return;
    const previous = timeAlgorithm;
    setTimeAlgorithm(id);
    setSavingTimeAlgorithm(true);
    settingsApi
      .setTimeAlgorithm(id)
      .then(() => {
        triggerRefresh('settings_saved');
      })
      .catch((error) => {
        setTimeAlgorithm(previous);
        showError(t('settings_page.time_algorithm_save_failed'));
        logger.error('Failed to set time algorithm:', error);
      })
      .finally(() => setSavingTimeAlgorithm(false));
  };

  const lan = useLanSyncManager();

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

  const demoModeSyncDisabled = demoMode.demoModeStatus?.enabled === true;

  return {
    ...form,
    ...demoMode,
    ...lan,
    activeTab,
    compactSelectClassName,
    confirmDialogProps,
    currencyOptions,
    defaultOnlineSyncServerUrl: DEFAULT_ONLINE_SYNC_SERVER_URL,
    demoModeSyncDisabled,
    handleSelectTimeAlgorithm,
    labelClassName,
    languageOptions,
    roundingSettings,
    savingTimeAlgorithm,
    setActiveTab,
    setStoreRoundingSettings,
    tabMeta,
    timeAlgorithm,
    timeAlgorithms,
    t,
    triggerRefresh,
  };
}

export type SettingsPageController = ReturnType<typeof useSettingsPageController>;
