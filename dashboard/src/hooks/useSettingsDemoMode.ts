import { useCallback, useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { settingsApi } from '@/lib/tauri';
import type { DemoModeStatus } from '@/lib/db-types';
import { getErrorMessage } from '@/lib/utils';

interface UseSettingsDemoModeOptions {
  t: TFunction;
  showInfo: (message: string) => void;
  showError: (message: string) => void;
  onEnabledChange?: (status: DemoModeStatus) => void;
}

export function useSettingsDemoMode({
  t,
  showInfo,
  showError,
  onEnabledChange,
}: UseSettingsDemoModeOptions) {
  const [demoModeStatus, setDemoModeStatus] = useState<DemoModeStatus | null>(
    null,
  );
  const [demoModeLoading, setDemoModeLoading] = useState(true);
  const [demoModeSwitching, setDemoModeSwitching] = useState(false);
  const [demoModeError, setDemoModeError] = useState<string | null>(null);

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

  const handleToggleDemoMode = useCallback(
    async (enabled: boolean) => {
      setDemoModeSwitching(true);
      setDemoModeError(null);
      try {
        const status = await settingsApi.setDemoMode(enabled);
        setDemoModeStatus(status);
        onEnabledChange?.(status);
        showInfo(
          status.enabled
            ? t(
                'settings_page.demo_mode_enabled_dashboard_now_uses_the_demo_database',
              )
            : t(
                'settings_page.demo_mode_disabled_dashboard_now_uses_the_primary_databa',
              ),
        );
      } catch (e) {
        console.error(e);
        const errorMessage = getErrorMessage(e, t('ui.common.unknown_error'));
        setDemoModeError(errorMessage);
        showError(t('settings_page.failed_to_switch_demo_mode') + errorMessage);
      } finally {
        setDemoModeSwitching(false);
      }
    },
    [onEnabledChange, showError, showInfo, t],
  );

  return {
    demoModeStatus,
    demoModeLoading,
    demoModeSwitching,
    demoModeError,
    handleToggleDemoMode,
  };
}
