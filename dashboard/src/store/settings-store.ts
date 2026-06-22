import { create } from 'zustand';
import {
  loadCurrencySettings,
  loadAppearanceSettings,
  loadWorkingHoursSettings,
  loadLanguageSettings,
  loadSplitSettings,
  loadRoundingSettings,
  loadSidebarSettings,
  saveSidebarSettings,
  type WorkingHoursSettings,
  type AppLanguageCode,
  type SplitSettings,
  type RoundingSettings,
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
  roundingSettings: RoundingSettings;
  setRoundingSettings: (next: RoundingSettings) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
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
  roundingSettings: loadRoundingSettings(),
  setRoundingSettings: (next) => set({ roundingSettings: next }),
  // Stan zwinięcia sidebara — utrwalany we wspólnym user_settings.json (write-through),
  // by ta sama preferencja obowiązywała w oknie pulpitu i web UI.
  sidebarCollapsed: loadSidebarSettings().collapsed,
  setSidebarCollapsed: (collapsed) => {
    saveSidebarSettings({ collapsed });
    set({ sidebarCollapsed: collapsed });
  },
  toggleSidebarCollapsed: () => {
    const next = !get().sidebarCollapsed;
    saveSidebarSettings({ collapsed: next });
    set({ sidebarCollapsed: next });
  },
}));
