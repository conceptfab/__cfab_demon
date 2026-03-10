import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatDurationSlim(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  if (h > 0) return `${h}h`;
  const m = Math.floor(seconds / 60);
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
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

export function formatMultiplierLabel(multiplier?: number): string {
  const value =
    typeof multiplier === 'number' &&
    Number.isFinite(multiplier) &&
    multiplier > 0
      ? multiplier
      : 1;
  return Number.isInteger(value)
    ? `x${value.toFixed(0)}`
    : `x${value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}`;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
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
