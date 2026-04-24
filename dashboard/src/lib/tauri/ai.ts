import { invoke, invokeMutation } from './core';
import type {
  AssignmentMode,
  AssignmentModelMetrics,
  AssignmentModelStatus,
  AutoSafeRollbackResult,
  AutoSafeRunResult,
  DateRange,
  DeterministicResult,
  FolderScanResult,
  FolderScanStatus,
} from '../db-types';

export const getAssignmentModelStatus = () =>
  invoke<AssignmentModelStatus>('get_assignment_model_status');

export const getAssignmentModelMetrics = (days = 30) =>
  invoke<AssignmentModelMetrics>('get_assignment_model_metrics', { days });

export const setAssignmentMode = (
  mode: AssignmentMode,
  suggestConf: number,
  autoConf: number,
  autoEv: number,
) =>
  invokeMutation<void>('set_assignment_mode', {
    mode,
    suggestConf,
    autoConf,
    autoEv,
  });

export const setAssignmentModelCooldown = (hours: number) =>
  invokeMutation<AssignmentModelStatus>('set_assignment_model_cooldown', {
    hours,
  });

export const setTrainingHorizonDays = (days: number) =>
  invokeMutation<AssignmentModelStatus>('set_training_horizon_days', {
    days,
  });

export const setDecayHalfLifeDays = (days: number) =>
  invokeMutation<AssignmentModelStatus>('set_decay_half_life_days', { days });

export const setTrainingBlacklists = (
  appBlacklist: string[],
  folderBlacklist: string[],
) =>
  invokeMutation<AssignmentModelStatus>('set_training_blacklists', {
    appBlacklist,
    folderBlacklist,
  });

export const resetModelWeights = () =>
  invokeMutation<AssignmentModelStatus>('reset_model_weights');

export const resetModelFull = () =>
  invokeMutation<AssignmentModelStatus>('reset_model_full');

export const trainAssignmentModel = (force = false) =>
  invokeMutation<AssignmentModelStatus>('train_assignment_model', { force });

export const runAutoSafeAssignment = (
  limit?: number,
  dateRange?: DateRange,
  minDuration?: number,
) =>
  invokeMutation<AutoSafeRunResult>('run_auto_safe_assignment', {
    limit,
    dateRange,
    minDuration,
  });

export const rollbackLastAutoSafeRun = () =>
  invokeMutation<AutoSafeRollbackResult>('rollback_last_auto_safe_run');

export const autoRunIfNeeded = (minDuration?: number) =>
  invokeMutation<AutoSafeRunResult | null>('auto_run_if_needed', {
    minDuration,
  }, {
    notify: (result) => (result?.assigned ?? 0) > 0,
  });

export const applyDeterministicAssignment = (minHistory?: number) =>
  invokeMutation<DeterministicResult>('apply_deterministic_assignment', {
    minHistory: minHistory ?? null,
  }, {
    notify: (result) => result.sessions_assigned > 0,
  });

export const setFeedbackWeight = (weight: number) =>
  invokeMutation<void>('set_feedback_weight', { weight });

export const scanProjectFoldersForAi = () =>
  invokeMutation<FolderScanResult>('scan_project_folders_for_ai');

export const getFolderScanStatus = () =>
  invoke<FolderScanStatus>('get_folder_scan_status');

export const clearFolderScanData = () =>
  invokeMutation<void>('clear_folder_scan_data');

export const aiApi = {
  getAssignmentModelStatus,
  getAssignmentModelMetrics,
  setAssignmentMode,
  setAssignmentModelCooldown,
  setTrainingHorizonDays,
  setDecayHalfLifeDays,
  setTrainingBlacklists,
  resetModelWeights,
  resetModelFull,
  trainAssignmentModel,
  runAutoSafeAssignment,
  rollbackLastAutoSafeRun,
  autoRunIfNeeded,
  applyDeterministicAssignment,
  setFeedbackWeight,
  scanProjectFoldersForAi,
  getFolderScanStatus,
  clearFolderScanData,
} as const;
