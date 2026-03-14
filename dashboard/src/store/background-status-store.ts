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
import { buildTodayDate } from '@/lib/date-utils';
import { logTauriError } from '@/lib/utils';

let diagnosticsInFlight = false;
let aiStatusInFlight = false;
let databaseSettingsInFlight = false;

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
  (set) => ({
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

        set((state) => ({
          daemonStatus:
            daemonRes.status === 'fulfilled'
              ? daemonRes.value
              : state.daemonStatus,
          aiStatus: aiRes.status === 'fulfilled' ? aiRes.value : state.aiStatus,
          todayUnassigned:
            todayCountRes.status === 'fulfilled'
              ? Math.max(0, todayCountRes.value)
              : state.todayUnassigned,
          allUnassigned:
            allCountRes.status === 'fulfilled'
              ? Math.max(0, allCountRes.value)
              : state.allUnassigned,
        }));

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
        set({ aiStatus });
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
        set({ dbSettings });
      } catch (error) {
        logTauriError('refresh database settings', error);
      } finally {
        databaseSettingsInFlight = false;
      }
    },
    setDaemonStatus: (daemonStatus) => set({ daemonStatus }),
    setDaemonAutostart: (autostart) =>
      set((state) => ({
        daemonStatus: state.daemonStatus
          ? { ...state.daemonStatus, autostart }
          : state.daemonStatus,
      })),
    setAiStatus: (aiStatus) => set({ aiStatus }),
  }),
);
