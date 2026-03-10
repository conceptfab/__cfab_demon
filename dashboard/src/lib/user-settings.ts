export interface WorkingHoursSettings {
  start: string;
  end: string;
  color: string;
}

const WORKING_HOURS_STORAGE_KEY = 'timeflow.settings.working-hours';
const LEGACY_WORKING_HOURS_STORAGE_KEY = 'cfab.settings.working-hours';

function loadRawSetting(primaryKey: string, legacyKey?: string): string | null {
  if (typeof window === 'undefined') return null;
  const primary = window.localStorage.getItem(primaryKey);
  if (primary !== null) return primary;
  if (!legacyKey) return null;
  return window.localStorage.getItem(legacyKey);
}

function migrateLegacySetting(
  primaryKey: string,
  legacyKey: string,
  value: string,
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(primaryKey, value);
    window.localStorage.removeItem(legacyKey);
  } catch (error) {
    console.warn(`Failed to migrate local setting '${primaryKey}':`, error);
  }
}

function createSettingsManager<T>(config: {
  key: string;
  legacyKey?: string;
  defaults: T;
  normalize: (parsed: Partial<T> & Record<string, unknown>) => T;
}) {
  let cached: T | null = null;

  return {
    load: (): T => {
      if (cached) {
        return { ...cached };
      }
      if (typeof window === 'undefined') return { ...config.defaults };
      try {
        const raw = loadRawSetting(config.key, config.legacyKey);
        if (!raw) {
          cached = { ...config.defaults };
          return { ...cached };
        }
        if (
          config.legacyKey &&
          window.localStorage.getItem(config.key) === null &&
          window.localStorage.getItem(config.legacyKey) !== null
        ) {
          migrateLegacySetting(config.key, config.legacyKey, raw);
        }
        const parsed = (JSON.parse(raw) ?? {}) as Partial<T> &
          Record<string, unknown>;
        cached = config.normalize(parsed ?? {});
        return { ...cached };
      } catch {
        cached = { ...config.defaults };
        return { ...cached };
      }
    },
    save: (next: T): T => {
      const normalized = config.normalize(
        next as Partial<T> & Record<string, unknown>,
      );
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(config.key, JSON.stringify(normalized));
          if (config.legacyKey) {
            window.localStorage.removeItem(config.legacyKey);
          }
        } catch (error) {
          console.warn(`Failed to save local setting '${config.key}':`, error);
        }
      }
      cached = normalized;
      return { ...normalized };
    },
  };
}

