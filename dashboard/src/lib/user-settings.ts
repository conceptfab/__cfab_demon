export interface WorkingHoursSettings {
  start: string;
  end: string;
  color: string;
}

const WORKING_HOURS_STORAGE_KEY = "cfab.settings.working-hours";

export const DEFAULT_WORKING_HOURS: WorkingHoursSettings = {
  start: "09:00",
  end: "17:00",
  color: "#10b981",
};

function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function isValidHexColor(value: string): boolean {
  return /^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$/.test(value);
}

export function normalizeHexColor(value: string): string {
  return isValidHexColor(value) ? value : DEFAULT_WORKING_HOURS.color;
}

export function timeToMinutes(value: string): number | null {
  if (!isValidTime(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function normalizeWorkingHours(input: Partial<WorkingHoursSettings>): WorkingHoursSettings {
  const start = isValidTime(input.start ?? "") ? input.start! : DEFAULT_WORKING_HOURS.start;
  const end = isValidTime(input.end ?? "") ? input.end! : DEFAULT_WORKING_HOURS.end;
  const color = normalizeHexColor(input.color ?? "");
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return { ...DEFAULT_WORKING_HOURS };
  }
  return { start, end, color };
}

export function loadWorkingHoursSettings(): WorkingHoursSettings {
  if (typeof window === "undefined") return { ...DEFAULT_WORKING_HOURS };
  try {
    const raw = window.localStorage.getItem(WORKING_HOURS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_WORKING_HOURS };
    const parsed = JSON.parse(raw) as Partial<WorkingHoursSettings>;
    return normalizeWorkingHours(parsed ?? {});
  } catch {
    return { ...DEFAULT_WORKING_HOURS };
  }
}

export function saveWorkingHoursSettings(next: WorkingHoursSettings): WorkingHoursSettings {
  const normalized = normalizeWorkingHours(next);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(WORKING_HOURS_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export interface SessionSettings {
  gapFillMinutes: number;
  rebuildOnStartup: boolean;
}

const SESSION_STORAGE_KEY = "cfab.settings.sessions";

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  gapFillMinutes: 5,
  rebuildOnStartup: false,
};

function normalizeGapFillMinutes(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_SESSION_SETTINGS.gapFillMinutes;
  }
  return Math.min(30, Math.max(0, Math.round(value)));
}

export function loadSessionSettings(): SessionSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SESSION_SETTINGS };
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SESSION_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      gapFillMinutes: normalizeGapFillMinutes(parsed.gapFillMinutes),
      rebuildOnStartup: typeof parsed.rebuildOnStartup === "boolean" ? parsed.rebuildOnStartup : DEFAULT_SESSION_SETTINGS.rebuildOnStartup,
    };
  } catch {
    return { ...DEFAULT_SESSION_SETTINGS };
  }
}

export function saveSessionSettings(next: SessionSettings): SessionSettings {
  const normalized: SessionSettings = {
    gapFillMinutes: normalizeGapFillMinutes(next.gapFillMinutes),
    rebuildOnStartup: !!next.rebuildOnStartup,
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}
