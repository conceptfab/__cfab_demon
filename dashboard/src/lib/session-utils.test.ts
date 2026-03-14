import { describe, expect, it } from 'vitest';

import type { SessionWithApp } from '@/lib/db-types';
import {
  areSessionListsEqual,
  areSessionsEqual,
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
