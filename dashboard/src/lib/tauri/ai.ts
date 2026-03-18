import { invoke, invokeMutation } from './core';
import type {
  AssignmentMode,
  AssignmentModelMetrics,
  AssignmentModelStatus,
  AutoSafeRollbackResult,
  AutoSafeRunResult,
  DateRange,
  DeterministicResult,
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

export const setTrainingBlacklists = (
  appBlacklist: string[],
  folderBlacklist: string[],
) =>
  invokeMutation<AssignmentModelStatus>('set_training_blacklists', {
    appBlacklist,
    folderBlacklist,
  });

export const resetAssignmentModelKnowledge = () =>
  invokeMutation<AssignmentModelStatus>('reset_assignment_model_knowledge');

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

export const getFeedbackWeight = () => invoke<number>('get_feedback_weight');

export const setFeedbackWeight = (weight: number) =>
  invokeMutation<void>('set_feedback_weight', { weight });

export const aiApi = {
  getAssignmentModelStatus,
  getAssignmentModelMetrics,
  setAssignmentMode,
  setAssignmentModelCooldown,
  setTrainingHorizonDays,
  setTrainingBlacklists,
  resetAssignmentModelKnowledge,
  trainAssignmentModel,
  runAutoSafeAssignment,
  rollbackLastAutoSafeRun,
  autoRunIfNeeded,
  applyDeterministicAssignment,
  getFeedbackWeight,
  setFeedbackWeight,
} as const;
