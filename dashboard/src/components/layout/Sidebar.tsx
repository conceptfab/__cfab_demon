import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import {
  LayoutDashboard,
  FolderKanban,
  CircleDollarSign,
  AppWindow,
  BarChart3,
  List,
  Settings,
  Import,
  Brain,
  RefreshCw,
  Activity,
  ShieldCheck,
  Wifi,
  Cpu,
  Rocket,
  HelpCircle,
  Bug,
  FileText,
  Briefcase,
  Link2,
  ArrowDownUp,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { useUIStore } from '@/store/ui-store';
import { useBackgroundStatusStore } from '@/store/background-status-store';
import { lanSyncApi } from '@/lib/tauri';
import { loadLanSyncSettings, loadLanSyncState, saveLanSyncState } from '@/lib/lan-sync';
import { useDataStore } from '@/store/data-store';
import { BugHunter } from './BugHunter';
import { helpTabForPage } from '@/lib/help-navigation';
import { tryStartWindowDrag } from '@/lib/window-drag';
import { isMacOS } from '@/lib/platform';
import { getAiModeLabel, hasPendingAssignmentModelTrainingData } from '@/lib/assignment-model';
import {
  getOnlineSyncIndicatorSnapshot,
  subscribeOnlineSyncIndicator,
  type OnlineSyncIndicatorSnapshot,
} from '@/lib/online-sync';
import { triggerDaemonOnlineSync } from '@/lib/tauri';
import type {
  AssignmentModelStatus,
} from '@/lib/db-types';

interface StatusIndicatorProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  statusText: string;
  colorClass?: string;
  onClick?: (e: MouseEvent) => void;
  title?: string;
  pulse?: boolean;
}

const navItems = [
  { id: 'dashboard', labelKey: 'layout.nav.dashboard', icon: LayoutDashboard },
  { id: 'sessions', labelKey: 'layout.nav.sessions', icon: List },
  { id: 'projects', labelKey: 'layout.nav.projects', icon: FolderKanban },
  { id: 'estimates', labelKey: 'layout.nav.estimates', icon: CircleDollarSign },
  {
    id: 'applications',
    labelKey: 'layout.nav.applications',
    icon: AppWindow,
  },
  { id: 'analysis', labelKey: 'layout.nav.analysis', icon: BarChart3 },
  { id: 'ai', labelKey: 'layout.nav.ai', icon: Brain },
  { id: 'data', labelKey: 'layout.nav.data', icon: Import },
  { id: 'reports', labelKey: 'layout.nav.reports', icon: FileText },
  { id: 'pm', labelKey: 'layout.nav.pm', icon: Briefcase },
  { id: 'daemon', labelKey: 'layout.nav.daemon', icon: Cpu },
];