export const DEFAULT_WORKING_HOURS: WorkingHoursSettings = {
  start: '09:00',
  end: '17:00',
  color: '#10b981',
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
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

const workingHoursManager = createSettingsManager<WorkingHoursSettings>({
  key: WORKING_HOURS_STORAGE_KEY,
  legacyKey: LEGACY_WORKING_HOURS_STORAGE_KEY,
  defaults: DEFAULT_WORKING_HOURS,
  normalize: (input) => {
    const start = isValidTime(input.start ?? '')
      ? input.start!
      : DEFAULT_WORKING_HOURS.start;
    const end = isValidTime(input.end ?? '')
      ? input.end!
      : DEFAULT_WORKING_HOURS.end;
    const color = normalizeHexColor(input.color ?? '');
    const startMinutes = timeToMinutes(start);
    const endMinutes = timeToMinutes(end);
    if (
      startMinutes === null ||
      endMinutes === null ||
      endMinutes <= startMinutes
    ) {
      return { ...DEFAULT_WORKING_HOURS };
    }
    return { start, end, color };
  },
});
export const loadWorkingHoursSettings = workingHoursManager.load;
export const saveWorkingHoursSettings = workingHoursManager.save;

export interface FreezeSettings {
  thresholdDays: number;
}
const FREEZE_STORAGE_KEY = 'timeflow.settings.freeze';
const LEGACY_FREEZE_STORAGE_KEY = 'cfab.settings.freeze';
export const DEFAULT_FREEZE_SETTINGS: FreezeSettings = {
  thresholdDays: 14,
};
const freezeManager = createSettingsManager<FreezeSettings>({
  key: FREEZE_STORAGE_KEY,
  legacyKey: LEGACY_FREEZE_STORAGE_KEY,
  defaults: DEFAULT_FREEZE_SETTINGS,
  normalize: (parsed) => ({
    thresholdDays:
      typeof parsed.thresholdDays === 'number' &&
      !Number.isNaN(parsed.thresholdDays)
        ? Math.min(365, Math.max(1, Math.round(parsed.thresholdDays)))
        : DEFAULT_FREEZE_SETTINGS.thresholdDays,
  }),
});
export const loadFreezeSettings = freezeManager.load;
export const saveFreezeSettings = freezeManager.save;

export interface SessionSettings {
  gapFillMinutes: number;
  rebuildOnStartup: boolean;
  minSessionDurationSeconds: number;
}
const SESSION_STORAGE_KEY = 'timeflow.settings.sessions';
const LEGACY_SESSION_STORAGE_KEY = 'cfab.settings.sessions';
export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  gapFillMinutes: 5,
  rebuildOnStartup: false,
  minSessionDurationSeconds: 10,
};
const sessionManager = createSettingsManager<SessionSettings>({
  key: SESSION_STORAGE_KEY,
  legacyKey: LEGACY_SESSION_STORAGE_KEY,
  defaults: DEFAULT_SESSION_SETTINGS,
  normalize: (parsed) => ({
    gapFillMinutes:
      typeof parsed.gapFillMinutes === 'number' &&
      !Number.isNaN(parsed.gapFillMinutes)
        ? Math.min(30, Math.max(0, Math.round(parsed.gapFillMinutes)))
        : DEFAULT_SESSION_SETTINGS.gapFillMinutes,
    rebuildOnStartup:
      typeof parsed.rebuildOnStartup === 'boolean'
        ? parsed.rebuildOnStartup
        : DEFAULT_SESSION_SETTINGS.rebuildOnStartup,
    minSessionDurationSeconds:
      typeof parsed.minSessionDurationSeconds === 'number' &&
      !Number.isNaN(parsed.minSessionDurationSeconds)
        ? Math.min(
            300,
            Math.max(0, Math.round(parsed.minSessionDurationSeconds)),
          )
        : DEFAULT_SESSION_SETTINGS.minSessionDurationSeconds,
  }),
});
export const loadSessionSettings = sessionManager.load;
export const saveSessionSettings = sessionManager.save;

export interface CurrencySettings {
  code: string;
}
const CURRENCY_STORAGE_KEY = 'timeflow.settings.currency';
const LEGACY_CURRENCY_STORAGE_KEY = 'cfab.settings.currency';
export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'PLN'] as const;
export const DEFAULT_CURRENCY_SETTINGS: CurrencySettings = { code: 'PLN' };
const currencyManager = createSettingsManager<CurrencySettings>({
  key: CURRENCY_STORAGE_KEY,
  legacyKey: LEGACY_CURRENCY_STORAGE_KEY,
  defaults: DEFAULT_CURRENCY_SETTINGS,
  normalize: (parsed) => ({
    code:
      parsed.code &&
      (SUPPORTED_CURRENCIES as readonly string[]).includes(parsed.code)
        ? parsed.code
        : DEFAULT_CURRENCY_SETTINGS.code,
  }),
});
export const loadCurrencySettings = currencyManager.load;
export const saveCurrencySettings = currencyManager.save;

