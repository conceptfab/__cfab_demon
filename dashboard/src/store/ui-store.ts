import { create } from 'zustand';
import type { DateRange } from '@/lib/db-types';
import { DEFAULT_HELP_TAB, type HelpTabId } from '@/lib/help-navigation';

function readFirstRunFlag(): boolean {
  try {
    return localStorage.getItem('timeflow_first_run') !== 'false';
  } catch {
    return true;
  }
}

function writeFirstRunFlag(firstRun: boolean): void {
  try {
    localStorage.setItem('timeflow_first_run', firstRun ? 'true' : 'false');
  } catch {
    // Ignore storage errors (private mode / restricted environment).
  }
}

interface UIState {
  currentPage: string;
  setCurrentPage: (page: string) => void;
  helpTab: HelpTabId;
  setHelpTab: (tab: HelpTabId) => void;
  sessionsFocusDate: string | null;
  setSessionsFocusDate: (date: string | null) => void;
  clearSessionsFocusDate: () => void;
  sessionsFocusRange: DateRange | null;
  setSessionsFocusRange: (range: DateRange | null) => void;
  sessionsFocusProject: number | 'unassigned' | null;
  setSessionsFocusProject: (projectId: number | 'unassigned' | null) => void;
  projectPageId: number | null;
  setProjectPageId: (id: number | null) => void;
  firstRun: boolean;
  setFirstRun: (firstRun: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  currentPage: 'dashboard',
  setCurrentPage: (page) => set({ currentPage: page }),
  helpTab: DEFAULT_HELP_TAB,
  setHelpTab: (tab) => set({ helpTab: tab }),
  sessionsFocusDate: null,
  setSessionsFocusDate: (date) => set({ sessionsFocusDate: date }),
  clearSessionsFocusDate: () => set({ sessionsFocusDate: null }),
  sessionsFocusRange: null,
  setSessionsFocusRange: (range) => set({ sessionsFocusRange: range }),
  sessionsFocusProject: null,
  setSessionsFocusProject: (projectId) =>
    set({ sessionsFocusProject: projectId }),
  projectPageId: null,
  setProjectPageId: (id) => set({ projectPageId: id }),
  firstRun: readFirstRunFlag(),
  setFirstRun: (firstRun) => {
    writeFirstRunFlag(firstRun);
    set({ firstRun });
  },
}));
