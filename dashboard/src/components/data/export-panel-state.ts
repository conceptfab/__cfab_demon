import type { ProjectWithStats } from '@/lib/db-types';

export type ExportPanelState = {
  exportType: 'all' | 'single';
  selectedProject: string;
  dateStart: string;
  dateEnd: string;
  allTime: boolean;
  projects: ProjectWithStats[];
  loading: boolean;
};

export const initialExportPanelState: ExportPanelState = {
  exportType: 'all',
  selectedProject: '0',
  dateStart: '',
  dateEnd: '',
  allTime: true,
  projects: [],
  loading: false,
};

export type ExportPanelAction =
  | { type: 'set_export_type'; exportType: ExportPanelState['exportType'] }
  | { type: 'set_selected_project'; selectedProject: string }
  | { type: 'set_date_start'; dateStart: string }
  | { type: 'set_date_end'; dateEnd: string }
  | { type: 'set_all_time'; allTime: boolean }
  | { type: 'set_projects'; projects: ProjectWithStats[] }
  | { type: 'set_loading'; loading: boolean };

export function exportPanelReducer(
  state: ExportPanelState,
  action: ExportPanelAction,
): ExportPanelState {
  switch (action.type) {
    case 'set_export_type':
      return { ...state, exportType: action.exportType };
    case 'set_selected_project':
      return { ...state, selectedProject: action.selectedProject };
    case 'set_date_start':
      return { ...state, dateStart: action.dateStart };
    case 'set_date_end':
      return { ...state, dateEnd: action.dateEnd };
    case 'set_all_time':
      return { ...state, allTime: action.allTime };
    case 'set_projects':
      return { ...state, projects: action.projects };
    case 'set_loading':
      return { ...state, loading: action.loading };
    default:
      return state;
  }
}
