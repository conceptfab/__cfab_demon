import { describe, expect, it } from 'vitest';
import type { EstimateProjectRow } from '@/lib/db-types';
import {
  buildEstimateMap,
  shouldInvalidateProjectExtraInfo,
  shouldRefreshProjectsAllTime,
} from './projects-all-time';

describe('projects-all-time helpers', () => {
  it('refreshes heavy all-time data only for relevant reasons', () => {
    expect(shouldRefreshProjectsAllTime('refresh_today')).toBe(true);
    expect(shouldRefreshProjectsAllTime('import_data')).toBe(true);
    expect(shouldRefreshProjectsAllTime('set_demo_mode')).toBe(true);
    expect(shouldRefreshProjectsAllTime('update_project')).toBe(false);
    expect(shouldRefreshProjectsAllTime('assign_app_to_project')).toBe(false);
  });

  it('invalidates cached project extra info for wider project mutations', () => {
    expect(shouldInvalidateProjectExtraInfo('create_project')).toBe(true);
    expect(shouldInvalidateProjectExtraInfo('delete_project')).toBe(true);
    expect(shouldInvalidateProjectExtraInfo('compact_project_data')).toBe(true);
    expect(shouldInvalidateProjectExtraInfo('update_project')).toBe(false);
  });

  it('builds estimate map by project id', () => {
    expect(
      buildEstimateMap([
        { project_id: 2, estimated_value: 150 } as EstimateProjectRow,
        { project_id: 7, estimated_value: 40 } as EstimateProjectRow,
      ]),
    ).toEqual({
      2: 150,
      7: 40,
    });
  });
});
