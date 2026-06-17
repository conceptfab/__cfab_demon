// @public-api — Tauri command bindings; knip cannot detect dynamic invoke() usage
import { invoke, invokeMutation } from './core';
import type { DateRange, ManualSession, ManualSessionWithProject } from '../db-types';

export const createManualSession = (input: {
  title: string;
  session_type: string;
  project_id: number;
  app_id?: number | null;
  start_time: string;
  end_time: string;
}) => invokeMutation<ManualSession>('create_manual_session', { input });

export const getManualSessions = (filters: {
  dateRange?: DateRange;
  projectId?: number;
}) => invoke<ManualSessionWithProject[]>('get_manual_sessions', { filters });

export const updateManualSession = (
  id: number,
  input: {
    title: string;
    session_type: string;
    project_id: number;
    app_id?: number | null;
    start_time: string;
    end_time: string;
  },
) => invokeMutation<void>('update_manual_session', { id, input });

export const deleteManualSession = (id: number) =>
  invokeMutation<void>('delete_manual_session', { id });

export const deleteManualSessionsBatch = (ids: number[]) =>
  invokeMutation<void>('delete_manual_sessions', { ids });

export const manualSessionsApi = {
  createManualSession,
  getManualSessions,
  updateManualSession,
  deleteManualSession,
  deleteManualSessionsBatch,
} as const;
