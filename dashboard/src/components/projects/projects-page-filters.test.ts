import { beforeEach, describe, expect, it } from 'vitest';
import type { ProjectWithStats } from '@/lib/db-types';
import {
  STATUS_FILTER_STORAGE_KEY,
  computeProjectStatusCounts,
  filterProjectsByStatus,
  loadSavedStatusFilter,
} from '@/components/projects/projects-page-filters';

function createMockProject(
  id: number,
  name: string,
  frozen_at: string | null = null,
): ProjectWithStats {
  return {
    id,
    name,
    color: '#3b82f6',
    created_at: '2026-01-01T00:00:00Z',
    frozen_at,
    total_seconds: 3600,
    daily_seconds: [],
    app_count: 1,
    is_imported: 0,
    updated_at: '2026-01-01T00:00:00Z',
    last_activity: '2026-01-02T00:00:00Z',
  };
}

describe('projects-page-filters', () => {
  const projects: ProjectWithStats[] = [
    createMockProject(1, 'Active Project A', null),
    createMockProject(2, 'Frozen Project B', '2026-02-01T12:00:00Z'),
    createMockProject(3, 'Active Project C', null),
    createMockProject(4, 'Frozen Project D', '2026-02-15T12:00:00Z'),
  ];

  describe('filterProjectsByStatus', () => {
    it('returns all projects when filter is "all"', () => {
      const result = filterProjectsByStatus(projects, 'all');
      expect(result).toHaveLength(4);
      expect(result.map((p) => p.id)).toEqual([1, 2, 3, 4]);
    });

    it('returns only non-frozen projects when filter is "active"', () => {
      const result = filterProjectsByStatus(projects, 'active');
      expect(result).toHaveLength(2);
      expect(result.map((p) => p.id)).toEqual([1, 3]);
      expect(result.every((p) => !p.frozen_at)).toBe(true);
    });

    it('returns only frozen projects when filter is "frozen"', () => {
      const result = filterProjectsByStatus(projects, 'frozen');
      expect(result).toHaveLength(2);
      expect(result.map((p) => p.id)).toEqual([2, 4]);
      expect(result.every((p) => Boolean(p.frozen_at))).toBe(true);
    });

    it('handles empty project array', () => {
      expect(filterProjectsByStatus([], 'all')).toEqual([]);
      expect(filterProjectsByStatus([], 'active')).toEqual([]);
      expect(filterProjectsByStatus([], 'frozen')).toEqual([]);
    });
  });

  describe('computeProjectStatusCounts', () => {
    it('computes accurate counts for mixed active and frozen projects', () => {
      const counts = computeProjectStatusCounts(projects);
      expect(counts).toEqual({
        all: 4,
        active: 2,
        frozen: 2,
      });
    });

    it('returns zeros for empty array', () => {
      const counts = computeProjectStatusCounts([]);
      expect(counts).toEqual({
        all: 0,
        active: 0,
        frozen: 0,
      });
    });

    it('counts accurately when all are active', () => {
      const allActive = [
        createMockProject(1, 'A', null),
        createMockProject(2, 'B', null),
      ];
      expect(computeProjectStatusCounts(allActive)).toEqual({
        all: 2,
        active: 2,
        frozen: 0,
      });
    });

    it('counts accurately when all are frozen', () => {
      const allFrozen = [
        createMockProject(1, 'A', '2026-01-01'),
        createMockProject(2, 'B', '2026-01-02'),
      ];
      expect(computeProjectStatusCounts(allFrozen)).toEqual({
        all: 2,
        active: 0,
        frozen: 2,
      });
    });
  });

  describe('loadSavedStatusFilter', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('defaults to "all" when nothing is saved in localStorage', () => {
      expect(loadSavedStatusFilter()).toBe('all');
    });

    it('returns "active" when saved in localStorage', () => {
      localStorage.setItem(STATUS_FILTER_STORAGE_KEY, 'active');
      expect(loadSavedStatusFilter()).toBe('active');
    });

    it('returns "frozen" when saved in localStorage', () => {
      localStorage.setItem(STATUS_FILTER_STORAGE_KEY, 'frozen');
      expect(loadSavedStatusFilter()).toBe('frozen');
    });

    it('returns "all" when saved in localStorage', () => {
      localStorage.setItem(STATUS_FILTER_STORAGE_KEY, 'all');
      expect(loadSavedStatusFilter()).toBe('all');
    });

    it('falls back to "all" when an invalid value is in localStorage', () => {
      localStorage.setItem(STATUS_FILTER_STORAGE_KEY, 'invalid_filter_name');
      expect(loadSavedStatusFilter()).toBe('all');
    });
  });
});
