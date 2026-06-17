import type { ProjectWithStats } from '@/lib/db-types';
import {
  DEFAULT_SECTION_OPEN,
  LEGACY_SECTION_STORAGE_KEY,
  SECTION_STORAGE_KEY,
} from '@/pages/projects/projects-page-constants';

export function normalizeProjectDuplicateKey(name: string): string {
  return name.trim().toLowerCase().replace(/[_-]+/g, '').replace(/\s+/g, '');
}

export function sortProjectList(
  list: ProjectWithStats[],
  sortBy: string,
  estimates: Record<number, number>,
): ProjectWithStats[] {
  return list.toSorted((a, b) => {
    const valA = estimates[a.id] || 0;
    const valB = estimates[b.id] || 0;
    switch (sortBy) {
      case 'name-asc':
        return a.name.localeCompare(b.name);
      case 'name-desc':
        return b.name.localeCompare(a.name);
      case 'time-asc':
        return a.total_seconds - b.total_seconds;
      case 'time-desc':
        return b.total_seconds - a.total_seconds;
      case 'value-asc':
        return valA - valB;
      case 'value-desc':
        return valB - valA;
      default:
        return 0;
    }
  });
}

export function filterProjectList(
  list: ProjectWithStats[],
  search: string,
): ProjectWithStats[] {
  if (!search) return list;
  const q = search.toLowerCase();
  return list.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      (p.assigned_folder_path &&
        p.assigned_folder_path.toLowerCase().includes(q)),
  );
}

export function persistSectionOpen(
  next: Record<
    'excluded' | 'merged' | 'folders' | 'candidates' | 'detected',
    boolean
  >,
) {
  try {
    localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(next));
    localStorage.removeItem(LEGACY_SECTION_STORAGE_KEY);
  } catch (error) {
    console.debug('Failed to persist sections state:', error);
  }
}

export function loadSectionOpenState(): Record<
  'excluded' | 'merged' | 'folders' | 'candidates' | 'detected',
  boolean
> {
  try {
    const raw =
      localStorage.getItem(SECTION_STORAGE_KEY) ??
      localStorage.getItem(LEGACY_SECTION_STORAGE_KEY);
    if (!raw) return DEFAULT_SECTION_OPEN;
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    const next = {
      excluded: parsed.excluded ?? DEFAULT_SECTION_OPEN.excluded,
      merged: parsed.merged ?? DEFAULT_SECTION_OPEN.merged,
      folders: parsed.folders ?? DEFAULT_SECTION_OPEN.folders,
      candidates: parsed.candidates ?? DEFAULT_SECTION_OPEN.candidates,
      detected: parsed.detected ?? DEFAULT_SECTION_OPEN.detected,
    };
    const allClosed =
      !next.excluded &&
      !next.merged &&
      !next.folders &&
      !next.candidates &&
      !next.detected;
    return allClosed ? DEFAULT_SECTION_OPEN : next;
  } catch {
    return DEFAULT_SECTION_OPEN;
  }
}
