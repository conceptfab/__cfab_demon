import { useCallback, useEffect, useState } from 'react';
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
  Cpu,
  Rocket,
  HelpCircle,
  Bug,
} from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/ui-store';
import { BugHunter } from './BugHunter';
import { helpTabForPage } from '@/lib/help-navigation';
import {
  getOnlineSyncIndicatorSnapshot,
  subscribeOnlineSyncIndicator,
  runOnlineSyncOnce,
  type OnlineSyncIndicatorSnapshot,
} from '@/lib/online-sync';
import {
  getDaemonStatus,
  getSessionCount,
  getAssignmentModelStatus,
  getDatabaseSettings,
  hasTauriRuntime,
} from '@/lib/tauri';
import type {
  DaemonStatus,
  AssignmentModelStatus,
  DatabaseSettings,
} from '@/lib/db-types';
import { loadSessionSettings } from '@/lib/user-settings';

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
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'sessions', label: 'Sessions', icon: List },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'estimates', label: 'Estimates', icon: CircleDollarSign },
  { id: 'applications', label: 'Applications', icon: AppWindow },
  { id: 'analysis', label: 'Time Analysis', icon: BarChart3 },
  { id: 'ai', label: 'AI & Model', icon: Brain },
  { id: 'data', label: 'Data', icon: Import },
  { id: 'daemon', label: 'Daemon', icon: Cpu },
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
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-1 transition-all text-[11px] font-medium',
        onClick ? 'hover:bg-accent/40' : 'cursor-default',
      )}
      title={title}
    >
      <div className="relative shrink-0">
        <Icon
          className={cn(
            'h-3.5 w-3.5',
            colorClass || 'text-muted-foreground/70',
          )}
        />
        {pulse && (
          <span className="absolute -right-0.5 -top-0.5 flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75"></span>
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-500"></span>
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
  );
}

