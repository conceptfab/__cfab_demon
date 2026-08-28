import { describe, expect, it } from 'vitest';

import type { SessionWithApp } from '@/lib/db-types';
import {
  buildReportCommentRows,
  buildReportSessionRows,
  mergeTimelineDays,
} from '@/lib/report-merge';
import { buildTimelineDays } from '@/lib/report-timeline';

function makeAuto(over: Partial<SessionWithApp>): SessionWithApp {
  const session = {
    id: 1,
    app_id: 1,
    project_id: 1,
    start_time: '2026-08-03T09:00:00',
    end_time: '2026-08-03T10:00:00',
    duration_seconds: 1800,
    app_name: 'Cinema 4D',
    comment: 'Wdrożenie uwag',
    ...over,
  } as SessionWithApp;
  return {
    ...session,
    effective_seconds: over.effective_seconds ?? session.duration_seconds,
  };
}

describe('mergeTimelineDays', () => {
  it('scala powtórzenia tej samej aplikacji i komentarza w jeden wpis z sumą czasu', () => {
    const days = mergeTimelineDays(
      buildTimelineDays(
        [
          makeAuto({ id: 1, start_time: '2026-08-03T09:00:00' }),
          makeAuto({ id: 2, start_time: '2026-08-03T11:00:00' }),
          makeAuto({ id: 3, start_time: '2026-08-03T13:00:00' }),
        ],
        [],
      ),
    );

    expect(days).toHaveLength(1);
    const entries = days[0]!.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.mergedCount).toBe(3);
    expect(entries[0]?.durationSeconds).toBe(5400);
    // Wiersz reprezentuje blok pracy — start bierzemy z najwcześniejszej sesji.
    expect(entries[0]?.startTime).toBe('2026-08-03T09:00:00');
  });

  it('suma dnia i suma wpisów nie zmieniają się po scaleniu', () => {
    const raw = buildTimelineDays(
      [
        makeAuto({ id: 1, effective_seconds: 900 }),
        makeAuto({ id: 2, start_time: '2026-08-03T10:00:00', effective_seconds: 1800 }),
        makeAuto({
          id: 3,
          start_time: '2026-08-03T12:00:00',
          app_name: 'Blender',
          effective_seconds: 600,
        }),
      ],
      [],
    );
    const merged = mergeTimelineDays(raw);

    expect(merged[0]?.totalSeconds).toBe(raw[0]?.totalSeconds);
    const sum = merged[0]!.entries.reduce((a, e) => a + e.durationSeconds, 0);
    expect(sum).toBe(3300);
  });

  it('nie scala różnych komentarzy, aplikacji ani dni', () => {
    const days = mergeTimelineDays(
      buildTimelineDays(
        [
          makeAuto({ id: 1, comment: 'Rendery' }),
          makeAuto({ id: 2, start_time: '2026-08-03T10:00:00', comment: 'Research' }),
          makeAuto({ id: 3, start_time: '2026-08-03T11:00:00', app_name: 'Blender' }),
          makeAuto({ id: 4, start_time: '2026-08-04T09:00:00' }),
        ],
        [],
      ),
    );

    expect(days.map((d) => d.date)).toEqual(['2026-08-03', '2026-08-04']);
    expect(days[0]?.entries).toHaveLength(3);
    expect(days[0]?.entries.every((e) => e.mergedCount === 1)).toBe(true);
    expect(days[1]?.entries).toHaveLength(1);
  });

  it('sesja bez komentarza nie skleja się z sesją skomentowaną', () => {
    const days = mergeTimelineDays(
      buildTimelineDays(
        [
          makeAuto({ id: 1, comment: null }),
          makeAuto({ id: 2, start_time: '2026-08-03T10:00:00', comment: '   ' }),
          makeAuto({ id: 3, start_time: '2026-08-03T11:00:00', comment: 'Rendery' }),
        ],
        [],
      ),
    );

    const entries = days[0]!.entries;
    expect(entries).toHaveLength(2);
    // Pusty i biały komentarz to ten sam brak komentarza → jeden wiersz ×2.
    expect(entries[0]?.mergedCount).toBe(2);
    expect(entries[1]?.comment).toBe('Rendery');
  });
});

describe('buildReportSessionRows', () => {
  const sessions = [
    makeAuto({ id: 1, start_time: '2026-08-04T09:00:00', effective_seconds: 1200 }),
    makeAuto({ id: 2, start_time: '2026-08-03T09:00:00', effective_seconds: 1800 }),
    makeAuto({ id: 3, start_time: '2026-08-03T14:00:00', effective_seconds: 600 }),
  ];

  it('bez scalania zwraca wiersz na sesję, w kolejności wejściowej', () => {
    const rows = buildReportSessionRows(sessions, false);
    expect(rows.map((r) => r.key)).toEqual([
      'session-1',
      'session-2',
      'session-3',
    ]);
    expect(rows.every((r) => r.mergedCount === 1)).toBe(true);
  });

  it('scala sesje tego samego dnia, aplikacji i komentarza', () => {
    const rows = buildReportSessionRows(sessions, true);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: '2026-08-04', seconds: 1200, mergedCount: 1 });
    expect(rows[1]).toMatchObject({ date: '2026-08-03', seconds: 2400, mergedCount: 2 });
  });

  it('suma czasu wierszy jest taka sama jak bez scalania', () => {
    const raw = buildReportSessionRows(sessions, false);
    const merged = buildReportSessionRows(sessions, true);
    const sum = (rows: { seconds: number }[]) =>
      rows.reduce((a, r) => a + r.seconds, 0);
    expect(sum(merged)).toBe(sum(raw));
  });
});

describe('buildReportCommentRows', () => {
  it('scala ten sam komentarz z tego samego dnia i liczy powtórzenia', () => {
    const rows = buildReportCommentRows(
      [
        makeAuto({ id: 1, comment: 'Rendery' }),
        makeAuto({ id: 2, start_time: '2026-08-03T12:00:00', comment: 'Rendery' }),
        makeAuto({ id: 3, start_time: '2026-08-04T09:00:00', comment: 'Rendery' }),
      ],
      true,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: '2026-08-03', mergedCount: 2 });
    expect(rows[1]).toMatchObject({ date: '2026-08-04', mergedCount: 1 });
  });

  it('bez scalania zostawia każdy komentarz osobno', () => {
    const rows = buildReportCommentRows(
      [
        makeAuto({ id: 1, comment: 'Rendery' }),
        makeAuto({ id: 2, start_time: '2026-08-03T12:00:00', comment: 'Rendery' }),
      ],
      false,
    );
    expect(rows).toHaveLength(2);
  });
});
