import type {
  DashboardData,
  ManualSessionWithProject,
  ProjectTimeRow,
  SessionWithApp,
  StackedBarData,
} from '@/lib/db-types';

export const UNASSIGNED_PROJECT_KEY = 'unassigned';
export const EMPTY_PROJECT_ROWS: ProjectTimeRow[] = [];
export const EMPTY_STACKED_BAR_DATA: StackedBarData[] = [];
/** Max project series shown in timeline chart */
export const PROJECT_TIMELINE_SERIES_LIMIT = 200;

export type DashboardViewState = {
  dashboardData: DashboardData | null;
  projectTimelineLoading: boolean;
  projectTimelineError: unknown | null;
  loadError: string | null;
  todaySessions: SessionWithApp[];
  manualSessions: ManualSessionWithProject[];
};

export const EMPTY_DASHBOARD_VIEW_STATE: DashboardViewState = {
  dashboardData: null,
  projectTimelineLoading: true,
  projectTimelineError: null,
  loadError: null,
  todaySessions: [],
  manualSessions: [],
};
