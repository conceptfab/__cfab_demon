import { useCallback, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import {
  type FreezeSettings,
  type SessionSettings,
  type SplitSettings,
  type TodoSettings,
  loadFreezeSettings,
  loadSessionSettings,
  loadSplitSettings,
  loadTodoSettings,
  saveSplitSettings,
  saveTodoSettings,
} from '@/lib/user-settings';
import {
  type StateUpdater,
  resolveStateUpdate,
} from './useSettingsFormTypes';

interface UseGeneralSettingsOptions {
  setSavedSettings: (saved: boolean) => void;
  t: TFunction;
}

export function useGeneralSettings({
  setSavedSettings,
  t,
}: UseGeneralSettingsOptions) {
  const [sessionSettings, setSessionSettings] = useState<SessionSettings>(() =>
    loadSessionSettings(),
  );
  const [freezeSettings, setFreezeSettings] = useState<FreezeSettings>(() =>
    loadFreezeSettings(),
  );
  const [splitSettings, setSplitSettings] = useState<SplitSettings>(() =>
    loadSplitSettings(),
  );
  const [todoSettings, setTodoSettings] = useState<TodoSettings>(() =>
    loadTodoSettings(),
  );

  const sliderValue = useMemo(
    () => Math.min(30, Math.max(0, sessionSettings.gapFillMinutes)),
    [sessionSettings.gapFillMinutes],
  );
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

  const updateSessionSettings = useCallback(
    (next: StateUpdater<SessionSettings>) => {
      setSessionSettings((prev) => resolveStateUpdate(prev, next));
      setSavedSettings(false);
    },
    [setSavedSettings],
  );

  const updateFreezeSettings = useCallback(
    (next: StateUpdater<FreezeSettings>) => {
      setFreezeSettings((prev) => resolveStateUpdate(prev, next));
      setSavedSettings(false);
    },
    [setSavedSettings],
  );

  const updateSplitSetting = useCallback(
    <K extends keyof SplitSettings>(key: K, value: SplitSettings[K]) => {
      setSplitSettings((prev) => saveSplitSettings({ ...prev, [key]: value }));
      setSavedSettings(false);
    },
    [setSavedSettings],
  );

  // Zapis natychmiastowy (jak split): to przełączniki, nie formularz —
  // trzymanie ich za przyciskiem „Zapisz" tylko myli.
  const updateTodoSetting = useCallback(
    <K extends keyof TodoSettings>(key: K, value: TodoSettings[K]) => {
      setTodoSettings((prev) => saveTodoSettings({ ...prev, [key]: value }));
    },
    [],
  );

  return {
    sessionSettings,
    setSessionSettings,
    freezeSettings,
    setFreezeSettings,
    splitSettings,
    setSplitSettings,
    todoSettings,
    updateTodoSetting,
    sliderValue,
    splitToleranceDescription,
    updateSessionSettings,
    updateFreezeSettings,
    updateSplitSetting,
  };
}
