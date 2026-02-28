export interface WorkingHoursSettings {
  start: string;
  end: string;
  color: string;
}

const WORKING_HOURS_STORAGE_KEY = "timeflow.settings.working-hours";
const LEGACY_WORKING_HOURS_STORAGE_KEY = "cfab.settings.working-hours";

function loadRawSetting(primaryKey: string, legacyKey?: string): string | null {
  if (typeof window === "undefined") return null;
  const primary = window.localStorage.getItem(primaryKey);
  if (primary !== null) return primary;
  if (!legacyKey) return null;
  return window.localStorage.getItem(legacyKey);
}

function migrateLegacySetting(primaryKey: string, legacyKey: string, value: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(primaryKey, value);
  window.localStorage.removeItem(legacyKey);
}

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
    const raw = loadRawSetting(WORKING_HOURS_STORAGE_KEY, LEGACY_WORKING_HOURS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_WORKING_HOURS };
    if (
      window.localStorage.getItem(WORKING_HOURS_STORAGE_KEY) === null &&
      window.localStorage.getItem(LEGACY_WORKING_HOURS_STORAGE_KEY) !== null
    ) {
      migrateLegacySetting(WORKING_HOURS_STORAGE_KEY, LEGACY_WORKING_HOURS_STORAGE_KEY, raw);
    }
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
    window.localStorage.removeItem(LEGACY_WORKING_HOURS_STORAGE_KEY);
  }
  return normalized;
}

export interface FreezeSettings {
  thresholdDays: number;
}

const FREEZE_STORAGE_KEY = "timeflow.settings.freeze";
const LEGACY_FREEZE_STORAGE_KEY = "cfab.settings.freeze";

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
    const raw = loadRawSetting(FREEZE_STORAGE_KEY, LEGACY_FREEZE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FREEZE_SETTINGS };
    if (
      window.localStorage.getItem(FREEZE_STORAGE_KEY) === null &&
      window.localStorage.getItem(LEGACY_FREEZE_STORAGE_KEY) !== null
    ) {
      migrateLegacySetting(FREEZE_STORAGE_KEY, LEGACY_FREEZE_STORAGE_KEY, raw);
    }
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
    window.localStorage.removeItem(LEGACY_FREEZE_STORAGE_KEY);
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
    const raw = loadRawSetting(SESSION_STORAGE_KEY, LEGACY_SESSION_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SESSION_SETTINGS };
    if (
      window.localStorage.getItem(SESSION_STORAGE_KEY) === null &&
      window.localStorage.getItem(LEGACY_SESSION_STORAGE_KEY) !== null
    ) {
      migrateLegacySetting(SESSION_STORAGE_KEY, LEGACY_SESSION_STORAGE_KEY, raw);
    }
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
    window.localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
  }
  return normalized;
}
export interface CurrencySettings {
  code: string;
}

const CURRENCY_STORAGE_KEY = "timeflow.settings.currency";
const LEGACY_CURRENCY_STORAGE_KEY = "cfab.settings.currency";

export const DEFAULT_CURRENCY_SETTINGS: CurrencySettings = {
  code: "PLN",
};

export function loadCurrencySettings(): CurrencySettings {
  if (typeof window === "undefined") return { ...DEFAULT_CURRENCY_SETTINGS };
  try {
    const raw = loadRawSetting(CURRENCY_STORAGE_KEY, LEGACY_CURRENCY_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CURRENCY_SETTINGS };
    if (
      window.localStorage.getItem(CURRENCY_STORAGE_KEY) === null &&
      window.localStorage.getItem(LEGACY_CURRENCY_STORAGE_KEY) !== null
    ) {
      migrateLegacySetting(CURRENCY_STORAGE_KEY, LEGACY_CURRENCY_STORAGE_KEY, raw);
    }
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
    window.localStorage.removeItem(LEGACY_CURRENCY_STORAGE_KEY);
  }
  return normalized;
}

export type AppLanguageCode = "pl" | "en";

export interface LanguageSettings {
  code: AppLanguageCode;
}

const LANGUAGE_STORAGE_KEY = "timeflow.settings.language";
const LEGACY_LANGUAGE_STORAGE_KEY = "cfab.settings.language";

