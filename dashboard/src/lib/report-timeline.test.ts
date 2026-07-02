import { describe, expect, it } from 'vitest';

import type { ManualSessionWithProject, SessionWithApp } from '@/lib/db-types';
import { buildTimelineDays } from '@/lib/report-timeline';

function makeAuto(over: Partial<SessionWithApp>): SessionWithApp {
  return {
    id: 1,
    app_id: 1,
    project_id: 1,
    start_time: '2026-03-01T09:00:00',
    end_time: '2026-03-01T10:00:00',
    duration_seconds: 3600,
    app_name: 'VS Code',
    ...over,
  } as SessionWithApp;
}

function makeManual(
  over: Partial<ManualSessionWithProject>,
): ManualSessionWithProject {
  return {
    id: 1,
    title: 'Spotkanie',
    session_type: 'meeting',
    project_id: 1,
    project_name: 'P',
    start_time: '2026-03-01T12:00:00',
    end_time: '2026-03-01T13:00:00',
    duration_seconds: 3600,
    date: '2026-03-01',
    ...over,
  } as ManualSessionWithProject;
}

describe('buildTimelineDays', () => {
  it('returns empty array for empty inputs', () => {
    expect(buildTimelineDays([], [])).toEqual([]);
  });

  it('merges auto and manual sessions sorted ascending by start_time', () => {
    const days = buildTimelineDays(
      [
        makeAuto({ id: 1, start_time: '2026-03-01T14:00:00' }),
        makeAuto({ id: 2, start_time: '2026-03-01T08:00:00' }),
      ],
      [makeManual({ id: 7, start_time: '2026-03-01T10:00:00' })],
    );
    expect(days).toHaveLength(1);
    expect(days[0]?.entries.map((e) => e.key)).toEqual([
      'auto-2',
      'manual-7',
      'auto-1',
    ]);
  });

  it('groups by day (ascending) and sums day totals', () => {
    const days = buildTimelineDays(
      [
        makeAuto({ id: 1, start_time: '2026-03-02T09:00:00', duration_seconds: 600 }),
        makeAuto({ id: 2, start_time: '2026-03-01T09:00:00', duration_seconds: 100 }),
      ],
      [makeManual({ id: 3, start_time: '2026-03-01T11:00:00', duration_seconds: 200 })],
    );
    expect(days.map((d) => d.date)).toEqual(['2026-03-01', '2026-03-02']);
    expect(days[0]?.totalSeconds).toBe(300);
    expect(days[1]?.totalSeconds).toBe(600);
  });

  it('attaches trimmed comment to auto entries; blank comment becomes null', () => {
    const days = buildTimelineDays(
      [
        makeAuto({ id: 1, comment: '  refactor raportu  ' }),
        makeAuto({ id: 2, start_time: '2026-03-01T11:00:00', comment: '   ' }),
      ],
      [],
    );
    expect(days[0]?.entries[0]?.comment).toBe('refactor raportu');
    expect(days[0]?.entries[1]?.comment).toBeNull();
  });

  it('manual entries carry sessionType and never a comment', () => {
    const days = buildTimelineDays([], [makeManual({ id: 5 })]);
    const entry = days[0]?.entries[0];
    expect(entry?.kind).toBe('manual');
    expect(entry?.sessionType).toBe('meeting');
    expect(entry?.comment).toBeNull();
    expect(entry?.label).toBe('Spotkanie');
  });
});
