import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
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

  if (!showChrome) {
    return (
      <div className="h-screen overflow-hidden bg-background">
        <main id="main-content" tabIndex={-1} className="h-full overflow-y-auto">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only absolute left-3 top-3 z-[100] rounded-md bg-background px-3 py-2 text-xs text-foreground shadow focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {t('ui.a11y.skip_to_content')}
      </a>
      <Sidebar />
      <div className="ml-56 flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-y-auto p-4 md:p-5"
        >
          {children}
        </main>
      </div>
      <ProjectContextMenu />
    </div>
  );
}
