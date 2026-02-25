export interface WorkingHoursSettings {
  start: string;
  end: string;
  color: string;
}

const WORKING_HOURS_STORAGE_KEY = "timeflow.settings.working-hours";
const LEGACY_WORKING_HOURS_STORAGE_KEY = "cfab.settings.working-hours";

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
    const raw =
      window.localStorage.getItem(WORKING_HOURS_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_WORKING_HOURS_STORAGE_KEY);
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

export interface FreezeSettings {
  thresholdDays: number;
}

const FREEZE_STORAGE_KEY = "timeflow.settings.freeze";

export const DEFAULT_FREEZE_SETTINGS: FreezeSettings = {
  thresholdDays: 14,
};

function normalizeThresholdDays(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_FREEZE_SETTINGS.thresholdDays;
  }
  return Math.min(365, Math.max(1, Math.round(value)));
}

export function loadFreezeSettings(): FreezeSettings {
  if (typeof window === "undefined") return { ...DEFAULT_FREEZE_SETTINGS };
  try {
    const raw = window.localStorage.getItem(FREEZE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FREEZE_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<FreezeSettings>;
    return {
      thresholdDays: normalizeThresholdDays(parsed.thresholdDays),
    };
  } catch {
    return { ...DEFAULT_FREEZE_SETTINGS };
  }
}

export function saveFreezeSettings(next: FreezeSettings): FreezeSettings {
  const normalized: FreezeSettings = {
    thresholdDays: normalizeThresholdDays(next.thresholdDays),
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(FREEZE_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export interface SessionSettings {
  gapFillMinutes: number;
  rebuildOnStartup: boolean;
  minSessionDurationSeconds: number;
}

const SESSION_STORAGE_KEY = "timeflow.settings.sessions";
const LEGACY_SESSION_STORAGE_KEY = "cfab.settings.sessions";

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  gapFillMinutes: 5,
  rebuildOnStartup: false,
  minSessionDurationSeconds: 10,
};

function normalizeGapFillMinutes(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_SESSION_SETTINGS.gapFillMinutes;
  }
  return Math.min(30, Math.max(0, Math.round(value)));
}

function normalizeMinSessionDuration(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_SESSION_SETTINGS.minSessionDurationSeconds;
  }
  return Math.min(300, Math.max(0, Math.round(value)));
}

export function loadSessionSettings(): SessionSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SESSION_SETTINGS };
  try {
    const raw =
      window.localStorage.getItem(SESSION_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_SESSION_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SESSION_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      gapFillMinutes: normalizeGapFillMinutes(parsed.gapFillMinutes),
      rebuildOnStartup: typeof parsed.rebuildOnStartup === "boolean" ? parsed.rebuildOnStartup : DEFAULT_SESSION_SETTINGS.rebuildOnStartup,
      minSessionDurationSeconds: normalizeMinSessionDuration(parsed.minSessionDurationSeconds),
    };
  } catch {
    return { ...DEFAULT_SESSION_SETTINGS };
  }
}

export function saveSessionSettings(next: SessionSettings): SessionSettings {
  const normalized: SessionSettings = {
    gapFillMinutes: normalizeGapFillMinutes(next.gapFillMinutes),
    rebuildOnStartup: !!next.rebuildOnStartup,
    minSessionDurationSeconds: normalizeMinSessionDuration(next.minSessionDurationSeconds),
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}
export interface CurrencySettings {
  code: string;
}

const CURRENCY_STORAGE_KEY = "timeflow.settings.currency";

export const DEFAULT_CURRENCY_SETTINGS: CurrencySettings = {
  code: "PLN",
};

export function loadCurrencySettings(): CurrencySettings {
  if (typeof window === "undefined") return { ...DEFAULT_CURRENCY_SETTINGS };
  try {
    const raw = window.localStorage.getItem(CURRENCY_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CURRENCY_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<CurrencySettings>;
    return {
      code: parsed.code && ["USD", "EUR", "PLN"].includes(parsed.code) ? parsed.code : DEFAULT_CURRENCY_SETTINGS.code,
    };
  } catch {
    return { ...DEFAULT_CURRENCY_SETTINGS };
  }
}

export function saveCurrencySettings(next: CurrencySettings): CurrencySettings {
  const normalized: CurrencySettings = {
    code: ["USD", "EUR", "PLN"].includes(next.code) ? next.code : DEFAULT_CURRENCY_SETTINGS.code,
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}
