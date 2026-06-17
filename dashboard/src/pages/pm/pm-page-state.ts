import type { PmClientColors, PmProject, PmSettings } from '@/lib/pm-types';
import type { PmTab, PmTfMatch } from '@/lib/pm-page-match';

export type PmPageState = {
  projects: PmProject[];
  settings: PmSettings | null;
  loading: boolean;
  error: string | null;
  createOpen: boolean;
  selectedIndex: number | null;
  activeTab: PmTab;
  clientColors: PmClientColors;
  tfMatches: Record<string, PmTfMatch>;
};

export const initialPmPageState: PmPageState = {
  projects: [],
  settings: null,
  loading: true,
  error: null,
  createOpen: false,
  selectedIndex: null,
  activeTab: 'projects',
  clientColors: {},
  tfMatches: {},
};

export type PmPageAction =
  | { type: 'load_start' }
  | { type: 'load_success'; payload: Pick<PmPageState, 'settings' | 'projects' | 'tfMatches' | 'clientColors'> }
  | { type: 'load_empty_settings'; settings: PmSettings }
  | { type: 'load_not_configured' }
  | { type: 'load_error'; error: string }
  | { type: 'load_end' }
  | { type: 'set_create_open'; createOpen: boolean }
  | { type: 'set_selected_index'; selectedIndex: number | null }
  | { type: 'set_active_tab'; activeTab: PmTab }
  | { type: 'set_client_colors'; clientColors: PmClientColors };

export function pmPageReducer(state: PmPageState, action: PmPageAction): PmPageState {
  switch (action.type) {
    case 'load_start':
      return { ...state, loading: true, error: null };
    case 'load_success':
      return {
        ...state,
        settings: action.payload.settings,
        projects: action.payload.projects,
        tfMatches: action.payload.tfMatches,
        clientColors: action.payload.clientColors,
      };
    case 'load_empty_settings':
      return { ...state, settings: action.settings, projects: [] };
    case 'load_not_configured':
      return {
        ...state,
        settings: { work_folder: '', settings_folder: '00_PM_NX' },
        projects: [],
      };
    case 'load_error':
      return { ...state, error: action.error };
    case 'load_end':
      return { ...state, loading: false };
    case 'set_create_open':
      return { ...state, createOpen: action.createOpen };
    case 'set_selected_index':
      return { ...state, selectedIndex: action.selectedIndex };
    case 'set_active_tab':
      return { ...state, activeTab: action.activeTab };
    case 'set_client_colors':
      return { ...state, clientColors: action.clientColors };
    default:
      return state;
  }
}
