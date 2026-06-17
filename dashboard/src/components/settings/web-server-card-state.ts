import type { WebServerStatus, WebSession } from '@/lib/tauri/webserver';

export const DEFAULT_WEB_PORT = 47892;
export const PAIRING_CODE_TTL_SECS = 180;

export type WebServerCardState = {
  status: WebServerStatus | null;
  sessions: WebSession[];
  enabled: boolean;
  port: number;
  lanExposure: boolean;
  loading: boolean;
  saving: boolean;
  pairingCode: string | null;
  pairingRemaining: number;
  busyCode: boolean;
  error: string | null;
};

export const initialWebServerCardState: WebServerCardState = {
  status: null,
  sessions: [],
  enabled: false,
  port: DEFAULT_WEB_PORT,
  lanExposure: false,
  loading: true,
  saving: false,
  pairingCode: null,
  pairingRemaining: 0,
  busyCode: false,
  error: null,
};

export type WebServerCardAction =
  | { type: 'load_start' }
  | {
      type: 'load_success';
      status: WebServerStatus;
      sessions: WebSession[];
    }
  | { type: 'load_error'; error: string }
  | { type: 'load_end' }
  | { type: 'set_enabled'; enabled: boolean }
  | { type: 'set_port'; port: number }
  | { type: 'set_lan_exposure'; lanExposure: boolean }
  | { type: 'set_saving'; saving: boolean }
  | { type: 'set_status'; status: WebServerStatus | null }
  | { type: 'set_sessions'; sessions: WebSession[] }
  | { type: 'remove_session'; sessionId: string }
  | { type: 'set_pairing_code'; pairingCode: string | null }
  | { type: 'set_pairing_remaining'; pairingRemaining: number }
  | { type: 'tick_pairing_remaining' }
  | { type: 'set_busy_code'; busyCode: boolean }
  | { type: 'set_error'; error: string | null };

export function webServerCardReducer(
  state: WebServerCardState,
  action: WebServerCardAction,
): WebServerCardState {
  switch (action.type) {
    case 'load_start':
      return { ...state, error: null, loading: true };
    case 'load_success':
      return {
        ...state,
        status: action.status,
        enabled: action.status.enabled,
        port: action.status.port,
        lanExposure: action.status.lan_exposure,
        sessions: action.sessions,
      };
    case 'load_error':
      return { ...state, error: action.error };
    case 'load_end':
      return { ...state, loading: false };
    case 'set_enabled':
      return { ...state, enabled: action.enabled };
    case 'set_port':
      return { ...state, port: action.port };
    case 'set_lan_exposure':
      return { ...state, lanExposure: action.lanExposure };
    case 'set_saving':
      return { ...state, saving: action.saving };
    case 'set_status':
      return { ...state, status: action.status };
    case 'set_sessions':
      return { ...state, sessions: action.sessions };
    case 'remove_session':
      return {
        ...state,
        sessions: state.sessions.filter((session) => session.id !== action.sessionId),
      };
    case 'set_pairing_code':
      return { ...state, pairingCode: action.pairingCode };
    case 'set_pairing_remaining':
      return { ...state, pairingRemaining: action.pairingRemaining };
    case 'tick_pairing_remaining':
      return {
        ...state,
        pairingRemaining: Math.max(0, state.pairingRemaining - 1),
      };
    case 'set_busy_code':
      return { ...state, busyCode: action.busyCode };
    case 'set_error':
      return { ...state, error: action.error };
    default:
      return state;
  }
}
