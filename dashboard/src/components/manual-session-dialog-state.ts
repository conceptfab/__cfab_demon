import type { AppWithStats, ManualSessionWithProject, ProjectWithStats } from '@/lib/db-types';

export type ManualSessionFormState = {
  title: string;
  sessionType: string;
  projectId: number | null;
  appId: number | null;
  apps: AppWithStats[];
  startTime: string;
  endTime: string;
  allowMultiDay: boolean;
  saving: boolean;
  error: string | null;
};

function toLocalDatetimeValue(iso?: string): string {
  if (!iso) {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    const local = new Date(now.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)) {
    return iso.slice(0, 16);
  }
  const d = new Date(iso);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function defaultEndFromStart(start: string): string {
  const parts = start.split('T');
  const dateStr = parts[0] ?? '';
  const timeStr = parts[1] ?? '00:00';
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);
  const startDate = new Date(year, month - 1, day, hours + 1, minutes);
  return `${String(startDate.getFullYear()).padStart(4, '0')}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}T${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`;
}

export function buildManualSessionFormState(
  editSession: ManualSessionWithProject | null | undefined,
  defaultProjectId: number | null | undefined,
  defaultStartTime: string | undefined,
  projects: ProjectWithStats[],
): ManualSessionFormState {
  const startTime = editSession
    ? toLocalDatetimeValue(editSession.start_time)
    : defaultStartTime
      ? toLocalDatetimeValue(defaultStartTime)
      : toLocalDatetimeValue();
  const endTime = editSession
    ? toLocalDatetimeValue(editSession.end_time)
    : defaultEndFromStart(startTime);
  const allowMultiDay = editSession
    ? editSession.start_time.split('T')[0] !== editSession.end_time.split('T')[0]
    : false;

  return {
    title: editSession?.title ?? '',
    sessionType: editSession?.session_type ?? 'meeting',
    projectId: editSession?.project_id ?? defaultProjectId ?? projects[0]?.id ?? null,
    appId: editSession?.app_id ?? null,
    apps: [],
    startTime,
    endTime,
    allowMultiDay,
    saving: false,
    error: null,
  };
}

export type ManualSessionFormAction =
  | { type: 'set_title'; title: string }
  | { type: 'set_session_type'; sessionType: string }
  | { type: 'set_project_id'; projectId: number | null }
  | { type: 'set_app_id'; appId: number | null }
  | { type: 'set_apps'; apps: AppWithStats[] }
  | { type: 'set_start_time'; startTime: string }
  | { type: 'set_end_time'; endTime: string }
  | { type: 'set_allow_multi_day'; allowMultiDay: boolean }
  | { type: 'set_saving'; saving: boolean }
  | { type: 'set_error'; error: string | null };

export function manualSessionFormReducer(
  state: ManualSessionFormState,
  action: ManualSessionFormAction,
): ManualSessionFormState {
  switch (action.type) {
    case 'set_title':
      return { ...state, title: action.title };
    case 'set_session_type':
      return { ...state, sessionType: action.sessionType };
    case 'set_project_id':
      return { ...state, projectId: action.projectId };
    case 'set_app_id':
      return { ...state, appId: action.appId };
    case 'set_apps':
      return { ...state, apps: action.apps };
    case 'set_start_time': {
      let endTime = state.endTime;
      if (!state.allowMultiDay) {
        const parts = action.startTime.split('T');
        if (parts.length === 2) {
          const endParts = endTime.split('T');
          if (endParts.length === 2) {
            endTime = `${parts[0]}T${endParts[1]}`;
          }
        }
      }
      return { ...state, startTime: action.startTime, endTime };
    }
    case 'set_end_time':
      return { ...state, endTime: action.endTime };
    case 'set_allow_multi_day': {
      let endTime = state.endTime;
      if (!action.allowMultiDay) {
        const startParts = state.startTime.split('T');
        const endParts = endTime.split('T');
        if (startParts.length === 2 && endParts.length === 2) {
          endTime = `${startParts[0]}T${endParts[1]}`;
        }
      }
      return { ...state, allowMultiDay: action.allowMultiDay, endTime };
    }
    case 'set_saving':
      return { ...state, saving: action.saving };
    case 'set_error':
      return { ...state, error: action.error };
    default:
      return state;
  }
}
