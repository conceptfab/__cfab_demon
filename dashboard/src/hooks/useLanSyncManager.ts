import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { lanSyncApi, settingsApi } from '@/lib/tauri';
import {
  loadLanSyncSettings,
  saveLanSyncSettings,
  loadLanSyncState,
  recordPeerSync,
} from '@/lib/lan-sync';
import type {
  LanPeer,
  LanSyncSettings as LanSyncSettingsType,
  SyncMarker,
} from '@/lib/lan-sync-types';
import { usePageRefreshListener } from '@/hooks/usePageRefreshListener';
import { useDataStore } from '@/store/data-store';

export function useLanSyncManager() {
  const { t } = useTranslation();
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);

  const [lanSettings, setLanSettings] = useState<LanSyncSettingsType>(loadLanSyncSettings);
  const [lanPeers, setLanPeers] = useState<LanPeer[]>([]);
  const [lanSyncing, setLanSyncing] = useState(false);
  const [lanSyncResult, setLanSyncResult] = useState<{
    text: string;
    success: boolean;
  } | null>(null);
  const [latestMarker, setLatestMarker] = useState<SyncMarker | null>(null);
  const [myIp, setMyIp] = useState('');
  const [pairedDeviceIds, setPairedDeviceIds] = useState<Set<string>>(new Set());
  const [pairingExpiredDeviceIds, setPairingExpiredDeviceIds] = useState<Set<string>>(new Set());
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingCodeRemaining, setPairingCodeRemaining] = useState(0);

  const [lastSyncAt, setLastSyncAt] = useState(() => loadLanSyncState().lastSyncAt);
  useEffect(() => {
    setLastSyncAt(loadLanSyncState().lastSyncAt);
  }, [lanSyncing]);

  const syncPhaseLabels = useMemo(
    () => ({
      sync_phase_idle: t('settings.lan_sync.sync_phase_idle'),
      sync_phase_starting: t('settings.lan_sync.sync_phase_starting'),
      sync_phase_negotiating: t('settings.lan_sync.sync_phase_negotiating'),
      sync_phase_negotiated: t('settings.lan_sync.sync_phase_negotiated'),
      sync_phase_freezing: t('settings.lan_sync.sync_phase_freezing'),
      sync_phase_downloading: t('settings.lan_sync.sync_phase_downloading'),
      sync_phase_received: t('settings.lan_sync.sync_phase_received'),
      sync_phase_backup: t('settings.lan_sync.sync_phase_backup'),
      sync_phase_merging: t('settings.lan_sync.sync_phase_merging'),
      sync_phase_verifying: t('settings.lan_sync.sync_phase_verifying'),
      sync_phase_uploading: t('settings.lan_sync.sync_phase_uploading'),
      sync_phase_slave_downloading: t('settings.lan_sync.sync_phase_slave_downloading'),
      sync_phase_completed: t('settings.lan_sync.sync_phase_completed'),
    }),
    [t],
  );

  // Get local LAN IP
  useEffect(() => {
    lanSyncApi
      .getLocalIps()
      .then((ips) => {
        setMyIp(ips[0] || '');
      })
      .catch(() => {});
  }, []);

  // Load latest sync marker — refresh after UI sync AND poll periodically (for slave)
  useEffect(() => {
    const refresh = () => {
      lanSyncApi
        .getLatestSyncMarker()
        .then((marker) => {
          setLatestMarker(marker);
          if (marker?.created_at) {
            setLastSyncAt((prev) => {
              if (!prev || new Date(marker.created_at) > new Date(prev)) {
                return marker.created_at;
              }
              return prev;
            });
          }
        })
        .catch(() => {});
    };
    refresh();
    const id = window.setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [lanSyncing]);

  // Poll peers every 5s; auto-scan subnet once if no peers found after 10s
  useEffect(() => {
    if (!lanSettings.enabled) {
      setLanPeers([]);
      return;
    }
    let autoScanned = false;
    const poll = () => {
      lanSyncApi
        .getLanPeers()
        .then((peers) => {
          setLanPeers((prev) => {
            if (prev.length !== peers.length) return peers;
            const changed = peers.some(
              (p, i) =>
                p.device_id !== prev[i]?.device_id ||
                p.dashboard_running !== prev[i]?.dashboard_running ||
                p.ip !== prev[i]?.ip,
            );
            return changed ? peers : prev;
          });
        })
        .catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, 5_000);
    const scanTimer = window.setTimeout(() => {
      if (autoScanned) return;
      lanSyncApi
        .getLanPeers()
        .then((peers) => {
          if (peers.length === 0 && !autoScanned) {
            autoScanned = true;
            lanSyncApi.scanLanSubnet().catch(() => {});
          }
        })
        .catch(() => {});
    }, 10_000);
    return () => {
      clearInterval(id);
      clearTimeout(scanTimer);
    };
  }, [lanSettings.enabled]);

  // Start/stop LAN server based on enabled setting
  useEffect(() => {
    if (lanSettings.enabled) {
      lanSyncApi.startLanServer(lanSettings.serverPort).catch((e) => {
        console.warn('Failed to start LAN server:', e);
      });
    } else {
      lanSyncApi.stopLanServer().catch(() => {});
    }
  }, [lanSettings.enabled, lanSettings.serverPort]);

  // ── Pairing ──
  const refreshPairedDevices = useCallback(async () => {
    try {
      const devices = await lanSyncApi.getPairedDevices();
      const newIds = new Set(devices.map((d) => d.device_id));
      setPairedDeviceIds((prev) => {
        if (pairingCode) {
          for (const id of newIds) {
            if (!prev.has(id)) {
              setPairingCode(null);
              setPairingCodeRemaining(0);
              break;
            }
          }
        }
        return newIds;
      });
      // Hydrate expired set from daemon-reported auth-error flag so the badge
      // survives reloads and appears even for syncs triggered outside the UI.
      const expiredFromDaemon = new Set(
        devices
          .filter((d) => d.last_auth_error_at)
          .map((d) => d.device_id),
      );
      setPairingExpiredDeviceIds((prev) => {
        if (
          prev.size === expiredFromDaemon.size &&
          [...prev].every((id) => expiredFromDaemon.has(id))
        ) {
          return prev;
        }
        return expiredFromDaemon;
      });
    } catch {
      // Daemon might not be running
    }
  }, [pairingCode]);

  useEffect(() => {
    void refreshPairedDevices();
  }, [refreshPairedDevices]);

  useEffect(() => {
    if (!lanSettings.enabled) return;
    const id = window.setInterval(() => {
      void refreshPairedDevices();
    }, 5_000);
    return () => clearInterval(id);
  }, [lanSettings.enabled, refreshPairedDevices]);

  // Pairing code countdown timer
  useEffect(() => {
    if (!pairingCode || pairingCodeRemaining <= 0) return;
    const timer = setInterval(() => {
      setPairingCodeRemaining((prev) => {
        if (prev <= 1) {
          setPairingCode(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [pairingCode, pairingCodeRemaining]);

  const handleGeneratePairingCode = useCallback(async () => {
    try {
      const result = await lanSyncApi.generatePairingCode();
      setPairingCode(result.code);
      setPairingCodeRemaining(result.expires_in_secs);
    } catch (e) {
      setLanSyncResult({
        text: e instanceof Error ? e.message : String(e),
        success: false,
      });
    }
  }, []);

  const handlePairWithPeer = useCallback(
    async (peer: LanPeer, code: string) => {
      const result = await lanSyncApi.submitPairingCode(
        peer.ip,
        peer.dashboard_port,
        code,
      );
      setPairedDeviceIds((prev) => new Set([...prev, result.device_id]));
      setPairingExpiredDeviceIds((prev) => {
        const next = new Set(prev);
        next.delete(result.device_id);
        return next;
      });
    },
    [],
  );

  const handleUnpairDevice = useCallback(async (peer: LanPeer) => {
    try {
      await lanSyncApi.unpairDevice(peer.device_id);
      setPairedDeviceIds((prev) => {
        const next = new Set(prev);
        next.delete(peer.device_id);
        return next;
      });
    } catch (e) {
      setLanSyncResult({
        text: e instanceof Error ? e.message : String(e),
        success: false,
      });
    }
  }, []);

  const updateLanSettings = useCallback(
    (updater: (prev: LanSyncSettingsType) => LanSyncSettingsType) => {
      setLanSettings((prev) => {
        const next = updater(prev);
        saveLanSyncSettings(next);
        settingsApi
          .persistLanSyncSettingsForDaemon(
            next.syncIntervalHours,
            next.discoveryDurationMinutes,
            next.enabled,
            next.forcedRole,
            next.autoSyncOnPeerFound,
          )
          .catch((e) =>
            console.warn(
              'Failed to persist LAN sync settings for daemon:',
              e,
            ),
          );
        return next;
      });
    },
    [],
  );

  const handleLanSync = useCallback(
    async (peer: LanPeer, fullSync = false, force = false) => {
      setLanSyncing(true);
      setLanSyncResult(null);
      try {
        const state = loadLanSyncState();
        const since =
          fullSync || force
            ? '1970-01-01T00:00:00Z'
            : state.peerSyncTimes?.[peer.device_id] ||
              state.lastSyncAt ||
              '1970-01-01T00:00:00Z';

        await lanSyncApi.runLanSync(peer.ip, peer.dashboard_port, since, force);
        recordPeerSync(peer);
        setPairingExpiredDeviceIds((prev) => {
          if (!prev.has(peer.device_id)) return prev;
          const next = new Set(prev);
          next.delete(peer.device_id);
          return next;
        });
        const label = force
          ? t('settings.lan_sync.force_sync_label', 'Force sync')
          : fullSync
            ? t('settings.lan_sync.full_sync_label', 'Full sync')
            : t('settings.lan_sync.sync_label', 'Sync');
        setLanSyncResult({ text: `${label} — OK`, success: true });
        triggerRefresh('lan_sync_pull');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('pairing_invalid') || msg.includes('401')) {
          setPairingExpiredDeviceIds(
            (prev) => new Set([...prev, peer.device_id]),
          );
          setLanSyncResult({
            text: t('settings.lan_sync.pairing_badge_expired'),
            success: false,
          });
        } else {
          setLanSyncResult({ text: msg, success: false });
        }
      } finally {
        setLanSyncing(false);
      }
    },
    [t],
  );

  const handleManualPing = useCallback(
    async (ip: string, port: number): Promise<LanPeer | null> => {
      const result = await lanSyncApi.pingLanPeer(ip, port);
      const peer: LanPeer = {
        device_id: result.device_id,
        machine_name: result.machine_name,
        ip: result.ip,
        dashboard_port: result.dashboard_port,
        last_seen: new Date().toISOString(),
        dashboard_running: true,
        timeflow_version: result.version,
      };
      await lanSyncApi.upsertLanPeer(peer);
      setLanPeers((prev) => {
        const exists = prev.some((p) => p.device_id === peer.device_id);
        return exists
          ? prev.map((p) => (p.device_id === peer.device_id ? peer : p))
          : [...prev, peer];
      });
      return peer;
    },
    [],
  );

  return {
    lanSettings,
    lanPeers,
    lanSyncing,
    lanSyncResult,
    latestMarker,
    myIp,
    pairedDeviceIds,
    pairingExpiredDeviceIds,
    pairingCode,
    pairingCodeRemaining,
    lastSyncAt,
    syncPhaseLabels,
    handleGeneratePairingCode,
    handlePairWithPeer,
    handleUnpairDevice,
    updateLanSettings,
    handleLanSync,
    handleManualPing,
  };
}
