import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCancellableAsync } from '@/lib/async-utils';
import { pollDaemonStatusUntil } from '@/lib/daemon-status-poll';
import { logger } from '@/lib/logger';
import {
  isDaemonControlDocumentVisible,
  parseDaemonLogLines,
} from '@/lib/daemon-control-utils';
import type { DaemonStatus } from '@/lib/db-types';
import { daemonApi, readLogFile } from '@/lib/tauri';
import { logTauriError } from '@/lib/utils';
import { useBackgroundStatusStore } from '@/store/background-status-store';
import { useToast } from '@/components/ui/toast-notification';

export function useDaemonControlController() {
  const { t } = useTranslation();
  const { showError } = useToast();
  const status = useBackgroundStatusStore((s) => s.daemonStatus);
  const filteredUnassigned = useBackgroundStatusStore((s) => s.allUnassigned);
  const refreshDiagnostics = useBackgroundStatusStore((s) => s.refreshDiagnostics);
  const setDaemonStatus = useBackgroundStatusStore((s) => s.setDaemonStatus);
  const setDaemonAutostart = useBackgroundStatusStore((s) => s.setDaemonAutostart);
  const [logs, setLogs] = useState('');
  const [loading, setLoading] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const isWindowVisibleRef = useRef<boolean | null>(null);
  if (isWindowVisibleRef.current === null) {
    isWindowVisibleRef.current = isDaemonControlDocumentVisible();
  }
  const refreshAsync = useCancellableAsync();
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  const refreshLogs = useCallback(() => {
    void refreshAsync(async () => readLogFile('daemon', 200), {
      onSuccess: (nextLogs) => {
        setLogs(nextLogs);
      },
      onError: (error) => {
        logTauriError('refresh daemon logs', error);
      },
    });
  }, [refreshAsync]);

  const refreshAll = useCallback(
    ({ includeLogs = true }: { includeLogs?: boolean } = {}) => {
      void refreshDiagnostics();
      if (!includeLogs) return;
      void refreshAsync(async () => readLogFile('daemon', 200), {
        onSuccess: (nextLogs) => {
          setLogs(nextLogs);
        },
        onError: (error) => {
          logTauriError('refresh daemon logs', error);
        },
      });
    },
    [refreshAsync, refreshDiagnostics],
  );

  useEffect(() => {
    if (status === null) {
      void refreshDiagnostics();
    }
    refreshLogs();
  }, [refreshDiagnostics, refreshLogs, status]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const stopInterval = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    const syncIntervalWithVisibility = () => {
      const visible = isDaemonControlDocumentVisible();
      isWindowVisibleRef.current = visible;
      if (!autoRefresh || !visible) {
        stopInterval();
        return;
      }
      if (!interval) {
        interval = setInterval(refreshLogs, 5000);
      }
    };

    const handleVisibilityChange = () => {
      syncIntervalWithVisibility();
      if (isDaemonControlDocumentVisible()) {
        refreshLogs();
      }
    };

    syncIntervalWithVisibility();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);
    return () => {
      stopInterval();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, [refreshLogs, autoRefresh]);

  useEffect(() => {
    const el = logsContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const shouldAutoScroll = distanceFromBottom < 80;
    if (shouldAutoScroll) {
      logsEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [logs]);

  const logLines = useMemo(() => parseDaemonLogLines(logs), [logs]);

  const pollDaemonStatus = useCallback(
    async (predicate: (next: DaemonStatus) => boolean) => {
      await pollDaemonStatusUntil(
        () => daemonApi.getDaemonStatus(),
        predicate,
        { onStatus: setDaemonStatus },
      );
    },
    [setDaemonStatus],
  );

  const withLoading = async (
    label: string,
    fn: () => Promise<void>,
    settlePredicate: (next: DaemonStatus) => boolean,
  ) => {
    setLoading(label);
    try {
      await fn();
      await pollDaemonStatus(settlePredicate);
      refreshAll();
    } catch (e) {
      logger.error(e);
      showError(String(e));
    } finally {
      setLoading('');
    }
  };

  const handleStart = () =>
    withLoading('start', daemonApi.startDaemon, (next) => next.running);
  const handleStop = () =>
    withLoading('stop', daemonApi.stopDaemon, (next) => !next.running);
  const handleRestart = () =>
    withLoading('restart', daemonApi.restartDaemon, (next) => next.running);

  const handleAutostartToggle = async () => {
    if (!status) return;
    const newVal = !status.autostart;
    try {
      await daemonApi.setAutostartEnabled(newVal);
      setDaemonAutostart(newVal);
    } catch (e) {
      logger.error(e);
    }
  };

  const toggleAutoRefresh = () => setAutoRefresh((prev) => !prev);

  return {
    autoRefresh,
    filteredUnassigned,
    handleAutostartToggle,
    handleRestart,
    handleStart,
    handleStop,
    loading,
    logLines,
    logs,
    logsContainerRef,
    logsEndRef,
    refreshAll,
    refreshLogs,
    status,
    t,
    toggleAutoRefresh,
  };
}

export type DaemonControlController = ReturnType<typeof useDaemonControlController>;