function StatusIndicator({
  icon: Icon,
  label,
  statusText,
  colorClass,
  onClick,
  title,
  pulse,
}: StatusIndicatorProps) {
  return (
    <AppTooltip content={title} side="right">
      <button
        onClick={onClick}
        disabled={!onClick}
        className={cn(
          'group flex w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-1 transition-all text-[11px] font-medium',
          onClick ? 'hover:bg-accent/40' : 'cursor-default',
        )}
      >
        <div className="relative shrink-0">
          <Icon
            className={cn(
              'size-3.5',
              colorClass || 'text-muted-foreground/70',
            )}
          />
          {pulse && (
            <span className="absolute -right-0.5 -top-0.5 flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-400 opacity-75"></span>
              <span className="relative inline-flex size-1.5 rounded-full bg-sky-500"></span>
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-col items-start gap-0.5 leading-none">
          <span className="text-[7px] font-bold uppercase tracking-wider text-muted-foreground/45">
            {label}
          </span>
          <span className="truncate text-[10px] text-muted-foreground group-hover:text-foreground/90">
            {statusText}
          </span>
        </div>
      </button>
    </AppTooltip>
  );
}

export function Sidebar() {
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
  const [syncIndicator, setSyncIndicator] =
    useState<OnlineSyncIndicatorSnapshot>(() =>
      getOnlineSyncIndicatorSnapshot(),
    );

  const lanPeer = useBackgroundStatusStore((s) => s.lanPeer);
  const lanPeerPaired = useBackgroundStatusStore((s) => s.lanPeerPaired);
  const lanIsSlave = useBackgroundStatusStore((s) => s.lanIsSlave);
  const lanPeerVersionOk = useBackgroundStatusStore((s) => s.lanPeerVersionOk);
  const refreshLanPeers = useBackgroundStatusStore((s) => s.refreshLanPeers);
  // Sync is only allowed when peer is paired, online AND running the same TIMEFLOW version.
  const lanSyncReady = !!lanPeer && lanPeerPaired && lanPeerVersionOk;
  const [lanSyncing, setLanSyncing] = useState(false);
  const [lanSyncMessage, setLanSyncMessage] = useState<string | null>(null);
  const [lanScanning, setLanScanning] = useState(false);
  const lanSyncMessageTimerRef = useRef<number | null>(null);
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);

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
    return () => {
      if (lanSyncMessageTimerRef.current) {
        window.clearTimeout(lanSyncMessageTimerRef.current);
        lanSyncMessageTimerRef.current = null;
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
      // Ensure our server is running so the peer can push back
      try {
        const serverStatus = await lanSyncApi.getLanServerStatus();
        if (!serverStatus.running) {
          const s = loadLanSyncSettings();
          await lanSyncApi.startLanServer(s.serverPort);
        }
      } catch { /* ignore */ }

      const state = loadLanSyncState();
      const since = state.lastSyncAt || '1970-01-01T00:00:00Z';
      await lanSyncApi.runLanSync(lanPeer.ip, lanPeer.dashboard_port, since);

      // Poll daemon progress until completed (max 5 min)
      const deadline = Date.now() + 300_000;
      let lastPhase = '';
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 800));
        try {
          const p = await lanSyncApi.getLanSyncProgress();
          if (p.phase !== lastPhase) {
            lastPhase = p.phase;
          }
          if (p.phase === 'completed' || (p.phase === 'idle' && p.step === 0 && lastPhase !== '')) {
            break;
          }
        } catch { /* daemon unreachable */ }
      }

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
      if (msg.includes('Ping failed') || msg.includes('refused') || msg.includes('connection') || msg.includes('unreachable')) {
        setLanSyncMessage(t('settings.lan_sync.error_peer_unreachable'));
        void refreshLanPeers();
      } else {
        setLanSyncMessage(msg.length > 60 ? msg.slice(0, 60) + '…' : msg);
      }
      clearLanSyncMessageLater(10_000);
    } finally {
      setLanSyncing(false);
    }
  }, [lanPeer, lanSyncing, lanIsSlave, lanPeerVersionOk, triggerRefresh, t, clearLanSyncMessageLater, refreshLanPeers]);

  const handleLanScan = useCallback(async () => {
    if (lanScanning || lanSyncing) return;
    setLanScanning(true);
    setLanSyncMessage(t('layout.status.lan_scanning'));
    try {
      const results = await lanSyncApi.scanLanSubnet();
      if (results.length > 0) {
        // Re-poll peers to pick up discovered ones
        void refreshLanPeers();
      }
    } catch {
      // scan failed silently
    } finally {
      setLanScanning(false);
      setLanSyncMessage(null);
    }
  }, [lanScanning, lanSyncing, t, refreshLanPeers]);

  const [isBugHunterOpen, setIsBugHunterOpen] = useState(false);
  const openContextHelp = useCallback(() => {
    const targetTab =
      currentPage === 'help' ? helpTab : helpTabForPage(currentPage, helpTab);
    setHelpTab(targetTab);
    setCurrentPage('help');
  }, [currentPage, helpTab, setCurrentPage, setHelpTab]);

  useEffect(() => {
    return subscribeOnlineSyncIndicator(setSyncIndicator);
  }, []);

  // LAN peer polling moved to background-status-store (single source of truth)
  useEffect(() => {
    if (document.visibilityState === 'visible') {
      void refreshLanPeers();
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshLanPeers();
      }
    }, 5_000);
    return () => clearInterval(timer);
  }, [refreshLanPeers]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        openContextHelp();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openContextHelp]);

  const unassignedSessions =
    todayUnassigned > 0 ? todayUnassigned : allUnassigned;
  const hasPendingAiTrainingData =
    hasPendingAssignmentModelTrainingData(aiStatus);
  const aiModeStatusText = getAiModeLabel(aiStatus?.mode, t);
  const sessionsBadge =
    unassignedSessions > 99 ? '99+' : String(unassignedSessions);
  const sessionsAttentionTitle =
    unassignedSessions > 0
      ? todayUnassigned > 0
        ? t('layout.tooltips.unassigned_today', { count: unassignedSessions })
        : t('layout.tooltips.unassigned_all_dates', {
            count: unassignedSessions,
          })
      : undefined;

  const handleSidebarDragMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    tryStartWindowDrag();
  };

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-56 flex-col border-r border-border/35 bg-background">
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Tauri drag region, not a keyboard-navigable element */}
      <div
        data-tauri-drag-region
        className="flex h-12 select-none items-center border-b border-border/25 px-4"
        onMouseDown={handleSidebarDragMouseDown}
      >
        {!isMacOS() && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            TIMEFLOW
          </span>
        )}
      </div>

      <nav
        className="flex-1 space-y-0.5 p-2"
        aria-label={t('layout.aria.main_navigation')}
      >
        {navItems.map((item) => (
          <AppTooltip
            key={item.id}
            content={
              item.id === 'sessions' ? sessionsAttentionTitle : undefined
            }
            side="right"
          >
            <button
              onClick={() => setCurrentPage(item.id)}
              aria-current={
                currentPage === item.id ||
                (item.id === 'projects' && currentPage === 'project-card')
                  ? 'page'
                  : undefined
              }
              className={cn(
                'flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                currentPage === item.id ||
                  (item.id === 'projects' && currentPage === 'project-card')
                  ? 'border-border/40 bg-accent/75 text-card-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border/35 hover:bg-accent/50 hover:text-accent-foreground',
              )}
            >
              <span className="flex items-center gap-2.5">
                <item.icon className="size-3.5" />
                <span>{t(item.labelKey)}</span>
              </span>
              {item.id === 'sessions' && unassignedSessions > 0 && (
                <span className="rounded-sm border border-destructive/25 bg-destructive/10 px-1.5 py-0 text-[10px] font-medium text-destructive">
                  *{sessionsBadge}
                </span>
              )}
            </button>
          </AppTooltip>
        ))}
      </nav>

      <div className="space-y-1 p-2 pb-5">
        <div className="space-y-0.5">
          <StatusIndicator
            icon={Cpu}
            label={t('layout.status.daemon')}
            statusText={
              status?.running
                ? t('layout.status.running')
                : t('layout.status.stopped')
            }
            colorClass={status?.running ? 'text-emerald-500' : 'text-red-400'}
            onClick={() => setCurrentPage('daemon')}
            title={
              allUnassigned > 0
                ? t('layout.tooltips.unassigned_short', {
                    count: allUnassigned,
                  })
                : undefined
            }
          />

          <StatusIndicator
            icon={RefreshCw}
            label={t('layout.status.sync')}
            statusText={syncIndicator.label}
            colorClass={
              syncIndicator.status === 'error'
                ? 'text-red-400'
                : syncIndicator.status === 'syncing'
                  ? 'text-sky-400'
                  : 'text-emerald-500/70'
            }
            pulse={syncIndicator.status === 'syncing'}
            onClick={() => {
              triggerDaemonOnlineSync().catch(() => {});
            }}
            title={syncIndicator.detail}
          />

          {/* LAN status row: Wifi (peer) | Readiness (paired) | Delta sync */}
          <div className="flex w-full items-center gap-0.5 rounded-md p-1">
            {/* Wifi — peer discovery status */}
            <AppTooltip
              content={
                lanPeer
                  ? t('layout.tooltips.lan_peer_ip', { name: lanPeer.machine_name, ip: lanPeer.ip })
                  : t('layout.tooltips.lan_click_to_scan')
              }
              side="right"
            >
              <button
                onClick={
                  !lanPeer && !lanScanning
                    ? () => void handleLanScan()
                    : () => setCurrentPage('settings')
                }
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-all text-[11px] font-medium',
                  'hover:bg-accent/40',
                )}
              >
                <Wifi
                  className={cn(
                    'size-3.5',
                    lanSyncing || lanScanning
                      ? 'text-amber-400'
                      : lanPeer
                        ? 'text-sky-400'
                        : 'text-muted-foreground/35',
                  )}
                />
                <div className="flex min-w-0 flex-col items-start gap-0.5 leading-none">
                  <span className="text-[7px] font-bold uppercase tracking-wider text-muted-foreground/45">
                    {t('layout.status.lan')}
                  </span>
                  <span className="truncate text-[10px] text-muted-foreground max-w-[68px]">
                    {lanSyncMessage
                      ?? (lanPeer
                        ? lanPeer.machine_name
                        : lanScanning
                          ? t('layout.status.lan_scanning')
                          : t('layout.status.lan_no_peers'))}
                  </span>
                </div>
              </button>
            </AppTooltip>

            <div className="flex items-center gap-0.5 ml-auto">
              {/* Readiness — paired, online, and on the same TIMEFLOW version */}
              <AppTooltip
                content={
                  !lanPeer
                    ? t('layout.tooltips.lan_readiness_no_peer')
                    : !lanPeerPaired
                      ? t('layout.tooltips.lan_readiness_not_paired')
                      : !lanPeerVersionOk
                        ? t('layout.tooltips.lan_readiness_version_mismatch')
                        : t('layout.tooltips.lan_readiness_ready')
                }
                side="right"
              >
                <div
                  className={cn(
                    'flex items-center justify-center rounded-md p-1.5 transition-all',
                    lanSyncReady
                      ? 'text-emerald-500'
                      : lanPeer && !lanPeerVersionOk
                        ? 'text-red-400'
                        : lanPeer
                          ? 'text-amber-400'
                          : 'text-muted-foreground/25',
                  )}
                >
                  <Link2 className="size-3.5" />
                </div>
              </AppTooltip>

              {/* Delta sync trigger */}
              <AppTooltip
                content={
                  lanSyncReady && !lanIsSlave
                    ? t('layout.tooltips.lan_delta_sync')
                    : lanPeer && lanPeerPaired && !lanPeerVersionOk
                      ? t('layout.tooltips.lan_readiness_version_mismatch')
                      : t('layout.tooltips.lan_delta_sync_disabled')
                }
                side="right"
              >
                <button
                  onClick={
                    lanSyncReady && !lanIsSlave && !lanSyncing
                      ? () => void handleLanSync()
                      : undefined
                  }
                  disabled={!lanSyncReady || lanIsSlave || lanSyncing}
                  className={cn(
                    'flex items-center justify-center rounded-md p-1.5 transition-all',
                    lanSyncReady && !lanIsSlave && !lanSyncing
                      ? 'text-sky-400 hover:bg-sky-500/15 hover:text-sky-300 active:scale-90'
                      : 'text-muted-foreground/25 cursor-not-allowed',
                    lanSyncing && 'animate-pulse text-amber-400',
                  )}
                >
                  <ArrowDownUp className="size-3.5" />
                </button>
              </AppTooltip>
            </div>
          </div>

          <StatusIndicator
            icon={Brain}
            label={t('layout.status.ai_mode')}
            statusText={aiModeStatusText}
            colorClass={
              aiStatus?.mode !== 'off'
                ? 'text-purple-400'
                : 'text-muted-foreground/40'
            }
            onClick={() => setCurrentPage('ai')}
            pulse={hasPendingAiTrainingData}
          />

          {aiStatus?.is_training ? (
            <StatusIndicator
              icon={Activity}
              label={t('layout.status.ai')}
              statusText={t('layout.status.training')}
              colorClass="text-amber-500"
              pulse
              onClick={() => setCurrentPage('ai')}
            />
          ) : hasPendingAiTrainingData ? (
            <StatusIndicator
              icon={Activity}
              label={t('layout.status.ai')}
              statusText={t('layout.status.new_data')}
              colorClass="text-sky-400"
              onClick={() => setCurrentPage('ai')}
              title={t('layout.tooltips.new_assignments_since_training', {
                count: aiStatus?.feedback_since_train ?? 0,
              })}
            />
          ) : null}

          <StatusIndicator
            icon={ShieldCheck}
            label={t('layout.status.backup')}
            statusText={
              dbSettings?.backup_enabled
                ? t('layout.status.safe')
                : t('layout.status.off')
            }
            colorClass={
              dbSettings?.backup_enabled
                ? 'text-emerald-500/80'
                : 'text-muted-foreground/35'
            }
            onClick={() => setCurrentPage('settings')}
            title={
              dbSettings?.backup_enabled
                ? t('layout.tooltips.last_backup', {
                    date: dbSettings.last_backup_at
                      // eslint-disable-next-line react-doctor/rendering-hydration-mismatch-time -- No SSR (Tauri client app)
                      ? new Date(dbSettings.last_backup_at).toLocaleDateString(
                          i18n.resolvedLanguage || undefined,
                        )
                      : t('layout.tooltips.never'),
                  })
                : undefined
            }
          />
        </div>

        <div className="flex items-center justify-between px-2.5 pt-1.5 border-t border-border/10">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-muted-foreground/40 font-mono">
              v{status?.dashboard_version || '?.?.?'}
            </span>
            {status?.version && !status.is_compatible && (
              <AppTooltip
                content={t('layout.tooltips.version_incompatibility', {
                  version: status.version,
                })}
              >
                <span className="text-[9px] font-mono text-destructive font-bold cursor-default">
                  !
                </span>
              </AppTooltip>
            )}
          </div>
          <div className="flex items-center gap-3">
            <AppTooltip content={t('layout.tooltips.bughunter')}>
              <button
                onClick={() => setIsBugHunterOpen(true)}
                aria-label={t('layout.tooltips.bughunter')}
                className={cn(
                  'transition-all text-muted-foreground/30 hover:text-destructive active:scale-90',
                )}
              >
                <Bug className="size-4" />
              </button>
            </AppTooltip>
            <AppTooltip content={t('layout.tooltips.quick_start')}>
              <button
                onClick={() => {
                  setCurrentPage('quickstart');
                }}
                aria-label={t('layout.tooltips.quick_start')}
                className={cn(
                  'relative transition-all',
                  currentPage === 'quickstart'
                    ? 'text-primary scale-110'
                    : 'text-muted-foreground/30 hover:text-primary',
                )}
              >
                <Rocket
                  className={cn(
                    'size-4',
                    firstRun &&
                      'animate-bounce text-primary drop-shadow-[0_0_8px_rgba(var(--primary),0.8)]',
                  )}
                />
                {firstRun && (
                  <span className="absolute -top-1 -right-1 flex size-2">
                    <span className="animate-ping absolute inline-flex size-full rounded-full bg-primary opacity-75"></span>
                    <span className="relative inline-flex rounded-full size-2 bg-primary"></span>
                  </span>
                )}
              </button>
            </AppTooltip>
            <AppTooltip content={t('layout.tooltips.help')}>
              <button
                onClick={openContextHelp}
                aria-label={t('layout.tooltips.help')}
                className={cn(
                  'transition-all',
                  currentPage === 'help'
                    ? 'text-primary scale-110'
                    : 'text-muted-foreground/30 hover:text-foreground',
                )}
              >
                <HelpCircle className="size-4" />
              </button>
            </AppTooltip>
            <AppTooltip content={t('layout.tooltips.settings')}>
              <button
                onClick={() => setCurrentPage('settings')}
                aria-label={t('layout.tooltips.settings')}
                className={cn(
                  'transition-all',
                  currentPage === 'settings'
                    ? 'text-primary scale-110'
                    : 'text-muted-foreground/30 hover:text-foreground',
                )}
              >
                <Settings className="size-4" />
              </button>
            </AppTooltip>
          </div>
        </div>
      </div>
      <BugHunter
        isOpen={isBugHunterOpen}
        onClose={() => setIsBugHunterOpen(false)}
        version={status?.dashboard_version || '?.?.?'}
      />
    </aside>
  );
}