export type AppLanguageCode = 'pl' | 'en';
export interface LanguageSettings {
  code: AppLanguageCode;
}
const LANGUAGE_STORAGE_KEY = 'timeflow.settings.language';
const LEGACY_LANGUAGE_STORAGE_KEY = 'cfab.settings.language';
export const DEFAULT_LANGUAGE_SETTINGS: LanguageSettings = { code: 'en' };
export function normalizeLanguageCode(value: unknown): AppLanguageCode {
  if (typeof value !== 'string') return DEFAULT_LANGUAGE_SETTINGS.code;
  return value.toLowerCase().startsWith('pl') ? 'pl' : 'en';
}
function detectBrowserLanguageCode(): AppLanguageCode {
  if (typeof navigator === 'undefined') return DEFAULT_LANGUAGE_SETTINGS.code;
  return normalizeLanguageCode(navigator.language || navigator.languages?.[0]);
}
const languageManager = createSettingsManager<LanguageSettings>({
  key: LANGUAGE_STORAGE_KEY,
  legacyKey: LEGACY_LANGUAGE_STORAGE_KEY,
  defaults: { code: detectBrowserLanguageCode() },
  normalize: (parsed) => ({
    code: normalizeLanguageCode(parsed.code),
  }),
});
export const loadLanguageSettings = languageManager.load;
export const saveLanguageSettings = languageManager.save;

export interface AppearanceSettings {
  chartAnimations: boolean;
}
const APPEARANCE_STORAGE_KEY = 'timeflow.settings.appearance';
const LEGACY_APPEARANCE_STORAGE_KEY = 'cfab.settings.appearance';
export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  chartAnimations: true,
};
const appearanceManager = createSettingsManager<AppearanceSettings>({
  key: APPEARANCE_STORAGE_KEY,
  legacyKey: LEGACY_APPEARANCE_STORAGE_KEY,
  defaults: DEFAULT_APPEARANCE_SETTINGS,
  normalize: (parsed) => ({
    chartAnimations:
      typeof parsed.chartAnimations === 'boolean'
        ? parsed.chartAnimations
        : DEFAULT_APPEARANCE_SETTINGS.chartAnimations,
  }),
});
export const loadAppearanceSettings = appearanceManager.load;
export const saveAppearanceSettings = appearanceManager.save;

export interface SessionIndicatorSettings {
  showAiBadge: boolean;
  showScoreBreakdown: boolean;
  showSuggestions: boolean;
}
const INDICATOR_STORAGE_KEY = 'timeflow.settings.session-indicators';
export const DEFAULT_INDICATOR_SETTINGS: SessionIndicatorSettings = {
  showAiBadge: true,
  showScoreBreakdown: true,
  showSuggestions: true,
};
const indicatorManager = createSettingsManager<SessionIndicatorSettings>({
  key: INDICATOR_STORAGE_KEY,
  defaults: DEFAULT_INDICATOR_SETTINGS,
  normalize: (parsed) => ({
    showAiBadge:
      typeof parsed.showAiBadge === 'boolean'
        ? parsed.showAiBadge
        : DEFAULT_INDICATOR_SETTINGS.showAiBadge,
    showScoreBreakdown:
      typeof parsed.showScoreBreakdown === 'boolean'
        ? parsed.showScoreBreakdown
        : DEFAULT_INDICATOR_SETTINGS.showScoreBreakdown,
    showSuggestions:
      typeof parsed.showSuggestions === 'boolean'
        ? parsed.showSuggestions
        : DEFAULT_INDICATOR_SETTINGS.showSuggestions,
  }),
});
export const loadIndicatorSettings = indicatorManager.load;
export const saveIndicatorSettings = indicatorManager.save;

