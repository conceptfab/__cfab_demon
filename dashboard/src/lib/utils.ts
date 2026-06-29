import { format, parseISO } from 'date-fns';
import type { Locale } from 'date-fns';
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatMultiplierLabel } from '@/lib/rate-utils';
import {
  roundSeconds,
  roundDailyTotals,
  effectiveIntervalMinutes,
} from '@/lib/rounding';
import { loadRoundingSettings } from '@/lib/user-settings';
import i18n from '@/i18n';

/** Aktualny język UI — wspólne źródło locale dla formatowania liczb/walut. */
function activeLocale(): string {
  return i18n.resolvedLanguage ?? i18n.language ?? 'en';
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getDurationParts(totalSeconds: number) {
  const safeSeconds =
    Number.isFinite(totalSeconds) && totalSeconds > 0
      ? Math.floor(totalSeconds)
      : 0;

  return {
    hours: Math.floor(safeSeconds / 3600),
    minutes: Math.floor((safeSeconds % 3600) / 60),
    seconds: safeSeconds % 60,
  };
}

/**
 * Returns the rounded-up seconds for the active setting, or null when rounding
 * is disabled OR the rounded value is identical to the raw value (nothing to add
 * as an alternative). Cached read — cheap to call on every render.
 */
export function roundedAlternativeSeconds(seconds: number): number | null {
  const r = loadRoundingSettings();
  if (!r.enabled) return null;
  const rounded = roundSeconds(seconds, effectiveIntervalMinutes(r));
  const raw = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return rounded === raw ? null : rounded;
}

/**
 * Wariant `roundedAlternativeSeconds` świadomy DZIENNEGO rozbicia. Gdy aktywny jest
 * tryb `per_day`, zaokrągla każdy dzień do pełnej godziny i sumuje (`dailySeconds`);
 * w pozostałych trybach działa jak `roundedAlternativeSeconds` na sumie. Zwraca null,
 * gdy zaokrąglanie wyłączone lub wynik = wartość surowa.
 */
export function roundedAlternativeFromDaily(
  totalSeconds: number,
  dailySeconds: readonly number[],
): number | null {
  const r = loadRoundingSettings();
  if (!r.enabled) return null;
  // Brak dziennego rozbicia (np. widok godzinowy = jeden dzień) → zaokrąglamy całość.
  const rounded =
    r.mode === 'per_day' && dailySeconds.length > 0
      ? roundDailyTotals(dailySeconds, r)
      : roundSeconds(totalSeconds, effectiveIntervalMinutes(r));
  const raw =
    Number.isFinite(totalSeconds) && totalSeconds > 0
      ? Math.floor(totalSeconds)
      : 0;
  return rounded === raw ? null : rounded;
}

/** Raw duration formatter — never shows the rounded alternative. */
export function formatDurationRaw(seconds: number): string {
  const { hours, minutes, seconds: remainingSeconds } = getDurationParts(seconds);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

/**
 * Duration formatter. Rounding is an ALTERNATIVE value: the real time stays as
 * the primary, and when rounding is enabled the rounded value is appended in
 * parentheses, e.g. "5h 23m (≈5h 30m)". Never replaces the real value.
 */
export function formatDuration(seconds: number): string {
  const raw = formatDurationRaw(seconds);
  const alt = roundedAlternativeSeconds(seconds);
  return alt === null ? raw : `${raw} (≈${formatDurationRaw(alt)})`;
}

/**
 * Jak `formatDuration`, ale świadomy DZIENNEGO rozbicia. Dla wieloдniowych sum
 * (totale projektu/klienta/dashboardu) pozwala trybowi `per_day` zaokrąglić każdy
 * dzień do pełnej godziny i zsumować. W pozostałych trybach (per_total/per_session/
 * wyłączone) zachowuje się dokładnie jak `formatDuration`.
 */
export function formatDurationWithDaily(
  seconds: number,
  dailySeconds: readonly number[],
): string {
  const raw = formatDurationRaw(seconds);
  const alt = roundedAlternativeFromDaily(seconds, dailySeconds);
  return alt === null ? raw : `${raw} (≈${formatDurationRaw(alt)})`;
}

/** Raw slim formatter — never shows the rounded alternative. */
export function formatDurationSlimRaw(seconds: number): string {
  const { hours, minutes, seconds: remainingSeconds } = getDurationParts(seconds);

  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${remainingSeconds}s`;
}

/** Slim duration formatter with rounded alternative appended when enabled. */
export function formatDurationSlim(seconds: number): string {
  const raw = formatDurationSlimRaw(seconds);
  const alt = roundedAlternativeSeconds(seconds);
  return alt === null ? raw : `${raw} (≈${formatDurationSlimRaw(alt)})`;
}


/**
 * Format path for display: strip Windows extended-length prefix \\?\ and normalize UNC.
 * Use for UI only; keep original path when calling backend.
 */
export function formatPathForDisplay(path: string): string {
  if (!path || typeof path !== "string") return path;
  let s = path.trim();
  if (s.startsWith("\\\\?\\")) {
    s = s.slice(4);
    if (s.startsWith("UNC\\")) return "\\\\" + s.slice(4).replace(/\//g, "\\");
    return s.replace(/\//g, "\\");
  }
  return s;
}

export { formatMultiplierLabel };

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  // Tauri command errors serialized as { code, message } (CommandError, finding #8)
  if (
    typeof error === 'object' && error !== null &&
    'message' in error && typeof (error as { message: unknown }).message === 'string' &&
    (error as { message: string }).message.trim()
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}

const isDev = import.meta.env.DEV;

export function logTauriError(action: string, error: unknown): void {
  const msg = `Failed to ${action}: ${getErrorMessage(error, String(error))}`;
  console.error(`[TIMEFLOW] ${msg}`, error);
  import('@/lib/tauri/log-management')
    .then((m) => m.appendFrontendLog('error', msg))
    .catch(() => {});
}

export function logTauriWarn(action: string, ...args: unknown[]): void {
  if (isDev) console.warn(`[TIMEFLOW] ${action}`, ...args);
}

const MONEY_FORMAT_OPTIONS = {
  maximumFractionDigits: 2,
} as const;

const DECIMAL_FORMAT_OPTIONS = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
} as const;

const KNOWN_UI_LOCALES = ['en', 'pl'] as const;
const KNOWN_CURRENCIES = ['PLN', 'EUR', 'USD'] as const;

const moneyFormatters = new Map<string, Intl.NumberFormat>();
const decimalFormatters = new Map<string, Intl.NumberFormat>();

for (const locale of KNOWN_UI_LOCALES) {
  decimalFormatters.set(
    locale,
    new Intl.NumberFormat(locale, DECIMAL_FORMAT_OPTIONS),
  );
  for (const currency of KNOWN_CURRENCIES) {
    try {
      moneyFormatters.set(
        `${locale}:${currency}`,
        new Intl.NumberFormat(locale, {
          style: 'currency',
          currency,
          ...MONEY_FORMAT_OPTIONS,
        }),
      );
    } catch {
      // Ignore invalid locale/currency pairs during module warmup.
    }
  }
}

function getMoneyFormatter(currencyCode: string, locale: string): Intl.NumberFormat | undefined {
  return moneyFormatters.get(`${locale}:${currencyCode}`);
}

function getDecimalFormatter(locale: string): Intl.NumberFormat | undefined {
  return decimalFormatters.get(locale);
}

/**
 * Wspólny formatter walutowy dla całej aplikacji (Dashboard, Estimates,
 * Clients, Projects, Reports). Locale domyślnie pochodzi z aktualnego języka UI,
 * dzięki czemu separatory i symbol waluty są identyczne we wszystkich widokach.
 */
export function formatMoney(
  value: number,
  currencyCode: string,
  locale: string = activeLocale(),
): string {
  try {
    const formatter = getMoneyFormatter(currencyCode, locale);
    if (formatter) return formatter.format(value);
    return value.toFixed(2);
  } catch {
    return value.toFixed(2);
  }
}

/**
 * Wspólny formatter liczby (2 miejsca, bez symbolu waluty), locale-aware.
 * Używany tam, gdzie symbol waluty byłby mylący (np. kolumna wartości w PM,
 * gdzie ikona stawki pełni osobną rolę).
 */
export function formatDecimal(
  value: number,
  locale: string = activeLocale(),
): string {
  const formatter = getDecimalFormatter(locale);
  if (formatter) return formatter.format(value);
  return value.toFixed(2);
}

export function formatBytes(bytes: number, fractionDigits = 2): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const base = 1024;
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(base)),
  );
  const value = bytes / Math.pow(base, unitIndex);
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return typeof value === 'string' ? value : '';
  }
  return parsed.toLocaleString();
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function formatPercent(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return '0%';
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

export function formatDateLabel(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function formatSessionTime(value: string): string {
  try {
    return format(parseISO(value), 'HH:mm');
  } catch {
    return value;
  }
}

export function formatSessionDate(
  value: string,
  locale?: Locale | null,
): string {
  try {
    const dateFormat = locale?.code?.startsWith('pl')
      ? 'd MMM yyyy'
      : 'MMM d, yyyy';
    return format(parseISO(value), dateFormat, { locale: locale ?? undefined });
  } catch {
    return value;
  }
}
