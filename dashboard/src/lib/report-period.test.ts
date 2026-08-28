import { describe, expect, it } from 'vitest';

import { ALL_TIME_DATE_RANGE } from '@/lib/date-helpers';
import {
  buildPeriodFileSuffix,
  buildReportPeriod,
  formatPeriodLabel,
  isAllTimePeriod,
  isOpenEndedRange,
} from '@/lib/report-period';

const NOW = new Date('2026-07-15T12:00:00');

describe('report period', () => {
  it('buduje pełny bieżący miesiąc', () => {
    const period = buildReportPeriod('this_month', undefined, NOW);
    expect(period.range).toEqual({ start: '2026-07-01', end: '2026-07-31' });
  });

  it('buduje poprzedni miesiąc z poprawną liczbą dni', () => {
    const period = buildReportPeriod('last_month', undefined, NOW);
    expect(period.range).toEqual({ start: '2026-06-01', end: '2026-06-30' });
  });

  it('obsługuje luty roku przestępnego', () => {
    const period = buildReportPeriod(
      'this_month',
      undefined,
      new Date('2028-02-10T12:00:00'),
    );
    expect(period.range).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });

  it('cały okres używa tego samego zakresu co reszta aplikacji', () => {
    const period = buildReportPeriod('all_time');
    expect(period.range).toEqual(ALL_TIME_DATE_RANGE);
    expect(isAllTimePeriod(period)).toBe(true);
  });

  it('cały okres z granicami projektu używa faktycznych dat', () => {
    const bounds = { start: '2026-02-11', end: '2026-08-28' };
    const period = buildReportPeriod('all_time', bounds);
    expect(period.preset).toBe('all_time');
    expect(period.range).toEqual(bounds);
    expect(isAllTimePeriod(period)).toBe(true);
    expect(isOpenEndedRange(period.range)).toBe(false);
    // Etykieta ma pokazywać realny okres projektu, nie 2020–2100.
    expect(formatPeriodLabel(period)).toBe('2026-02-11 – 2026-08-28');
  });

  it('cały okres bez granic zostaje przy wartowniku', () => {
    expect(isOpenEndedRange(buildReportPeriod('all_time').range)).toBe(true);
  });

  it('cały okres z granicami nadal nie dokłada sufiksu do nazwy pliku', () => {
    const period = buildReportPeriod('all_time', {
      start: '2026-02-11',
      end: '2026-08-28',
    });
    expect(buildPeriodFileSuffix(period)).toBe('');
  });

  it('własny zakres zachowuje podane granice', () => {
    const period = buildReportPeriod('custom', {
      start: '2026-07-05',
      end: '2026-07-20',
    });
    expect(period.preset).toBe('custom');
    expect(formatPeriodLabel(period)).toBe('2026-07-05 – 2026-07-20');
    expect(isAllTimePeriod(period)).toBe(false);
  });

  it('własny zakres bez granic spada na bieżący miesiąc', () => {
    const period = buildReportPeriod('custom', undefined, NOW);
    expect(period.range).toEqual({ start: '2026-07-01', end: '2026-07-31' });
  });

  describe('sufiks nazwy pliku PDF', () => {
    it('pełny miesiąc skraca się do YYYY-MM', () => {
      expect(buildPeriodFileSuffix(buildReportPeriod('last_month', undefined, NOW))).toBe(
        '2026-06',
      );
    });

    it('niepełny miesiąc zachowuje obie daty', () => {
      const period = buildReportPeriod('custom', {
        start: '2026-07-05',
        end: '2026-07-20',
      });
      expect(buildPeriodFileSuffix(period)).toBe('2026-07-05_2026-07-20');
    });

    it('zakres od 1. dnia, ale krótszy niż miesiąc, nie udaje pełnego miesiąca', () => {
      const period = buildReportPeriod('custom', {
        start: '2026-07-01',
        end: '2026-07-15',
      });
      expect(buildPeriodFileSuffix(period)).toBe('2026-07-01_2026-07-15');
    });

    it('cały okres nie dokłada sufiksu', () => {
      expect(buildPeriodFileSuffix(buildReportPeriod('all_time'))).toBe('');
    });
  });
});
