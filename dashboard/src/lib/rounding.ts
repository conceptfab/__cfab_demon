/**
 * Zaokrąglanie czasu (rounding) — czysta logika prezentacji.
 *
 * TIMEFLOW trzyma surowy czas (daemon/baza). Zaokrąglanie nakładamy WYŁĄCZNIE przy
 * wyświetlaniu/raportowaniu — nigdy nie modyfikujemy danych źródłowych.
 *
 * Kierunek jest stały: zawsze w GÓRĘ (ceil). Konfigurowalny jest interwał oraz
 * WARIANT (tryb) zaokrąglania. Warianty są w rejestrze `ROUNDING_VARIANTS`, więc
 * dodanie kolejnego w przyszłości = wpis w rejestrze + gałąź w `roundDurations`.
 */

/** Tryb (wariant) zaokrąglania. Rozszerzalny — dodaj nowy id tutaj i obsłuż w `roundDurations`. */
export type RoundingMode = 'per_total' | 'per_session' | 'per_day';

/** Pełna godzina w minutach. Tryb `per_day` zaokrągla zawsze do pełnej godziny. */
export const FULL_HOUR_MINUTES = 60;

export interface RoundingVariant {
  id: RoundingMode;
  /** Klucz i18n nazwy. */
  nameKey: string;
  /** Klucz i18n opisu. */
  descriptionKey: string;
}

/** Rejestr wariantów — źródło prawdy dla UI (radio) i walidacji ustawień. */
export const ROUNDING_VARIANTS: readonly RoundingVariant[] = [
  {
    id: 'per_total',
    nameKey: 'rounding.variant.per_total.name',
    descriptionKey: 'rounding.variant.per_total.description',
  },
  {
    id: 'per_session',
    nameKey: 'rounding.variant.per_session.name',
    descriptionKey: 'rounding.variant.per_session.description',
  },
  {
    id: 'per_day',
    nameKey: 'rounding.variant.per_day.name',
    descriptionKey: 'rounding.variant.per_day.description',
  },
] as const;

/** Dozwolone interwały zaokrąglania w minutach (6 min = 1/10 h). */
export const ROUNDING_INTERVALS = [1, 5, 6, 10, 15, 30, 60] as const;

export interface RoundingSettings {
  enabled: boolean;
  intervalMinutes: number;
  mode: RoundingMode;
}

export const DEFAULT_ROUNDING_SETTINGS: RoundingSettings = {
  enabled: false,
  intervalMinutes: 15,
  mode: 'per_total',
};

/**
 * Zaokrągla pojedynczą wartość w sekundach W GÓRĘ do najbliższej wielokrotności
 * interwału. 0 (lub wartość niepoprawna/ujemna) → 0 (nie nadbijamy pustego czasu).
 */
export function roundSeconds(seconds: number, intervalMinutes: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const step = Math.max(1, Math.round(intervalMinutes)) * 60;
  return Math.ceil(seconds / step) * step;
}

/**
 * Efektywny interwał dla danego trybu. `per_day` wymusza pełną godzinę (60 min),
 * pozostałe tryby używają interwału z ustawień. Dzięki temu globalna ścieżka
 * prezentacji (formatDuration) sama zaokrągla do godziny, gdy aktywny jest per_day.
 */
export function effectiveIntervalMinutes(settings: RoundingSettings): number {
  return settings.mode === 'per_day' ? FULL_HOUR_MINUTES : settings.intervalMinutes;
}

/**
 * Zaokrągla zbiór czasów sesji i zwraca SUMĘ wg wybranego wariantu.
 * - per_total:   sumuj surowe, potem zaokrąglij sumę raz.
 * - per_session: zaokrąglij każdą sesję, potem zsumuj.
 * - per_day:     bez rozbicia na dni sprowadza się do zaokrąglenia całości do
 *                pełnej godziny (grupowanie dzienne robi `roundDailyTotals`).
 * Gdy wyłączone — zwraca zwykłą sumę surową.
 */
export function roundDurations(
  perSessionSeconds: readonly number[],
  settings: RoundingSettings,
): number {
  const rawTotal = perSessionSeconds.reduce(
    (acc, s) => acc + (Number.isFinite(s) && s > 0 ? s : 0),
    0,
  );
  if (!settings.enabled) return rawTotal;
  if (settings.mode === 'per_session') {
    return perSessionSeconds.reduce(
      (acc, s) => acc + roundSeconds(s, settings.intervalMinutes),
      0,
    );
  }
  return roundSeconds(rawTotal, effectiveIntervalMinutes(settings));
}

/**
 * Zaokrągla zagregowane totale DZIENNE i zwraca sumę. Używać w widokach z rozbiciem
 * na dni (Daily/Weekly/MonthlyView, raporty per dzień).
 * - per_day:     zaokrągla każdy dzień do pełnej godziny, potem sumuje (sedno trybu).
 * - per_total:   sumuje surowe dni, zaokrągla sumę raz (interwał z ustawień).
 * - per_session: tu jednostką jest dzień — zaokrągla każdy dzień, potem sumuje.
 * Gdy wyłączone — zwykła suma surowa.
 */
export function roundDailyTotals(
  perDaySeconds: readonly number[],
  settings: RoundingSettings,
): number {
  if (settings.enabled && settings.mode === 'per_day') {
    return perDaySeconds.reduce(
      (acc, s) => acc + roundSeconds(s, FULL_HOUR_MINUTES),
      0,
    );
  }
  return roundDurations(perDaySeconds, settings);
}

/**
 * Zaokrągla pojedynczy, już zagregowany total (gdy nie mamy rozbicia na sesje,
 * np. licznik na Dashboardzie). Wariant per_session bez rozbicia sprowadza się do
 * zaokrąglenia całości. Gdy wyłączone — zwraca wartość bez zmian.
 */
export function roundAggregate(
  totalSeconds: number,
  settings: RoundingSettings,
): number {
  if (!settings.enabled) return totalSeconds;
  return roundSeconds(totalSeconds, effectiveIntervalMinutes(settings));
}

/**
 * Skaluje wartość ($) proporcjonalnie do zaokrąglonego czasu. Używane w raportach,
 * gdzie wartość liczy backend (z mnożnikami/dedup) — zamiast przeliczać ją od nowa,
 * skalujemy ją tak samo, jak zmienił się prezentowany czas. Gdy czas rzeczywisty = 0
 * lub niepoprawny, zwraca wartość bez zmian.
 */
export function scaleValueToRounded(
  value: number,
  realSeconds: number,
  roundedSeconds: number,
): number {
  if (!Number.isFinite(realSeconds) || realSeconds <= 0) return value;
  return value * (roundedSeconds / realSeconds);
}

/** Waliduje/normalizuje ustawienia z localStorage do bezpiecznych wartości. */
export function normalizeRoundingSettings(
  parsed: Partial<RoundingSettings> & Record<string, unknown>,
): RoundingSettings {
  const intervalMinutes = (
    ROUNDING_INTERVALS as readonly number[]
  ).includes(parsed.intervalMinutes as number)
    ? (parsed.intervalMinutes as number)
    : DEFAULT_ROUNDING_SETTINGS.intervalMinutes;
  const mode = ROUNDING_VARIANTS.some((v) => v.id === parsed.mode)
    ? (parsed.mode as RoundingMode)
    : DEFAULT_ROUNDING_SETTINGS.mode;
  return { enabled: !!parsed.enabled, intervalMinutes, mode };
}
