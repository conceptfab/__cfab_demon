import type { PmProject, PmSortField } from '@/lib/pm-types';
import { formatDecimal } from '@/lib/utils';

export type PmSortDir = 'asc' | 'desc';

export const PM_SORT_FIELDS: { key: PmSortField; labelKey: string }[] = [
  { key: 'number', labelKey: 'pm.columns.number' },
  { key: 'year', labelKey: 'pm.columns.year' },
  { key: 'client', labelKey: 'pm.columns.client' },
  { key: 'name', labelKey: 'pm.columns.name' },
  { key: 'status', labelKey: 'pm.columns.status' },
];

export function formatPmDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '—';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatPmValue(value: number): string {
  if (value <= 0) return '—';
  return formatDecimal(value);
}

/** When prj_name is empty, extract name from raw client suffix (e.g. "Metro_packshots" → "packshots") */
export function derivePmProjectName(rawClient: string, group: string): string {
  const upper = rawClient.toUpperCase();
  if (upper === group) return '';
  if (upper.startsWith(group + '_')) {
    return rawClient.slice(group.length + 1);
  }
  return '';
}

/**
 * O(1) reference→index lookup for a project list. Keyed by object identity, so
 * for distinct references it matches `Array.prototype.indexOf` semantics — no
 * prj_code uniqueness assumption. (If the same reference appeared twice the map
 * would hold its last index, unlike indexOf's first; the data layer guarantees
 * distinct references.) Build once, reuse instead of repeated `indexOf` scans.
 */
export function buildProjectIndexMap(
  projects: PmProject[],
): Map<PmProject, number> {
  const map = new Map<PmProject, number>();
  for (let i = 0; i < projects.length; i++) {
    // safe: loop is within [0, projects.length)
    map.set(projects[i]!, i);
  }
  return map;
}

export function sortPmProjects(
  list: PmProject[],
  allProjects: PmProject[],
  field: PmSortField,
  dir: PmSortDir,
): PmProject[] {
  if (field === 'global') {
    const indexMap = buildProjectIndexMap(allProjects);
    const sorted = [...list];
    const mul = dir === 'asc' ? 1 : -1;
    sorted.sort(
      (a, b) => ((indexMap.get(a) ?? -1) - (indexMap.get(b) ?? -1)) * mul,
    );
    return sorted;
  }
  const sorted = [...list];
  const mul = dir === 'asc' ? 1 : -1;
  sorted.sort((a, b) => {
    let va: string;
    let vb: string;
    switch (field) {
      case 'number':
        va = a.prj_number;
        vb = b.prj_number;
        break;
      case 'year':
        va = a.prj_year;
        vb = b.prj_year;
        break;
      case 'client':
        va = a.prj_client;
        vb = b.prj_client;
        break;
      case 'name':
        va = a.prj_name;
        vb = b.prj_name;
        break;
      case 'status':
        va = a.prj_status;
        vb = b.prj_status;
        break;
      default:
        va = a.prj_number;
        vb = b.prj_number;
    }
    return va.localeCompare(vb, undefined, { numeric: true }) * mul;
  });
  return sorted;
}
