import {
  Activity,
  Brain,
  Bug,
  Cpu,
  HelpCircle,
  RefreshCw,
  Rocket,
  Settings,
  ShieldCheck,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { SidebarStatusIndicator } from '@/components/layout/SidebarStatusIndicator';
import { SidebarLanStatusRow } from '@/components/layout/SidebarLanStatusRow';
import type { SidebarController } from '@/hooks/useSidebarController';

type SidebarStatusPanelProps = SidebarController & {
  collapsed?: boolean;
};

export function SidebarStatusPanel({
  collapsed = false,
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
  lanIsSlave,
  lanPeer,
  lanPeerPaired,
  lanPeerVersionOk,
  lanScanning,
  lanSyncMessage,
  lanSyncReady,
  lanSyncing,
  openContextHelp,
  setIsBugHunterOpen,
  status,
  syncIndicator,
  t,
  triggerDaemonOnlineSync,
}: SidebarStatusPanelProps) {
  return (
    <div className="space-y-1 p-2 pb-5">
      <div className="space-y-0.5">
        <SidebarStatusIndicator
          collapsed={collapsed}
          icon={Cpu}
          label={t('layout.status.daemon')}
          statusText={
            status?.running
              ? t('layout.status.running')
              : t('layout.status.stopped')
          }
          colorClass={status?.running ? 'text-emerald-500' : 'text-red-400'}
          onClick={() => goToPage('daemon')}
          title={
            allUnassigned > 0
              ? t('layout.tooltips.unassigned_short', {
                  count: allUnassigned,
                })
              : undefined
          }
        />

        <SidebarStatusIndicator
          collapsed={collapsed}
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

        <SidebarLanStatusRow
          collapsed={collapsed}
          goToPage={goToPage}
          handleLanScan={handleLanScan}
          handleLanSync={handleLanSync}
          lanIsSlave={lanIsSlave}
          lanPeer={lanPeer}
          lanPeerPaired={lanPeerPaired}
          lanPeerVersionOk={lanPeerVersionOk}
          lanScanning={lanScanning}
          lanSyncMessage={lanSyncMessage}
          lanSyncReady={lanSyncReady}
          lanSyncing={lanSyncing}
        />

        <SidebarStatusIndicator
          collapsed={collapsed}
          icon={Brain}
          label={t('layout.status.ai_mode')}
          statusText={aiModeStatusText}
          colorClass={
            aiStatus?.mode !== 'off'
              ? 'text-purple-400'
              : 'text-muted-foreground/40'
          }
          onClick={() => goToPage('ai')}
          pulse={hasPendingAiTrainingData}
        />

        {aiStatus?.is_training ? (
          <SidebarStatusIndicator
            collapsed={collapsed}
            icon={Activity}
            label={t('layout.status.ai')}
            statusText={t('layout.status.training')}
            colorClass="text-amber-500"
            pulse
            onClick={() => goToPage('ai')}
          />
        ) : hasPendingAiTrainingData ? (
          <SidebarStatusIndicator
            collapsed={collapsed}
            icon={Activity}
            label={t('layout.status.ai')}
            statusText={t('layout.status.new_data')}
            colorClass="text-sky-400"
            onClick={() => goToPage('ai')}
            title={t('layout.tooltips.new_assignments_since_training', {
              count: aiStatus?.feedback_since_train ?? 0,
            })}
          />
        ) : null}

        <SidebarStatusIndicator
          collapsed={collapsed}
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
          onClick={() => goToPage('settings')}
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

      <div
        className={cn(
          'border-t border-border/10 pt-1.5',
          collapsed
            ? 'flex flex-col items-center gap-1 px-0'
            : 'flex items-center justify-between px-2.5',
        )}
      >
        <div className="flex items-center gap-1.5">
          {!collapsed && (
            <span className="text-[9px] text-muted-foreground/40 font-mono">
              v{status?.dashboard_version || '?.?.?'}
            </span>
          )}
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
        <div
          className={cn(
            'flex items-center gap-0.5 sm:gap-1',
            collapsed && 'flex-col',
          )}
        >
          <AppTooltip content={t('layout.tooltips.bughunter')}>
            <button
              type="button"
              onClick={() => setIsBugHunterOpen(true)}
              aria-label={t('layout.tooltips.bughunter')}
              className={cn(
                'flex size-11 shrink-0 items-center justify-center rounded-md transition-all active:scale-95 md:size-9',
                'text-muted-foreground/30 hover:bg-accent/50 hover:text-destructive',
              )}
            >
              <Bug className="size-4" />
            </button>
          </AppTooltip>
          <AppTooltip content={t('layout.tooltips.quick_start')}>
            <button
              type="button"
              onClick={() => goToPage('quickstart')}
              aria-label={t('layout.tooltips.quick_start')}
              className={cn(
                'relative flex size-11 shrink-0 items-center justify-center rounded-md transition-all active:scale-95 md:size-9',
                currentPage === 'quickstart'
                  ? 'bg-accent/60 text-primary'
                  : 'text-muted-foreground/30 hover:bg-accent/50 hover:text-primary',
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
                <span className="absolute right-1.5 top-1.5 flex size-2">
                  <span className="animate-ping absolute inline-flex size-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full size-2 bg-primary"></span>
                </span>
              )}
            </button>
          </AppTooltip>
          <AppTooltip content={t('layout.tooltips.help')}>
            <button
              type="button"
              onClick={openContextHelp}
              aria-label={t('layout.tooltips.help')}
              className={cn(
                'flex size-11 shrink-0 items-center justify-center rounded-md transition-all active:scale-95 md:size-9',
                currentPage === 'help'
                  ? 'bg-accent/60 text-primary'
                  : 'text-muted-foreground/30 hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <HelpCircle className="size-4" />
            </button>
          </AppTooltip>
          <AppTooltip content={t('layout.tooltips.settings')}>
            <button
              type="button"
              onClick={() => goToPage('settings')}
              aria-label={t('layout.tooltips.settings')}
              className={cn(
                'flex size-11 shrink-0 items-center justify-center rounded-md transition-all active:scale-95 md:size-9',
                currentPage === 'settings'
                  ? 'bg-accent/60 text-primary'
                  : 'text-muted-foreground/30 hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <Settings className="size-4" />
            </button>
          </AppTooltip>
        </div>
      </div>
    </div>
  );
}
