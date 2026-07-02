import { invoke } from '@/lib/tauri/core';

export interface McpStatus {
  enabled: boolean;
  running: boolean;
  read_write: boolean;
  port: number;
  active_sessions: number;
  token: string;
}

export interface McpSession {
  id: string;
  client_name: string;
  created_at: number;
  last_seen: number;
  backup_path: string;
}

export const mcpApi = {
  status: () => invoke<McpStatus>('mcp_status'),
  setConfig: (enabled: boolean, readWrite: boolean) =>
    invoke<McpStatus>('mcp_set_config', { enabled, readWrite }),
  regenerateToken: () => invoke<McpStatus>('mcp_regenerate_token'),
  listSessions: () => invoke<McpSession[]>('mcp_list_sessions'),
};
