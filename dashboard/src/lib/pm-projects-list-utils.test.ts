import { describe, expect, it } from 'vitest';
import {
  buildProjectIndexMap,
  sortPmProjects,
} from '@/lib/pm-projects-list-utils';
import type { PmProject } from '@/lib/pm-types';

function proj(partial: Partial<PmProject>): PmProject {
  return {
    prj_folder: '',
    prj_number: '001',
    prj_year: '2026',
    prj_code: 'C001',
    prj_client: 'ACME',
    prj_name: 'Name',
    prj_desc: '',
    prj_full_name: '',
    prj_budget: '',
    prj_term: '',
    prj_status: 'active',
    ...partial,
  };
}

describe('buildProjectIndexMap', () => {
  it('maps each project reference to its index', () => {
    const a = proj({ prj_code: 'A' });
    const b = proj({ prj_code: 'B' });
    const c = proj({ prj_code: 'C' });
    const map = buildProjectIndexMap([a, b, c]);
    expect(map.get(a)).toBe(0);
    expect(map.get(b)).toBe(1);
    expect(map.get(c)).toBe(2);
  });

  it('returns an empty map for an empty list', () => {
    expect(buildProjectIndexMap([]).size).toBe(0);
  });
});

describe('sortPmProjects global', () => {
  it('orders a filtered subset by original allProjects index (asc) and reverses (desc)', () => {
    const a = proj({ prj_code: 'A' });
    const b = proj({ prj_code: 'B' });
    const c = proj({ prj_code: 'C' });
    const all = [a, b, c];
    const subset = [c, a]; // intentionally out of original order

    expect(sortPmProjects(subset, all, 'global', 'asc')).toEqual([a, c]);
    expect(sortPmProjects(subset, all, 'global', 'desc')).toEqual([c, a]);
  });

  it('does not mutate the input list', () => {
    const a = proj({ prj_code: 'A' });
    const b = proj({ prj_code: 'B' });
    const all = [a, b];
    const subset = [b, a];
    sortPmProjects(subset, all, 'global', 'asc');
    expect(subset).toEqual([b, a]);
  });

  it('treats elements absent from allProjects as index -1 (matches indexOf)', () => {
    const a = proj({ prj_code: 'A' });
    const orphan = proj({ prj_code: 'X' }); // not present in allProjects
    const all = [a];
    // orphan resolves to -1, a to 0 → orphan sorts before a in asc
    expect(sortPmProjects([a, orphan], all, 'global', 'asc')).toEqual([
      orphan,
      a,
    ]);
  });
});
