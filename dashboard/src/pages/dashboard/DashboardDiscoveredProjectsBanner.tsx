import { useTranslation } from 'react-i18next';
import { FolderOpen } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { useDataStore } from '@/store/data-store';
import { useUIStore } from '@/store/ui-store';

export function DashboardDiscoveredProjectsBanner() {
  const { t } = useTranslation();
  const { projects, dismissed } = useDataStore((s) => s.discoveredProjects);
  const dismiss = useDataStore((s) => s.dismissDiscoveredProjects);
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);

  if (dismissed || projects.length === 0) return null;
  const previewProjects = projects.slice(0, 5).join(', ');
  const extraProjectsCount = projects.length - 5;

  return (
    <Card className="border-sky-500/30 bg-sky-500/5">
      <CardContent className="flex items-center gap-2.5 p-3">
        <FolderOpen className="size-4 text-sky-400 shrink-0" />
        <span className="text-xs text-sky-300">
          {t('dashboard.discovered_projects.summary', {
            count: projects.length,
          })}
          {': '}
          <span className="font-medium">{previewProjects}</span>
          {extraProjectsCount > 0 && ` (+${extraProjectsCount})`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="text-[10px] text-sky-400 hover:text-sky-300 underline"
            onClick={() => setCurrentPage('projects')}
          >
            {t('dashboard.discovered_projects.view')}
          </button>
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:text-foreground"
            onClick={dismiss}
          >
            ✕
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
