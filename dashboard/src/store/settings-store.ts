import { create } from 'zustand';
import {
  loadCurrencySettings,
  loadAppearanceSettings,
  loadWorkingHoursSettings,
  loadLanguageSettings,
  loadSplitSettings,
  type WorkingHoursSettings,
  type AppLanguageCode,
  type SplitSettings,
} from '@/lib/user-settings';

interface SettingsState {
  currencyCode: string;
  setCurrencyCode: (code: string) => void;
  chartAnimations: boolean;
  setChartAnimations: (enabled: boolean) => void;
  workingHours: WorkingHoursSettings;
  setWorkingHours: (next: WorkingHoursSettings) => void;
  language: AppLanguageCode;
  setLanguage: (code: AppLanguageCode) => void;
  splitSettings: SplitSettings;
  setSplitSettings: (next: SplitSettings) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  currencyCode: loadCurrencySettings().code,
  setCurrencyCode: (code) => set({ currencyCode: code }),
  chartAnimations: loadAppearanceSettings().chartAnimations,
  setChartAnimations: (enabled) => set({ chartAnimations: enabled }),
  workingHours: loadWorkingHoursSettings(),
  setWorkingHours: (next) => set({ workingHours: next }),
  language: loadLanguageSettings().code,
  setLanguage: (code) => set({ language: code }),
  splitSettings: loadSplitSettings(),
  setSplitSettings: (next) => set({ splitSettings: next }),
}));
