import type { MouseEvent } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { BugHunter } from '@/components/layout/BugHunter';
import { SidebarNav } from '@/components/layout/SidebarNav';
import { SidebarStatusPanel } from '@/components/layout/SidebarStatusPanel';
import { useSidebarController } from '@/hooks/useSidebarController';
import { tryStartWindowDrag } from '@/lib/window-drag';
import { isMacOS } from '@/lib/platform';

function handleSidebarDragMouseDown(event: MouseEvent<HTMLDivElement>) {
  if (event.button !== 0) return;
  tryStartWindowDrag();
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

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-50 flex h-[100dvh] w-[min(20rem,calc(100vw-2rem))] flex-col border-r border-border/35 bg-background shadow-2xl transition-transform duration-200 ease-out md:z-40 md:h-screen md:w-56 md:translate-x-0 md:shadow-none',
        isMobileOpen ? 'translate-x-0' : '-translate-x-full',
      )}
      style={isMobileOpen ? { transform: 'translateX(0)' } : undefined}
      aria-label={t('layout.aria.main_navigation')}
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, react-doctor/no-static-element-interactions -- Tauri drag region, not a keyboard-navigable element */}
      <div
        data-tauri-drag-region
        className="flex h-12 select-none items-center justify-between border-b border-border/25 px-4"
        onMouseDown={handleSidebarDragMouseDown}
      >
        <span
          className={cn(
            'text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground',
            isMacOS() && 'md:hidden',
          )}
        >
          TIMEFLOW
        </span>
        <button
          type="button"
          aria-label={t('layout.aria.close_navigation')}
          onClick={onClose}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground md:hidden"
        >
          <X className="size-4" />
        </button>
      </div>

      <SidebarNav
        currentPage={controller.currentPage}
        goToPage={controller.goToPage}
        sessionsAttentionTitle={controller.sessionsAttentionTitle}
        sessionsBadge={controller.sessionsBadge}
        unassignedSessions={controller.unassignedSessions}
      />

      <SidebarStatusPanel {...controller} />

      <BugHunter
        isOpen={controller.isBugHunterOpen}
        onClose={() => controller.setIsBugHunterOpen(false)}
        version={controller.status?.dashboard_version || '?.?.?'}
      />
    </aside>
  );
}
