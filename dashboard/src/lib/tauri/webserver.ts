import { invoke } from '@/lib/tauri/core';

export interface WebServerStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  lan_exposure: boolean;
}

export interface WebSession {
  id: string;
  label: string;
  created_at: number;
  expires_at: number;
}

export const webServerApi = {
  status: () => invoke<WebServerStatus>('webserver_status'),
  setConfig: (enabled: boolean, port: number, lanExposure: boolean) =>
    invoke<void>('webserver_set_config', { enabled, port, lanExposure }),
  generatePairingCode: () => invoke<string>('webserver_generate_pairing_code'),
  listSessions: () => invoke<WebSession[]>('webserver_list_sessions'),
  revokeSession: (id: string) =>
    invoke<void>('webserver_revoke_session', { id }),
};
