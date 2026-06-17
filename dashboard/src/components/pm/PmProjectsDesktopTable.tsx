import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Euro,
  LayoutDashboard,
  Monitor,
  Pencil,
  Trophy,
} from 'lucide-react';

import { StatusBadge } from '@/components/ui/status-badge';
import {
  derivePmProjectName,
  formatPmDuration,
  formatPmValue,
} from '@/lib/pm-projects-list-utils';
import type { PmProjectsListController } from '@/hooks/usePmProjectsListController';
import type { PmSortField } from '@/lib/pm-types';

type PmProjectsDesktopTableProps = Pick<
  PmProjectsListController,
  | 'clientColors'
  | 'clientGroupOf'
  | 'displayed'
  | 'handleHeaderClick'
  | 'onOpenProjectCard'
  | 'onSelect'
  | 'originalIndices'
  | 'sortDir'
  | 'sortField'
  | 't'
  | 'tfMatches'
>;

export function PmProjectsDesktopTable({
  clientColors,
  clientGroupOf,
  displayed,
  handleHeaderClick,
  onOpenProjectCard,
  onSelect,
  originalIndices,
  sortDir,
  sortField,
  t,
  tfMatches,
}: PmProjectsDesktopTableProps) {
  const SortIcon = sortField
    ? sortDir === 'asc'
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  return (
    <div className="hidden min-h-0 flex-1 overflow-auto rounded-md border border-border md:block">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground">
            <th className="pl-3 pr-3 py-2 font-medium">
              <button
                type="button"
                aria-label={t('accessibility.sort_column', { column: '#' })}
                className="flex cursor-pointer select-none items-center gap-1 hover:text-foreground transition-colors"
                onClick={() => handleHeaderClick('global')}
              >
                #
                {sortField === 'global' && (
                  <SortIcon className="size-3 text-primary" />
                )}
              </button>
            </th>
            <th className="py-2 font-medium whitespace-nowrap">
              <button
                type="button"
                aria-label={t('accessibility.sort_column', {
                  column: `${t('pm.columns.number')}/${t('pm.columns.year')}`,
                })}
                className="flex cursor-pointer select-none items-center gap-1 hover:text-foreground transition-colors"
                onClick={() => handleHeaderClick('number')}
              >
                {t('pm.columns.number')}/{t('pm.columns.year')}
                {(sortField === 'number' || sortField === 'year') && (
                  <SortIcon className="size-3 text-primary" />
                )}
              </button>
            </th>
            {(
              [
                { field: 'client' as PmSortField, key: 'pm.columns.client' },
                { field: 'name' as PmSortField, key: 'pm.columns.name' },
              ] as const
            ).map((col) => (
              <th key={col.field} className="px-3 py-2 font-medium">
                <button
                  type="button"
                  aria-label={t('accessibility.sort_column', {
                    column: t(col.key),
                  })}
                  className="flex cursor-pointer select-none items-center gap-1 hover:text-foreground transition-colors"
                  onClick={() => handleHeaderClick(col.field)}
                >
                  {t(col.key)}
                  {sortField === col.field && (
                    <SortIcon className="size-3 text-primary" />
                  )}
                </button>
              </th>
            ))}
            <th
              className="px-1 py-2 font-medium w-6"
              aria-label={t('accessibility.status_indicator_column')}
            />
            <th className="px-3 py-2 font-medium">
              <button
                type="button"
                aria-label={t('accessibility.sort_column', {
                  column: t('pm.columns.status'),
                })}
                className="flex cursor-pointer select-none items-center gap-1 hover:text-foreground transition-colors"
                onClick={() => handleHeaderClick('status')}
              >
                {t('pm.columns.status')}
                {sortField === 'status' && (
                  <SortIcon className="size-3 text-primary" />
                )}
              </button>
            </th>
            <th className="px-3 py-2 font-medium text-right">
              {t('pm.columns.time')}
            </th>
            <th className="px-3 py-2 font-medium text-right">
              {t('pm.columns.value')}
            </th>
            <th className="px-1 py-2 font-medium w-6" aria-label="TIMEFLOW" />
            <th
              className="px-1 py-2 font-medium w-6"
              aria-label={t('accessibility.actions_column')}
            />
          </tr>
        </thead>
        <tbody>
          {displayed.map((p, di) => {
            const group = clientGroupOf(p.prj_client);
            const match = tfMatches[p.prj_code];
            return (
              <tr
                key={`${p.prj_code}-${originalIndices[di]}`}
                className="border-b border-border/50 transition-colors hover:bg-accent/30"
              >
                <td className="pl-3 pr-3 py-2 font-mono text-xs text-muted-foreground">
                  {originalIndices[di] + 1}
                </td>
                <td className="py-2 font-mono text-xs">
                  {p.prj_number}/20{p.prj_year}
                </td>
                <td
                  className="px-3 py-2 font-medium"
                  style={{
                    color: clientColors[group]?.color || undefined,
                  }}
                >
                  {group}
                </td>
                <td className="px-3 py-2">
                  {p.prj_name || derivePmProjectName(p.prj_client, group)}
                </td>
                <td className="px-1 py-2 text-center">
                  {match?.tfProjectId != null && (
                    <button
                      type="button"
                      className="opacity-30 hover:opacity-100 transition-opacity cursor-pointer"
                      onClick={() => onOpenProjectCard(match.tfProjectId!)}
                      title={t('pm.open_project_card')}
                    >
                      <LayoutDashboard className="size-3.5" />
                    </button>
                  )}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={p.prj_status}>
                    {t(`pm.status.${p.prj_status}`, p.prj_status)}
                  </StatusBadge>
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {formatPmDuration(match?.totalSeconds || 0)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  <span className="inline-flex items-center gap-1">
                    {formatPmValue(match?.estimatedValue || 0)}
                    {match?.hasRate && (
                      <Euro className="size-3 text-green-500/70" />
                    )}
                    {match?.isHot && (
                      <Trophy className="size-3 text-amber-500 fill-amber-500/20" />
                    )}
                  </span>
                </td>
                <td className="px-1 py-2 text-center">
                  {p.prj_status !== 'archived' && (
                    <Monitor className="size-3.5 text-primary/40" />
                  )}
                </td>
                <td className="px-1 py-2 text-center">
                  <button
                    type="button"
                    className="opacity-30 hover:opacity-100 transition-opacity cursor-pointer"
                    onClick={() => onSelect(originalIndices[di])}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
          {displayed.length === 0 && (
            <tr>
              <td
                colSpan={9}
                className="px-3 py-8 text-center text-xs text-muted-foreground"
              >
                {t('pm.filter.no_results')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
