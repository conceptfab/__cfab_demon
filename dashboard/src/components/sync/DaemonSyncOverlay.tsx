/**
 * DaemonSyncOverlay — always-on polling overlay that detects daemon sync progress
 * regardless of trigger source (tray menu, background job, peer notification).
 *
 * Mounts alongside LanPeerNotification in BackgroundServices. Polls both LAN and
 * online sync progress from the daemon at low frequency. When sync is detected,
 * renders SyncProgressOverlay which handles the detailed progress display.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { lanSyncApi } from '@/lib/tauri';
import { getDaemonOnlineSyncProgress, triggerDaemonOnlineSync } from '@/lib/tauri/online-sync';
import { SyncProgressOverlay } from './SyncProgressOverlay';
import type { SyncProgress } from '@/lib/lan-sync-types';
import { useDataStore } from '@/store/data-store';

/** Polling interval when idle (checking if daemon started sync) */
const IDLE_POLL_MS = 2_000;

function isActive(p: SyncProgress): boolean {
  return p.phase !== 'idle' && p.step > 0;
}

function isTerminal(p: SyncProgress): boolean {
  return p.phase === 'completed' || p.phase === 'not_needed' || p.phase.startsWith('error');
}

export function DaemonSyncOverlay() {
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const [activeSyncType, setActiveSyncType] = useState<'lan' | 'online' | null>(null);
  const wasActiveRef = useRef(false);

  const handleFinished = useCallback((success: boolean) => {
    setActiveSyncType(null);
    wasActiveRef.current = false;
    if (success) {
      triggerRefresh('daemon_sync_finished');
    }
  }, [triggerRefresh]);

  const lastSyncTypeRef = useRef<'lan' | 'online' | null>(null);

  // Track last sync type so retry knows what to re-trigger
  useEffect(() => {
    if (activeSyncType) lastSyncTypeRef.current = activeSyncType;
  }, [activeSyncType]);

  const handleRetry = useCallback(() => {
    const retryType = lastSyncTypeRef.current;
    // Reset state so polling resumes
    setActiveSyncType(null);
    wasActiveRef.current = false;

    // Re-trigger the same sync type
    if (retryType === 'online') {
      triggerDaemonOnlineSync().catch(() => {});
    } else if (retryType === 'lan') {
      // LAN sync is triggered via daemon tray — find first peer and run
      lanSyncApi.getLanPeers().then((peers) => {
        const peer = peers.find((p) => p.dashboard_running);
        if (peer) {
          lanSyncApi.runLanSync(peer.ip, peer.dashboard_port, '', false).catch(() => {});
        }
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (cancelled || activeSyncType !== null) return;

      try {
        // Check LAN sync first
        const lanProgress = await lanSyncApi.getLanSyncProgress();
        if (!cancelled && isActive(lanProgress) && !isTerminal(lanProgress)) {
          wasActiveRef.current = true;
          setActiveSyncType('lan');
          return;
        }
      } catch { /* daemon unreachable */ }

      try {
        // Then check online sync
        const onlineProgress = await getDaemonOnlineSyncProgress();
        if (!cancelled && isActive(onlineProgress) && !isTerminal(onlineProgress)) {
          wasActiveRef.current = true;
          setActiveSyncType('online');
          return;
        }
      } catch { /* daemon unreachable */ }
    };

    // Only poll when no overlay is active
    if (activeSyncType === null) {
      void poll();
      const id = window.setInterval(poll, IDLE_POLL_MS);
      return () => { cancelled = true; clearInterval(id); };
    }

    return () => { cancelled = true; };
  }, [activeSyncType]);

  if (activeSyncType === null) return null;

  return (
    <SyncProgressOverlay
      active
      syncType={activeSyncType}
      onFinished={handleFinished}
      onRetry={handleRetry}
    />
  );
}
