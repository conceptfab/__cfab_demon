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

export type AssignProjectListMode = 'alpha_active' | 'new_top_rest' | 'top_new_rest';
const ASSIGN_PROJECT_LIST_MODE_STORAGE_KEY = 'timeflow-sessions-assign-project-list-mode';
const LEGACY_ASSIGN_PROJECT_LIST_MODE_STORAGE_KEYS = [
  'timeflow-dashboard-assign-project-list-mode',
];

function loadAssignProjectListMode(): AssignProjectListMode {
  if (typeof window === 'undefined') return 'alpha_active';
  try {
    const raw =
      window.localStorage.getItem(ASSIGN_PROJECT_LIST_MODE_STORAGE_KEY) ??
      LEGACY_ASSIGN_PROJECT_LIST_MODE_STORAGE_KEYS
        .map((key) => window.localStorage.getItem(key))
        .find((value) => value !== null);
    if (raw === 'new_top_rest' || raw === 'top_new_rest' || raw === 'alpha_active') {
      return raw;
    }
    return 'alpha_active';
  } catch {
    return 'alpha_active';
  }
}

function persistAssignProjectListMode(mode: AssignProjectListMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ASSIGN_PROJECT_LIST_MODE_STORAGE_KEY, mode);
  } catch (error) {
    console.warn('Failed to persist assign project list mode', error);
  }
}

interface UIState {
  currentPage: string;
  pageChangeRequestId: number;
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
  projectPageMinimal: boolean;
  setProjectPageId: (id: number | null, minimal?: boolean) => void;
  reportTemplateId: string | null;
  setReportTemplateId: (id: string | null) => void;
  firstRun: boolean;
  setFirstRun: (firstRun: boolean) => void;
  assignProjectListMode: AssignProjectListMode;
  setAssignProjectListMode: (mode: AssignProjectListMode) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  currentPage: 'dashboard',
  pageChangeRequestId: 0,
  pageChangeGuard: null,
  setCurrentPage: (page) => {
    const currentPage = get().currentPage;
    if (page === currentPage) return;

    const requestId = get().pageChangeRequestId + 1;
    set({ pageChangeRequestId: requestId });

    void (async () => {
      const guard = get().pageChangeGuard;
      if (guard) {
        const allowed = await guard(page, currentPage);
        if (!allowed) return;
      }

      set((state) =>
        state.pageChangeRequestId === requestId ? { currentPage: page } : {},
      );
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
  projectPageMinimal: false,
  setProjectPageId: (id, minimal) => set({ projectPageId: id, projectPageMinimal: !!minimal }),
  reportTemplateId: null,
  setReportTemplateId: (id) => set({ reportTemplateId: id }),
  firstRun: readFirstRunFlag(),
  setFirstRun: (firstRun) => {
    writeFirstRunFlag(firstRun);
    set({ firstRun });
  },
  assignProjectListMode: loadAssignProjectListMode(),
  setAssignProjectListMode: (mode) => {
    persistAssignProjectListMode(mode);
    set({ assignProjectListMode: mode });
  },
}));
