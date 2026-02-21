import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatDurationLong(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

export function formatHours(seconds: number): string {
  return (seconds / 3600).toFixed(1) + "h";
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
