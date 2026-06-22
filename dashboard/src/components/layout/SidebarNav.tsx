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
> & {
  collapsed?: boolean;
};

export function SidebarNav({
  collapsed = false,
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
      {sidebarNavItems.map((item) => {
        const label = t(item.labelKey);
        const isActive =
          currentPage === item.id ||
          (item.id === 'projects' && currentPage === 'project-card') ||
          (item.id === 'clients' && currentPage === 'client-card');
        const sessionsTooltip =
          item.id === 'sessions' ? sessionsAttentionTitle : undefined;
        // W trybie zwiniętym etykieta zostaje ukryta — pokazujemy ją w tooltipie,
        // żeby ikony nie traciły czytelności (nav-label-icon).
        const tooltipContent = collapsed
          ? sessionsTooltip || label
          : sessionsTooltip;
        const showSessionsBadge =
          item.id === 'sessions' && unassignedSessions > 0;

        return (
          <AppTooltip key={item.id} content={tooltipContent} side="right">
            <button
              type="button"
              onClick={() => goToPage(item.id)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={collapsed ? label : undefined}
              className={cn(
                'flex w-full items-center rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                collapsed ? 'justify-center' : 'justify-between',
                isActive
                  ? 'border-border/40 bg-accent/75 text-card-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border/35 hover:bg-accent/50 hover:text-accent-foreground',
              )}
            >
              <span
                className={cn(
                  'relative flex items-center',
                  collapsed ? 'justify-center' : 'gap-2.5',
                )}
              >
                <item.icon className="size-3.5 shrink-0" />
                {!collapsed && <span>{label}</span>}
                {collapsed && showSessionsBadge && (
                  <span className="absolute -right-1.5 -top-1.5 size-1.5 rounded-full bg-destructive" />
                )}
              </span>
              {!collapsed && showSessionsBadge && (
                <span className="rounded-sm border border-destructive/25 bg-destructive/10 px-1.5 py-0 text-[10px] font-medium text-destructive">
                  *{sessionsBadge}
                </span>
              )}
            </button>
          </AppTooltip>
        );
      })}
    </nav>
  );
}