export interface AiAutoAssignmentSettings {
  autoLimit: number;
}
const AI_AUTO_ASSIGNMENT_STORAGE_KEY = 'timeflow.settings.ai-auto-assignment';
const LEGACY_AI_AUTO_LIMIT_STORAGE_KEY = 'timeflow.ai.auto-limit';
export const DEFAULT_AI_AUTO_ASSIGNMENT_SETTINGS: AiAutoAssignmentSettings = {
  autoLimit: 500,
};
const aiAutoAssignmentManager = createSettingsManager<AiAutoAssignmentSettings>({
  key: AI_AUTO_ASSIGNMENT_STORAGE_KEY,
  legacyKey: LEGACY_AI_AUTO_LIMIT_STORAGE_KEY,
  defaults: DEFAULT_AI_AUTO_ASSIGNMENT_SETTINGS,
  normalize: (parsed) => {
    const rawValue =
      typeof parsed === 'object' &&
      parsed !== null &&
      'autoLimit' in parsed
        ? parsed.autoLimit
        : (parsed as unknown);
    return {
      autoLimit:
        typeof rawValue === 'number' && Number.isFinite(rawValue)
          ? Math.min(10_000, Math.max(1, Math.round(rawValue)))
          : typeof rawValue === 'string'
            ? Math.min(
                10_000,
                Math.max(
                  1,
                  Math.round(
                    Number.parseInt(rawValue, 10) ||
                      DEFAULT_AI_AUTO_ASSIGNMENT_SETTINGS.autoLimit,
                  ),
                ),
              )
            : DEFAULT_AI_AUTO_ASSIGNMENT_SETTINGS.autoLimit,
    };
  },
});
export const loadAiAutoAssignmentSettings = aiAutoAssignmentManager.load;
export const saveAiAutoAssignmentSettings = aiAutoAssignmentManager.save;

export interface ReportFontSettings {
  fontFamily: 'system' | 'serif' | 'mono';
  baseFontSize: number;
}
const REPORT_FONT_STORAGE_KEY = 'timeflow.settings.report-font';
export const DEFAULT_REPORT_FONT_SETTINGS: ReportFontSettings = {
  fontFamily: 'system',
  baseFontSize: 13,
};
const FONT_FAMILIES = ['system', 'serif', 'mono'] as const;
const reportFontManager = createSettingsManager<ReportFontSettings>({
  key: REPORT_FONT_STORAGE_KEY,
  defaults: DEFAULT_REPORT_FONT_SETTINGS,
  normalize: (parsed) => ({
    fontFamily:
      typeof parsed.fontFamily === 'string' &&
      (FONT_FAMILIES as readonly string[]).includes(parsed.fontFamily)
        ? (parsed.fontFamily as ReportFontSettings['fontFamily'])
        : DEFAULT_REPORT_FONT_SETTINGS.fontFamily,
    baseFontSize:
      typeof parsed.baseFontSize === 'number' &&
      !Number.isNaN(parsed.baseFontSize)
        ? Math.min(18, Math.max(10, Math.round(parsed.baseFontSize)))
        : DEFAULT_REPORT_FONT_SETTINGS.baseFontSize,
  }),
});
export const loadReportFontSettings = reportFontManager.load;
export const saveReportFontSettings = reportFontManager.save;

export interface SplitSettings {
  maxProjectsPerSession: number;
  toleranceThreshold: number;
  autoSplitEnabled: boolean;
}
const SPLIT_STORAGE_KEY = 'timeflow.settings.split';
export const DEFAULT_SPLIT_SETTINGS: SplitSettings = {
  maxProjectsPerSession: 5,
  toleranceThreshold: 0.8,
  autoSplitEnabled: false,
};
const splitManager = createSettingsManager<SplitSettings>({
  key: SPLIT_STORAGE_KEY,
  defaults: DEFAULT_SPLIT_SETTINGS,
  normalize: (parsed) => ({
    maxProjectsPerSession:
      typeof parsed.maxProjectsPerSession === 'number' &&
      !Number.isNaN(parsed.maxProjectsPerSession)
        ? Math.min(5, Math.max(2, Math.round(parsed.maxProjectsPerSession)))
        : DEFAULT_SPLIT_SETTINGS.maxProjectsPerSession,
    toleranceThreshold:
      typeof parsed.toleranceThreshold === 'number' &&
      !Number.isNaN(parsed.toleranceThreshold)
        ? Math.min(
            1.0,
            Math.max(0.2, Math.round(parsed.toleranceThreshold * 20) / 20),
          )
        : DEFAULT_SPLIT_SETTINGS.toleranceThreshold,
    autoSplitEnabled: !!parsed.autoSplitEnabled,
  }),
});
export const loadSplitSettings = splitManager.load;
export const saveSplitSettings = splitManager.save;
