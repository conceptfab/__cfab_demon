import { Component, lazy, Suspense } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import i18n from '@/i18n';
import { MainLayout } from '@/components/layout/MainLayout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToastProvider } from '@/components/ui/toast-notification';
import { useUIStore } from '@/store/ui-store';
import { Dashboard } from '@/pages/Dashboard';
import { BackgroundServices } from '@/components/sync/BackgroundServices';

const Projects = lazy(() =>
  import('@/pages/Projects').then((m) => ({ default: m.Projects })),
);
const Estimates = lazy(() =>
  import('@/pages/Estimates').then((m) => ({ default: m.Estimates })),
);
const Applications = lazy(() =>
  import('@/pages/Applications').then((m) => ({ default: m.Applications })),
);
const TimeAnalysis = lazy(() =>
  import('@/pages/TimeAnalysis').then((m) => ({ default: m.TimeAnalysis })),
);
const Sessions = lazy(() =>
  import('@/pages/Sessions').then((m) => ({ default: m.Sessions })),
);
const ImportPage = lazy(() =>
  import('@/pages/ImportPage').then((m) => ({ default: m.ImportPage })),
);
const Settings = lazy(() =>
  import('@/pages/Settings').then((m) => ({ default: m.Settings })),
);
const DaemonControl = lazy(() =>
  import('@/pages/DaemonControl').then((m) => ({ default: m.DaemonControl })),
);
const DataManagement = lazy(() =>
  import('@/pages/Data').then((m) => ({ default: m.DataManagement })),
);
const AIPage = lazy(() =>
  import('@/pages/AI').then((m) => ({ default: m.AIPage })),
);
const QuickStart = lazy(() =>
  import('@/pages/QuickStart').then((m) => ({ default: m.QuickStart })),
);
const Help = lazy(() =>
  import('@/pages/Help').then((m) => ({ default: m.Help })),
);
const ProjectPage = lazy(() =>
  import('@/pages/ProjectPage').then((m) => ({ default: m.ProjectPage })),
);

function PageRouter() {
  const currentPage = useUIStore((s) => s.currentPage);

  const page = (() => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard />;
      case 'projects':
        return <Projects />;
      case 'estimates':
        return <Estimates />;
      case 'applications':
        return <Applications />;
      case 'analysis':
        return <TimeAnalysis />;
      case 'sessions':
        return <Sessions />;
      case 'import':
        return <ImportPage />;
      case 'data':
        return <DataManagement />;
      case 'ai':
        return <AIPage />;
      case 'daemon':
        return <DaemonControl />;
      case 'settings':
        return <Settings />;
      case 'help':
        return <Help />;
      case 'quickstart':
        return <QuickStart />;
      case 'project-card':
        return <ProjectPage />;
      default:
        return <Dashboard />;
    }
  })();

  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          {i18n.t('ui.app.loading')}
        </div>
      }
    >
      {page}
    </Suspense>
  );
}

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-200">
          <div className="max-w-md space-y-4 text-center">
            <h1 className="text-xl font-semibold">{i18n.t('ui.app.error_title')}</h1>
            <p className="text-sm text-slate-400">{this.state.error.message}</p>
            <button
              className="rounded bg-sky-600 px-4 py-2 text-sm hover:bg-sky-500"
              onClick={() => this.setState({ error: null })}
            >
              {i18n.t('ui.app.try_again')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <TooltipProvider>
          <BackgroundServices />
          <MainLayout>
            <PageRouter />
          </MainLayout>
        </TooltipProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
