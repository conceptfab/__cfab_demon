/**
 * DaemonSyncOverlay — always-on polling overlay that surfaces LAN sync progress
 * regardless of trigger source (tray menu, background job, peer notification).
 *
 * Online sync is intentionally SILENT: it is a background operation and must never
 * interrupt the user, so it renders NO blocking overlay and NO progress modal. We
 * still poll it quietly so the dashboard can refresh once it finishes. Only LAN
 * sync — which freezes the local DB — justifies blocking the UI.
 *
 * Mounts alongside LanPeerNotification in BackgroundServices.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { lanSyncApi } from '@/lib/tauri';
import { SyncProgressOverlay } from './SyncProgressOverlay';
import type { SyncProgress } from '@/lib/lan-sync-types';
import { useDataStore } from '@/store/data-store';

/** Polling interval when idle (checking if daemon started sync) */
const IDLE_POLL_MS = 2_000;
/** Timeout after which the overlay can be dismissed (5 minutes) */
const OVERLAY_TIMEOUT_MS = 5 * 60 * 1_000;

function isActive(p: SyncProgress): boolean {
  return p.phase !== 'idle' && p.step > 0;
}

function isTerminal(p: SyncProgress): boolean {
  return p.phase === 'completed' || p.phase === 'not_needed' || p.phase.startsWith('error');
}

export function DaemonSyncOverlay() {
  const { t } = useTranslation();
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);
  const [lanActive, setLanActive] = useState(false);
  const [canDismiss, setCanDismiss] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  // Tracks a silent online sync so the dashboard can refresh once it finishes.
  const onlineRunningRef = useRef(false);

  const handleFinished = useCallback((success: boolean) => {
    setLanActive(false);
    setCanDismiss(false);
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (success) {
      triggerRefresh('daemon_sync_finished');
    }
  }, [triggerRefresh]);

  const handleDismiss = useCallback(() => {
    setLanActive(false);
    setCanDismiss(false);
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
  }, []);

  const handleRetry = useCallback(() => {
    // Reset state so polling resumes
    setLanActive(false);
    // LAN sync is triggered via daemon tray — find first peer and run
    lanSyncApi.getLanPeers().then(async (peers) => {
      const peer = peers.find((p) => p.dashboard_running);
      if (peer) {
        // Use last known marker timestamp as `since` to avoid full re-sync on retry
        const marker = await lanSyncApi.getLatestSyncMarker().catch(() => null);
        const since = marker?.created_at || '';
        lanSyncApi.runLanSync(peer.ip, peer.dashboard_port, since, false).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  // Start timeout when LAN sync becomes active — allow dismiss after 5min
  useEffect(() => {
    if (!lanActive) return;
    // canDismiss=false ustawiane przy aktywacji w pollu (poniżej), nie tu —
    // unikamy synchronicznego setState w efekcie (react-hooks/set-state-in-effect).
    timeoutRef.current = window.setTimeout(() => setCanDismiss(true), OVERLAY_TIMEOUT_MS);
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [lanActive]);

  // Prevent window close during active LAN sync (local DB is frozen)
  useEffect(() => {
    if (!lanActive) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [lanActive]);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (cancelled || lanActive) return;

      try {
        // Both LAN and online sync share the same daemon progress state,
        // so we only need one call. The sync_type field tells us which is active.
        const progress = await lanSyncApi.getLanSyncProgress();
        if (cancelled) return;
        const type = progress.sync_type === 'online' ? 'online' : 'lan';

        if (isActive(progress) && !isTerminal(progress)) {
          if (type === 'online') {
            // Online sync runs silently in the background — never surface a view.
            onlineRunningRef.current = true;
          } else {
            setCanDismiss(false);
            setLanActive(true);
          }
          return;
        }

        // Idle or terminal: if a silent online sync was running, refresh the
        // dashboard now that it has finished (skip on error — nothing changed).
        if (onlineRunningRef.current) {
          onlineRunningRef.current = false;
          if (!progress.phase.startsWith('error')) {
            triggerRefresh('daemon_sync_finished');
          }
        }
      } catch { /* daemon unreachable */ }
    };

    // Only poll when the LAN overlay isn't active (SyncProgressOverlay polls then).
    if (!lanActive) {
      void poll();
      const id = window.setInterval(poll, IDLE_POLL_MS);
      return () => { cancelled = true; clearInterval(id); };
    }

    return () => { cancelled = true; };
  }, [lanActive, triggerRefresh]);

  // Online sync never renders — only the LAN overlay blocks the UI.
  if (!lanActive) return null;

  return (
    <>
      {/* Fullscreen blocking overlay — prevents all UI interaction during LAN sync (DB frozen) */}
      <div className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm" />
      <SyncProgressOverlay
        active
        syncType="lan"
        onFinished={handleFinished}
        onRetry={handleRetry}
      />
      {canDismiss && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000]">
          <button type="button"
            onClick={handleDismiss}
            className="rounded-md border border-muted-foreground/30 bg-background/90 px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/50 transition-colors backdrop-blur-sm"
          >
            {t('daemon_sync.dismiss_warning', 'Dismiss — sync may still be running')}
          </button>
        </div>
      )}
    </>
  );
}