export const DEFAULT_LANGUAGE_SETTINGS: LanguageSettings = {
  code: "en",
};

export function normalizeLanguageCode(value: unknown): AppLanguageCode {
  if (typeof value !== "string") return DEFAULT_LANGUAGE_SETTINGS.code;
  return value.toLowerCase().startsWith("pl") ? "pl" : "en";
}

function detectBrowserLanguageCode(): AppLanguageCode {
  if (typeof navigator === "undefined") return DEFAULT_LANGUAGE_SETTINGS.code;
  return normalizeLanguageCode(navigator.language || navigator.languages?.[0]);
}

export function loadLanguageSettings(): LanguageSettings {
  if (typeof window === "undefined") return { ...DEFAULT_LANGUAGE_SETTINGS };
  try {
    const raw = loadRawSetting(LANGUAGE_STORAGE_KEY, LEGACY_LANGUAGE_STORAGE_KEY);
    if (!raw) return { code: detectBrowserLanguageCode() };
    if (
      window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === null &&
      window.localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY) !== null
    ) {
      migrateLegacySetting(LANGUAGE_STORAGE_KEY, LEGACY_LANGUAGE_STORAGE_KEY, raw);
    }
    const parsed = JSON.parse(raw) as Partial<LanguageSettings>;
    return {
      code: normalizeLanguageCode(parsed.code),
    };
  } catch {
    return { code: detectBrowserLanguageCode() };
  }
}

export function saveLanguageSettings(next: LanguageSettings): LanguageSettings {
  const normalized: LanguageSettings = {
    code: normalizeLanguageCode(next.code),
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, JSON.stringify(normalized));
    window.localStorage.removeItem(LEGACY_LANGUAGE_STORAGE_KEY);
  }
  return normalized;
}

export interface SessionIndicatorSettings {
  showAiBadge: boolean;
  showScoreBreakdown: boolean;
  showThumbsOnAi: boolean;
  showThumbsOnAll: boolean;
  showSuggestions: boolean;
}

const INDICATOR_STORAGE_KEY = "timeflow.settings.session-indicators";

export const DEFAULT_INDICATOR_SETTINGS: SessionIndicatorSettings = {
  showAiBadge: true,
  showScoreBreakdown: true,
  showThumbsOnAi: true,
  showThumbsOnAll: false,
  showSuggestions: true,
};

export function loadIndicatorSettings(): SessionIndicatorSettings {
  if (typeof window === "undefined") return { ...DEFAULT_INDICATOR_SETTINGS };
  try {
    const raw = window.localStorage.getItem(INDICATOR_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_INDICATOR_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<SessionIndicatorSettings>;
    return {
      showAiBadge: typeof parsed.showAiBadge === "boolean" ? parsed.showAiBadge : DEFAULT_INDICATOR_SETTINGS.showAiBadge,
      showScoreBreakdown: typeof parsed.showScoreBreakdown === "boolean" ? parsed.showScoreBreakdown : DEFAULT_INDICATOR_SETTINGS.showScoreBreakdown,
      showThumbsOnAi: typeof parsed.showThumbsOnAi === "boolean" ? parsed.showThumbsOnAi : DEFAULT_INDICATOR_SETTINGS.showThumbsOnAi,
      showThumbsOnAll: typeof parsed.showThumbsOnAll === "boolean" ? parsed.showThumbsOnAll : DEFAULT_INDICATOR_SETTINGS.showThumbsOnAll,
      showSuggestions: typeof parsed.showSuggestions === "boolean" ? parsed.showSuggestions : DEFAULT_INDICATOR_SETTINGS.showSuggestions,
    };
  } catch {
    return { ...DEFAULT_INDICATOR_SETTINGS };
  }
}

export function saveIndicatorSettings(next: SessionIndicatorSettings): SessionIndicatorSettings {
  const normalized: SessionIndicatorSettings = {
    showAiBadge: !!next.showAiBadge,
    showScoreBreakdown: !!next.showScoreBreakdown,
    showThumbsOnAi: !!next.showThumbsOnAi,
    showThumbsOnAll: !!next.showThumbsOnAll,
    showSuggestions: !!next.showSuggestions,
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(INDICATOR_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}
