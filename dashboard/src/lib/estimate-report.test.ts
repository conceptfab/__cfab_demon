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
  // W realnych danych hours = seconds_f64/3600, seconds = round(seconds_f64) — domyślnie
  // wyprowadzamy hours z seconds, żeby fixture był spójny (override przez partial.hours).
  const seconds = partial.seconds ?? 3600;
  return {
    project_id: 1,
    project_name: 'P',
    project_color: '#111',
    seconds,
    hours: seconds / 3600,
    weighted_hours: seconds / 3600,
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

  it('rounded value is an exact multiple of rate — no grosz drift from float/round mismatch', () => {
    // Regresja bugu z raportu: estimated_value liczone z NIEZAOKRĄGLONYCH godzin, a displaySeconds
    // to pełne godziny (per_day). Skalowanie po row.seconds (= round) dawało 799,99 zamiast 800.
    // FENG: 6,0869 h realne rozsiane na 8 dni → każdy dzień ceil do 1h = 8h × 100 = RÓWNO 800.
    const hours = 6.0869;
    const r = row({
      hours, // float (≠ seconds/3600) — to niespójność, która ujawniała szum
      seconds: Math.round(hours * 3600), // 21913
      estimated_value: hours * 100,
      daily_seconds: Array(8).fill(2739),
      days: Array.from({ length: 8 }, (_, i) => ({
        date: `2026-01-0${i + 1}`,
        seconds: 2739,
      })),
    });
    const model = buildEstimateReportModel([r], true, PER_DAY);
    expect(model.projects[0].displaySeconds).toBe(28800); // 8 × pełna godzina
    expect(model.projects[0].displayValue).toBeCloseTo(800, 6); // równo 800, nie 799,99
    expect(model.totalValue).toBeCloseTo(800, 6);
  });

  it('scales a weighted value by CLOCK seconds, preserving the session multiplier', () => {
    // Sesja z mnożnikiem: 3000 s czasu zegarowego, ale waga 1,5× → estimated_value (150)
    // odzwierciedla weighted_hours (1,5), a NIE godziny zegarowe (≈0,833). Zaokrąglenie
    // musi skalować wartość po stosunku ZEGAROWYM (displaySeconds / hours*3600), zostawiając
    // wagę nietkniętą — regresja gdyby ktoś użył weighted_hours w mianowniku skalowania.
    const PER_TOTAL_15: RoundingSettings = {
      enabled: true,
      intervalMinutes: 15,
      mode: 'per_total',
    };
    const r = row({
      seconds: 3000,
      hours: 3000 / 3600,
      weighted_hours: 1.5,
      estimated_value: 150,
      daily_seconds: [3000],
      days: [{ date: '2026-01-01', seconds: 3000 }],
    });
    const model = buildEstimateReportModel([r], true, PER_TOTAL_15);
    expect(model.projects[0].displaySeconds).toBe(3600); // 50 min → ceil 15-min → 60 min
    // 150 × (3600 / 3000) = 180 — skalowane stosunkiem zegarowym, waga zachowana.
    expect(model.projects[0].displayValue).toBeCloseTo(180, 6);
  });

  it('passes a weighted value through unchanged when rounding does not alter the total', () => {
    const PER_TOTAL_60: RoundingSettings = {
      enabled: true,
      intervalMinutes: 60,
      mode: 'per_total',
    };
    const r = row({ seconds: 3600, hours: 1, weighted_hours: 1.5, estimated_value: 150 });
    const model = buildEstimateReportModel([r], true, PER_TOTAL_60);
    expect(model.projects[0].displaySeconds).toBe(3600);
    expect(model.projects[0].displayValue).toBeCloseTo(150, 6); // waga przechodzi bez zmian
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

  it('scales value against unrounded hours so 8h×100 sums to exactly 800', () => {
    const hours = 6.0869;
    const out = roundedEstimatesSummary(
      [
        row({
          hours,
          seconds: Math.round(hours * 3600),
          estimated_value: hours * 100,
          daily_seconds: Array(8).fill(2739),
        }),
      ],
      PER_DAY,
    );
    expect(out?.seconds).toBe(28800);
    expect(out?.value).toBeCloseTo(800, 6); // nie 799,99
  });
});
