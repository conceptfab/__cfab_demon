// @public-api — Tauri command bindings; knip cannot detect dynamic invoke() usage
import { invoke } from './core';

export interface LogSettings {
  daemon_level: string;
  lan_sync_level: string;
  online_sync_level: string;
  dashboard_level: string;
  max_log_size_kb: number;
}

export interface LogFileInfo {
  name: string;
  key: string;
  size_bytes: number;
  exists: boolean;
}

export const getLogSettings = () =>
  invoke<LogSettings>('get_log_settings');

export const saveLogSettings = (settings: LogSettings) =>
  invoke<void>('save_log_settings', { settings });

export const getLogFilesInfo = () =>
  invoke<LogFileInfo[]>('get_log_files_info');

export const readLogFile = (key: string, tailLines?: number) =>
  invoke<string>('read_log_file', { key, tailLines });

export const clearLogFile = (key: string) =>
  invoke<void>('clear_log_file', { key });

export const openLogsFolder = () =>
  invoke<void>('open_logs_folder');

export const logManagementApi = {
  getLogSettings,
  saveLogSettings,
  getLogFilesInfo,
  readLogFile,
  clearLogFile,
  openLogsFolder,
} as const;
