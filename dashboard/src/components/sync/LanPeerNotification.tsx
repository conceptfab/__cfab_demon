import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Wifi, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { lanSyncApi, getDaemonRuntimeStatus } from '@/lib/tauri';
import { loadLanSyncSettings, loadLanSyncState, recordPeerSync } from '@/lib/lan-sync';
import type { LanPeer } from '@/lib/lan-sync-types';
import { useDataStore } from '@/store/data-store';
import { SyncProgressOverlay } from './SyncProgressOverlay';

/**
 * Strict version match — LAN sync ma sens tylko dla identycznych wersji
 * po obu stronach (schema bazy / format snapshotu mogą się rozjechać między
 * patchami). Backend `run_lan_sync` blokuje to dodatkowo serwerowo.
 */
function peerVersionMatches(peer: LanPeer, localVersion: string): boolean {
  const peerVersion = (peer.timeflow_version ?? '').trim();
  return localVersion !== '' && peerVersion !== '' && peerVersion === localVersion;
}

const POLL_INTERVAL_MS = 5_000;
const NOTIFICATION_DISMISS_KEY = 'timeflow.lan-sync.dismissed-peers';

const DISMISS_TTL_MS = 4 * 3600_000; // 4 hours

interface DismissEntry {
  id: string;
  until: number;
}

// Module-level cache to avoid parsing localStorage on every 5s poll tick
let dismissedCache: Set<string> | null = null;

function getDismissedPeers(): Set<string> {
  if (dismissedCache) return dismissedCache;
  try {
    const raw = localStorage.getItem(NOTIFICATION_DISMISS_KEY);
    if (!raw) { dismissedCache = new Set(); return dismissedCache; }
    const entries: DismissEntry[] = JSON.parse(raw);
    const now = Date.now();
    const valid = entries.filter((e) => e.until > now);
    if (valid.length !== entries.length) {
      localStorage.setItem(NOTIFICATION_DISMISS_KEY, JSON.stringify(valid));
    }
    dismissedCache = new Set(valid.map((e) => e.id));
    return dismissedCache;
  } catch {
    dismissedCache = new Set();
    return dismissedCache;
  }
}

function dismissPeer(deviceId: string): void {
  const raw = localStorage.getItem(NOTIFICATION_DISMISS_KEY);
  const now = Date.now();
  let entries: DismissEntry[] = [];
  if (raw) {
    try { entries = JSON.parse(raw); } catch { /* corrupted localStorage */ }
  }
  const valid = entries.filter((e) => e.until > now);
  valid.push({ id: deviceId, until: now + DISMISS_TTL_MS });
  localStorage.setItem(NOTIFICATION_DISMISS_KEY, JSON.stringify(valid));
  dismissedCache = null; // invalidate cache
}

async function ensureLanServerRunning(): Promise<void> {
  try {
    const status = await lanSyncApi.getLanServerStatus();
    if (!status.running) {
      const settings = loadLanSyncSettings();
      await lanSyncApi.startLanServer(settings.serverPort);
    }
  } catch {
    // Server might already be running — ignore
  }
}