export function Sidebar() {
  const { currentPage, setCurrentPage, helpTab, setHelpTab, firstRun } =
    useUIStore();
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [aiStatus, setAiStatus] = useState<AssignmentModelStatus | null>(null);
  const [dbSettings, setDbSettings] = useState<DatabaseSettings | null>(null);
  const [todayUnassigned, setTodayUnassigned] = useState<number>(0);
  const [allUnassigned, setAllUnassigned] = useState<number>(0);
  const [syncIndicator, setSyncIndicator] =
    useState<OnlineSyncIndicatorSnapshot>(() =>
      getOnlineSyncIndicatorSnapshot(),
    );

  const [isBugHunterOpen, setIsBugHunterOpen] = useState(false);
  const openContextHelp = useCallback(() => {
    const targetTab =
      currentPage === 'help' ? helpTab : helpTabForPage(currentPage, helpTab);
    setHelpTab(targetTab);
    setCurrentPage('help');
  }, [currentPage, helpTab, setCurrentPage, setHelpTab]);

  useEffect(() => {
    const check = () => {
      const now = new Date();
      const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const minDuration =
        loadSessionSettings().minSessionDurationSeconds || undefined;
      void Promise.allSettled([
        getDaemonStatus(minDuration),
        getAssignmentModelStatus(),
        getDatabaseSettings(),
        getSessionCount({
          dateRange: { start: localDate, end: localDate },
          unassigned: true,
          minDuration,
        }),
        // All-time unassigned count with same minDuration filter
        // so badge matches what Sessions page actually shows
        getSessionCount({
          unassigned: true,
          minDuration,
        }),
      ]).then(([daemonRes, aiRes, dbRes, todayCountRes, allCountRes]) => {
        if (daemonRes.status === 'fulfilled') setStatus(daemonRes.value);
        if (aiRes.status === 'fulfilled') setAiStatus(aiRes.value);
        if (dbRes.status === 'fulfilled') setDbSettings(dbRes.value);
        if (todayCountRes.status === 'fulfilled')
          setTodayUnassigned(Math.max(0, todayCountRes.value));
        if (allCountRes.status === 'fulfilled')
          setAllUnassigned(Math.max(0, allCountRes.value));
      });
    };
    check();
    const interval = setInterval(check, 10_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    return subscribeOnlineSyncIndicator(setSyncIndicator);
  }, []);

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

  // Use all-time unassigned count (with minDuration applied) so badge
  // matches what Sessions page can actually display.
  const unassignedSessions =
    todayUnassigned > 0 ? todayUnassigned : allUnassigned;
  const sessionsBadge =
    unassignedSessions > 99 ? '99+' : String(unassignedSessions);
  const sessionsAttentionTitle =
    unassignedSessions > 0
      ? todayUnassigned > 0
        ? `${unassignedSessions} unassigned sessions today`
        : `${unassignedSessions} unassigned sessions (all dates)`
      : undefined;
  const handleSidebarDragMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (!hasTauriRuntime()) return;
    void getCurrentWindow()
      .startDragging()
      .catch((error) => {
        console.warn(
          'Window dragging failed (permissions/capability?):',
          error,
        );
      });
  };

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-56 flex-col border-r border-border/35 bg-background">
      <div
        data-tauri-drag-region
        className="flex h-12 select-none items-center border-b border-border/25 px-4"
        onMouseDown={handleSidebarDragMouseDown}
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          TIMEFLOW
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 p-2">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setCurrentPage(item.id)}
            title={item.id === 'sessions' ? sessionsAttentionTitle : undefined}
            className={cn(
              'flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
              currentPage === item.id ||
                (item.id === 'projects' && currentPage === 'project-card')
                ? 'border-border/40 bg-accent/75 text-card-foreground'
                : 'border-transparent text-muted-foreground hover:border-border/35 hover:bg-accent/50 hover:text-accent-foreground',
            )}
          >
            <span className="flex items-center gap-2.5">
              <item.icon className="h-3.5 w-3.5" />
              <span>{item.label}</span>
            </span>
            {item.id === 'sessions' && unassignedSessions > 0 && (
              <span className="rounded-sm border border-destructive/25 bg-destructive/10 px-1.5 py-0 text-[10px] font-medium text-destructive">
                *{sessionsBadge}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="space-y-1 p-2 pb-5">
        <div className="space-y-0.5">
          <StatusIndicator
            icon={Cpu}
            label="Daemon"
            statusText={status?.running ? 'Running' : 'Stopped'}
            colorClass={status?.running ? 'text-emerald-500' : 'text-red-400'}
            onClick={() => setCurrentPage('daemon')}
            title={
              allUnassigned > 0 ? `${allUnassigned} unassigned` : undefined
            }
          />

          <StatusIndicator
            icon={RefreshCw}
            label="Sync"
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
              void runOnlineSyncOnce();
            }}
            title={syncIndicator.detail}
          />

          <StatusIndicator
            icon={Brain}
            label="AI Mode"
            statusText={aiStatus?.mode?.replace('_', ' ') ?? 'off'}
            colorClass={
              aiStatus?.mode !== 'off'
                ? 'text-purple-400'
                : 'text-muted-foreground/40'
            }
            onClick={() => setCurrentPage('ai')}
            pulse={
              !aiStatus?.is_training &&
              (aiStatus?.feedback_since_train ?? 0) > 0
            }
          />

          {aiStatus?.is_training ? (
            <StatusIndicator
              icon={Activity}
              label="AI"
              statusText="Training"
              colorClass="text-amber-500"
              pulse
              onClick={() => setCurrentPage('ai')}
            />
          ) : (aiStatus?.feedback_since_train ?? 0) > 0 ? (
            <StatusIndicator
              icon={Activity}
              label="AI"
              statusText="New Data"
              colorClass="text-sky-400"
              onClick={() => setCurrentPage('ai')}
              title={`${aiStatus?.feedback_since_train} new assignments since last training`}
            />
          ) : (
            dbSettings?.backup_enabled && (
              <StatusIndicator
                icon={ShieldCheck}
                label="Backup"
                statusText="Safe"
                colorClass="text-emerald-500/80"
                onClick={() => setCurrentPage('settings')}
                title={`Last backup: ${dbSettings.last_backup_at ? new Date(dbSettings.last_backup_at).toLocaleDateString() : 'Never'}`}
              />
            )
          )}
        </div>

        <div className="flex items-center justify-between px-2.5 pt-1.5 border-t border-border/10">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-muted-foreground/40 font-mono">
              v{status?.dashboard_version || '?.?.?'}
            </span>
            {status?.version && !status.is_compatible && (
              <span
                className="text-[9px] font-mono text-destructive font-bold"
                title="VERSION INCOMPATIBILITY! Daemon: v{status.version}"
              >
                ⚠️
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsBugHunterOpen(true)}
              className={cn(
                'transition-all text-muted-foreground/30 hover:text-destructive active:scale-90',
              )}
              title="BugHunter - report a bug"
            >
              <Bug className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                setCurrentPage('quickstart');
              }}
              className={cn(
                'relative transition-all',
                currentPage === 'quickstart'
                  ? 'text-primary scale-110'
                  : 'text-muted-foreground/30 hover:text-primary',
              )}
              title="Quick Start"
            >
              <Rocket
                className={cn(
                  'h-4 w-4',
                  firstRun &&
                    'animate-bounce text-primary drop-shadow-[0_0_8px_rgba(var(--primary),0.8)]',
                )}
              />
              {firstRun && (
                <span className="absolute -top-1 -right-1 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
              )}
            </button>
            <button
              onClick={openContextHelp}
              className={cn(
                'transition-all',
                currentPage === 'help'
                  ? 'text-primary scale-110'
                  : 'text-muted-foreground/30 hover:text-foreground',
              )}
              title="Help (F1)"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCurrentPage('settings')}
              className={cn(
                'transition-all',
                currentPage === 'settings'
                  ? 'text-primary scale-110'
                  : 'text-muted-foreground/30 hover:text-foreground',
              )}
              title="Settings"
            >
              <Settings className="h-4 w-4" />
            </button>
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
