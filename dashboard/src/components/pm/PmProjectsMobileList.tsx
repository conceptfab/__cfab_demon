import { Euro, LayoutDashboard, Pencil, Trophy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  derivePmProjectName,
  formatPmDuration,
  formatPmValue,
} from '@/lib/pm-projects-list-utils';
import type { PmProjectsListController } from '@/hooks/usePmProjectsListController';

type PmProjectsMobileListProps = Pick<
  PmProjectsListController,
  | 'clientColors'
  | 'clientGroupOf'
  | 'displayed'
  | 'onOpenProjectCard'
  | 'onSelect'
  | 'originalIndices'
  | 't'
  | 'tfMatches'
>;

export function PmProjectsMobileList({
  clientColors,
  clientGroupOf,
  displayed,
  onOpenProjectCard,
  onSelect,
  originalIndices,
  t,
  tfMatches,
}: PmProjectsMobileListProps) {
  return (
    <div className="space-y-2 overflow-y-auto rounded-md border border-border p-2 md:hidden">
      {displayed.map((p, di) => {
        const match = tfMatches[p.prj_code];
        const group = clientGroupOf(p.prj_client);
        // safe: originalIndices is parallel to displayed; di is always within bounds
        const originalIdx = originalIndices[di]!;
        return (
          <div
            key={`${p.prj_code}-${originalIdx}-mobile`}
            className="space-y-3 rounded-md border border-border/60 p-3"
          >
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-xs text-muted-foreground">
                  #{originalIdx + 1} · {p.prj_number}/20{p.prj_year}
                </p>
                <p
                  className="break-words text-sm font-medium"
                  style={{
                    color: clientColors[group]?.color || undefined,
                  }}
                >
                  {group}
                </p>
                <p className="break-words text-sm">
                  {p.prj_name || derivePmProjectName(p.prj_client, group)}
                </p>
              </div>
              <StatusBadge status={p.prj_status}>
                {t(`pm.status.${p.prj_status}`, p.prj_status)}
              </StatusBadge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-muted-foreground">{t('pm.columns.time')}</p>
                <p className="font-mono text-sm">
                  {formatPmDuration(match?.totalSeconds || 0)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">{t('pm.columns.value')}</p>
                <p className="inline-flex items-center gap-1 font-mono text-sm">
                  {formatPmValue(match?.estimatedValue || 0)}
                  {match?.hasRate && (
                    <Euro className="size-3 text-green-500/70" />
                  )}
                  {match?.isHot && (
                    <Trophy className="size-3 fill-amber-500/20 text-amber-500" />
                  )}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {match?.tfProjectId != null && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenProjectCard(match.tfProjectId!)}
                >
                  <LayoutDashboard className="mr-1.5 size-3.5" />
                  TIMEFLOW
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSelect(originalIdx)}
              >
                <Pencil className="mr-1.5 size-3.5" />
                {t('pm.edit')}
              </Button>
            </div>
          </div>
        );
      })}
      {displayed.length === 0 && (
        <div className="px-3 py-8 text-center text-xs text-muted-foreground">
          {t('pm.filter.no_results')}
        </div>
      )}
    </div>
  );
}
