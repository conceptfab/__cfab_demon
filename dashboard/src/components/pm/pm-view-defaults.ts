import type { PmSortField } from '@/lib/pm-types';

export type PmSortDir = 'asc' | 'desc';

export interface PmViewDefaults {
  filterYear: string;
  filterClient: string;
  filterStatus: string;
  sortField: PmSortField;
  sortDir: PmSortDir;
}

/** localStorage keys — reused from the previous usePersistedState wiring for a smooth migration. */
export const PM_VIEW_STORAGE_KEYS = {
  year: 'timeflow-pm-filter-year',
  client: 'timeflow-pm-filter-client',
  status: 'timeflow-pm-filter-status',
  sortField: 'timeflow-pm-sort-field',
  sortDir: 'timeflow-pm-sort-dir',
} as const;

export const PM_VIEW_DEFAULTS: PmViewDefaults = {
  filterYear: '',
  filterClient: '',
  filterStatus: '',
  sortField: 'number',
  sortDir: 'desc',
};

const VALID_SORT_FIELDS: PmSortField[] = [
  'global', 'number', 'year', 'client', 'name', 'status',
];
const VALID_SORT_DIRS: PmSortDir[] = ['asc', 'desc'];

/** Read the saved default PM view from localStorage. Returns full defaults on any failure. */
export function loadPmViewDefaults(): PmViewDefaults {
  if (typeof window === 'undefined') return { ...PM_VIEW_DEFAULTS };
  try {
    const ls = window.localStorage;
    const sortFieldRaw = ls.getItem(PM_VIEW_STORAGE_KEYS.sortField);
    const sortDirRaw = ls.getItem(PM_VIEW_STORAGE_KEYS.sortDir);
    return {
      filterYear: ls.getItem(PM_VIEW_STORAGE_KEYS.year) ?? PM_VIEW_DEFAULTS.filterYear,
      filterClient: ls.getItem(PM_VIEW_STORAGE_KEYS.client) ?? PM_VIEW_DEFAULTS.filterClient,
      filterStatus: ls.getItem(PM_VIEW_STORAGE_KEYS.status) ?? PM_VIEW_DEFAULTS.filterStatus,
      sortField: VALID_SORT_FIELDS.includes(sortFieldRaw as PmSortField)
        ? (sortFieldRaw as PmSortField)
        : PM_VIEW_DEFAULTS.sortField,
      sortDir: VALID_SORT_DIRS.includes(sortDirRaw as PmSortDir)
        ? (sortDirRaw as PmSortDir)
        : PM_VIEW_DEFAULTS.sortDir,
    };
  } catch {
    return { ...PM_VIEW_DEFAULTS };
  }
}

/** Persist the given PM view as the default. Silently ignores localStorage failures. */
export function savePmViewDefaults(view: PmViewDefaults): void {
  if (typeof window === 'undefined') return;
  try {
    const ls = window.localStorage;
    ls.setItem(PM_VIEW_STORAGE_KEYS.year, view.filterYear);
    ls.setItem(PM_VIEW_STORAGE_KEYS.client, view.filterClient);
    ls.setItem(PM_VIEW_STORAGE_KEYS.status, view.filterStatus);
    ls.setItem(PM_VIEW_STORAGE_KEYS.sortField, view.sortField);
    ls.setItem(PM_VIEW_STORAGE_KEYS.sortDir, view.sortDir);
  } catch {
    // ignore storage failures
  }
}
