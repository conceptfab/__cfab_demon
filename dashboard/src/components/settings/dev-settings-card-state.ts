import type { LogFileInfo, LogSettings } from '@/lib/tauri/log-management';

export type DevSettingsCardState = {
  settings: LogSettings | null;
  files: LogFileInfo[];
  activeLog: string | null;
  logContent: string;
  autoScroll: boolean;
};

export const initialDevSettingsCardState: DevSettingsCardState = {
  settings: null,
  files: [],
  activeLog: null,
  logContent: '',
  autoScroll: true,
};

export type DevSettingsCardAction =
  | { type: 'set_settings'; settings: LogSettings | null }
  | { type: 'patch_settings'; settings: LogSettings }
  | { type: 'set_files'; files: LogFileInfo[] }
  | { type: 'set_active_log'; activeLog: string | null }
  | { type: 'set_log_content'; logContent: string }
  | { type: 'set_auto_scroll'; autoScroll: boolean };

export function devSettingsCardReducer(
  state: DevSettingsCardState,
  action: DevSettingsCardAction,
): DevSettingsCardState {
  switch (action.type) {
    case 'set_settings':
      return { ...state, settings: action.settings };
    case 'patch_settings':
      return { ...state, settings: action.settings };
    case 'set_files':
      return { ...state, files: action.files };
    case 'set_active_log':
      return {
        ...state,
        activeLog: action.activeLog,
        logContent: action.activeLog ? state.logContent : '',
      };
    case 'set_log_content':
      return { ...state, logContent: action.logContent };
    case 'set_auto_scroll':
      return { ...state, autoScroll: action.autoScroll };
    default:
      return state;
  }
}
