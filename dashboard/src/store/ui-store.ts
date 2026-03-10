import { create } from 'zustand';
import type { DateRange } from '@/lib/db-types';
import { DEFAULT_HELP_TAB, type HelpTabId } from '@/lib/help-navigation';

type PageChangeGuard = (
  nextPage: string,
  currentPage: string,
) => boolean | Promise<boolean>;

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
  pageChangeGuard: PageChangeGuard | null;
  setPageChangeGuard: (guard: PageChangeGuard | null) => void;
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
  reportTemplateId: string | null;
  setReportTemplateId: (id: string | null) => void;
  firstRun: boolean;
  setFirstRun: (firstRun: boolean) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  currentPage: 'dashboard',
  pageChangeGuard: null,
  setCurrentPage: (page) => {
    void (async () => {
      const currentPage = get().currentPage;
      if (page === currentPage) return;

      const guard = get().pageChangeGuard;
      if (guard) {
        const allowed = await guard(page, currentPage);
        if (!allowed) return;
      }

      if (get().currentPage !== currentPage) return;
      set({ currentPage: page });
    })();
  },
  setPageChangeGuard: (guard) => set({ pageChangeGuard: guard }),
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
  reportTemplateId: null,
  setReportTemplateId: (id) => set({ reportTemplateId: id }),
  firstRun: readFirstRunFlag(),
  setFirstRun: (firstRun) => {
    writeFirstRunFlag(firstRun);
    set({ firstRun });
  },
}));
