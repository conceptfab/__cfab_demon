import { useMemo } from 'react';

import { StatusBadge } from '@/components/ui/status-badge';
import type { PmProject } from '@/lib/pm-types';

interface PmProjectsStatusBarProps {
  projects: PmProject[];
  clientGroupOf: (raw: string) => string;
  t: (k: string) => string;
}

export function PmProjectsStatusBar({
  projects,
  clientGroupOf,
  t,
}: PmProjectsStatusBarProps) {
  const stats = useMemo(() => {
    const clients = new Set(projects.map((p) => clientGroupOf(p.prj_client)));
    const years = new Set(projects.map((p) => p.prj_year));
    const byStatus: Record<string, number> = {};
    let budgetSum = 0;
    for (const p of projects) {
      byStatus[p.prj_status] = (byStatus[p.prj_status] || 0) + 1;
      const b = parseFloat(p.prj_budget);
      if (!isNaN(b)) budgetSum += b;
    }
    return {
      count: projects.length,
      clients: clients.size,
      years: years.size,
      byStatus,
      budgetSum,
    };
  }, [clientGroupOf, projects]);

  if (stats.count === 0) return null;

  return (
    <div className="flex items-center gap-3 rounded-md border border-border/50 bg-muted/20 px-3 py-1.5 text-[10px] text-muted-foreground flex-wrap">
      <span>
        <span className="font-medium text-foreground/80">{stats.count}</span>{' '}
        {t('pm.statusbar.projects')}
      </span>
      <span className="text-border">|</span>
      <span>
        <span className="font-medium text-foreground/80">{stats.clients}</span>{' '}
        {t('pm.statusbar.clients')}
      </span>
      <span className="text-border">|</span>
      <span>
        <span className="font-medium text-foreground/80">{stats.years}</span>{' '}
        {stats.years === 1
          ? t('pm.statusbar.year_one')
          : stats.years < 5
            ? t('pm.statusbar.years_few')
            : t('pm.statusbar.years')}
      </span>
      <span className="text-border">|</span>
      {Object.entries(stats.byStatus).map(([status, count]) => (
        <span key={status} className="flex items-center gap-1">
          <StatusBadge status={status} className="text-[9px] px-1 py-0">
            {t(`pm.status.${status}`)}
          </StatusBadge>
          <span className="font-medium text-foreground/80">{count}</span>
        </span>
      ))}
      {stats.budgetSum > 0 && (
        <>
          <span className="text-border">|</span>
          <span>
            {t('pm.statusbar.budget_sum')}:{' '}
            <span className="font-medium font-mono text-foreground/80">
              {stats.budgetSum.toLocaleString()}
            </span>
          </span>
        </>
      )}
    </div>
  );
}
