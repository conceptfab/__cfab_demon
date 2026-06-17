import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { sidebarNavItems } from '@/lib/sidebar-nav-items';
import type { SidebarController } from '@/hooks/useSidebarController';

type SidebarNavProps = Pick<
  SidebarController,
  | 'currentPage'
  | 'goToPage'
  | 'sessionsAttentionTitle'
  | 'sessionsBadge'
  | 'unassignedSessions'
>;

export function SidebarNav({
  currentPage,
  goToPage,
  sessionsAttentionTitle,
  sessionsBadge,
  unassignedSessions,
}: SidebarNavProps) {
  const { t } = useTranslation();

  return (
    <nav
      className="flex-1 space-y-0.5 p-2"
      aria-label={t('layout.aria.main_navigation')}
    >
      {sidebarNavItems.map((item) => (
        <AppTooltip
          key={item.id}
          content={
            item.id === 'sessions' ? sessionsAttentionTitle : undefined
          }
          side="right"
        >
          <button
            type="button"
            onClick={() => goToPage(item.id)}
            aria-current={
              currentPage === item.id ||
              (item.id === 'projects' && currentPage === 'project-card') ||
              (item.id === 'clients' && currentPage === 'client-card')
                ? 'page'
                : undefined
            }
            className={cn(
              'flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
              currentPage === item.id ||
                (item.id === 'projects' && currentPage === 'project-card') ||
                (item.id === 'clients' && currentPage === 'client-card')
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
  );
}
