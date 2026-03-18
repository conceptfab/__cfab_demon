export { hasTauriRuntime, runtimeApi } from './tauri/core';
export * from './tauri/projects';
export * from './tauri/dashboard';
export * from './tauri/applications';
export * from './tauri/sessions';
export * from './tauri/ai';
export * from './tauri/daemon';
export * from './tauri/manual-sessions';
export * from './tauri/settings';
export * from './tauri/data';
export * from './tauri/database';

import { runtimeApi } from './tauri/core';
import { projectsApi } from './tauri/projects';
import { dashboardApi } from './tauri/dashboard';
import { applicationsApi } from './tauri/applications';
import { sessionsApi } from './tauri/sessions';
import { aiApi } from './tauri/ai';
import { daemonApi } from './tauri/daemon';
import { manualSessionsApi } from './tauri/manual-sessions';
import { settingsApi } from './tauri/settings';
import { dataApi } from './tauri/data';
import { databaseApi } from './tauri/database';

export {
  projectsApi,
  dashboardApi,
  applicationsApi,
  sessionsApi,
  aiApi,
  daemonApi,
  manualSessionsApi,
  settingsApi,
  dataApi,
  databaseApi,
};

export const tauriApi = {
  runtime: runtimeApi,
  projects: projectsApi,
  dashboard: dashboardApi,
  applications: applicationsApi,
  sessions: sessionsApi,
  ai: aiApi,
  daemon: daemonApi,
  manualSessions: manualSessionsApi,
  settings: settingsApi,
  data: dataApi,
  database: databaseApi,
} as const;
