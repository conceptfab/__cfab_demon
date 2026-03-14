import { create } from 'zustand';
import {
  getAssignmentModelStatus,
  getDaemonRuntimeStatus,
  getDatabaseSettings,
  getSessionCount,
} from '@/lib/tauri';
import { loadSessionSettings } from '@/lib/user-settings';
import type {
  AssignmentModelStatus,
  DaemonStatus,
  DatabaseSettings,
} from '@/lib/db-types';
import { buildTodayDate } from '@/lib/date-helpers';
import { logTauriError } from '@/lib/utils';

let diagnosticsInFlight = false;
let aiStatusInFlight = false;
let databaseSettingsInFlight = false;

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function areDaemonStatusesEqual(
  left: DaemonStatus | null,
  right: DaemonStatus | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.running === right.running &&
    left.pid === right.pid &&
    left.exe_path === right.exe_path &&
    left.autostart === right.autostart &&
    left.needs_assignment === right.needs_assignment &&
    left.unassigned_sessions === right.unassigned_sessions &&
    left.unassigned_apps === right.unassigned_apps &&
    (left.version ?? null) === (right.version ?? null) &&
    (left.dashboard_version ?? null) === (right.dashboard_version ?? null) &&
    (left.is_compatible ?? null) === (right.is_compatible ?? null)
  );
}

function areAssignmentStatusesEqual(
  left: AssignmentModelStatus | null,
  right: AssignmentModelStatus | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.mode === right.mode &&
    left.min_confidence_suggest === right.min_confidence_suggest &&
    left.min_confidence_auto === right.min_confidence_auto &&
    left.min_evidence_auto === right.min_evidence_auto &&
    left.training_horizon_days === right.training_horizon_days &&
    areStringArraysEqual(
      left.training_app_blacklist,
      right.training_app_blacklist,
    ) &&
    areStringArraysEqual(
      left.training_folder_blacklist,
      right.training_folder_blacklist,
    ) &&
    left.last_train_at === right.last_train_at &&
    left.feedback_since_train === right.feedback_since_train &&
    left.is_training === right.is_training &&
    left.last_train_duration_ms === right.last_train_duration_ms &&
    left.last_train_samples === right.last_train_samples &&
    left.train_error_last === right.train_error_last &&
    left.cooldown_until === right.cooldown_until &&
    left.last_auto_run_at === right.last_auto_run_at &&
    left.last_auto_assigned_count === right.last_auto_assigned_count &&
    left.last_auto_rolled_back_at === right.last_auto_rolled_back_at &&
    left.can_rollback_last_auto_run === right.can_rollback_last_auto_run
  );
}

function areDatabaseSettingsEqual(
  left: DatabaseSettings | null,
  right: DatabaseSettings | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.vacuum_on_startup === right.vacuum_on_startup &&
    left.backup_enabled === right.backup_enabled &&
    left.backup_path === right.backup_path &&
    left.backup_interval_days === right.backup_interval_days &&
    left.last_backup_at === right.last_backup_at &&
    left.auto_optimize_enabled === right.auto_optimize_enabled &&
    left.auto_optimize_interval_hours === right.auto_optimize_interval_hours &&
    left.last_optimize_at === right.last_optimize_at
  );
}

interface BackgroundStatusState {
  daemonStatus: DaemonStatus | null;
  aiStatus: AssignmentModelStatus | null;
  dbSettings: DatabaseSettings | null;
  todayUnassigned: number;
  allUnassigned: number;
  refreshDiagnostics: () => Promise<void>;
  refreshAiStatus: () => Promise<void>;
  refreshDatabaseSettings: () => Promise<void>;
  setDaemonStatus: (status: DaemonStatus) => void;
  setDaemonAutostart: (autostart: boolean) => void;
  setAiStatus: (status: AssignmentModelStatus) => void;
}

