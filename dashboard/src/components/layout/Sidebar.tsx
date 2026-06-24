import type { MouseEvent } from 'react';
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { BugHunter } from '@/components/layout/BugHunter';
import { SidebarNav } from '@/components/layout/SidebarNav';
import { SidebarStatusPanel } from '@/components/layout/SidebarStatusPanel';
import { useSidebarController } from '@/hooks/useSidebarController';
import { useSettingsStore } from '@/store/settings-store';
import { tryStartWindowDrag } from '@/lib/window-drag';
import { isMacOS } from '@/lib/platform';

function handleSidebarDragMouseDown(event: MouseEvent<HTMLDivElement>) {
  if (event.button !== 0) return;
  tryStartWindowDrag();
}

function stopToggleMouseDown(event: MouseEvent<HTMLButtonElement>) {
  // Nie pozwól, by klik w przycisk zwijania uruchomił przeciąganie okna.
  event.stopPropagation();
}

export function Sidebar({
  isMobileOpen = false,
  onClose,
  onNavigate,
}: {
  isMobileOpen?: boolean;
  onClose?: () => void;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const controller = useSidebarController({ onNavigate });
  const collapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useSettingsStore(
    (s) => s.toggleSidebarCollapsed,
  );
  // Na macOS natywne traffic lights (titleBarStyle: Overlay) siedzą w lewym-
  // górnym rogu. Przycisk zwijania renderujemy jako element `fixed` tuż obok
  // nich, na tym samym poziomie (jak w Claude Desktop) — w stałym miejscu,
  // niezależnie od tego, czy sidebar jest rozwinięty, czy zwinięty. Na
  // Windows/Linux nie ma kropek, więc przycisk zostaje w nagłówku obok tytułu.
  const onMac = isMacOS();

  const collapseToggle = (
    <button
      type="button"
      aria-label={
        collapsed
          ? t('layout.aria.expand_sidebar')
          : t('layout.aria.collapse_sidebar')
      }
      aria-expanded={!collapsed}
      aria-controls="app-sidebar"
      onClick={toggleSidebarCollapsed}
      onMouseDown={stopToggleMouseDown}
      className="hidden size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground md:flex [app-region:no-drag] [-webkit-app-region:no-drag]"
    >
      {collapsed ? (
        <PanelLeftOpen className="size-4" />
      ) : (
        <PanelLeftClose className="size-4" />
      )}
    </button>
  );

  return (
    <>
      {onMac && (
        <div className="fixed left-20 top-0 z-50 hidden h-12 items-center md:flex [app-region:no-drag] [-webkit-app-region:no-drag]">
          {collapseToggle}
        </div>
      )}
      <aside
        id="app-sidebar"
        className={cn(
          'fixed left-0 top-0 z-50 flex h-[100dvh] w-[min(20rem,calc(100vw-2rem))] flex-col border-r border-border/35 bg-background shadow-2xl transition-[transform,width] duration-200 ease-out motion-reduce:transition-none md:z-40 md:h-screen md:translate-x-0 md:shadow-none',
          collapsed ? 'md:w-16' : 'md:w-56',
          isMobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        style={isMobileOpen ? { transform: 'translateX(0)' } : undefined}
        aria-label={t('layout.aria.main_navigation')}
      >
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, react-doctor/no-static-element-interactions -- Tauri drag region, not a keyboard-navigable element */}
        <div
          data-tauri-drag-region
          className={cn(
            'flex h-12 select-none items-center justify-between border-b border-border/25 px-4',
            collapsed && 'md:justify-center md:px-0',
          )}
          onMouseDown={handleSidebarDragMouseDown}
        >
          <span
            className={cn(
              'text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground',
              onMac && 'md:hidden',
              collapsed && 'md:hidden',
            )}
          >
            TIMEFLOW
          </span>
          <div className="flex items-center gap-1">
            {!onMac && collapseToggle}
            <button
              type="button"
              aria-label={t('layout.aria.close_navigation')}
              onClick={onClose}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground md:hidden"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <SidebarNav
          collapsed={collapsed}
          currentPage={controller.currentPage}
          goToPage={controller.goToPage}
          sessionsAttentionTitle={controller.sessionsAttentionTitle}
          sessionsBadge={controller.sessionsBadge}
          unassignedSessions={controller.unassignedSessions}
        />

        <SidebarStatusPanel collapsed={collapsed} {...controller} />

        <BugHunter
          isOpen={controller.isBugHunterOpen}
          onClose={() => controller.setIsBugHunterOpen(false)}
          version={controller.status?.dashboard_version || '?.?.?'}
        />
      </aside>
    </>
  );
}
