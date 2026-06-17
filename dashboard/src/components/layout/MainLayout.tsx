import { useCallback, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '@/store/ui-store';
import { cn } from '@/lib/utils';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { ProjectContextMenu } from '@/components/project/ProjectContextMenu';

export function MainLayout({
  children,
  showChrome = true,
}: {
  children: ReactNode;
  showChrome?: boolean;
}) {
  const { t } = useTranslation();
  const currentPage = useUIStore((state) => state.currentPage);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const previousPageRef = useRef(currentPage);

  const closeMobileNav = useCallback(() => {
    setIsMobileNavOpen(false);
  }, []);

  const handleEscapeClose = useEffectEvent(() => {
    closeMobileNav();
  });

  useEffect(() => {
    if (previousPageRef.current === currentPage) {
      return;
    }
    previousPageRef.current = currentPage;
    mainRef.current?.focus();
  }, [currentPage]);

  useEffect(() => {
    if (!isMobileNavOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleEscapeClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileNavOpen]);

  if (!showChrome) {
    return (
      <div className="h-screen overflow-hidden bg-background">
        <main
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          className="h-full overflow-y-auto"
        >
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only absolute left-3 top-3 z-[100] rounded-md bg-background px-3 py-2 text-xs text-foreground shadow focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {t('ui.a11y.skip_to_content')}
      </a>
      <Sidebar
        isMobileOpen={isMobileNavOpen}
        onClose={closeMobileNav}
        onNavigate={closeMobileNav}
      />
      <button
        type="button"
        aria-label={t('layout.aria.close_navigation')}
        onClick={closeMobileNav}
        className={cn(
          'fixed inset-0 z-40 bg-black/60 transition-opacity md:hidden',
          isMobileNavOpen
            ? 'opacity-100'
            : 'pointer-events-none opacity-0',
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col md:ml-56">
        <TopBar
          mobileMenuOpen={isMobileNavOpen}
          onMenuClick={() => setIsMobileNavOpen((open) => !open)}
        />
        <main
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          className="box-border flex-1 overflow-y-auto p-2 [scrollbar-gutter:stable] sm:p-4 md:p-5"
        >
          {children}
        </main>
      </div>
      <ProjectContextMenu />
    </div>
  );
}
