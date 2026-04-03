import { useEffect, useRef, useState, useCallback } from 'react';
import { ArrowDown, ArrowUp, Loader2, CheckCircle2, XCircle, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { lanSyncApi } from '@/lib/tauri';
import { getDaemonOnlineSyncProgress, triggerDaemonOnlineSync } from '@/lib/tauri/online-sync';
import type { SyncProgress } from '@/lib/lan-sync-types';

const POLL_MS = 500;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

interface SyncProgressOverlayProps {
  /** Whether sync is actively running (controls polling) */
  active: boolean;
  /** Called when sync completes or errors out */
  onFinished?: (success: boolean) => void;
  /** Which sync backend to poll — defaults to "lan" */
  syncType?: 'lan' | 'online';
  /** Called to retry after error — if provided, shows retry button instead of auto-dismiss */
  onRetry?: () => void;
}

export function SyncProgressOverlay({ active, onFinished, syncType = 'lan', onRetry }: SyncProgressOverlayProps) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [speed, setSpeed] = useState(0);
  const [eta, setEta] = useState<number | null>(null);
  const prevBytesRef = useRef(0);
  const prevTimeRef = useRef(Date.now());
  const finishedRef = useRef(false);

  useEffect(() => {
    if (!active) {
      setProgress(null);
      finishedRef.current = false;
      return;
    }

    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const p = syncType === 'online'
          ? await getDaemonOnlineSyncProgress()
          : await lanSyncApi.getLanSyncProgress();
        if (cancelled) return;
        setProgress(p);

        // Calculate speed
        const now = Date.now();
        const dt = (now - prevTimeRef.current) / 1000;
        if (dt > 0 && p.bytes_transferred > 0) {
          const dBytes = p.bytes_transferred - prevBytesRef.current;
          if (dBytes > 0) {
            const currentSpeed = dBytes / dt;
            setSpeed(currentSpeed);
            if (p.bytes_total > 0 && currentSpeed > 0) {
              const remaining = p.bytes_total - p.bytes_transferred;
              setEta(Math.ceil(remaining / currentSpeed));
            } else {
              setEta(null);
            }
          }
        }
        prevBytesRef.current = p.bytes_transferred;
        prevTimeRef.current = now;

        // Detect completion (including "not_needed" — databases already identical)
        if ((p.phase === 'completed' || p.phase === 'not_needed') && !finishedRef.current) {
          finishedRef.current = true;
          setTimeout(() => onFinished?.(true), 1500);
        }
        if (p.phase.startsWith('error') && !finishedRef.current) {
          finishedRef.current = true;
          if (!onRetry) {
            setTimeout(() => onFinished?.(false), 2500);
          }
          // When onRetry is provided, overlay stays visible with retry button
        }
      } catch {
        // Daemon not reachable — ignore
      }
    };

    void poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [active, onFinished, syncType]);

  if (!active || !progress || progress.phase === 'idle') return null;

  const percent = progress.bytes_total > 0
    ? Math.min(100, Math.round((progress.bytes_transferred / progress.bytes_total) * 100))
    : null;

  const isTransfer = progress.direction === 'upload' || progress.direction === 'download';
  const isCompleted = progress.phase === 'completed' || progress.phase === 'not_needed';
  const isError = progress.phase.startsWith('error');

  const phaseLabel = t(`sync_progress.${progress.phase}`, progress.phase);

  return (
    <div className="fixed bottom-20 right-6 z-50 w-80 animate-in slide-in-from-bottom-4 duration-300">
      <div className="rounded-lg border border-sky-500/30 bg-background/95 backdrop-blur-sm px-4 py-3 shadow-lg shadow-sky-500/10">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          {isCompleted ? (
            <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
          ) : isError ? (
            <XCircle className="h-4 w-4 text-red-400 shrink-0" />
          ) : progress.direction === 'download' ? (
            <ArrowDown className="h-4 w-4 text-sky-400 shrink-0 animate-pulse" />
          ) : progress.direction === 'upload' ? (
            <ArrowUp className="h-4 w-4 text-sky-400 shrink-0 animate-pulse" />
          ) : (
            <Loader2 className="h-4 w-4 text-sky-400 shrink-0 animate-spin" />
          )}
          <span className="text-sm font-medium truncate">
            {syncType === 'online'
              ? t('sync_progress.online_title', 'Online Synchronization')
              : t('sync_progress.title', 'LAN Synchronization')}
          </span>
          <span className="text-xs text-muted-foreground ml-auto shrink-0">
            {progress.step}/{progress.total_steps}
          </span>
        </div>

        {/* Phase label */}
        <p className="text-xs text-muted-foreground mb-2 truncate">
          {phaseLabel}
        </p>

        {/* Retry button on error */}
        {isError && onRetry && (
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => {
                finishedRef.current = false;
                setProgress(null);
                setSpeed(0);
                setEta(null);
                prevBytesRef.current = 0;
                prevTimeRef.current = Date.now();
                onRetry();
              }}
              className="flex items-center gap-1.5 text-xs font-medium text-sky-400 hover:text-sky-300 transition-colors"
            >
              <RotateCw className="h-3.5 w-3.5" />
              {t('sync_progress.retry', 'Retry')}
            </button>
            <button
              onClick={() => onFinished?.(false)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto"
            >
              {t('sync_progress.dismiss', 'Dismiss')}
            </button>
          </div>
        )}

        {/* Progress bar — only for transfer phases */}
        {isTransfer && (
          <>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mb-1.5">
              <div
                className="h-full rounded-full bg-sky-500 transition-all duration-300"
                style={{ width: `${percent ?? 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {progress.direction === 'download' ? '↓' : '↑'}{' '}
                {speed > 0 ? formatSpeed(speed) : '—'}
              </span>
              <span>
                {formatBytes(progress.bytes_transferred)}
                {progress.bytes_total > 0 && ` / ${formatBytes(progress.bytes_total)}`}
                {percent !== null && ` · ${percent}%`}
              </span>
              {eta !== null && eta > 0 && (
                <span>
                  ~{eta}s
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
