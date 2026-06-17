import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUIStore } from '@/store/ui-store';
import { useBackgroundStatusStore } from '@/store/background-status-store';
import { lanSyncApi, triggerDaemonOnlineSync } from '@/lib/tauri';
import { loadLanSyncSettings, loadLanSyncState, saveLanSyncState } from '@/lib/lan-sync';
import { pollLanSyncUntilComplete } from '@/lib/lan-sync-poll';
import { useDataStore } from '@/store/data-store';
import { helpTabForPage } from '@/lib/help-navigation';
import { getAiModeLabel, hasPendingAssignmentModelTrainingData } from '@/lib/assignment-model';
import {
  getOnlineSyncIndicatorSnapshot,
  subscribeOnlineSyncIndicator,
  type OnlineSyncIndicatorSnapshot,
} from '@/lib/online-sync';
import type { AssignmentModelStatus } from '@/lib/db-types';

export interface SidebarControllerOptions {
  onNavigate?: () => void;
}

export function useSidebarController({ onNavigate }: SidebarControllerOptions = {}) {
  const { t, i18n } = useTranslation();
  const currentPage = useUIStore((s) => s.currentPage);
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const helpTab = useUIStore((s) => s.helpTab);
  const setHelpTab = useUIStore((s) => s.setHelpTab);
  const firstRun = useUIStore((s) => s.firstRun);
  const status = useBackgroundStatusStore((s) => s.daemonStatus);
  const aiStatus = useBackgroundStatusStore(
    (s) => s.aiStatus as AssignmentModelStatus | null,
  );
  const dbSettings = useBackgroundStatusStore((s) => s.dbSettings);
  const todayUnassigned = useBackgroundStatusStore((s) => s.todayUnassigned);
  const allUnassigned = useBackgroundStatusStore((s) => s.allUnassigned);
  const lanPeer = useBackgroundStatusStore((s) => s.lanPeer);
  const lanPeerPaired = useBackgroundStatusStore((s) => s.lanPeerPaired);
  const lanIsSlave = useBackgroundStatusStore((s) => s.lanIsSlave);
  const lanPeerVersionOk = useBackgroundStatusStore((s) => s.lanPeerVersionOk);
  const refreshLanPeers = useBackgroundStatusStore((s) => s.refreshLanPeers);
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);

  const [syncIndicator, setSyncIndicator] =
    useState<OnlineSyncIndicatorSnapshot>(() =>
      getOnlineSyncIndicatorSnapshot(),
    );
  const [lanSyncing, setLanSyncing] = useState(false);
  const [lanSyncMessage, setLanSyncMessage] = useState<string | null>(null);
  const [lanScanning, setLanScanning] = useState(false);
  const [isBugHunterOpen, setIsBugHunterOpen] = useState(false);
  const lanSyncMessageTimerRef = useRef<number | null>(null);

  const lanSyncReady = !!lanPeer && lanPeerPaired && lanPeerVersionOk;

  const goToPage = useCallback(
    (page: string) => {
      setCurrentPage(page);
      onNavigate?.();
    },
    [onNavigate, setCurrentPage],
  );

  const clearLanSyncMessageLater = useCallback((delayMs: number) => {
    if (lanSyncMessageTimerRef.current) {
      window.clearTimeout(lanSyncMessageTimerRef.current);
    }
    lanSyncMessageTimerRef.current = window.setTimeout(() => {
      lanSyncMessageTimerRef.current = null;
      setLanSyncMessage(null);
    }, delayMs);
  }, []);

  useEffect(() => {
    const timerRef = lanSyncMessageTimerRef;
    return () => {
      const timerId = timerRef.current;
      if (timerId) {
        window.clearTimeout(timerId);
        timerRef.current = null;
      }
    };
  }, []);

  const handleLanSync = useCallback(async () => {
    if (!lanPeer || lanSyncing || lanIsSlave) return;
    if (!lanPeerVersionOk) {
      setLanSyncMessage(t('layout.tooltips.lan_readiness_version_mismatch'));
      clearLanSyncMessageLater(8_000);
      return;
    }
    setLanSyncing(true);
    setLanSyncMessage(t('settings.lan_sync.syncing'));
    try {
      try {
        const serverStatus = await lanSyncApi.getLanServerStatus();
        if (!serverStatus.running) {
          const s = loadLanSyncSettings();
          await lanSyncApi.startLanServer(s.serverPort);
        }
      } catch {
        /* ignore */
      }

      const state = loadLanSyncState();
      const since = state.lastSyncAt || '1970-01-01T00:00:00Z';
      await lanSyncApi.runLanSync(lanPeer.ip, lanPeer.dashboard_port, since);
      await pollLanSyncUntilComplete();

      saveLanSyncState({
        ...state,
        lastSyncAt: new Date().toISOString(),
        lastSyncPeerId: lanPeer.device_id,
        peers: [lanPeer],
      });
      triggerRefresh('lan_sync_pull');
      setLanSyncMessage(t('layout.status.lan_synced'));
      clearLanSyncMessageLater(8_000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('LAN sync failed:', msg);
      if (
        msg.includes('Ping failed') ||
        msg.includes('refused') ||
        msg.includes('connection') ||
        msg.includes('unreachable')
      ) {
        setLanSyncMessage(t('settings.lan_sync.error_peer_unreachable'));
        void refreshLanPeers();
      } else {
        setLanSyncMessage(msg.length > 60 ? msg.slice(0, 60) + '…' : msg);
      }
      clearLanSyncMessageLater(10_000);
    } finally {
      setLanSyncing(false);
    }
  }, [
    lanPeer,
    lanSyncing,
    lanIsSlave,
    lanPeerVersionOk,
    triggerRefresh,
    t,
    clearLanSyncMessageLater,
    refreshLanPeers,
  ]);

  const handleLanScan = useCallback(async () => {
    if (lanScanning || lanSyncing) return;
    setLanScanning(true);
    setLanSyncMessage(t('layout.status.lan_scanning'));
    try {
      const results = await lanSyncApi.scanLanSubnet();
      if (results.length > 0) {
        void refreshLanPeers();
      }
    } catch {
      /* scan failed silently */
    } finally {
      setLanScanning(false);
      setLanSyncMessage(null);
    }
  }, [lanScanning, lanSyncing, t, refreshLanPeers]);

  const openContextHelp = useCallback(() => {
    const targetTab =
      currentPage === 'help' ? helpTab : helpTabForPage(currentPage, helpTab);
    setHelpTab(targetTab);
    goToPage('help');
  }, [currentPage, goToPage, helpTab, setHelpTab]);

  useEffect(() => {
    return subscribeOnlineSyncIndicator(setSyncIndicator);
  }, []);

  const refreshPeersOnVisible = useEffectEvent(() => {
    void refreshLanPeers();
  });

  useEffect(() => {
    if (document.visibilityState === 'visible') {
      refreshPeersOnVisible();
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshPeersOnVisible();
      }
    }, 5_000);
    return () => clearInterval(timer);
  }, []);

  const handleKeyDownHelp = useEffectEvent(() => {
    openContextHelp();
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        handleKeyDownHelp();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const unassignedSessions =
    todayUnassigned > 0 ? todayUnassigned : allUnassigned;
  const hasPendingAiTrainingData =
    hasPendingAssignmentModelTrainingData(aiStatus);
  const aiModeStatusText = getAiModeLabel(aiStatus?.mode, t);
  const sessionsBadge = unassignedSessions.toLocaleString();
  const sessionsAttentionTitle =
    unassignedSessions > 0
      ? todayUnassigned > 0
        ? t('layout.tooltips.unassigned_today', { count: unassignedSessions })
        : t('layout.tooltips.unassigned_all_dates', {
            count: unassignedSessions,
          })
      : undefined;

  return {
    aiModeStatusText,
    aiStatus,
    allUnassigned,
    currentPage,
    dbSettings,
    firstRun,
    goToPage,
    handleLanScan,
    handleLanSync,
    hasPendingAiTrainingData,
    i18n,
    isBugHunterOpen,
    lanIsSlave,
    lanPeer,
    lanPeerPaired,
    lanPeerVersionOk,
    lanScanning,
    lanSyncMessage,
    lanSyncReady,
    lanSyncing,
    openContextHelp,
    sessionsAttentionTitle,
    sessionsBadge,
    setIsBugHunterOpen,
    status,
    syncIndicator,
    t,
    triggerDaemonOnlineSync,
    unassignedSessions,
  };
}

export type SidebarController = ReturnType<typeof useSidebarController>;
