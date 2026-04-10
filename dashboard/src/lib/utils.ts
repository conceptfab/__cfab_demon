import { format, parseISO } from 'date-fns';
import type { Locale } from 'date-fns';
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatMultiplierLabel } from '@/lib/rate-utils';

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

export function formatDuration(seconds: number): string {
  const { hours, minutes, seconds: remainingSeconds } = getDurationParts(seconds);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

export function formatDurationSlim(seconds: number): string {
  const { hours, minutes, seconds: remainingSeconds } = getDurationParts(seconds);

  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${remainingSeconds}s`;
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
  return fallback;
}

const isDev = import.meta.env.DEV;

export function logTauriError(action: string, error: unknown): void {
  console.error(`[TIMEFLOW] Failed to ${action}:`, error);
}

export function logTauriWarn(action: string, ...args: unknown[]): void {
  if (isDev) console.warn(`[TIMEFLOW] ${action}`, ...args);
}

export function logTauriInfo(action: string, ...args: unknown[]): void {
  if (isDev) console.info(`[TIMEFLOW] ${action}`, ...args);
}

export function formatMoney(value: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return value.toFixed(2);
  }
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

export function parseMultilineList(value: string): string[] {
  const unique = new Set<string>();
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    unique.add(trimmed);
  }
  return Array.from(unique);
}

export function formatMultilineList(values: string[]): string {
  return values.join('\n');
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