export const useBackgroundStatusStore = create<BackgroundStatusState>(
  (set, get) => ({
    daemonStatus: null,
    aiStatus: null,
    dbSettings: null,
    todayUnassigned: 0,
    allUnassigned: 0,
    refreshDiagnostics: async () => {
      if (diagnosticsInFlight) return;
      diagnosticsInFlight = true;
      try {
        const minDuration =
          loadSessionSettings().minSessionDurationSeconds || undefined;
        const today = buildTodayDate();
        const [daemonRes, aiRes, todayCountRes, allCountRes] =
          await Promise.allSettled([
            getDaemonRuntimeStatus(),
            getAssignmentModelStatus(),
            getSessionCount({
              dateRange: { start: today, end: today },
              unassigned: true,
              minDuration,
            }),
            getSessionCount({
              unassigned: true,
              minDuration,
            }),
          ]);

        const currentState = get();
        const nextDaemonStatus =
          daemonRes.status === 'fulfilled'
            ? daemonRes.value
            : currentState.daemonStatus;
        const nextAiStatus =
          aiRes.status === 'fulfilled' ? aiRes.value : currentState.aiStatus;
        const nextTodayUnassigned =
          todayCountRes.status === 'fulfilled'
            ? Math.max(0, todayCountRes.value)
            : currentState.todayUnassigned;
        const nextAllUnassigned =
          allCountRes.status === 'fulfilled'
            ? Math.max(0, allCountRes.value)
            : currentState.allUnassigned;

        if (
          !areDaemonStatusesEqual(
            currentState.daemonStatus,
            nextDaemonStatus,
          ) ||
          !areAssignmentStatusesEqual(currentState.aiStatus, nextAiStatus) ||
          currentState.todayUnassigned !== nextTodayUnassigned ||
          currentState.allUnassigned !== nextAllUnassigned
        ) {
          set({
            daemonStatus: nextDaemonStatus,
            aiStatus: nextAiStatus,
            todayUnassigned: nextTodayUnassigned,
            allUnassigned: nextAllUnassigned,
          });
        }

        if (daemonRes.status === 'rejected') {
          logTauriError('refresh daemon status', daemonRes.reason);
        }
        if (aiRes.status === 'rejected') {
          logTauriError('refresh AI status', aiRes.reason);
        }
        if (todayCountRes.status === 'rejected') {
          logTauriError(
            'refresh today unassigned sessions',
            todayCountRes.reason,
          );
        }
        if (allCountRes.status === 'rejected') {
          logTauriError(
            'refresh unassigned sessions count',
            allCountRes.reason,
          );
        }
      } finally {
        diagnosticsInFlight = false;
      }
    },
    refreshAiStatus: async () => {
      if (aiStatusInFlight) return;
      aiStatusInFlight = true;
      try {
        const aiStatus = await getAssignmentModelStatus();
        if (!areAssignmentStatusesEqual(get().aiStatus, aiStatus)) {
          set({ aiStatus });
        }
      } catch (error) {
        logTauriError('refresh AI status', error);
        throw error;
      } finally {
        aiStatusInFlight = false;
      }
    },
    refreshDatabaseSettings: async () => {
      if (databaseSettingsInFlight) return;
      databaseSettingsInFlight = true;
      try {
        const dbSettings = await getDatabaseSettings();
        if (!areDatabaseSettingsEqual(get().dbSettings, dbSettings)) {
          set({ dbSettings });
        }
      } catch (error) {
        logTauriError('refresh database settings', error);
      } finally {
        databaseSettingsInFlight = false;
      }
    },
    setDaemonStatus: (daemonStatus) => {
      if (areDaemonStatusesEqual(get().daemonStatus, daemonStatus)) {
        return;
      }
      set({ daemonStatus });
    },
    setDaemonAutostart: (autostart) =>
      set((state) => {
        if (!state.daemonStatus || state.daemonStatus.autostart === autostart) {
          return state;
        }
        return {
          daemonStatus: { ...state.daemonStatus, autostart },
        };
      }),
    setAiStatus: (aiStatus) => {
      if (areAssignmentStatusesEqual(get().aiStatus, aiStatus)) {
        return;
      }
      set({ aiStatus });
    },
  }),
);

