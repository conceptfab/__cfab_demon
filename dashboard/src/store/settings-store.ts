import { create } from 'zustand';
import {
  loadCurrencySettings,
  loadAppearanceSettings,
} from '@/lib/user-settings';

interface SettingsState {
  currencyCode: string;
  setCurrencyCode: (code: string) => void;
  chartAnimations: boolean;
  setChartAnimations: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  currencyCode: loadCurrencySettings().code,
  setCurrencyCode: (code) => set({ currencyCode: code }),
  chartAnimations: loadAppearanceSettings().chartAnimations,
  setChartAnimations: (enabled) => set({ chartAnimations: enabled }),
}));
