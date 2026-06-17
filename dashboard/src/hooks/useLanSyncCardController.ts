import {
  useEffect,
  useRef,
  useState,
} from 'react';

import { lanSyncApi } from '@/lib/tauri/lan-sync';
import type { LanPeer } from '@/lib/lan-sync-types';
import { useDaemonSyncUiSnapshot, useDaemonSyncPollInterval } from '@/lib/lan-sync-daemon-ui-store';
import type { LanSyncCardProps } from '@/components/settings/lan-sync/lan-sync-card-types';

export function useLanSyncCardController({
  settings,
  syncing,
  onManualPing,
  onPairWithPeer,
}: LanSyncCardProps) {
  const [manualIp, setManualIp] = useState('');
  const [pinging, setPinging] = useState(false);
  const [pingError, setPingError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [syncLog, setSyncLog] = useState('');
  const [showLog, setShowLog] = useState(false);
  const [justPairedIds, setJustPairedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    peer: LanPeer;
  } | null>(null);

  const logRef = useRef<HTMLPreElement>(null);
  const daemonSyncUi = useDaemonSyncUiSnapshot();
  const { progress, daemonSyncing } = daemonSyncUi;
  const isBusy = syncing || daemonSyncing;
  useDaemonSyncPollInterval(isBusy);
  const showLogRef = useRef(showLog);
  // Zapis refa poza renderem (react-hooks/refs); czytany w efekcie auto-open logu.
  useEffect(() => {
    showLogRef.current = showLog;
  });

  const daemonRole = progress?.role || '';
  const isSlave =
    settings.forcedRole === 'slave' ||
    (settings.forcedRole !== 'master' && daemonRole === 'slave');

  const handlePairWithFlash = async (peer: LanPeer, code: string) => {
    if (!onPairWithPeer) return;
    await onPairWithPeer(peer, code);
    setJustPairedIds((prev) => new Set([...prev, peer.device_id]));
    setTimeout(() => {
      setJustPairedIds((prev) => {
        const next = new Set(prev);
        next.delete(peer.device_id);
        return next;
      });
    }, 4000);
  };

  useEffect(() => {
    const active =
      daemonSyncing &&
      progress &&
      progress.phase !== 'idle' &&
      progress.step !== 0;
    if (active && !showLogRef.current) setShowLog(true);
  }, [daemonSyncing, progress]);

  useEffect(() => {
    if (!showLog && !isBusy) return;
    const poll = async () => {
      try {
        const log = await lanSyncApi.getLanSyncLog(50);
        setSyncLog(log);
        if (logRef.current) {
          logRef.current.scrollTop = logRef.current.scrollHeight;
        }
      } catch {
        /* ignore */
      }
    };
    void poll();
    const timer = window.setInterval(poll, isBusy ? 500 : 2000);
    return () => clearInterval(timer);
  }, [showLog, isBusy]);

  const handleManualPing = async () => {
    const trimmed = manualIp.trim();
    if (!trimmed) return;
    setPinging(true);
    setPingError(null);
    try {
      await onManualPing(trimmed, settings.serverPort);
      setManualIp('');
    } catch (e) {
      setPingError(e instanceof Error ? e.message : String(e));
    } finally {
      setPinging(false);
    }
  };

  const handleScanSubnet = async () => {
    setScanning(true);
    try {
      await lanSyncApi.scanLanSubnet();
    } catch (e) {
      console.warn('LAN scan failed:', e);
    } finally {
      setScanning(false);
    }
  };

  return {
    contextMenu,
    daemonSyncing,
    handleManualPing,
    handlePairWithFlash,
    handleScanSubnet,
    isBusy,
    isSlave,
    justPairedIds,
    logRef,
    manualIp,
    pingError,
    pinging,
    scanning,
    setContextMenu,
    setManualIp,
    setShowLog,
    showLog,
    syncLog,
  };
}

export type LanSyncCardController = ReturnType<typeof useLanSyncCardController>;
