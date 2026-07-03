import { describe, expect, it } from 'vitest';

import type { SessionWithApp } from '@/lib/db-types';
import { groupSessionsByProject } from '@/lib/sessions-grouping';

function session(over: Partial<SessionWithApp>): SessionWithApp {
  return {
    id: 1,
    app_id: 1,
    project_id: 1,
    start_time: '2026-03-01T10:00:00',
    end_time: '2026-03-01T11:00:00',
    duration_seconds: 3600,
    app_name: 'Code',
    executable_name: 'code',
    project_name: 'P',
    project_color: '#111111',
    files: [],
    ...over,
  };
}

describe('groupSessionsByProject', () => {
  it('uses canonical per-project totals when provided', () => {
    const groups = groupSessionsByProject(
      [session({ project_id: 1 })],
      'Unassigned',
      new Map(),
      new Map([[1, 4500]]),
    );
    const p1 = groups.find((group) => group.projectId === 1)!;
    expect(p1.totalSeconds).toBe(4500);
  });
});
