// @public-api — Tauri command bindings; knip cannot detect dynamic invoke() usage
import { invoke, invokeMutation } from './core';
import type { AppWithStats, DateRange } from '../db-types';

export const getApplications = (dateRange?: DateRange) =>
  invoke<AppWithStats[]>(
    'get_applications',
    dateRange ? { dateRange } : undefined,
  );

export const updateAppColor = (id: number, color: string) =>
  invokeMutation<void>('update_app_color', { id, color });

export const resetAppTime = (appId: number) =>
  invokeMutation<void>('reset_app_time', { appId });

export const renameApplication = (appId: number, displayName: string) =>
  invokeMutation<void>('rename_application', { appId, displayName });

export const deleteAppAndData = (appId: number) =>
  invokeMutation<void>('delete_app_and_data', { appId });

export const applicationsApi = {
  getApplications,
  updateAppColor,
  resetAppTime,
  renameApplication,
  deleteAppAndData,
} as const;
