import {
  effectiveIntervalMinutes,
  roundDailyTotals,
  roundSeconds,
  scaleValueToRounded,
  type RoundingSettings,
} from '@/lib/rounding';
import type { EstimateProjectRow } from '@/lib/db-types';

/** Klucz syntetycznej opcji „bez klienta" w filtrze. */
export const NO_CLIENT_KEY = '__no_client__';

function clientKey(row: EstimateProjectRow): string {
  return row.client_name && row.client_name.trim() ? row.client_name : NO_CLIENT_KEY;
}

/** Posortowana lista klientów obecnych w wierszach (+ NO_CLIENT_KEY, gdy istnieje wiersz bez klienta). */
export function clientFilterOptions(rows: readonly EstimateProjectRow[]): string[] {
  const names = new Set<string>();
  let hasNoClient = false;
  for (const r of rows) {
    if (r.client_name && r.client_name.trim()) names.add(r.client_name);
    else hasNoClient = true;
  }
  const sorted = Array.from(names).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  );
  return hasNoClient ? [...sorted, NO_CLIENT_KEY] : sorted;
}

/** Filtruje wiersze po zaznaczonych klientach. Pusty zbiór = brak filtra (wszystkie wiersze). */
export function filterRowsByClients(
  rows: readonly EstimateProjectRow[],
  selected: ReadonlySet<string>,
): EstimateProjectRow[] {
  if (selected.size === 0) return [...rows];
  return rows.filter((r) => selected.has(clientKey(r)));
}

export interface EstimateReportDay {
  date: string;
  displaySeconds: number;
  displayValue: number;
}

export interface EstimateReportProject {
  projectId: number;
  projectName: string;
  projectColor: string;
  clientName: string | null;
  displaySeconds: number;
  displayValue: number;
  days: EstimateReportDay[];
}

export interface EstimateReportModel {
  projects: EstimateReportProject[];
  totalSeconds: number;
  totalValue: number;
}

/**
 * Buduje model raportu estymacji z zaokrągleniami. Reguła zaokrąglania jest spójna z
 * raportami projektowymi (`report-view-formatting.ts`):
 * - total projektu: per_day → suma dni zaokrąglonych do pełnej godziny; inaczej → cały total
 *   zaokrąglony do interwału. Wartość skalowana proporcjonalnie (`scaleValueToRounded`).
 * - dzień (wariant „plus"): zaokrąglany do efektywnego interwału (per_day = 60 min), wartość dnia
 *   = udział w wartości projektu, skalowany do zaokrąglonego czasu dnia.
 * W trybie `per_day` suma dni = total projektu (oba liczą po pełnych godzinach).
 */
export function buildEstimateReportModel(
  rows: readonly EstimateProjectRow[],
  rounded: boolean,
  settings: RoundingSettings,
): EstimateReportModel {
  const interval = effectiveIntervalMinutes(settings);
  const usePerDay = settings.mode === 'per_day';

  const projects: EstimateReportProject[] = rows.map((row) => {
    const realTotal = row.seconds;
    // Baza WARTOŚCI musi być spójna z backendowym `estimated_value`, które liczone jest
    // z niezaokrąglonych godzin (`seconds_f64 / 3600`), a nie z `row.seconds` (= round(seconds_f64)).
    // Użycie `row.seconds` w mianowniku skalowania wstrzykiwało szum ±1–2 gr
    // (np. zaokrąglone 8h × 100 → 799,99 zamiast 800).
    const realValueSeconds = row.hours * 3600;
    const dailySeconds = row.days.map((d) => d.seconds);
    const displaySeconds = rounded
      ? usePerDay && dailySeconds.length > 0
        ? roundDailyTotals(dailySeconds, settings)
        : roundSeconds(realTotal, interval)
      : realTotal;
    const displayValue = rounded
      ? scaleValueToRounded(row.estimated_value, realValueSeconds, displaySeconds)
      : row.estimated_value;

    const days: EstimateReportDay[] = row.days.map((d) => {
      const dayDisplaySeconds = rounded ? roundSeconds(d.seconds, interval) : d.seconds;
      const dayRawValue =
        realValueSeconds > 0 ? row.estimated_value * (d.seconds / realValueSeconds) : 0;
      const dayDisplayValue = rounded
        ? scaleValueToRounded(dayRawValue, d.seconds, dayDisplaySeconds)
        : dayRawValue;
      return { date: d.date, displaySeconds: dayDisplaySeconds, displayValue: dayDisplayValue };
    });

    return {
      projectId: row.project_id,
      projectName: row.project_name,
      projectColor: row.project_color,
      clientName: row.client_name,
      displaySeconds,
      displayValue,
      days,
    };
  });

  const totalSeconds = projects.reduce((acc, p) => acc + p.displaySeconds, 0);
  const totalValue = projects.reduce((acc, p) => acc + p.displayValue, 0);
  return { projects, totalSeconds, totalValue };
}

/** Zaokrąglona alternatywa dla SUMY z wierszy estymacji (karty Total time / Value). */
export interface RoundedEstimatesSummary {
  seconds: number;
  value: number;
}

/**
 * Liczy zaokrągloną alternatywę dla podsumowania estymacji (suma po wierszach), spójnie
 * z tabelą (`roundedAlternativeFromDaily`) i raportem (`buildEstimateReportModel`):
 * - per_day → każdy wiersz zaokrąglany po dniach do pełnej godziny, potem suma;
 * - inaczej → total wiersza zaokrąglany do efektywnego interwału, potem suma.
 * Wartość ($) skalowana proporcjonalnie do zaokrąglonego czasu wiersza.
 * Zwraca null, gdy zaokrąglanie wyłączone lub wynik = sumie surowej (nic do pokazania).
 */
export function roundedEstimatesSummary(
  rows: readonly EstimateProjectRow[],
  settings: RoundingSettings,
): RoundedEstimatesSummary | null {
  if (!settings.enabled) return null;
  const interval = effectiveIntervalMinutes(settings);
  const usePerDay = settings.mode === 'per_day';

  let roundedSeconds = 0;
  let rawSeconds = 0;
  let value = 0;
  for (const r of rows) {
    const rowRounded =
      usePerDay && r.daily_seconds.length > 0
        ? roundDailyTotals(r.daily_seconds, settings)
        : roundSeconds(r.seconds, interval);
    roundedSeconds += rowRounded;
    rawSeconds +=
      Number.isFinite(r.seconds) && r.seconds > 0 ? Math.floor(r.seconds) : 0;
    // Skalowanie wartości względem niezaokrąglonych sekund (spójnie z backendem) — patrz
    // `buildEstimateReportModel`. Mianownik `r.seconds` dawał ±1–2 gr szumu na sumie.
    value += scaleValueToRounded(r.estimated_value, r.hours * 3600, rowRounded);
  }
  return roundedSeconds === rawSeconds ? null : { seconds: roundedSeconds, value };
}
