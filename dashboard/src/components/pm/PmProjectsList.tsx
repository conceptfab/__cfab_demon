import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpDown, ArrowUp, ArrowDown, Filter, X, Search, Monitor, Trophy, Euro, Pencil, LayoutDashboard } from 'lucide-react';
import type { PmProject, PmSortField, PmClientColors } from '@/lib/pm-types';
import type { PmTfMatch } from '@/pages/PM';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { usePersistedState } from '@/hooks/usePersistedState';

interface PmProjectsListProps {
  projects: PmProject[];
  clientColors: PmClientColors;
  tfMatches: Record<string, PmTfMatch>;
  onSelect: (index: number) => void;
  onOpenProjectCard: (tfProjectId: number) => void;
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '—';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatValue(value: number): string {
  if (value <= 0) return '—';
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusColor(status: string): string {
  switch (status) {
    case 'active':
      return 'bg-green-500/15 text-green-400 border-green-500/30';
    case 'frozen':
      return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    case 'excluded':
      return 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30';
    case 'archived':
      return 'bg-muted text-muted-foreground border-border';
    default:
      return '';
  }
}

type SortDir = 'asc' | 'desc';

const SORT_FIELDS: { key: PmSortField; labelKey: string }[] = [
  { key: 'number', labelKey: 'pm.columns.number' },
  { key: 'year', labelKey: 'pm.columns.year' },
  { key: 'client', labelKey: 'pm.columns.client' },
  { key: 'name', labelKey: 'pm.columns.name' },
  { key: 'status', labelKey: 'pm.columns.status' },
];

/** When prj_name is empty, extract name from raw client suffix (e.g. "Metro_packshots" → "packshots") */
function deriveName(rawClient: string, group: string): string {
  const upper = rawClient.toUpperCase();
  if (upper === group) return '';
  if (upper.startsWith(group + '_')) {
    return rawClient.slice(group.length + 1);
  }
  return '';
}

function sortProjects(list: PmProject[], allProjects: PmProject[], field: PmSortField, dir: SortDir): PmProject[] {
  if (field === 'global') {
    const sorted = [...list];
    const mul = dir === 'asc' ? 1 : -1;
    sorted.sort((a, b) => (allProjects.indexOf(a) - allProjects.indexOf(b)) * mul);
    return sorted;
  }
  const sorted = [...list];
  const mul = dir === 'asc' ? 1 : -1;
  sorted.sort((a, b) => {
    let va: string, vb: string;
    switch (field) {
      case 'number': va = a.prj_number; vb = b.prj_number; break;
      case 'year': va = a.prj_year; vb = b.prj_year; break;
      case 'client': va = a.prj_client; vb = b.prj_client; break;
      case 'name': va = a.prj_name; vb = b.prj_name; break;
      case 'status': va = a.prj_status; vb = b.prj_status; break;
      default: va = a.prj_number; vb = b.prj_number;
    }
    return va.localeCompare(vb, undefined, { numeric: true }) * mul;
  });
  return sorted;
}

const STORAGE_KEY_YEAR = 'timeflow-pm-filter-year';
const STORAGE_KEY_CLIENT = 'timeflow-pm-filter-client';
const STORAGE_KEY_STATUS = 'timeflow-pm-filter-status';
const STORAGE_KEY_SORT_FIELD = 'timeflow-pm-sort-field';
const STORAGE_KEY_SORT_DIR = 'timeflow-pm-sort-dir';

export function PmProjectsList({ projects, clientColors, tfMatches, onSelect, onOpenProjectCard }: PmProjectsListProps) {
  const { t } = useTranslation();

  // Search
  const [search, setSearch] = useState('');

  // Filters
  const [filterYear, setFilterYear] = usePersistedState(STORAGE_KEY_YEAR, '');
  const [filterClient, setFilterClient] = usePersistedState(STORAGE_KEY_CLIENT, '');
  const [filterStatus, setFilterStatus] = usePersistedState(STORAGE_KEY_STATUS, '');

  // Sort
  const [sortField, setSortField] = usePersistedState<PmSortField>(
    STORAGE_KEY_SORT_FIELD,
    'number',
  );
  const [sortDir, setSortDir] = usePersistedState<SortDir>(
    STORAGE_KEY_SORT_DIR,
    'desc',
  );

  // Extract unique values for filters
  const uniqueYears = useMemo(() =>
    [...new Set(projects.map((p) => p.prj_year))].sort((a, b) => b.localeCompare(a)),
    [projects],
  );
  const { uniqueClients, clientGroupOf } = useMemo(() => {
    // Collect all raw client names (uppercased)
    const rawSet = new Set<string>();
    for (const p of projects) rawSet.add(p.prj_client.toUpperCase());
    const rawList = [...rawSet];

    // Group: if BASE exists as standalone and BASE_xxx also exists, merge into BASE
    // e.g. YOPE, YOPE_Intymna_2022 → group "YOPE"
    const groupMap = new Map<string, string>(); // raw -> group label
    for (const name of rawList) {
      const underIdx = name.indexOf('_');
      if (underIdx > 0) {
        const base = name.slice(0, underIdx);
        if (rawSet.has(base)) {
          groupMap.set(name, base);
          continue;
        }
      }
      groupMap.set(name, name);
    }
    const groups = [...new Set(groupMap.values())].sort((a, b) => a.localeCompare(b));
    return {
      uniqueClients: groups,
      clientGroupOf: (raw: string) => groupMap.get(raw.toUpperCase()) || raw.toUpperCase(),
    };
  }, [projects]);
  const uniqueStatuses = useMemo(() =>
    [...new Set(projects.map((p) => p.prj_status))].sort(),
    [projects],
  );

  // Apply filters + sort
  const displayed = useMemo(() => {
    let list = projects;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) =>
        p.prj_client.toLowerCase().includes(q) ||
        p.prj_name.toLowerCase().includes(q) ||
        p.prj_desc.toLowerCase().includes(q) ||
        p.prj_full_name.toLowerCase().includes(q) ||
        p.prj_code.includes(q),
      );
    }
    if (filterYear) list = list.filter((p) => p.prj_year === filterYear);
    if (filterClient) list = list.filter((p) => clientGroupOf(p.prj_client) === filterClient);
    if (filterStatus) list = list.filter((p) => p.prj_status === filterStatus);
    return sortProjects(list, projects, sortField, sortDir);
  }, [projects, search, filterYear, filterClient, filterStatus, sortField, sortDir, clientGroupOf]);

  const hasAnyFilter = filterYear || filterClient || filterStatus || search;

  // Build original-index map so onSelect still references the right project
  const originalIndices = useMemo(() => {
    return displayed.map((dp) => projects.indexOf(dp));
  }, [displayed, projects]);

  const toggleSortDir = () => setSortDir(sortDir === 'asc' ? 'desc' : 'asc');

  const handleHeaderClick = (field: PmSortField) => {
    if (sortField === field) {
      toggleSortDir();
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const clearFilters = () => {
    setSearch('');
    setFilterYear('');
    setFilterClient('');
    setFilterStatus('');
  };

  const selectClass = 'h-7 rounded-md border border-border bg-background px-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary';

  const SortIcon = sortField ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;

  if (projects.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground text-sm">
        {t('pm.empty')}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Search + Filter toolbar — fixed */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            className="h-7 w-48 rounded-md border border-border bg-background pl-7 pr-2 text-[11px] placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder={t('pm.filter.search_placeholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="h-4 w-px bg-border/50" />

        <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

        {/* Year filter */}
        <select className={selectClass} value={filterYear} onChange={(e) => setFilterYear(e.target.value)}>
          <option value="">{t('pm.filter.all_years')}</option>
          {uniqueYears.map((y) => <option key={y} value={y}>20{y}</option>)}
        </select>

        {/* Client filter */}
        <select className={selectClass} value={filterClient} onChange={(e) => setFilterClient(e.target.value)}>
          <option value="">{t('pm.filter.all_clients')}</option>
          {uniqueClients.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        {/* Status filter */}
        <select className={selectClass} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">{t('pm.filter.all_statuses')}</option>
          {uniqueStatuses.map((s) => <option key={s} value={s}>{t(`pm.status.${s}`, s)}</option>)}
        </select>

        {/* Sort field */}
        <div className="ml-auto flex items-center gap-1">
          <select
            className={selectClass}
            value={sortField}
            onChange={(e) => setSortField(e.target.value as PmSortField)}
          >
            {SORT_FIELDS.map((f) => (
              <option key={f.key} value={f.key}>{t(f.labelKey)}</option>
            ))}
          </select>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={toggleSortDir}>
            <SortIcon className="h-3.5 w-3.5" />
          </Button>
        </div>

        {hasAnyFilter && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-muted-foreground" onClick={clearFilters}>
            <X className="mr-1 h-3 w-3" />
            {t('pm.filter.clear')}
          </Button>
        )}
      </div>

      {/* Count */}
      {hasAnyFilter && (
        <p className="text-[10px] text-muted-foreground shrink-0">
          {t('pm.filter.showing')}: {displayed.length} / {projects.length}
        </p>
      )}

      {/* Table — scrollable */}
      <div className="overflow-auto rounded-md border border-border min-h-0 flex-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground">
              <th
                className="pl-3 pr-3 py-2 font-medium cursor-pointer select-none hover:text-foreground transition-colors"
                onClick={() => handleHeaderClick('global')}
              >
                <span className="flex items-center gap-1">
                  #
                  {sortField === 'global' && (
                    <SortIcon className="h-3 w-3 text-primary" />
                  )}
                </span>
              </th>
              <th
                className="py-2 font-medium cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap"
                onClick={() => handleHeaderClick('number')}
              >
                <span className="flex items-center gap-1">
                  {t('pm.columns.number')}/{t('pm.columns.year')}
                  {(sortField === 'number' || sortField === 'year') && (
                    <SortIcon className="h-3 w-3 text-primary" />
                  )}
                </span>
              </th>
              {([
                { field: 'client' as PmSortField, key: 'pm.columns.client' },
                { field: 'name' as PmSortField, key: 'pm.columns.name' },
              ]).map((col) => (
                <th
                  key={col.field}
                  className="px-3 py-2 font-medium cursor-pointer select-none hover:text-foreground transition-colors"
                  onClick={() => handleHeaderClick(col.field)}
                >
                  <span className="flex items-center gap-1">
                    {t(col.key)}
                    {sortField === col.field && (
                      <SortIcon className="h-3 w-3 text-primary" />
                    )}
                  </span>
                </th>
              ))}
              <th className="px-1 py-2 font-medium w-6" />
              <th
                className="px-3 py-2 font-medium cursor-pointer select-none hover:text-foreground transition-colors"
                onClick={() => handleHeaderClick('status')}
              >
                <span className="flex items-center gap-1">
                  {t('pm.columns.status')}
                  {sortField === 'status' && <SortIcon className="h-3 w-3 text-primary" />}
                </span>
              </th>
              <th className="px-3 py-2 font-medium text-right">{t('pm.columns.time')}</th>
              <th className="px-3 py-2 font-medium text-right">{t('pm.columns.value')}</th>
              <th className="px-1 py-2 font-medium w-6" title="TIMEFLOW" />
              <th className="px-1 py-2 font-medium w-6" />
            </tr>
          </thead>
          <tbody>
            {displayed.map((p, di) => (
              <tr
                key={`${p.prj_code}-${originalIndices[di]}`}
                className="border-b border-border/50 transition-colors hover:bg-accent/30"
              >
                <td className="pl-3 pr-3 py-2 font-mono text-xs text-muted-foreground">{originalIndices[di] + 1}</td>
                <td className="py-2 font-mono text-xs">{p.prj_number}/20{p.prj_year}</td>
                <td className="px-3 py-2 font-medium" style={{ color: clientColors[clientGroupOf(p.prj_client)]?.color || undefined }}>{clientGroupOf(p.prj_client)}</td>
                <td className="px-3 py-2">{p.prj_name || deriveName(p.prj_client, clientGroupOf(p.prj_client))}</td>
                <td className="px-1 py-2 text-center">
                  {tfMatches[p.prj_code]?.tfProjectId != null && (
                    <button
                      className="opacity-30 hover:opacity-100 transition-opacity cursor-pointer"
                      onClick={() => onOpenProjectCard(tfMatches[p.prj_code].tfProjectId!)}
                      title={t('pm.open_project_card')}
                    >
                      <LayoutDashboard className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Badge variant="outline" className={cn('text-[10px]', statusColor(p.prj_status))}>
                    {t(`pm.status.${p.prj_status}`, p.prj_status)}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">{formatDuration(tfMatches[p.prj_code]?.totalSeconds || 0)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  <span className="inline-flex items-center gap-1">
                    {formatValue(tfMatches[p.prj_code]?.estimatedValue || 0)}
                    {tfMatches[p.prj_code]?.hasRate && <Euro className="h-3 w-3 text-green-500/70" />}
                    {tfMatches[p.prj_code]?.isHot && <Trophy className="h-3 w-3 text-amber-500 fill-amber-500/20" />}
                  </span>
                </td>
                <td className="px-1 py-2 text-center">
                  {p.prj_status !== 'archived' && (
                    <Monitor className="h-3.5 w-3.5 text-primary/40" />
                  )}
                </td>
                <td className="px-1 py-2 text-center">
                  <button
                    className="opacity-30 hover:opacity-100 transition-opacity cursor-pointer"
                    onClick={() => onSelect(originalIndices[di])}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {displayed.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-xs text-muted-foreground">
                  {t('pm.filter.no_results')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* Status bar */}
      <StatusBar projects={displayed} clientGroupOf={clientGroupOf} t={t} />
    </div>
  );
}

function StatusBar({ projects, clientGroupOf, t }: { projects: PmProject[]; clientGroupOf: (raw: string) => string; t: (k: string) => string }) {
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
    return { count: projects.length, clients: clients.size, years: years.size, byStatus, budgetSum };
  }, [clientGroupOf, projects]);

  if (stats.count === 0) return null;

  return (
    <div className="flex items-center gap-3 rounded-md border border-border/50 bg-muted/20 px-3 py-1.5 text-[10px] text-muted-foreground flex-wrap">
      <span>
        <span className="font-medium text-foreground/80">{stats.count}</span> {t('pm.statusbar.projects')}
      </span>
      <span className="text-border">|</span>
      <span>
        <span className="font-medium text-foreground/80">{stats.clients}</span> {t('pm.statusbar.clients')}
      </span>
      <span className="text-border">|</span>
      <span>
        <span className="font-medium text-foreground/80">{stats.years}</span> {stats.years === 1 ? t('pm.statusbar.year_one') : stats.years < 5 ? t('pm.statusbar.years_few') : t('pm.statusbar.years')}
      </span>
      <span className="text-border">|</span>
      {Object.entries(stats.byStatus).map(([status, count]) => (
        <span key={status} className="flex items-center gap-1">
          <Badge variant="outline" className={cn('text-[9px] px-1 py-0', statusColor(status))}>
            {t(`pm.status.${status}`)}
          </Badge>
          <span className="font-medium text-foreground/80">{count}</span>
        </span>
      ))}
      {stats.budgetSum > 0 && (
        <>
          <span className="text-border">|</span>
          <span>
            {t('pm.statusbar.budget_sum')}: <span className="font-medium font-mono text-foreground/80">{stats.budgetSum.toLocaleString()}</span>
          </span>
        </>
      )}
    </div>
  );
}
