import { useCallback, useMemo, useState } from 'react';
import { normalizeHexColor } from '@/lib/normalize';
import { splitTime } from '@/lib/form-validation';
import {
  type AppearanceSettings,
  type CurrencySettings,
  type LanguageSettings,
  type WorkingHoursSettings,
  loadAppearanceSettings,
  loadCurrencySettings,
  loadLanguageSettings,
  loadWorkingHoursSettings,
} from '@/lib/user-settings';
import {
  type StateUpdater,
  resolveStateUpdate,
} from './useSettingsFormTypes';

interface UseUiSettingsOptions {
  setSavedSettings: (saved: boolean) => void;
}

export function useUiSettings({ setSavedSettings }: UseUiSettingsOptions) {
  const [workingHours, setWorkingHours] = useState<WorkingHoursSettings>(() =>
    loadWorkingHoursSettings(),
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
    [setSavedSettings],
  );

  const updateWorkingHours = useCallback(
    (next: StateUpdater<WorkingHoursSettings>) => {
      setWorkingHours((prev) => resolveStateUpdate(prev, next));
      setWorkingHoursError(null);
      setSavedSettings(false);
    },
    [setSavedSettings],
  );

  const updateCurrencySettings = useCallback(
    (next: StateUpdater<CurrencySettings>) => {
      setCurrencySettings((prev) => resolveStateUpdate(prev, next));
      setSavedSettings(false);
    },
    [setSavedSettings],
  );

  const updateLanguageSettings = useCallback(
    (next: StateUpdater<LanguageSettings>) => {
      setLanguageSettings((prev) => resolveStateUpdate(prev, next));
      setSavedSettings(false);
    },
    [setSavedSettings],
  );

  const updateAppearanceSettings = useCallback(
    (next: StateUpdater<AppearanceSettings>) => {
      setAppearanceSettings((prev) => resolveStateUpdate(prev, next));
      setSavedSettings(false);
    },
    [setSavedSettings],
  );

  return {
    workingHours,
    setWorkingHours,
    currencySettings,
    setCurrencySettings,
    languageSettings,
    setLanguageSettings,
    appearanceSettings,
    setAppearanceSettings,
    workingHoursError,
    setWorkingHoursError,
    startHour,
    startMinute,
    endHour,
    endMinute,
    normalizedColor,
    updateTimePart,
    updateWorkingHours,
    updateCurrencySettings,
    updateLanguageSettings,
    updateAppearanceSettings,
  };
}
