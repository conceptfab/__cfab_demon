import { describe, expect, it } from 'vitest';
import {
  NO_CLIENT_KEY,
  buildEstimateReportModel,
  clientFilterOptions,
  filterRowsByClients,
  roundedEstimatesSummary,
} from '@/lib/estimate-report';
import type { EstimateProjectRow } from '@/lib/db-types';
import type { RoundingSettings } from '@/lib/rounding';

function row(partial: Partial<EstimateProjectRow>): EstimateProjectRow {
  return {
    project_id: 1,
    project_name: 'P',
    project_color: '#111',
    seconds: 3600,
    hours: 1,
    weighted_hours: 1,
    project_hourly_rate: null,
    effective_hourly_rate: 100,
    estimated_value: 100,
    session_count: 1,
    multiplied_session_count: 0,
    multiplier_extra_seconds: 0,
    daily_seconds: [3600],
    client_name: null,
    days: [{ date: '2026-01-01', seconds: 3600 }],
    ...partial,
  };
}

const OFF: RoundingSettings = { enabled: false, intervalMinutes: 15, mode: 'per_total' };
const PER_DAY: RoundingSettings = { enabled: true, intervalMinutes: 60, mode: 'per_day' };

describe('clientFilterOptions', () => {
  it('returns sorted distinct clients and appends NO_CLIENT when an unassigned row exists', () => {
    const opts = clientFilterOptions([
      row({ client_name: 'Beta' }),
      row({ client_name: 'Alpha' }),
      row({ client_name: null }),
    ]);
    expect(opts).toEqual(['Alpha', 'Beta', NO_CLIENT_KEY]);
  });

  it('omits NO_CLIENT when every row has a client', () => {
    expect(clientFilterOptions([row({ client_name: 'Alpha' })])).toEqual(['Alpha']);
  });
});

describe('filterRowsByClients', () => {
  it('returns all rows when selection is empty', () => {
    const rows = [row({ client_name: 'Alpha' }), row({ client_name: null })];
    expect(filterRowsByClients(rows, new Set())).toHaveLength(2);
  });

  it('keeps only selected clients and maps unassigned to NO_CLIENT', () => {
    const rows = [
      row({ project_id: 1, client_name: 'Alpha' }),
      row({ project_id: 2, client_name: 'Beta' }),
      row({ project_id: 3, client_name: null }),
    ];
    const out = filterRowsByClients(rows, new Set(['Alpha', NO_CLIENT_KEY]));
    expect(out.map((r) => r.project_id)).toEqual([1, 3]);
  });
});

describe('buildEstimateReportModel', () => {
  it('passes raw seconds and value through when rounding disabled', () => {
    const model = buildEstimateReportModel([row({ seconds: 5400, estimated_value: 150 })], false, OFF);
    expect(model.totalSeconds).toBe(5400);
    expect(model.totalValue).toBeCloseTo(150);
    expect(model.projects[0].days[0].displaySeconds).toBe(3600);
  });

  it('rounds each day to a full hour in per_day mode and keeps project total = sum of days', () => {
    const r = row({
      seconds: 4500,
      estimated_value: 125,
      daily_seconds: [600, 3900],
      days: [
        { date: '2026-01-04', seconds: 600 },
        { date: '2026-01-05', seconds: 3900 },
      ],
    });
    const model = buildEstimateReportModel([r], true, PER_DAY);
    expect(model.projects[0].days.map((d) => d.displaySeconds)).toEqual([3600, 7200]);
    expect(model.projects[0].displaySeconds).toBe(10800);
    expect(model.totalSeconds).toBe(10800);
    expect(model.projects[0].displayValue).toBeCloseTo(300);
  });
});

describe('roundedEstimatesSummary', () => {
  const PER_TOTAL: RoundingSettings = {
    enabled: true,
    intervalMinutes: 15,
    mode: 'per_total',
  };

  it('returns null when rounding is disabled', () => {
    expect(roundedEstimatesSummary([row({ seconds: 4000 })], OFF)).toBeNull();
  });

  it('returns null when the rounded sum equals the raw sum', () => {
    // 3600 i 7200 są już wielokrotnościami 15 min → brak alternatywy.
    const rows = [row({ seconds: 3600 }), row({ seconds: 7200 })];
    expect(roundedEstimatesSummary(rows, PER_TOTAL)).toBeNull();
  });

  it('sums per-row rounded totals and scales value (per_total)', () => {
    const rows = [
      row({ seconds: 4000, estimated_value: 100, daily_seconds: [4000] }),
      row({ seconds: 5000, estimated_value: 200, daily_seconds: [5000] }),
    ];
    const out = roundedEstimatesSummary(rows, PER_TOTAL);
    // 4000→4500 (75 min), 5000→5400 (90 min) → suma 9900 s.
    expect(out?.seconds).toBe(9900);
    // wartość skalowana proporcjonalnie do zaokrąglonego czasu wiersza.
    expect(out?.value).toBeCloseTo(100 * (4500 / 4000) + 200 * (5400 / 5000));
  });

  it('rounds each day to a full hour in per_day mode', () => {
    const rows = [
      row({
        seconds: 4500,
        estimated_value: 125,
        daily_seconds: [600, 3900],
      }),
    ];
    const out = roundedEstimatesSummary(rows, PER_DAY);
    expect(out?.seconds).toBe(10800); // 3600 + 7200
  });
});
