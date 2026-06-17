import { describe, expect, it } from 'vitest';

import type { SessionWithApp } from '@/lib/db-types';
import {
  areSessionListsEqual,
  areSessionsEqual,
  wallClockSeconds,
} from '@/lib/session-utils';

function buildSession(overrides: Partial<SessionWithApp> = {}): SessionWithApp {
  return {
    id: 1,
    app_id: 10,
    app_name: 'VS Code',
    executable_name: 'code.exe',
    project_id: null,
    start_time: '2026-03-13T10:00:00Z',
    end_time: '2026-03-13T10:30:00Z',
    duration_seconds: 1800,
    project_name: null,
    project_color: null,
    files: [],
    ...overrides,
  };
}

describe('wallClockSeconds', () => {
  it('sums non-overlapping sessions', () => {
    const total = wallClockSeconds([
      { start_time: '2026-06-08T10:00:00', end_time: '2026-06-08T10:30:00' },
      { start_time: '2026-06-08T11:00:00', end_time: '2026-06-08T11:15:00' },
    ]);
    expect(total).toBe(45 * 60);
  });

  it('counts overlapping sessions only once (union)', () => {
    // Two apps active simultaneously 10:00-10:20 and 10:10-10:40 → union 10:00-10:40 = 40m
    const total = wallClockSeconds([
      { start_time: '2026-06-08T10:00:00', end_time: '2026-06-08T10:20:00' },
      { start_time: '2026-06-08T10:10:00', end_time: '2026-06-08T10:40:00' },
    ]);
    expect(total).toBe(40 * 60);
  });

  it('merges a chain of overlaps and ignores invalid/zero intervals', () => {
    const total = wallClockSeconds([
      { start_time: '2026-06-08T10:00:00', end_time: '2026-06-08T10:30:00' },
      { start_time: '2026-06-08T10:25:00', end_time: '2026-06-08T10:50:00' },
      { start_time: 'not-a-date', end_time: '2026-06-08T11:00:00' },
      { start_time: '2026-06-08T12:00:00', end_time: '2026-06-08T12:00:00' },
    ]);
    expect(total).toBe(50 * 60);
  });

  it('returns 0 for an empty list', () => {
    expect(wallClockSeconds([])).toBe(0);
  });
});

describe('session-utils', () => {
  it('treats identical sessions as equal', () => {
    const left = buildSession({
      files: [
        {
          id: 100,
          app_id: 10,
          file_name: 'main.rs',
          total_seconds: 600,
          first_seen: '2026-03-13T10:00:00Z',
          last_seen: '2026-03-13T10:10:00Z',
          project_id: 1,
          project_name: 'TIMEFLOW',
          project_color: '#000000',
        },
      ],
    });
    const right = buildSession({
      files: [
        {
          id: 100,
          app_id: 10,
          file_name: 'main.rs',
          total_seconds: 600,
          first_seen: '2026-03-13T10:00:00Z',
          last_seen: '2026-03-13T10:10:00Z',
          project_id: 1,
          project_name: 'TIMEFLOW',
          project_color: '#000000',
        },
      ],
    });

    expect(areSessionsEqual(left, right)).toBe(true);
    expect(areSessionListsEqual([left], [right])).toBe(true);
  });

  it('detects file-level differences', () => {
    const left = buildSession({
      files: [
        {
          id: 100,
          app_id: 10,
          file_name: 'main.rs',
          total_seconds: 600,
          first_seen: '2026-03-13T10:00:00Z',
          last_seen: '2026-03-13T10:10:00Z',
        },
      ],
    });
    const right = buildSession({
      files: [
        {
          id: 100,
          app_id: 10,
          file_name: 'lib.rs',
          total_seconds: 600,
          first_seen: '2026-03-13T10:00:00Z',
          last_seen: '2026-03-13T10:10:00Z',
        },
      ],
    });

    expect(areSessionsEqual(left, right)).toBe(false);
  });

  it('detects reordered lists', () => {
    const left = [buildSession({ id: 1 }), buildSession({ id: 2 })];
    const right = [buildSession({ id: 2 }), buildSession({ id: 1 })];

    expect(areSessionListsEqual(left, right)).toBe(false);
  });
});
