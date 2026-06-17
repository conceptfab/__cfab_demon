import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Filter,
  Save,
  Search,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { AppTooltip } from '@/components/ui/app-tooltip';
import { PM_SORT_FIELDS } from '@/lib/pm-projects-list-utils';
import type { PmProjectsListController } from '@/hooks/usePmProjectsListController';
import type { PmSortField } from '@/lib/pm-types';

type PmProjectsToolbarProps = Pick<
  PmProjectsListController,
  | 'clearFilters'
  | 'filterClient'
  | 'filterStatus'
  | 'filterYear'
  | 'handleSaveView'
  | 'hasAnyFilter'
  | 'search'
  | 'setFilterClient'
  | 'setFilterStatus'
  | 'setFilterYear'
  | 'setSearch'
  | 'setSortField'
  | 'sortDir'
  | 'sortField'
  | 't'
  | 'toggleSortDir'
  | 'uniqueClients'
  | 'uniqueStatuses'
  | 'uniqueYears'
>;

export function PmProjectsToolbar({
  clearFilters,
  filterClient,
  filterStatus,
  filterYear,
  handleSaveView,
  hasAnyFilter,
  search,
  setFilterClient,
  setFilterStatus,
  setFilterYear,
  setSearch,
  setSortField,
  sortDir,
  sortField,
  t,
  toggleSortDir,
  uniqueClients,
  uniqueStatuses,
  uniqueYears,
}: PmProjectsToolbarProps) {
  const selectClass =
    'h-8 w-full min-w-0 rounded-md border border-border bg-background px-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary sm:h-7 sm:w-auto';
  const SortIcon = sortField
    ? sortDir === 'asc'
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  return (
    <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative w-full sm:w-auto">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <input
          className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-[11px] placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary sm:h-7 sm:w-48"
          placeholder={t('pm.filter.search_placeholder')}
          aria-label={t('pm.filter.search_placeholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="hidden h-4 w-px bg-border/50 sm:block" />

      <div className="grid w-full grid-cols-2 gap-2 pb-1 sm:flex sm:max-w-full sm:items-center sm:overflow-visible sm:pb-0">
        <Filter className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" />

        <select
          className={selectClass}
          value={filterYear}
          aria-label={t('pm.filter.all_years')}
          onChange={(e) => setFilterYear(e.target.value)}
        >
          <option value="">{t('pm.filter.all_years')}</option>
          {uniqueYears.map((y) => (
            <option key={y} value={y}>
              20{y}
            </option>
          ))}
        </select>

        <select
          className={selectClass}
          value={filterClient}
          aria-label={t('pm.filter.all_clients')}
          onChange={(e) => setFilterClient(e.target.value)}
        >
          <option value="">{t('pm.filter.all_clients')}</option>
          {uniqueClients.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          className={selectClass}
          value={filterStatus}
          aria-label={t('pm.filter.all_statuses')}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">{t('pm.filter.all_statuses')}</option>
          {uniqueStatuses.map((s) => (
            <option key={s} value={s}>
              {t(`pm.status.${s}`, s)}
            </option>
          ))}
        </select>

        <div className="col-span-2 flex items-center gap-1 sm:col-span-1 sm:ml-auto">
          <select
            className={selectClass}
            value={sortField}
            aria-label={t('accessibility.sort_field')}
            onChange={(e) => setSortField(e.target.value as PmSortField)}
          >
            {PM_SORT_FIELDS.map((f) => (
              <option key={f.key} value={f.key}>
                {t(f.labelKey)}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="sm"
            className="size-8 shrink-0 p-0 sm:size-7"
            onClick={toggleSortDir}
          >
            <SortIcon className="size-4 sm:size-3.5" />
          </Button>
        </div>
      </div>

      {hasAnyFilter && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-[11px] text-muted-foreground sm:h-7"
          onClick={clearFilters}
        >
          <X className="mr-1 size-3" />
          {t('pm.filter.clear')}
        </Button>
      )}

      <AppTooltip content={t('pm.save_view_as_default')}>
        <Button
          variant="ghost"
          size="sm"
          className="size-8 p-0 sm:size-7"
          aria-label={t('pm.save_view_as_default')}
          onClick={handleSaveView}
        >
          <Save className="size-4 sm:size-3.5" />
        </Button>
      </AppTooltip>
    </div>
  );
}