export function LanPeerNotification() {
  const { t } = useTranslation();
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const [visiblePeer, setVisiblePeer] = useState<LanPeer | null>(null);
  const [incompatPeer, setIncompatPeer] = useState<LanPeer | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [localVersion, setLocalVersion] = useState<string>('');
  const pollRef = useRef<number | null>(null);
  const visiblePeerRef = useRef<LanPeer | null>(null);
  const incompatPeerRef = useRef<LanPeer | null>(null);
  const localVersionRef = useRef<string>('');

  visiblePeerRef.current = visiblePeer;
  incompatPeerRef.current = incompatPeer;
  localVersionRef.current = localVersion;

  // Wersja własna dashboardu — pobierana raz, używana do strict version match
  // przy wyświetlaniu toastu LAN sync. Bez niej ukrywamy oba banery
  // (nie wiemy do czego porównać).
  useEffect(() => {
    let cancelled = false;
    getDaemonRuntimeStatus()
      .then((s) => {
        if (cancelled) return;
        setLocalVersion((s.dashboard_version ?? '').trim());
      })
      .catch(() => {
        if (cancelled) return;
        setLocalVersion('');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep a ref to handleSync so the polling effect always calls the latest version
  const handleSyncRef = useRef<(peer: LanPeer) => Promise<void>>();

  useEffect(() => {
    const poll = async () => {
      try {
        // Sync wymaga sparowania. Powiadomienie pokazujemy tylko dla peerów,
        // którzy są jednocześnie widoczni w LAN (dashboard_running) ORAZ
        // znajdują się na liście sparowanych urządzeń. Niesparowanych peerów
        // obsługuje panel ustawień LAN Sync (tam jest flow parowania).
        const [peers, pairedDevices] = await Promise.all([
          lanSyncApi.getLanPeers(),
          lanSyncApi.getPairedDevices().catch(() => []),
        ]);
        const pairedIds = new Set(pairedDevices.map((d) => d.device_id));
        const dismissed = getDismissedPeers();
        const candidates = peers.filter(
          (p) =>
            p.dashboard_running &&
            pairedIds.has(p.device_id) &&
            !dismissed.has(p.device_id),
        );

        const local = localVersionRef.current;
        const compat = candidates.find((p) => peerVersionMatches(p, local)) ?? null;
        const incompat = candidates.find((p) => !peerVersionMatches(p, local)) ?? null;

        if (compat?.device_id !== visiblePeerRef.current?.device_id) {
          setVisiblePeer(compat);
        }
        if (incompat?.device_id !== incompatPeerRef.current?.device_id) {
          setIncompatPeer(incompat);
        }
      } catch {
        // Silent fail — discovery may not be ready (no lan_peers.json yet)
      }
    };

    void poll();
    pollRef.current = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
    };
  }, []);

  const handleSync = useCallback(async (peer: LanPeer) => {
    setSyncing(true);
    setSyncError(null);
    try {
      // Make sure our own LAN server is running so the peer can push back
      await ensureLanServerRunning();

      const state = loadLanSyncState();
      const since = state.peerSyncTimes?.[peer.device_id] || state.lastSyncAt || '1970-01-01T00:00:00Z';
      await lanSyncApi.runLanSync(peer.ip, peer.dashboard_port, since);

      // Poll daemon progress until sync completes (max 5 min)
      const deadline = Date.now() + 300_000;
      let lastPhase = '';
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 800));
        try {
          const p = await lanSyncApi.getLanSyncProgress();
          if (p.phase !== lastPhase) lastPhase = p.phase;
          if (p.phase === 'completed' || (p.phase === 'idle' && p.step === 0 && lastPhase !== '')) {
            break;
          }
        } catch { /* daemon unreachable */ }
      }

      recordPeerSync(peer);
      triggerRefresh('lan_sync_pull');
      setSyncError(null);
      setVisiblePeer(null);
      dismissPeer(peer.device_id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('LAN sync failed:', msg);
      if (msg.includes('Ping failed') || msg.includes('connection') || msg.includes('refused')) {
        setSyncError(t('settings.lan_sync.error_peer_unreachable'));
      } else {
        setSyncError(msg);
      }
      // Auto-dismiss notification after sync failure (peer gone)
      if (visiblePeerRef.current) {
        dismissPeer(visiblePeerRef.current.device_id);
      }
      setTimeout(() => {
        setVisiblePeer(null);
        setSyncError(null);
      }, 5_000);
    } finally {
      setSyncing(false);
    }
  }, [triggerRefresh, t]);

  // Keep ref in sync with latest handleSync
  handleSyncRef.current = handleSync;

  const handleDismiss = useCallback(() => {
    if (visiblePeer) {
      dismissPeer(visiblePeer.device_id);
    }
    setVisiblePeer(null);
  }, [visiblePeer]);

  const handleIncompatDismiss = useCallback(() => {
    if (incompatPeer) {
      dismissPeer(incompatPeer.device_id);
    }
    setIncompatPeer(null);
  }, [incompatPeer]);

  const handleSyncFinished = useCallback((success: boolean) => {
    if (success) {
      triggerRefresh('lan_sync_pull');
    }
    setSyncing(false);
  }, [triggerRefresh]);

  // Show progress overlay when syncing (even if peer notification was dismissed)
  if (syncing) {
    return <SyncProgressOverlay active={syncing} onFinished={handleSyncFinished} />;
  }

  if (!visiblePeer && !incompatPeer) return null;

  return (
    <div className="fixed bottom-20 right-6 z-50 animate-in slide-in-from-bottom-4 duration-300">
      <div className="flex flex-col gap-2">
        {syncError && (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-background/95 backdrop-blur-sm px-4 py-2 shadow-lg text-xs text-red-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate max-w-[250px]">{syncError}</span>
          </div>
        )}

        {incompatPeer && (
          <div className="flex items-start gap-3 rounded-lg border border-red-500/40 bg-background/95 backdrop-blur-sm px-4 py-3 shadow-lg shadow-red-500/10 max-w-[360px]">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-red-300">
                {t('settings.lan_sync.version_mismatch_title', {
                  name: incompatPeer.machine_name,
                })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t('settings.lan_sync.version_mismatch_detail', {
                  peer: incompatPeer.timeflow_version || '?.?.?',
                  local: localVersion || '?.?.?',
                })}
              </p>
            </div>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
              onClick={handleIncompatDismiss}
              aria-label={t('common.dismiss', 'Dismiss')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {visiblePeer && (
          <div className="flex items-center gap-3 rounded-lg border border-sky-500/30 bg-background/95 backdrop-blur-sm px-4 py-3 shadow-lg shadow-sky-500/10">
            <Wifi className="h-4 w-4 text-sky-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {t('settings.lan_sync.peer_found', { name: visiblePeer.machine_name })}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs border-sky-500/30 text-sky-400 hover:bg-sky-500/10 shrink-0"
              disabled={syncing}
              onClick={() => void handleSync(visiblePeer)}
            >
              {syncing ? t('settings.lan_sync.syncing') : t('settings.lan_sync.sync_button')}
            </Button>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
              onClick={handleDismiss}
              aria-label={t('common.dismiss', 'Dismiss')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
